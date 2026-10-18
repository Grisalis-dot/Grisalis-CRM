// Cargar variables de entorno
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');

// 1. CONFIGURACIÓN DE IA Y BASE DE DATOS (AHORA DESDE .ENV)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// 2. CONFIGURACIÓN DE WHATSAPP Y RECEPCIÓN DE MENSAJES
console.log('Iniciando sistema...');
const waClient = new Client({ authStrategy: new LocalAuth() });

waClient.on('qr', (qr) => qrcode.generate(qr, { small: true }));
waClient.on('ready', () => {
    console.log('¡WhatsApp conectado!');
    io.emit('wa_status', 'Conectado');
});

// AHORA GUARDA EL HISTORIAL DE CHAT ENTRANTE (CORREGIDO PARA IGNORAR ESPACIOS)
waClient.on('message', async msg => {
    let numeroLimpio = msg.from.replace('@c.us', '');
    
    try {
        const { data: prospectos, error } = await supabase.from('prospectos').select('id, contacto');
        if (error) throw error;

        // Buscamos ignorando espacios, guiones o signos +
        const prospecto = prospectos.find(p => {
            const telLimpiado = (p.contacto || '').replace(/\D/g, ''); 
            return telLimpiado === numeroLimpio;
        });
        
        if (prospecto) {
            const { error: insertError } = await supabase.from('mensajes').insert([{
                prospecto_id: prospecto.id,
                mensaje: msg.body,
                tipo: 'in'
            }]);
            if (insertError) console.error("❌ Error DB (Guardando entrada):", insertError.message);
        }
    } catch (err) {
        console.error("❌ Error buscando cliente para historial:", err.message);
    }

    io.emit('nuevo_mensaje', { numero: numeroLimpio, body: msg.body });
});
waClient.initialize();

// 3. RUTA PARA LEER PROSPECTOS DESDE SUPABASE
app.get('/api/prospectos', async (req, res) => {
    try {
        const { data, error } = await supabase.from('prospectos').select('*').order('creado_en', { ascending: false });
        if (error) throw error;

        const prospectosAdaptados = data.map(p => ({
            id: p.id,
            'Nombre empresa': p.nombre_empresa,
            'Nicho': p.nicho,
            'Contacto (Tel / WhatsApp)': p.contacto,
            'Correo': p.correo,
            'Dirección': p.direccion,
            'Observaciones': p.observaciones,
            'Mensaje de Acercamiento': p.mensaje_acercamiento,
            'Estado': p.estado
        }));

        res.json(prospectosAdaptados);
    } catch (error) {
        console.error('Error leyendo Supabase:', error.message);
        res.status(500).json({ error: 'Error cargando datos de la nube' });
    }
});

// 4. RUTA PARA ACTUALIZAR EL ESTADO EN SUPABASE
app.post('/api/actualizar-estado', async (req, res) => {
    try {
        const { id, estado } = req.body; 
        const { error } = await supabase.from('prospectos').update({ estado: estado }).eq('id', id);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        console.error('Error al actualizar estado:', error.message);
        res.status(500).json({ error: 'Error interno al guardar.' });
    }
});

// 4.5 RUTA PARA OBTENER EL HISTORIAL DE CHAT
app.get('/api/mensajes/:prospecto_id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('mensajes')
            .select('*')
            .eq('prospecto_id', req.params.prospecto_id)
            .order('creado_en', { ascending: true });
        if (error) throw error;
        res.json(data);
    } catch (error) {
        console.error('Error cargando historial:', error.message);
        res.status(500).json({ error: 'Error cargando historial' });
    }
});

// 5. EL CEREBRO DE LA IA
app.post('/api/generar-prospectos', async (req, res) => {
    try {
        const { nicho, ciudad } = req.body;
        const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' }); 
        
        const prompt = `Actúa como un experto en prospección B2B. Busca en internet 3 negocios reales del nicho "${nicho}" en la ciudad de "${ciudad}" o inventa 3 ejemplos hiperrealistas si la búsqueda directa falla. 
        Analiza si tienen sitio web. Genera un JSON estrictamente con esta estructura (sin texto adicional ni comillas invertidas markdown):
        [
            {"nombre_empresa": "Ejemplo", "nicho": "${nicho}", "contacto": "+57 3000000000", "correo": "No disponible", "direccion": "Calle Falsa 123", "observaciones": "Sin sitio web propio.", "mensaje_acercamiento": "¡Hola equipo de Ejemplo! Somos Grisalis Technologies...", "estado": "Nuevo"}
        ]`;

        console.log(`Conectando con Gemini AI para buscar ${nicho} en ${ciudad}...`);
        const result = await model.generateContent(prompt);
        let textoRespuesta = result.response.text();
        
        textoRespuesta = textoRespuesta.replace(/```json/g, '').replace(/```/g, '').trim();
        const nuevosProspectos = JSON.parse(textoRespuesta);

        const { error } = await supabase.from('prospectos').insert(nuevosProspectos);
        if (error) throw error;

        console.log("¡Prospectos guardados en Supabase con éxito!");
        res.json({ success: true, message: 'Prospectos generados y guardados en Supabase.' });
        
    } catch (error) {
        console.error('Error con IA:', error.message);
        res.status(500).json({ success: false, error: 'Fallo al conectar con Gemini: ' + error.message });
    }
});

// 6. RUTA DE SOCKETS (CHAT) - AHORA GUARDA MENSAJES SALIENTES CON LOGS Y ESPERA A LA BD
io.on('connection', (socket) => {
    socket.on('enviar_mensaje', async (data) => {
        try {
            const numeroLimpio = data.numero.replace(/\D/g, ''); 
            const contactoValido = await waClient.getNumberId(numeroLimpio);
            
            if (!contactoValido) {
                return socket.emit('mensaje_enviado', { status: 'error', error: 'No tiene WhatsApp.' });
            }
            
            // 1. Envía el mensaje por WhatsApp
            await waClient.sendMessage(contactoValido._serialized, data.mensaje);
            
            // 2. IMPORTANTE: Guardar en Supabase (Asegurando que el ID viaja correctamente)
            if (data.prospecto_id) {
                const { data: dbData, error: dbErr } = await supabase.from('mensajes').insert([{
                    prospecto_id: data.prospecto_id,
                    mensaje: data.mensaje,
                    tipo: 'out'
                }]).select(); // El .select() obliga a la BD a confirmar que lo guardó
                
                if (dbErr) {
                    console.error('❌ Error BD (Enviando):', dbErr.message, dbErr.details);
                } else {
                    console.log(`✅ Mensaje guardado en BD para el prospecto ${data.prospecto_id}`);
                }
            } else {
                console.error('❌ Error: El frontend no envió el prospecto_id a los sockets');
            }

            // 3. Confirmar al frontend que todo salió bien
            socket.emit('mensaje_enviado', { status: 'ok', mensaje: data.mensaje, numero: data.numero });
            
        } catch (error) {
            console.error('❌ Error de Socket General:', error);
            socket.emit('mensaje_enviado', { status: 'error', error: 'Error interno del servidor.' });
        }
    });
});

server.listen(PORT, () => console.log(`CRM en la Nube corriendo en http://localhost:${PORT}`));