# Jam y Auto DJ sobre Smart Mix — Diseño 2027

> **Estado (2026-11-18):** Pendiente. Jam sigue desactivado en Listen (`JAM_ROOMS_ENABLED = false`). Absorbe lo pendiente del plan Hero + Jam Pareto de agosto (guard de revisión de sala, tests con dos clientes).

**Estado:** propuesta revisada el 2026-09-09, pendiente de implementación y aceptación. **Prioridad:** P1. **Baseline:** worktree principal `992704b9`; Smart Mix se desarrolla aparte en `codex/feat-smart-mix-phase-1` (`140f9e34` más WIP).

## Valor y decisión

Jam aporta escucha compartida y una cola que responde al grupo; es una diferenciación útil para Crate, con coste y riesgo de integración altos. Su valor depende de conseguir entrada, reconexión y control fiables antes de añadir transiciones sofisticadas. No hay evidencia de uso que permita atribuirle un incremento de retención: se medirá en una beta consentida.

Este workstream **continúa Jam y su integración con Smart Mix**. El diseño y plan unificados de Smart Mix/Android/VirtualDJ son los únicos propietarios de análisis, perfiles, planner, crossfade nativo y plugin; se localizan en el [índice, fuentes de Smart Mix](00-index.md#fuentes-de-smart-mix). Este documento reemplaza el roadmap 06 anterior para Jam, sin reactivar sus tareas duplicadas de DSP/migraciones/VDJ. Jam no es prerrequisito de terminar ni publicar Smart Mix o VirtualDJ.

La entrega base es una sala coordinada con cola compartida, presencia, control de host, peticiones, votos, filtros y Auto DJ; reproducción gapless/adaptive según capacidades reales. Beatmatch local y sincronía acústica entre dispositivos son capacidades distintas y se certifican por separado.

## Estado observado: completar, no reconstruir

| Área                  | Código existente                                                                                                     | Trabajo restante que debe verificarse                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Rooms/API/WS          | `app/crate/api/jam.py`, `api/schemas/jam.py`, `db/jam_rooms.py`, `jam_members.py`, `jam_invites.py`, `jam_events.py` | Gate servidor, límites/autorización continua, revisiones/ACK/replay, publicación durable y cleanup |
| Cola/peticiones/votos | `app/crate/db/jam_queue.py`, migración 085                                                                           | CAS de comandos y dedup; vote toggle reintentado no debe deshacer un voto aceptado                 |
| Auto DJ               | `app/crate/jam_auto_dj.py`, `queue_engine.py`, `db/jam_auto_dj.py`, migración 086 y `worker_handlers/jam.py`         | Refill concurrente, exclusiones, invalidación, recuperación y consumo del core musical común       |
| Cliente               | hooks `use-jam-*`, reducers, `use-player-jam-queue-sync.ts`, componentes `components/jam/`                           | Entrada/clock/readiness, parches de cola sin reload, spectrum y salida/reconnect multiplataforma   |
| Producto              | `app/listen/src/app-shell/feature-flags.ts`: `JAM_ROOMS_ENABLED=false`                                               | Rutas UI ocultas; el router backend sigue registrado. Flag UI no equivale a kill switch servidor   |
| Evidencia             | `test_jam_sync.py`, `test_jam_queue.py`, `test_jam_auto_dj.py`, tests WS/reducer                                     | Existen tests; esta revisión documental no los ejecutó ni certificó audio distribuido              |

El diagnóstico local `docs/technical/jam-rooms-status.md` describe problemas de agosto; sigue siendo evidencia histórica a contrastar, no una segunda guía para activar la feature. No se crean de nuevo `track_mix_profiles`, `smart_mix/planner.py`, el backfill o los decks Android. Tampoco se reutilizan números de migración 085/086/090/091.

## Límites y dependencias

- **Obligatorios:** playback normal fiable en plataformas anunciadas, auth/membresía, disponibilidad de media por participante y contratos de cola/sync. Para Jam musical: core Smart Mix corregido y contratos adoptados; para adaptive Android: executor nativo certificado.
- **Independientes:** no exige terminar discovery 02, feed/colaboración 04, Connect 05, Push 03 ni VirtualDJ C. Puede reutilizar sus servicios cuando existan; los contratos de identidad/permisos se comparten sin unificar agregados.
- **Alcance de sala:** autoridad en un nodo Crate. Contenido remoto solo cuando el pipeline existente autorice su reproducción individual; no se distribuyen tickets del host ni se añade consenso entre nodos. Sin acceso a una pista, el participante muestra estado no disponible; no altera globalmente la cola para eludir permisos.
- **Sincronía estricta:** se conserva como modo/gate de esta propuesta, sin anunciar altavoces multiroom de baja latencia antes de medirlos. No confundir coordinar personas a distancia con reproducir sin eco en una estancia.
- **Plataformas:** web desktop y Android nativo primero; web móvil/iOS conservan su motor y las restricciones de autoplay/background. La matriz final registra soporte/restricción real por plataforma, no extrapola resultados Android.

## Autoridad, revisiones y transporte

PostgreSQL conserva sala, membresía, cola y eventos aceptados. Añadir revisión monotónica de sala/cola y command ID por actor/sala para dedup; no usar el timestamp del cliente como orden. La transacción valida rol actual, expected revision/current item, aplica el comando y registra su evento/outbox. Un `play_next` duplicado nunca consume dos pistas; votar expresa estado deseado (`voted:true|false`) en el contrato nuevo, manteniendo adaptación temporal del toggle legacy sin doble ejecución.

WebSocket mantiene `/api/jam/rooms/{room_id}/ws`; room REST conserva sus rutas existentes bajo `/api/jam/rooms`. Queue/votes son hoy mensajes WS, no los GET/POST inventados en el roadmap anterior. El envelope nuevo incluye `protocolVersion`, `commandId`, `expectedRevision` y ACK con revisión/resultados o conflicto. `state_sync` contiene snapshot y revisión; reconnect solicita eventos posteriores y recibe snapshot completo si el replay expiró. Las diferencias se resuelven contra la autoridad, no mediante un merge CRDT nuevo.

Redis distribuye y acelera clock/presencia; no reemplaza persistencia ni garantiza replay de Pub/Sub. Hay un clock/epoch de playback y una lease/fencing del coordinador; un proceso antiguo no puede publicar un clock válido tras perder ownership. El fallback local actual necesita tratamiento explícito en despliegue multiworker: no permite dos autoridades independientes. Si falta coordinación, se mantiene audio ya cargado y estado de sala degradado hasta recuperar snapshot; no se autoavanza desde dos procesos.

Los buffers de envío/recepción y replay son acotados. Un cliente lento recibe resync o desconexión recuperable, no bloquea el broadcast de toda la sala. Renovar auth y consultar rol/membresía vigentes en mutaciones; una sesión WS no conserva indefinidamente el `member` capturado al conectar. Revocación o expulsión invalidan activamente suscripciones y buffers pendientes; un heartbeat de autorización limita a 5 segundos la ventana de recepción residual incluso sin nuevos comandos del cliente. Una comprobación fallida suspende la entrega privada. Invitaciones limitadas/expiradas y scopes se comprueban también en repositorios/servicios. Ningún payload compartido contiene URL protegida, JWT, PAT o rutas locales.

## Playback y relojes

La secuencia de entrada es snapshot → identidad/cola → resolver media propia → engine ready → aplicar clock actual de ese mismo epoch/generación. Un sync atrasado no hace seek sobre la pista anterior. Queue updates y votos aplican diffs: no rehidratan el engine, reinician el primer segundo ni desconectan analyser. Salir restaura una sola vez el snapshot local previo y retira WS/timers/audio refs.

La sala transmite intención temporal de reproducción y un offset calculado con ping/pong y reloj monotónico local. Readiness, buffer y salida hardware siguen siendo locales. Correcciones pequeñas se amortiguan; drift grande o epoch distinto requieren resync/seek controlado. No se hace un seek periódico para aparentar convergencia.

**Interacción con Smart Mix:** el planner de transiciones decide cómo mezclar un edge, no cuándo avanza la sala. La revisión de cola y perfiles liga planes por participante; gana la capacidad común efectiva para una transición sincronizada. Si un cliente no admite el modo, todos respetan el mismo timeline de sala y usan fallback compatible. No lanzar crossfade local que cambie duración efectiva/posición respecto al reloj compartido. El gate de fase ≤ 20 ms entre los dos decks de Android no demuestra drift ≤ 20 ms entre dos teléfonos.

Antes de armar una transición, el coordinador congela su descriptor: IDs saliente/entrante, epoch/revisión, instante de entrada, duración y posiciones/cues efectivos. Capabilities, joins o reconnects posteriores no renegocian ese edge en vuelo. El participante tardío adopta el descriptor vigente y un fallback que preserve su timeline; si no está ready, espera o se incorpora en un punto compatible sin bloquear la sala. Cambiar el descriptor exige un nuevo epoch y resync explícito, nunca una variación local silenciosa.

La sala usa cues automáticos/globales del core. Los overrides privados de cada usuario no se aplican silenciosamente al plan compartido ni se publican al resto de miembros, incluidos los del host. El adapter solicita explícitamente este contexto común al core; no calcula planes de sala a partir de preferencias privadas de participantes. Una futura publicación voluntaria de cues exigiría contrato y consentimiento propios; no bloquea Jam ni obliga a completar el editor privado P06 para este modo.

## Auto DJ y votos

Mantener `queue_engine.py` para identidad/familias, límites, diversidad y refill. `jam_auto_dj.py` mantiene intención/taste y restricciones del grupo; consume compatibilidad/perfiles del core en vez de replicar su fórmula de BPM/key/transición. Los votos afectan el siguiente refill de forma acotada, sin tocar pista audible, ordenar retroactivamente el edge ya armado o publicar el historial privado de cada miembro.

El refill captura versión de cola/room settings/seed, consulta candidatos elegibles acotados, calcula fuera de la transacción y publica solo si esa generación sigue vigente. Doble worker y reintento producen un solo lote; sin candidatos se explica el estado y se conserva lo ya encolado. Pausa/modo manual/sala cerrada invalida trabajo pendiente. Reutilizar task `prime_jam_auto_dj`, la ejecución existente de `run_auto_dj_once` y resource governor; no añadir un daemon nuevo ni meter generación pesada en callbacks WS.

## Contratos objetivo y aceptación

Los siguientes números son gates propuestos, no medidas actuales. J01 los fija con dataset/hardware/red/capacidad declarados; si resultan inviables se registra qué modo no está certificado.

| Gate                   | Criterio y medición                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consistencia           | Cero double advance, votos duplicados, comandos de usuario expulsado o eventos de epoch viejo aceptados en pruebas de concurrencia/replay                                                |
| Entrada/reconnect      | 100 ciclos por plataforma: ninguna reproducción declarada playing sin media ready, ningún reload causado solo por voto/presencia                                                         |
| Sala remota coordinada | p95 drift audible ≤ 250 ms tras 3 s de convergencia en perfil de red declarado; medir al menos 200 transiciones/pares, no usar solo timestamps de WS                                     |
| Misma estancia         | p95 diferencia audible ≤ 20 ms en captura multicanal y rutas certificadas, sin clicks por corrección; si falla, el modo sigue pendiente y no se anuncia audio multiroom sin eco          |
| Recuperación           | Reconexión a snapshot vigente p95 ≤ 5 s después de restaurar red; presencia caduca ≤ 90 s y leave explícito visible p95 ≤ 2 s                                                            |
| Escala                 | Beta inicial 10 salas × 10 participantes, 500 elementos máximos por cola; carga sostenida 2 h, colas de mensajes/memoria acotadas, p95 ACK de comando ≤ 250 ms sin generación DSP inline |
| Audio local            | Gates del diseño Smart Mix aplicables al executor; álbum/playback normal y opt-out sin regresión                                                                                         |

La UI explica estado reconectando/no disponible/mode limitado, permisos y control del host. Reutilizar `@crate/ui`; keyboard/DnD alternativo, focus, responsive y traducciones forman parte del cierre. Rollout separado de flags Jam/AutoDJ/SmartMix; desactivar Jam no apaga playback ordinario ni VirtualDJ. Las decisiones posteriores se registran en este diseño y [su plan](06-smart-mix-jam-implementation-plan.md).
