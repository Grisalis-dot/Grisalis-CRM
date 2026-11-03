require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const db = require('./db');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Modelos en orden de preferencia; se puede sobreescribir con GEMINI_MODELS="modelo1,modelo2" en .env
const MODELOS_IA = (process.env.GEMINI_MODELS || 'gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite')
    .split(',').map(m => m.trim()).filter(Boolean);

// Reintenta ante saturación (503/429/500) y pasa al siguiente modelo si el actual sigue fallando.
async function generarConIA(prompt) {
    let ultimoError;
    let primerError;
    for (const nombre of MODELOS_IA) {
        const model = genAI.getGenerativeModel({ model: nombre });
        for (let intento = 0; intento < 3; intento++) {
            try {
                const result = await model.generateContent(prompt);
                return result.response.text();
            } catch (err) {
                ultimoError = err;
                if (!primerError) primerError = err;
                // 429 = cuota agotada: reintentar no sirve, pasamos al siguiente modelo
                if (err.status === 429 || /\b429\b/.test(err.message || '')) break;
                const temporal = [500, 502, 503, 504].includes(err.status) || /\b(500|502|503|504)\b/.test(err.message || '');
                if (!temporal) {
                    if (/\b404\b/.test(err.message || '')) break; // el modelo no existe: probar el siguiente
                    throw err;
                }
                if (intento < 2) await new Promise(r => setTimeout(r, 1500 * (intento + 1)));
            }
        }
        console.warn(`Modelo ${nombre} no disponible (${(ultimoError.message || '').slice(-90)}), probando el siguiente...`);
    }
    throw primerError || ultimoError;
}
db.cargar();
db.sincronizarDesdeSheet()
    .then(r => console.log(`Google Sheet sincronizado: ${r.importados} prospectos nuevos`))
    .catch(e => console.error('No se pudo leer el Google Sheet:', e.message));

// Errores internos de puppeteer/whatsapp-web.js (p. ej. al cerrar sesión) no deben tumbar el servidor
process.on('unhandledRejection', (err) => console.error('Rechazo no controlado:', err && err.message ? err.message : err));
process.on('uncaughtException', (err) => console.error('Excepción no controlada:', err && err.message ? err.message : err));

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({
    verify: (req, res, buffer) => {
        if (req.path === '/webhooks/meta') req.rawBody = Buffer.from(buffer);
    }
}));
app.use(express.static(path.join(__dirname, '../frontend')));

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';
const META_API_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const META_INSTAGRAM_API_BASE = process.env.META_INSTAGRAM_API_BASE || META_API_BASE;

function canalMeta(canal) {
    const valor = String(canal || '').trim().toLowerCase();
    if (valor === 'instagram') return 'Instagram';
    if (valor === 'facebook') return 'Facebook';
    return 'WhatsApp';
}

function verificarFirmaMeta(req) {
    const appSecret = process.env.META_APP_SECRET;
    const firma = req.get('x-hub-signature-256');
    if (!appSecret || !firma || !req.rawBody) return false;
    const esperada = `sha256=${crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex')}`;
    const actualBuffer = Buffer.from(firma);
    const esperadaBuffer = Buffer.from(esperada);
    return actualBuffer.length === esperadaBuffer.length && crypto.timingSafeEqual(actualBuffer, esperadaBuffer);
}

function prospectoPorCuentaSocial(canal, recipientId, accountId) {
    return db.prospectos.listar().find(p =>
        canalMeta(p.canal) === canal &&
        p.social_recipient_id === recipientId &&
        p.social_account_id === accountId
    );
}

async function procesarWebhookMeta(payload) {
    for (const entry of payload.entry || []) {
        for (const evento of entry.messaging || []) {
            const mensaje = evento.message;
            if (!mensaje || mensaje.is_echo || !evento.sender?.id || !evento.recipient?.id) continue;

            const canal = payload.object === 'instagram' ? 'Instagram' : 'Facebook';
            const recipientId = String(evento.sender.id);
            const accountId = String(evento.recipient.id);
            const body = mensaje.text || (mensaje.attachments?.length ? '[Mensaje con archivo adjunto]' : '');
            if (!body) continue;

            let prospecto = prospectoPorCuentaSocial(canal, recipientId, accountId);
            if (!prospecto) {
                const usuarios = db.usuarios.listar();
                const admin = usuarios.find(u => u.rol === 'admin');
                if (!admin) throw new Error('No hay usuario administrador para asignar el lead social');
                [prospecto] = db.prospectos.crear([{
                    vendedor_id: admin.id,
                    nombre_empresa: `${canal} ${recipientId}`,
                    nicho: 'Lead entrante',
                    contacto: recipientId,
                    canal,
                    social_recipient_id: recipientId,
                    social_account_id: accountId,
                    estado: 'Nuevo'
                }]);
                io.to(`sala_${admin.id}`).emit(`recargar_prospectos_${admin.id}`);
            }

            if (mensaje.mid && db.mensajes.existeProviderId(mensaje.mid)) continue;
            db.mensajes.crear({
                prospecto_id: prospecto.id,
                mensaje: body,
                tipo: 'in',
                canal,
                provider_id: mensaje.mid,
                creado_en: evento.timestamp ? new Date(evento.timestamp).toISOString() : undefined
            });
            io.to(`sala_${prospecto.vendedor_id}`).emit(`nuevo_mensaje_${prospecto.vendedor_id}`, {
                numero: recipientId,
                body,
                prospecto_id: prospecto.id,
                canal
            });
        }
    }
}

app.get('/webhooks/meta', (req, res) => {
    const verifyToken = process.env.META_VERIFY_TOKEN;
    if (!verifyToken) return res.status(503).send('Webhook Meta no configurado');
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && token === verifyToken && challenge) return res.status(200).send(challenge);
    return res.sendStatus(403);
});

app.post('/webhooks/meta', async (req, res) => {
    if (!verificarFirmaMeta(req)) return res.sendStatus(401);
    try {
        await procesarWebhookMeta(req.body);
        res.sendStatus(200);
    } catch (error) {
        console.error('Error procesando webhook de Meta:', error.message);
        res.sendStatus(500);
    }
});

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
        // Sesión cerrada desde el celular: reiniciamos para generar un QR nuevo
        if (reason === 'LOGOUT') {
            setTimeout(() => iniciarWhatsAppParaUsuario(userId), 3000);
        }
    });

    client.on('message', async msg => {
        procesarMensajeEntrante(msg, userId, client);
    });

    client.initialize().catch(err => {
        console.error(`No se pudo iniciar WhatsApp para ${userId}:`, err.message);
        waClients.delete(userId);
        waStatuses.set(userId, 'Error iniciando WhatsApp');
        io.emit(`wa_status_${userId}`, 'Error iniciando WhatsApp');
    });
    waClients.set(userId, client);
    return client;
}

// Trae los últimos mensajes del chat desde WhatsApp (incluye lo escrito desde el celular) y los guarda localmente.
async function sincronizarHistorialWhatsApp(userId, prospecto) {
    const client = waClients.get(userId);
    if (!client || waStatuses.get(userId) !== 'Conectado') return 0;
    try {
        const numero = prospecto.contacto || '';
        let chatId = numero;
        if (!numero.includes('@lid')) {
            const digitos = numero.replace(/\D/g, '');
            if (!digitos) return 0;
            const valido = await client.getNumberId(digitos);
            if (!valido) return 0;
            chatId = valido._serialized;
        }
        const chat = await client.getChatById(chatId);
        const msgs = await chat.fetchMessages({ limit: 200 });
        const lista = msgs
            .filter(m => m.body && m.type === 'chat')
            .map(m => ({
                wa_id: m.id._serialized,
                mensaje: m.body,
                tipo: m.fromMe ? 'out' : 'in',
                creado_en: new Date(m.timestamp * 1000).toISOString()
            }));
        return db.mensajes.importar(prospecto.id, lista);
    } catch (e) {
        console.error('No se pudo sincronizar el historial:', e.message);
        return 0;
    }
}

async function procesarMensajeEntrante(msg, userId, client) {
    const contact = await msg.getContact();
    let numeroLimpio = contact.number || msg.from.replace('@c.us', '');
    
    if (creandoProspectos.has(numeroLimpio)) {
        await new Promise(resolve => setTimeout(resolve, 1500)); 
    }

    try {
        const prospectos = db.prospectos.listar(userId);

        let prospecto = prospectos.find(p => {
            const telLimpiado = (p.contacto || '').replace(/\D/g, ''); 
            const incomingLimpiado = numeroLimpio.replace(/\D/g, '');
            return telLimpiado === incomingLimpiado || p.contacto === numeroLimpio;
        });
        
        if (!prospecto) {
            creandoProspectos.add(numeroLimpio);
            try {
                [prospecto] = db.prospectos.crear([{
                    vendedor_id: userId, 
                    nombre_empresa: 'Lead Entrante',
                    nicho: 'Sin definir',
                    contacto: numeroLimpio, 
                    estado: 'Nuevo',
                    canal: 'WhatsApp'
                }]);
            } finally {
                creandoProspectos.delete(numeroLimpio);
            }
            io.emit(`recargar_prospectos_${userId}`); 
        }

        if (prospecto && prospecto.id) {
            db.mensajes.importar(prospecto.id, [{
                wa_id: msg.id._serialized,
                mensaje: msg.body,
                tipo: 'in',
                creado_en: new Date(msg.timestamp * 1000).toISOString()
            }]);

            try {
                const promptClasificacion = `Eres experto en ventas. Cliente dice: "${msg.body}". Clasifica en UNA opción: "Contactado", "En Negociación", "Cliente Cerrado", "No Interesado", "MANTENER". Devuelve SOLO la opción.`;
                let nuevoEstado = (await generarConIA(promptClasificacion)).trim();
                const estadosValidos = ['Contactado', 'En Negociación', 'Cliente Cerrado', 'No Interesado'];
                if (estadosValidos.includes(nuevoEstado) && nuevoEstado !== prospecto.estado) {
                    db.prospectos.actualizar(prospecto.id, { estado: nuevoEstado });
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
        const data = db.usuarios.porNombre(usuario);
        if (!data) return res.status(401).json({ success: false, error: 'Usuario no encontrado' });

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
    try {
        const data = db.usuarios.crear({ usuario, password, rol });
        res.json({ success: true, data });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/usuarios/:id', verificarToken, soloAdmin, async (req, res) => {
    const { id } = req.params;
    const { usuario, password, rol } = req.body;
    let updateData = { usuario, rol };
    if (password) updateData.password = password; 
    try {
        db.usuarios.actualizar(id, updateData);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/usuarios/:id', verificarToken, soloAdmin, async (req, res) => {
    const { id } = req.params;
    db.usuarios.eliminar(id);
    res.json({ success: true });
});

// ==========================================
// 📡 RUTAS PROTEGIDAS (CON FILTROS DE ROL)
// ==========================================
app.get('/api/prospectos', verificarToken, async (req, res) => {
    try {
        const data = db.prospectos.listar(req.user.rol === 'admin' ? null : req.user.id);
        
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
            'Canal': canalMeta(p.canal),
            'Vendedor': p.vendedor || 'Sin asignar', 
            'vendedor_id': p.vendedor_id,
            canal: canalMeta(p.canal),
            social_recipient_id: p.social_recipient_id,
            social_account_id: p.social_account_id
        }));
        res.json(prospectosAdaptados);
    } catch (error) { res.status(500).json({ error: 'Error cargando datos' }); }
});

app.post('/api/actualizar-estado', verificarToken, async (req, res) => {
    try {
        const { id, estado } = req.body; 
        db.prospectos.actualizar(id, { estado });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Error interno' }); }
});

app.get('/api/mensajes/:prospecto_id', verificarToken, async (req, res) => {
    try {
        const prospecto = db.prospectos.listar(req.user.rol === 'admin' ? null : req.user.id)
            .find(p => p.id === req.params.prospecto_id);
        if (!prospecto) return res.status(404).json({ error: 'Prospecto no encontrado' });
        if (canalMeta(prospecto.canal) === 'WhatsApp') {
            await sincronizarHistorialWhatsApp(req.user.id, prospecto);
        }
        res.json(db.mensajes.listar(prospecto.id));
    } catch (error) { res.status(500).json({ error: 'Error cargando historial' }); }
});

app.post('/api/mensajes/:prospecto_id', verificarToken, async (req, res) => {
    try {
        const prospecto = db.prospectos.listar(req.user.rol === 'admin' ? null : req.user.id)
            .find(p => p.id === req.params.prospecto_id);
        if (!prospecto) return res.status(404).json({ error: 'Prospecto no encontrado' });
        const canal = canalMeta(prospecto.canal);
        if (!['Instagram', 'Facebook'].includes(canal)) {
            return res.status(400).json({ error: 'Este endpoint solo envía mensajes de Meta' });
        }
        const mensaje = typeof req.body.mensaje === 'string' ? req.body.mensaje.trim() : '';
        if (!mensaje) return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
        if (!prospecto.social_recipient_id || !prospecto.social_account_id) {
            return res.status(400).json({ error: 'Este contacto no tiene una conversación de Meta vinculada' });
        }

        const token = canal === 'Instagram'
            ? process.env.META_INSTAGRAM_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN
            : process.env.META_PAGE_ACCESS_TOKEN;
        if (!token) return res.status(503).json({ error: `Falta configurar el token de Meta para ${canal}` });

        const apiBase = canal === 'Instagram' ? META_INSTAGRAM_API_BASE : META_API_BASE;
        const respuesta = await axios.post(
            `${apiBase}/${encodeURIComponent(prospecto.social_account_id)}/messages`,
            {
                recipient: { id: prospecto.social_recipient_id },
                message: { text: mensaje },
                ...(canal === 'Facebook' ? { messaging_type: 'RESPONSE' } : {})
            },
            { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
        );
        const guardado = db.mensajes.crear({
            prospecto_id: prospecto.id,
            mensaje,
            tipo: 'out',
            canal,
            provider_id: respuesta.data && respuesta.data.message_id
        });
        res.json({ success: true, data: guardado });
    } catch (error) {
        const detalle = error.response?.data?.error?.message || error.message;
        console.error('Error enviando mensaje por Meta:', detalle);
        res.status(error.response?.status && error.response.status < 500 ? 400 : 502)
            .json({ error: `Meta no pudo enviar el mensaje: ${detalle}` });
    }
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
        const { nicho, ciudad, canal = 'WhatsApp' } = req.body;
        const prompt = `Busca 3 negocios B2B en ${nicho} en ${ciudad}. Devuelve JSON estricto: [{"nombre_empresa": "X", "nicho": "${nicho}", "contacto": "+5730000", "correo": "N/A", "direccion": "X", "observaciones": "X", "mensaje_acercamiento": "Hola", "estado": "Nuevo"}]`;
        const texto = await generarConIA(prompt);
        const nuevosProspectos = JSON.parse(texto.replace(/```json/g, '').replace(/```/g, '').trim());

        nuevosProspectos.forEach(p => {
            p.vendedor_id = req.user.id;
            p.canal = canal;
        });

        db.prospectos.crear(nuevosProspectos);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/sugerir-respuesta', verificarToken, async (req, res) => {
    try {
        const { prospecto_id } = req.body;
        const historial = db.mensajes.listar(prospecto_id, 10);
        if (!historial || historial.length === 0) return res.json({ sugerencia: "¡Hola! ¿En qué podemos ayudarte?" });

        const chatContext = historial.map(m => m.tipo === 'in' ? `Cliente: ${m.mensaje}` : `Vendedor: ${m.mensaje}`).join('\n');
        const prompt = `Eres experto en ventas. Lee este chat:\n\n${chatContext}\n\nEscribe la próxima respuesta. Solo texto.`;
        res.json({ sugerencia: (await generarConIA(prompt)).trim() });
    } catch (error) { res.status(500).json({ error: 'Fallo al conectar con IA.' }); }
});

app.delete('/api/prospectos/:id', verificarToken, async (req, res) => {
    try {
        if (req.user.rol !== 'admin') {
            return res.status(403).json({ error: 'No tienes permisos para eliminar prospectos.' });
        }
        const { id } = req.params;
        db.prospectos.eliminar(id);
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
            
            const enviado = await client.sendMessage(chatId, data.mensaje);
            
            if (data.prospecto_id) {
                db.mensajes.crear({
                    prospecto_id: data.prospecto_id,
                    mensaje: data.mensaje,
                    tipo: 'out',
                    wa_id: enviado && enviado.id ? enviado.id._serialized : undefined
                });
            }
            socket.emit('mensaje_enviado', { status: 'ok', mensaje: data.mensaje, numero: data.numero });
        } catch (error) { socket.emit('mensaje_enviado', { status: 'error', error: 'Error interno.' }); }
    });
});

server.listen(PORT, () => console.log(`CRM en la Nube corriendo en http://localhost:${PORT}`));