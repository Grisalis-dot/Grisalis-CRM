const socket = io();
let prospectosGlobal = [];
let prospectosFiltrados = [];
let chatActualIndex = null;
let currentPage = 1;
const rowsPerPage = 10;

// Variables de sesión
let crmUserId = null;
let crmUserRole = null;
let crmUserName = null;

// ==========================================
// 🔒 SISTEMA DE LOGIN Y SESIÓN
// ==========================================
async function fetchConToken(url, opciones = {}) {
    const token = localStorage.getItem('crm_token');
    if (!opciones.headers) opciones.headers = {};
    if (token) opciones.headers['Authorization'] = `Bearer ${token}`;
    
    const response = await fetch(url, opciones);
    if (response.status === 401 || response.status === 403) {
        cerrarSesion();
        throw new Error('Sesión expirada');
    }
    return response;
}

function mostrarPantallaLogin() {
    document.querySelector('header').style.display = 'none';
    document.querySelector('main').style.display = 'none';
    
    if (!document.getElementById('login-container')) {
        const loginHTML = `
            <div id="login-container" style="display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f2f5;">
                <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); width: 100%; max-width: 400px; text-align: center;">
                    <h2 style="color: #005c4b; margin-bottom: 20px;">Grisalis CRM</h2>
                    <input type="text" id="login-user" placeholder="Usuario" style="width: 100%; padding: 12px; margin-bottom: 15px; border: 1px solid #ccc; border-radius: 5px; box-sizing: border-box;">
                    <input type="password" id="login-pass" placeholder="Contraseña" style="width: 100%; padding: 12px; margin-bottom: 20px; border: 1px solid #ccc; border-radius: 5px; box-sizing: border-box;">
                    <button onclick="iniciarSesion()" id="btn-login" style="width: 100%; padding: 12px; background: #005c4b; color: white; border: none; border-radius: 5px; font-weight: bold; cursor: pointer; font-size: 16px;">Entrar al CRM</button>
                    <p id="login-error" style="color: red; margin-top: 15px; display: none; font-size: 14px;"></p>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('afterbegin', loginHTML);
    } else {
        document.getElementById('login-container').style.display = 'flex';
    }
}

async function iniciarSesion() {
    const usuario = document.getElementById('login-user').value;
    const password = document.getElementById('login-pass').value;
    const btn = document.getElementById('btn-login');
    const errorMsg = document.getElementById('login-error');

    if (!usuario || !password) return;

    btn.innerText = "Iniciando...";
    btn.disabled = true;
    errorMsg.style.display = 'none';

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, password })
        });
        
        const data = await res.json();
        
        if (data.success) {
            // Guardamos todo en local
            localStorage.setItem('crm_token', data.token);
            localStorage.setItem('crm_user_id', data.id);
            localStorage.setItem('crm_user_role', data.rol);
            localStorage.setItem('crm_user_name', usuario);
            
            arrancarApp();
        } else {
            errorMsg.innerText = data.error || "Credenciales incorrectas";
            errorMsg.style.display = 'block';
        }
    } catch (error) {
        errorMsg.innerText = "Error de conexión al servidor";
        errorMsg.style.display = 'block';
    } finally {
        btn.innerText = "Entrar al CRM";
        btn.disabled = false;
    }
}

function cerrarSesion() {
    localStorage.clear();
    location.reload(); 
}

function arrancarApp() {
    crmUserId = localStorage.getItem('crm_user_id');
    crmUserRole = localStorage.getItem('crm_user_role');
    crmUserName = localStorage.getItem('crm_user_name');

    const loginBox = document.getElementById('login-container');
    if (loginBox) loginBox.style.display = 'none';
    document.querySelector('header').style.display = 'block';
    
    // Si es Administrador, le mostramos el botón de Usuarios
    if (crmUserRole === 'admin') {
        document.getElementById('btn-admin-panel').style.display = 'inline-block';
    }

    // Por defecto mostramos el CRM principal
    document.getElementById('crm-main').style.display = 'flex';
    document.getElementById('admin-panel').style.display = 'none';

    document.getElementById('user-name-display').innerText = `Hola, ${crmUserName}`;
    const badge = document.getElementById('user-role-badge');
    badge.innerText = crmUserRole === 'admin' ? 'Administrador' : 'Vendedor';
    badge.style.background = crmUserRole === 'admin' ? '#9c27b0' : '#25D366'; 

    configurarSocketsPrivados();
    cargarProspectos();
}

// ==========================================
// 📡 SOCKETS Y CÓDIGO QR
// ==========================================
function configurarSocketsPrivados() {
    // Le avisamos al backend que estamos en línea
    socket.emit('registrar_usuario', crmUserId);

    // Escuchamos NUESTRO estado de WhatsApp
    socket.on(`wa_status_${crmUserId}`, (status) => {
        const waText = document.getElementById('wa-status');
        const btnQR = document.getElementById('btn-show-qr');
        
        waText.innerText = `WhatsApp: ${status}`;
        
        if (status === 'Conectado') {
            waText.style.color = 'green';
            btnQR.style.display = 'none';
            cerrarModalQR(); 
        } else {
            waText.style.color = 'orange';
            btnQR.style.display = 'block'; 
        }
    });

   // Escuchamos NUESTRO código QR y lo generamos localmente sin APIs externas
    socket.on(`wa_qr_${crmUserId}`, (qrString) => {
        const qrImage = document.getElementById('qr-image');
        
        // Usamos la librería local para generar la imagen de forma segura y evitar AdBlockers
        QRCode.toDataURL(qrString, { width: 250, margin: 2 }, function (err, url) {
            if (!err) {
                qrImage.src = url;
                mostrarModalQR();
            } else {
                console.error("Error generando QR:", err);
            }
        });
    });

    // Escuchamos recargas y mensajes dirigidos a NOSOTROS
    socket.on(`recargar_prospectos_${crmUserId}`, () => { cargarProspectos(); });
    socket.on(`nuevo_mensaje_${crmUserId}`, (data) => { procesarMensajeVisual(data); });
}

function procesarMensajeVisual(data) {
    const numIncoming = data.numero;
    const prospectoIndex = prospectosGlobal.findIndex(p => {
        const telLimpiado = (p['Contacto (Tel / WhatsApp)'] || '').replace(/\D/g, '');
        return telLimpiado === numIncoming || p['Contacto (Tel / WhatsApp)'] === numIncoming;
    });

    if (prospectoIndex !== -1) {
        if (chatActualIndex === prospectoIndex) {
            agregarMensajeAlChat(data.body, 'in');
        } else {
            prospectosGlobal[prospectoIndex].mensajesNoLeidos = (prospectosGlobal[prospectoIndex].mensajesNoLeidos || 0) + 1;
            pintarTabla(); 
            mostrarNotificacion(`📩 Mensaje de ${prospectosGlobal[prospectoIndex]['Nombre empresa']}`, data.body);
        }
    } else {
        mostrarNotificacion(`📩 Mensaje de ${data.numero}`, data.body);
    }
}

socket.on('estado_actualizado', (data) => {
    const prospecto = prospectosGlobal.find(p => p.id === data.id);
    if (prospecto) {
        prospecto['Estado'] = data.nuevoEstado;
        pintarTabla(); 
    }
});

socket.on('mensaje_enviado', (data) => {
    if (data.status === 'ok') {
        agregarMensajeAlChat(data.mensaje, 'out');
        document.getElementById('chat-input').value = '';
    } else {
        alert("Error de WhatsApp: " + data.error);
    }
});

function mostrarModalQR() { document.getElementById('qr-modal').style.display = 'flex'; }
function cerrarModalQR() { document.getElementById('qr-modal').style.display = 'none'; }

// ==========================================
// 🏗️ LÓGICA DE LA TABLA Y UI
// ==========================================
async function cargarProspectos() {
    try {
        const res = await fetchConToken('/api/prospectos');
        const nuevosDatos = await res.json();
        
        nuevosDatos.forEach(nuevoP => {
            const viejoP = prospectosGlobal.find(vp => vp.id === nuevoP.id);
            if (viejoP && viejoP.mensajesNoLeidos) nuevoP.mensajesNoLeidos = viejoP.mensajesNoLeidos;
        });

        prospectosGlobal = nuevosDatos;
        prospectosFiltrados = [...prospectosGlobal];
        currentPage = 1;
        pintarTabla();
    } catch (error) { console.error('Error cargando prospectos:', error); }
}

function pintarTabla() {
    const tbody = document.querySelector('#prospectos-table tbody');
    tbody.innerHTML = '';
    
    // Si eres Admin, mostramos la columna del vendedor
    const colVendedorTh = document.getElementById('columna-vendedor');
    if (colVendedorTh) colVendedorTh.style.display = crmUserRole === 'admin' ? 'table-cell' : 'none';

    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    const prospectosPagina = prospectosFiltrados.slice(startIndex, endIndex);

    if (prospectosPagina.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${crmUserRole === 'admin' ? 9 : 8}" style="padding: 10px; text-align: center;">No hay prospectos en tu lista.</td></tr>`;
    }

    prospectosPagina.forEach(p => {
        const globalIndex = prospectosGlobal.indexOf(p);
        const tr = document.createElement('tr');
        const numero = p['Contacto (Tel / WhatsApp)'] || '';
        const estadoActual = p['Estado'] || 'Nuevo';
        
        let iconWA = '⏳';
        if (p.wa_valido === true) iconWA = '🟢';
        else if (p.wa_valido === false) iconWA = '🔴';
        else if (numero.includes('No disponible') || numero.trim() === '') {
            iconWA = '⚫'; p.wa_valido = false; 
        }

        const opciones = ['Nuevo', 'Contactado', 'En Negociación', 'Cliente Cerrado', 'No Interesado'];
        let selectHTML = `<select onchange="cambiarEstado('${p.id}', ${globalIndex}, this.value)" style="padding: 6px; border-radius: 4px; border: 1px solid #ccc; cursor: pointer; background: ${estadoActual === 'Cliente Cerrado' ? '#d4edda' : 'white'};">`;
        opciones.forEach(opt => { selectHTML += `<option value="${opt}" ${estadoActual === opt ? 'selected' : ''}>${opt}</option>`; });
        selectHTML += `</select>`;

        const noLeidos = p.mensajesNoLeidos || 0;
        let botonChatHTML = '';
        if (numero.includes('No disponible') || numero.trim() === '') {
            botonChatHTML = '<em style="color: gray; margin-right: 10px;">Sin número</em>';
        } else {
            if (noLeidos > 0) {
                botonChatHTML = `<button style="background: #25D366; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; margin-right: 5px; position: relative;" onclick="abrirChat(${globalIndex})">
                    Abrir Chat <span style="position: absolute; top: -8px; right: -8px; background: #dc3545; color: white; border-radius: 50%; padding: 2px 6px; font-size: 11px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">${noLeidos}</span>
                </button>`;
            } else {
                botonChatHTML = `<button style="background: #25D366; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer; margin-right: 5px;" onclick="abrirChat(${globalIndex})">Abrir Chat</button>`;
            }
        }

        // 🛡️ REGLA: Si es Vendedor, no mostramos el botón Eliminar
        let botonEliminarHTML = '';
        if (crmUserRole === 'admin') {
            botonEliminarHTML = `<button style="background: #dc3545; color: white; border: none; padding: 8px 12px; border-radius: 5px; cursor: pointer;" onclick="eliminarProspecto('${p.id}', ${globalIndex})">🗑️</button>`;
        }

        let columnaVendedorTr = '';
        if (crmUserRole === 'admin') {
            columnaVendedorTr = `<td style="padding: 10px; border-bottom: 1px solid #ddd; color: #9c27b0; font-weight: bold;">${p['Vendedor']}</td>`;
        }

        tr.innerHTML = `
            <td style="padding: 10px; border-bottom: 1px solid #ddd;"><strong>${p['Nombre empresa']}</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #ddd;">${p['Nicho']}</td>
            <td style="padding: 10px; border-bottom: 1px solid #ddd;">
                <span id="wa-icon-${p.id}" style="font-size: 14px; margin-right: 5px;" title="Verificando..."> ${iconWA} </span>
                ${numero}
            </td>
            <td style="padding: 10px; border-bottom: 1px solid #ddd; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p['Correo'] || 'N/A'}</td>
            <td style="padding: 10px; border-bottom: 1px solid #ddd; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p['Dirección'] || 'N/A'}</td>
            <td style="padding: 10px; border-bottom: 1px solid #ddd; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p['Observaciones'] || 'N/A'}</td>
            ${columnaVendedorTr}
            <td style="padding: 10px; border-bottom: 1px solid #ddd;">${selectHTML}</td>
            <td style="padding: 10px; border-bottom: 1px solid #ddd; white-space: nowrap;">
                ${botonChatHTML}
                ${botonEliminarHTML}
            </td>
        `;
        tbody.appendChild(tr);
    });

    actualizarControlesPaginacion();
    verificarNumerosPendientes();
}

async function verificarNumerosPendientes() {
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    const prospectosPagina = prospectosFiltrados.slice(startIndex, endIndex);

    for (const p of prospectosPagina) {
        if (p.wa_valido === undefined && p['Contacto (Tel / WhatsApp)']) {
            try {
                const numCodificado = encodeURIComponent(p['Contacto (Tel / WhatsApp)']);
                const res = await fetchConToken(`/api/verificar-numero/${numCodificado}`);
                const data = await res.json();
                p.wa_valido = data.valido; 
                const iconSpan = document.getElementById(`wa-icon-${p.id}`);
                if (iconSpan) {
                    iconSpan.innerText = data.valido ? '🟢' : '🔴';
                    iconSpan.title = data.valido ? 'Tiene WhatsApp' : 'No tiene WhatsApp';
                }
            } catch(e) {}
        }
    }
}

function cambiarPagina(direccion) { currentPage += direccion; pintarTabla(); }
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
        await fetchConToken('/api/actualizar-estado', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, estado: nuevoEstado }) });
        prospectosGlobal[index]['Estado'] = nuevoEstado;
        pintarTabla(); 
    } catch (error) { alert("Error al guardar el estado."); }
}

async function generarConIA() {
    const nicho = document.getElementById('ia-nicho').value;
    const ciudad = document.getElementById('ia-ciudad').value;
    const btn = document.getElementById('btn-ia');
    if (!nicho || !ciudad) return alert("Por favor escribe un nicho y una ciudad.");
    btn.innerText = "Buscando e integrando... (Espera)";
    btn.disabled = true;

    try {
        const res = await fetchConToken('/api/generar-prospectos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nicho, ciudad }) });
        const data = await res.json();
        if (data.success) {
            alert("¡IA finalizada! Se agregaron nuevos prospectos a tu lista.");
            cargarProspectos(); 
        } else alert("Error: " + data.error);
    } catch (error) { alert("Error de conexión."); } 
    finally { btn.innerText = "Buscar y Agregar"; btn.disabled = false; }
}

function cerrarChat() { document.getElementById('chat-panel').style.display = 'none'; chatActualIndex = null; }

async function abrirChat(index) {
    chatActualIndex = index;
    const prospecto = prospectosGlobal[index];
    prospecto.mensajesNoLeidos = 0;
    pintarTabla();
    document.getElementById('chat-panel').style.display = 'flex';
    document.getElementById('chat-nombre').innerText = prospecto['Nombre empresa'];
    document.getElementById('chat-numero').innerText = prospecto['Contacto (Tel / WhatsApp)'];
    
    const messagesBox = document.getElementById('chat-messages');
    messagesBox.innerHTML = '<div style="text-align: center; color: gray; margin-top: 20px;">Cargando historial...</div>'; 
    document.getElementById('chat-input').value = '';

    try {
        const res = await fetchConToken(`/api/mensajes/${prospecto.id}`);
        const historial = await res.json();
        messagesBox.innerHTML = ''; 
        if (historial.length === 0) {
            messagesBox.innerHTML = '<div style="text-align: center; color: gray; font-size: 12px; margin-top: 10px;">Inicia la conversación</div>';
            document.getElementById('chat-input').value = prospecto['Mensaje de Acercamiento'] || '';
        } else {
            historial.forEach(msg => agregarMensajeAlChat(msg.mensaje, msg.tipo));
        }
    } catch (error) { messagesBox.innerHTML = '<div style="text-align: center; color: red;">Error cargando historial.</div>'; }
}

function enviarMensaje() {
    if (chatActualIndex === null) return;
    const prospecto = prospectosGlobal[chatActualIndex];
    const mensaje = document.getElementById('chat-input').value;
    if (mensaje.trim() === '') return;

    socket.emit('enviar_mensaje', {
        userId: crmUserId, // Enviamos el ID del vendedor que dispara el mensaje
        numero: prospecto['Contacto (Tel / WhatsApp)'],
        mensaje: mensaje,
        prospecto_id: prospecto.id 
    });
}

function agregarMensajeAlChat(texto, tipo) {
    const messagesBox = document.getElementById('chat-messages');
    const msgDiv = document.createElement('div');
    msgDiv.style.maxWidth = '80%'; msgDiv.style.padding = '10px'; msgDiv.style.borderRadius = '8px'; msgDiv.style.marginBottom = '10px';
    if (tipo === 'out') { msgDiv.style.background = '#dcf8c6'; msgDiv.style.alignSelf = 'flex-end'; } 
    else { msgDiv.style.background = 'white'; msgDiv.style.alignSelf = 'flex-start'; }
    msgDiv.innerText = texto;
    messagesBox.appendChild(msgDiv);
    messagesBox.scrollTop = messagesBox.scrollHeight;
}

async function eliminarProspecto(id, globalIndex) {
    const confirmacion = confirm("⚠️ ¿Estás seguro de que deseas eliminar este prospecto?\n\nEsta acción también borrará todo su historial de chat y no se puede deshacer.");
    if (!confirmacion) return;
    try {
        const res = await fetchConToken(`/api/prospectos/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            prospectosGlobal.splice(globalIndex, 1);
            if (chatActualIndex === globalIndex) cerrarChat();
            filtrarTabla(); 
        } else alert("Error al intentar eliminar.");
    } catch (error) { alert("Error de conexión."); }
}

async function sugerirRespuesta() {
    if (chatActualIndex === null) return;
    const prospecto = prospectosGlobal[chatActualIndex];
    const btn = document.getElementById('btn-sugerir');
    const input = document.getElementById('chat-input');
    btn.innerText = "Pensando..."; btn.disabled = true;
    try {
        const res = await fetchConToken('/api/sugerir-respuesta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prospecto_id: prospecto.id }) });
        const data = await res.json();
        if (data.sugerencia) input.value = data.sugerencia; 
    } catch (error) { alert("Error de conexión."); } 
    finally { btn.innerText = "✨ Sugerir"; btn.disabled = false; }
}

function mostrarNotificacion(titulo, mensaje) {
    let toast = document.getElementById('toast-notif');
    if (!toast) {
        toast = document.createElement('div'); toast.id = 'toast-notif';
        toast.style.position = 'fixed'; toast.style.bottom = '20px'; toast.style.right = '20px';
        toast.style.backgroundColor = '#25D366'; toast.style.color = 'white';
        toast.style.padding = '15px 20px'; toast.style.borderRadius = '8px';
        toast.style.boxShadow = '0 4px 10px rgba(0,0,0,0.3)'; toast.style.zIndex = '9999';
        toast.style.transition = 'opacity 0.5s'; toast.style.maxWidth = '300px';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<strong style="font-size: 14px;">${titulo}</strong><br><span style="font-size: 13px;">${mensaje}</span>`;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 5000);
}
// ==========================================
// 👥 PANEL DE ADMINISTRACIÓN DE USUARIOS
// ==========================================
function toggleAdminPanel() {
    const crmView = document.getElementById('crm-main');
    const adminView = document.getElementById('admin-panel');
    const btn = document.getElementById('btn-admin-panel');
    
    if (crmView.style.display === 'none') {
        crmView.style.display = 'flex';
        adminView.style.display = 'none';
        btn.innerText = "👥 Usuarios";
        btn.style.background = "#9c27b0";
    } else {
        crmView.style.display = 'none';
        adminView.style.display = 'flex';
        btn.innerText = "🏠 Volver al CRM";
        btn.style.background = "#1a73e8";
        cargarUsuarios(); // Cargamos los datos de la tabla
    }
}

async function cargarUsuarios() {
    try {
        const res = await fetchConToken('/api/usuarios');
        const usuarios = await res.json();
        const tbody = document.querySelector('#usuarios-table tbody');
        tbody.innerHTML = '';
        
        usuarios.forEach(u => {
            // Impedimos que el Admin maestro (el primero) se borre a sí mismo por accidente
            const isMe = (u.id === crmUserId);
            
            tbody.innerHTML += `
                <tr style="border-bottom: 1px solid #ddd;">
                    <td style="padding: 10px; font-weight: bold;">${u.usuario} ${isMe ? '(Tú)' : ''}</td>
                    <td style="padding: 10px;">${u.rol === 'admin' ? '👑 Administrador' : '💼 Vendedor'}</td>
                    <td style="padding: 10px;">
                        <button onclick="editarUsuario('${u.id}', '${u.usuario}', '${u.rol}')" style="background: #ffc107; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; color: black; font-weight: bold;">✏️ Editar</button>
                        ${!isMe ? `<button onclick="eliminarUsuarioBD('${u.id}', '${u.usuario}')" style="background: #dc3545; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; margin-left: 5px;">🗑️ Borrar</button>` : ''}
                    </td>
                </tr>
            `;
        });
    } catch (e) {
        alert("Error cargando usuarios.");
    }
}

function editarUsuario(id, usuario, rol) {
    document.getElementById('admin-user-id').value = id;
    document.getElementById('admin-user-name').value = usuario;
    document.getElementById('admin-user-pass').value = ''; 
    document.getElementById('admin-user-pass').placeholder = "Dejar en blanco para no cambiar clave";
    document.getElementById('admin-user-rol').value = rol;
}

function limpiarFormularioUsuario() {
    document.getElementById('admin-user-id').value = '';
    document.getElementById('admin-user-name').value = '';
    document.getElementById('admin-user-pass').value = '';
    document.getElementById('admin-user-pass').placeholder = "Contraseña nueva";
    document.getElementById('admin-user-rol').value = 'vendedor';
}

async function guardarUsuario() {
    const id = document.getElementById('admin-user-id').value;
    const usuario = document.getElementById('admin-user-name').value.trim();
    const password = document.getElementById('admin-user-pass').value;
    const rol = document.getElementById('admin-user-rol').value;

    if (!usuario) return alert("El nombre de usuario es obligatorio.");
    if (!id && !password) return alert("Para crear un nuevo usuario, la contraseña es obligatoria.");

    const payload = { usuario, rol };
    if (password) payload.password = password;

    const url = id ? `/api/usuarios/${id}` : '/api/usuarios';
    const method = id ? 'PUT' : 'POST';

    try {
        const res = await fetchConToken(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data.success) {
            alert("✅ Usuario guardado correctamente.");
            limpiarFormularioUsuario();
            cargarUsuarios();
        } else {
            alert("Error: " + data.error);
        }
    } catch (e) {
        alert("Error de conexión con el servidor.");
    }
}

async function eliminarUsuarioBD(id, nombre) {
    const confirmacion = confirm(`⚠️ CUIDADO: ¿Estás seguro de que deseas eliminar al usuario "${nombre}"?\n\nEsto también ELIMINARÁ todos sus prospectos y su historial de chat asociado de la base de datos para siempre.`);
    if (!confirmacion) return;

    try {
        const res = await fetchConToken(`/api/usuarios/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            alert("🗑️ Usuario eliminado.");
            cargarUsuarios();
        } else {
            alert("Error al eliminar el usuario: " + data.error);
        }
    } catch(e) {
        alert("Error de conexión.");
    }
}

// ARRANQUE DEL SISTEMA
if (localStorage.getItem('crm_token')) {
    arrancarApp();
} else {
    mostrarPantallaLogin();
}