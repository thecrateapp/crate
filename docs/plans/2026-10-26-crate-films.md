# Películas de Crate: Listen y Admin

> **Estado (2026-11-18):** Parcial. Las películas están renderizadas y el reproductor (app/web/src/components/Film.astro) existe, pero no se muestran en ninguna página: pendiente la segunda ronda de montaje. La galería de capturas sí está publicada en /listen y /admin.

2026-10-26 · propuesta para revisión de Diego.

## Objetivo

Sustituir el screencast v2 de la web (cinco capítulos grabados en plano fijo dentro de una ventana
falsa) por dos películas cortas de la v3, montadas al ritmo de un track real: una de Listen y otra
de Admin. Tienen que subir el nivel del site, no bajarlo.

## Decisiones de Diego (2026-10-26)

- Dos películas: Listen y Admin.
- Formato 1 + 2: película a tempo real dentro de una sección que el scroll fija y revela.
- Todo al ritmo del track. Móvil y escritorio a la vez en pantalla.
- Momentos de Listen: reproductor, playlists y Crates (lo que solo tiene Crate).
- Tracks de la biblioteca de producción, de artistas pequeños; Diego pide el permiso después.
  Mandy, Indiana y Oscar Mulero se descartaron por demasiado duros:
  - Listen: Mano Le Tough, "Primative People (Tale of Us remix)" (2013, Permanent Vacation).
  - Admin: Kompromat, "LIFT ME UP" (2025).
- Portadas reales en pantalla: Diego asume el riesgo.

## Referencias

- Película cortada a ritmo: Ableton Live 12 (loop de cabecera de 21 s), teaser "New Raycast".
- Revelado por scroll y zoom al detalle: Logic Pro (MacBook + iPad con la UI real), AirPods Pro 3.
- Lecturas de datos animadas: Spotify Wrapped 2025, Warp (fig. 1, botón de sonido visible).

## Estructura musical

Rejilla obtenida con `film/beats.py` (librosa) sobre el FLAC de producción: tempo constante
ajustado al tramo entero de la ventana, descartando los beats que el tracker coloca fuera de sitio,
y fase afinada con los beats fuertes. Se guarda en `film/data/*.beats.json`; Remotion monta sobre
esa rejilla, nunca sobre segundos a mano.

### Listen: Mano Le Tough, "Primative People (Tale of Us remix)", 120 BPM, compás de 2 s

Ventana 5:26.1 → 6:26.1 (compases 163–192, 60 s): 16 compases de breakdown sin bombo que van
construyendo y el drop en el compás 179 (5:58.1), a mitad de la película. Es instrumental.

| Compases | Música | Planos |
| --- | --- | --- |
| 163–164 | Breakdown | Negro. La waveform del propio fragmento se dibuja al beat. "Your music." |
| 165–166 | Breakdown | Biblioteca en escritorio, cuadrícula de portadas, cámara inclinada en 3D con dolly lento |
| 167–168 | Breakdown | Entra el móvil con el mismo álbum. "Everywhere." |
| 169–170 | Breakdown | Página de álbum en los dos; tap en play |
| 171–172 | Subida | Reproductor a pantalla completa en escritorio; player en el móvil |
| 173–174 | Subida | Zoom a lecturas reales: FLAC, 120 BPM, tonalidad, energía. Letra sincronizada de "Destiny" (John Talabot, Pional), una línea por compás |
| 175–176 | Subida | Cortes cada beat: cola, sugeridas, waveform; aceleración |
| 177–178 | Final de la subida | Corte a negro: "Dig." |
| 179–182 | Drop | Playlists: una mezcla se genera y las pistas caen en su sitio, escritorio y móvil a la vez |
| 183–188 | Drop | Crates, el plano estrella: los álbumes pasan como discos en una caja, uno por beat; colaboradores; crate pública compartida |
| 189–190 | Drop | Montaje cada dos beats: radio, paths, jam, offline |
| 191–192 | Drop | Cierre: marca, "Crate. Listen." y llamada a la acción |

En el player suena el propio "Primative People": la banda sonora es lo que se está reproduciendo.

### Admin: Kompromat, "LIFT ME UP", 122 BPM, compás de 1,97 s

Ventana 1:46.3 → 2:45.4 (compases 53–82, 59 s): 8 compases de breakdown casi vacío con el bajo
subiendo, 8 de subida con los hats creciendo y el drop en el compás 69 (2:17.8).

| Compases | Música | Planos |
| --- | --- | --- |
| 53–56 | Breakdown | Panel de salud de la instancia; cámara lenta en 3D |
| 57–60 | Breakdown | Escaneo e importación: la cola avanza |
| 61–64 | Subida | Pipeline de enrichment en marcha: tareas, proveedores, progreso |
| 65–68 | Subida | La cola de análisis avanza un paso por beat: "Analysing LIFT ME UP" |
| 69–72 | Drop | Golpe a los instrumentos de análisis: 122 BPM, tonalidad, mood map, energía; un corte por beat |
| 73–75 | Drop | Adquisición: Soulseek y Tidal descargando, importación |
| 76–78 | Drop | Agentes: Crate Agent y MCP actuando sobre la biblioteca |
| 79–80 | Drop | Estadísticas y sistema |
| 81–82 | Drop | Cierre con marca, "Crate. Admin." y llamada a la acción |

## Producción

La pipeline actual (`tools/screencast`: Playwright captura frames y eventos, Remotion compone) se
mantiene; cambia la puesta en escena.

1. **Datos.** Se captura con Listen (5174) y Admin (5173) locales de `feat/crate_v3` contra la API
   de producción (`API_URL=https://api.lespedants.org`), como ya se trabaja a diario. La sesión
   la abre Diego en el navegador de Playwright y se guarda en un `storageState` fuera del repo.
   En Admin, los nombres y correos de otros usuarios se sustituyen en la captura (interceptando
   las respuestas en Playwright), nunca en producción.
2. **Tomas.** Cada plano es una toma corta (2–8 s) con su guion en el director de Playwright:
   escritorio 1440×900 a 2x y móvil 390×844 a 3x. Ya no se graba un recorrido largo.
3. **Rejilla.** `beats.json` por película (downbeats, secciones, silencios) generado con librosa y
   corregido a mano. Es lo único que decide cuándo corta un plano.
4. **Composición en Remotion.** Escenario 1920×1080. Cámara virtual con perspectiva CSS 3D sobre
   los frames capturados (inclinación, dolly, zoom a detalle); escritorio y móvil coreografiados
   en el mismo plano; tipografía cinética con los tokens v3; lecturas con los datos reales del
   track. Variante vertical 4:5 para móvil.
5. **Audio.** El fragmento va en la película (AAC) con fundidos.
6. **Codificación.** WebM (AV1 o VP9) y MP4 H.264, a 1080p y 720p, más póster. Presupuesto:
   unos 6–8 MB por película a 1080p.

## Web

- Nuevo `Film.astro` en lugar de `Screencast.astro`, como sección fijada:
  - Fase de scroll: el escritorio y el móvil llegan inclinados y se enderezan (GSAP ScrollTrigger
    + Lenis, solo `transform` y `opacity` sobre el póster).
  - Al fijarse, la película arranca desde el principio, en silencio por defecto, con botón de
    sonido. Se pausa fuera de pantalla.
  - Marcadores de capítulo (Reproductor, Playlists, Crates…) que se encienden con la película y
    permiten saltar.
  - `prefers-reduced-motion`: sin animación de scroll; póster y botón de play.
  - `preload="none"` hasta que la sección se acerca al viewport.
- Tests: Vitest para el controlador (revelando → reproduciendo → pausado, sonido, capítulos) y
  Playwright e2e en las páginas; presupuesto de peso.

## Fases

| Fase | Contenido | Hecho cuando |
| --- | --- | --- |
| 1 | `beats.json` de los dos tracks y animático: el guion por compases con frames provisionales, renderizado sobre la música | Diego aprueba el ritmo y la lista de planos |
| 2 | Stack local v3 con el volcado, datos saneados y todas las tomas de las dos películas | Cada plano del guion tiene su toma |
| 3 | Composición en Remotion: cámara, tipografía, lecturas, cierre; borradores renderizados | Diego aprueba los dos cortes |
| 4 | `Film.astro`, revelado por scroll, sonido, capítulos, accesibilidad y rendimiento; tests | Las dos películas funcionan en la web en escritorio y móvil |
| 5 | Codificación final, pósters, presupuesto, publicación | Peso dentro del presupuesto y screencast v2 retirado |

## Riesgos

- Permisos de los dos tracks (Diego). Puede hacer falta también el visto bueno del sello o la
  editorial para uso sincronizado.
- El plano de letras usa "Destiny" (John Talabot, Pional): Primative People es instrumental. En
  LRCLIB la versión sincronizada está como "Destiny feat. Pional"; hay que comprobar que Crate la
  encuentra para "John Talabot, Pional / Destiny" y no se queda con la letra sin sincronizar.
- Primative People y Destiny salen en Permanent Vacation: el permiso puede ir en una sola
  conversación con el sello, además de los artistas.
- Peso de vídeo y reproducción en móvil: la fase de scroll no toca el vídeo, solo transforma el
  póster; la película se reproduce normal.
- El worktree `website` tiene cambios sin commitear de otro agente. Este trabajo empieza cuando
  termine, o en un worktree propio.

## Decisiones (2026-10-26, segunda ronda)

- Datos: Listen y Admin locales contra la API de producción.
- Letras: "Destiny" (John Talabot, Pional) en el plano de letras.
- Formatos: 16:9 y variante vertical 4:5 para móvil.

## Decisiones abiertas

1. Ubicación: Listen en la home y en `/listen`, Admin en `/admin` (propuesta).

## Estado (2026-10-26)

- **Fase 1 hecha.** `film/beats.py` (tempo constante ajustado al tramo de la ventana, beats mal
  colocados descartados, fase afinada con los beats fuertes) y rejillas en `film/data/`: Listen
  120,003 BPM y Admin 122,008 BPM, con el 100 % de los beats en la rejilla. Guion por compases en
  `film/storyboard.ts` y animáticos 16:9 y 4:5 (`npm run film:animatic`).
- **Fase 2 hecha.** Tomas por plano con Listen y Admin locales contra la API de producción:
  - `film/guard.ts`: ninguna escritura sale del navegador (solo pasan `auth/refresh` y
    `auth/media-access`); lo bloqueado queda en `blocked.json` de cada toma.
  - `film/capture.ts` con `--force-device-scale-factor`: frames a 2880×1800 (escritorio) y
    1170×2532 (móvil) a 60 fps; el screencast headless entrega píxeles CSS sin ese flag.
  - Listen (`film/takes/listen.ts`): biblioteca, home, álbum, reproductor en el drop, letras de
    Destiny, aceleración, playlist, Crates (cover flow de 12 discos), radio, paths y stats.
  - Admin (`film/takes/admin.ts`): dashboard, cola de adquisición, tasks, análisis, ficha de
    Kompromat, búsqueda real en Tidal, agentes y System Health.
- Datos creados en producción por Diego (vía Claude): Crates "After Hours" y "Hecho en España"
  (públicos, sin colaboración) y la playlist "Late Night Drive".
- Escenificado durante la captura (`film/stage.ts`, `film/scenes/admin.ts`): trabajo en curso de
  Admin (descarga de Kompromat, pipeline, Soulseek), letra sincronizada de Destiny desde LRCLIB,
  "Unknown Artist" fuera de la biblioteca, "Crate Agent" en lugar del nombre del motor y la
  búsqueda de Soulseek sin lanzarla en la red.
- Montaje de Listen: radio, paths y stats (Jam y offline no tienen pantalla propia que enseñar).

## Problemas de producto encontrados

- La búsqueda de letras no casa "feat." ni artistas múltiples ("John Talabot, Pional / Destiny").
- "Destiny" está duplicada en la biblioteca (John Talabot y John Talabot, Pional).
- Agents → Connections muestra "Crate Hermes Agent": el producto no debe nombrar el motor.
- Agents → Telegram approver responde "Not Found"; Insights no carga ("Collection insights could
  not be loaded"). Puede ser desfase entre Admin v3 y la API desplegada (48eec6a).
- "Unknown Artist" (0 álbumes) aparece entre los artistas seguidos; varios álbumes guardados no
  tienen portada (Fear Inoculum, Antemasque…).

## Segunda ronda: variedad y sección de capturas (2026-10-26)

### Diagnóstico del primer corte

Beats por toma (cada película dura 120 beats):

| Listen | Beats | Admin | Beats |
| --- | --- | --- | --- |
| Crates (cover flow) | 24 (20 %) | Cola de descargas | 24 (20 %) |
| Reproductor | 12 | Dashboard | 20 (17 %) |
| Playlist | 12 | Tasks | 20 (17 %) |
| Muro de artistas | 16, en dos planos seguidos | Ficha de Kompromat | 16 |
| Álbum + reproductor | 28 con la misma portada | Agents (foto fija) | 12 |
| Letras | 8, repetidas en dos planos | System Health (foto fija) | 8 |

- Admin: tres pantallas (cola, dashboard y tareas) ocupan el 54 % de la película.
- Listen: el muro de artistas sale dos veces seguidas, y álbum, reproductor y reproductor en
  escritorio enseñan la misma portada durante 28 beats. La aceleración son pestañas del mismo
  reproductor.
- Regla nueva: ninguna toma repite en planos consecutivos y ninguna pasa del 12 % de la película,
  salvo el cover flow de Crates, que es el plano estrella.

### Tomas nuevas

Todas en escritorio y móvil, a pantalla completa, con el guard y la escenificación de siempre.

| App | Toma | Qué enseña |
| --- | --- | --- |
| Listen | `home-hero` | Home arriba: artista destacado a toda pantalla y su carrusel |
| Listen | `artist` | Ficha de Mano Le Tough: foto, biografía, discografía |
| Listen | `explore` | Explore: salas de género con foto y "Just landed" |
| Listen | `digging` | Historia "Crate Digging" ("512 minutes listened") |
| Listen | `radar` | Radar: próximos lanzamientos y conciertos |
| Listen | `search` | Búsqueda tecleando "Talabot" con resultados al instante |
| Listen | `equalizer` | Reproductor con el ecualizador abierto |
| Listen | `crates-index` | Colección de Crates (los tres) y el Crate en móvil |
| Admin | `browse` | Browse Artists: cuadrícula con fotos y filtros |
| Admin | `release-radar` | Release Radar: pendientes de decisión y lista |
| Admin | `system-playlists` | Playlists editoriales con foto |
| Admin | `library-health` | Library Health: problemas detectados y reparación |
| Admin | `album` | Ficha de álbum con su análisis por pista |
| Admin | `stack` | Stack: 23/23 servicios corriendo |
| Admin | `dashboard`, `tasks`, `agents` en móvil | Para dúos donde ahora solo hay escritorio |

Descartadas: Discovery (casi vacío en producción), Jam y Offline (sin pantalla propia), genre wheel
(decisión de Diego).

### Montaje propuesto (mismos compases y misma música)

Listen:

| Plano | Antes | Después |
| --- | --- | --- |
| Library (165–166) | Muro de artistas | Home con artista destacado (4) y muro de artistas (4) |
| Everywhere (167–168) | Muro + home en móvil | Dúo: ficha de Mano Le Tough y home en móvil |
| Readouts (173–174) | Reproductor + letras | Ecualizador (4) y dúo de letras (4) |
| Acceleration (175–176) | Pestañas del reproductor | Un beat por pantalla: búsqueda, Explore, Radar, cola, Digging, artista, Crates, Stats |
| Playlists (179–182) | Playlist ×3 + letras | Dúo playlist (4), Explore (4), playlist en móvil (4), dúo radio (4) |
| Crates (183–188) | 11 clics + móvil | 8 clics de cover flow (16) + índice de Crates en dúo (4) + Crate en móvil (4) |
| Montage (189–190) | Radio, paths ×2, stats | Radio, paths, Digging y Radar |

Admin:

| Plano | Antes | Después |
| --- | --- | --- |
| Health (53–56) | Dashboard ×2 | Dúo de dashboard (8) y Library Health (8) |
| Scan and import (57–60) | Cola ×2 | Dúo de la cola (8) y Release Radar (8) |
| Enrichment (61–64) | Tasks ×2 | Tasks (4), dúo de Kompromat (4), Browse (4), dúo de tasks (4) |
| Analysis queue (65–68) | Dashboard, Analysis, Tasks, cola | Ficha de álbum (4), Analysis (4), tasks en móvil (4), dashboard (4) |
| Analysis (69–72) | Pestañas de Kompromat | Sin cambios |
| Acquisition (73–75) | Búsqueda ×2 + cola | Búsqueda (4), dúo de Release Radar (4), dúo de la cola (4) |
| Agents (76–78) | Agents ×2 (foto fija) | Agents (4), dúo de System Playlists (4), Agents en móvil (4) |
| Stats (79–80) | System Health + móvil | System Health (4) y dúo de Stack (4) |

### Sección de capturas en la web

Objetivo: una galería de muchas partes de Listen y Admin, siempre escritorio y móvil juntos, con el
mismo lenguaje visual que las películas.

- **Mismo formato que el vídeo**: cada captura es un fotograma de una composición de Remotion
  (`remotion still`) con el encuadre "dúo" de la película: ventana de escritorio y teléfono con el
  mismo fondo, sombras, radios y pose de cámara en reposo (sin inclinación, para que se lea). Así
  galería y vídeo no pueden divergir.
- **Captura**: `film/stills.ts` con un manifiesto de pantallas (id, app, título, texto alternativo,
  ruta y acciones en escritorio y en móvil, escenificación). Capturas sueltas a 2x y 3x con el
  mismo guard; nada escribe en producción.
- **Catálogo** (unas 24, ampliable):
  - Listen: home, artista, álbum, reproductor, letras, ecualizador, cola, Crates (cover flow e
    índice), playlist, Explore, Radar, radio, paths, Stats, Digging y búsqueda.
  - Admin: dashboard, tasks, Browse, ficha de artista, ficha de álbum, Library Health, búsqueda de
    adquisición, cola, Release Radar, System Playlists, Agents, System Health y Stack.
- **Salida**: WebP 2560×1440 y 1280×720 (srcset), objetivo de unos 200 KB a 1280; manifiesto
  generado `app/web/src/content/gallery.ts` (título, alt y tamaños), que sustituye al actual
  `content/shots.ts` (v2, solo Listen).
- **Web**: `Gallery.astro` con pestañas Listen/Admin, rejilla de tarjetas (imagen y título) y vista
  ampliada con teclado (flechas, Escape) y foco gestionado. Carga diferida; textos en `i18n/en.ts`.
- **Tests**: el manifiesto tiene escritorio y móvil y alt en cada captura; Vitest para el
  controlador de la vista ampliada; Playwright en la página; presupuesto de peso.

### Decisiones abiertas

1. Tomas nuevas y montaje propuestos: ¿se quita o se añade algo?
2. Dónde va la galería: sección propia en la home, en `/listen` y `/admin` (cada una con lo suyo), o
   página `/gallery` enlazada desde ambas.
3. Pose de las capturas: de frente (propuesta, se lee mejor) o con la misma inclinación que el vídeo.
