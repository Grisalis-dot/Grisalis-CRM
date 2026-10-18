require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

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


// 🧠 MOTOR MULTI-WHATSAPP MEJORADO (CON MEMORIA DE QR)

const waClients = new Map();
const waQrCodes = new Map();   
const waStatuses = new Map();  
const creandoProspectos = new Set();

function iniciarWhatsAppParaUsuario(userId, socket = null) {
    if (waClients.has(userId)) {
        if (socket) {
            const statusActual = waStatuses.get(userId) || 'Iniciando servidor...';
            socket.emit(`wa_status_${userId}`, statusActual);
            
            if (waQrCodes.has(userId)) {
                socket.emit(`wa_qr_${userId}`, waQrCodes.get(userId));
            }
        }
        return waClients.get(userId);
    }

    console.log(`Iniciando instancia de WhatsApp para usuario: ${userId}`);
    waStatuses.set(userId, 'Iniciando servidor...');
    if (socket) socket.emit(`wa_status_${userId}`, 'Iniciando servidor...');

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }), 
        puppeteer: { 
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', 
                '--disable-accelerated-2d-canvas', 
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu' 
            ] 
        }
    });

   client.on('qr', (qr) => {
        waQrCodes.set(userId, qr); 
        waStatuses.set(userId, 'Escanea el QR para conectar');
        io.emit(`wa_qr_${userId}`, qr); 
        io.emit(`wa_status_${userId}`, 'Escanea el QR para conectar');
    });

    // 🚀 NUEVO: Respuesta inmediata al escanear
    client.on('authenticated', () => {
        console.log(`WhatsApp autenticado (cargando mensajes...) para ${userId}`);
        waQrCodes.delete(userId); // Borramos el QR
        waStatuses.set(userId, 'Sincronizando chats...');
        io.emit(`wa_status_${userId}`, 'Sincronizando chats...');
    });

    client.on('ready', () => {
        console.log(`¡WhatsApp conectado para el usuario ${userId}!`);
        waStatuses.set(userId, 'Conectado');
        io.emit(`wa_status_${userId}`, 'Conectado');
    });

    // 🛡️ CORRECCIÓN: Fuga de memoria. Apagamos el navegador si se desvincula la cuenta.
    client.on('disconnected', async (reason) => {
        console.log(`WhatsApp desconectado para ${userId}: ${reason}`);
        waQrCodes.delete(userId);
        waStatuses.set(userId, 'Desconectado (Recarga la página)');
        io.emit(`wa_status_${userId}`, 'Desconectado (Recarga la página)');
        waClients.delete(userId);
        try {
            await client.destroy();
        } catch(e) {
            console.error("Error limpiando memoria:", e.message);
        }
    });

    client.on('message', async msg => {
        procesarMensajeEntrante(msg, userId, client);
    });

    client.initialize();
    waClients.set(userId, client);
    return client;
}

async function procesarMensajeEntrante(msg, userId, client) {
    const contact = await msg.getContact();
    let numeroLimpio = contact.number || msg.from.replace('@c.us', '');
    
    if (creandoProspectos.has(numeroLimpio)) {
        await new Promise(resolve => setTimeout(resolve, 1500)); 
    }

    try {
        const { data: prospectos, error } = await supabase.from('prospectos').select('id, contacto, estado').eq('vendedor_id', userId);
        if (error) throw error;

        let prospecto = prospectos.find(p => {
            const telLimpiado = (p.contacto || '').replace(/\D/g, ''); 
            const incomingLimpiado = numeroLimpio.replace(/\D/g, '');
            return telLimpiado === incomingLimpiado || p.contacto === numeroLimpio;
        });
        
        if (!prospecto) {
            creandoProspectos.add(numeroLimpio);
            const { data: nuevoProspecto, error: insertError } = await supabase.from('prospectos').insert([{
                vendedor_id: userId, 
                nombre_empresa: 'Lead Entrante',
                nicho: 'Sin definir',
                contacto: numeroLimpio, 
                estado: 'Nuevo'
            }]).select().single(); 
            
            creandoProspectos.delete(numeroLimpio);
            
            if (!insertError) {
                prospecto = nuevoProspecto;
                io.emit(`recargar_prospectos_${userId}`); 
            } else {
                return; 
            }
        }

        if (prospecto && prospecto.id) {
            await supabase.from('mensajes').insert([{
                prospecto_id: prospecto.id,
                mensaje: msg.body,
                tipo: 'in'
            }]);

            try {
                const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' });
                const promptClasificacion = `Eres experto en ventas. Cliente dice: "${msg.body}". Clasifica en UNA opción: "Contactado", "En Negociación", "Cliente Cerrado", "No Interesado", "MANTENER". Devuelve SOLO la opción.`;
                const result = await model.generateContent(promptClasificacion);
                let nuevoEstado = result.response.text().trim();
                const estadosValidos = ['Contactado', 'En Negociación', 'Cliente Cerrado', 'No Interesado'];
                if (estadosValidos.includes(nuevoEstado) && nuevoEstado !== prospecto.estado) {
                    await supabase.from('prospectos').update({ estado: nuevoEstado }).eq('id', prospecto.id);
                    io.emit('estado_actualizado', { id: prospecto.id, nuevoEstado: nuevoEstado });
                }
            } catch (iaError) {}
        }
    } catch (err) { console.error(err.message); }

    io.emit(`nuevo_mensaje_${userId}`, { numero: numeroLimpio, body: msg.body });
}

// ==========================================
// 🔒 SISTEMA DE SEGURIDAD
// ==========================================
app.post('/api/login', async (req, res) => {
    try {
        const { usuario, password } = req.body;
        const { data, error } = await supabase.from('usuarios').select('*').eq('usuario', usuario).single();
        if (error || !data) return res.status(401).json({ success: false, error: 'Usuario no encontrado' });

        if (data.password === password) {
            const token = jwt.sign({ id: data.id, usuario: data.usuario, rol: data.rol }, process.env.JWT_SECRET, { expiresIn: '12h' });
            iniciarWhatsAppParaUsuario(data.id);
            res.json({ success: true, token, rol: data.rol, id: data.id });
        } else {
            res.status(401).json({ success: false, error: 'Contraseña incorrecta' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: 'Error del servidor' });
    }
});

function verificarToken(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: 'Acceso denegado.' });
    jwt.verify(token.replace('Bearer ', ''), process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Sesión expirada.' });
        req.user = user; 
        next(); 
    });
}

function soloAdmin(req, res, next) {
    if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Prohibido. Solo administradores.' });
    next();
}

// ==========================================
// 👥 MÓDULO DE GESTIÓN DE USUARIOS
// ==========================================
// 🛡️ CORRECCIÓN: Ruta segura y silenciosa para verificación de números
app.get('/api/verificar-numero/:numero', verificarToken, async (req, res) => {
    try {
        const numeroOriginal = req.params.numero;
        if (numeroOriginal.includes('@lid')) return res.json({ valido: true }); 
        const numeroLimpio = numeroOriginal.replace(/\D/g, '');
        if (!numeroLimpio) return res.json({ valido: false });
        
        // Respondemos un JSON normal para que el navegador no pinte errores rojos en consola
        const status = waStatuses.get(req.user.id);
        if (status !== 'Conectado') return res.json({ esperando: true });

        const client = waClients.get(req.user.id);
        if (!client) return res.json({ esperando: true });

        const contactoValido = await client.getNumberId(numeroLimpio);
        res.json({ valido: !!contactoValido }); 
    } catch (error) { res.json({ valido: false }); }
});

app.post('/api/usuarios', verificarToken, soloAdmin, async (req, res) => {
    const { usuario, password, rol } = req.body;
    const { data, error } = await supabase.from('usuarios').insert([{ usuario, password, rol }]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, data });
});

app.put('/api/usuarios/:id', verificarToken, soloAdmin, async (req, res) => {
    const { id } = req.params;
    const { usuario, password, rol } = req.body;
    let updateData = { usuario, rol };
    if (password) updateData.password = password; 
    const { error } = await supabase.from('usuarios').update(updateData).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

app.delete('/api/usuarios/:id', verificarToken, soloAdmin, async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase.from('usuarios').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// ==========================================
// 📡 RUTAS PROTEGIDAS (CON FILTROS DE ROL)
// ==========================================
app.get('/api/prospectos', verificarToken, async (req, res) => {
    try {
        let query = supabase.from('prospectos').select('*, usuarios!vendedor_id(usuario)').order('creado_en', { ascending: false });
        
        if (req.user.rol !== 'admin') {
            query = query.eq('vendedor_id', req.user.id);
        }
        
        const { data, error } = await query;
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
            'Estado': p.estado,
            'Vendedor': (p.usuarios && p.usuarios.usuario) ? p.usuarios.usuario : 'Sin asignar', 
            'vendedor_id': p.vendedor_id
        }));
        res.json(prospectosAdaptados);
    } catch (error) { res.status(500).json({ error: 'Error cargando datos' }); }
});

app.post('/api/actualizar-estado', verificarToken, async (req, res) => {
    try {
        const { id, estado } = req.body; 
        const { error } = await supabase.from('prospectos').update({ estado: estado }).eq('id', id);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error interno' }); }
});

app.get('/api/mensajes/:prospecto_id', verificarToken, async (req, res) => {
    try {
        const { data, error } = await supabase.from('mensajes').select('*').eq('prospecto_id', req.params.prospecto_id).order('creado_en', { ascending: true });
        if (error) throw error;
        res.json(data);
    } catch (error) { res.status(500).json({ error: 'Error cargando historial' }); }
});

// 🛡️ CORRECCIÓN: Ruta segura para verificación de números
app.get('/api/verificar-numero/:numero', verificarToken, async (req, res) => {
    try {
        const numeroOriginal = req.params.numero;
        if (numeroOriginal.includes('@lid')) return res.json({ valido: true }); 
        const numeroLimpio = numeroOriginal.replace(/\D/g, '');
        if (!numeroLimpio) return res.json({ valido: false });
        
        // Si no está conectado 100%, le decimos a la UI que espere, no crasheamos el server
        const status = waStatuses.get(req.user.id);
        if (status !== 'Conectado') return res.status(503).json({ error: 'Iniciando WA' });

        const client = waClients.get(req.user.id);
        if (!client) return res.status(503).json({ error: 'Iniciando WA' });

        const contactoValido = await client.getNumberId(numeroLimpio);
        res.json({ valido: !!contactoValido }); 
    } catch (error) { res.json({ valido: false }); }
});

app.post('/api/generar-prospectos', verificarToken, async (req, res) => {
    try {
        const { nicho, ciudad } = req.body;
        const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' }); 
        const prompt = `Busca 3 negocios B2B en ${nicho} en ${ciudad}. Devuelve JSON estricto: [{"nombre_empresa": "X", "nicho": "${nicho}", "contacto": "+5730000", "correo": "N/A", "direccion": "X", "observaciones": "X", "mensaje_acercamiento": "Hola", "estado": "Nuevo"}]`;
        const result = await model.generateContent(prompt);
        const nuevosProspectos = JSON.parse(result.response.text().replace(/```json/g, '').replace(/```/g, '').trim());

        nuevosProspectos.forEach(p => p.vendedor_id = req.user.id);

        const { error } = await supabase.from('prospectos').insert(nuevosProspectos);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/sugerir-respuesta', verificarToken, async (req, res) => {
    try {
        const { prospecto_id } = req.body;
        const { data: historial, error } = await supabase.from('mensajes').select('mensaje, tipo').eq('prospecto_id', prospecto_id).order('creado_en', { ascending: true }).limit(10);
        if (error) throw error;
        if (!historial || historial.length === 0) return res.json({ sugerencia: "¡Hola! ¿En qué podemos ayudarte?" });

        const chatContext = historial.map(m => m.tipo === 'in' ? `Cliente: ${m.mensaje}` : `Vendedor: ${m.mensaje}`).join('\n');
        const model = genAI.getGenerativeModel({ model: 'gemini-3.8-flash' }); 
        const prompt = `Eres experto en ventas. Lee este chat:\n\n${chatContext}\n\nEscribe la próxima respuesta. Solo texto.`;
        const result = await model.generateContent(prompt);
        res.json({ sugerencia: result.response.text().trim() });
    } catch (error) { res.status(500).json({ error: 'Fallo al conectar con IA.' }); }
});

app.delete('/api/prospectos/:id', verificarToken, async (req, res) => {
    try {
        if (req.user.rol !== 'admin') {
            return res.status(403).json({ error: 'No tienes permisos para eliminar prospectos.' });
        }
        const { id } = req.params;
        await supabase.from('mensajes').delete().eq('prospecto_id', id);
        const { error } = await supabase.from('prospectos').delete().eq('id', id);
        if (error) throw error;
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error interno.' }); }
});

io.on('connection', (socket) => {
    socket.on('registrar_usuario', (userId) => {
        socket.join(`sala_${userId}`); 
        iniciarWhatsAppParaUsuario(userId, socket); 
    });

    socket.on('enviar_mensaje', async (data) => {
        try {
            const client = waClients.get(data.userId);
            if (!client) return socket.emit('mensaje_enviado', { status: 'error', error: 'Tu WhatsApp no está conectado.' });

            let chatId;
            if (data.numero.includes('@lid')) {
                chatId = data.numero; 
            } else {
                const numeroLimpio = data.numero.replace(/\D/g, ''); 
                const contactoValido = await client.getNumberId(numeroLimpio);
                if (!contactoValido) return socket.emit('mensaje_enviado', { status: 'error', error: 'El número no tiene WhatsApp.' });
                chatId = contactoValido._serialized;
            }
            
            await client.sendMessage(chatId, data.mensaje);
            
            if (data.prospecto_id) {
                await supabase.from('mensajes').insert([{
                    prospecto_id: data.prospecto_id,
                    mensaje: data.mensaje,
                    tipo: 'out'
                }]);
            }
            socket.emit('mensaje_enviado', { status: 'ok', mensaje: data.mensaje, numero: data.numero });
        } catch (error) { socket.emit('mensaje_enviado', { status: 'error', error: 'Error interno.' }); }
    });
});

server.listen(PORT, () => console.log(`CRM en la Nube corriendo en http://localhost:${PORT}`));