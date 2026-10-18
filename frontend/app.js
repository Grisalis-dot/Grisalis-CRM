let socket; // Declaramos el socket pero no lo encendemos hasta iniciar sesión
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
    // 🛡️ CORRECCIÓN: Ocultar la app principal de forma segura comprobando que existan
    try {
        const header = document.querySelector('header');
        if (header) header.style.display = 'none';
        
        const main = document.querySelector('main');
        if (main) main.style.display = 'none';

        const mainCrm = document.getElementById('crm-main');
        if (mainCrm) mainCrm.style.display = 'none';

        const adminPanel = document.getElementById('admin-panel');
        if (adminPanel) adminPanel.style.display = 'none';
    } catch (e) {
        console.warn("Aviso: Ocultando elementos del layout base.");
    }
    
    // Crear la pantalla de login si no existe
    if (!document.getElementById('login-container')) {
        const loginHTML = `
            <div id="login-container" style="display: flex; justify-content: center; align-items: center; min-height: 100vh; background: linear-gradient(135deg, #2a266b 0%, #100f2c 100%); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; position: fixed; top: 0; left: 0; width: 100%; z-index: 10000;">
                <style>
                    #login-container::before {
                        content: ''; position: absolute; width: 800px; height: 800px;
                        background: radial-gradient(circle, rgba(59,130,246,0.15) 0%, rgba(0,0,0,0) 60%);
                        top: -200px; left: -200px; z-index: -1;
                    }
                    #login-container::after {
                        content: ''; position: absolute; width: 600px; height: 600px;
                        background: radial-gradient(circle, rgba(156,39,176,0.1) 0%, rgba(0,0,0,0) 60%);
                        bottom: -100px; right: -100px; z-index: -1;
                    }
                    .login-card {
                        display: flex; width: 900px; max-width: 95%;
                        background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08);
                        border-radius: 20px; box-shadow: 0 25px 50px rgba(0,0,0,0.3);
                        backdrop-filter: blur(12px); overflow: hidden;
                    }
                    .login-left {
                        flex: 1; display: flex; justify-content: center; align-items: center; padding: 40px;
                        background: radial-gradient(circle at center, rgba(255,255,255,0.05) 0%, transparent 70%);
                    }
                    .login-left img { max-width: 80%; animation: float 4s ease-in-out infinite; }
                    @keyframes float {
                        0% { transform: translateY(0px); }
                        50% { transform: translateY(-15px); }
                        100% { transform: translateY(0px); }
                    }
                    .login-right { flex: 1; padding: 50px 60px; color: white; display: flex; flex-direction: column; justify-content: center; }
                    .login-logo { font-size: 26px; font-weight: 800; text-align: center; margin-bottom: 35px; display: flex; align-items: center; justify-content: center; gap: 10px; letter-spacing: 1px; }
                    .form-group { margin-bottom: 22px; }
                    .form-group label { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 8px; font-weight: 500; color: #e5e7eb; }
                    .form-group input[type="text"], .form-group input[type="password"] {
                        width: 100%; padding: 14px 15px; border: none; border-radius: 8px; background: white; color: #1f2937; font-size: 14px; box-sizing: border-box; outline: none; transition: box-shadow 0.3s;
                    }
                    .form-group input:focus { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.4); }
                    .forgot-link { color: #60a5fa; text-decoration: none; font-size: 12px; transition: color 0.3s; }
                    .forgot-link:hover { color: #93c5fd; }
                    .checkbox-group { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-bottom: 30px; color: #d1d5db; }
                    .checkbox-group input[type="checkbox"] { accent-color: #3b82f6; width: 16px; height: 16px; }
                    .btn-submit { width: 100%; padding: 15px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: background 0.3s, transform 0.1s; box-shadow: 0 4px 15px rgba(59, 130, 246, 0.3); }
                    .btn-submit:hover { background: #2563eb; }
                    .btn-submit:active { transform: scale(0.98); }
                    @media (max-width: 768px) { .login-left { display: none; } .login-right { padding: 40px 30px; } }
                </style>
                <div class="login-card">
                    <div class="login-left">
                        <img src="imag/logo.png" alt="Logo Grisalis CRM">
                    </div>
                    <div class="login-right">
                        <div class="login-logo">
                            <span style="background: white; color: #2a266b; padding: 2px 8px; border-radius: 8px;">∞</span> Grisalis CRM
                        </div>
                        <div class="form-group">
                            <label for="login-user">Usuario</label>
                            <input type="text" id="login-user" placeholder="Ej: User123!">
                        </div>
                        <div class="form-group">
                            <label for="login-pass">
                                <span>Contraseña</span>
                                <a href="#" class="forgot-link">¿Olvidaste la contraseña?</a>
                            </label>
                            <input type="password" id="login-pass" placeholder="••••••••••••">
                        </div>
                        <div class="checkbox-group">
                            <input type="checkbox" id="remember">
                            <label for="remember">Recordarme</label>
                        </div>
                        <button onclick="iniciarSesion()" id="btn-login" class="btn-submit">Sign In</button>
                        <p id="login-error" style="color: #fca5a5; margin-top: 15px; display: none; font-size: 14px; text-align: center;"></p>
                    </div>
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
    
    const header = document.querySelector('header');
    if (header) header.style.display = 'block';
    
    if (crmUserRole === 'admin') {
        const btnAdmin = document.getElementById('btn-admin-panel');
        if(btnAdmin) btnAdmin.style.display = 'inline-block';
    }

    const mainCrm = document.getElementById('crm-main');
    if(mainCrm) mainCrm.style.display = 'flex';
    
    const adminPanel = document.getElementById('admin-panel');
    if(adminPanel) adminPanel.style.display = 'none';

    const userNameDisplay = document.getElementById('user-name-display');
    if(userNameDisplay) userNameDisplay.innerText = `Hola, ${crmUserName}`;
    
    const badge = document.getElementById('user-role-badge');
    if(badge) {
        badge.innerText = crmUserRole === 'admin' ? 'Administrador' : 'Vendedor';
        badge.style.background = crmUserRole === 'admin' ? '#9c27b0' : '#25D366'; 
    }

    configurarSocketsPrivados();
    cargarProspectos();
}

// ==========================================
// 📡 SOCKETS Y CÓDIGO QR
// ==========================================
function configurarSocketsPrivados() {
    // 🛡️ CORRECCIÓN: Encendemos los websockets solo aquí, para evitar bloqueos
    if (!socket) socket = io();
    
    socket.emit('registrar_usuario', crmUserId);

    socket.on(`wa_status_${crmUserId}`, (status) => {
        const waText = document.getElementById('wa-status');
        const btnQR = document.getElementById('btn-show-qr');
        
        if(waText) waText.innerText = `WhatsApp: ${status}`;
        
        if (status === 'Conectado') {
            if(waText) waText.style.color = 'green';
            if(btnQR) btnQR.style.display = 'none';
            cerrarModalQR(); 
            verificarNumerosPendientes();
        } else {
            if(waText) waText.style.color = 'orange';
            if(btnQR) btnQR.style.display = 'block'; 
        }
    });

    socket.on(`wa_qr_${crmUserId}`, (qrString) => {
        const qrImage = document.getElementById('qr-image');
        QRCode.toDataURL(qrString, { width: 250, margin: 2 }, function (err, url) {
            if (!err) {
                if(qrImage) qrImage.src = url;
                mostrarModalQR();
            } else {
                console.error("Error generando QR:", err);
            }
        });
    });

    socket.on(`recargar_prospectos_${crmUserId}`, () => { cargarProspectos(); });
    socket.on(`nuevo_mensaje_${crmUserId}`, (data) => { procesarMensajeVisual(data); });

    socket.off('estado_actualizado');
    socket.on('estado_actualizado', (data) => {
        const prospecto = prospectosGlobal.find(p => p.id === data.id);
        if (prospecto) {
            prospecto['Estado'] = data.nuevoEstado;
            pintarTabla(); 
        }
    });

    socket.off('mensaje_enviado');
    socket.on('mensaje_enviado', (data) => {
        if (data.status === 'ok') {
            agregarMensajeAlChat(data.mensaje, 'out');
            const chatInput = document.getElementById('chat-input');
            if(chatInput) chatInput.value = '';
        } else {
            alert("Error de WhatsApp: " + data.error);
        }
    });
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

function mostrarModalQR() { 
    const modal = document.getElementById('qr-modal');
    if(modal) modal.style.display = 'flex'; 
}
function cerrarModalQR() { 
    const modal = document.getElementById('qr-modal');
    if(modal) modal.style.display = 'none'; 
}

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
    if(!tbody) return;
    tbody.innerHTML = '';
    
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
                
                if (!res.ok) continue; 

                const data = await res.json();
                if (data.esperando) continue;

                if (typeof data.valido === 'boolean') {
                    p.wa_valido = data.valido; 
                    const iconSpan = document.getElementById(`wa-icon-${p.id}`);
                    if (iconSpan) {
                        iconSpan.innerText = data.valido ? '🟢' : '🔴';
                        iconSpan.title = data.valido ? 'Tiene WhatsApp' : 'No tiene WhatsApp';
                    }
                }
            } catch(e) {}
        }
    }
}

function cambiarPagina(direccion) { currentPage += direccion; pintarTabla(); }
function actualizarControlesPaginacion() {
    const totalPages = Math.ceil(prospectosFiltrados.length / rowsPerPage) || 1;
    const pageInfo = document.getElementById('page-info');
    if(pageInfo) pageInfo.innerText = `Página ${currentPage} de ${totalPages} (${prospectosFiltrados.length} prospectos)`;
    
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    if(btnPrev) {
        btnPrev.disabled = currentPage === 1;
        btnPrev.style.opacity = currentPage === 1 ? '0.5' : '1';
    }
    if(btnNext) {
        btnNext.disabled = currentPage === totalPages;
        btnNext.style.opacity = currentPage === totalPages ? '0.5' : '1';
    }
}

function filtrarTabla() {
    const searchInput = document.getElementById('buscador');
    if(!searchInput) return;
    const textoBusqueda = searchInput.value.toLowerCase();
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

function cerrarChat() { 
    const panel = document.getElementById('chat-panel');
    if(panel) panel.style.display = 'none'; 
    chatActualIndex = null; 
}

async function abrirChat(index) {
    chatActualIndex = index;
    const prospecto = prospectosGlobal[index];
    prospecto.mensajesNoLeidos = 0;
    pintarTabla();
    
    const chatPanel = document.getElementById('chat-panel');
    if(chatPanel) chatPanel.style.display = 'flex';
    
    const chatNombre = document.getElementById('chat-nombre');
    if(chatNombre) chatNombre.innerText = prospecto['Nombre empresa'];
    
    const chatNumero = document.getElementById('chat-numero');
    if(chatNumero) chatNumero.innerText = prospecto['Contacto (Tel / WhatsApp)'];
    
    const messagesBox = document.getElementById('chat-messages');
    if(messagesBox) messagesBox.innerHTML = '<div style="text-align: center; color: gray; margin-top: 20px;">Cargando historial...</div>'; 
    
    const chatInput = document.getElementById('chat-input');
    if(chatInput) chatInput.value = '';

    try {
        const res = await fetchConToken(`/api/mensajes/${prospecto.id}`);
        const historial = await res.json();
        if(messagesBox) messagesBox.innerHTML = ''; 
        if (historial.length === 0) {
            if(messagesBox) messagesBox.innerHTML = '<div style="text-align: center; color: gray; font-size: 12px; margin-top: 10px;">Inicia la conversación</div>';
            if(chatInput) chatInput.value = prospecto['Mensaje de Acercamiento'] || '';
        } else {
            historial.forEach(msg => agregarMensajeAlChat(msg.mensaje, msg.tipo));
        }
    } catch (error) { 
        if(messagesBox) messagesBox.innerHTML = '<div style="text-align: center; color: red;">Error cargando historial.</div>'; 
    }
}

function enviarMensaje() {
    if (chatActualIndex === null) return;
    const prospecto = prospectosGlobal[chatActualIndex];
    const input = document.getElementById('chat-input');
    const mensaje = input ? input.value : '';
    if (mensaje.trim() === '') return;

    if(socket) {
        socket.emit('enviar_mensaje', {
            userId: crmUserId, 
            numero: prospecto['Contacto (Tel / WhatsApp)'],
            mensaje: mensaje,
            prospecto_id: prospecto.id 
        });
    }
}

function agregarMensajeAlChat(texto, tipo) {
    const messagesBox = document.getElementById('chat-messages');
    if(!messagesBox) return;
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
    if(btn) { btn.innerText = "Pensando..."; btn.disabled = true; }
    try {
        const res = await fetchConToken('/api/sugerir-respuesta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prospecto_id: prospecto.id }) });
        const data = await res.json();
        if (data.sugerencia && input) input.value = data.sugerencia; 
    } catch (error) { alert("Error de conexión."); } 
    finally { if(btn) { btn.innerText = "✨ Sugerir"; btn.disabled = false; } }
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
    
    if (crmView && crmView.style.display === 'none') {
        crmView.style.display = 'flex';
        if(adminView) adminView.style.display = 'none';
        if(btn) { btn.innerText = "👥 Usuarios"; btn.style.background = "#9c27b0"; }
    } else {
        if(crmView) crmView.style.display = 'none';
        if(adminView) adminView.style.display = 'flex';
        if(btn) { btn.innerText = "🏠 Volver al CRM"; btn.style.background = "#1a73e8"; }
        cargarUsuarios(); 
    }
}

async function cargarUsuarios() {
    try {
        const res = await fetchConToken('/api/usuarios');
        const usuarios = await res.json();
        const tbody = document.querySelector('#usuarios-table tbody');
        if(!tbody) return;
        tbody.innerHTML = '';
        
        usuarios.forEach(u => {
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
    const inputId = document.getElementById('admin-user-id');
    const inputName = document.getElementById('admin-user-name');
    const inputPass = document.getElementById('admin-user-pass');
    const inputRol = document.getElementById('admin-user-rol');
    
    if(inputId) inputId.value = id;
    if(inputName) inputName.value = usuario;
    if(inputPass) { inputPass.value = ''; inputPass.placeholder = "Dejar en blanco para no cambiar clave"; }
    if(inputRol) inputRol.value = rol;
}

function limpiarFormularioUsuario() {
    const inputId = document.getElementById('admin-user-id');
    const inputName = document.getElementById('admin-user-name');
    const inputPass = document.getElementById('admin-user-pass');
    const inputRol = document.getElementById('admin-user-rol');
    
    if(inputId) inputId.value = '';
    if(inputName) inputName.value = '';
    if(inputPass) { inputPass.value = ''; inputPass.placeholder = "Contraseña nueva"; }
    if(inputRol) inputRol.value = 'vendedor';
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
            method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
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

// 🛡️ CORRECCIÓN: Asegurar que el HTML ya se haya cargado antes de ejecutar JS
document.addEventListener("DOMContentLoaded", () => {
    if (localStorage.getItem('crm_token')) {
        arrancarApp();
    } else {
        mostrarPantallaLogin();
    }
});