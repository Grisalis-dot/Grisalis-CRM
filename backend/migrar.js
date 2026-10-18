require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const xlsx = require('xlsx');
const path = require('path');

// 1. CONFIGURA TUS LLAVES DE SUPABASE (Cópialas de Project Settings > API)
const supabaseUrl = 'https://yjjscrhryndxpwkjkyhb.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqanNjcmhyeW5keHB3a2preWhiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIyODY3MzUsImV4cCI6MjEwNzg2MjczNX0.WFI7IVDIo13YPdr73dIvEJd_IKC8Fe_D9WI5WYZiC2c';
const supabase = createClient(supabaseUrl, supabaseKey);

const excelPath = path.join(__dirname, '../data/Prospectos_Grisalis_Technologies_Actualizado.xlsx');

async function migrarDatos() {
    console.log('Leyendo Excel local...');
    const workbook = xlsx.readFile(excelPath);
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

    console.log(`Se encontraron ${data.length} prospectos. Subiendo a Supabase...`);

    // Formateamos los datos para que coincidan con las columnas de PostgreSQL
    const prospectosFormateados = data.map(p => ({
        nombre_empresa: p['Nombre empresa'] || 'Sin nombre',
        nicho: p['Nicho'] || '',
        contacto: p['Contacto (Tel / WhatsApp)'] || '',
        correo: p['Correo'] || '',
        direccion: p['Dirección'] || '',
        observaciones: p['Observaciones'] || '',
        mensaje_acercamiento: p['Mensaje de Acercamiento'] || '',
        estado: p['Estado'] || 'Nuevo'
    }));

    const { error } = await supabase.from('prospectos').insert(prospectosFormateados);

    if (error) {
        console.error('❌ Error al migrar:', error.message);
    } else {
        console.log('✅ ¡Migración exitosa! Todos tus prospectos están en la nube.');
    }
}

migrarDatos();