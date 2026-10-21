---
title: Smart Mix - funcionamiento y operación
summary: Perfiles, transiciones, backfill, estados y diagnóstico del Smart Mix implementado, con límites de observación para Hermes.
section: operations
audience: [operator, developer]
status: canonical
order: 165
verified: 2026-10-21
sources:
  - app/crate/audio_analysis.py
  - app/crate/smart_mix/versions.py
  - app/crate/smart_mix/models.py
  - app/crate/smart_mix/analyzer.py
  - app/crate/smart_mix/planner.py
  - app/crate/smart_mix/policy.py
  - app/crate/smart_mix/source.py
  - app/crate/api/smart_mix.py
  - app/crate/api/smart_mix_admin.py
  - app/crate/api/capabilities.py
  - app/crate/api/schemas/smart_mix_admin.py
  - app/crate/db/jobs/analysis_storage.py
  - app/crate/db/jobs/smart_mix_backfill.py
  - app/crate/db/queries/smart_mix_admin_tracks.py
  - app/crate/db/queries/smart_mix_compatible.py
  - app/crate/db/repositories/smart_mix.py
  - app/crate/worker_handlers/analysis.py
  - app/crate/actors.py
  - app/crate/agent_observability.py
  - app/crate/db/queries/agent_observability.py
  - app/tests/test_mcp_observability.py
  - app/crate/agent_analysis.py
  - app/crate/agent_diagnostics.py
  - app/listen/src/lib/smart-mix.ts
  - app/listen/src/contexts/player-engine-adapter.ts
  - app/listen/android/app/src/main/java/app/cratemusic/crate/NativeMixAudioProcessor.java
  - app/listen/android/app/src/main/java/app/cratemusic/crate/NativeContinuationClient.java
  - app/listen/ios/App/App/CrateMediaSessionPlugin.swift
  - tools/vdj-plugin/src/core/contract_negotiator.cpp
  - tools/vdj-plugin/src/client/smart_mix_client.cpp
  - app/readplane/internal/routes/smart_mix.go
  - tools/crate-cli/src/mix_profile.rs
  - app/tests/test_smart_mix_versions.py
  - app/tests/test_smart_mix_planner.py
  - app/tests/test_smart_mix_publication.py
  - app/tests/test_smart_mix_backfill.py
  - app/tests/test_smart_mix_admin.py
---

# Smart Mix: funcionamiento y operación

Referencia del comportamiento contrastado con el código de la release
`d3e6ef6b94ab233680f3d1a8d0c2c43b5a7d917c`, revisado el 21 de octubre de 2026.
Las observaciones MCP descritas corresponden al candidato aditivo 1.2.0; comprobar
`get_operation_catalog` antes de asumir que la instancia ya lo despliega.
No es una medición de cobertura, flags o salud de una instancia. Para continuar el desarrollo,
consultar el [diseño](smart-mix-design.md) y el [plan de continuación](smart-mix-implementation-plan.md),
que también describen objetivos y gates todavía pendientes.

## Qué hace y qué datos utiliza

Smart Mix publica un perfil por pista y calcula compatibilidad y planes de transición entre
pistas. El perfil incluye tempo/confianza/estabilidad, tonalidad/Camelot, cues y beats locales
de entrada/salida, energía, loudness y provenance de la medición. El planner entrega cues,
duración, modo, tempo ratio, fase, ganancias y motivo de fallback; el reproductor ejecuta
el plan. Recibir un plan no demuestra que se haya reproducido una transición.

El análisis general de audio y los vectores Bliss siguen siendo subsistemas distintos.
Sus estados `analysis_state`/`bliss_state` y sus contadores no acreditan la vigencia de
`track_mix_profiles`. Bliss puede aportar una dimensión de similitud a la compatibilidad;
no contiene por sí solo el perfil temporal ni un plan de crossfade.

```text
Worker / daemon de análisis -> borrador Rust o fallback Python
    -> validación de fuente, revisión y claim -> track_mix_profiles
    -> lectura por UID / candidatos compatibles / planner FastAPI
    -> plan versionado -> reproductor consumidor
Campaña de backfill -> claims por lote -> tareas heavy por pista
    -> estado de procesamiento + cobertura precalculada para Admin
```

## Versiones y procedencia

Los valores siguientes son los del código revisado, no valores descubiertos en vivo.
`test_smart_mix_versions.py` comprueba que esta tabla siga los identificadores implementados.

| Identificador                   | Valor                | Significado                                              |
| ------------------------------- | -------------------- | -------------------------------------------------------- |
| `API_CONTRACT_VERSION`          | `2026-08`            | Contrato anunciado de integración/capabilities           |
| `PROFILE_SCHEMA_VERSION`        | `1`                  | Esquema del perfil persistido y serializado              |
| `ANALYZER_VERSION`              | `smart-mix-audio-v5` | Generación objetivo del análisis de perfiles             |
| `MEASUREMENT_VERSION`           | `bs1770-v1`          | Provenance de loudness/true peak usada por el planner    |
| `BEAT_GRID_FORMAT`              | `delta-ms-v1`        | Formato de beat grid                                     |
| `PLANNER_IDENTIFIER`            | `smart-mix-v2`       | Identificador del lote de planes y de capabilities       |
| `PLANNER_POLICY_VERSION`        | `2`                  | Versión numérica de cada plan individual                 |
| `PLANNER_POLICY.rules_revision` | `5`                  | Revisión interna de reglas incluida en la clave de caché |

Cambiar reglas no implica necesariamente cambiar el identificador público del planner:
la clave de caché incorpora ambas cosas.

Cada perfil conserva `profileRevision`, `sourceRevision`, `analyzer`, `analyzerVersion`,
`profileVersion` y `analyzedAt`. `sourceRevision` es un hash de tamaño, mtime en nanosegundos
e inode; no es un hash del contenido de audio ni un Git SHA. El SHA de release identifica
el código; la revisión de fuente identifica el fichero analizado.

## Producción y publicación de perfiles

`audio_analysis.analyze_mix_profile` intenta obtener `mix_profile` del analizador Rust de
`crate-cli`; cuando no lo obtiene usa `crate.smart_mix.analyzer` en Python. No asumir que
haber instalado Rust equivale a estar usando su resultado: comprobar `analyzer` y calidad.
El fallback Python limita el análisis de pistas largas a cabecera y cola; su resultado puede
ser `partial`. Un fichero demasiado corto puede producir `unavailable`. Ni `full` ni `partial`
son una garantía de confianza suficiente para cualquier transición.

La publicación captura fuente y revisión del perfil antes del trabajo costoso. Después
revalida fuente, ruta, propiedad del claim y revisión concurrente. Los resultados son:

| Resultado del worker | Interpretación                                    |
| -------------------- | ------------------------------------------------- |
| `published`          | Perfil persistido por esta ejecución              |
| `unchanged`          | El resultado no mejora/reemplaza el perfil actual |
| `superseded`         | Otra revisión ganó la publicación                 |
| `lost_claim`         | La ejecución ya no posee el claim                 |
| `source_changed`     | Cambió el fichero durante el análisis             |
| `track_moved`        | Cambió la ruta de la pista                        |

La política permite promover un perfil de menor calidad a mayor calidad y, en igualdad de
calidad y generación/fuente, preferir Rust. Un trabajo antiguo no debe degradar un perfil
vigente. Un task que termina sin publicar no acredita un perfil nuevo: consultar `stored`,
`outcome`, el perfil y su provenance. La invalidación por cambio de fuente marca
`source_stale_at`; las lecturas normales excluyen ese perfil mientras se regenera.

## Calidad, vigencia y procesamiento son ejes distintos

`quality` admite `full`, `partial`, `legacy` y `unavailable`. La tabla de pistas de Admin
expone además este estado de perfil, en el orden de precedencia implementado:

| Estado de perfil | Significado                                                          |
| ---------------- | -------------------------------------------------------------------- |
| `missing`        | No existe fila de perfil para la pista                               |
| `unavailable`    | Existe un perfil cuya calidad es `unavailable`                       |
| `source_changed` | Perfil marcado por cambio de fuente                                  |
| `outdated`       | Versión de analizador o esquema distinta de la objetivo              |
| `current`        | Perfil no marcado stale, con versiones actuales y calidad utilizable |

`failed` es un filtro sobre `processingState`, no un sexto estado de perfil. Una pista puede
conservar un perfil utilizable y registrar un intento de procesamiento fallido. Leer también
`processingAttempts`, `processingError`, `analyzedAt` y `sourceStaleAt`.

La cobertura precalculada usa `current_profiles` y `current_quality`. Los totales de `quality`
pueden incluir perfiles antiguos: `full` total no equivale a `current_quality.full`.
`missing_profiles = total_tracks - current_profiles`: incluye todo lo que falta para alcanzar
cobertura vigente, también perfiles desactualizados o inutilizables. No equivale al filtro
por pista `status=missing`. Los álbumes en cuarentena se excluyen de esta cobertura.
Si falta el snapshot o corresponde a otro analizador, la lectura devuelve la estructura vacía;
comprobar `refreshedAt` antes de interpretar ceros como una biblioteca sin pendientes.

## Campaña, colas y backfill

| Tarea                         | Cola          | Responsabilidad                           |
| ----------------------------- | ------------- | ----------------------------------------- |
| `backfill_smart_mix_profiles` | `heavy`       | Coordinación de lotes y encolado de hijos |
| `compute_smart_mix_profile`   | `heavy`       | Análisis y publicación por pista          |
| `refresh_smart_mix_coverage`  | `maintenance` | Agregación de cobertura fuera del request |

El backfill aplica presión de recursos y limita el trabajo en vuelo. Su configuración Admin
acepta `batchSize` de 1 a 100 (25 por defecto) y `maxAttempts` de 1 a 10 (3 por defecto).
Los claims usan `SKIP LOCKED`, token, `target_generation` y intentos; una nueva versión del
analizador renueva la elegibilidad de intentos de la generación anterior. Prioriza cola de
reproducción, IDs offline suministrados, favoritos/colecciones y escuchas antes del resto.
Puede promover perfiles Python cuando el CLI Rust está disponible.

La campaña persiste bajo `smart_mix:backfill_campaign`, con estados `running`, `paused`,
`cancelled` y `completed`. `controlState=idle` también cubre la ausencia de campaña y campañas
terminales; no significa por sí solo cobertura completa. Pausar o cancelar detiene la
continuación de la campaña; no interrumpe por la fuerza análisis hijos ya aceptados. Reanudar
reutiliza una campaña de la misma generación que esté running/paused. Una campaña que se
completa ha agotado el trabajo reclamable en ese pase; puede conservar errores agotados o
perfiles no vigentes. Comprobar cobertura y `processing.exhausted` antes de dar el backlog por
resuelto. Un task coordinador `done` tampoco implica que todos sus hijos hayan terminado.

## Planner, compatibilidad y caché

- Un álbum automático preserva `gapless`; una transición manual usa una rampa corta.
- En automático, perfiles ausentes conducen a fallback. `adaptive` permite crossfade sin
  acreditar beatmatch. `beatmatch` exige permiso del contexto y referencias de beat válidas,
  confianza BPM mínima, estabilidad local, compás compatible, ajuste de tempo admisible y
  ventana suficiente. La política define los umbrales; el contrato no promete beatmatch.
- Un perfil `partial` con beat local de cue explícito puede ser elegible. No reducir la regla
  a `quality=full`. Los tempos y beats locales de outro/intro prevalecen sobre la referencia
  global; se admite normalización a mitad/doble tempo al comparar.
- Si falta ventana, el planner acorta o degrada la transición. Motivos como `missing_profile`,
  `low_confidence`, `unstable_tempo`, `incompatible_tempo`, `incompatible_meter` e
  `insufficient_window` explican el resultado; el cliente añade motivos de timeout/offline.
- Ganancias y headroom tienen en cuenta loudness/true peak acreditados; la política limita
  la suma prevista. Un valor planificado no sustituye la captura física de clipping/underrun.

Compatibilidad combina tempo, armonía Camelot, energía, danceability, valence, Bliss y género.
La consulta hace una preselección acotada por señales y luego filtra candidatos reproducibles
localmente antes del límite final; el ranking deduplica grabaciones/variantes. El endpoint
acepta `scope=local`, hasta 100 resultados y una ventana de candidatos acotada. Un score alto
no acredita que el reproductor vaya a ejecutar beatmatch ni que exista cobertura federada.

Los lotes de planes cargan perfiles y caché en bloque. La clave incluye UID de ambos tracks,
sus `profileRevision`, contexto, identificador del planner y revisión de reglas. Un cambio de
perfil/reglas conduce a otra identidad de caché; no recomendar vaciar Redis como reparación
rutinaria. Un POST de planificación puede escribir caché aunque no modifique la música.

## HTTP, permisos y consumidores

Estas rutas describen la aplicación. No son herramientas disponibles automáticamente para
Hermes; un Bearer MCP no es una sesión Admin ni un PAT de VirtualDJ.

| Ruta                                                                     | Uso y efecto relevante                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `GET /api/capabilities`                                                  | Flags efectivos y contrato de clientes; no acredita su implementación ni readiness física                    |
| `GET /api/tracks/by-entity/{uid}/mix-profile?detail=summary\|full`       | Perfil por UID; `full` incluye beat grid; 404 puede indicar ausencia o perfil invalidado                     |
| `GET /api/tracks/by-entity/{uid}/compatible`                             | Ranking local de candidatos; no desencadena análisis                                                         |
| `POST /api/playback/transition-plans`                                    | Planificación por lote; usa caché                                                                            |
| `POST /api/playback/continuation-token` y `/api/playback/continuation`   | Contrato para continuar planificación/cola en el runtime nativo                                              |
| `GET /api/admin/smart-mix/status`                                        | Cobertura/campaña/tarea coordinadora; **puede encolar** `refresh_smart_mix_coverage` si falta o supera 600 s |
| `GET /api/admin/smart-mix/tracks` y `/activity`                          | Paginación de perfiles/procesamiento y actividad de tareas                                                   |
| `POST /api/admin/smart-mix/backfill` y `/backfill/resume\|pause\|cancel` | Cambian el control de campaña                                                                                |
| `POST /api/admin/smart-mix/tracks/{id}/reanalyze`                        | Encola análisis por pista con deduplicación                                                                  |

Admin exige `library.analysis.manage`, incluso para sus lecturas. Los endpoints públicos de
perfil/compatibles usan la autorización de sesión o el scope PAT `vdj.smart_mix.read` según
el tipo de cliente; no intercambiar esos mecanismos con OAuth/grants MCP.
El readplane Go implementa el resumen de perfil validado; `detail=full` y los fallos/staleness
pertinentes vuelven a FastAPI según la ruta y configuración. No asumir que Go implementa todo
el planner ni paridad PAT: el proxy selecciona transporte según autenticación.

| Consumidor            | Lo que acredita el árbol revisado                                                                       | Lo que debe comprobarse aparte                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Backend               | Perfiles, ranking, planner, administración y continuación nativa                                        | Flags, generaciones y salud de la instancia                                                                      |
| Listen Android nativo | Adaptador de planes, dos decks/procesamiento nativo y continuación fuera de la WebView                  | APK instalado, flags/preferencias y gates de audio reales                                                        |
| Listen web/desktop    | Crossfade y heurísticas de transición; la rama de planes del adaptador está dirigida a `android-native` | No afirmar paridad del ejecutor de planes por compartir el código TypeScript                                     |
| Listen iOS            | Cliente móvil/media-session existente                                                                   | El plan de continuación mantiene la paridad Smart Mix nativa como R5; no acreditarla desde Android               |
| VirtualDJ             | Código de negociación, cliente de perfiles/compatibles e integración Online Source                      | Host/licencia Pro, build instalado y gates R2/R3; no ejecutar un mezclador de Crate dentro de VDJ por inferencia |

`CRATE_SMART_MIX_ENABLED` gobierna la capability base. Crossfade nativo depende además de
`CRATE_ANDROID_NATIVE_CROSSFADE_ENABLED`; beatmatch depende de ambos y de
`CRATE_ANDROID_BEATMATCH_ENABLED`; bass handoff añade `CRATE_ANDROID_BASS_HANDOFF_ENABLED`.
Los helpers de configuración tienen default false. VirtualDJ usa además `CRATE_VDJ_ENABLED`
y, para automation, `CRATE_VDJ_AUTOMATION_ENABLED`. El cliente aplica preferencias del usuario.
No deducir valores desplegados de defaults ni de la existencia del código.

El plan conserva un gate físico de R1 aplazado el 18 de octubre: captura externa de salida
para clipping/underrun. Los logs QoE y las suites automáticas no lo sustituyen. Esta revisión
documental no cierra ese gate ni los de plataformas futuras.

## Diagnóstico mediante Hermes de solo lectura

1. Obtener `get_release_context` y distinguir SHA de release, `source_sha` de imagen,
   `analyzerVersion`, `profileRevision` y versión de planner. Leer esta referencia y las
   fuentes necesarias de esa release con `search_crate_context`/`read_crate_context`.
2. Consultar `get_instance_status`, `get_runtime_policy`, `list_jobs`/`get_job` y
   `read_diagnostics` dentro de sus grants, límites y antigüedad. `list_jobs` permite filtrar
   los tipos Smart Mix registrados. Una lista paginada no representa toda la campaña;
   respetar cursor y truncamiento.
3. El contrato candidato MCP 1.2.0 añade `get_smart_mix_status` con el grant
   `library.health.read`: lee cobertura y campaña almacenadas y, opcionalmente,
   `track_uids` con un máximo de 50 UUIDs exactos. Devuelve timestamps independientes,
   disponibilidad, antigüedad, versiones implementadas y estado de cada perfil; conserva
   cobertura de analizadores antiguos como evidencia stale en vez de inventar ceros.
   No calcula perfiles, candidatos ni planes, no refresca cobertura y no encola trabajo.
   `get_analysis_status` sigue cubriendo solo `analysis` y `bliss`; no sustituye esta lectura.
4. Cuando falte esa evidencia o el grant, declarar el dato no disponible y proponer al operador la
   comprobación Admin apropiada. El GET de estado Admin puede encolar trabajo: no usarlo
   como sustituto transparente de una observación MCP. Hermes no cambia flags, pausa,
   reanaliza ni inicia campañas en esta fase.

| Síntoma                              | Evidencia y siguiente comprobación                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cobertura cero o parada              | Fecha/versión del snapshot, campaña y tareas por cola; distinguir snapshot ausente de cero real. Consultar `get_smart_mix_status`; si falta evidencia o grant, solicitar al operador la comprobación Admin |
| Mucho `missing_profiles`             | Separar ausencia real, generación antigua, fuente cambiada y calidad `unavailable`; comprobar filtros por pista y `current_quality`                                   |
| Campaña running sin avance           | Presión/ventana de recursos, heavy worker, claims y tareas hijos; consultar errores/agotados antes de reiniciar                                                       |
| Task terminado pero sin perfil nuevo | Leer `outcome`, fuente/revisión y claim: `superseded`/`unchanged` no equivalen a publicación por ese task                                                             |
| Crossfade sin beatmatch              | Capability, preferencia, calidad/beat de cue, confianza/estabilidad, compás, ventana y `fallbackReason`                                                               |
| Mezcla antigua tras reanálisis       | Verificar `profileRevision`, reglas y plan instalado por el cliente; no confundir plan nuevo con adopción en el reproductor                                           |

La lectura almacenada tiene cobertura parcial. No expone probes funcionales del host en vivo,
aceptación física por plataforma, adopción del plan en cada reproductor ni una nueva validación
del audio. Esas señales siguen no disponibles. Un enqueue no acredita finalización; un perfil
`current` solo acredita versiones almacenadas compatibles con el código de la API, sin eliminar
la antigüedad que declara su envelope. El contexto de release y sus `source_sha` siguen en el
MCP de contexto, no se deducen de un tag de imagen ni de `get_smart_mix_status`.

## Evidencia de regresión y preguntas de aceptación

Las suites `test_smart_mix_versions`, `test_smart_mix_publication`,
`test_smart_mix_source_invalidation`, `test_smart_mix_backfill`, `test_smart_mix_admin`,
`test_smart_mix_planner`, `test_smart_mix_api` y `test_smart_mix_compatible_service`
cubren las identidades, publicación concurrente, estados, control de campaña y contrato de
planificación. Tests de readplane, Listen y Rust completan sus superficies; no sustituyen
una prueba física o la comprobación de un binario distribuido.

Hermes debe poder explicar Smart Mix frente a Bliss; diferenciar calidad, vigencia y error;
seguir un backfill sin equiparar enqueue/finalización/cobertura; explicar elegibilidad de
beats locales y fallbacks; y señalar los límites por plataforma y de evidencia MCP. Cada
respuesta debe citar ruta y SHA del contexto. La respuesta correcta a la cobertura real
Smart Mix puede ser que la credencial actual no la expone, aunque conozca el algoritmo.
