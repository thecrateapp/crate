---
title: Smart Mix - diseño unificado
summary: Contrato y arquitectura para terminar Smart Mix, crossfade Android nativo y VirtualDJ desde el WIP existente.
section: architecture
audience: [developer, operator]
status: canonical
order: 99
verified: 2026-09-09
sources:
  [
    app/crate/smart_mix,
    app/crate/api,
    app/crate/db,
    app/listen,
    app/readplane,
    tools/crate-cli,
    tools/vdj-plugin,
  ]
---

# Smart Mix, crossfade Android nativo y VirtualDJ: diseño unificado

**Fecha y baseline:** 2026-09-09; rama `codex/feat-smart-mix-phase-1`, HEAD `140f9e347976eec0d27cb71919afd6f71bee4e86`, incluyendo su working tree sin commit. **Estado:** diseño canónico de continuación; describe el objetivo, no acredita que esté implementado o listo para producción.

## 1. Autoridad, alcance y punto de partida

Este documento y el [plan de implementación](smart-mix-implementation-plan.md) son las **únicas fuentes normativas para continuar y cerrar esta feature**. El diseño define comportamiento, contratos, límites y decisiones; el plan define orden, tareas, pruebas y evidencia de cierre. Una decisión posterior se incorpora aquí y actualiza las tareas afectadas: no se crea otro plan por fase, plataforma o agente.

Sustituyen los diseños, planes y secuencias Smart Mix/Android/VDJ anteriores, incluidos los documentos de julio, los de VDJ del 16 de agosto y los spikes de Android y de UI/Control de VDJ. Sus checklists y afirmaciones de estado son históricos. El README del plugin es un enlace de entrada; fixtures, código, CI, capturas y manifests de paquetes son artefactos verificables, no guías alternativas. Los roadmaps de Jam/Auto DJ tampoco pueden redefinir esta feature ni añadir Jam como prerrequisito.

La documentación general de Crate conserva su autoridad para convenciones del repositorio, operación y dominios ajenos. Si el código difiere de este diseño, el código describe el estado existente y el plan registra el trabajo pendiente; nunca se presenta una decisión futura como una capacidad entregada.

### 1.1 Resultado que queremos entregar

Un solo dominio Smart Mix analiza audio, propone cues, calcula compatibilidad y produce planes de transición. Dos ejecutores consumen esos planes:

- **Android:** crossfade adaptativo nativo, integración completa con el reproductor y, después de medirlo, tempo/phase y bass handoff opcional.
- **VirtualDJ:** A, fuente local completa; B, asistencia musical; C, ejecución protegida y opt-in sobre decks controlados por VirtualDJ.

Se mantienen como parte de la misma entrega los tokens y su UI, catálogo completo con filtros/paginación, caché de metadata, caché de audio cifrada opt-in y prefetch, cues privados, radio existente, presencia/play events, summaries de federación, observabilidad, CI, paquetes firmados y rollout/rollback. Que una opción venga apagada no elimina su implementación ni sus pruebas de cierre.

**Fuera del alcance:** otro algoritmo de ranking por cliente, Rekordbox, edición de XML/base de datos interna de VirtualDJ, daemon local/IPC, UI SideView personalizada, streaming federado en VDJ v1, Jam/colas colaborativas y cambiar los motores web/iOS/desktop. Los summaries federados sirven para interoperabilidad y degradación segura; no habilitan beatmatch remoto completo.

### 1.2 Estado comprobado

| Bloque         | Base aprovechable                                                                                                                       | Lo que impide considerarlo terminado                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smart Mix core | Modelos, codec de grid, Python/Rust, migración 090, persistencia, backfill, planner, ranking, API/caché, cobertura Admin y summaries Go | Semántica de mediciones, límites temporales, publicación/revisiones, reanálisis por generación, rendimiento y validación musical                                 |
| Android        | Dos decks Media3, facade estable, MediaSession, controller, procesador de ganancia, bridge y tests                                      | Plan de red bloqueante, cue/buffer de standby, trigger tardío, envelope dependiente del hilo principal, settings y gates físicos; tempo/phase/bass no ejecutados |
| VirtualDJ A+B  | Core C++20, HTTP, stores del SO, caché, clientes, compatible folder y adapter de spike                                                  | Handshake sin integrar, lifecycle/cancelación, catálogo incompleto, media real sin aceptación, presentación B parcial                                            |
| VirtualDJ C    | Pruebas de comandos de deck 1 en spike                                                                                                  | Falta executor de planes, state machine, takeover, lease, UI opt-in y evidencia real                                                                             |
| Plataforma VDJ | WIP PAT/API/migración 091, tickets asociados al token, rutas de catálogo/media                                                          | Permisos de escritura, auth hot path, proxy prod/home, gates efectivos, UI usuario y extensiones                                                                 |
| Entrega        | Algunas suites automáticas verdes                                                                                                       | Sin aceptación Android física completa, matrices Win/Intel/host, paquetes firmados ni soak final                                                                 |

La revisión observó 25 commits propios y 7 commits de `origin/main` local no incorporados; no se hizo fetch. Había 21 archivos tracked modificados y código sin seguir, incluido `tools/vdj-plugin/` y los módulos PAT/catálogo. El snapshot de trabajo importa tanto como HEAD: no se debe comenzar desde un checkout limpio de ese commit y asumir que contiene todo.

**Evidencia disponible, no certificación de release:** 113 tests core pasaron con 16 tests PostgreSQL omitidos; 60 tests de plataforma pasaron con PostgreSQL efímero; C++ headless macOS arm64 pasó 14/14 CTests. El build ASan/UBSan falló al enlazar. En esta revisión no se ejecutaron Rust completo, Vitest completo, Gradle ni la matriz física/host. El plan exige regenerar evidencia después de los cambios.

### 1.3 Invariantes de producto

1. Pulsar play no espera análisis, perfiles, planning, presencia ni telemetría. La ausencia de inteligencia musical permite reproducir con fallback seguro.
2. Álbum secuencial automático permanece gapless; Smart Mix aplica a radio, shuffle, playlists y continuación cuando se habilita. Manual next/seek/pause no se convierten en una transición futura basada en outro.
3. Android expone un solo `Player` estable, una `MediaSession` y una notificación; la cola avanza una vez. Precarga silenciosa no cuenta como reproducción.
4. Cada plan se valida contra identidad, fuente/perfil/cues, contexto y capacidades actuales. Nunca contiene PAT, ticket, ruta privada ni URL firmada.
5. El audio ya cargado mantiene continuidad ante caída de red. Esto no promete acceso nuevo tras revocación ni capacidad de retirar bytes ya entregados.
6. El usuario mantiene control de los decks de VDJ. C no pisa una intervención manual ni reinicia el fader/tempo para aparentar cancelación.
7. La API no escribe `/music`; análisis, preparación y cambios de archivos usan workers existentes. No se añade trabajo a `orchestrator.py`.

## 2. Arquitectura y contrato compartido

```text
Fuente local + identidad/revisión
  → worker de análisis (Python/Rust, mediciones verificadas)
  → TrackMixProfile persistido + summary sin grid
  → ranking + planner puro ← cues privados autorizados + contexto + capacidades
  → TransitionPlan inmutable
       → bridge Listen → executor Android → una sesión del SO
       → API PAT → Online Source A+B / General C → decks del host VirtualDJ
```

La separación se mantiene en los módulos existentes; no requiere introducir un framework de dominio o una segunda cola de tareas. La política musical vive en Python; Java y C++ validan y ejecutan intenciones tipadas. El analyzer Rust produce el mismo significado de perfil que el fallback Python.

### 2.1 Versiones fijadas para la continuación

| Identificador                 | Objetivo                                                             | Compatibilidad                                                                               |
| ----------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| API contract                  | `2026-09`                                                            | Negociación explícita de contratos admitidos; `2026-08` solo mediante compatibilidad probada |
| `profileVersion`              | `1`                                                                  | Campos seguros aditivos; ninguna reinterpretación silenciosa de estructuras/unidades         |
| Grid                          | `delta-ms-v1`                                                        | Mismos golden fixtures entre lenguajes                                                       |
| Analyzer                      | `crate-python` / `crate-rust`, `analyzerVersion: smart-mix-audio-v2` | Procedencia real; v1 conserva identidad legacy y requiere reanálisis                         |
| Medición                      | `measurementVersion: bs1770-v1`                                      | Ausente/desconocido: no acredita LUFS/true peak ni permite boost optimista                   |
| Planner del lote/capabilities | `plannerVersion: "smart-mix-v2"`                                     | Conserva el tipo string actual; identifica la política                                       |
| Planner de cada plan/score    | `plannerVersion: 2`                                                  | Conserva el tipo entero actual y se corresponde 1:1 con política v2; no es schema            |
| Plugin                        | SemVer propio, tag `vdj-v*`                                          | Binario, handshake y manifest obtienen versión de una sola fuente                            |

Estas versiones son decisiones objetivo, todavía pendientes de P01/SM01. El wrapper temporal para consumidores distribuidos v1 aplica el validador/política seguros y proyecta una respuesta representable; caso no representable degrada. La clave de caché incluye la política efectiva v2 aunque la respuesta legacy use lote `smart-mix-v1` y plan entero `1`. En el contrato nuevo se valida conjuntamente lote string v2 y cada plan entero 2; el bridge conserva ambos significados. Cambiar int a string dentro de planes rompería el parser Java actual y no forma parte de esta decisión. Retirar el wrapper requiere verificar qué clientes se distribuyeron; una incompatibilidad se anuncia, no se deduce del nombre WIP.

El plan conserva los IDs/campos wire existentes donde es posible. P01 fija fixtures explícitos para source/profile/cue/context revisions y capabilities; los nuevos campos son aditivos. La validación exige valores finitos, unidades inequívocas y límites de duración/rate/gain. Un cliente puede mostrar un summary desconocido como metadata básica, pero no ejecutar un plan cuyo contrato no admite.

### 2.2 Capacidad efectiva y fallbacks

La capacidad efectiva es la intersección de feature flags del servidor, contrato admitido, preferencias/consentimiento del usuario, disponibilidad de datos y capacidades medidas del executor. Poseer un perfil `full` no certifica fase en el dispositivo. Los campos de tempo/bass no habilitan automáticamente su ejecución.

Fallbacks tipados distinguen falta de datos, plan tardío/obsoleto, buffer insuficiente, modo no soportado y fallo de autorización. Los primeros pueden producir adaptive conservador o gapless según contexto; un error 401/403 no se transforma en acceso nuevo desde caché. Ningún fallback da órdenes de seek fuera de rango, repite outgoing para ganar tiempo ni aumenta la duración solicitada por el usuario.

### 2.3 Permisos VirtualDJ

| Scope                    | Operaciones autorizadas                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `vdj.catalog.read`       | Buscar/browse local y metadata permitida                                |
| `vdj.media.read`         | Resolver playback y tickets/streams/artwork protegidos correspondientes |
| `vdj.smart_mix.read`     | Perfiles, compatibles, planes y lectura de cues propios                 |
| `vdj.play_events.write`  | Play events y presencia propios                                         |
| `vdj.automation.execute` | Solicitar lease para C; adicional a scopes de datos/media               |
| `vdj.cues.write`         | Crear/modificar/borrar cues privados con revisión esperada              |
| `vdj.radio`              | Operaciones stateful de radio propia, siempre con candidatos locales    |

El permiso WIP `vdj.automation` no se interpreta automáticamente como el nuevo `.execute`. P01/P02 definen migración visible y reemisión/reasignación expresa; no añaden scopes a tokens existentes. `/api/auth/me` tiene rama de identidad PAT explícita y mínima. Crear/rotar/revocar tokens sigue exigiendo sesión interactiva propia; un PAT no adquiere poderes Admin por el rol de su usuario.

La lease propuesta se solicita en `GET /api/vdj/automation-lease`: TTL máximo inicial 15s, refresh cada 5s, scope `.execute` y flags/PAT vigentes. La respuesta contiene lease ID, permiso efectivo, TTL y contract/gate revision; el cliente transforma TTL en deadline monotónico conservador descontando el tiempo de petición. Valida al armar y antes de cada comando; no depende del reloj de pared del ordenador. Expirada o revocación observada → cancela trabajo propio y exige rearme. TTL es una ventana máxima de autorización ya concedida, no una promesa de cancelación remota instantánea. Peticiones y comandos en vuelo se cubren por el gate de takeover del host. La respuesta lleva `Cache-Control: no-store`; no se persiste, no permite stale fallback y una lease ID ya recibida conserva su deadline original. Reutilizar la misma respuesta nunca reinicia sus 15s. P03/V02 prueban replay/caché HTTP y reloj monotónico.

### 2.4 Límites iniciales y autorización de caché

Estos son defaults objetivo que P01 fija en fixtures/configuración; los presupuestos operativos pueden ajustarse con mediciones registradas, sin relajar identidad ni scopes.

| Recurso            | Límite inicial                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan HTTP          | 32 edges por batch; Android precarga 3 y no espera más de 1s por planificación                                                                              |
| Ranking/browse     | 500 candidatos elegibles;50 resultados por search y100 por página de carpeta; continuación visible sin truncar biblioteca                                   |
| JSON nativo        | 2MiB por respuesta de catálogo/planes/summary, profundidad32; full profile hasta8MiB solo si se solicita explícitamente; abortar antes de crecer el buffer  |
| Cursor             | Máximo2KiB, versión/contexto/orden validados; invalidación por revisión devuelve409 `cursor_stale`, formato/contexto inválido400                            |
| Caché metadata     | 100MiB/50K entradas, TTL24h; stale solo ante transporte/5xx y con estado visible, nunca401/403/cancel                                                       |
| Caché audio opt-in | 5GiB físicos totales y 7d de retención, LRU, máx.2 descargas simultáneas y3 candidatos precargados; límite configurable visible, sin expulsar decks activos |
| Permiso offline    | Nueva carga desde caché hasta `offlineEligibleUntil`, máximo 24h desde autorización online y nunca después de expirar PAT                                   |
| Presencia/spool    | Heartbeat30s, TTL90s; spool de eventos≤1000 entradas/24h; sin secretos, por cuenta/nodo                                                                     |

P05 añade `offlineEligibleUntil` e identidad de token/revisión de fuente/usuario/nodo a la resolución de playback autorizada cuando media scope y la opción de caché lo permiten. V08 conserva esa procedencia en metadata autenticada junto al ciphertext. Una caída de red permite carga manual de audio previamente autorizado dentro de ese plazo; una revocación/403 observada bloquea nuevas cargas y purga material no fijado. Expiración, cambio de cuenta/origen o retroceso de reloj detectado exige revalidación online; ninguna de estas situaciones corta el audio ya cargado. C no obtiene permiso offline de esta caché: su lease 15s sigue siendo obligatoria.

El presupuesto físico incluye ciphertext, descargas parciales y materialización temporal en claro. Reservar espacio antes de descargar/descifrar; si los pins impiden liberar suficiente, cancelar prefetch o rechazar nueva entrada sin expulsar decks activos.

La caducidad de retención no implica permiso de reproducción: una entrada retenida 7d necesita renovar autorización para nuevas cargas tras el plazo offline 24h. Es control de acceso y almacenamiento de Crate, no una promesa DRM contra el dueño del equipo. No se introducen PAT largos en URLs ni un servidor local para resolver restricciones del SDK.

## 3. Core: análisis, publicación y decisiones musicales

### Responsabilidad y límites del core

Smart Mix genera observaciones reproducibles de audio, decide transiciones y ordena candidatos. Android ejecuta `TransitionPlan` en su motor nativo; VirtualDJ ejecuta sus capacidades A+B+C usando el mismo contrato y sus restricciones de host. Los engines no incorporan tablas de pesos alternativas. El core no incorpora streams autenticados ni credenciales en perfiles, planes o snapshots.

Se mantienen `app/crate/smart_mix/{models,policy,planner,compatible,beat_grid,camelot}.py`, los repositorios y endpoints existentes. El diseño separa tres identidades: revisión de los bytes/fuente analizados, revisión de la implementación de análisis y revisión del perfil publicado. La revisión del planner es independiente de esas tres. Un cambio de cada una invalida solamente el resultado derivado correspondiente.

Todos los trabajos pendientes forman parte de la misma feature: contratos, backfill, Android, el plugin A+B+C, cues privados, observabilidad y aceptación real. Es posible desplegar incrementos detrás de capabilities; completar un incremento no equivale a cerrar la feature. El fallo del gate físico de beatmatch permite entregar adaptive crossfade manteniendo beatmatch apagado, pero debe quedar registrado como pendiente y no como trabajo eliminado.

### Mediciones de audio con semántica verificable

Se usan dos representaciones para finalidades diferentes. El downmix mono/resample sigue siendo válido para onsets, tempo, energía y key. Loudness y true peak se calculan sobre los canales de la fuente con un medidor conforme al algoritmo declarado; nunca sobre la media mono. `introLufs` y `outroLufs` son loudness de ventanas documentadas; `integratedLufs` es la medida del programa completo si pudo calcularse. `truePeakDbfs` es el máximo true peak entre canales y no el sample peak del downmix. Silencio, señal demasiado corta, layout no soportado o análisis interrumpido producen `null` para la medida que no pudo obtenerse, no un número inventado.

Implementar un medidor existente con streaming de PCM, sin programar otra aproximación BS.1770 en cada lenguaje. Propuesta: adapter sobre la familia libebur128/implementación compatible en producción; una vez verificados build y licencia en las imágenes actuales, fijar la implementación y versión en ambos backends. FFmpeg `ebur128` puede actuar como oracle de aceptación independiente y como fallback explícito si la dependencia nativa no está disponible. La interfaz del adapter debe permitir probar los analyzers con un medidor fake, pero la aceptación ejecuta el real. La elección de binding es una decisión de implementación dentro de SM02: no altera las unidades, fixtures o gates. Referencias primarias: [ITU-R BS.1770-5](https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en), [implementación de ebur128 de FFmpeg](https://ffmpeg.org/doxygen/8.0/f__ebur128_8c_source.html).

Los perfiles históricos que contienen RMS en campos LUFS y sample peak mono no se renombran ni se marcan válidos mediante SQL. Mantienen su procedencia; los lectores no usan esas medidas para autorizar ganancia positiva. Se reanalizan gradualmente. Para datos ausentes/no confiables, el planner usa staging conservador, y el motor mantiene la protección final de la salida mezclada. La predicción del backend no sustituye el limiter/medición de salida del engine, especialmente tras EQ y bass handoff.

### Versiones, migración aditiva y compatibilidad

Versiones coordinadas con P01:

| Identidad                         | Decisión propuesta                                                                                    | Motivo                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| API contract                      | `2026-09`                                                                                             | Contrato global de la feature consolidada, propiedad de P01                                                       |
| Profile schema / `profileVersion` | `1`, con cambios opcionales aditivos                                                                  | Las correcciones hacen que LUFS/true peak cumplan la semántica ya declarada; no requieren otra forma de payload   |
| `beatGridFormat`                  | Mantener `delta-ms-v1`                                                                                | No cambia el codec; conservar golden fixtures cross-language                                                      |
| `analyzer`                        | Conservar `crate-python` / `crate-rust` como identidad real                                           | Dos implementaciones distintas no son una misma identidad de idempotencia                                         |
| `analyzerVersion`                 | Nuevo identificador `smart-mix-audio-v2` en los analyzers corregidos                                  | No interpretar perfiles viejos como análisis corregidos ni impedir su sustitución                                 |
| `measurementVersion`              | Campo opcional `bs1770-v1`; ausente significa que las medidas no están acreditadas bajo este contrato | Los lectores distinguen medidas reales de legado y productores desconocidos                                       |
| Planner                           | Lote/capabilities `plannerVersion: "smart-mix-v2"`; cada plan/score `plannerVersion: 2`               | Ambos identifican la misma política conservando los tipos wire actuales; no son schema y no se reutiliza caché v1 |

Añadir `duration_ms` persistido desde el decoder a `track_mix_profiles`: actualmente se descarta y se reconstruye desde `library_tracks.duration`. Añadir los límites activos `active_start_ms` / `active_end_ms`, `integrated_lufs` y `measurement_version` como columnas opcionales con sus campos wire aditivos. La migración es nueva; no reescribe la 090 ya aplicada, ni reutiliza la 091 que el WIP de access tokens ocupa. Se elige el siguiente número libre al comenzar la implementación y se verifica la cadena de Alembic.

No inventar una duración exacta para perfiles históricos: usar el duration legacy únicamente como fallback identificado y preferir degradación si no se pueden garantizar límites. No guardar miles de grids en catálogos/snapshots ordinarios. Summary y full mantienen sus diferencias; payloads y productores desconocidos se validan antes de planificar.

Compatibilidad base: capabilities y requests usan `plannerVersion: "smart-mix-v2"` como identificador preferido de política. Los adapters siguen reconociendo los datos v1 y sus ausencias, aplican el mismo validador de seguridad y eliminan medidas legacy no acreditadas; un caso que no pueda representarse con seguridad se degrada a gapless/adaptive. No se clona el planner anterior. La caché identifica siempre la política efectiva v2, aunque el origen sea un dato/contexto v1. P01 documenta y prueba la correspondencia entre `plannerVersion` string del lote y entero de cada plan/score. Mantiene sus tipos y no añade otro `planVersion`; los parsers Java/C++/TS verifican 2 para los planes nuevos y manejan 1 únicamente por compatibilidad explícita.

Un wrapper que preserve exactamente respuestas para un cliente v1 distribuido se incorpora solo si P01 encuentra evidencia de ese consumidor; usa el mismo cálculo seguro v2 y una proyección acotada, nunca otro algoritmo. Las matrices cubren lectura v1 segura, cliente nuevo/servidor viejo y versión desconocida, y añaden el cliente viejo/servidor nuevo concreto cuando exista. Mantener solo `smart-mix-v1` y modificar resultados sin invalidar cachés/planes offline no es una alternativa válida.

### Captura y publicación de perfiles

El trabajo transporta un contexto explícito con entity UID, track ID, path esperado, revisión de fuente capturada, identidad/versionado de analyzer, token de claim y revisión de perfil observada. No calcula por primera vez la revisión de fuente al guardar el resultado. La captura debe detectar reemplazos de inode/path y cambios de size/mtime; cuando exista una revisión de contenido fiable en la biblioteca se reutiliza. El fingerprint acústico no se trata como hash de los bytes.

Secuencia mínima: adquirir claim y capturar identidad; analizar fuera de transacción; comprobar que descriptor/fuente/path siguen representando lo capturado; abrir una transacción breve y verificar track/entity/path, claim vigente y revisión del perfil esperado; publicar mediante CAS; completar únicamente el claim que se posee; emitir invalidación. Los writers soportados que sustituyen audio deben invalidar/reprogramar su perfil. Para una fuente que pueda ser modificada in-place durante la lectura se necesita captura estable —descriptor más controles pre/post y coordinación de los writers, o snapshot temporal inmutable—; un CAS SQL por sí solo no vuelve inmutable el filesystem. Documentar qué mecanismo cubre realmente los writers existentes antes de afirmar la garantía.

El cambio de archivo durante el análisis descarta el draft y reencola una nueva revisión: nunca etiqueta el draft antiguo con la revisión nueva. Si otro job publicó, el perdedor no marca done un claim ajeno ni sobrescribe la revisión ganadora. Fallos de decoding conservan el último perfil válido como dato histórico; no lo sirven como current si su fuente ya no coincide. No se necesita una tabla con todos los pares de transiciones ni un event-sourcing genérico para resolver este protocolo.

La idempotencia compara fuente, `analyzer`, `analyzerVersion` y configuración/semántica relevante. Resultado idéntico es un no-op. Para la misma fuente y semántica, `partial → full` es una promoción permitida; una repetición fallida no reemplaza un full válido por unavailable. Un cambio de fuente o de semántica puede publicar partial si ese es el resultado correcto: conservar un full de otra fuente como current sería incorrecto. La preferencia por Rust de producción no oculta una mejora real del fallback; la regla debe ser determinista y probada.

### Backfill que converge y puede operarse

Mantener el pipeline `smart_mix`, límites de 100 por lote, prioridad de colas activas/restauradas → offline → biblioteca del usuario → escuchadas → resto local, `SKIP LOCKED` y resource governor. Completar el protocolo para que el objetivo de análisis forme parte del checkpoint/dedup. Puede añadirse metadata nullable de target y claim al estado existente, aislada a `smart_mix`, si `claimed_by/claimed_at` no bastan para distinguir generaciones; no introducir otro scheduler.

Una fila `done` de una generación anterior vuelve a ser elegible. Los attempts se cuentan por target, y los claims abandonados son recuperables sin que un worker tardío complete los del siguiente. Pause impide nuevos claims; el lote en curso llega a un checkpoint definido. Cancel no borra perfiles ni convierte tareas hijas activas en trabajo huérfano. Resume continúa el target/checkpoint, no crea una segunda carrera. El status distingue perfiles current, legacy/stale, in-flight, failed y agotados, en vez de contar como cobertura actual cualquier perfil non-unavailable de la versión nominal.

### Cues y duración temporalmente válidos

El cue de cuatro segundos detectado por el analyzer es una sugerencia de punto de salida, no permiso para producir un fade de doce segundos después de ese punto. El planner resuelve primero los cues efectivos (automatic facts más overrides privados ya autorizados), preserva un cuerpo audible mínimo y elige un intervalo que cabe en ambos tracks.

Validar `0 <= incomingCue < activeEndIncoming <= durationIncoming` y los equivalentes outgoing cuando se dispone de medidas. En unidades de tiempo de salida, la reserva de incoming es `(activeEndIncoming - incomingCue) / incomingTempoRatio`; incluir cualquier offset o tramo de ajuste/recuperación de tempo. La transición y su handoff deben caber también en outgoing. Preferir mover el cue automático a un beat anterior cuando se pueda mantener cuerpo audible; los cues privados explícitos no se mueven silenciosamente: acortar duración o degradar. Si ni el mínimo de un fade seguro cabe, devolver gapless/adaptive corto según contexto, sin instrucciones para seek negativo/fuera de pista.

La fase se calcula entre las dos posiciones efectivas y sus grids después de normalizar half/double tempo; no solo respecto al anchor de incoming. Los frames/duración que aplica el engine son su última autoridad: si cambian queue, duración, rate o disponibilidad tras planificar, el engine rechaza el plan obsoleto o lo degrada. Álbum automático sigue siendo gapless. Manual mantiene su rampa corta y no interpreta el outro futuro como instante de pulsación.

Los cues privados pertenecen al usuario/VDJ y no mutan `TrackMixProfile`. El API resuelve sus revisiones y pasa valores al planner puro; la caché incorpora owner scope, revisiones de ambos perfiles, revisiones de los cues/contexto y política. El mero string `userCueProfile` no autoriza acceso ni sustituye la resolución del contenido.

### Summaries federados y paridad de lectura

SM06 amplía snapshot/manifest y delta de catálogo con summary opcional y versionado: identidad, procedencia/revisión, duración, BPM/key/Camelot, energía/confianza, calidad y cues automáticos resumidos cuando sean publicables. Sin grids completos, cues privados, paths ni credenciales. La ingestión remota acepta la ausencia del campo en peers antiguos y valida/ignora versiones desconocidas de forma conservadora. Los perfiles remotos no adquieren calidad full de ejecución por recibir metadata.

Publicar una nueva `profileRevision` debe generar un cambio de catálogo y su delta aunque `library_tracks.updated_at` no cambie. El peer invalida el summary/plan correspondiente al aplicar esa revisión. La aceptación cubre export→ingest→reanálisis→delta→nuevo planning remoto. La federación actual no implementa todavía este recorrido Smart Mix: es trabajo explícito, no una propiedad asumida del summary Go.

La paridad de summaries/rutas Go ya existentes para session/JWT es obligatoria. Acelerar VDJ/PAT en Go sigue condicionado al SLO medido de FastAPI y auth/ticket parity; cerrar la feature con PAT por FastAPI es válido si cumple sus gates.

### Presupuesto de análisis y pruebas de rendimiento

No cargar arbitrariamente un concierto completo en RAM. El decoder y medidor deben soportar ventanas y procesamiento por bloques. Establecer cap configurable para full onset scan y una política de intro/middle/outro más anchors dispersos para archivos largos. Una exploración parcial no se etiqueta como grid full. Registrar tiempo, bytes leídos y RSS máximo; cuando se agota presupuesto se devuelve partial con campos ausentes o fallo reintentable tipado, no un perfil aparentemente completo.

Se conservan los budgets del plan anterior: planes cached p95 <50 ms; uncached p95 <150 ms; ranking local p95 <250 ms, con warm-up, hardware, versión, dataset y concurrencia declarados. Las pruebas de query cubren escala representativa de 48K tracks y muchas filas no elegibles, no solo 12K distribuidas favorablemente. No se obliga a PostgreSQL a un índice concreto cuando otro plan satisface el presupuesto; se prueba ausencia de N+1, carga acotada y coste medido.

Para DSP, fijar budgets de timeout/RSS/concurrencia según el análisis-worker desplegado antes del backfill; el informe debe comparar con el baseline real del mismo host. Ningún porcentaje de regresión inventado constituye evidencia. Los gates físicos de fase, underruns, output peak, OS handoff y memoria son parte del bloque Android/VDJ, no se sustituyen por estos benchmarks del servidor.

## 4. Plataforma: acceso, catálogo y media

### Autorización y conexión

- Denegar por defecto las peticiones PAT, comprobando tanto método HTTP como ruta. Una ruta futura no debe quedar expuesta porque su string termine en `/stream` o `/compatible`. Resolver la identidad autenticada una sola vez; la autorización de cada ruta será explícita y estará cubierta por tests.
- Mantener los scopes actuales de datos/telemetría `vdj.catalog.read`, `vdj.media.read`, `vdj.smart_mix.read` y `vdj.play_events.write`; el contrato final `2026-09` utiliza `vdj.automation.execute` para ejecutar automatización. Añadir `vdj.cues.write` para mutaciones de cues privados y `vdj.radio` para las operaciones de sesiones de radio. Los tokens existentes no reciben nuevos scopes implícitamente. El nombre WIP `vdj.automation` se registra como permiso legacy explícito: no autoriza la lease final ni funciona como alias que eleve permisos. El propietario debe reemitir el token o realizar una nueva asignación explícita de `vdj.automation.execute`. Las definiciones, etiquetas de UI y tests negativos comparten un único contrato revisado.
- Las lecturas de catálogo requieren catalog scope; playback/tickets/streams requieren media scope; perfiles/pistas compatibles/planes y lectura de cues privados requieren Smart Mix read scope; play events y now-playing requieren telemetry scope; start/next/feedback/end de radio requieren radio scope. La autorización de automatización se añade a los scopes de datos/media que necesiten sus operaciones.
- Crear/listar/rotar/revocar tokens seguirá requiriendo una sesión interactiva persistida, comprobando su propietario. Un PAT no puede crear o rotar credenciales, editar el perfil del usuario ni obtener derechos Admin por el rol de su propietario.
- Soportar `GET /api/auth/me` como contrato PAT explícito de identidad para validar el login del plugin y mostrar la cuenta. Devolver la identidad mínima revisada y los permisos VDJ efectivos; conservar la respuesta existente para sesiones/JWT. `GET /api/capabilities` sigue siendo el contrato público de servidor/versiones. No resolver el login del plugin abriendo todo `/api/auth/*`.
- Añadir gestión de tokens por el propio usuario en Settings de Listen, accesible a usuarios normales. Admin Settings requiere permisos de gestión y `/profile` redirige actualmente; no puede ser la única forma de conectar VirtualDJ. La UI de conexión del plugin recoge URL de servidor y token, valida identidad/capabilities y almacena el token únicamente en el almacén de credenciales de la plataforma. Se mantiene el login/OAuth existente de navegador y clientes nativos.
- Guardar únicamente digest y prefijo del token en PostgreSQL. Mostrar el secreto sólo tras create/rotate; nunca persistirlo en navegador, logs, URLs, analítica, caché de metadata/audio o diagnósticos de fallos. Los PAT se autentican mediante Authorization; las peticiones media del SDK usan tickets acotados.
- Comprobar expiración/revocación del token y estado del usuario en cada nueva petición autorizada sin bloquear su fila en cada lectura. Utilizar una actualización condicional y limitada de `last_used_at`; conservar el bloqueo transaccional para rotación/revocación donde sea necesario. La revocación afecta a las decisiones de autorización posteriores, no cancela retroactivamente una respuesta ya autorizada.

### Routing, flags y rollback

- Mantener las peticiones de catálogo/perfiles con PAT opaco en FastAPI, en producción, home y desarrollo, hasta que una decisión basada en mediciones justifique paridad en Go. Aplicar el bypass de Authorization PAT antes de las rutas canónicas del readplane, incluidos `/api/search`, `/api/auth/me` y `/api/tracks/by-entity/.../mix-profile`. Mantener los aliases VDJ de artwork/media en FastAPI cuando no lleven Authorization. Preservar el routing de sesiones/JWT existente.
- No usar un fallo de autenticación como reintento implícito en otro backend: credenciales inválidas/revocadas siguen produciendo 401, ausencia de scope produce 403 y una caída del backend sigue la política explícita de disponibilidad/fallback. El readplane sólo entiende sus contratos de credenciales soportados hasta que se implemente paridad. No enviar tickets ligados a tokens a su parser de tickets de sesión.
- Aplicar los flags del servidor a las nuevas operaciones PAT. `CRATE_VDJ_ENABLED=false` impide nuevo trabajo VDJ de catálogo/media/asistente/automatización. El flag independiente de automatización detiene nuevo trabajo automático mientras A+B siguen disponibles. La disponibilidad de Smart Mix y los scopes requeridos restringen adicionalmente las funciones efectivas. Listar/revocar tokens y diagnosticar la conexión siguen disponibles para recuperación.
- Un executor ya conectado necesita permisos efectivos con vigencia acotada. Utilizar `GET /api/vdj/automation-lease`, autenticado y con scope `vdj.automation.execute`, TTL de 15 segundos y refresco cada 5 segundos mientras la automatización esté armada/activa. Validar la lease al armar y antes de cada comando automático, mediante un deadline local monotónico; ejecutar la red fuera de callbacks de audio/UI. Denegación explícita del refresco, revocación detectada o flag deshabilitado provocan fallback manual seguro; un error de transporte no amplía la lease y su expiración impide nuevos comandos. Exigir rearme explícito después del fallback. El paquete nativo utiliza exactamente esta ruta, scope y contrato de expiración.
- La revocación del servidor no puede detener un proceso offline ni recuperar bytes ya entregados. Al observar un cambio de flag, el executor cancela su trabajo pendiente y cede el control manual sin descargar un deck audible, emitir otro crossfade o resetear bruscamente el crossfader. Verificar takeover durante preload, ajuste de tempo/fase y crossfade con el SDK real. Documentar el límite medido de observación/cancelación; no prometer cancelación remota instantánea ni sample-accurate.
- Mantener independientes las releases del stack, las del plugin, el contrato API, el schema de perfiles y la versión del planner. El contrato integrado final es `2026-09`; el perfil mantiene schema `1` con metadata aditiva de duración/origen/medición y codificación de beat-grid `delta-ms-v1`; el analyzer es `smart-mix-audio-v2` más su identificador de implementación; el planner se identifica como `smart-mix-v2`. Los campos opcionales nuevos son aditivos. Versiones requeridas desconocidas deshabilitan la función dependiente en vez de parsearse de forma optimista. El rollback deshabilita nuevo trabajo y despliega los binarios compatibles anteriores sin hacer downgrade automático ni borrar perfiles, planes, tokens o cues persistidos.

### Catálogo, media y extensiones

- Implementar jerarquía real de carpetas: Artists → artista → álbumes → pistas; Albums → álbum → pistas; Playlists → playlist autorizada → pistas ordenadas; Genres/Moods → género/mood elegido → pistas; Recently Played → pistas locales recientes del usuario actual. IDs opacos estables identifican entidades; las etiquetas son datos de presentación. Propietario/membresía de playlists y visibilidad de playlists de sistema reutilizan las reglas existentes.
- Limitar la primera release VDJ a contenido local reproducible. Una búsqueda PAT no puede ampliar silenciosamente su acceso a búsqueda federada/global cambiando `scope`. Reutilizar taxonomía normalizada y fallbacks de metadata de manera consistente en SELECT y WHERE, incluyendo `album_genres` cuando los tags de pista/álbum estén vacíos.
- Utilizar paginación keyset acotada, con cursor opaco versionado ligado a carpeta/query, orden y contexto de visibilidad. Especificar cómo una revisión de catálogo caducada reinicia el browse en vez de prometer un catálogo inmutable. Rechazar cursores malformados, excesivos, de otro contexto o versión desconocida mediante un 4xx documentado. El contrato DJ añade BPM, Camelot, energía, `analysis_required`, `fields=dj` y cursor; la búsqueda ordinaria de Listen conserva su comportamiento. El tamaño de página de búsqueda sigue limitado a 50.
- Resolver playback a partir de identidad local justo antes de usarla. Respetar la política de entrega y el estado de preparación devueltos, sin inventar una URL de stream a partir de una respuesta no parseada. Conservar el alias de transporte VDJ si routing/SDK lo requieren, respaldado por la misma implementación de playback/media y probado contra la ruta canónica.
- El artwork público existente conserva acceso público. Para artwork protegido, P05 amplía la emisión PAT actualmente limitada a audiencia stream: exige `vdj.media.read`, audiencia artwork/ruta permitida y validación del token en entrega. No se convierte el artwork protegido en público. Los tickets media conservan TTL corto, ruta normalizada exacta, audiencia e identidad del token. Comprobar estado del token padre y media scope en cada nueva petición, incluidos HEAD y Range. El refresco permite un reintento de autorización acotado; expiración/revocación no provoca bucles ni crea otro PAT silenciosamente.
- Cargar una pista puede requerir varias peticiones Range después de expirar el ticket de la URL inicial. La integración nativa debe demostrar su mecanismo de refresco/resolución con VirtualDJ. Si el SDK no permite refrescar ese flujo, V04 debe probar e implementar una entrega local por carga con spool cifrado y materialización privada acotada; V08 añade retención/offline/prefetch sobre esa base, sin depender de C; no debilitar el TTL ni introducir un PAT de larga duración en la URL. Cuando el audio ya esté completamente entregado a un deck o entrada válida de caché activa, una caída temporal/revocación no debe detenerlo bruscamente; las cargas nuevas sin autorización se deniegan. Mantener el trabajo de capacidad, integridad, cifrado, expulsión y pinning de decks activos en el paquete nativo.
- Reutilizar `POST /api/me/play-events` y `app/crate/db/repositories/user_library_playback_writes.py`, incluida la idempotencia existente `(user, client_event_id)`. Reintentar eventos aceptados no duplica historial, métricas, cambios de perfil ni scrobbles. VDJ aporta IDs de evento estables, duración audible y contexto de deck/sesión; la telemetría nunca bloquea playback.
- Añadir overrides privados de cues con control de revisión, sin sobrescribir los cues automáticos globales. Cuando un override participe en planificación, resolverlo para el usuario actual y vincular el plan inmutable a la revisión de cues además de las revisiones de perfiles; las cachés globales/compartidas de planes no pueden exponer ni reutilizar cues privados de otro usuario. Añadir presencia now-playing acotada por usuario/cliente/deck, con heartbeat de 30 segundos y expiración de 90 segundos ya aceptados. Persistir play events mediante el repositorio existente; la presencia es efímera.
- Reutilizar `/api/radio/start`, `/api/radio/next`, `/api/radio/feedback`, `/api/radio/can-discover` y `/api/radio/session/{session_id}`. Comprobar propietario de la sesión en next/feedback/end en API y servicio, además de la creación. Los candidatos VDJ siguen siendo locales; next concurrentes, expiración, cancelación y feedback no pueden mutar sesiones ajenas. Extender el servicio actual en vez de crear otro motor de radio VDJ.

## 5. Android: terminar el executor nativo existente

### 5.1 Conservar la integración y separar red de reproducción

Se continúa con Media3 `1.10.1` fijado actualmente en `app/listen/android/variables.gradle`, dos `ExoPlayerNativePlaybackDeck`, `NativeMixController`, `NativeMixAudioProcessor` y `CrateMixPlayer`. Un salto de versión Media3 solo se justifica con una necesidad y regresión verificadas; no es prerrequisito inventado.

`setQueue`/play disponen inmediatamente de sus media items. Planning se precarga fuera del camino de arranque, máximo los siguientes 3 edges con dedup y una petición activa por generación de cola. Deadline inicial 1s para obtener un plan remoto; agotado → fallback y cancelación real. Cambiar cola/cuenta/origen/cues o abortar playback invalida requests y resultados tardíos. Una respuesta no puede reconfigurar una transición que ya empezó.

Offline significa **cero requests de planning**. Se aceptan planes/perfiles locales únicamente si existen y coinciden sus identidades/revisiones/contexto; de lo contrario se usa fallback local. La caché de planes no conserva credenciales ni URLs y su clave no es solo el par de track IDs. El mismo contrato funciona con archivos descargados y streams autenticados, sin convertir la red en requisito del crossfade básico.

### 5.2 Preparación, tiempo y propiedad de cola

Preparar standby significa resolver el media item correcto, hacer seek al cue definitivo y esperar readiness **después de ese seek**, con buffer suficiente para arrancar y un margen configurable/medido. `STATE_READY` antes del seek o `prepare()` invocado no prueban esto. El plan temporal usa duración actual de ambos decks, límites activos y ratio efectivo; vuelve a validarse antes de comenzar.

El trigger usa `outgoingCueMs` y la posición efectiva del deck, no únicamente `duration - globalCrossfadeMs`. Si el plan llega tarde, se acorta dentro de la política segura o se descarta. No se fuerza repeat-one en outgoing. La falta de readiness deja tocar outgoing y aplica un fallback determinista; no lanza incoming en silencio con una cola ya avanzada.

Un `executionId` y generaciones de carga/cola ligan eventos, timeouts y callbacks. Separar cruce de metadata/handoff lógico de fin audible: ambos son eventos diferentes, y ninguno puede duplicar el avance o el play event. Pause, manual next/seek, cambio de cola, repeat-one, focus, desconexión de ruta y error de decoder resuelven la misma state machine; no contienen transiciones paralelas en bridge, service y controller.

### 5.3 Envelope en audio y protección de salida

La rampa completa se programa por frames en el procesador: inicio, duración, curva, ganancias y cancelación segura. Un tick de main lo puede observar, pero no establece los siguientes puntos de la curva cada 20ms. El test bloquea intencionadamente el main thread y comprueba que los samples mantienen continuidad. No se asigna memoria, hace I/O ni espera locks de red en el procesamiento de PCM.

Equal-power no impide por sí sola clipping de señales correlacionadas. El staging usa true peaks acreditados y ganancia/boost máximo de EQ; con datos desconocidos usa reserva conservadora. Se mide la salida combinada, con true peak objetivo ≤−1 dBTP y cero samples recortados en el corpus de aceptación. Las ganancias de usuario, duck/focus y EQ se aplican coherentemente a ambos decks; un segundo deck no duplica DSP global ni pierde audio-session effects.

Dos salidas Media3 no proporcionan automáticamente un reloj PCM común ni un limiter común. Para adaptive se admite la arquitectura si cumple gates con staging conservador. Para beatmatch, el error se mide sobre audio capturado. Si no cumple, se mantiene adaptive y se ejecuta el spike acotado de bus PCM compartido previsto en A07; no se afirma que un timestamp Java arregle el reloj del hardware.

### 5.4 Tempo, fase y bass handoff

Beatmatch requiere perfiles/grids fiables, estabilidad de tempo suficiente, plan compatible y dispositivo/ruta certificados. Corrección por defecto ≤4%, límite absoluto 6%; se preserva pitch y se define restauración de tempo tras la transición sin salto. La alineación usa ambos grids/cues, después de normalizar half/double tempo. Los campos ignorados actualmente pasan a ejecutarse solo después de A06/A07.

Bass handoff es opt-in y requiere controles en dominio audio, filtros estables por sample rate y envolvente separada que respete EQ/headroom. No se aplica por una etiqueta en el JSON si el executor no la soporta. El cierre exige comparación audible, ausencia de clicks/boost/clipping y medición con señales correlacionadas y música; no se añade un motor de efectos general.

### 5.5 Preferencias y sistema operativo

Settings de Android nativo muestra activar/desactivar Smart Mix, duración máxima y beatmatch/bass solo cuando son efectivos. Conserva opt-out persistente; una capability nueva no reactiva una preferencia apagada. Álbum y otros motores mantienen sus reglas. Web móvil no pasa a mezclar por compartir Settings.

La MediaSession/facade no cambia de identidad al intercambiar decks. La notificación, lockscreen, Bluetooth, Android Auto, focus/duck, llamadas y EQ conservan semántica. El checkpoint persiste cola, pista/posición y preferencia, nunca un fade a medias que se reproduce tras process death; restaurar carga una sola pista y regenera planes. La telemetría distingue buffer/plan/timing/cancelación, está acotada y no registra paths/tickets.

## 6. VirtualDJ: Online Source, Assistant y Automation

### Responsabilidades y binarios

Crate es la autoridad sobre identidad de pistas, autenticación, revisiones de perfiles, ranking de compatibilidad, sugerencias de cues y planes de transición inmutables. VirtualDJ controla la reproducción de los decks, el procesamiento de audio y los controles del usuario. C++ no debe copiar algoritmos de análisis, pesos del ranking ni políticas del planner. Android y VirtualDJ consumen el mismo significado de perfiles y planes versionados, y cada ejecutor valida sus propias capacidades.

Se distribuyen dos binarios de carga independiente desde `tools/vdj-plugin/`: `Crate` Online Source para A+B y General Automation para C. Ambos enlazan el core independiente del SDK. Enlazar la misma librería estática **no** comparte variables globales C++, cachés en memoria ni estado entre bundles. General lee por separado las identidades `netsearch://` reales de los decks, se autentica mediante el almacén del sistema y solicita perfiles y planes a Crate. Online Source proporciona identidades reproducibles; no necesita transferir a General un plan en memoria. El primer ejecutor no requiere daemon local ni IPC.

La configuración persistente de conexión, sin secretos, y las credenciales se identifican por origen normalizado e identidad verificada de nodo/usuario. Ambos binarios acceden mediante la misma abstracción de plataforma. La rotación de credenciales es atómica; los lectores recargan tras una notificación o un reintento acotado. SQLite permite handles independientes de ambos binarios mediante WAL, busy timeout y escrituras transaccionales. Ningún bundle presupone que el otro exista, se inicialice primero o se descargue después.

Los adaptadores de producción residen en `src/sdk/`, `src/online_source/` y `src/automation/`. `spike/control_spike.cpp` queda como herramienta de desarrollo, excluida de los targets distribuibles. Sus botones fijos para deck 1, configuración exclusiva por entorno, origen de producción por defecto y logging síncrono no forman el ciclo de vida de producción.

### Estado real y evidencias

El WIP inspeccionado contiene primitivas HTTP/cancelación, credenciales de plataforma, caché de metadatos, clientes de búsqueda/catálogo/stream, mapping de perfiles y acciones de pistas compatibles. El core headless compila en macOS arm64 y sus 14 CTests pasaron el 2026-09-09. El build con sanitizers falló al enlazar el runtime: es un defecto de implementación pendiente de corregir.

El cliente de perfiles y el negociador de capabilities siguen aislados del adaptador real. La consulta de compatibles está conectada; faltan consulta/validación de planes y máquina de estados C. Un callback de mock correcto, una URL generada o un bundle cargado no prueban reproducción efectiva en un deck. La evidencia registrada acredita carga de bundles en macOS arm64; búsqueda/carga desde la UI, cancelación, descarga limpia, comandos, intervención manual, reinicios, Windows/Intel y soak siguen siendo gates pendientes salvo que se incorpore evidencia posterior.

### Conexión, compatibilidad y autorización

Ambos binarios negocian antes de exponer operaciones privadas: disponibilidad de la integración, rango exacto de contratos API, versiones del plugin, schemas de perfiles, versiones de analyzer/planner y flags opcionales. El objetivo unificado es contrato API `2026-09`, formato de perfil versión `1` con campos aditivos seguros, analyzer `smart-mix-audio-v2` y planner `smart-mix-v2`; los fixtures antiguos se mantienen para pruebas intencionales de compatibilidad/fallback. Un contrato no se acepta simplemente porque su string tenga contenido. Online Source sigue disponible si Assistant/Automation no lo están, siempre que su contrato propio sea compatible. Una versión desconocida de perfil/plan deshabilita esa capacidad. Packaging, versión del runtime y handshake usan un único valor generado por el build.

Se revalidan capabilities al conectar, cambiar credenciales/origen y mediante una actualización periódica acotada. Automation obtiene además `GET /api/vdj/automation-lease` con scope `vdj.automation.execute`. El servidor comprueba PAT, flags y revocación; la propuesta es TTL de 15s y refresco cada 5s fuera de callbacks de audio/UI, sujeto a mediciones del host/red. General valida el lease inmediatamente antes de armar y de cada comando. Un lease caducado, kill switch o fallo de autenticación impide nuevas operaciones automáticas. La evidencia de release registra el plazo máximo de propagación de desactivación. Desactivar Automation preserva la reproducción manual y Online Source cuando este siga disponible.

Los PAT solo se aceptan en rutas con scopes explícitos. P02/P03 son dueños de allowlist, caducidad/revocación, rotación, separación de privilegios y lease. Añadir una identidad VDJ al objeto de sesión ordinario no autoriza rutas ajenas de Listen/Admin. El flujo de conexión ofrece origen, pegado/sustitución de token, verificación y desconexión mediante un diálogo nativo pequeño; no requiere una skin SideView. Listen proporciona creación/listado/rotación/revocación mediante la API de access tokens. No se guardan secretos en configuración, SQLite, logs, URLs ni telemetría.

### Ciclo de vida nativo, latencia y cancelación

HTTP, parsing JSON, SQLite, descarga/descifrado de audio y escritura de diagnósticos se ejecutan fuera de callbacks de audio/UI. Las consultas de estado y comandos SDK se despachan únicamente en el contexto/hilo admitido por el host. El [SDK Online Source](https://virtualdj.com/wiki/Plugins_SDKv8_OnlineSource.html) permite explícitamente `OnSearch` síncrono; eso no demuestra en qué hilo ejecuta cada callback el host. Se verifican afinidad y ownership con SDK privado y host real, y se usan las semánticas asíncronas admitidas para búsquedas/carpetas con red. Si resolver streams exige una llamada síncrona, se precalienta la resolución y se fija un deadline en el contexto de carga admitido; no se inicia una petición sin límite en audio/UI.

Cada petición posee generación, token de cancelación y estado de finalización. Sustituirla cancela la anterior. Una respuesta tardía no puede borrar la petición nueva, añadir resultados, llamar a `finish`, tocar una lista SDK liberada ni publicar una URL. Cancelación y publicación se serializan en un coordinador; no se deja una ventana entre comprobar y publicar. La descarga del plugin impide nuevo trabajo, cancela lo activo y drena workers antes de terminar la vida de callbacks/listas SDK. Los tests ejercitan el adaptador de producción a través de un SDK falso, además del core puro.

Se utiliza un único parser JSON mantenido, con límites de profundidad/body/colecciones y validadores de modelos tipados; se toleran campos aditivos desconocidos. Se cubren escapes Unicode, pares sustitutos, opcionales null, números fuera de rango, JSON malformado y versiones incompatibles. libcurl limita el body antes de añadir bytes. Los diagnósticos reciben errores tipados normalizados y eliminan secretos en la frontera; no basta invocar un helper de sustitución sin proporcionarle qué debe eliminar.

### A — Online Source local completo

Se conservan `/api/search?scope=local`, `/api/vdj/catalog/folders`, `/api/vdj/catalog/folders/{folder_id}`, `/api/vdj/tracks/by-entity/{uid}/playback`, `/api/auth/media-access` y `/api/vdj/tracks/by-entity/{uid}/stream`. Estas rutas existentes del piloto siguen siendo adaptadores ligeros sobre servicios compartidos de catálogo/media. P04 añade artistas y álbumes a playlists, géneros, moods y escuchado recientemente; cada resultado de búsqueda abre una carpeta o pista utilizable. Los cursores opacos estables vinculan consulta/filtros/orden/cuenta. Una petición acotada expone una carpeta/acción de continuación, sin truncar silenciosamente a 500 pistas.

Un resolver de artwork común sirve búsquedas, carpetas y compatibles. El SDK recibe una URL HTTP(S) absoluta válida o una referencia local validada en host; nunca una ruta `/api/...` sin resolver. La autorización es explícita mediante tickets de artwork breves u otro mecanismo probado; no se hace público artwork privado para evitar limitaciones de headers del SDK. Las URLs firmadas solo viven en memoria y se reconstruyen desde identidades neutras de caché tras autorizar.

La resolución de stream valida identidad, localidad, disponibilidad y formato de playback; no basta un body no vacío. Los tickets son específicos para la ruta, breves y se comprueban contra permisos actuales de usuario/token en nuevas peticiones. Range/seek, reanudación después de caducar el ticket, un refresco acotado y revocación se prueban con el comportamiento HTTP real del host. Que el plugin devuelva una URL no acredita TLS, descarga, seek ni continuidad de un deck cargado durante un corte. La revocación impide nuevas autorizaciones/cargas; no retira bytes ya cargados ni justifica interrumpir una actuación manual.

La caché de metadatos usa scope de nodo/cuenta verificado, TTL, límites de bytes/entradas, LRU, recuperación de corrupción y estado stale explícito. Solo red/timeout y 5xx transitorios aprobados permiten fallback stale; 401/403, cancelación, contrato incompatible y consulta/cursor rechazados nunca se convierten en éxito de caché. No se persisten rutas de audio ni URLs firmadas. Los cambios de credenciales revalidan autorización e invalidan lo apropiado sin filtrar datos entre usuarios.

### B — Asistente y planes

El adaptador consume perfiles resumidos, muestra BPM/key/Camelot, confianza, energía y cues mediante superficies nativas validadas, y explica perfiles ausentes o con baja confianza. Conserva orden/breakdown del backend, admite semilla explícita y pista Crate cargada realmente, y ofrece una acción Open in Crate funcional.

Obtiene planes inmutables desde `/api/playback/transition-plans`. Valida ambos entity UIDs, revisiones de perfiles, versión de planner/schema, modo, límites de cues/duración/gain/tempo/phase, disponibilidad, generaciones de carga de cada deck y revisión de cola/contexto. La ejecución no soportada se expresa como fallback tipado; el cliente no reescribe el plan silenciosamente. Los planes son propuestas hasta que General valida el estado actual inmediatamente antes de ejecutarlos.

### C — Ejecutor protegido

Se representan disabled, armed, assisted, automatic, cancelled y fallback como modos/estados de producto, separando las fases de ejecución: idle, resolving, preloading, waiting-ready, validating, syncing, transitioning y observing-completion. Un ID de ejecución inmutable relaciona comandos, deadlines y observaciones con un snapshot concreto de decks/perfiles. Solo se prepara el deck libre verificado. Pista no Crate, identidad desconocida, perfil cambiado, destino ausente, lease obsoleto o comando no soportado impiden ejecución automática.

Los comandos proceden de una allowlist local acotada generada desde intenciones validadas; nunca se acepta VDJScript arbitrario del servidor. Los acknowledgments se verifican observando estado. Interacción manual o cambio de generación invalida inmediatamente la ejecución. Cancelar detiene comandos futuros y scheduling del host iniciado por el plugin mediante el mecanismo SDK probado; no restablece fader, tempo ni deck a un snapshot anterior. `auto_crossfade`/`auto_bpm_transition` ya enviados pueden seguir ejecutándose en el host: su interrupción efectiva es un gate obligatorio. Detener el bucle C++ no equivale a devolver el control de forma segura.

No se promete precisión de sample antes de medirla. Se miden precarga/readiness, acknowledgment, tempo/phase resultantes, instante audible de transición, latencia de cancelación, memoria y duración de callbacks. Se combinan tests deterministas con hosts reales de dos/cuatro decks, red degradada y soak de cuatro horas. Si un comando no cede el control con seguridad, se deshabilita ese modo y se revisa su mapping antes de declarar C completo.

### Extensiones conservadas como parte de la misma feature

Radio reutiliza sesiones existentes de Crate con candidatos locales. Los overrides de cues son privados y versionados, separados de cues automáticos compartidos. Heartbeat best effort cada 30s con TTL90s; play events mediante el repositorio existente, umbral audible, idempotencia y spool acotado. Ningún fallo de telemetría bloquea un deck. P06 es dueño de implementar este backend; V07 integra exclusivamente su cliente nativo y verifica el contrato.

La caché opcional de audio cifrado y la precarga de las tres siguientes pistas siguen siendo entregables. La persistencia se cifra con una primitiva auditada y clave en el almacén del sistema; límites de bytes/edad/LRU y pinning de decks activos son obligatorios. Primero se demuestra cómo carga VirtualDJ el archivo local sin daemon: se valida una referencia privada local/file devuelta por Online Source. Si descifrar requiere un archivo temporal en claro, se documenta como materialización privada limitada al deck activo, con permisos restrictivos, sin indexar su ruta en metadatos/logs, borrado al liberar el pin y limpieza tras crashes. No se promete cifrado de memoria de reproducción ni borrado seguro en SSD. Si el host no acepta el mecanismo, se resuelve expresamente la frontera SDK; no se añade silenciosamente un daemon HTTP ni se declara offline completo.

Los filtros BPM/Camelot/energía/analysis-required y paginación siguen siendo aditivos a Listen; P04 implementa su backend y V09 conecta la UI/cliente nativo y la verificación continua. Readplane es condicional a SLOs medidos de FastAPI y paridad exacta de autenticación/cursores/orden. VDJ debe funcionar mediante FastAPI en producción antes de acelerar opcionalmente con Go. Los tags `vdj-v*` siguen independientes de Crate `v*`, con paquetes firmados Windows x64/macOS Intel/macOS arm64 y fixtures de compatibilidad.

## 7. Gates y cierre de la feature

Los valores siguientes son objetivos de aceptación; la revisión no los ha medido todavía. El [plan](smart-mix-implementation-plan.md) contiene protocolo, muestras, dispositivos, comandos y registro de resultados.

| Gate              | Criterio                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Planning          | p95 cached <50ms, uncached <150ms, compatibles <250ms con 48K tracks y concurrencia declarada                                                 |
| Exactitud         | Ningún cue/handoff fuera de duración; ningún double advance; ninguna fuga de identidad/scopes; fixtures cross-language                        |
| Audio adaptive    | Cero clipping en corpus, true peak combinado ≤−1dBTP; tasa de transiciones con underrun <0.5%; memoria ≤1.5× baseline single deck equivalente |
| Beatmatch Android | Error de fase absoluto p95 ≤20ms en captura externa ≥48kHz, rutas certificadas, corpus fijo/drift; no inferido de timers                      |
| Android lifecycle | Una sesión/notificación y controles continuos; matriz background/focus/offline/auth/route/process completa                                    |
| VDJ C             | Ningún comando sobre deck ajeno/obsoleto tras takeover; cancelación de scheduling del host demostrada; latencias máximas medidas y aceptadas  |
| Distribución      | Winx64, macOS Intel/arm64 firmados, matriz de versiones declarada,4h soak y rollback demostrado                                               |

La entrega puede avanzar por hitos: foundation segura → Android adaptive + VDJ A → Android beat-aware + VDJ B → C/extensiones → release conjunta. El desarrollo de A/B puede avanzar en paralelo al laboratorio Android; no espera innecesariamente a su gate de fase. La feature completa solo se cierra con todos los entregables requeridos y su evidencia. Un gate fallido mantiene la tarea pendiente/bloqueada; cambiar el alcance exige editar explícitamente estos dos documentos, no renombrar trabajo incompleto como opcional.

Rollout conserva switches separados: Smart Mix backend, Android adaptive, beatmatch, bass, fuente VDJ y C. Se deshabilita primero el modo afectado; rollback de binarios compatibles no ejecuta automáticamente downgrade destructivo de perfiles/tokens/cues. Usuarios y operadores deben poder desactivar desde Settings/flags y conservar reproducción ordinaria. Los detalles operativos y el registro de cambios de decisiones viven en el plan.
