# Diseño: Inbox de notificaciones y push

> **Estado (2026-11-18):** Pendiente; nada implementado (verificado 2026-11-18). Sustituye a los docs de julio de push y notificaciones sociales federadas, que no se conservan.

**Estado:** propuesta local revisada el 2026-09-09; no implementada ni aprobada para despliegue. **Prioridad:** P0 inbox/preferencias; P1 push nativo por su gate de distribución.

## Valor, alcance y evidencia actual

El inbox permite recuperar avisos importantes aunque una app esté cerrada o el proveedor push falle. Es el punto común para actividad social, novedades, avisos operativos y seguridad, y tiene valor sin esperar al feed federado.

| Capacidad comprobada                                                                                                                                                      | Implicación para la propuesta                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/ui/src/hooks/use-notifications.ts` escucha `/api/events`, muestra avisos con `Notification` cuando el documento está oculto y deduplica el último evento en memoria. | Conservar este flujo Admin; no equivale a inbox durable ni Web Push. Su test todavía debe crearse.                                           |
| `app/listen/public/sw.js` y `app/listen/src/main.tsx` ya gestionan Service Worker; `app/listen/src/lib/offline.ts` lo utiliza.                                            | Ampliar el mismo worker sin interferir en caché, actualización o reproducción offline del workstream 01.                                     |
| `app/crate/db/domain_event_outbox.py`, `app/crate/db/domain_events.py` y `app/crate/domain_event_relay.py` tienen outbox transaccional y relay a Redis Streams.           | Reutilizar el outbox de dominio; no crear un segundo bus `notification_events`. Las entregas sí necesitan persistencia propia de reintentos. |
| `app/crate/api/redis_sse.py`, `app/readplane/internal/routes/server.go` y clientes nativos existen.                                                                       | Rutas de inbox, autorización específica y adapters push son trabajo nuevo; no asumir paridad implementada.                                   |

El diseño de julio de 2026 (push y notificaciones sociales federadas, no conservado en el repo) es antecedente de producto, no evidencia de implementación. Este documento y su [plan](03-notifications-push-implementation-plan.md) concretan la propuesta 2027.

Se mantienen Web/PWA, Android/FCM, iOS/APNs, Tauri, SSE/readplane, campañas Admin, digests y extensión entre nodos. La dependencia externa de push nativo no convierte Android/iOS en un extra prescindible para cerrar el alcance completo.

## Categorías, consentimiento y privacidad

Categorías cerradas: `social`, `content`, `admin`, `playback` y `security`. Incluyen follow aceptado, playlist compartida, novedades de artistas/releases, resumen diario/semanal, mantenimiento, transferencia/desconexión de sesión y cambios de seguridad. No se reserva un contrato público `membership` ligado a un workstream 09 ausente del roadmap.

Las preferencias separan inbox y cada transporte, con quiet hours en zona horaria del usuario y frecuencia de digest. Social/content push empieza desactivado hasta consentimiento explícito; conceder permiso al SO no activa todas las categorías. Sólo un catálogo acotado de eventos de seguridad mantiene registro en inbox aunque el usuario desactive push; Admin no puede etiquetar una campaña como seguridad para eludir preferencias. Nunca se envía `listening_now` por push.

El payload externo usa por defecto texto genérico, UID de notificación y referencia del servidor. Títulos de playlists, nombres y actividad aparecen en pantalla bloqueada sólo si el usuario lo habilita. La acción es una ruta interna tipada, validada contra allowlist; al abrirla se autentica en el servidor correspondiente y se reevalúa acceso al recurso. No incluir sesión, bearer, email, IP, historial crudo ni URL arbitraria.

Endpoint y caché se ligan a `(server, user, installation, provider, app_identity)`. Logout, borrado de cuenta y revocación desasocian el endpoint y cancelan entregas pendientes; rotar token conserva preferencias. Conocer un UID no permite tomar posesión de una instalación ajena. Con varios servidores, cerrar sesión en uno no desregistra los otros. Las respuestas y streams nunca comparten caché entre usuarios.

## Persistencia y semántica de entrega

```text
mutación + outbox de dominio (misma transacción PostgreSQL)
  -> relay existente -> consumer de notificaciones
  -> notifications + notification_deliveries (misma transacción)
  -> dispatcher Dramatiq -> Web Push / FCM / APNs
  -> invalidación -> REST / SSE -> UI y avisos locales Tauri
```

Nuevas tablas propuestas: `notifications`, `notification_preferences`, `notification_endpoints`, `notification_deliveries`, `notification_campaigns` y `notification_digest_runs`. Unique `(source_event_uid, recipient_id, notification_kind)` impide duplicar inbox tras replay. Una entrega es única por notificación/endpoint/versión. Dedupe y tombstones viven al menos el máximo horizonte de replay; un evento antiguo no resucita una notificación expirada.

El dispatcher reclama trabajo con lease, realiza red fuera de la transacción y distingue pendiente, aceptado por proveedor, retry, expirado, cancelado y fallo permanente. Aceptación no demuestra recepción ni lectura. Un timeout tras aceptación puede duplicar el aviso externo: mantener identificador/tag y dedupe cliente, sin prometer exactly-once de extremo a extremo.

Quiet hours difiere push hasta el siguiente periodo permitido si no ha expirado; no retrasa inbox. Cada envío comprueba de nuevo preferencias, autorización del recurso, campaña y endpoint. Cambiar privacidad impide nuevos envíos y oculta acciones no autorizadas; no retira una notificación ya mostrada por el SO.

Retención propuesta: inbox 180 días configurables y `expires_at` por evento cuando deje de ser útil; entregas detalladas 30 días, después métricas agregadas. Borrado de cuenta purga contenido personal; tombstones mínimos de dedupe no conservan texto. Secretos y subscriptions/tokens se cifran en reposo con claves rotables: esa capacidad debe implementarse, no se presupone. Payloads de inbox se minimizan y protegen mediante autorización y política de almacenamiento.

## API propuesta y concurrencia

| Ruta nueva                                                 | Contrato                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /api/me/notifications?cursor=&category=&unread_only=` | Keyset `(created_at, uid)`, límite acotado, cursor opaco ligado a filtros/usuario y `snapshot_watermark`. |
| `GET /api/me/notifications/unread-count`                   | Cuenta y revisión, excluyendo expiradas/retractadas.                                                      |
| `PATCH /api/me/notifications/{uid}`                        | Estado de lectura con revisión esperada; retry no cambia dos veces el estado. Sólo el destinatario.       |
| `POST /api/me/notifications/read-all`                      | Aplica hasta un watermark recibido; avisos creados durante la petición siguen sin leer.                   |
| `GET/PUT /api/me/notification-preferences`                 | Schema versionado, actualización condicional y categorías válidas.                                        |
| `POST /api/me/notification-endpoints`                      | Alta/rotación idempotente de instalación autenticada; no devolver token completo.                         |
| `DELETE /api/me/notification-endpoints/{endpoint_uid}`     | Revocación idempotente, sólo del propietario.                                                             |
| `GET /api/me/notifications-stream`                         | Invalidaciones privadas, `Last-Event-ID`, heartbeat y señal de resync si expiró el replay.                |

Mutaciones con `Idempotency-Key` conservan digest de request y respuesta; misma clave con otro cuerpo produce 409. Cookies conservan protección CSRF/origin de sesión y clientes nativos usan auth vigente; no introducir bearer en query del stream. FastAPI realiza CRUD transaccional y workers fanout/delivery. Readplane sólo lee/relaya con autorización equivalente; no es requisito para entregar N1. Revocación invalida streams abiertos; heartbeat de autorización cada 5 s como máximo limita entrega en conexiones ociosas si se pierde esa invalidación. Si no puede comprobar autorización, el stream se cierra. Con Redis caído se recupera por REST.

Campañas nuevas bajo `/api/admin/notification-campaigns`: borrador, `/{uid}/preview`, `/{uid}/estimate`, `/{uid}/schedule`, `/{uid}/cancel` y `/{uid}/retract`; salud en `/api/admin/notifications/health`. Preview/estimate no envían. Programar congela contenido/versión/criterio de audiencia, pero consentimiento y elegibilidad se reevalúan al enviar. Segmentos cerrados, cuotas, auditoría y cancelación concurrente. Retract oculta inbox y cancela pendientes; no promete retirar push aceptados.

## Transportes y gate de distribución nativa

- **Web/PWA:** VAPID por instancia y alta con gesto explícito. WebKit documenta Web Push para apps añadidas a Home Screen desde iOS/iPadOS 16.4 y permiso iniciado por el usuario; usar detección de capacidad y revalidar la matriz 2027. [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
- **Android:** FCM liga el token a su sender/proyecto; credenciales distintas pueden producir `SENDER_ID_MISMATCH`. `UNREGISTERED` da de baja el token; errores de credenciales detienen el adapter y 429/503 requieren backoff específico. [Firebase](https://firebase.google.com/docs/cloud-messaging/error-codes).
- **iOS nativo:** APNs relaciona team, topic/bundle y entorno. La distribución necesita credenciales compatibles; no distribuir claves privadas de la app oficial a instancias arbitrarias. [Apple](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns).
- **Tauri:** adapter local y SSE mientras el proceso vive; recuperación por inbox al abrir. SSE no despierta procesos cerrados. Dedupe entre ventanas para evitar doble aviso OS.

**Decisión externa antes del hito nativo:** entrega directa para builds autohospedados con identidad/credenciales propias, y arquitectura de entrega para la distribución compartida. Para esta última, comparar autorización de envío compatible con su proyecto/team frente a relay opcional del distribuidor con registro autenticado, cuotas y separación de tenants. No existe relay Crate implementado ni se decide que deba ser obligatorio. La selección documentará coste, custodia de tokens, abuso, borrado y disponibilidad; inbox local sigue funcionando sin ese servicio. Una build privada no demuestra push nativo de la app distribuida.

Registrar una subscription tampoco autoriza llamadas a cualquier URL: validar HTTPS, destino y resolución de Web Push, bloquear redes privadas/metadata y redirecciones inseguras; el dispatcher no puede ser proxy SSRF. Limitar por actor, instalación, usuario y provider.

## Digests, federación y dependencias

El scheduler existente dispara runs únicos por usuario/frecuencia/ventana/zona horaria, con DST probado. Cien imports de una ventana producen un resumen; digest vacío no entrega. Workstreams 02/08 aportan novedades/recap, 04 eventos sociales y 05/06 eventos de sesión expresamente notificables. Ninguno necesita 03 para funcionar y no se espera a ellos para probar el inbox con productores existentes/fixtures.

Federación es un hito posterior conservado en alcance. Reutiliza `app/crate/federation/signing.py`, `authorization.py`, `grants.py` y `events.py`; añade capability/envelope versionado, sin asumir que un grant de catálogo autoriza actividad social. Peer aprobado no implica consentimiento. Dedupe nodo/evento, límites de antigüedad/tamaño, replay, bloqueo actor/nodo y destino home validado. El receptor crea inbox local; nunca se federan tokens ni historial. Retirada remota genera tombstone y frena entregas; no se garantiza borrado en un nodo no cooperativo.

## Hitos 2027, coste y aceptación

| Hito                                                | Valor entregado                                                | Coste/riesgo principal                                   |
| --------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------- |
| N1 — P0: inbox + preferencias + productores locales | Recuperación durable y control de ruido en todos los clientes. | Medio: transacciones, privacidad y compatibilidad Admin. |
| N2 — Web Push + Tauri + campañas/digests            | Avisos útiles y observables web/desktop.                       | Medio: lifecycle SW, targeting y duplicados externos.    |
| N3 — P1: Android + iOS distribuidos                 | Push nativo con logout y multi-servidor verificados.           | Alto: identidad de distribución y operación externa.     |
| N4 — federación + paridad readplane                 | Avisos entre nodos sin centralizar inbox.                      | Alto: trust, reintentos y revocación distribuida.        |

Objetivos a medir con carga publicada, no garantías actuales: inbox p95 <5 s desde commit y unread p95 <200 ms con caché caliente. Dedupe inbox: cero duplicados en pruebas de replay; duplicación externa se mide aparte. Métricas de latencia/backlog por adapter sin etiquetas de usuario/token. Cierre: contratos Python/Go equivalentes donde haya rutas Go, recuperación Redis/worker, carrera logout/envío, expiración, aislamiento usuarios/servidores y matriz real Android/iOS/Web/Tauri. Soak de 24 h complementa estas pruebas, no las sustituye.
