# Índice editorial de Crate

Corte de investigación: **8 de noviembre de 2026**.

Base: `origin/main` en [`6b53412a6602c1d7fb34c1ef14498f8263b11243`](https://github.com/thecrateapp/crate/commit/6b53412a6602c1d7fb34c1ef14498f8263b11243), con 3.263 commits alcanzables. Última release etiquetada contrastada: [v3.2.4](https://github.com/thecrateapp/crate/releases/tag/v3.2.4), commit `988597d04cce19364ce8378eebcc712aa16c20c7` del 5 de noviembre. El worktree del blog contiene ese main y los artículos en revisión. Este inventario no verifica qué SHA o flags están desplegados en producción.

El resultado son **117 piezas distintas: 35 históricas y 82 técnicas**. **42 ya están escritas** (34 históricas y 8 técnicas); quedan **75 propuestas nuevas**. Las 42 piezas escritas (las 34 históricas y ocho técnicas, incluida T01) se publican juntas el 10 de noviembre de 2026; las propuestas siguen en martes posteriores. Es un catálogo editorial que se puede convertir después en calendario.

La serie histórica cuenta cómo cambiaron las capacidades y responsabilidades de Crate. Los artículos técnicos siguen un problema concreto hasta sus decisiones, implementación, pruebas y límites. Un capítulo histórico enlaza el desarrollo detallado cuando ya existe: no encarga una segunda versión del mismo artículo. En particular, el cambio a snapshots y Go está cubierto por T09 y se incorpora como lectura en el tramo de H10–H12.

Los primeros cuatro capítulos mantienen su orden. H05–H34 siguen un orden de lectura por dependencias y etapas; varios procesos ocurrieron en paralelo y algunos capítulos siguen su evolución durante meses. Los IDs técnicos son referencias editoriales, no fechas de publicación. Los 39 hitos del inventario inicial, revisados editorialmente, y los 12 añadidos al escribir la serie están cruzados al final. El timeline reúne 51 hitos y da acceso a los capítulos históricos y a los artículos técnicos ya existentes; Analyzer v6 y la etapa Crate V2 quedan sin enlace hasta tener un artículo que cubra específicamente esos cambios.

La voz y el formato siguen [la guía editorial](engineering-blog.md): problema real, investigación de alternativas, implementación con código y diagramas, y antes/después. La longitud depende del problema. Los capítulos escritos han pasado una revisión con Humanizer; los artículos técnicos aún propuestos necesitarán su propio pase completo antes de revisión. La evidencia histórica sostiene el relato, sin narrar horas de commits ni inventar recuerdos, motivaciones o resultados.

## Serie histórica

**How to dismantle Spotify. Building Crate from the ground.**

| ID | Título | Problema y transformación | Estado |
| --- | --- | --- | --- |
| H01 | [Crate started as a librarian](../../app/web/src/content/blog/crate-started-as-a-librarian.md) | Una biblioteca desordenada → una herramienta para identificar, enriquecer y reparar música. | Escrito |
| H02 | [When the filesystem stopped being the catalogue](../../app/web/src/content/blog/filesystem-to-indexed-catalogue.md) | Explorar carpetas → consultar un catálogo; SQLite → PostgreSQL al compartir escrituras. | Escrito |
| H03 | [Taking playback over from Navidrome](../../app/web/src/content/blog/taking-playback-over-from-navidrome.md) | Reproducir a través de Navidrome → streaming propio y una aplicación Listen separada. | Escrito |
| H04 | [When retries repeat a finished download](../../app/web/src/content/blog/when-retries-repeat-a-download.md) | Una descarga terminada se repetía: separar transferencia, importación y seguimiento del filesystem. | Escrito |
| H05 | [Giving every album a stable address](../../app/web/src/content/blog/giving-every-album-a-stable-address.md) | Carpetas dependientes de nombres → identidades persistentes, Storage V2 y migración compatible. | Escrito |
| H06 | [One library, more than one listener](../../app/web/src/content/blog/one-library-more-than-one-listener.md) | Una colección compartida → cuentas, sesiones, favoritos e historial personales. | Escrito |
| H07 | [Teaching Crate to listen to its own library](../../app/web/src/content/blog/teaching-crate-to-listen.md) | Tags y heurísticas → análisis de audio, Bliss y Rust, incluyendo modelos que hubo que retirar. | Escrito |
| H08 | [Giving the library a radio of its own](../../app/web/src/content/blog/giving-the-library-a-radio.md) | Canciones similares → estaciones con semillas, diversidad y feedback. | Escrito |
| H09 | [Taking Crate out of the browser](../../app/web/src/content/blog/taking-crate-out-of-the-browser.md) | Listen web → Capacitor, elección de servidor y ciclo de vida móvil. | Escrito |
| H10 | [Giving database writes a transaction boundary](../../app/web/src/content/blog/giving-database-writes-a-transaction-boundary.md) | Acceso disperso a PostgreSQL → transacciones explícitas, módulos con límites y migraciones verificables. | Escrito |
| H11 | [Building a route through the music collection](../../app/web/src/content/blog/building-a-route-through-the-music-collection.md) | Pedir canciones parecidas → diseñar un recorrido finito con puntos de paso y destino. | Escrito |
| H12 | [Keeping background work from interrupting playback](../../app/web/src/content/blog/keeping-background-work-from-interrupting-playback.md) | Análisis, imports y reproducción compitiendo → daemons, colas aisladas y admisión según capacidad. | Escrito |
| H13 | [Bringing purchased music into a shared library](../../app/web/src/content/blog/bringing-purchased-music-into-a-shared-library.md) | Compras de Bandcamp → importación, atribución y retirada de aportaciones sin borrar las de otro usuario. | Escrito |
| H14 | [Keeping the music playing when Android puts the screen to sleep](../../app/web/src/content/blog/keeping-the-music-playing-on-android.md) | Audio dependiente del WebView → servicio nativo con autoridad sobre reproducción y cola. | Escrito |
| H15 | [A desktop app has a life outside its window](../../app/web/src/content/blog/a-desktop-app-has-a-life-outside-its-window.md) | Listen en una pestaña → Tauri, teclas multimedia, bandeja, deep links y diferencias entre sistemas. | Escrito |
| H16 | [Taking artwork processing out of HTTP requests](../../app/web/src/content/blog/taking-artwork-processing-out-of-http-requests.md) | Descargar y transformar imágenes al pedirlas → materialización en workers y entrega de artefactos preparados. | Escrito |
| H17 | [Moving playback from one device to another](../../app/web/src/content/blog/moving-playback-from-one-device-to-another.md) | Reproductores aislados → Crate Connect, transferencia de cola y cambio de dispositivo activo. | Escrito |
| H18 | [Letting another Crate into the catalogue](../../app/web/src/content/blog/letting-another-crate-into-the-catalogue.md) | Biblioteca local → catálogo federado con permisos y disponibilidad independientes. | Escrito |
| H19 | [From crossfades to a shared mixing engine](../../app/web/src/content/blog/from-crossfades-to-a-shared-mixing-engine.md) | Timer de volumen → envolventes PCM y salida compartida en Android, con perfiles y planes del servidor. | Escrito |
| H20 | [Why we switched Jam Rooms off](../../app/web/src/content/blog/why-we-switched-jam-rooms-off.md) | Una interfaz aparentemente sincronizada → reconocer fallos de audio y suspender la función. | Escrito |
| H21 | [What available offline had to mean](../../app/web/src/content/blog/what-available-offline-had-to-mean.md) | Un botón de descarga → una promesa de reproducción verificable tras suspensión, reinicio o pérdida de red. | Escrito |
| H22 | [Giving the Cast receiver the queue](../../app/web/src/content/blog/giving-the-cast-receiver-the-queue.md) | Enviar canciones desde el teléfono → un receptor que conserva cola y posición cuando el sender desaparece. | Escrito |
| H23 | [Making Crate usable from someone else's music player](../../app/web/src/content/blog/making-crate-usable-from-someone-elses-music-player.md) | Endpoints iniciales → un contrato OpenSubsonic comprobable con clientes externos. | Escrito |
| H24 | [Sharing a collection without giving away its ownership](../../app/web/src/content/blog/sharing-a-collection-without-giving-away-its-ownership.md) | Playlists privadas → colaboradores, follows, copias y Crates públicos con permisos distintos. | Escrito |
| H25 | [Making listening history belong to Crate](../../app/web/src/content/blog/making-listening-history-belong-to-crate.md) | Contadores y servicios externos → eventos propios, scrobbling y estadísticas que se pueden reconstruir. | Escrito |
| H26 | [From tour dates to a show people can share](../../app/web/src/content/blog/from-tour-dates-to-a-show-people-can-share.md) | Listados de proveedores → conciertos canónicos, lineups y correcciones revisables. | Escrito |
| H27 | [Opening Crate to agents](../../app/web/src/content/blog/opening-crate-to-agents.md) | Automatización interna → MCP remoto con lecturas acotadas, delegación y aprobación de cambios. | Escrito |
| H28 | [Putting model calls behind one runtime](../../app/web/src/content/blog/putting-model-calls-behind-one-runtime.md) | Integraciones dispersas → configuración versionada, presupuestos y colas de inferencia propias. | Escrito |
| H29 | [Building an installer for someone else's server](../../app/web/src/content/blog/building-an-installer-for-someone-elses-server.md) | Scripts para nuestro entorno → instalación guiada, configuración y diagnóstico de otras instancias. | Escrito |
| H30 | [Making two apps look and behave like one Crate](../../app/web/src/content/blog/making-two-apps-look-and-behave-like-one-crate.md) | Admin y Listen divergentes → componentes compartidos y una identidad V3 fija. | Escrito |
| H31 | [When a familiar radio became too familiar](../../app/web/src/content/blog/when-a-familiar-radio-became-too-familiar.md) | Sesiones repetidas → memoria de escucha, rotación y tratamiento de distintas ediciones de una canción. | Escrito |
| H32 | [Taking the library into VirtualDJ](../../app/web/src/content/blog/taking-the-library-into-virtualdj.md) | Cliente propio → fuente nativa en otra aplicación, integración con decks y Automix acotado. | Escrito |
| H33 | [Deploying a version we can identify and recover](../../app/web/src/content/blog/deploying-a-version-we-can-identify-and-recover.md) | Actualizar contenedores → manifiestos por digest, verificación y recuperación consciente del estado de la base de datos. | Escrito |
| H34 | [Giving Smart Mix a sense of musical structure](../../app/web/src/content/blog/giving-smart-mix-a-sense-of-musical-structure.md) | Planificar con beats y cues → downbeats, voces, frases y candidatos de transición. | Escrito |
| H35 | Separating a track into stems | Sesiones Smart Mix y Decks → separación en cuatro stems con `htdemucs`, sidecar sin pérdidas cuyo `other` es el residuo y reproducción por stem. | Propuesto · tras STEM-G0 y despliegue |

## Artículos técnicos


### Biblioteca y catálogo

| ID | Título | Problema técnico | Estado |
| --- | --- | --- | --- |
| T01 | [Building an artist page when the providers disagree](../../app/web/src/content/blog/building-an-artist-page-when-the-providers-disagree.md) | Fuentes lentas o incompletas: paralelismo acotado, caché por proveedor y conservación de resultados parciales. | Escrito |
| T02 | A file called FLAC is not always FLAC | Detectar contenedor, codec y calidad reales antes de aceptar o normalizar una descarga. | Propuesto |
| T03 | Replacing an audio file without replacing the track | Mejorar la copia conservando identidad, playlists e historial; quarantine y recuperación ante fallos. | Propuesto |
| T04 | When an advance single becomes track seven | Reconocer una grabación al llegar el álbum completo sin confundir releases, posiciones ni títulos repetidos. | Propuesto |
| T05 | The album changed, but the directory did not | Detectar archivos sobrescritos y scans vacíos transitorios sin confiar sólo en el mtime del directorio. | Propuesto |
| T06 | Two folders, one album identity | Distinguir una copia viva de un movimiento legítimo y resolver conflictos sin perder la fila existente. | Propuesto |
| T07 | When a genre guess becomes a catalogue fact | Preservar etiquetas originales y proveniencia para que una inferencia débil no imponga un alias global. | Propuesto |
| T08 | Publishing artwork while someone is still editing it | Publicar composiciones completas mediante artefactos inmutables, CAS e historial de rollback. | Propuesto |

### Backend y ejecución

| ID | Título | Problema técnico | Estado |
| --- | --- | --- | --- |
| T09 | [Serving hot screens from snapshots, not queries](../../app/web/src/content/blog/reads-from-snapshots.md) | Outbox, projector, snapshots y Go para sacar la construcción de pantallas del camino de lectura. | Escrito |
| T10 | The worker must not outrun the transaction | Retrasar efectos hasta el commit exterior y descartar los callbacks de una transacción abortada. | Propuesto |
| T11 | The projector was alive, but the catalogue stopped moving | Recuperar consumidores atascados, reservar capacidad para eventos nuevos y medir progreso real. | Propuesto |
| T12 | Why a refresh event can still show stale data | Ordenar invalidación de cachés, publicación y lectura del cliente; replay al reconectar. | Propuesto |
| T13 | What survives when a queue message is delivered twice | Separar mensaje, tarea y ejecución: claims, deduplicación, redelivery y recuperación de workers. | Propuesto |
| T14 | What happens after you press Cancel | Solicitud, reconocimiento, tareas hijas y efectos parciales: cancelar no deshace automáticamente lo ya escrito. | Propuesto |
| T15 | Downloading an album without buffering an album | ZIP64 en Rust, preparación en Python, progreso, cancelación y validez de archivos de colecciones compartidas. | Propuesto |

### Playback y clientes

| ID | Título | Problema técnico | Estado |
| --- | --- | --- | --- |
| T16 | Giving a media URL only the access it needs | Tickets opacos para audio, imágenes y eventos: ruta y audiencia exactas, caducidad y revocación. | Propuesto |
| T17 | Getting a browser login back into a native app | PKCE, códigos de un solo uso, binding al servidor y migración de credenciales entre runtimes. | Propuesto |
| T18 | Restoring a player without restoring its credentials | Recuperar Android tras la muerte del proceso con checkpoints mínimos y autorización renovada. | Propuesto |
| T19 | The offline badge has to describe a real file | Validar respuesta y tamaño del archivo, terminar la persistencia y eliminar descargas rotas en el namespace correcto. | Propuesto |
| T20 | Who owns playback after a device handoff? | Sesión activa, versiones, comandos deduplicados, outbox y rechazo de dispositivos con estado antiguo. | Propuesto |
| T21 | The sender went away. The Cast queue kept playing | Autoridad del receptor, identidad de items, CAS y reconciliación sin sobrescribir el cursor remoto. | Propuesto |
| T22 | Keeping an infinite queue alive across three playback runtimes | Lotes repetibles, leases y ownership entre web, Android y Cast; recuperar un append cuyo ACK se perdió. | Propuesto |
| T23 | Serving a track while its playback variant is still preparing | Range requests, variantes, transcodes, desconexiones y prioridad para la pista que está sonando. | Propuesto |
| T24 | Changing the EQ curve while the music keeps playing | Resolver modos manuales y adaptativos, suavizar ganancias y aplicar la curva al motor web o Android correcto. | Propuesto |
| T25 | Count a listen once, even when the client retries | Identidad del evento, outbox del cliente e ingestión duradera antes de enviar scrobbles. | Propuesto |
| T26 | Compatibility is a set of promises you can test | Contrato OpenSubsonic: JSON/XML, errores, credenciales, extensiones y pruebas HTTP de interoperabilidad. | Propuesto |

### Federación

| ID | Título | Problema técnico | Estado |
| --- | --- | --- | --- |
| T27 | A peer address is untrusted input | Firmas, rotación de claves y defensa SSRF: validar DNS, IP, Host/SNI y redirects. | Propuesto |
| T28 | A catalogue cursor is a commit record | Aplicar páginas y cursor en una transacción; reanudar, procesar tombstones y recuperar deltas caducados. | Propuesto |
| T29 | Streaming a remote track without lending out the owner's keys | Grants, tickets del relay, revocación, seeks y capacidad acotada entre dos operadores. | Propuesto |
| T30 | Importing from a peer is a reviewed transfer | Manifest revisado, cuota, hashes, staging y permisos separados para transferir y publicar. | Propuesto |

### Audio, recomendaciones e historial

| ID | Título | Problema técnico | Estado |
| --- | --- | --- | --- |
| T31 | What a music library can learn from twenty numbers | Vectores Bliss: extracción, persistencia, búsqueda coseno y límites de la representación. | Propuesto |
| T32 | The units behind a music mood score | Brillo, rango dinámico y rasgos aprendidos: normalización, silencios y fallbacks con semántica explícita. | Propuesto |
| T33 | Why similarity alone cannot make a radio station | Equilibrar afinidad, continuidad, diversidad y variantes de una misma canción. | Propuesto |
| T34 | Remembering what you heard without banning your favourite songs | Separar entrega de escucha significativa y rotar candidatos dentro de un margen de calidad. | Propuesto |
| T35 | Planning a musical journey that reaches its destination | Anchors, cuotas y orden finito en catálogos escasos; conservar y explicar resultados parciales. | Propuesto |
| T36 | Finding a hundred-track path without a hundred database trips | Consultas agrupadas, contexto compartido, índice HNSW y comparación de resultados antes y después. | Propuesto |
| T37 | The next song starts before the previous one ends | Recomendar según la transición: cues, fades y referencia de loudness; una métrica mejor puede engañar. | Propuesto |
| T38 | Checking whether a scrobble was actually recorded | Aceptado, ignorado o reintentable por proveedor; conservar resultados y repetir sólo destinos pendientes. | Propuesto |
| T39 | Rebuilding listening statistics one day at a time | Dirty days, zonas horarias, sesiones y equivalencia entre actualización incremental y reconstrucción. | Propuesto |
| T40 | What listening history can tell us about the collection | Interpretar cobertura, géneros y segundos escuchados con historia incompleta y valores estimados. | Propuesto |

### Smart Mix

| ID | Título | Problema técnico | Estado |
| --- | --- | --- | --- |
| T41 | [Planning DJ transitions on the server, playing them on a phone](../../app/web/src/content/blog/smart-mix-planned-on-the-server.md) | Perfiles y planes por pareja ejecutados sobre un reloj de audio común. | Escrito |
| T42 | [A beat grid in two bytes per beat](../../app/web/src/content/blog/a-beat-grid-in-a-few-bytes.md) | Codificar rejillas de beats con deltas, precisión acotada y decodificación estricta. | Escrito |
| T43 | [Finding the one: where every bar starts](../../app/web/src/content/blog/finding-the-one.md) | Downbeats, referencia de evaluación y combinación del modelo con un DBN. | Escrito |
| T44 | [Lyrics as labels: calibrating a voice detector without listening](../../app/web/src/content/blog/lyrics-as-labels.md) | Usar letras sincronizadas para comparar y calibrar detección de voz. | Escrito |
| T45 | When most of the library appeared to be in the same key | Investigar el sesgo de los bins FFT hacia graves y corregir la medición de tonalidad. | Propuesto |
| T46 | An audio profile is only valid for the file it measured | Cambios de archivo, claims perdidos y publicación concurrente: comprobar la fuente antes de activar el perfil. | Propuesto |
| T47 | Upgrading the analyzer without taking Smart Mix offline | Convivencia de versiones, campañas de backfill y reutilización de señales de modelos costosos. | Propuesto |
| T48 | Finding musical phrases between the beats | Energía, novedad armónica y tímbrica, particiones y confianza para segmentar estructura. | Propuesto |
| T49 | Choosing a transition from a small menu of valid mixes | Explorar entradas y salidas, penalizar voz solapada y música omitida, y conservar fallback a v2. | Propuesto |
| T50 | How we compare mixes before calling them better | Datasets fijos, revisiones compatibles, métricas, renderizados y escucha A/B. | Propuesto |
| T51 | Letting a model choose a mix without giving it the faders | Selección y cambios acotados sobre candidatos válidos; reconstrucción, validación y fallback deterministas. | Propuesto |
| T80 | Separating stems on a server without a GPU | Un único grafo ONNX de `htdemucs` en ONNX Runtime CPU, sin torch en el worker; coste por sesión medido en el servidor real. | Propuesto · tras STEM-G0 |
| T81 | Four stems that add up to the original | Sidecar sin pérdidas con `other` como residuo para que la suma reproduzca el original; el archivo de la pista sigue siendo el original. | Propuesto · tras STEM-G0 |
| T82 | Running a separation model inside a DJ app | Inferencia en Crate Decks: ONNX Runtime con CUDA o DirectML, STFT e iSTFT en C++ y paridad con PyTorch. | Propuesto · tras STEM-G0 |

### Producto, interfaz e integraciones

| ID | Título | Problema técnico | Estado |
| --- | --- | --- | --- |
| T52 | Render the permissions the server actually grants | Evitar botones Edit que terminan en 403 usando el contrato de acceso de playlists y Crates. | Propuesto |
| T53 | What a public collection link is allowed to reveal | URLs estables y proyecciones públicas sin exponer miembros privados ni conceder reproducción anónima. | Propuesto |
| T54 | Do these two listings describe the same concert? | Lineups, sesiones, venues y aliases: identidad canónica, ambigüedad y consolidación revisada. | Propuesto |
| T55 | From a concert flyer to a reviewed database write | OCR privado, evidencia, selección humana y revalidación de permisos y revisiones antes de escribir. | Propuesto |
| T56 | A design system that the build can enforce | Tokens, capas, exports y contratos que mantienen coherentes Admin y Listen. | Propuesto |
| T57 | Why a touch interaction left a keyboard focus ring behind | Distinguir modalidad de entrada y foco programático conservando indicadores accesibles con teclado. | Propuesto |
| T58 | Keeping a music visualizer alive without leaking GPU resources | Reutilizar el renderer, cancelar inicializaciones tardías y detener animaciones ocultas o deshabilitadas. | Propuesto |
| T59 | Publishing the playlist you actually reviewed | Selección ordenada congelada, fingerprints y CAS para mantener íntegra una publicación editorial. | Propuesto |
| T60 | A native plugin must survive the host calling back late | Threads, cancelación, destrucción y caché por cuenta dentro del proceso de VirtualDJ. | Propuesto |
| T61 | Feeding Automix without taking over the DJ's decks | Observar reproducción real, reconocer intervención manual y alimentar una cola acotada sin duplicados. | Propuesto |

### Agentes e IA

| ID | Título | Problema técnico | Estado |
| --- | --- | --- | --- |
| T62 | The exact change an agent is allowed to make | Plan revisado, hash y versión, precondiciones y autoridad comprobada de nuevo al ejecutar cada efecto. | Propuesto |
| T63 | What an OAuth grant allows an agent to do | Scopes, propietario del recurso, delegación, revocación y autoridad de trabajos asíncronos. | Propuesto |
| T64 | Reserving the cost of an AI call before making it | Reservas atómicas de presupuesto y concurrencia, liquidación única y recuperación tras caídas. | Propuesto |
| T65 | Keeping background AI from blocking the next user request | Pools ai/ai_bulk, deadlines, deduplicación y deferir capacidad antes de iniciar llamadas pagadas. | Propuesto |
| T66 | Supporting model providers with different capabilities | Descubrimiento, perfiles versionados, reasoning tokens y validación de endpoints compatibles. | Propuesto |
| T67 | A human approval button the model cannot press | Callbacks de Telegram ligados a una persona y al plan completo; decisión y admisión duraderas. | Propuesto |
| T68 | Watching Crate when Crate cannot answer | Supervisor independiente, estado persistido, entrega duradera y watchdog externo. | Propuesto |

### Operación y entrega

| ID | Título | Problema técnico | Estado |
| --- | --- | --- | --- |
| T69 | [Observing a home server without a monitoring team](../../app/web/src/content/blog/observing-a-home-server.md) | Métricas integradas, cardinalidad acotada, datos ausentes y observabilidad adicional opcional. | Escrito |
| T70 | [Reading production errors in Admin without trusting what they say](../../app/web/src/content/blog/reading-errors-without-trusting-them.md) | Inbox persistido, datos no confiables, evaluación de triage y reparación con revisión humana. | Escrito |
| T71 | Which source code is actually running in this container? | Manifiestos incrementales por digest y SHA de origen por imagen, también para releases de Sentry. | Propuesto |
| T72 | Rolling back code after the database has moved on | Separar rollback de imágenes de restaurar PostgreSQL, Redis duradero y secretos; coordinar escritores y recovery. | Propuesto |
| T73 | One configuration model for install, configure and doctor | Un manifiesto compartido, secretos persistentes y diagnósticos útiles para perfiles de despliegue distintos. | Propuesto |
| T74 | Keeping passwords out of an agent-led installation | MCP local, borrador de configuración y portal efímero de secretos con aplicación explícita. | Propuesto |
| T75 | Upgrading monitoring without redeploying the music server | Release independiente, adopción de datos existentes, detección de drift, rollback y lease de mutación del host. | Propuesto |
| T76 | Evicting audio caches without deleting the library | Datos duraderos frente a regenerables, watermarks, LRU por atime, huérfanos y regeneración. | Propuesto |
| T77 | Measuring the delay between pressing Play and hearing music | Intención, resultado y tiempo activo para distinguir latencia, pausas, buffering y muestras insuficientes. | Propuesto |
| T78 | Keeping useful product numbers after the source events expire | Capturar agregados antes de la retención, definir días y cohortes y proteger segmentos pequeños. | Propuesto |
| T79 | When a diagnostics upload broke the desktop release | Los fallos de Windows y macOS: separar artefactos instalables, símbolos y comprobaciones de plataforma. | Propuesto |

## Límites que deben conservar los artículos

Estas condiciones afectan a cómo se cuenta el estado actual, no a la posibilidad de escribir sobre su ingeniería.

- **H18:** Implementación con aceptación de producción condicionada; no afirmar peering público desplegado.
- **H20:** Historia de una función desactivada; no presentarla como escucha sincronizada disponible.
- **H27:** Lectura, acciones y OAuth tienen switches y permisos separados.
- **H32:** Plugin real; acceso y automatización desactivados por defecto. No equivale a Crate Decks terminado.
- **H34:** Smart Mix 3 está en main después de v3.2.4; v2 sigue siendo el planner por defecto.
- **T04:** Fix posterior a v3.2.4; no asumir reparación automática de duplicados antiguos.
- **T16:** El código distingue tickets de sesión de 60 s y tickets PAT/VDJ de 12 h; no son todos de un solo uso.
- **T17:** Android Keystore/iOS Keychain; Tauri usa el vault del sistema mediante keyring desde septiembre, con migración verificada del almacenamiento WebView. La documentación antigua está desactualizada: comprobar código y pruebas. Incluir aislamiento al cambiar de instancia.
- **T22:** Combina el refill del servidor y los handoffs de clientes en un solo artículo. QA física Xiaomi/Cast sigue pendiente según la documentación.
- **T24:** Describir capacidades por runtime; no prometer paridad de efectos entre web, iOS, Android y Cast.
- **T29:** Incluir pruebas con peers lentos, desconectados y revocados; distinguir resultados locales de aceptación en producción.
- **T40:** Distinguir superficies implementadas del Explorer futuro descrito en el plan.
- **T45:** Las distribuciones citadas deben identificarse como muestras de desarrollo; no extrapolarlas a toda producción.
- **T46:** sourceRevision usa metadatos del archivo; no es un hash de sus bytes.
- **T48:** Implementación en main posterior a v3.2.4; etiquetas estructurales no equivalen a verdad musical anotada.
- **T49:** V3 se pide explícitamente; el contrato de salida conserva versión de plan 2 y v2 sigue por defecto.
- **T50:** No confundir un benchmark de planes con capturas del motor en un dispositivo ni con un veredicto de escucha.
- **T51:** Refinement con IA desactivado por defecto; requiere binding, permiso y opt-in. La evaluación SM5 (8 nov) cerró la puerta SG3 como no-go: tras el arreglo del traspaso de bajos el rechazo bajó al 0–3 %, pero ningún criterio mejoró y las transiciones electrónicas empeoraron. No afirmar mejora musical.
- **H35, T80–T82:** La separación de stems está en desarrollo en ramas sin integrar y su puerta STEM-G0 (modelo y licencia de pesos, inferencia en Decks, viabilidad en servidor) sigue abierta. No escribir hasta que se despliegue. Las cifras del spike (unos 8 s por pista de 5 minutos en una RTX 4060 de portátil; 3–5 horas estimadas para una sesión de 50 pistas en el i7-7700) son de desarrollo y estimaciones.
- **T56:** Describir la identidad V3 fija; los temas y skins seleccionables de documentos anteriores están retirados.
- **T59:** Publicar requiere grants y aprobación; una propuesta generada no autoriza su publicación.
- **T61:** VDJ y automatización por flags; la automatización exige scope propio y condiciones Smart Mix. No afirmar aceptación exhaustiva en el host.
- **T67:** La aceptación local del gateway usa Bot API simulado; no equivale a validación de Telegram real.
- **T68:** Candidato integrado con aceptación local; no afirmar aceptación desplegada ni autorrecuperación autónoma. Agent read-only es el default.
- **T70:** EG2 del 7 nov cumple umbral de clasificación, pero la referencia no contiene críticos. Activación pendiente; errors-critical sigue deshabilitado.
- **T72:** Rollback automático desactivado después de arrancar el stack nuevo por posible avance de migraciones.

- **Crate Decks:** el repositorio prueba contratos de servidor y autenticación, pero `decks.features=[]`. Un artículo sobre un cliente DJ completo necesita revisar el repositorio del cliente y su aceptación; VirtualDJ es una integración diferente y sí tiene implementación nativa aquí.
- **Mediciones:** cifras de réplicas, fixtures, carga sintética o catálogos de desarrollo deben llevar su contexto. Esta investigación leyó pruebas y evidencias existentes; no ejecutó nuevos benchmarks ni validaciones físicas.
- **Fuentes externas:** al redactar comparaciones con otros sistemas habrá que consultar sus fuentes primarias. Una comparación investigada hoy no demuestra que se evaluara esa alternativa durante la decisión original.

## Separaciones editoriales

- H04 explica la repetición de efectos de una descarga; T13 estudia el contrato actual de ejecución y T14 la cancelación cooperativa.
- H05 explica Storage V2; T03 mejora una copia de audio, T04 reconcilia un single con un álbum y T06 resuelve dos rutas activas. Las tres operaciones tienen reglas de identidad distintas.
- T09 ya explica outbox, projector y read plane. T10 se concentra en el commit exterior; T11 en progreso y recuperación; T12 en el orden de invalidación y notificación.
- Radio selecciona música en T33, T34 y T37. T22 resuelve la entrega continua de la cola entre runtimes; integra los candidatos inicialmente separados de refill del servidor y de handoff del cliente.
- H19 y H34 cuentan las dos etapas de Smart Mix; H35 contará la tercera, los stems, cuando se despliegue. T41–T51 explican los mecanismos; cuatro de esos artículos ya están escritos. T80–T82 tratan la separación de stems.
- H13 incluye propiedad y retirada de aportaciones Bandcamp. No se añade otro artículo con el mismo recorrido.
- T15 reúne el empaquetado Rust y la preparación/cache de descargas de Crates, explicando qué proceso realiza cada trabajo.
- OAuth nativo y aislamiento al cambiar de servidor se estudian juntos en T17. La aprobación del efecto, la delegación OAuth de agentes y el botón humano de Telegram siguen siendo contratos diferentes.
- La aceptación de federación se explica junto a sincronización, relay e imports; no se reserva otro artículo que sólo enumere pruebas.
- El artículo existente de observabilidad ya cubre métricas ausentes, cardinalidad y muestreo de Stack. Los nuevos artículos de operaciones tratan releases, recuperación, QoE y retención con problemas propios.

## Orden de revisión y siguientes artículos técnicos

La revisión de los nuevos capítulos históricos empieza en H05 y sigue el orden de la serie. Todos permanecen como borradores en la preview. Las fechas semanales son propuestas editoriales y no activan publicación. Para continuar después con problemas técnicos más acotados, una primera selección sería:

- **T03 — Replacing an audio file without replacing the track.**
- **T04 — When an advance single becomes track seven.**
- **T11 — The projector was alive, but the catalogue stopped moving.**
- **T22 — Keeping an infinite queue alive across three playback runtimes.**
- **T45 — When most of the library appeared to be in the same key.**
- **T50 — How we compare mixes before calling them better.**
- **T62 — The exact change an agent is allowed to make.**
- **T72 — Rolling back code after the database has moved on.**

## Cobertura del timeline existente

Cada hito tiene al menos una ubicación editorial. Un hito puede sostener varios artículos y un artículo puede explicar varios cambios relacionados. El enlace público sólo se ofrece cuando el destino explica ese cambio. La reparación de paquetes de v3.2.4 se conserva en T79; el timeline principal la sustituye por la introducción de manifiestos de release, con su propia fecha y evidencia. Crate V2 aporta contexto a H30, pero no enlaza ese capítulo como si fuese un relato dedicado a esa versión.

| Hito | Artículos |
| --- | --- |
| `librarian` | H01 |
| `catalog` | H02 |
| `sqlite-contention` | H02 |
| `postgresql` | H02 |
| `worker-writes` | H01 |
| `direct-streaming` | H03 |
| `bliss` | H07, T31 |
| `crate-cli` | H07 |
| `dramatiq` | H04, T13 |
| `listen` | H03 |
| `analysis-daemons` | H12 |
| `catalogue-streaming` | H03 |
| `acquisition-retries` | H04 |
| `playback` | H03 |
| `storage` | H05, T03, T06 |
| `database-boundary` | H10, T10 |
| `shared-ui` | H30, T56 |
| `music-paths` | H11, T35, T36 |
| `snapshots` | T09 |
| `governor` | H12 |
| `readplane` | T09, T15, H12 |
| `android-player` | H14, T18 |
| `desktop` | H15, T79 |
| `connect` | H17, T20 |
| `crate-v2` | H30 |
| `federation` | H18, T27, T28, T29, T30 |
| `smart-mix-planner` | H19, T41 |
| `offline-integrity` | H21, T19 |
| `cast-queue` | H22, T21 |
| `opensubsonic` | H23, T26 |
| `listening-projections` | H25, T25, T38, T39 |
| `mcp-maintenance` | H27, T62, T63 |
| `ai-budgets` | H28, T64 |
| `crate-v3` | H30, T56 |
| `observability` | T69, T77, T78 |
| `analyzer-v6` | T45 |
| `ai-queues` | H28, T65 |
| `release-manifests` | H33, T71, T72 |
| `smart-mix-3` | H34, T43, T44, T48, T49, T50, T51 |


Los siguientes hitos se añadieron para dar entrada a capítulos que no tenían un punto propio en el timeline original:

| Hito añadido | Artículos |
| --- | --- |
| `artist-radio` | H08, T33 |
| `personal-library` | H06 |
| `capacitor` | H09, T17 |
| `bandcamp-contributions` | H13 |
| `artwork-variants` | H16, T08 |
| `smart-mix-engine` | H19, T41 |
| `jam-rooms-paused` | H20 |
| `virtualdj-plugin` | H32, T60, T61 |
| `collection-collaboration` | H24, T52 |
| `canonical-shows` | H26, T54, T55 |
| `installer-wizard` | H29, T73, T74 |
| `radio-rotation` | H31, T34 |


## Fuentes de trabajo

Las rutas siguientes existen en el worktree contrastado. Los anchors históricos se resolvieron contra Git. Son puntos de entrada para escribir, no un sustituto de verificar el fragmento y la versión exactos que aparezcan en cada artículo.

| Artículo | Código, documentación o pruebas | Anchor histórico |
| --- | --- | --- |
| H01 | `app/web/src/content/blog/crate-started-as-a-librarian.md` | [`211f715c`](https://github.com/thecrateapp/crate/commit/211f715c) |
| H02 | `app/web/src/content/blog/filesystem-to-indexed-catalogue.md` | [`93764ac3`](https://github.com/thecrateapp/crate/commit/93764ac3) |
| H03 | `app/web/src/content/blog/taking-playback-over-from-navidrome.md` | [`1a4b5b9c`](https://github.com/thecrateapp/crate/commit/1a4b5b9c) |
| H04 | `app/web/src/content/blog/when-retries-repeat-a-download.md` | [`1f9bd46b`](https://github.com/thecrateapp/crate/commit/1f9bd46b) |
| H05 | `app/crate/storage_layout.py`<br>`app/crate/entity_ids.py` | [`647a1d61`](https://github.com/thecrateapp/crate/commit/647a1d61) |
| H06 | `docs/technical/07-auth-users-social-and-sessions.md`<br>`app/tests/test_social_api.py` | [`3c5a4deb`](https://github.com/thecrateapp/crate/commit/3c5a4deb) |
| H07 | `app/crate/audio_analysis.py`<br>`app/crate/bliss.py`<br>`tools/crate-cli` | [`1659f277`](https://github.com/thecrateapp/crate/commit/1659f277) |
| H08 | `app/crate/radio_engine.py`<br>`app/crate/queue_engine.py` | [`603d203a`](https://github.com/thecrateapp/crate/commit/603d203a) |
| H09 | `docs/technical/listen-native-auth-contract.md`<br>`app/listen/android`<br>`app/listen/ios` | [`a3c46ea3`](https://github.com/thecrateapp/crate/commit/a3c46ea3) |
| H10 | `app/crate/db/tx.py`<br>`app/tests/test_db_access_boundaries.py` | [`8a71ad52`](https://github.com/thecrateapp/crate/commit/8a71ad52) |
| H11 | `docs/technical/music-paths.md`<br>`app/crate/music_paths.py` | [`06af0101`](https://github.com/thecrateapp/crate/commit/06af0101) |
| H12 | `app/crate/resource_governor.py`<br>`docs/technical/03-worker-tasks-and-background-services.md` | [`09da2273`](https://github.com/thecrateapp/crate/commit/09da2273) |
| H13 | `app/crate/worker_handlers/bandcamp.py`<br>`app/crate/worker_handlers/contributions.py`<br>`app/tests/test_bandcamp_integration.py` | [`4c283178`](https://github.com/thecrateapp/crate/commit/4c283178) |
| H14 | `docs/technical/android-playback-resumption.md`<br>`app/listen/android` | [`e7380245`](https://github.com/thecrateapp/crate/commit/e7380245) |
| H15 | `app/listen-desktop`<br>`docs/technical/tauri-desktop-support.md` | [`24ac33f7`](https://github.com/thecrateapp/crate/commit/24ac33f7) |
| H16 | `docs/technical/artwork-delivery.md`<br>`app/crate/artwork_materializer.py`<br>`app/tests/test_artwork_read_path_purity.py` | [`d660829d`](https://github.com/thecrateapp/crate/commit/d660829dea06a0a230564a555df97bbfd0a89fdd) |
| H17 | `app/crate/api/connect.py`<br>`app/tests/test_connect_commands.py` | [`f61a5b11`](https://github.com/thecrateapp/crate/commit/f61a5b11) |
| H18 | `docs/technical/federation-overview.md`<br>`docs/technical/federation-production-acceptance.md` | [`a31cc881`](https://github.com/thecrateapp/crate/commit/a31cc881) |
| H19 | `docs/technical/smart-mix-operations.md`<br>`app/crate/smart_mix/planner.py` | [`c156ff5f`](https://github.com/thecrateapp/crate/commit/c156ff5f) |
| H20 | `docs/technical/jam-rooms-status.md`<br>`app/listen/src/app-shell/feature-flags.ts` | [`cc6ba118`](https://github.com/thecrateapp/crate/commit/cc6ba118) |
| H21 | `docs/technical/listen-offline-runtime-policy.md`<br>`app/listen/src/lib` | [`1085da4e`](https://github.com/thecrateapp/crate/commit/1085da4e) |
| H22 | `app/shared/cast/src/protocol.ts`<br>`app/cast-receiver`<br>`app/tests/test_cast_sessions.py` | [`75cf968f`](https://github.com/thecrateapp/crate/commit/75cf968f) |
| H23 | `docs/technical/opensubsonic.md`<br>`app/crate/subsonic` | [`180ce918`](https://github.com/thecrateapp/crate/commit/180ce918) |
| H24 | `docs/technical/playlist-crate-collaboration.md`<br>`app/crate/api/crates.py` | [`77ea09d3`](https://github.com/thecrateapp/crate/commit/77ea09d3) |
| H25 | `app/crate/scrobble.py`<br>`docs/technical/listening-stats-projections.md` | [`f3842fb4`](https://github.com/thecrateapp/crate/commit/f3842fb4) |
| H26 | `app/crate/db/repositories/show_identities.py`<br>`app/crate/db/repositories/show_consolidation.py` | [`02b658a1`](https://github.com/thecrateapp/crate/commit/02b658a1) |
| H27 | `docs/technical/crate-mcp.md`<br>`app/crate/agent_operations.py` | [`0d70300b`](https://github.com/thecrateapp/crate/commit/0d70300b) |
| H28 | `docs/technical/ai-agents.md`<br>`app/crate/ai/runtime.py`<br>`app/crate/ai/queues.py` | [`af03f5fb`](https://github.com/thecrateapp/crate/commit/af03f5fb) |
| H29 | `app/installer/cmd/crate/main.go`<br>`app/installer/internal/manifest`<br>`app/installer/internal/doctor` | [`d189cc36`](https://github.com/thecrateapp/crate/commit/d189cc36) |
| H30 | `app/shared/AGENTS.md`<br>`app/shared/ui/lib/crate-identity.ts`<br>`docs/plans/2026-10-14-crate-v3-design-system.md` | [`bfbae59e`](https://github.com/thecrateapp/crate/commit/bfbae59e) |
| H31 | `app/crate/recommendation_policy.py`<br>`docs/technical/evidence/radio/rotation-review.md` | [`924b7fb6`](https://github.com/thecrateapp/crate/commit/924b7fb6) |
| H32 | `tools/vdj-plugin/src/sdk/online_source_plugin.cpp`<br>`app/crate/api/vdj_catalog.py` | [`f0820f92`](https://github.com/thecrateapp/crate/commit/f0820f92) |
| H33 | `scripts/release_manifest.py`<br>`scripts/deploy.sh`<br>`docs/technical/deployment-profiles.md` | [`77f10e86`](https://github.com/thecrateapp/crate/commit/77f10e86) |
| H34 | `app/crate/smart_mix/structure.py`<br>`app/crate/smart_mix/candidates.py`<br>`docs/technical/smart-mix-operations.md` | [`6606b09a`](https://github.com/thecrateapp/crate/commit/6606b09a) |
| T01 | `app/crate/enrichment.py`<br>`app/crate/db/repositories/library_enrichment_writes.py`<br>`app/tests/test_enrichment.py` | `224d3378d52d2047eb522645166efe5b7e1c0b5d`; fragmentos verificados |
| T02 | `app/tests/test_tidal_artifacts.py`<br>`docs/technical/05-enrichment-acquisition-and-integrations.md` | main contrastado; fijar revisión al redactar |
| T03 | `app/crate/storage_import.py`<br>`app/tests/test_storage_import.py` | main contrastado; fijar revisión al redactar |
| T04 | `app/crate/storage_import.py`<br>`app/tests/test_prerelease_import_identity.py` | main contrastado; fijar revisión al redactar |
| T05 | `app/crate/library_sync.py`<br>`app/tests/test_library_sync.py` | main contrastado; fijar revisión al redactar |
| T06 | `app/crate/db/repositories/entity_identity_keys.py`<br>`app/tests/test_library_scan_identity_conflicts.py` | main contrastado; fijar revisión al redactar |
| T07 | `app/crate/genre_taxonomy.py`<br>`app/crate/genre_taxonomy_inference.py`<br>`app/tests/test_genre_taxonomy_global_contract.py` | main contrastado; fijar revisión al redactar |
| T08 | `app/crate/artist_hero_artwork.py`<br>`app/tests/test_artist_hero_publication.py`<br>`docs/technical/artist-hero-theming-rollout.md` | main contrastado; fijar revisión al redactar |
| T09 | `app/web/src/content/blog/reads-from-snapshots.md` | main contrastado; fijar revisión al redactar |
| T10 | `app/crate/db/tx.py`<br>`app/tests/test_db_tx.py`<br>`app/tests/test_domain_event_outbox.py` | main contrastado; fijar revisión al redactar |
| T11 | `app/crate/db/domain_events.py`<br>`app/crate/projector.py`<br>`app/tests/test_domain_events.py` | main contrastado; fijar revisión al redactar |
| T12 | `app/crate/db/cache_invalidation.py`<br>`app/crate/domain_event_relay.py`<br>`app/tests/test_domain_event_relay.py` | main contrastado; fijar revisión al redactar |
| T13 | `app/crate/db/repositories/tasks_claims.py`<br>`app/tests/test_task_runtime_contract.py` | main contrastado; fijar revisión al redactar |
| T14 | `app/crate/db/repositories/task_control.py`<br>`app/tests/test_task_control_actor.py` | main contrastado; fijar revisión al redactar |
| T15 | `app/media-worker/src/zip.rs`<br>`app/media-worker/src/package.rs`<br>`app/crate/worker_handlers/crate_download.py`<br>`app/tests/test_crate_downloads.py` | main contrastado; fijar revisión al redactar |
| T16 | `app/crate/media_access.py`<br>`docs/technical/listen-media-access.md`<br>`app/readplane` | main contrastado; fijar revisión al redactar |
| T17 | `docs/technical/listen-native-auth-contract.md`<br>`app/listen/src/lib` | main contrastado; fijar revisión al redactar |
| T18 | `docs/technical/android-playback-resumption.md`<br>`app/listen/android` | main contrastado; fijar revisión al redactar |
| T19 | `docs/technical/listen-offline-runtime-policy.md`<br>`app/listen/src/lib` | main contrastado; fijar revisión al redactar |
| T20 | `app/crate/db/repositories/connect.py`<br>`app/tests/test_connect_commands.py`<br>`app/tests/test_connect_ws_v2.py` | main contrastado; fijar revisión al redactar |
| T21 | `app/shared/cast/src/protocol.ts`<br>`app/tests/test_cast_sessions.py`<br>`app/tests/test_cast_session_api.py` | main contrastado; fijar revisión al redactar |
| T22 | `app/crate/radio_continuation.py`<br>`docs/technical/playback-continuation.md`<br>`app/tests/test_radio_lease_recovery.py` | main contrastado; fijar revisión al redactar |
| T23 | `docs/technical/09-playback-realtime-and-subsonic.md`<br>`docs/technical/federation-capacity.md`<br>`app/crate/streaming` | main contrastado; fijar revisión al redactar |
| T24 | `app/listen/src/lib/equalizer.ts`<br>`app/listen/src/lib/gapless-player-equalizer.test.ts`<br>`app/listen/src/hooks/use-equalizer-runtime.ts`<br>`app/listen/src/hooks/use-equalizer-runtime.test.tsx` | main contrastado; fijar revisión al redactar |
| T25 | `app/tests/test_play_event_contracts.py`<br>`tools/vdj-plugin/src/automix/play_events.cpp`<br>`docs/technical/09-playback-realtime-and-subsonic.md` | main contrastado; fijar revisión al redactar |
| T26 | `docs/technical/opensubsonic.md`<br>`app/crate/subsonic`<br>`app/tests/test_opensubsonic_docs.py` | main contrastado; fijar revisión al redactar |
| T27 | `docs/technical/federation-protocol.md`<br>`app/tests/test_federation_outbound_transport.py`<br>`app/tests/test_federation_key_rotation.py` | main contrastado; fijar revisión al redactar |
| T28 | `docs/technical/federation-protocol.md`<br>`app/tests/test_federation_catalog_sync_resume.py` | main contrastado; fijar revisión al redactar |
| T29 | `docs/technical/federation-protocol.md`<br>`docs/technical/federation-capacity.md`<br>`app/readplane` | main contrastado; fijar revisión al redactar |
| T30 | `docs/technical/federation-imports.md`<br>`app/crate/worker_handlers` | main contrastado; fijar revisión al redactar |
| T31 | `app/crate/bliss.py`<br>`app/crate/db/queries/bliss_similarity_candidates.py`<br>`app/tests/test_bliss_queries.py` | main contrastado; fijar revisión al redactar |
| T32 | `app/crate/audio_analysis.py`<br>`app/tests/test_audio_analysis.py` | main contrastado; fijar revisión al redactar |
| T33 | `app/crate/queue_engine.py`<br>`app/crate/radio_engine.py`<br>`app/tests/test_shaped_radio_engine.py` | main contrastado; fijar revisión al redactar |
| T34 | `app/crate/recommendation_policy.py`<br>`app/tests/test_radio_session_rotation.py`<br>`docs/technical/evidence/radio/rotation-review.md` | main contrastado; fijar revisión al redactar |
| T35 | `app/crate/music_paths.py`<br>`app/crate/music_path_validation.py`<br>`app/tests/test_music_paths_service.py` | main contrastado; fijar revisión al redactar |
| T36 | `app/crate/db/paths_similarity.py`<br>`app/crate/db/queries/recommendation_context.py`<br>`docs/technical/evidence/recommendations-review/benchmarks.json` | main contrastado; fijar revisión al redactar |
| T37 | `app/crate/smart_mix/transition_fit.py`<br>`app/tests/test_radio_transition_fit.py`<br>`docs/technical/evidence/radio/transition-fit.md` | main contrastado; fijar revisión al redactar |
| T38 | `app/crate/scrobble.py`<br>`app/crate/db/jobs/scrobble_dispatch.py`<br>`app/tests/test_scrobble_lastfm.py` | main contrastado; fijar revisión al redactar |
| T39 | `docs/technical/listening-stats-projections.md`<br>`app/crate/db/jobs/user_listening_projections.py`<br>`app/tests/test_user_listening_projections.py` | main contrastado; fijar revisión al redactar |
| T40 | `docs/plans/crate-v3-analysis/2026-10-24-insights-resolution.md`<br>`app/crate/db/queries/collection_insights.py`<br>`app/crate/db/queries/collection_insights_sql.py`<br>`app/crate/db/collection_insights_surface.py`<br>`app/tests/test_collection_insights.py` | main contrastado; fijar revisión al redactar |
| T41 | `app/web/src/content/blog/smart-mix-planned-on-the-server.md` | main contrastado; fijar revisión al redactar |
| T42 | `app/web/src/content/blog/a-beat-grid-in-a-few-bytes.md` | main contrastado; fijar revisión al redactar |
| T43 | `app/web/src/content/blog/finding-the-one.md` | main contrastado; fijar revisión al redactar |
| T44 | `app/web/src/content/blog/lyrics-as-labels.md` | main contrastado; fijar revisión al redactar |
| T45 | `app/crate/smart_mix/key_detection.py`<br>`app/tests/test_smart_mix_key_detection.py`<br>`tools/smart-mix-eval/reference` | main contrastado; fijar revisión al redactar |
| T46 | `app/crate/smart_mix/source.py`<br>`app/crate/db/repositories/smart_mix.py`<br>`app/tests/test_smart_mix_publication.py` | main contrastado; fijar revisión al redactar |
| T47 | `app/crate/db/jobs/smart_mix_backfill.py`<br>`app/crate/db/repositories/smart_mix_signals.py`<br>`app/tests/test_smart_mix_backfill.py` | main contrastado; fijar revisión al redactar |
| T48 | `app/crate/smart_mix/structure.py`<br>`app/tests/test_smart_mix_structure.py`<br>`tools/smart-mix-eval/structure/README.md` | main contrastado; fijar revisión al redactar |
| T49 | `app/crate/smart_mix/candidates.py`<br>`app/crate/smart_mix/policy.py`<br>`app/tests/test_smart_mix_candidates.py` | main contrastado; fijar revisión al redactar |
| T50 | `app/crate/smart_mix/evaluation.py`<br>`tools/smart-mix-eval/render_pair.py`<br>`tools/smart-mix-eval/blind_session.py` | main contrastado; fijar revisión al redactar |
| T51 | `app/crate/smart_mix/refinement.py`<br>`app/crate/smart_mix_ai.py`<br>`app/tests/test_smart_mix_refinement_apply.py` | main contrastado; fijar revisión al redactar |
| T80 | `crate-decks: docs/plans/2026-11-08-smart-mix-stems-design.md`<br>`crate-decks: docs/plans/2026-11-08-smart-mix-stems-spike-report.md` | ramas `feat/smart-mix-stems-*` sin integrar; fijar revisión al redactar |
| T81 | `crate-decks: docs/plans/2026-11-08-smart-mix-stems-design.md` | ramas `feat/smart-mix-stems-*` sin integrar; fijar revisión al redactar |
| T82 | `crate-decks: docs/plans/2026-11-08-smart-mix-stems-spike-report.md`<br>`crate-decks: docs/plans/2026-11-08-smart-mix-stems-implementation-plan.md` | sin integrar; fijar revisión al redactar |
| T52 | `docs/technical/playlist-crate-collaboration.md`<br>`app/crate/api/crates.py` | main contrastado; fijar revisión al redactar |
| T53 | `app/crate/api/share.py`<br>`app/crate/api/crates.py`<br>`app/tests/test_crates_api.py` | main contrastado; fijar revisión al redactar |
| T54 | `app/crate/db/repositories/show_identities.py`<br>`app/crate/db/repositories/show_consolidation.py`<br>`app/tests/test_show_identity.py` | main contrastado; fijar revisión al redactar |
| T55 | `app/crate/show_extraction.py`<br>`app/crate/show_ocr.py`<br>`app/tests/test_show_import_plans.py` | main contrastado; fijar revisión al redactar |
| T56 | `app/shared/AGENTS.md`<br>`app/shared/ui/lib/crate-identity.ts`<br>`app/shared/ui` | main contrastado; fijar revisión al redactar |
| T57 | `app/shared/ui`<br>`docs/plans/2026-10-14-crate-v3-design-system.md` | main contrastado; fijar revisión al redactar |
| T58 | `app/listen/src/components/player/visualizer/useMusicVisualizer.ts`<br>`app/listen/src/components/player/visualizer/useMusicVisualizer.test.ts`<br>`app/listen/src/components/player/visualizer/MusicVisualizer.test.ts` | main contrastado; fijar revisión al redactar |
| T59 | `app/crate/agent_editorial.py`<br>`app/crate/db/repositories/editorial_plans.py`<br>`app/tests/test_mcp_editorial.py` | main contrastado; fijar revisión al redactar |
| T60 | `tools/vdj-plugin/src/core/request_coordinator.cpp`<br>`tools/vdj-plugin/src/core/connection_worker.cpp`<br>`tools/vdj-plugin/src/cache/sqlite_metadata_cache.cpp`<br>`tools/vdj-plugin/tests` | main contrastado; fijar revisión al redactar |
| T61 | `tools/vdj-plugin/src/online_source/online_source.cpp`<br>`tools/vdj-plugin/src/automix/play_events.cpp`<br>`app/crate/api/vdj_catalog.py` | main contrastado; fijar revisión al redactar |
| T62 | `app/crate/db/repositories/agent_plans.py`<br>`app/crate/agent_operations.py`<br>`app/tests/test_agent_plan_approvals.py` | main contrastado; fijar revisión al redactar |
| T63 | `app/crate/agent_access.py`<br>`app/crate/agent_scope_catalog.py`<br>`app/tests/test_agent_oauth_jobs.py` | main contrastado; fijar revisión al redactar |
| T64 | `app/crate/ai/runtime.py`<br>`app/crate/db/repositories/ai_usage.py`<br>`app/tests/test_ai_capacity_recovery.py` | main contrastado; fijar revisión al redactar |
| T65 | `app/crate/ai/operations.py`<br>`app/crate/ai/queues.py`<br>`app/tests/test_ai_bulk_yield.py`<br>`app/tests/test_ai_concurrency_requeue.py` | main contrastado; fijar revisión al redactar |
| T66 | `app/crate/ai/capabilities.py`<br>`app/crate/ai/transport.py`<br>`app/tests/test_ai_openai_compatible_transport.py` | main contrastado; fijar revisión al redactar |
| T67 | `docs/technical/hermes-plan-confirmation.md`<br>`app/crate/agent_telegram.py`<br>`app/tests/test_hermes_confirmation.py` | main contrastado; fijar revisión al redactar |
| T68 | `docs/technical/crate-operator.md`<br>`deploy/operator/state.py`<br>`deploy/operator/watchdog.py`<br>`app/tests/test_operator_watchdog.py` | main contrastado; fijar revisión al redactar |
| T69 | `app/web/src/content/blog/observing-a-home-server.md` | main contrastado; fijar revisión al redactar |
| T70 | `app/web/src/content/blog/reading-errors-without-trusting-them.md` | main contrastado; fijar revisión al redactar |
| T71 | `scripts/release_manifest.py`<br>`app/tests/test_release_manifest.py`<br>`app/tests/test_sentry_release_contract.py` | main contrastado; fijar revisión al redactar |
| T72 | `scripts/deploy.sh`<br>`scripts/deploy-remote.sh`<br>`docs/technical/upgrade-v2-to-v3.md`<br>`docs/technical/deployment-profiles.md` | main contrastado; fijar revisión al redactar |
| T73 | `app/installer/internal/manifest`<br>`app/installer/internal/doctor`<br>`app/installer/internal/install`<br>`deploy/install/integrations.yaml` | main contrastado; fijar revisión al redactar |
| T74 | `app/installer/internal/copilot/session.go`<br>`app/installer/internal/copilot/tools.go`<br>`app/installer/internal/copilot/portal.go`<br>`app/installer/internal/copilot/copilot_test.go` | main contrastado; fijar revisión al redactar |
| T75 | `scripts/observability_release.py`<br>`docs/technical/monitoring.md`<br>`app/tests/test_observability_release.py` | main contrastado; fijar revisión al redactar |
| T76 | `app/crate/streaming/maintenance.py`<br>`app/crate/storage_health.py`<br>`docs/technical/storage-retention.md` | main contrastado; fijar revisión al redactar |
| T77 | `app/crate/observability/playback_qoe.py`<br>`app/listen/src/contexts/use-player-playback-observability.ts`<br>`app/tests/test_playback_observability.py` | main contrastado; fijar revisión al redactar |
| T78 | `app/crate/db/jobs/product_kpis.py`<br>`app/tests/test_product_kpis.py`<br>`docs/technical/product-kpis.md` | main contrastado; fijar revisión al redactar |
| T79 | `docs/releases/v3.2.3.md`<br>`docs/releases/v3.2.4.md`<br>`.github/workflows`<br>`docs/technical/android-release-signing.md`<br>`docs/technical/ios-release-and-cast.md` | main contrastado; fijar revisión al redactar |

La investigación incluyó historial, documentación técnica, planes, implementaciones y casos de regresión. El archivo se validó contra las rutas del repositorio, los anchors históricos, los 41 artículos escritos y los 51 IDs del timeline ampliado. No se han inferido resultados de producción a partir de una prueba unitaria o de un objetivo de SLO.

