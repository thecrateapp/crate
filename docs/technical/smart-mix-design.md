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
- **VirtualDJ (licencia Pro):** A, fuente local; B, asistencia con el ranking de Crate; C, Crate Automix: Crate ordena la cola y el automix nativo de VirtualDJ mezcla.

Forman parte de las releases R1–R4 los tokens y su UI, catálogo VDJ con carpetas y búsqueda con filtros, caché de metadata, play events, observabilidad, CI, paquetes y rollout/rollback. La caché de audio cifrada con prefetch, cues privados, radio y presencia en VDJ, y los summaries de federación están en el backlog del plan: el diseño de este documento sigue siendo su referencia cuando entren en una release.

**Fuera del alcance:** otro algoritmo de ranking por cliente, Rekordbox, edición de XML/base de datos interna de VirtualDJ, daemon local/IPC, UI SideView personalizada, un motor de transiciones propio dentro de VirtualDJ, streaming federado en VDJ v1, Jam/colas colaborativas y cambiar los motores web/iOS/desktop. Los summaries federados sirven para interoperabilidad y degradación segura; no habilitan beatmatch remoto completo.

### 1.2 Estado comprobado

| Bloque         | Base aprovechable                                                                                                                       | Lo que impide considerarlo terminado                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smart Mix core | Modelos, codec de grid, Python/Rust, migración 104, persistencia, backfill, planner, ranking, API/caché, cobertura Admin y summaries Go | Semántica de mediciones, límites temporales, publicación/revisiones, reanálisis por generación, rendimiento y validación musical                                 |
| Android        | Dos decks Media3, facade estable, MediaSession, controller, procesador de ganancia, bridge y tests                                      | Plan de red bloqueante, cue/buffer de standby, trigger tardío, envelope dependiente del hilo principal, settings y gates físicos; tempo/phase/bass no ejecutados |
| VirtualDJ A+B  | Core C++20, HTTP, stores del SO, caché, clientes, compatible folder y adapter de spike                                                  | Handshake sin integrar, lifecycle/cancelación, catálogo incompleto, media real sin aceptación, presentación B parcial                                            |
| VirtualDJ C    | Pruebas de comandos de deck 1 en spike                                                                                                  | Rediseñado como Crate Automix sobre el automix nativo (§6.7); pendiente del gate VH01                                                                            |
| Plataforma VDJ | WIP PAT/API/migración 105, tickets asociados al token, rutas de catálogo/media                                                          | Permisos de escritura, auth hot path, proxy prod/home, gates efectivos, UI usuario y extensiones                                                                 |
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

| Scope                    | Operaciones autorizadas                                                    |
| ------------------------ | -------------------------------------------------------------------------- |
| `vdj.catalog.read`       | Buscar/browse local y metadata permitida                                   |
| `vdj.media.read`         | Resolver playback y tickets/streams correspondientes                       |
| `vdj.smart_mix.read`     | Perfiles, compatibles, planes y lectura de cues propios                    |
| `vdj.play_events.write`  | Play events y presencia propios                                            |
| `vdj.automation.execute` | Usar Crate Automix (añadir pistas a la cola de automix de VDJ)             |
| `vdj.cues.write`         | Backlog; retirado para VDJ (§6.8)                                          |
| `vdj.radio`              | Backlog: radio propia como fuente de Crate Automix, con candidatos locales |

El permiso WIP `vdj.automation` no se interpreta automáticamente como el nuevo `.execute`. P01/P02 definen migración visible y reemisión/reasignación expresa; no añaden scopes a tokens existentes. `/api/auth/me` tiene rama de identidad PAT explícita y mínima. Crear/rotar/revocar tokens sigue exigiendo sesión interactiva propia; un PAT no adquiere poderes Admin por el rol de su usuario.

No hay lease de automatización: Crate Automix no ejecuta comandos de mezcla, solo añade pistas a la cola de VDJ, y comprueba flag y scope antes de cada pista (§6.3). Una pista ya encolada o una transición ya iniciada por VDJ siguen bajo control de VDJ y del usuario.

### 2.4 Límites iniciales y autorización de caché

Estos son defaults objetivo que P01 fija en fixtures/configuración; los presupuestos operativos pueden ajustarse con mediciones registradas, sin relajar identidad ni scopes.

| Recurso            | Límite inicial                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan HTTP          | 32 edges por batch; Android precarga 3 y no espera más de 1s por planificación                                                                             |
| Ranking/browse     | 500 candidatos elegibles; 50 resultados por search; 500 pistas por carpeta VDJ, con partes numeradas para playlists más largas                             |
| JSON nativo        | 2MiB por respuesta de catálogo/planes/summary, profundidad32; full profile hasta8MiB solo si se solicita explícitamente; abortar antes de crecer el buffer |
| Cursor             | No aplica a VDJ: el SDK no tiene paginación                                                                                                                |
| Caché metadata     | 100MiB/50K entradas, TTL24h; stale solo ante transporte/5xx y con estado visible, nunca401/403/cancel                                                      |
| Caché audio opt-in | Backlog; solo si VH01 confirma rutas locales en `GetStreamUrl`. Referencia: 5GiB, 7d, LRU, 2 descargas y 3 precargas, sin expulsar decks activos           |
| Permiso offline    | Backlog, ligado a la caché de audio: carga desde caché hasta `offlineEligibleUntil`, máximo 24h y nunca después de expirar el PAT                          |
| Presencia/spool    | Heartbeat30s, TTL90s; spool de eventos≤1000 entradas/24h; sin secretos, por cuenta/nodo                                                                    |

Cuando la caché de audio entre del backlog, P05 añadirá `offlineEligibleUntil` e identidad de token/revisión de fuente/usuario/nodo a la resolución de playback autorizada. Una caída de red permitirá carga manual de audio previamente autorizado dentro de ese plazo; una revocación/403 observada bloqueará nuevas cargas y purgará material no fijado. Ninguna de estas situaciones corta el audio ya cargado.

El presupuesto físico de esa caché incluirá ciphertext, descargas parciales y materialización temporal en claro, reservando espacio antes de descargar y sin expulsar decks activos.

La retención no implica permiso de reproducción. Es control de acceso y almacenamiento de Crate, no una promesa DRM contra el dueño del equipo. No se introducen PAT largos en URLs ni un servidor local para resolver restricciones del SDK.

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

Añadir `duration_ms` persistido desde el decoder a `track_mix_profiles`: actualmente se descarta y se reconstruye desde `library_tracks.duration`. Añadir los límites activos `active_start_ms` / `active_end_ms`, `integrated_lufs` y `measurement_version` como columnas opcionales con sus campos wire aditivos. La migración es nueva; no reescribe la 104 ni la 105 de esta rama. Se elige el siguiente número libre al comenzar la implementación y se verifica la cadena de Alembic.

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
- Mantener los scopes actuales de datos/telemetría `vdj.catalog.read`, `vdj.media.read`, `vdj.smart_mix.read` y `vdj.play_events.write`; el contrato final `2026-09` utiliza `vdj.automation.execute` para Crate Automix. `vdj.radio` se añade cuando la radio entre del backlog; `vdj.cues.write` queda retirado para VDJ. Los tokens existentes no reciben nuevos scopes implícitamente. El nombre WIP `vdj.automation` se registra como permiso legacy explícito: no autoriza Crate Automix ni funciona como alias que eleve permisos. El propietario debe reemitir el token o realizar una nueva asignación explícita de `vdj.automation.execute`. Las definiciones, etiquetas de UI y tests negativos comparten un único contrato revisado.
- Las lecturas de catálogo requieren catalog scope; playback/tickets/streams requieren media scope; perfiles/pistas compatibles/planes y lectura de cues privados requieren Smart Mix read scope; play events y now-playing requieren telemetry scope; start/next/feedback/end de radio requerirán radio scope. Crate Automix necesita `vdj.automation.execute` además de los scopes de catálogo, media y Smart Mix que usa.
- Crear/listar/rotar/revocar tokens seguirá requiriendo una sesión interactiva persistida, comprobando su propietario. Un PAT no puede crear o rotar credenciales, editar el perfil del usuario ni obtener derechos Admin por el rol de su propietario.
- Soportar `GET /api/auth/me` como contrato PAT explícito de identidad para validar el login del plugin y mostrar la cuenta. Devolver la identidad mínima revisada y los permisos VDJ efectivos; conservar la respuesta existente para sesiones/JWT. `GET /api/capabilities` sigue siendo el contrato público de servidor/versiones. No resolver el login del plugin abriendo todo `/api/auth/*`.
- Añadir gestión de tokens por el propio usuario en Settings de Listen, accesible a usuarios normales. Admin Settings requiere permisos de gestión y `/profile` redirige actualmente; no puede ser la única forma de conectar VirtualDJ. La UI de conexión del plugin recoge URL de servidor y token, valida identidad/capabilities y almacena el token únicamente en el almacén de credenciales de la plataforma. Se mantiene el login/OAuth existente de navegador y clientes nativos.
- Guardar únicamente digest y prefijo del token en PostgreSQL. Mostrar el secreto sólo tras create/rotate; nunca persistirlo en navegador, logs, URLs, analítica, caché de metadata/audio o diagnósticos de fallos. Los PAT se autentican mediante Authorization; las peticiones media del SDK usan tickets acotados.
- Comprobar expiración/revocación del token y estado del usuario en cada nueva petición autorizada sin bloquear su fila en cada lectura. Utilizar una actualización condicional y limitada de `last_used_at`; conservar el bloqueo transaccional para rotación/revocación donde sea necesario. La revocación afecta a las decisiones de autorización posteriores, no cancela retroactivamente una respuesta ya autorizada.

### Routing, flags y rollback

- Mantener las peticiones de catálogo/perfiles con PAT opaco en FastAPI, en producción, home y desarrollo, hasta que una decisión basada en mediciones justifique paridad en Go. Aplicar el bypass de Authorization PAT antes de las rutas canónicas del readplane, incluidos `/api/search`, `/api/auth/me` y `/api/tracks/by-entity/.../mix-profile`. Mantener los aliases VDJ de artwork/media en FastAPI cuando no lleven Authorization. Preservar el routing de sesiones/JWT existente.
- No usar un fallo de autenticación como reintento implícito en otro backend: credenciales inválidas/revocadas siguen produciendo 401, ausencia de scope produce 403 y una caída del backend sigue la política explícita de disponibilidad/fallback. El readplane sólo entiende sus contratos de credenciales soportados hasta que se implemente paridad. No enviar tickets ligados a tokens a su parser de tickets de sesión.
- Aplicar los flags del servidor a las nuevas operaciones PAT. `CRATE_VDJ_ENABLED=false` impide nuevo trabajo VDJ de catálogo/media/asistente/automatización. El flag independiente de automatización detiene nuevo trabajo automático mientras A+B siguen disponibles. La disponibilidad de Smart Mix y los scopes requeridos restringen adicionalmente las funciones efectivas. Listar/revocar tokens y diagnosticar la conexión siguen disponibles para recuperación.
- Crate Automix comprueba `vdj.automation.execute`, el flag de automatización y las capabilities antes de añadir cada pista a la cola de VDJ. Desactivarlo detiene nuevas adiciones; lo que VDJ ya tiene en cola o está mezclando sigue bajo control de VDJ y del usuario.
- La revocación del servidor no puede detener un proceso offline ni recuperar bytes ya entregados. Al observar revocación o un flag desactivado, el plugin deja de resolver streams nuevos y de encolar pistas; no descarga decks ni envía comandos de mezcla.
- Mantener independientes las releases del stack, las del plugin, el contrato API, el schema de perfiles y la versión del planner. El contrato integrado final es `2026-09`; el perfil mantiene schema `1` con metadata aditiva de duración/origen/medición y codificación de beat-grid `delta-ms-v1`; el analyzer es `smart-mix-audio-v2` más su identificador de implementación; el planner se identifica como `smart-mix-v2`. Los campos opcionales nuevos son aditivos. Versiones requeridas desconocidas deshabilitan la función dependiente en vez de parsearse de forma optimista. El rollback deshabilita nuevo trabajo y despliega los binarios compatibles anteriores sin hacer downgrade automático ni borrar perfiles, planes, tokens o cues persistidos.

### Catálogo, media y extensiones

- Carpetas VDJ de un nivel, porque el SDK no admite subcarpetas ni paginación: una carpeta por playlist autorizada (pistas ordenadas, partes numeradas si supera 500), Géneros, Moods, Escuchado recientemente y Compatibles. Artistas y álbumes se recorren con la búsqueda (`artist:`, `album:`) y con entradas de menú contextual. IDs opacos estables identifican entidades; propietario/membresía de playlists y visibilidad de playlists de sistema reutilizan las reglas existentes.
- Limitar la primera release VDJ a contenido local reproducible. Una búsqueda PAT no puede ampliar silenciosamente su acceso a búsqueda federada/global cambiando `scope`. Reutilizar taxonomía normalizada y fallbacks de metadata de manera consistente en SELECT y WHERE, incluyendo `album_genres` cuando los tags de pista/álbum estén vacíos.
- La búsqueda DJ acepta filtros como sintaxis dentro del texto (`bpm:120-128`, `key:8A`, `energy:`, `analyzed:no`) además de `fields=dj`, con 50 resultados como máximo. La búsqueda ordinaria de Listen conserva su comportamiento. VDJ no usa cursores.
- Resolver playback a partir de identidad local justo antes de usarla. Respetar la política de entrega y el estado de preparación devueltos, sin inventar una URL de stream a partir de una respuesta no parseada. Conservar el alias de transporte VDJ si routing/SDK lo requieren, respaldado por la misma implementación de playback/media y probado contra la ruta canónica.
- Los covers de álbum ya son públicos en Crate y VDJ persiste la URL que recibe: el plugin pasa la URL absoluta pública, sin ticket. Los tickets de media conservan ruta normalizada exacta, audiencia e identidad del token, y se comprueban estado del token padre y media scope en cada request, incluidos HEAD y Range.
- VDJ descarga la pista completa al cargarla, así que el TTL del ticket cubre la descarga inicial (valor inicial 15 minutos). Si VH01 muestra requests Range después de caducar el ticket, V04 implementa el mecanismo que el gate valide (re-resolución o ruta local) antes de cerrar A; no se introduce un PAT de larga duración en la URL. El audio ya descargado no se detiene por una caída o revocación; las cargas nuevas sin autorización se deniegan.
- Reutilizar `POST /api/me/play-events` y `app/crate/db/repositories/user_library_playback_writes.py`, incluida la idempotencia existente `(user, client_event_id)`. Reintentar eventos aceptados no duplica historial, métricas, cambios de perfil ni scrobbles. VDJ aporta IDs de evento estables, duración audible y contexto de deck/sesión; la telemetría nunca bloquea playback.
- Backlog (P06): overrides privados de cues con control de revisión para clientes distintos de VDJ, que ya persiste sus propios cues; presencia now-playing. Referencia para cuando entren: sin sobrescribir los cues automáticos globales. Cuando un override participe en planificación, resolverlo para el usuario actual y vincular el plan inmutable a la revisión de cues además de las revisiones de perfiles; las cachés globales/compartidas de planes no pueden exponer ni reutilizar cues privados de otro usuario. Añadir presencia now-playing acotada por usuario/cliente/deck, con heartbeat de 30 segundos y expiración de 90 segundos ya aceptados. Persistir play events mediante el repositorio existente; la presencia es efímera.
- Backlog (P06): radio como fuente de Crate Automix. Reutilizar `/api/radio/start`, `/api/radio/next`, `/api/radio/feedback`, `/api/radio/can-discover` y `/api/radio/session/{session_id}`. Comprobar propietario de la sesión en next/feedback/end en API y servicio, además de la creación. Los candidatos VDJ siguen siendo locales; next concurrentes, expiración, cancelación y feedback no pueden mutar sesiones ajenas. Extender el servicio actual en vez de crear otro motor de radio VDJ.

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

## 6. VirtualDJ: Online Source, Assistant y Crate Automix

### 6.1 Lo que permiten el SDK y el host

El SDK oficial vigente es el de 2021-10-03 (`vdjPlugin8.h`, `vdjDsp8.h`, `vdjVideo8.h`); `vdjOnlineSource.h` solo se publica en la [wiki de Online Source](https://virtualdj.com/wiki/Plugins_SDKv8_OnlineSource.html). Las copias de terceros fechadas en 2025 no añaden miembros. Este diseño se ajusta a esa superficie; cualquier capacidad marcada "por verificar" la cierra el gate de host VH01 del plan antes de que una tarea dependa de ella.

| Capacidad                    | Estado                                                                                                                                  | Consecuencia para el diseño                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Licencia                     | Online Sources y plugins AutoStart solo funcionan con licencia Pro ([Example7](https://virtualdj.com/wiki/Plugins_SDKv8_Example7.html)) | Requisito explícito del plugin; los usuarios Home no pueden usarlo                                                      |
| Búsqueda                     | Síncrona o asíncrona (`S_FALSE` + `finish()`), con `OnSearchCancel`                                                                     | Búsqueda asíncrona con coordinador de generaciones                                                                      |
| Carpetas                     | `GetFolderList` sin carpeta padre; `GetFolder` solo devuelve pistas; sin paginación                                                     | Un nivel de carpetas con tope; navegación por artista/álbum mediante búsqueda. Asincronía de `GetFolder`: por verificar |
| Metadata de pista            | title, artist, remix, genre, label, comment, cover URL, duración, BPM, key 1–24, año                                                    | Sin álbum, energía, Camelot, cues ni grid: se presentan en columnas existentes                                          |
| Stream                       | `GetStreamUrl` síncrono por carga; solo devuelve una URL, sin cabeceras                                                                 | Autorización dentro de la URL mediante ticket de ruta exacta                                                            |
| Descarga                     | VDJ descarga la pista completa al cargarla; FLAC verificado en host                                                                     | El ticket debe cubrir la descarga inicial; seek/Range con ticket caducado: por verificar                                |
| Ruta local en `GetStreamUrl` | Funciona en plugins de terceros, no documentado                                                                                         | Condición previa de la caché de audio (backlog)                                                                         |
| Identidad en deck            | `netsearch://plugin-<NombrePlugin>/<uniqueId>`, verificado en `database.xml`                                                            | Nombre del plugin y `uniqueId` (entity UID) son contrato permanente                                                     |
| Análisis propio              | VDJ analiza las pistas online y persiste BPM, fase, key y POIs de automix por pista                                                     | Dentro de VDJ mandan el grid y la key de VDJ                                                                            |
| Cover                        | VDJ persiste la URL de cover en `database.xml`                                                                                          | Solo URLs absolutas sin credenciales; los covers de álbum de Crate ya son públicos                                      |
| Login                        | `IsLogged`/`OnLogin`/`OnLogout`; `IVdjOAuth` con `redirect_uri` fijo en `live.virtualdj.com`                                            | Diálogo nativo propio abierto desde `OnLogin` para pegar el token; OAuth integrado fuera de v1                          |
| VDJScript                    | `SendCommand`/`GetInfo`/`GetStringInfo` desde cualquier plugin, incluida la Online Source                                               | No hace falta un segundo binario para leer decks o encolar pistas                                                       |
| Eventos y timers             | No existen; solo polling desde un hilo propio                                                                                           | Polling acotado; seguridad de `SendCommand` fuera del hilo del host: por verificar                                      |
| Motor de mezcla              | `automix`, `automix_add_next`, `playlist_add`, `mix_next`, `mix_now`, `mix_and_load_next`, `goto_mixpoint`, `sync`, `is_using`          | C delega la mezcla en el automix nativo                                                                                 |

### 6.2 Responsabilidades y binario

Crate es la autoridad sobre identidad de pistas, autenticación, ranking de compatibilidad y orden de cola. VirtualDJ controla decks, análisis de beatgrid/key, transiciones, procesamiento de audio y controles del usuario. C++ no copia algoritmos de análisis, pesos de ranking ni políticas del planner, y tampoco reproduce un motor de transiciones que VDJ ya tiene.

Por defecto se distribuye un solo binario Online Source, `Crate`, que implementa A, B y C: la Online Source puede lanzar su propio hilo y usar VDJScript. Un segundo binario AutoStart solo se añade si VH01 demuestra que la Online Source no permanece cargada mientras el usuario mezcla. El nombre del plugin (`Crate`) y el `uniqueId` (entity UID) no cambian nunca: VDJ indexa por ellos su análisis, sus cues y su historial, y un cambio deja huérfanas esas entradas.

`spike/control_spike.cpp` queda como herramienta de desarrollo, excluida de los targets distribuibles. Los adaptadores de producción residen en `src/sdk/` y `src/online_source/`; la lógica de C en `src/automix/`.

### 6.3 Conexión, compatibilidad y autorización

El usuario crea un token desde Settings de Listen. `OnLogin` abre un diálogo nativo pequeño (NSWindow en macOS, ventana Win32 en Windows) con origen y token; `IsLogged` refleja el estado verificado y `OnLogout` borra la credencial. La configuración sin secretos se guarda por origen normalizado; el token solo en Keychain o Credential Manager. Una instalación sin configurar queda desconectada: no existe origen por defecto. El OAuth integrado del SDK queda fuera de v1 porque exige un servidor OAuth2 en Crate y hace pasar el código por el relay de Atomix.

Antes de exponer operaciones privadas el plugin negocia capabilities: disponibilidad de VDJ, rango de contratos API, versiones de perfil y planner, y flags. Online Source sigue disponible si el asistente o Crate Automix no lo están. Versión del binario, handshake y manifest salen de un único valor generado por el build. Las capabilities se revalidan al conectar, al cambiar credenciales y con un refresco periódico acotado. No hay lease: Crate Automix comprueba el flag de automatización y el scope antes de cada pista que añade a la cola de VDJ; si se desactiva, deja de añadir pistas y no toca lo que VDJ ya está mezclando.

### 6.4 Ciclo de vida nativo, latencia y cancelación

HTTP, parsing JSON, SQLite y diagnósticos se ejecutan fuera de los callbacks del host. La búsqueda usa el modo asíncrono del SDK; si VH01 demuestra que `GetFolder` lo admite, las carpetas también, y si no, se sirven desde la caché de metadata con refresco en segundo plano y un deadline corto. `GetStreamUrl` es síncrono: el plugin precalienta la resolución del ticket y fija un deadline.

Cada petición tiene generación, token de cancelación y estado de finalización. Una respuesta tardía no puede añadir resultados, llamar a `finish` dos veces, tocar una lista liberada ni publicar una URL. Todas las llamadas VDJScript del hilo de Crate Automix pasan por un único worker serializado; si VH01 demuestra que el host no acepta `SendCommand` desde ese hilo, se canalizan por el mecanismo que el gate valide. La descarga del plugin impide nuevo trabajo, cancela lo activo y drena workers antes de `Release`.

Un único parser JSON mantenido, con límites de profundidad, body y colecciones y validadores tipados, tolera campos aditivos. libcurl limita el body antes de añadir bytes. Los diagnósticos eliminan secretos en la frontera.

### 6.5 A — Online Source local

Rutas: `/api/search?scope=local`, `/api/vdj/catalog/folders`, `/api/vdj/catalog/folders/{folder_id}`, `/api/vdj/tracks/by-entity/{uid}/playback`, `/api/auth/media-access` y `/api/vdj/tracks/by-entity/{uid}/stream`.

Carpetas de un nivel: Playlists del usuario (una carpeta por playlist), Géneros, Moods, Escuchado recientemente y Compatibles con la pista cargada. Cada carpeta devuelve como máximo 500 pistas ordenadas; una playlist más larga se reparte en partes numeradas. La navegación por artista o álbum se hace con la búsqueda y una sintaxis documentada (`artist:`, `album:`, `bpm:120-128`, `key:8A`), y con entradas de menú contextual ("Más de este artista", "Este álbum") que lanzan esa búsqueda. No se implementan cursores para VDJ.

La resolución de stream valida identidad, localidad, disponibilidad y formato antes de emitir el ticket. El ticket va en la URL, ligado a la ruta exacta y a la identidad del token, y su TTL cubre la descarga inicial de la pista (valor inicial 15 minutos, ajustable con la medición de VH01). Cada request comprueba revocación y scope; la revocación impide nuevas cargas y no retira bytes ya descargados. Si VH01 muestra que VDJ hace requests Range después de caducar el ticket, se añade el mecanismo que el gate valide (re-resolución o ruta local) antes de cerrar A.

Los covers usan la URL absoluta pública de Crate, sin ticket, porque VDJ la persiste. La caché de metadata usa scope de nodo/cuenta, TTL, límites, recuperación de corrupción y estado stale explícito; 401/403, cancelación y contrato incompatible nunca se convierten en éxito de caché.

### 6.6 B — Asistente

La carpeta Compatibles usa el ranking del backend con la pista cargada o una semilla explícita del menú contextual. BPM y key de Crate se pasan en los campos del SDK; Camelot, energía y confianza se muestran en `comment`, con un formato fijo y localizado. Cuando VDJ analiza la pista muestra sus propios valores: la presentación no compite con ellos. "Abrir en Crate" abre el navegador desde el menú contextual. El plugin no consume `TransitionPlan`: dentro de VDJ las transiciones las calcula el motor de VDJ con su propio grid.

### 6.7 C — Crate Automix

Crate Automix es opt-in y usa el automix nativo de VDJ. El plugin obtiene de Crate el orden de las siguientes pistas (compatibles desde la pista que suena; radio cuando entre del backlog) y las añade a la cola de automix con los verbos validados en VH01 (`automix_add_next`/`playlist_add` con rutas `netsearch://plugin-Crate/<uid>`). VDJ decide el punto y la forma de cada transición con sus POIs de automix, su grid y su sync; la intervención manual es la que VDJ ya gestiona.

El plugin mantiene la cola con pocas pistas de antelación (valor inicial 2), las sustituye si cambia la pista que suena y deja de añadir al desactivarse el flag, el scope o la preferencia. Nunca envía comandos de crossfader, tempo, EQ o play: no hay estados de ejecución propios que cancelar ni takeover que detectar. Los play events se obtienen con polling acotado de `get_filepath`, `is_audible` y `get_time` por deck.

### 6.8 Extensiones en backlog

Siguen en el backlog del plan, con este diseño como referencia cuando entren en una release: radio de Crate como fuente de Crate Automix, presencia now-playing, caché de audio cifrada con prefetch (solo si VH01 confirma que `GetStreamUrl` acepta rutas locales) y OAuth integrado. Los cues privados por usuario se retiran para VDJ: VDJ ya persiste cues y POIs por pista online en su propia base de datos.

## 7. Gates y cierre de la feature

Los valores siguientes son objetivos de aceptación; la revisión no los ha medido todavía. El [plan](smart-mix-implementation-plan.md) contiene protocolo, muestras, dispositivos, comandos y registro de resultados.

| Gate              | Criterio                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Planning          | p95 cached <50ms, uncached <150ms, compatibles <250ms con 48K tracks y concurrencia declarada                                                 |
| Exactitud         | Ningún cue/handoff fuera de duración; ningún double advance; ninguna fuga de identidad/scopes; fixtures cross-language                        |
| Audio adaptive    | Cero clipping en corpus, true peak combinado ≤−1dBTP; tasa de transiciones con underrun <0.5%; memoria ≤1.5× baseline single deck equivalente |
| Beatmatch Android | Error de fase absoluto p95 ≤20ms en captura externa ≥48kHz, rutas certificadas, corpus fijo/drift; no inferido de timers                      |
| Android lifecycle | Una sesión/notificación y controles continuos; matriz background/focus/offline/auth/route/process completa                                    |
| VDJ C             | Crate Automix nunca envía comandos de mezcla; desactivarlo detiene nuevas adiciones a la cola; cola correcta con 2 y 4 decks                  |
| Distribución      | Winx64, macOS Intel/arm64 firmados, matriz de versiones declarada,4h soak y rollback demostrado                                               |

La entrega se organiza en las releases R1–R4 del [plan](smart-mix-implementation-plan.md) §1.1: Android adaptive correcto, VDJ A en macOS arm64, VDJ B y plataformas, y ejecución avanzada. Cada release se cierra con su gate y su evidencia, sin esperar a las siguientes. Las extensiones que el plan deja en backlog (cues privados, radio y presencia en VDJ, caché de audio cifrada, federación de summaries) no bloquean ningún cierre. Un gate fallido mantiene abierta su release; mover trabajo entre release y backlog exige editar el plan, no renombrar trabajo incompleto como opcional.

Rollout conserva switches separados: Smart Mix backend, Android adaptive, beatmatch, bass, fuente VDJ y C. Se deshabilita primero el modo afectado; rollback de binarios compatibles no ejecuta automáticamente downgrade destructivo de perfiles/tokens/cues. Usuarios y operadores deben poder desactivar desde Settings/flags y conservar reproducción ordinaria. Los detalles operativos y el registro de cambios de decisiones viven en el plan.
