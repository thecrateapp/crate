# Recomendaciones de tracks e Infinite Playback: análisis

> **Estado (2026-11-18):** Análisis, sin tareas propias. Sus arreglos están en main (PR #299, #301, #304 y #339) y el plan de ejecución es [2026-10-27-playback-recommendations-and-music-paths-plan.md](2026-10-27-playback-recommendations-and-music-paths-plan.md).

Fecha: 2026-10-27. Rama: `feat/crate_v3`. Código inspeccionado:
`e9e02147a57c9bf8a1e60fb431c1e1c39f48342f`.

Estado: análisis, sin cambios de implementación. Diego describe saltos recurrentes entre
estilos sin relación y colas que terminan pese a tener Infinite Playback activo. No recuerda
los temas concretos. No se ha identificado el target de reproducción ni inspeccionado una
sesión de producción; tampoco se ha comprobado el SHA desplegado. Los defectos descritos se
deducen del código de esta rama. Los ejemplos sintéticos no reconstruyen su escucha.

## Conclusión

Hay dos problemas independientes: coherencia musical y continuidad de reproducción. Ambos
tienen defectos concretos. Cambiar únicamente el peso del género deja intactos los casos de
agotamiento, repetición de candidatos y parada tras el último tema.

La selección secuencial tiene sentido, pero no requiere una petición HTTP por canción ni
mantener un único tema pendiente. Conviene conservar un buffer anticipado y elegir cada
candidato contra el anterior, manteniendo el contexto original de la sesión como ancla.
El motor de radio shaped ya contiene parte de esa lógica y es una base reutilizable, aunque
también necesita corregir su agotamiento artificial.

## Qué motor se usa realmente

| Superficie | Recorrido actual | Contexto y secuencia |
| --- | --- | --- |
| Infinite Playback de álbum/playlist | `usePlaybackContinuation` → `fetchInfiniteContinuation` → GET legacy `/api/radio/album`, `/playlist` o `/home-playlist` | Semilla original fija. Lote de 30. Ranking agregado contra varias seeds; no evalúa cada pareja consecutiva. |
| Radio iniciada con seed / Discovery | POST `/api/radio/start` y `/api/radio/next` → `radio_engine` | Sesión con historial y selección secuencial dentro del lote; target evoluciona y se reancla al origen. |
| Continuación nativa Android | POST `/api/playback/continuation` → descriptor shaped o seeded | Shaped reutiliza la sesión; seeded reutiliza generadores legacy sin la caché HTTP. `afterTrackEntityUid` excluye y construye el edge; no cambia la seed musical. |
| Smart Mix | Ranking de compatibilidad y planes por pareja | Optimiza la mezcla/transición de audio. No equivale a recomendar música adecuada a la intención de escucha. |

Fuentes: `app/listen/src/lib/radio.ts:281`,
`app/listen/src/contexts/playback-intelligence-model.ts:6`,
`app/crate/api/radio.py:97`, `app/crate/api/smart_mix.py:185`,
`app/crate/radio_engine.py:1436`, `app/crate/smart_mix/policy.py:30`.

## Hallazgos de continuidad

### P1. Infinite vuelve a pedir el mismo universo sin cursor ni exclusiones

El cliente solo envía la semilla original y `limit`. El GET de álbum/playlist cachea la lista
300 segundos por usuario + seed + limit. No recibe los temas ya escuchados ni un cursor de
sesión. El generador intercalará además originales del álbum/playlist: ratios nominales 0.25
y 0.30, respectivamente.

Después, el cliente deduplica contra toda la cola y los recientes. Puede recibir una lista
no vacía que produce cero incorporaciones. El controller no lo sabe: `appendTracks` devuelve
`void`. La caducidad de caché tampoco garantiza novedad: sin exclusiones, el ranking puede
recuperar los mismos candidatos. No hay un límite universal de exactamente 30 canciones;
la falta de progreso depende del pool y de las seeds elegidas.

Fuentes: `app/listen/src/lib/radio.ts:281`, `app/crate/api/radio.py:316`,
`app/crate/api/radio.py:366`, `app/crate/bliss.py:1162`,
`app/listen/src/contexts/use-player-intelligence-actions.ts:76`.

### P1. EOF natural no invoca continuación ni recupera una respuesta tardía

`onAllFinished` pone reproducción y buffering a false. No llama a continuación. La invocación
de `continueInfinitePlayback` está conectada al botón Next. Si el prefetch falla, queda vacío
o tarda más que la última canción, EOF deja el reproductor detenido.

El prefetch solo añade tracks; no hace append-and-advance. En Gapless, añadir pistas después
del EOF no ejecuta play ni avanza el cursor. Por tanto, puede haber próximos temas disponibles
tras la respuesta tardía y seguir detenido.

Fuentes: `app/listen/src/contexts/use-player-engine-callbacks.ts:263`,
`app/listen/src/contexts/use-player-navigation-actions.ts:189`,
`app/listen/src/contexts/use-playback-continuation.ts:96`,
`app/listen/src/contexts/use-player-intelligence-actions.ts:76`.

### P1. Error, vacío y lote sin novedades no provocan reintento autónomo

Los effects guardan una firma de fuente + track actual + longitud de cola. Tras un error o
vacío conservan esa firma y no programan un retry. El mero paso del tiempo no genera otra
solicitud; una nueva renderización con los mismos valores queda bloqueada por la firma.
En radio shaped, además, cualquier error HTTP de `fetchShapedRadioNext` se convierte en `[]`,
perdiendo la distinción entre error recuperable y ausencia de candidatos.

Fuentes: `app/listen/src/contexts/use-playback-continuation.ts:73`,
`app/listen/src/contexts/use-playback-radio-refill.ts:52`,
`app/listen/src/lib/radio.ts:391`.

### P1, Android. Refill en background depende de crossfade y carece de retry programado

`queueMixRequested` significa `crossfadeMs > 0`. `configureContinuation` borra el token si
esa condición es falsa, aunque haya un descriptor válido de Infinite Playback. Al ocultarse
Android, JS cede el refill al nativo sin comprobar que este tenga configuración utilizable.
Con crossfade apagado puede quedar sin propietario efectivo.

La policy nativa calcula backoff de 10/30/60/300 segundos, pero no programa una llamada al
vencerlo. Solo se comprueba al cambiar de canción, configurar o entrar en background. Un
fallo durante el último tema puede dejar de tener eventos que lo reactiven. El EOF nativo
emite `queueEnded` y abandona el audio focus; no inicia recuperación explícita.

Otra carrera: `applyRefill` aplica unauthorized/failure/exhausted antes de validar la revisión
de cola. Una respuesta vieja puede desactivar la política de una cola nueva. La vigencia de
revisión/configuración debe comprobarse antes de mutar cualquier estado del refill.

Fuentes: `app/listen/src/lib/android-native-engine.ts:402`,
`app/listen/src/lib/android-native-engine.ts:441`,
`app/listen/src/contexts/use-playback-radio-refill.ts:95`,
`app/listen/android/app/src/main/java/app/cratemusic/crate/NativeContinuationPolicy.java:76`,
`app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java:436`,
`app/listen/android/app/src/main/java/app/cratemusic/crate/CrateNativePlaybackService.java:1393`.

El efecto de una respuesta tardía sobre Media3 requiere una prueba Android: la ausencia de
recuperación explícita está confirmada, pero no se ha ejecutado el dispositivo.

### P1, Cast. El append automático no sincroniza la cola del receptor

La acción de inteligencia distingue Android/Gapless y actualiza React. No usa la rama
`syncCustomCastQueue` presente en las mutaciones manuales. Así, la cola local puede crecer
mientras el receiver consume su cola original. Es un defecto condicionado al target Cast;
no se atribuye al incidente de Diego sin identificar el target.

Fuente: `app/listen/src/contexts/use-player-intelligence-actions.ts:76`; comparar con
`app/listen/src/contexts/use-player-queue-mutation-actions.ts:127`.

### P2. Shaped y native también pueden agotar artificialmente un pool

Shaped mantiene todos los IDs/títulos/familias usados durante la sesión, pero SQL solo
excluye los últimos 50 IDs. Recupera un pool limitado a aproximadamente 120–140 filas y
comprueba su tamaño antes de comprobar elegibilidad. Puede recibir suficientes filas ya
usadas, rechazarlas después y terminar sin ampliar o paginar, aunque haya temas válidos
fuera del pool. Los límites por artista sí se relajan; no son topes permanentes.

La continuación seeded nativa intenta overfetch hasta 100 y filtra exclusiones después.
Si todos esos resultados son conocidos puede responder `[]` con `exhausted=false`, sin
progreso. El servicio lo trata como éxito y tampoco programa un nuevo intento.

Fuentes: `app/crate/radio_engine.py:839`, `app/crate/radio_engine.py:972`,
`app/crate/radio_engine.py:1132`, `app/crate/radio_engine.py:1401`,
`app/crate/api/radio.py:106`.

## Hallazgos de relevancia musical

### Género de artista, sin porcentajes y como bonus opcional

El legacy suma Bliss 0.30, BPM 0.15, tonalidad 0.10, energía 0.10, época 0.05,
género 0.15 y artista similar 0.20, además de ajustes personales/curación. Suman 1.05;
0.15 no es un porcentaje normalizado. No hay umbral mínimo de coherencia de género.

`get_similar_from_db` adjunta sets de nombres de géneros del artista. Las consultas no
recuperan `artist_genres.weight`. Se usa Jaccard exacto, sin la taxonomía, y género desconocido
puntúa lo mismo que uno explícitamente disjunto: cero. Las comparaciones de artista para
estas consultas también pueden perder señal por diferencias de capitalización.

Hay datos de género de track (`LibraryTrack.genre`) y perfiles ponderados de álbum/artista
en el modelo y queries existentes. Se debe estudiar su procedencia/cobertura y aplicar una
jerarquía con confianza explícita antes de añadir almacenamiento o suponer que existen
porcentajes fiables propios de cada pista.

Fuentes: `app/crate/bliss.py:181`, `app/crate/bliss.py:922`,
`app/crate/db/queries/bliss_artist_similarity.py:136`,
`app/crate/db/orm/library.py:140`,
`app/crate/db/queries/browse_media_track_genres.py:8`.

### Recuperación y ordenación tampoco garantizan continuidad

La búsqueda de track recupera top 200 por vector antes del reranking. Álbum usa hasta cuatro
seeds y playlist hasta cinco, con selección que incluye `random.shuffle`. Se agregan scores
y apariciones contra ellas, sin puntuar las parejas consecutivas de la cola. La diversidad
posterior regula artista/álbum/título, no coherencia de estilo.

El fallback sin Bliss puede admitir cualquier pista que tenga BPM, energía, tonalidad o
rating, aunque no tenga relación de género. Aumentar el peso en reranking no recupera un
candidato apropiado ausente del pool inicial.

Fuentes: `app/crate/db/queries/bliss_similarity_candidates.py:13`,
`app/crate/db/queries/bliss_similarity_candidates.py:93`, `app/crate/bliss.py:279`,
`app/crate/bliss.py:644`, `app/crate/bliss.py:1148`, `app/crate/bliss.py:1202`.

### Probe sintético de la función de score real

Se evaluó en memoria la función extraída del AST, sin DB ni cambios de archivo:

| Elemento | Vector | BPM | Energía | Año | Género | Resultado |
| --- | --- | --- | --- | --- | --- | --- |
| Seed | `[1, 0]` | 170 | 0.8 | 2000 | punk | — |
| Candidato electrónico | `[1, 0]` | 170 | 0.8 | 2000 | electronic | 0.65 |
| Candidato punk | `[0.3, sqrt(0.91)]` | 110 | 0.5 | 1980 | punk | 0.37 |

Sin artista similar, key/scale, duración, rating ni perfil de usuario. Esto confirma que la
política permite preferir el candidato de género disjunto. No demuestra qué señales tenían
las canciones del incidente ni que cualquier pista punk deba ganar a cualquier electrónica.

## Dirección recomendada, pendiente de revisión

1. Corregir primero el contrato de continuidad: un propietario efectivo por target, refill
   anticipado, EOF como último recurso de recuperación, retries con backoff real, cancelación
   y rechazo de respuestas obsoletas antes de mutar estado. Respuestas vacías, fallos y
   agotamiento deben distinguirse. Las acciones deben comunicar cuántas pistas incorporaron.
2. Sustituir la continuación legacy sin estado por una sesión con intención e historial.
   Reutilizar el núcleo shaped y las primitivas de `queue_engine`, corrigiendo primero sus
   exclusiones/pool/agotamiento. No introducir un tercer recomendador.
3. Recuperar candidatos usando género/contexto además de audio. Separar datos ausentes de
   incompatibilidad conocida. Usar track cuando su señal sea fiable, después álbum y artista,
   con pesos y taxonomía existentes. La semejanza técnica no debe compensar por sí sola un
   cambio arbitrario de estilo en una sesión seeded; Discovery puede tener otra política.
4. Elegir secuencialmente con dos contextos: el último tema para la transición local y el
   perfil original de la sesión para conservar intención. Una cadena pura A→B→C que olvide
   el origen puede derivar gradualmente hacia otro estilo; es un riesgo de diseño, no una
   reproducción observada. Mantener buffer corto anticipado, generado por lotes secuenciales.
5. Definir ventana de no repetición y expansión controlada. Excluir eternamente toda la
   sesión en una biblioteca finita acaba agotando opciones. Ante falta de candidatos, ampliar
   recuperación y relajar límites de diversidad de forma explícita, conservando coherencia;
   no rellenar con cualquier género para ocultar el fallo.

Shaped ya pondera géneros con ancestros, tiene historial y mueve/reancla el target tras cada
selección (`radio_engine.py:1436`). Aun así, su seed track nace con `seed_genres=[]` y la señal
de género sigue siendo de artista. La migración requiere ese trabajo, no basta cambiar de URL.
Smart Mix debe consumir candidatos musicalmente válidos y planificar su transición; su peso
de género 0.05 persigue blendabilidad y no debe fijar la intención de descubrimiento.

## Políticas actuales que requieren decisión de producto

- Infinite queda desactivado con shuffle y repeat distinto de off; es explícito y está probado.
  La expectativa de Diego de continuidad constante obliga a revisar shuffle. Repeat tiene
  prioridad semántica propia y debe conservar un comportamiento definido.
- Solo fuentes album/playlist con `radio.seedId` pueden continuar. `HomePlaylist.handlePlay`
  construye una fuente playlist sin ese descriptor; hay que cubrir todos los puntos de inicio.
- En Android el token de continuación dura 12 horas y se renueva al configurar/volver foreground.
  No existe renovación autónoma de background; no garantiza continuidad indefinida literal.
- Los effects JS no suscriben visibilitychange para reactivar refill. Hay reconciliación nativa
  al volver visible, pero el relleno se reactiva solo indirectamente si cambia su estado.

Fuentes: `app/listen/src/contexts/use-playback-continuation.ts:54`,
`app/listen/src/lib/playback-continuation.ts:49`, `app/listen/src/pages/HomePlaylist.tsx:142`,
`app/crate/db/repositories/access_tokens.py:17`,
`app/listen/src/contexts/use-native-playback-event-bridge.ts:579`.

## Validación y próximos criterios de aceptación

Comprobaciones existentes acotadas, ejecutadas serialmente:

- Listen: `use-playback-intelligence.test.ts` y `lib/radio.test.ts`: 54 tests pasan.
- Backend: `tests/test_bliss.py`: cuatro tests pasan, sin DB real; un aviso de deprecación
  preexistente de Testcontainers.
- Probe sintético descrito arriba. No suites completas, nuevas pruebas persistidas, solicitudes
  a producción ni cambios de implementación.

Que esos tests pasen no invalida los defectos: no prueban varias reposiciones consecutivas,
EOF con solicitud pendiente, retry autónomo tras vacío/error/dedup, entrega al target Cast,
Android con crossfade apagado ni exclusiones que llenan un pool con temas ya usados.

Para una implementación posterior, los casos decisivos son: álbum→continuación→varios lotes;
error temporal recuperado sin interacción; respuesta después de EOF que sigue reproduciendo;
batch completamente duplicado que busca más; pool agotado frente a biblioteca no agotada;
cambio de cola durante un request; par de géneros disjuntos con audio similar; géneros ausentes;
y los mismos contratos en web/Tauri, Android background y Cast.

Rendimiento: no convertir esta mejora en una consulta completa por track. La recuperación
multi-seed legacy cruza biblioteca y seeds y ordena por distancia; hay consultas de artistas
similares por cada artista seed. Reutilizar pools acotados y consultas batch, medir con datos
reales antes de aumentar frecuencia, y mantener un historial/buffer con tamaño controlado.

No hay garantías de cola audible durante indisponibilidad permanente del servidor o ausencia
de música reproducible. Con servidor/biblioteca disponibles, el contrato debe ser mantener
buffer y recuperar fallos temporales automáticamente, sin una parada silenciosa permanente.

## Prueba real posterior: Concubine en producción

A petición de Diego se consultó producción por SSH y se ejecutó el generador desplegado de radio shaped por tema con la colección real y el perfil Diego (administrador, id 1). Código desplegado: `48eec6a6552500b7c504305c70ad10f23f778891`, distinto del HEAD local analizado arriba. Esta prueba valida esa ejecución concreta; no atribuye todos los hallazgos de la rama al despliegue.

Semilla: Converge — Concubine, Jane Doe; library track 5437; 172.3 BPM; género de pista `Metalcore, Mathcore`; vector Bliss y embedding disponibles. Se llamó a `start_radio(mode="seeded", seed_type="track", seed_value="5437")`, respetando el lote inicial normal de 20 y tomando sus diez primeros resultados. Solo se anuló el guardado de la sesión en memoria del proceso diagnóstico; no se persistió una sesión Redis ni se alteró la reproducción. Todas las conexiones SQL del diagnóstico estuvieron en modo read-only.

| # | Artista | Tema | Álbum |
| --- | --- | --- | --- |
| 1 | Botch | Mondrian Was a Liar | We Are the Romans |
| 2 | Coalesce | A New Language | Functioning on Impatience |
| 3 | The Dillinger Escape Plan | Panasonic Youth | Miss Machine |
| 4 | Better Lovers | Become So Small | God Made Me An Animal |
| 5 | The Chariot | They Drew Their Swords | Before There Was |
| 6 | Norma Jean | Blueprints for Future Homes | Redeemer |
| 7 | Cave In | Jupiter | Jupiter |
| 8 | Poison The Well | A Wish for Wings That Work | The Opposite of December... A Season of Separation |
| 9 | Zao | Lies Of Serpents, A River Of Tears | Where Blood And Fire Bring Rest |
| 10 | As I Lay Dying | Nothing Left | An Ocean Between Us |

La generación y la consulta de detalle tardaron 0.797 segundos. El resultado inicial se concentra en artistas del entorno hardcore/mathcore/metalcore; no aparece electrónica en estos diez. Esto no prueba la continuidad de varios lotes ni el recorrido legacy de Infinite Playback tras un álbum. La seed track shaped sigue teniendo `seed_genres=[]`; usa el perfil de artista como contexto de género.

Evidencia local: `2026-10-27-concubine-production-radio.json`, con timestamp, revision de producción, contexto de generación, identificadores, metadatos y resultados originales. Las sesiones nuevas pueden variar por su generation seed y los datos/historial vigentes.


## Contraste posterior: varios rellenos y el recorrido de Infinite

Tras considerar perfecta la primera generación, Diego pregunta por qué la aplicación deriva.
Se contrastó el código del Listen realmente desplegado (`d3e6ef6b94ab233680f3d1a8d0c2c43b5a7d917c`):
radio por track llama a POST start/next y Infinite a los GET legacy de álbum/playlist. La
diferencia está confirmada también en producción, no solo en la rama local. API desplegada:
`48eec6a6552500b7c504305c70ad10f23f778891`.

Se extendió la misma generación shaped de Concubine con su generation seed guardada:
20 iniciales + 30 + 30 = **80 tracks**, usando start/next reales con almacenamiento de sesión
solo en memoria del proceso diagnóstico y SQL read-only. Los primeros diez coinciden con la
prueba anterior. No aparece el salto a electrónica descrito; la secuencia sigue concentrada
en hardcore/mathcore/metalcore y escenas próximas, aunque aparecen candidatos de rock y
post-punk. No se ha evaluado perceptivamente cada transición de audio.

Se ejecutó además el generador real de Infinite para el álbum Jane Doe (id463, usuario1,
limit30). Devuelve30, de los que7 son originales del mismo álbum y se descartarían frente a
la cola que ya contiene el disco. Los diez primeros tras ese descarte son Zao, Converge,
Trap Them, The Number Twelve Looks Like You, The Dillinger Escape Plan, Malevolence,
Between The Buried And Me, Unsane, otra versión de Trust Chaos y Year of the Knife. En esta
muestra tampoco se reproduce el salto a electrónica. No se simuló una cola/recent history
personal completa; solo el descarte de temas del álbum.

**La diferencia de motores es real, pero estas muestras no demuestran que sea la causa del
incidente observado.** Los defectos estáticos de continuidad siguen vigentes; antes de
cambiar pesos hace falta capturar un salto real y correlacionar fuente, seed/session, ruta,
respuesta de candidatos, mutaciones de cola y target/tema efectivamente reproducido. También
conviene contrastar seeds con análisis o perfiles de género incompletos. No atribuir el
incidente a una pérdida de seed ni a un fallback sin esa evidencia.

Evidencias: `2026-10-27-concubine-production-refills.json` y
`2026-10-27-jane-doe-production-infinite.json`. Los diagnósticos no modificaron configuración,
historial, archivos de música, código desplegado ni la reproducción del usuario.


## Citizen: repetición entre sesiones reproducida en producción

Diego añade que abrir Citizen Radio hoy, mañana y pasado, habiendo escuchado sus temas,
vuelve a ofrecer la misma primera cola. El requisito es variar canciones según escuchas
reales entre sesiones, manteniendo la coherencia musical y evitando también agotar colas.

Se probó el generador shaped de producción `48eec6a6552500b7c504305c70ad10f23f778891` con el
perfil Diego1 y artista CITIZEN12682. Se generaron tres sesiones independientes variando el
día de generation_seed a 2026-10-27/28/29. Son fechas simuladas del RNG; todas las pruebas usan
el historial real actual y no se escribieron escuchas futuras ni sesiones en producción.

**Resultado: los mismos20 temas en idéntico orden en las tres sesiones**. Generar las tres
colas y consultar sus metadatos/historial tardó1.322s. Los diez primeros son:

| # | Artista | Tema |
| --- | --- | --- |
| 1 | Movements | Third Degree |
| 2 | Turnover | Humming |
| 3 | Basement | Whole |
| 4 | Movements | Full Circle |
| 5 | Turnover | Cutting My Fingers Off |
| 6 | Title Fight | 27 |
| 7 | Basement | Pine |
| 8 | Balance and Composure | I Tore You Apart In My Head |
| 9 | Title Fight | Shed |
| 10 | Fiddlehead | Get My Mind Right |

El primero, Movements — Third Degree (track263590), ya tiene un evento de reproducción del
usuario1 el2026-10-27 a20:51UTC. La consulta de detalle muestra18.77segundos, completion_ratio0.0829 y was_skipped=false: no es una escucha completa y no debe presentarse como tal. El motor no lee esa señal ni las de reproducción completa para el ranking seeded. Otras canciones
figuran escuchadas meses atrás: haberlas oído alguna vez no debe equivaler a excluirlas para
siempre; la recencia, frecuencia y calidad de escucha importan.

### Causa y dirección del arreglo

`start_radio` carga `load_feedback_history`, pero ese historial es de `radio_feedback`
explícito (likes/dislikes de90d), no de reproducciones. Cada sesión reinicia usados/títulos/
artistas/contexto recientes. El pool prioriza popularidad/rating/ID; el ranking seeded no
consulta recencia del usuario. UUID y día cambian el RNG, pero solo perturban ligeramente el
target; no rotan de forma efectiva candidatos de afinidad/género similares. Esto es independiente
de la caché legacy: la prueba usa el motor shaped, sin persistir sesiones.

El arreglo debe incorporar **historial persistente de escucha por usuario** al ranking,
consultado en batch para el pool de candidatos; enfriar/penalizar lo recién escuchado y
frecuentemente repetido; rotar entre candidatos de calidad comparable; ampliar el pool dentro
del mismo contexto si los topN están enfriados; relajar de forma controlada cuando falte
catálogo. Mantener separadas exposición/generación y escucha efectiva. No aumentar la deriva
vectorial para crear variedad ni prohibir permanentemente todo lo escuchado.

Ya existen `user_track_stats` y `user_play_events`; el diseño debe contemplar IDs local,
entity y global, posibles retrasos de proyección y la identidad canónica de variantes. El
legacy usa otra penalización de escucha14d, pero su query centrada en track_id no debe copiarse
sin adaptar identidades. No hace falta crear un segundo historial ni una nueva pantalla de
settings para esta corrección. Ventana de cooldown y curva de penalización deben concretarse
antes de implementar, conservando candidatas coherentes como las de Concubine.

Fuentes: `app/crate/radio_engine.py:626`, `app/crate/radio_engine.py:679`,
`app/crate/radio_engine.py:1192`, `app/crate/radio_engine.py:1319`,
`app/crate/db/queries/radio_user_queries.py:420`,
`app/crate/db/queries/paths_bliss_candidate_queries.py:331`,
`app/crate/db/queries/bliss_artist_profiles.py:20`.

Criterios de regresión: escuchar/completar un lote y abrir otra sesión relega esos temas;
cambiar solo día/sesión proporciona rotación entre canciones comparables; se mantiene el
estilo; IDs global/entity no eluden el enfriamiento; un catálogo pequeño relaja la política
sin devolver vacío artificial ni entrar en bucle. Los eventos recién recibidos no deben
quedar invisibles por retraso del read model.

Evidencia: `2026-10-27-citizen-production-radio-repeat.json`. No se han modificado algoritmos,
configuración, historial ni reproducción en producción.
