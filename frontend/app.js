const socket = io();
let prospectosGlobal = [];
let prospectosFiltrados = [];
let chatActualIndex = null;
let currentPage = 1;
const rowsPerPage = 10;

socket.on('wa_status', (status) => {
    const waText = document.getElementById('wa-status');
    waText.innerText = `WhatsApp: ${status}`;
    waText.style.color = status === 'Conectado' ? 'green' : 'orange';
});

socket.on('mensaje_enviado', (data) => {
    if (data.status === 'ok') {
        agregarMensajeAlChat(data.mensaje, 'out');
        document.getElementById('chat-input').value = '';
    } else {
        alert("Error de WhatsApp: " + data.error);
    }
});

socket.on('nuevo_mensaje', (data) => {
    if (chatActualIndex !== null) {
        const numeroLimpio = prospectosGlobal[chatActualIndex]['Contacto (Tel / WhatsApp)'].replace(/\D/g, '');
        if (data.numero === numeroLimpio) {
            agregarMensajeAlChat(data.body, 'in');
        }
    }
});

async function cargarProspectos() {
    try {
        const res = await fetch('/api/prospectos');
        prospectosGlobal = await res.json();
        prospectosFiltrados = [...prospectosGlobal];
        currentPage = 1;
        pintarTabla();
    } catch (error) {
        console.error('Error cargando prospectos:', error);
    }
}

function pintarTabla() {
    const tbody = document.querySelector('#prospectos-table tbody');
    tbody.innerHTML = '';
    
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    const prospectosPagina = prospectosFiltrados.slice(startIndex, endIndex);

    if (prospectosPagina.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="padding: 10px; text-align: center;">No hay prospectos.</td></tr>';
    }

    prospectosPagina.forEach(p => {
        const globalIndex = prospectosGlobal.indexOf(p);
        const tr = document.createElement('tr');
        const numero = p['Contacto (Tel / WhatsApp)'] || '';
        const estadoActual = p['Estado'] || 'Nuevo';
        
        const opciones = ['Nuevo', 'Contactado', 'En Negociación', 'Cliente Cerrado', 'No Interesado'];
        
        let selectHTML = `<select onchange="cambiarEstado('${p.id}', ${globalIndex}, this.value)" style="padding: 6px; border-radius: 4px; border: 1px solid #ccc; cursor: pointer; background: ${estadoActual === 'Cliente Cerrado' ? '#d4edda' : 'white'};">`;
        opciones.forEach(opt => {
            selectHTML += `<option value="${opt}" ${estadoActual === opt ? 'selected' : ''}>${opt}</option>`;
        });
        selectHTML += `</select>`;

        tr.innerHTML = `
            <td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>${p['Nombre empresa']}</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #ddd;">${p['Nicho']}</td>
            <td style="padding: 10px; border-bottom: 1px solid #ddd;">${numero}</td>
            <td style="padding: 10px; border-bottom: 1px solid #ddd; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${p['Correo']}">${p['Correo'] || 'N/A'}</td>
            <td style="padding: 10px; border-bottom: 1px solid #ddd; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${p['Dirección']}">${p['Dirección'] || 'N/A'}</td>
            <td style="padding: 10px; border-bottom: 1px solid #ddd; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${p['Observaciones']}">${p['Observaciones'] || 'N/A'}</td>
            <td style="padding: 10px; border-bottom: 1px solid #ddd;">${selectHTML}</td>
            <td style="padding: 10px; border-bottom: 1px solid #ddd;">
                ${numero.includes('No disponible') || numero.trim() === '' ? 
                    '<em style="color: gray;">Sin número</em>' : 
                    `<button style="background: #25D366; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer;" onclick="abrirChat(${globalIndex})">Abrir Chat</button>`
                }
            </td>
        `;
        tbody.appendChild(tr);
    });

    actualizarControlesPaginacion();
}

function cambiarPagina(direccion) {
    currentPage += direccion;
    pintarTabla();
}

function actualizarControlesPaginacion() {
    const totalPages = Math.ceil(prospectosFiltrados.length / rowsPerPage) || 1;
    document.getElementById('page-info').innerText = `Página ${currentPage} de ${totalPages} (${prospectosFiltrados.length} prospectos)`;
    document.getElementById('btn-prev').disabled = currentPage === 1;
    document.getElementById('btn-next').disabled = currentPage === totalPages;
    document.getElementById('btn-prev').style.opacity = currentPage === 1 ? '0.5' : '1';
    document.getElementById('btn-next').style.opacity = currentPage === totalPages ? '0.5' : '1';
}

function filtrarTabla() {
    const textoBusqueda = document.getElementById('buscador').value.toLowerCase();
    prospectosFiltrados = prospectosGlobal.filter(p => {
        const contenido = `${p['Nombre empresa']} ${p['Nicho']} ${p['Contacto (Tel / WhatsApp)']} ${p['Correo']} ${p['Dirección']} ${p['Observaciones']}`.toLowerCase();
        return contenido.includes(textoBusqueda);
    });
    currentPage = 1;
    pintarTabla();
}

async function cambiarEstado(id, index, nuevoEstado) {
    try {
        await fetch('/api/actualizar-estado', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id, estado: nuevoEstado })
        });
        prospectosGlobal[index]['Estado'] = nuevoEstado;
        pintarTabla(); 
    } catch (error) {
        alert("Error al guardar el estado en el servidor.");
    }
}

async function generarConIA() {
    const nicho = document.getElementById('ia-nicho').value;
    const ciudad = document.getElementById('ia-ciudad').value;
    const btn = document.getElementById('btn-ia');

    if (!nicho || !ciudad) return alert("Por favor escribe un nicho y una ciudad.");

    btn.innerText = "Buscando e integrando... (Espera)";
    btn.disabled = true;

    try {
        const respuesta = await fetch('/api/generar-prospectos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nicho, ciudad })
        });
        
        const data = await respuesta.json();
        if (data.success) {
            alert("¡IA finalizada! Se agregaron nuevos prospectos a la base de datos.");
            cargarProspectos(); 
        } else {
            alert("Error: " + data.error);
        }
    } catch (error) {
        alert("Error de conexión con el servidor.");
    } finally {
        btn.innerText = "Buscar y Agregar";
        btn.disabled = false;
    }
}

async function abrirChat(index) {
    chatActualIndex = index;
    const prospecto = prospectosGlobal[index];
    
    console.log("Abriendo chat para ID:", prospecto.id); // <- CHISMOSO PARA CONFIRMAR EL ID
    
    document.getElementById('chat-panel').style.display = 'flex';
    document.getElementById('chat-nombre').innerText = prospecto['Nombre empresa'];
    document.getElementById('chat-numero').innerText = prospecto['Contacto (Tel / WhatsApp)'];
    
    const messagesBox = document.getElementById('chat-messages');
    messagesBox.innerHTML = '<div style="text-align: center; color: gray; margin-top: 20px;">Cargando historial...</div>'; 
    
    document.getElementById('chat-input').value = '';

    try {
        const res = await fetch(`/api/mensajes/${prospecto.id}`);
        const historial = await res.json();
        
        messagesBox.innerHTML = ''; 
        
        if (historial.length === 0) {
            messagesBox.innerHTML = '<div style="text-align: center; color: gray; font-size: 12px; margin-top: 10px;">Inicia la conversación</div>';
            document.getElementById('chat-input').value = prospecto['Mensaje de Acercamiento'] || '';
        } else {
            historial.forEach(msg => {
                agregarMensajeAlChat(msg.mensaje, msg.tipo);
            });
        }
    } catch (error) {
        console.error("Error al cargar mensajes:", error);
        messagesBox.innerHTML = '<div style="text-align: center; color: red;">Error cargando historial.</div>';
    }
}

function enviarMensaje() {
    if (chatActualIndex === null) return;
    const prospecto = prospectosGlobal[chatActualIndex];
    const mensaje = document.getElementById('chat-input').value;
    
    if (mensaje.trim() === '') return;

    socket.emit('enviar_mensaje', {
        numero: prospecto['Contacto (Tel / WhatsApp)'],
        mensaje: mensaje,
        prospecto_id: prospecto.id 
    });
}

function agregarMensajeAlChat(texto, tipo) {
    const messagesBox = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    
    msgDiv.style.maxWidth = '80%';
    msgDiv.style.padding = '10px';
    msgDiv.style.borderRadius = '8px';
    msgDiv.style.marginBottom = '10px';
    
    if (tipo === 'out') {
        msgDiv.style.background = '#dcf8c6';
        msgDiv.style.alignSelf = 'flex-end';
    } else {
        msgDiv.style.background = 'white';
        msgDiv.style.alignSelf = 'flex-start';
    }
    
    msgDiv.innerText = texto;
    messagesBox.appendChild(msgDiv);
    messagesBox.scrollTop = messagesBox.scrollHeight;
}

cargarProspectos();