# Visuales para el blog de ingeniería

## Dirección vigente (9 de noviembre de 2026)

Las figuras del primer lote se construyeron como paneles de control: titular propio, pestañas de escenario, Play/Step/Reset, deslizador y un párrafo de advertencias. Ocupaban más espacio en interfaz que en el mecanismo y su estado inicial no explicaba nada. La película de radio de H31 falla en sentido contrario: movimiento decorativo sin mecanismo visible. Ambas son ejemplos de lo que no hay que hacer.

La referencia son las visualizaciones del propio site: el mix de "Inside Crate" en la home, la órbita de enrichment de Admin y la red de federación de Listen. Una figura muestra un solo mecanismo en movimiento y se entiende también como imagen fija. Tiene cinco partes, en este orden:

1. Barra de etiqueta: etiqueta cian, contexto en mono, interruptor de versiones cuando el artículo cuenta una transformación y etiqueta `Example` cuando la secuencia o los valores son ilustrativos.
2. Una escena SVG a todo el ancho con rótulos HTML. Nombres y constantes del código citado.
3. Tres o cuatro lecturas en tipografía display: ámbar para el fallo, cian para la corrección.
4. Tres o cuatro fases numeradas con un título corto y una frase.
5. Un pie de una línea con la procedencia.

La figura se anima sola mientras está en pantalla, con un ciclo de 8 a 10 segundos. La tira de fases es el control: pulsar una fase la fija y pulsarla otra vez reanuda. Con movimiento reducido se muestra el final de cada versión. Sin JavaScript se leen la escena renderizada en el servidor y todas las fases.

El kit está en `app/web/src/components/blog-viz/BlogFigure.astro` y `app/web/src/scripts/viz/blog/` (`phase-clock.ts`, `phase-loop.ts`), registrado en el sistema `data-viz` del site. La receta paso a paso es la skill `crate-blog-figures` (`.agents/skills/crate-blog-figures/SKILL.md`). La especificación vive en [la guía del blog](engineering-blog.md#interactive-figures).

| Figura | Estado |
| --- | --- |
| H17 Connect (`ConnectHandoff`) | Hecha con el kit y aprobada. v1/v2 en la misma escena. |
| H19 Crossfade (`CrossfadeEngine`) | Hecha con el kit y aprobada. UI timer, PCM envelope y shared bus. |
| H12 workers (`WorkersAdmission`) | Rehecha con el kit con la skill. Gobernador, puertas y carriles; un solo estado. |
| T01 enrichment (`EnrichmentJourney`) | Rehecha con el kit con la skill. Órbita de fuentes, ficha y pool de tres. |
| H34 Smart Mix (`SmartMixCandidates`) | Rehecha con el kit con la skill. v2, v3 con estructura y v3 sin estructura. |
| H11 Music Paths (`MusicPathJourney`) | Rehecha con el kit con la skill. Tres rutas de regresión en un eje de pasos. |
| H31 radio (`RadioRotation`) | Rehecha con el kit con la skill. Candidatos ordenados y tres memorias; la película y su estudio se retiraron. |

Las secciones del historial que describen controles, modelos o controladores de `scripts/blog-viz/` se refieren a la implementación anterior, ya retirada. El análisis de cada artículo sigue siendo válido.

Para revisar una figura: capturas de cada fase fijada en escritorio y a 390 px, la versión sin JavaScript y la de movimiento reducido. Una captura de la escena inicial no valida el proceso.

## Historial del primer lote (8 de noviembre de 2026)

Lo que sigue documenta la propuesta y la implementación de Codex. Se conserva por el análisis de cada artículo y la procedencia de sus datos. Donde describe controles, autoplay manual o un formato de panel, lo sustituye la dirección vigente.


Propuesta del 8 de noviembre de 2026. El primer lote incluye un artículo nuevo de enrichment y mejoras visuales en crossfade y Smart Mix 3. **Enrichment, crossfade, Smart Mix 3, Connect (H17), workers (H12), Music Paths (H11) y radio (H31) están implementados como borradores en la preview, con sus visuales interactivas.**

El escenario de caché sigue una nueva ejecución 25 horas después: cinco fuentes siguen vigentes y Setlist.fm requiere un fetch. El de proveedor caído muestra una biografía ausente en la propuesta y conservada al escribir; los géneros sí cambian con la respuesta disponible de Spotify. Un país protegido permite comparar la propuesta de MusicBrainz con el valor finalmente guardado.

## Qué está produciendo la monotonía

La revisión inicial de los 34 capítulos encontró 25 con seis o siete secciones y 23 con cuatro bloques de código. Veintinueve tenían una sola referencia a un SVG estático; ese recuento no incluye la visual interactiva de crossfade, ya implementada. La repetición también está en el recorrido: apartados de peso parecido y un cierre de pruebas, límites y antes/después. Añadir movimiento no corrige por sí solo esa estructura.

Mantenemos la voz y el recorrido acordados —problema, alternativas, implementación y resultado—. Ese recorrido puede ser una investigación de un fallo, un experimento, el seguimiento de un dato o una comparación de implementaciones. No requiere la misma cantidad de secciones, código o figuras en cada capítulo.

El [inventario editorial de los 34 capítulos](engineering-blog-editorial-variety.md) registra prioridades y estados. La primera revisión de estructura ya aplicada cubre H05 (seguir un álbum durante la migración y su nueva importación) y H10 (repetir una operación fallida con dos conexiones y una sesión compartida). H34 acompaña esa tanda con la visual y el experimento descritos abajo. La segunda revisa H06 (dos cuentas ante el mismo álbum) y H24 (los menús y permisos de una colección), con tablas de comparación y los diagramas estáticos existentes. Las tandas posteriores y la revisión completa de los 17 capítulos restantes constan en ese inventario. La revisión editorial está cubierta; las visuales opcionales siguen sus propios estados.

La tercera revisión editorial cubre H12 y H17. H12 sitúa el aplazamiento antes de explicar los pools; H17 sigue la transferencia entre teléfono y escritorio y distingue `ready`, cambio de propietario y reproducción. Ambos conservan sus diagramas estáticos. Esa revisión de texto no implementó las animaciones; posteriormente se añadió la de Connect descrita abajo. H12 incorpora después la visual de admisión descrita abajo.

La cuarta revisión cubre H23 y H29, ya bajo el nombre **How to dismantle Spotify. Building Crate from the ground.** H23 compara el stub de playlists con su implementación y un test de serialización; H29 sigue las decisiones de configurar una integración o revisar la instalación completa. Conservan sus diagramas estáticos y no añaden capturas ni salidas de terminal simuladas.

La quinta revisión cubre H04 y H25. H04 añade una tabla de ramas y respuestas reales del handler; H25 usa en prosa el caso UTC/Los Ángeles del test de proyecciones. Ambos mantienen los diagramas estáticos. La animación de retries sigue siendo candidata, y no se ha fabricado una reproducción del race histórico.

## Primer lote

### Enrichment: seguir la construcción de una ficha

**Nuevo artículo técnico: “Building an artist page when the providers disagree”.** Es T01 del [roadmap](engineering-blog-roadmap.md). H07 explica el análisis del audio; el enriquecimiento con proveedores remotos necesita su propio artículo. Lo enlazaremos desde los primeros capítulos sin cambiar la numeración de la serie histórica.

La apertura sigue una ficha incompleta: tiene nombre y discos locales, pero faltan identidad, biografía, imágenes o géneros. La visual deja ver qué aporta cada fuente y cómo se construye el resultado, con tres zonas:

- Fuentes: Last.fm, Spotify, MusicBrainz, Setlist.fm, Fanart.tv y Discogs cuando está configurado.
- Ejecución: caché por fuente y tres puestos de trabajo, el paralelismo predeterminado.
- Resultado: campos con su procedencia, respuestas todavía en memoria y posterior persistencia.

El lector puede reproducir el proceso, pausarlo, avanzar una operación o volver al inicio. Tres escenarios cambian el recorrido: **First enrichment**, **Cached sources** y **Provider unavailable**. Al seleccionar un campo de la ficha se ilumina la fuente que lo aportó. Un campo protegido conserva su valor; una respuesta ausente no aparece como una orden de vaciarlo.

Las respuestas se reúnen antes de ensamblar la ficha; no se publica una actualización de la ficha por cada future terminado. Las cachés de Last.fm, Spotify, MusicBrainz, Setlist.fm, Fanart.tv y Discogs tienen TTL de 7, 3, 30, 1, 30 y 30 días, respectivamente. Los efectos sobre fotos, géneros y similitudes tienen pasos propios: no hay una transacción única que haga infalible todo el enriquecimiento. Las duraciones de la demostración serán ilustrativas y se identificarán como tales.

El artículo sigue esa ficha: qué falta, qué llega, qué discrepa, qué se conserva y qué acaba guardado. El código acompaña las decisiones de caché y persistencia donde aparecen en el recorrido. Las fuentes de álbumes y letras no se dibujarán como si todas pertenecieran al fan-out de `enrich_artist`.

Base: [enrichment.py](../../app/crate/enrichment.py), [escritura de campos](../../app/crate/db/repositories/library_enrichment_writes.py), [pruebas](../../app/tests/test_enrichment.py).

### Crossfade: distinguir el plan del reloj que lo ejecuta

**Rehecha el 9 de noviembre con el kit** como `CrossfadeEngine`; lo que sigue describe la versión anterior.

**H19: “From crossfades to a shared mixing engine”.** Dos pistas horizontales comparten un cursor temporal. Debajo se ven sus envolventes de ganancia y el reloj que las gobierna.

El lector alterna tres etapas de Android: **UI timer**, **PCM envelopes** y **Shared output**. **Block UI thread** simula un bloqueo entre 2 y 3,2 segundos: el timer mantiene la última ganancia aplicada y salta a la posición correspondiente al tiempo transcurrido cuando vuelve a ejecutarse. Las envolventes PCM avanzan por frames procesados; la salida común añade una coordenada para programar el inicio del canal entrante. No se bloquea el hilo real del navegador ni se atribuye este fallo a la automatización de Web Audio.

Controles: **Play**, **Pause**, **Reset** y un deslizador del tiempo. Cambiar de modo conserva la posición y pausa la reproducción para comparar ganancias. La demostración es silenciosa: usa ondas sintéticas, seis segundos, 48 kHz y staging a 0 dB. El frame de salida representa PCM producido por software, no sonido medido en los altavoces. Abstrae los buffers y parte de decks preparados y alineados; no inventa una deriva entre salidas independientes.

El artículo abre con la transición que se interrumpe y reconstruye el fallo. El visual aparece antes del primer fragmento del timer original. Después sigue las envolventes, los perfiles y planes del servidor, y la salida común. Conserva los esquemas estáticos que explican la publicación de perfiles y la topología del bus.

El técnico **“Planning DJ transitions on the server, playing them on a phone”** puede reutilizar pistas y cursor para otra pregunta: cómo se ejecuta un plan con preroll, beats, bass swap y restauración de tempo. Cada artículo tendrá una configuración y una explicación propias; compartir componentes no obliga a repetir la misma demostración.

Base reutilizable: [MixViz](../../app/web/src/components/viz/MixViz.astro), [representación](../../app/web/src/scripts/viz/mix-view.ts), [matemáticas](../../app/web/src/scripts/viz/mix-math.ts).

### Smart Mix 3: ver cuánto cuesta evitar una mala transición

**H34: “Giving Smart Mix a sense of musical structure”.** Dos pistas se representan mediante frases, energía y regiones con voz. El lector selecciona candidatos de una pareja documentada y observa dónde empieza y acaba la mezcla.

La comparación muestra simultáneamente:

- Regiones con voz que coinciden durante la mezcla.
- Inicio y final de cada pista que quedan fuera.
- Duración y alineación con las frases.

Mover la selección anima las fronteras de la transición, de modo que se vea la música que se gana o se pierde. Un caso sin estructura muestra el fallback exacto a v2. No hay control de pesos: el navegador compara planes calculados con el planner de Python, sin simular un ranking nuevo.

La investigación encontró planes y métricas de las 184 transiciones reales, pero los exports no conservaban los perfiles completos de frases, energía y voz. La visual usa por ello el caso sintético `voiced_dj` de `app/tests/smart_mix_candidate_cases.py`, fijado en `6b53412a6602c1d7fb34c1ef14498f8263b11243`. Las señales son entradas manuales del test; los candidatos y sus métricas salen del planner y evaluador reales. La figura lo declara y el artículo separa este ejemplo de la evaluación sobre la biblioteca real.

El baseline conserva toda la música activa y estima 19,42 segundos de solapamiento vocal. La primera opción de v3 lo reduce a cero dejando 92,16 segundos de cola; la alternativa deja 15,36 segundos de cola y omite 30,72 segundos de entrada. Las tres pasan las comprobaciones de política. La figura cuenta toda la música activa omitida, incluidas las partes etiquetadas intro/outro que el término de posición puede eximir. El caso sin estructura elimina también las señales de voz y presenta el solapamiento como desconocido, no como cero.

El artículo abre con la evaluación de 184 transiciones de la biblioteca y después propone el experimento sintético: elegir planes, inspeccionar lo que cambia y leer el generador y sus restricciones. Una tabla desplegable conserva los valores sin JavaScript. La selección anima las ventanas durante 650 ms; con movimiento reducido cambia directamente. Las etiquetas son HTML para no deformar el texto al estrechar el SVG.

Implementación: [SmartMixCandidates](../../app/web/src/components/blog-viz/SmartMixCandidates.astro), [modelo](../../app/web/src/scripts/blog-viz/smart-mix-model.ts), [controlador](../../app/web/src/scripts/blog-viz/smart-mix-controller.ts). El [generador](../../tools/smart-mix-eval/export_blog_fixture.py) reproduce los valores y comprueba el commit de origen; `python3 tools/smart-mix-eval/export_blog_fixture.py --check` verifica el JSON sin modificarlo. Validación específica: nueve pruebas Vitest, cuatro Playwright y 22 Python (planner y exportador), además de la comprobación general del site.

Base: [candidatos](../../app/crate/smart_mix/candidates.py), [evaluación y procedencia](../../tools/smart-mix-eval/README.md), [artículo](../../app/web/src/content/blog/giving-smart-mix-a-sense-of-musical-structure.md).

## Connect: la cola, el propietario y el reproductor

**Rehecha el 9 de noviembre con el kit** como `ConnectHandoff`; lo que sigue describe la versión anterior.

**H17, implementado en la preview.** `ConnectTransfer` presenta Phone, Server y Desktop con el mismo marco del blog. Una ruta anima los mensajes; otro indicador sigue la autoridad del servidor. Aplicar la cola, cambiar el propietario y ejecutar resume/pause se muestran como estados distintos.

Tres escenarios: **Normal handoff**, **Slow destination** y **Autoplay blocked**. En el segundo, el teléfono conserva la sesión mientras el destino aplica la cola sin autoplay. `transfer_ready` todavía no cambia la autoridad. Después del commit, el modelo muestra una posible recepción desfasada de las dos notificaciones. Un destino bloqueado conserva la propiedad; el guard de 2,5 segundos solicita un gesto y el botón **Simulate a click on the desktop** permite completar esa recuperación. Play no evita ese paso.

Play/Pause, Step, Reset y scrubber funcionan por teclado. Cambiar de escenario reinicia; inspeccionar otro instante descarta un gesto previo. No se inicia automáticamente. Se pausa al salir de pantalla, ocultar la pestaña o cambiar la preferencia de movimiento. Con movimiento reducido avanza en saltos de medio segundo. La tabla desplegable explica los estados sin JavaScript; el control de recuperación también permanece oculto en ese caso.

Es una demostración silenciosa del protocolo v2 fijado en `bef0448d`, no una medición de latencia o sonido. Los retardos y el orden de recepción son ilustrativos; el guard de 2,5 segundos sí procede de la implementación. El ejemplo supone versión aceptada y commit correcto. Timeout, versiones obsoletas, cancelación y persistencia siguen en el texto y su diagrama estático, sin prometer que se hayan simulado.

Implementación anterior: `ConnectTransfer.astro`, `connect-model.ts` y `connect-controller.ts`, retirados el 9 de noviembre. La actual: [figura](../../app/web/src/components/blog-viz/ConnectHandoff.astro), [modelo](../../app/web/src/scripts/viz/blog/connect.ts), [vista](../../app/web/src/scripts/viz/blog/connect-view.ts). El artículo conserva sus cuatro extractos y todos los enlaces anteriores; incorpora una introducción breve revisada con Humanizer. Connect y H12 ya tienen sus visuales aprobadas para revisión en la preview. Validación: 511 pruebas Vitest, 21 casos de navegador de las cuatro visuales, tres comprobaciones de código/cabecera de H17, Astro check (310 archivos sin diagnósticos), build y presupuesto. La revisión independiente no encontró incidencias; una comprobación adicional detectó y corrigió el control de recuperación visible indebidamente por CSS, con un test de navegador que pasó de rojo a verde.

## Workers: admitir menos sin cancelar lo que ya corre

**H12, implementado en la preview.** `WorkersAdmission` usa una línea temporal con cuatro runtimes y seis filas de trabajo. Al principio ya están admitidos sync #11, reparación #41 y batch A. Una petición de playback usa el worker de preparación si necesita una variante; el trabajo admitido sigue avanzando. Al observar actividad reciente, la siguiente reparación #42 queda pending con el mismo ID y sin entrar al handler. El daemon termina su batch actual y espera antes de reclamar B.

La secuencia incluye parar la escucha sin borrar su evidencia reciente. Después comprime la caducidad de las ventanas iniciales de tres y cinco minutos. Que la señal caduque no ejecuta por sí solo una tarea: el siguiente chequeo de análisis reclama B; el mensaje aplazado de #42 llega después y vuelve a consultar admisión antes de empezar. El ejemplo supone que las otras métricas y la ventana de mantenimiento permiten continuar.

Las barras y el cursor animan esta cronología ilustrativa, con etiquetas HTML fuera de las marcas para conservar legibilidad móvil. Los IDs y duraciones son de la demostración, no una reproducción del incidente. Las filas no cuentan threads ni dibujan CPU liberada. Preparar una variante termina y deja libre su worker; servir el audio no se representa como una tarea perpetua de ese worker. La nota visible conserva el matiz de los checkpoints cooperativos: este ejemplo deja terminar el trabajo, pero otros handlers pueden esperar dentro de su propio checkpoint.

Play/Pause/Replay, Step al siguiente evento, Reset y scrubber. Sin autoplay; pausa por visibilidad y cambios de movimiento. Con movimiento reducido, Play salta entre decisiones. Sin JavaScript quedan las filas, sus etiquetas y la tabla desplegable de decisiones. El marco, controles, cian/ámbar, tipografía y fondo coinciden con el blog; no hay tarjetas internas decorativas, controles flotantes ni scrollbar adicional.

Implementación: [figura](../../app/web/src/components/blog-viz/WorkersAdmission.astro), [modelo](../../app/web/src/scripts/blog-viz/workers-model.ts), [controlador](../../app/web/src/scripts/blog-viz/workers-controller.ts). La introducción y los textos de la visual están en inglés y revisados con Humanizer; se conservan los cuatro extractos y todos los enlaces anteriores de H12. Validación: 521 pruebas del site, 26 casos de navegador de las cinco visuales, tres de código/cabecera de H12, Astro check (316 archivos sin diagnósticos), build y presupuesto. La revisión independiente confirmó semántica y lifecycle y volvió a ejecutar las diez pruebas específicas, todas verdes. Estas comprobaciones no miden rendimiento ni aceptación de dispositivos en producción.

## Music Paths: reservar no garantiza completar

**H11, implementado en la preview.** `MusicPathJourney` usa tres fixtures de regresión del builder fijado en `f602d82dd3253380234b68aadc5948b303b6803f`: reserva del destino, exclusión de su versión live y catálogo escaso. Los resultados reales de esos inputs son IDs `[1,3,4,5,2]` (5/5), `[1,4,2]` (3/5) y `[1,2]` (2/20). El último conserva sus 18 intentos sin selección intermedia, agrupados en la presentación pero completos en el export.

El [exportador](../../app/web/scripts/export_music_path_fixture.py) ejecuta los cuerpos originales de builder, selector/scorer, interpolación e identidad de canción desde ese commit. Los imports de Crate se aíslan y sus dependencias puras fijadas o adaptadores de fixture se inyectan en namespaces temporales. La consulta devuelve las filas de los tests; los grafos de relaciones/géneros están vacíos y los contextos de extremos son explícitos. No ejecuta SQL, no toca audio ni usa red. Conserva hashes de los seis archivos de origen y las líneas de cada test. `python3 app/web/scripts/export_music_path_fixture.py --check` comprueba que el [JSON](../../app/web/src/data/blog-music-path-fixture.json) coincide con esa reproducción sin modificarlo.

La figura coloca nodos por posición solicitada, sin proyectar vectores acústicos. Muestra el destino reservado antes de cualquier selección intermedia, filas excluidas por ID o familia, tracks añadidos y huecos que siguen vacíos. El navegador reproduce resultados exportados: no vuelve a calcular el ranking ni presenta la longitud completa como calidad musical. Los placeholders de los tests no se atribuyen al recorrido real Clash → Erik Urano de la apertura.

Tres casos seleccionables, Play/Pause/Replay, Step, Reset y slider entre decisiones. El cursor se interpola al reproducir; con movimiento reducido cambia por eventos. Pausa al ocultarse, salir de pantalla o cambiar la preferencia de movimiento. Sin JS quedan el diagrama inicial, el resumen y las tablas de decisiones de los tres casos, con IDs añadidos/reservados y estados de candidatos. Cada caso enlaza el test exacto en el modal de código. Se mantiene el marco único y el lenguaje visual del blog.

Implementación: [figura](../../app/web/src/components/blog-viz/MusicPathJourney.astro), [modelo](../../app/web/src/scripts/blog-viz/music-path-model.ts), [controlador](../../app/web/src/scripts/blog-viz/music-path-controller.ts). Conserva los cuatro extractos y todos los destinos de enlace originales de H11. La introducción y los textos nuevos están en inglés y revisados con Humanizer. La revisión independiente confirmó procedencia y semántica, y detectó dos problemas corregidos con tests rojo→verde: estilos scoped perdidos al reconstruir filas y tablas sin JS demasiado resumidas. Validación: 531 pruebas del site, tres Python, siete de navegador específicas, regresión de las otras visuales, cabecera/código en escritorio/móvil, Astro check/build y presupuesto.

## Candidatos para una segunda selección

| Artículo | Visual que aportaría | Interacción que explica el problema |
| --- | --- | --- |
| H11, Music Paths | Implementada: posiciones solicitadas y decisiones exportadas de Python | Comparar ruta completa, familia reservada y catálogo escaso; preservar destino sin inventar pasos intermedios. |
| H17, Connect | Implementada: secuencia de teléfono, servidor y escritorio | Destino lento y autoplay bloqueado; separa cola aplicada, autoridad y estado de reproducción declarado por cada cliente. No mide sonido audible. |
| H04, retries | Recorrido de una descarga e importación | Provocar un fallo en un punto concreto y repetir; comparar qué fase vuelve a ejecutarse. |
| H12, workers | Implementada: cuatro runtimes con seis filas de trabajo | La señal reciente aplaza la reparación #42 sin cancelar #41; el siguiente batch queda sin reclamar. Tras caducar la señal, nuevas comprobaciones admiten el trabajo. |
| H31, radio | Implementada: ranking y tres memorias | Comparar skip breve, escucha significativa/familia, límite de calidad y pool escaso; seguir la entrega al buffer. |

Connect, workers, Music Paths y radio ya están implementadas. H04 (retries) sigue como candidata opcional; no hay una cuota de animaciones.

## Radio: entrega, buffer y escucha significativa

**H31, implementado en la preview.** `RadioRotation` presenta candidatos ordenados por puntuación y tres memorias distintas: buffer activo (exclusión), las últimas 500 familias entregadas en la sesión (cooldown) y escuchas significativas de siete días. Cuatro trazas comparan un skip de cinco segundos, una escucha de treinta segundos que conserva la identidad de una versión live, una alternativa fuera del margen de 0.05 y un pool sin candidatos frescos. La selección viaja al buffer con un token animado; el punto de inspección sigue las decisiones, no coordenadas acústicas.

El [exportador](../../app/web/scripts/export_radio_fixture.py) ejecuta los cuerpos originales de selector, identidad, umbral y ledger desde `924b7fb6d08e0a9a80a8241ed41786aa7a770824`. Usa filas sintéticas y distancias fijas con pesos solo acústicos, como el aislamiento de ranking del test histórico. No ejecuta SQL, Redis ni el generador completo; no reproduce la comparación de Citizen ni mide calidad musical. Los hashes fijan las fuentes. Cada estado vuelve a consultar el selector con las memorias mostradas; el navegador solo reproduce la salida exportada, incluidos los cambios de normalización del pool.

En el skip, 0.10 gana primero y 0.40 gana el refill por memoria de entrega sin fabricar escucha significativa. Con historia, 0.14 sustituye a 0.10 dentro del límite 0.15. Si las alternativas puntúan 0.40 y 1.00, se conserva la canción reciente. Si solo queda una fila ya entregada y el buffer está vacío, puede volver; su puntuación normalizada pasa a 1.00. La familia que sigue en el buffer carece de puntuación porque está excluida.

Controles Play/Pause/Replay, Step, Reset y rango; sin autoplay. Movimiento reducido discreto, pausa fuera de pantalla o al ocultar la pestaña, cleanup de Astro y tablas completas de las cuatro trazas sin JavaScript. El enlace al selector abre el modal del código y líneas del commit exacto. Se conservan todos los extractos, imágenes, enlaces y metadata anteriores de H31. Textos nuevos en inglés revisados con Humanizer.

La revisión independiente confirmó semántica y procedencia y detectó la lista en orden de catálogo. Se corrigió en el exportador con un test rojo→verde; el navegador no vuelve a rankear. La prueba móvil detectó y corrigió el offset heredado del prose. Validación final: 540 pruebas del site, ocho Python de los dos exportadores (cinco de radio), 39 casos de navegador de las siete visuales, tres de cabecera/código de H31, Astro check sin diagnósticos, build y presupuesto. Ambos exports coinciden con la ejecución de Python fijada. La figura se revisó también en la preview del navegador.

## Artículos que ganan más con otro tipo de visual

| Artículo | Cambio editorial propuesto |
| --- | --- |
| H05, identidades | Aplicado: seguir las referencias de un álbum antes de mover sus archivos; tabla de estados de recuperación junto al worker y diagrama estático conservado. |
| H10, transacciones | Aplicado: secuencia del fallo de una operación, comparación con sesión compartida y escrituras/rollback junto al código. |
| H24, colaboración | Aplicado en la segunda tanda: matriz de menús de Listen, diferencias con los permisos de API y comparación Follow/Copy. Conserva el diagrama estático de relaciones; la retención de miembros al apagar colaboración se explica solo para playlists. |
| H25, historial | Revisión editorial aplicada en la quinta tanda: ejemplo UTC/local del fixture y reconstrucción del día junto al código. Conserva el diagrama de eventos, proyecciones y scrobbles; un calendario visual adicional sigue siendo opcional. |
| H29, instalador | Revisión de texto aplicada en la cuarta tanda: configure/install, preservación de secretos y diagnóstico con casos del código y sus tests. Se conserva estático el esquema general. Un transcript futuro necesitaría una ejecución real documentada. |
| H30, sistema de diseño | Aplicado: capturas reales de FormField/Input en login de Admin y Listen con foco de teclado, a 1280 × 720, fuente `5c8b6562`. No se atribuyen estados de error a estas capturas; los contratos de error y descripción se explican con tests. |

H20, Jam, también admite una secuencia animada, pero su diagrama ya muestra el orden de los mensajes. Lo revisaría después de los casos donde el movimiento explica una dimensión ausente.

## Lenguaje visual y comportamiento común (sustituido)

Sustituido por la [dirección vigente](#dirección-vigente-9-de-noviembre-de-2026). Se conserva el texto original:


Un solo marco exterior con el fondo, borde y radio del blog. Las zonas interiores representan datos o estados; no añaden una segunda tarjeta decorativa. Texto, cian, tipografía y controles siguen el site. Pistas, mapas, carriles, calendarios y fichas no tienen por qué convertirse en la misma colección de cajas.

Las animaciones se inician mediante un control. Los pasos y el estado final son legibles antes de reproducirlas. No hay bucles permanentes, audio automático ni scroll secuestrado. En móvil se reorganizan los carriles y se conserva el control temporal sin una segunda barra de scroll.

Todos los controles admiten teclado y foco visible. Con movimiento reducido, los cambios se presentan por pasos sin interpolación. Sin JavaScript quedan el diagrama estático, sus etiquetas y la explicación. Al salir de pantalla o esconder la pestaña se pausa el trabajo; al navegar con Astro se desmontan listeners y animaciones. Las preferencias de movimiento se vuelven a comprobar si cambian durante la sesión.

El site ya tiene carga diferida y gestión de visibilidad en [viz/index.ts](../../app/web/src/scripts/viz/index.ts) y [viz/loop.ts](../../app/web/src/scripts/viz/loop.ts). Podemos reutilizar esa infraestructura con SVG/HTML y controladores TypeScript, cargando sólo lo que usa el artículo. No hace falta introducir otro motor de animación.

[EnrichmentOrbit](../../app/web/src/components/viz/EnrichmentOrbit.astro) sirve de referencia de color y geometría, pero su bucle actual no explica fallos o fusión de datos. MixViz aporta curvas y beats; su bloque de scroll de 290vh no se trasladará al cuerpo del blog. Las variantes del blog deben disponer de controles y un tamaño que permita seguir leyendo.

## Cómo revisar el primer lote

Primero, preparar enrichment y su artículo. Revisar que un lector puede identificar qué dato vino de cada fuente, qué se reutilizó y qué ocurrió al fallar una llamada. Después, revisar crossfade con las dos pistas y, por último, Smart Mix 3 con planes calculados sobre el fixture declarado.

Las pruebas deben comprobar estados y decisiones: tres tareas como máximo en el escenario predeterminado de enrichment; ganancias y límites coherentes en la transición; candidatos y regiones omitidas coincidentes con el fixture. La revisión en navegador cubre pausa, reinicio, teclado, móvil, movimiento reducido y navegación de Astro. Una captura de la escena inicial no valida el proceso que la animación cuenta.

## Ajustes del navegador de hitos

El timeline cuenta cambios de capacidad; el orden de capítulos organiza la lectura. Varios hitos pueden llevar a un mismo artículo, pero el enlace debe mostrar su título y parte reales. La página de destino debe conservar el hito seleccionado. La visita directa puede seguir abriendo el primer hito del artículo.

El arreglo de paquetes macOS de v3.2.4 queda como material del artículo técnico T79. Para H33, el hito pertinente es la introducción de manifiestos completos de release, el 27 de julio, con su commit propio. Cambiar el texto de la release de noviembre sin cambiar su identidad y fecha habría contado una cronología falsa.

También se revisa que la descripción de un hito no prometa asuntos ausentes del destino: Rust ZIP en un artículo de read plane Go, offline en transacciones, o instalador y Operator en el capítulo de identidad visual. Un hito relevante sin artículo adecuado puede quedar sin enlace.
