# Diseño: Crate Connect, Cast y automóvil

> **Estado (2026-11-18):** Pendiente; nada nuevo implementado (verificado 2026-11-18). Complementa la retirada de Connect v1 de [2026-05-31-crate-connect-v2-rewrite.md](../2026-05-31-crate-connect-v2-rewrite.md).

**Estado:** propuesta revisada · **Prioridad:** P1 · **Corte:** 2026-09-09.

## Objetivo y valoración

Mover y controlar playback entre dispositivos sin perder cola, posición,
permisos ni artwork; añadir Android Auto y CarPlay sobre el owner de audio de
cada plataforma. El servidor coordina sesiones y comandos, nunca transporta
audio por el canal Connect.

| Hito                      | Valor                                                      | Coste/riesgo                                                             |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| Connect fiable            | Alto: continuidad entre dispositivos sobre una base amplia | Medio: carreras, ACK perdido, clientes antiguos y red particionada       |
| Cast completo Android/iOS | Alto para escuchar en casa                                 | Medio: receiver, codec, alcance de red, expiración y dispositivos reales |
| Android Auto              | Alto para uso móvil diario                                 | Medio: browse/lifecycle sobre Media3 existente                           |
| CarPlay                   | Alto para paridad iOS                                      | Alto: entitlement, owner de audio iOS, firma y pruebas físicas           |

Los cuatro permanecen en alcance. Cast/Android Auto pueden avanzar mientras se
tramita CarPlay. No se declara finalizada toda la iniciativa si CarPlay está
pendiente. Jam usa estos contratos cuando lo necesite; SmartMix/VDJ conserva su
autoridad enlazada en el [índice](00-index.md#fuentes-de-smart-mix).
**Android Auto no depende de terminar el plugin VirtualDJ.**

## Baseline real

Principal `codex/listen-design-system`, `992704b9`; esta revisión de documentos
no certifica ejecución de suites ni hardware.

- Backend: `app/crate/api/connect.py`, `connect_ws.py`, schemas existentes,
  repositorio `app/crate/db/repositories/connect.py`, sesiones activas,
  outbox persistente, ACK, SSE, WebSocket y recuperación REST.
- Migraciones 035/037/040/043 ya cubren fundación, sesiones, outbox y
  preferencias. No crear otra `connect_v2` ni duplicar tablas de sesiones.
- Transfer ya conserva source hasta ACK del target y completa el cambio de
  owner desde el repositorio. Endurecer fases/carreras, no reinventar el flujo.
- Listen: `crate-connect*.ts`, hooks de transporte/comandos y
  `PlaybackTargetMenu`/`ContinuePlaybackPrompt`; no hay que crear otro selector.
- Cast: tickets, media/stream y tests; adapters Android e iOS. El
  [runbook iOS](../../technical/ios-release-and-cast.md) distingue build de
  simulador y validación firmada en dispositivo.
- Android: `CrateNativePlaybackService` extiende `MediaSessionService`;
  todavía falta biblioteca `MediaLibraryService` y browse para Auto.
- iOS tiene `CrateMediaSessionPlugin.swift`; esto no acredita un owner nativo
  de audio independiente de la WebView ni un adapter CarPlay.

WIP playback-resilience contiene contratos de entrega/recovery/QoE; auditar su
integración antes de duplicarlos. Offline 01 provee assets verificados al nodo
Downloads, pero navegar/reproducir online en Auto no espera todo el offline.

## Autoridad y semántica de comandos

PostgreSQL conserva sesión activa, revisión, dispositivo y outbox; Redis
distribuye notificaciones. Separar ID de instalación, sesión autenticada y owner
de playback. Capabilities describen control/browse/seek/offline/codec y versión
del protocolo; un receiver Cast no tiene las capacidades de un cliente Crate.

Transporte **al menos una vez**, con deduplicación durable y aplicación
idempotente donde sea posible. `command_id` queda ligado a usuario y huella del
payload; reutilizarlo con otra intención debe fallar. `state_revision`,
sesión/época de owner y generación de cola impiden aplicar comandos antiguos.
Distinguir recibido, preparado y aplicado: recibir un mensaje no confirma que
el audio cambió. Un crash entre efecto físico y ACK se reconcilia con snapshot,
sin volver a ejecutar ciegamente `next`.

Garantía: un owner lógico vigente mediante transacción y control de revisión.
No prometer audio físicamente único durante una partición solo porque una fila
sea única. La app local restaura/reconcilia antes de aceptar control remoto y
mantiene un owner de audio/MediaSession por engine activo.

## Transfer coordinado

1. Controller solicita transfer con revisión esperada y ID idempotente.
2. Target prepara pausado la fuente/cola; ACK de preparación no inicia audio.
3. Source pausa y confirma para un handoff cooperativo.
4. Servidor comprueba revisión, cambia owner/época y ordena activar target.
5. Target aplica según `start_playing` y confirma; controllers convergen con
   snapshot autoritativo. Si ya estaba pausado, conservar ese estado.

Timeout antes de activar conserva source o deja recuperación explícita; después
de una activación incierta se consulta estado, sin reanudar source a ciegas.
Source no accesible impide afirmar transferencia segura: mostrar pendiente/error
y una toma de control explícita si se ofrece, explicando que el dispositivo
desconectado podría seguir sonando. No introducir un servicio de sincronización
de relojes ni un lease de audio obligatorio para el playback local.

ACK antiguos/duplicados y reclamaciones simultáneas no cambian owner sin cumplir
la transición. Clientes antiguos solo usan capacidades negociadas; la fase
nueva no interpreta un ACK legacy como prueba de preparación pausada.

## Cast y contrato de entrega

Mantener `POST /api/me/cast/tickets`, `GET /api/cast/media/{ticket}` y
`GET /api/cast/stream/{ticket}`. El receiver necesita su URL autorizada;
no prohibir todo ticket en su payload. Prohibir bearer/PAT, URL peer y filesystem
path; redacción de tickets/URLs en logs y nada durable en metadata de cola.

Ticket limitado a recurso, usuario y sesión/receiver admitidos por el contrato.
Solicitudes nuevas comprueban expiración/revocación; rangos sucesivos y seek
funcionan durante su ventana. Revocar no retira bytes ya cargados. Renovación,
reanudación y cambio de variante se prueban con el receiver real.

Negociar formato con capabilities, sin inferirlo del móvil emisor. Probar acceso
del receiver a API, TLS, CORS y codec; estar accesible desde el teléfono no basta.
La [documentación oficial del Web Receiver](https://developers.google.com/cast/docs/web_receiver/core_features)
es referencia para su integración. Un cambio de ruta local/Connect/Cast no crea
tres owners ni reinterpreta controles no soportados.

## Android Auto e iOS CarPlay

Android Auto usa `MediaLibraryService`/`MediaLibrarySession` sobre el mismo
ExoPlayer del servicio actual, con callbacks asíncronos de root/children/search.
Android Auto suministra su UI de biblioteca: no se necesita añadir Car App
Library para una biblioteca de audio estándar.
[Referencia Android](https://developer.android.com/media/media3/session/serve-content).

Árbol previsto: Home, Library, Playlists, Favorites y Downloads. IDs estables,
paginación acotada, caché de artwork/metadata, permisos al resolver y respuestas
de no autenticado/sin conexión. No HTTP síncrono en main ni callback de audio.
Transport controls reutilizan comandos del owner, incluyendo audio focus,
Bluetooth, cola y restauración. Si SmartMix está disponible, preservar su owner
y fallback descritos por sus documentos, sin exigir DSP desde el host Auto.

CarPlay comparte contrato de catálogo/control, **no Media3 ni objetos de sesión
Android**. Requiere adapter Swift, lifecycle de escena y owner iOS comprobado
en background. Evaluar primero el engine actual; si la WebView no satisface el
gate, implementar owner nativo iOS con AVPlayer y bridge explícito. Nunca
mantener ambos reproduciendo a la vez.

Mantener solicitud de entitlement, templates autorizados, firma y revisión de
distribución como gates externos tempranos. Apple admite apps de audio y
documenta su proceso de [CarPlay](https://developer.apple.com/carplay/);
aprobación no garantizada. Simulador permite avanzar, pero no acredita iPhone
firmado con unidad CarPlay. Android Automotive OS no queda certificado por
aprobar Android Auto; cualquier distribución AAOS exige su propio gate.

## APIs y compatibilidad

Rutas existentes que se evolucionan aditivamente:

- `GET/PUT /api/me/connect/preferences`;
- `GET /api/me/connect/session`;
- `POST /api/me/connect/transfer`;
- `GET/POST /api/me/connect/commands`;
- `POST /api/me/connect/commands/{command_id}/ack`;
- `GET /api/me/connect/events`;
- `POST /api/me/connect/ws-ticket` y WebSocket `/api/me/connect/ws`.

Reutilizar registro/presencia de dispositivos existente antes de proponer otra
ruta. SSE/WS notifican; REST recupera snapshot y outbox. Desbordamiento o pérdida
de replay lleva a snapshot acotado, sin cola infinita ni bloqueo de UI.
Auth y aislamiento por usuario son iguales en todos los transportes. Readplane
no es obligatorio para cerrar este hito; justificar y probar cualquier traslado.

## Gates y rollout

Hipótesis iniciales: transfer preparado local p95 <2 s y remoto preparado p95
<5 s, separando preparación, coordinación y arranque audible. Medir antes de
prometerlas. No usar “exactly once” ni “owner físico único 100%” como SLO.

Pruebas obligatorias: dos transfers concurrentes, ACK perdido/tardío/duplicado,
restart, cambio de cuenta, revoke, source desaparecido, cola revisada durante
handoff, TLS/codec/Range Cast, lock-screen/Bluetooth, 30 minutos suspendido y
desconexión del automóvil. Registrar latencia, gaps/solapes observados,
reconexión, conflictos y memoria sin datos sensibles.

Flags separados para transfer coordinado, Cast, Android Auto y CarPlay.
Deshabilitar una superficie no detiene playback local ni borra cola. Backend
compatible antes de cliente; activar con evidencia propia de cada plataforma.
Firma, host o entitlement pendiente se reporta como gate abierto, nunca verde.
