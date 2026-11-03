# Configurar mensajes de Facebook e Instagram

El backend implementa webhooks y envío de mensajes para conversaciones de Messenger e Instagram. Las cuentas de Instagram deben ser profesionales y cumplir los requisitos de mensajería de Meta; un perfil personal no puede conectarse como inbox.

## Requisitos en Meta

1. Crea una aplicación en Meta for Developers y agrega los productos Messenger y Webhooks. Configura también Instagram Messaging para el tipo de integración elegido.
2. Vincula una Página de Facebook a la aplicación. Para Instagram, vincula una cuenta profesional de Instagram a esa Página, o configura Instagram API with Instagram Login.
3. Configura los permisos de mensajería requeridos por el método de inicio de sesión y los activos. Para la integración de Página suelen incluir `pages_messaging` y `instagram_manage_messages`. La disponibilidad puede depender de la configuración, el tipo de cuenta y la revisión de la aplicación.
4. Suscribe los activos de Página/Instagram a los webhooks de mensajes (`messages`). Configura la URL de callback como `https://TU_HOST/webhooks/meta` y el mismo valor que `META_VERIFY_TOKEN`.
5. Para desarrollo, expón el puerto local con un túnel HTTPS temporal (por ejemplo, Cloudflare Tunnel o ngrok). El túnel debe permanecer conectado mientras Meta envía eventos. No uses esta configuración temporal como alojamiento de producción.

## Variables de entorno

Copia `.env.example` a `.env` o agrega sus variables al archivo existente. No publiques tokens ni el secreto de aplicación.

- `META_APP_SECRET`: secreto de la aplicación; se usa para validar `X-Hub-Signature-256`.
- `META_VERIFY_TOKEN`: texto aleatorio que también se configura en el panel de Webhooks de Meta.
- `META_PAGE_ACCESS_TOKEN`: token de Página para Messenger y para Instagram cuando se usa la API de mensajería vinculada a Página.
- `META_INSTAGRAM_ACCESS_TOKEN`: opcional, token propio si se usa Instagram API with Instagram Login.
- `META_GRAPH_VERSION`: versión de Graph API disponible para la app.
- `META_INSTAGRAM_API_BASE`: opcional; configura `https://graph.instagram.com/vXX.X` si usas Instagram API with Instagram Login. Si se deja vacío, usa Graph API de Facebook.

Reinicia `node index.js` después de guardar las variables.

## Comportamiento en el CRM

- El endpoint `GET /webhooks/meta` completa la verificación del callback.
- `POST /webhooks/meta` valida la firma, guarda mensajes entrantes e ignora ecos de mensajes enviados.
- Los mensajes entrantes crean un prospecto social si no existe una conversación para el remitente y activo. Se asigna al administrador local.
- Las conversaciones nuevas de Meta aparecen en la bandeja con el canal y se pueden responder desde el CRM.
- Los prospectos importados de una hoja con solo un nombre de usuario o URL de perfil no quedan automáticamente enlazados a una conversación de Meta. La API de mensajería requiere los IDs de usuario y activo entregados por Meta; la persona debe iniciar la conversación primero.
- Meta impone restricciones de ventana de mensajería y permisos. El CRM no debe usarse para iniciar mensajes no solicitados.

La configuración de desarrollo solo da acceso a activos y personas con permisos en la aplicación. Para conectar cuentas de terceros o producción, Meta puede exigir revisión de permisos y verificación empresarial.
