const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const xlsx = require('xlsx');

const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

let db = { usuarios: [], prospectos: [], mensajes: [] };

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function guardar() {
    fs.mkdirSync(DB_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
}

function cargar() {
    if (fs.existsSync(DB_FILE)) {
        db = { usuarios: [], prospectos: [], mensajes: [], ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
    }
    if (!db.usuarios.some(u => u.rol === 'admin')) {
        db.usuarios.push({ id: uuid(), usuario: 'admin', password: 'admin123', rol: 'admin', creado_en: now() });
        console.log('Usuario inicial creado -> admin / admin123 (cámbialo desde el panel)');
    }
    guardar();
}

// Descarga la hoja de Google Drive (debe estar compartida "cualquiera con el enlace") e importa filas nuevas.
async function sincronizarDesdeSheet() {
    const id = process.env.GOOGLE_SHEET_ID;
    if (!id) return { importados: 0 };
    const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    const wb = xlsx.read(resp.data, { type: 'buffer' });
    const filas = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    const admin = db.usuarios.find(u => u.rol === 'admin');
    const digitos = s => String(s || '').replace(/\D/g, '');
    const existentes = new Set(db.prospectos.map(p => `${(p.nombre_empresa || '').toLowerCase()}|${digitos(p.contacto)}`));

    let importados = 0;
    for (const f of filas) {
        const nombre = f['Nombre empresa'] || 'Sin nombre';
        const contacto = String(f['Contacto (Tel / WhatsApp)'] || '');
        const clave = `${nombre.toLowerCase()}|${digitos(contacto)}`;
        if (existentes.has(clave)) continue;
        existentes.add(clave);
        const canal = String(f['Canal'] || f['Red social'] || 'WhatsApp').trim() || 'WhatsApp';
        db.prospectos.push({
            id: uuid(),
            vendedor_id: admin.id,
            nombre_empresa: nombre,
            nicho: f['Nicho'] || '',
            contacto,
            correo: f['Correo'] || '',
            direccion: f['Dirección'] || '',
            observaciones: f['Observaciones'] || '',
            mensaje_acercamiento: f['Mensaje de Acercamiento'] || '',
            estado: f['Estado'] || 'Nuevo',
            canal,
            creado_en: now()
        });
        importados++;
    }
    if (importados) guardar();
    return { importados };
}

const usuarios = {
    porNombre: nombre => db.usuarios.find(u => u.usuario === nombre) || null,
    listar: () => db.usuarios.map(({ password, ...usuario }) => usuario),
    crear({ usuario, password, rol }) {
        if (!usuario || !password) throw new Error('Usuario y contraseña requeridos');
        if (db.usuarios.some(u => u.usuario === usuario)) throw new Error('El usuario ya existe');
        const u = { id: uuid(), usuario, password, rol: rol || 'vendedor', creado_en: now() };
        db.usuarios.push(u);
        guardar();
        return u;
    },
    actualizar(id, datos) {
        const u = db.usuarios.find(x => x.id === id);
        if (!u) throw new Error('Usuario no encontrado');
        Object.assign(u, datos);
        guardar();
    },
    eliminar(id) {
        db.usuarios = db.usuarios.filter(u => u.id !== id);
        guardar();
    }
};

const prospectos = {
    listar(vendedorId = null) {
        return db.prospectos
            .filter(p => !vendedorId || p.vendedor_id === vendedorId)
            .sort((a, b) => (b.creado_en || '').localeCompare(a.creado_en || ''))
            .map(p => ({ ...p, vendedor: (db.usuarios.find(u => u.id === p.vendedor_id) || {}).usuario || null }));
    },
    crear(lista) {
        const creados = lista.map(p => ({ estado: 'Nuevo', canal: 'WhatsApp', ...p, id: uuid(), creado_en: now(), canal: String(p.canal || p['Canal'] || 'WhatsApp').trim() || 'WhatsApp' }));
        db.prospectos.push(...creados);
        guardar();
        return creados;
    },
    actualizar(id, datos) {
        const p = db.prospectos.find(x => x.id === id);
        if (p) { Object.assign(p, datos); guardar(); }
    },
    eliminar(id) {
        db.prospectos = db.prospectos.filter(p => p.id !== id);
        db.mensajes = db.mensajes.filter(m => m.prospecto_id !== id);
        guardar();
    }
};

const mensajes = {
    listar(prospectoId, limite = null) {
        const lista = db.mensajes
            .filter(m => m.prospecto_id === prospectoId)
            .sort((a, b) => a.creado_en.localeCompare(b.creado_en));
        return limite ? lista.slice(-limite) : lista;
    },
    crear(m) {
        const nuevo = { ...m, id: uuid(), creado_en: m.creado_en || now() };
        db.mensajes.push(nuevo);
        guardar();
        return nuevo;
    },
    existeProviderId(providerId) {
        return db.mensajes.some(m => m.provider_id === providerId);
    },
    // Importa mensajes del historial de WhatsApp sin duplicar los ya guardados.
    importar(prospectoId, lista) {
        const propios = db.mensajes.filter(m => m.prospecto_id === prospectoId);
        const vistos = new Set(propios.filter(m => m.wa_id).map(m => m.wa_id));
        let nuevos = 0;
        for (const m of lista) {
            if (vistos.has(m.wa_id)) continue;
            const t = new Date(m.creado_en).getTime();
            // Mensaje guardado antes sin wa_id (enviado/recibido desde el CRM): solo lo enlazamos
            const previo = propios.find(x => !x.wa_id && x.tipo === m.tipo && x.mensaje === m.mensaje
                && Math.abs(new Date(x.creado_en).getTime() - t) < 5 * 60 * 1000);
            if (previo) { previo.wa_id = m.wa_id; vistos.add(m.wa_id); continue; }
            db.mensajes.push({ ...m, prospecto_id: prospectoId, id: uuid() });
            vistos.add(m.wa_id);
            nuevos++;
        }
        guardar();
        return nuevos;
    }
};

module.exports = { cargar, sincronizarDesdeSheet, usuarios, prospectos, mensajes };
