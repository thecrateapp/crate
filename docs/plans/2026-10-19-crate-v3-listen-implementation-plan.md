# Crate V3 — plan de implementación de Listen primero

Fecha: 2026-10-19. Estado: **plan aprobado por Diego junto con 1AU**. Autoriza publicar 1AU
y ejecutar 1AV; cada checkpoint posterior conserva su revisión antes de commit/push. Parte del [inventario por rutas y familias](2026-10-19-crate-v3-listen-inventory.md).

## 1. Resultado y límites

Obtener pronto un recorrido real de Listen con el lenguaje V3: acceder, encontrar un álbum,
abrirlo, reproducirlo, controlar la reproducción y la cola, y conservarlo para escuchar offline.
Después completar las otras rutas y superficies de Listen, antes de retomar las migraciones
específicas de Admin. El primer recorrido es una entrega interna usable, **no Listen V3 terminado**.

La nueva prioridad cambia el orden de trabajo visual. No reescribe los contratos de producto,
no integra Smart Mix, no hace rebase y no cambia la secuencia de integración/release conjunta
registrada en el plan original. No hay PR, merge, deploy, tag ni release autorizados aquí.

1AT está publicado en `67486e4c7414d7c6bca7a6701b35c73440f0dfce`; **1AU sigue local para revisión**.
No se vuelve a construir FormField, Button o una cabecera que ya existe. Se cierra su adopción
cuando un consumidor real lo necesita, retirando la receta duplicada en ese cambio.

## 2. Cómo construir sin esperar a terminar todo el catálogo

1. Terminar la revisión de 1AU y sus ajustes antes de publicar ese bloque.
2. Reconciliar el mínimo kit que usan las primeras páginas: imagen/identidad, entidad/pista,
   composición de colección, capas/menú/estados y navegación. Cada familia incluye un consumidor
   real de Listen; la ficha por sí sola no cierra el trabajo.
3. Construir el recorrido Shell → Collection/Search → Album → Player/Queue con ese kit. Los
   componentes de una familia se revisan juntos; no dedicar un checkpoint a cada variante.
4. Extender ese recorrido al resto de Home, colecciones y páginas existentes de Listen.
5. Incorporar los instrumentos V3 previstos solo cuando sus contratos/datos estén disponibles.
   Un mapa pendiente no bloquea el restyle funcional de Radio o Paths, pero sigue siendo deuda
   de producto explícita al valorar el hito completo.
6. Cerrar una vez la validación de fase y la matriz de plataformas. Hasta entonces cada bloque
   mantiene evidencia focalizada y límites, no una certificación global.

Un componente nuevo permanece local si solo Listen lo usa. Una base shared existente se corrige
sin crear una alternativa Listen con otro nombre. Para una extracción compartida nueva se
identifican dos consumidores **reales** y se migran; no se añade un import ficticio en Admin para
pasar la guarda. El censo de imports es evidencia auxiliar y no sustituye esta revisión.

## 3. Hitos y checkpoints propuestos

Los nombres posteriores a 1AU son una **propuesta de secuencia**, que sustituiría el orden todavía
propuesto del [roadmap general](2026-10-19-crate-v3-component-checkpoint-groups.md) si Diego lo
acepta. No renumeran checkpoints publicados. Se confirma cada alcance antes de abrirlo; si una
familia requiere dos entregas, se divide por contrato/consumidor, no por un componente aislado.

### H0 — base revisada y primer kit visual

| Checkpoint propuesto                          | Familia / alcance concreto                                                                                                                                                                                                                                                                                                                                                       | Consumidores iniciales                                                                                                                                                                                          | Salida revisable y aceptación                                                                                                                                                                                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1AV · Imagen e identidad**                  | MediaCover, Avatar, EntityAvatar, PlaylistArtwork, CrateLogo/BandcampLogo; contrato de imagen inyectable si se confirma necesario. Documentar/adoptar sin reemplazar el lifecycle de CrateImage/ArtworkSurface.                                                                                                                                                                  | Listen AlbumCardParts + UserAvatar + PlaylistArtwork; comprobar consumidores Admin actuales de cada base modificada.                                                                                            | Página pequeña con artwork real/cargado/error/ausente, square/person/playlist, texto largo, badge y controles sólidos equivalentes. Fallback/responsive/auth adapter conserva srcSet/tickets/retry y geometría. **Primer checkpoint recomendado.**                           |
| **1AW · Entidad, pista y colección**          | EntityRow/Card/PrimaryAction; TrackList/MediaGrid/MediaRail y fila Listen especializada; reutilizar HairlineRow/InfoBadge/GenrePill. Incluye estados de reserva que necesitan estos consumidores, sin una nueva card universal.                                                                                                                                                  | Listen LibraryAlbumsTab + ArtistCard + AlbumTrackList/PlaylistTrackList; un consumidor Admin existente afectado por cada fuente shared cambiada.                                                                | Misma entidad en row/card y colección,12/18 de Hairline, sin row background hover, selección/activo distintos, menú y navegación separados, widths largas y0/1/muchos, umbral virtualización/drag intactos. Ring de track preservado.                                        |
| **1AX · Capas, feedback y navegación mínima** | Cerrar solo los módulos modificados por TopBarSearch, Sort, un modal y un fallback, con sus bases necesarias: capas/menú, estado de ruta/lista y navegación. Completar su ficha al cambiarlos; no exigir de entrada todas las fichas AppModal/Dialog/Sheet/Tooltip, menús, skeletons y navegación. El resto se completa con su consumidor H1/H2, sin una segunda implementación. | Listen TopBarSearch + CollectionSortDropdown + un modal de playlist con selector; fallback de ruta/lista y Shell skip. Admin: consumidores shared afectados, sin rediseñar CommandPalette ni páginas completas. | Nested select/menu/tooltip por encima del contenido, Escape y restore focus, scroll lock; filtros/unknown URL/back/forward;8px reales y controles equivalentes. Search mantiene IME/recientes/resultados/preload. Los contratos1N/1Q/1R son base, no un rediseño desde cero. |

**Puerta de H0:** los contratos necesarios para el primer recorrido están disponibles y las
fuentes que se cambian tienen ficha y consumidor, con las medidas del mockup. No exige cerrar
todas las fichas de las familias generales, ni completar93entradas como prerrequisito. Cada
checkpoint aporta avance visible en los consumidores Listen indicados, además de su escena.
Shell/Search puede avanzar con bases que ya sirven sin esperar el cierre de todo1AX; sus
dependencias son contratos concretos, no una secuencia obligatoria de limpieza de catálogo.
La página pequeña y Storybook montan la misma escena; ningún selector CSS de escena repara
el interior del componente.

### H1 — primer recorrido de escucha usable

| Checkpoint propuesto                                       | Alcance                                                                                                                                                                                                                                          | Dependencias y aceptación                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1AY · Shell y búsqueda/colección básica**                | DesktopShell, MobileShell, Sidebar, TopBar/Search, MobileBottomNav; Library artists/albums/liked y aliases. Mantener flujo de acceso existente, aplicar los fundamentos aprobados a PublicShell cuando la composición lo requiera.               | Contratos mínimos H0 + cabeceras1AU, sin esperar fichas no modificadas de1AX. Quitar chrome glass/blur/lift contradictorio, usar fade sobre contenido según referencia. Safe areas con y sin player,44px, active marker, hover/focus, escroleo/header. Library adopta Tabs/helperURL con adaptador `/collection/:section`; conserva query/hash/history/unknown. No desaparecen otros tabs. |
| **1AZ · Player, cola y rendimiento de UI**                 | Bar, Fullscreen, Extended, Queue, Seek/Volume, Quality, resume/sleep; wrappers de acciones convencionales, separación de progreso y B24. EQ disponible sigue funcionando; la ampliación glyph/chain puede entregarse en H3 si necesita contrato. | H0/H1 shell. Play esencia/aura/ring y estela/dot sincronizados bajo drag, teclado y reloj. Controles sin track/buffer/offline/remote/locked, repeat/shuffle y menus intactos. Audio/crossfade por ref y un loop; ninguna lista/page se suscribe a progress. Lazy chunks preservados y sin importar EqBands al eager.                                                                       |
| **1BA · Ruta Album y acceso/offline del primer recorrido** | Album local/global/legacy y Artist→Album/TopTracks; selección/acciones/imports/countdown; Login/Register/ServerSetup/callback con shared forms; offline mínimo hasta playback preparado y reconexión.                                            | Contratos H0 y Shell1AY + Player1AZ, ambos deH1. Prueba del recorrido real o contrato instrumentado completo: acceder→buscar/colección→álbum→play→seek→cola→guardar/descargar→offline→volver. Permisos y errores reales, auth ticket cover, no regressión en helpers o engines. QA nativa sigue registrada aparte.                                                                         |

H1 termina al poder demostrar ese recorrido con páginas reales y sus estados, no solo la escena
sin backend. Si no hay servidor/datos/dispositivo en el entorno, se entrega evidencia instrumentada
y se registra exactamente la prueba viva pendiente; no se declara validado lo que no se ejecutó.
No se publica como release ni se ocultan el resto de pantallas pendientes tras un “Listen listo”.

### H2 — cobertura de todas las rutas existentes

| Grupo/checkpoint propuesto                                             | Superficies del inventario                                                                                                            | Componentes/adopción y aceptación                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1BB · Home y colecciones**                                           | R01/R04/R08–R11: Home, Library completa, Playlist/Curated/HomePlaylist, HomeSection, Crates/editor                                    | Heroes/SectionHeader, cards/rows/rails compartidos, forms y modales, coverflow/drag/colaboradores/descarga. StatBox pasa al rol común; StatStrip solo con segunda adopción real. Lista de cada tab/variante y acción cubierta; ninguna receta paralela ni override para esconder un fallo de base.                                                              |
| **1BC · Browse, eventos y descubrimiento actual**                      | R02/R05–R06/R12–R14: Explore/genre/decade/category, Artist completo, Upcoming/show, Radio y Paths                                     | EventRow/CalendarDate, cards/rows, ficha editorial ArtistBio/Frame/Presentation, chips/filtros y acciones. Show sigue expandible; release adapta avatar/badges/fecha. Radio conserva debounce300 y start/session reales; Paths conserva creación/lista/detail. Mapa/mood/wheel/setlist ampliados quedan en H3 con precondiciones.                               |
| **1BD · Settings, social, imports y compartir**                        | R17–R22/R25: todos los ajustes, people/profile/connections, Bandcamp, Upload/Contributions, offline completa, ShareSheet y traducción | Labels/form fields uppercase y8px, valores con case original, Meter/StatusDot/Readout/StatNumber por rol; selector scalar como Select, acciones icon-only donde son claras, Solar. Mantener capability gates, siete locales, export/withdraw, colaboración, QR y canvas share esperando fuentes. StepRail se comparte solo cuando ambas apps usan fases reales. |
| **1BE · Stats, Digging, lyrics/info y demás superficies persistentes** | R15/R16/R24/R25; revisión transversal player output/targets, visualizer, InfoTab, fuente/provenance y Tauri chrome                    | Métricas/lecturas, stats/tape/heatmap y narrativa local, typography display/body/mono, live regions silenciosas. Nivo para charts estadísticos; instrumentos manuales donde corresponde. Output/Cast/Connect/visualizer/native guards conservados; no analyser ficticio. Retirada PD47 con prueba de imports y límites lazy.                                    |

Los grupos1BB–1BE deben dividirse en lotes internos de consumidores coherentes si su diff deja de
ser revisable; cada lote tiene stop para Diego y muestra pequeña completa. Son un mapa de cobertura,
no permiso para un mega-commit de decenas de páginas. No se omite una familia por haber cerrado
sus componentes base. La tabla R01–R25 del inventario permite comprobar el cierre.

### H3 — instrumentos previstos y contratos de datos

Esta capa completa el producto V3 descrito en el plan original. No se mezcla en migraciones
visuales para simular avances, ni se elimina del alcance global por priorizar un primer corte.

| Instrumento / tarea original                    | Precondición                                                                                                                     | Implementación y salida                                                                                                                                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EQ glyph/store/chain, Task4.3/4.5 y2.19         | Ganancias engine exactas; payload additive chain/genrePath cuando se necesite, parity cache/resolver; servidor antiguo soportado | Store/ref/cadencia, glyph barato eager, panel lazy, descripciones/locales, keyboard/drag; chain y walk con datos reales. Segundo consumidor Admin real para nuevas extracciones shared, o módulo local. Hold behavior4.4 no se cambia sin alcance propio. |
| Heatmap y Home DNA, Task4.6                     | Dashboard/timezone/night_hours/privacy correctos, umbral muestra pequeña de2.20 si aplica                                        | 7×24, DST/offsets, aria/roving/focus, reduced motion; Home desktop sin fetch móvil nuevo. No atribuir al StatsHeatmapCard actual todos esos contratos.                                                                                                    |
| SetlistTicket, Task4.7a/b                       | Match/in_library actual y playlist/create actions reales                                                                         | Ticket/expanded setlist; mismo contrato en Admin solo al adoptar, sin inventar disponibilidad.                                                                                                                                                            |
| MoodMap, Task4.8a/b                             | Snapshot/pools, coordenadas/análisis y capacidades válidas                                                                       | Instrumento local Explore, selección/focus/empty. Browse moods existente no prueba que el mapa ya pueda dibujarse.                                                                                                                                        |
| Paths RouteMap, Task4.9a/b y5.11                | Task de planificación, plan_meta y transiciones reales                                                                           | Map/list equivalentes, progresión/replan/failure y accesibilidad. Preservar endpoint actual mientras falta metadata.                                                                                                                                      |
| Radio Sound map, Task4.10a/b                    | Explain/bliss map, sesión ownership y payload de tracks                                                                          | Mapa/sugerencias explicables reales, selección/queue, fallback sin datos; no synthetic similarity.                                                                                                                                                        |
| Devices, Task5.9                                | Capability/build flag, dispositivo/checkpoint/presence y ConnectWS disponibles                                                   | Top-level devices y target popover; estados online/recent/offline/reconnecting sin controlar targets no soportados.                                                                                                                                       |
| Genre wheel, Task5.10                           | Runtime graph/snapshot Listen, no datos Admin-only                                                                               | Explore/genre con búsqueda/teclado y fallback, presupuesto/render gating.                                                                                                                                                                                 |
| Visualizer/static analysed state, Task4.11/4.12 | Analyser existente o campos de análisis reales por runtime                                                                       | Paleta de contenido con chrome V3, static/reduced effects sin FFT móvil; no waveform inventada ni dependencia pesada eager.                                                                                                                               |
| Mix strip/access tokens y follow-ons Smart Mix  | Integración futura explícitamente fuera de esta tarea                                                                            | Conservar pendientes5.13/5.14 y Access tokens; decidir su alcance entonces. No activar Jam ni hacer rebase por este plan.                                                                                                                                 |

### H4 — cierre de fase y vuelta a Admin

Cierre de una sola vez después de estabilizar el alcance acordado de Listen:

- Auditar R01–R25 y los componentes del censo: adoptado, excepción justificada o pendiente con
  dueño/fecha/hito. Gate Jam apagado se registra como no aplicable, no feature estrenada.
- Validación completa de fase una vez, canónicas mediante procedimiento CI documentado cuando
  corresponda, sin regenerar PNGs locales. Recorrido desktop/mobile y comparación contra mockup.
- Matriz de runtime y AT: web/PWA, Capacitor iOS/Android y Tauri Linux/macOS/Windows según el
  alcance disponible; engines/fuentes nativas, offline, resume/safe-area, output y reduced motion.
  Un typecheck Desktop no es una prueba de WebKitGTK ni de accesibilidad nativa.
- Lista de lo que falta por backend/servidor antiguo/integración futura; separar primer corte,
  Listen visual completo y release conjunta. Solo entonces acordar retorno a los lotes Admin
  específicos conservados en A5. Los checks finales de release siguen su protocolo original.

## 4. Correspondencia con el plan original

| Bloque actual | Reutiliza / adelanta trabajo ya previsto                                                                                                  | Qué no queda certificado                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1AQ–1AU y H0  | Reconciliación R1; Task1b.\*, componentes y cabeceras de4.1                                                                               | No completan shell/player, adopción de páginas ni QA de fase.                                                                                                   |
| H1 shell      | **Task4.1** Shell/MobileBottomNav, navegación y loops; parte de6.13/6.14 Search/Library                                                   | El trabajo de cabeceras1AU no había cerrado estos consumers.                                                                                                    |
| H1 player     | **Task4.2**, B24 de4.1, Lyrics/Resume/sleep de6.16                                                                                        | No integra decks Smart Mix ni certifica audio nativo.                                                                                                           |
| H1/H2 pages   | **6.12–6.16** Home, Explore, Artist/Album, colecciones, Settings/social/Bandcamp/Upload/offline/auth/share, Stats/Radar/Radio/Paths/Tauri | Un restyle no fabrica contratos backend/instrumentos de4.x/5.x.                                                                                                 |
| H3            | **4.3–4.12,5.9–5.11** y dependencias backend explícitas                                                                                   | Las tareas MAIN/BEHAVIOUR/Smart Mix no se asumen disponibles ni autorizadas por este análisis.                                                                  |
| H4            | QA fase7 y procedimiento CI/canónicas vigente                                                                                             | No se repite full VISUAL/test por cada checkpoint por una instrucción histórica. Diego exige ahora pruebas focalizadas seriales y cierre completo una sola vez. |

El nuevo orden prioriza trabajo de Listen; no borra pruebas o datos necesarios ni aplica notas
históricas contradichas por decisiones posteriores. Los componentes pendientes del roadmap general
quedan redistribuidos aquí por necesidad real de Listen; los específicos de Admin se retoman después.

## 5. Protocolo de cada checkpoint

### Antes de editar

1. Registrar base publicada, estado de trabajo y familia/callers. Leer los AGENTS scoped vigentes.
   El worktree dedicado sigue siendo el único destino; el agente MCP de Crate trabaja separado.
2. Comparar componente real y caller con el mockup aprobado y las decisiones posteriores.
   Identificar contrato ya aprobado, override repetido, excepción legítima o decisión visual
   pendiente. Medir familia/tamaño/line-height/box, no inferir Poppins/Bricolage por su aspecto.
3. Si el catálogo está pendiente, completar primero su contrato/escena en inglés. Elegir categoría
   funcional Forms/Feedback/Data Display/Navigation/Layout/Media, stable story id y coverage/adoption.
   No refrescar hashes pendientes como sustituto de documentar el componente.
4. Acordar cualquier conflicto real de diseño/mobile con Diego antes de elegir una variante nueva.
   No hace falta pedir de nuevo permiso por cada ajuste ya definido en la referencia.

### Implementación y revisión visual

- Componente posee tipografía, insets, estados y geometría; app inyecta datos/callbacks/contexto.
  Scene aporta solo layout/contexto. Label de muestra con `FormField kind="group"`,8px reales;
  equivalentes montan el mismo size/variant. Compatibilidad/tamaños intencionados se muestran aparte.
- Una escena real compartida por la pequeña review en5186 y Storybook6006. No añade secciones al
  mockup grande. Incluir familia completa, datos extremos, errores/ausencias y estados interactivos.
- Retirar copias/overrides que cubre el cambio. Registrar residuo explícito cuando no está en el
  lote; no subir límites de drift por comodidad ni resolver un portal por z-index arbitrario.
- Actualizar ficha, contrato/stories, tests, estado/handover y evidencia en el mismo cambio.
  Las stories aisladas de componentes y el patrón compuesto cumplen funciones diferentes.
- Ambos previews permanecen activos. Stop para revisión de Diego **antes de commit/push** de cada
  checkpoint nuevo; no interpretar “adelante con inventario” como aprobación visual/publicación.

### Verificación focalizada

| Cambio                | Comprobación necesaria                                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base shared           | Vitest del contrato y de los consumidores afectados Listen/Admin; `--maxWorkers=1`. Semántica/refs/callbacks y datos ausentes/0/long text, no solo snapshots de clases.                                         |
| Page/composite Listen | Tests de presentación/controller/model afectados y ruta/acciones reales. 7catálogos/metadata si cambia copy; nombres accesibles y plural/locale también son copy.                                               |
| Geometría y capas     | Playwright `--workers=1`, ambas vistas pequeñas,390/768/1440 según contrato, fine/coarse,8px reales, equivalencia de control, computed fonts/overflow y layering/focus. Probar también un caller real afectado. |
| Playback              | Seek drag/clock y beam/dot; play/ring/buffer; render counts y rAF compartido, no storage/fetch/frame; lazy boundaries y efectos reducidos. No asumir analyser.                                                  |
| Platform              | Typecheck Listen/Desktop y pruebas Desktop afectadas; tests runtime flags/stubs/safe session/artwork si cambian. Prueba de dispositivo real queda separada si no disponible.                                    |
| Governance            | Lint/tipos del alcance; `design-system:showcase:check` y refresh por IDs documentados que cambian, policy tests relevantes, links y estado. No convertir todo pending a documented en bloque.                   |
| Builds/bundle         | Build Listen y check bundle cuando cambia runtime; Admin build/gate si cambio shared afecta su runtime; herramientas si cambia escena/tooling. Evitar repetir una build verde si solo cambian notas.            |

La política de validación de Diego prevalece sobre listas históricas de suites completas por tarea.
No disparar CI completa ni actualizar33PNG/manifest1M en la iteración. Las pruebas nuevas deben
cubrir el defecto/contrato, incluida una regresión del consumidor cuando un helper ocultaba el fallo.
No se usa otro navegador/surface para eludir el rechazo previo de protocolo localhost manual;
la comprobación automática focalizada y los límites de evidencia se registran con precisión.

## 6. Presupuestos y riesgos que condicionan el orden

- Última cifra registrada: Listen **200109/307200 B gzip**, margen **107091 B**. No es permiso para
  cargar visualizers/EQ/maps en el chunk inicial. Mantener subpath imports y route/player lazy.
- Admin **527180/532480 B**, margen **5300 B**. Un shared export pesado puede romper Admin aunque
  sus páginas estén aplazadas. No importar charts al barrel de una primitiva; nada de nuevas
  dependencias runtime para Storybook.
- Imagen y audio autenticados son el mayor riesgo de una extracción ingenua: preservar adapters,
  tickets/ready/retry y engines. El primer grupo prueba ese límite antes de migrar tarjetas masivas.
- Un kit interminable también retrasa Listen: tras H0 se construye una ruta real, sin esperar los
  instrumentos futuros o toda la adopción Admin. Un corte usable tampoco excusa dejar sin lista
  de deuda las rutas menos frecuentes.
- Native/PWA no son un modo CSS: preferencias de fuentes, safe areas, sesiones/servidores,
  storage, sin analyser, salida y reanudación requieren pruebas de su contrato. No prometer
  igualdad de fuentes web en Capacitor cuando la excepción nativa sigue vigente.

## 7. Próximo paso concreto y criterio de autorización

Revisar1AU. Una vez aprobado y publicado por instrucción de Diego, abrir **1AV Imagen e identidad**
con los seis módulos existentes, sus entradas Storybook y los tres primeros consumidores Listen
indicados. No añadir todavía otro hero ni un EntityCard nuevo. Si durante ese grupo se detecta
un conflicto de tamaño mobile o de contrato de imagen, enseñar el caso concreto y resolverlo con
Diego. Parar1AV con ambos previews activos antes de commit.

La aceptación del inventario/orden no aprueba automáticamente los cambios visuales futuros.
La implementación no empieza por este documento ni por terminar este análisis.

## Aprobación de Diego — 2026-10-19

Diego aprueba 1AU y este plan, autoriza commit/push y continuar con 1AV Imagen e identidad,
con referencia en el mockup, Storybook actualizado y ambos previews activos. 1AV se detiene
para revisión antes de commit. Solicita además una instancia viva de Listen, conectada a su
API habitual `https://api.lespedants.org`; no autoriza mutaciones de datos por el agente.

## 1AW — Entidades, pistas y colecciones · revisión local · 2026-10-19

1AV aprobado y publicado en `a2b374f3`. 1AW sigue **sin commit/push**, detenido para revisión de
Diego. Vista pequeña: http://127.0.0.1:5186/review-1aw-collections.html; misma escena en Storybook
`Reviews/1AW/Collections`. Listen sigue en http://127.0.0.1:5174 con la API habitual autorizada.

Se completan las seis fichas existentes EntityCard, EntityRow, EntityPrimaryAction, TrackList,
MediaGrid y MediaRail. Selección y reproducción actual se separan; ARIA/ref nativos, texto largo,
perfiles de artista y metadatos quedan en sus componentes. ArtistCard retira sus mapas locales de
anchura; AlbumTrackList usa TrackList conservando discos/IDs/selección; PlaylistTrackList conserva
IDs de entrada y virtualizador; LibraryAlbumsTab distingue error inicial de colección vacía.

Enmiendas de Diego: glyph blanco de18px dentro de un slot visual de24px sobre la portada, sin disco azul; control activo de40px
con ring2px, aura, efectos y suscripción de progreso solo en la hoja activa. Todas las miniportadas
independientes de pista/álbum/artista tienen mínimo48px, también compactas. MediaCover posee el
mínimo y la receta shared `crate-media-thumbnail` lo aplica a marcos managed/raw heredados de
ambas apps hasta su adopción por fase. Avatares de personas, marcas y celdas internas de collage
son roles separados. Se mantienen HairlineRow12/18 y título de entidad14/500; ningún hover rellena
el fondo de las filas revisadas.

Incidencia corregida durante la iteración: envolver TrackCoverThumb en un marco de altura auto
hizo desaparecer sus imágenes. Se retiró ese wrapper; ArtworkSurface/CrateImage conservan su
renderer y recuperación anteriores. La nueva prueba de navegador monta el renderer real con
una imagen local, verifica decode/pintado48x48 en ambas densidades y el WindowVirtualList real
con80entradas y scroll hasta la última. No necesita sesión ni escribe en producción.

La revisión independiente encontró tres mínimos pendientes (CrateAlbumPicker, ArtistRow y tooltip
HTML de ArtistNetworkGraph) y una story Callback que heredaba href. Se corrigen con regresiones
RED→GREEN. La guarda inspecciona marcos JSX y el tooltip HTML conocido; no sustituye QA visual.
Catálogo:45documentadas/93entradas/120fuentes;48pendientes. Las fichas y la adopción siguen siendo
estados distintos.

Decisiones conservadoras: mantener los roles14/500 y12/18 ya aprobados (otro tamaño requiere
revisión medida); no inventar imports Admin para bases existentes sin consumidor directo (la
adopción real de Admin queda pendiente); conservar la semántica y el teclado nativos de filas,
sin introducir un nuevo modelo grid (AT y runtime nativo siguen pendientes). No se reescribe
el renderer, la autenticación, el motor, el drag ni la virtualización.

Las validaciones focalizadas y sus límites finales se consolidan en el estado vigente. Sin suites
completas/CI, sin regenerar33PNG/manifest1M, sin PR/merge/rebase/deploy/release. Las tres instancias
permanecen activas; conservar los checkpoints y el pin histórico app/web@258bbaee.

## Estado posterior de H0 — 1AX local para revisión

1AV/1AW aprobados y publicados;1AW=`5ff7296c`.1AX implementa el kit mínimo en sus consumidores
reales, completa siete fichas (incluida Tabs pendiente desde1Q) y corrige el recorte PageHero
reportado por Diego. [Plan1AX](2026-10-19-crate-v3-layers-feedback-navigation.md) y
[validación vigente](2026-10-19-crate-v3-current-state.md). La aprobación visual de1AX aún no está
concedida; sin commit/push local ni avance a1AY. H0 no certifica Listen completo ni QA de fase.

## Estado posterior — 1AY local para revisión

1AX aprobado y publicado en5bc683d8. 1AY reconcilia Shell, búsqueda y colección con la referencia
aprobada y sus enmiendas: fondo desktop de artista100px más abajo con degradado original,
contadores en tabs, Select estable y subrayado con viaje/rebote. Views reales en la escena pequeña
5186/Storybook, sin ampliar el mockup histórico. [Alcance y decisiones](2026-10-19-crate-v3-shell-search-collection.md)
y [validación vigente](2026-10-19-crate-v3-current-state.md). Se detiene antes de commit/push;
1AZ queda pendiente de aprobación. Se conservan las tres instancias y los límites nativos/AT/1M.

## Estado posterior — 1AZ local para revisión

1AY aprobado y publicado en81665c5c.1AZ reconcilia Bar/Fullscreen/Extended/Queue y las hojas de
seek/volume/lyrics con B24 por refs y un reloj de crossfade. Conserva motores, autoridad, CD/jog,
play/aura/ring y la estela/dot. [Plan y decisiones](2026-10-19-crate-v3-player.md),
[validación y límites](2026-10-19-crate-v3-current-state.md). Storybook y preview pequeño usan
las mismas piezas reales; Listen autenticado sigue activo. Detención antes de commit/push y de1BA.

## 2026-10-19 — 1AZ aprobado; publicación autorizada

Diego aprueba1AZ y autoriza commit/push del reproductor validado. El siguiente alcance es1BA,
Álbum, acceso y primer recorrido offline, con mockup como referencia, Storybook actualizado y
las tres instancias activas. Parar en1BA antes de commit/push para revisión; sin PR, merge o deploy.

## 2026-10-19 — 1AZ publicado;1BA local para revisión

1AZ aprobado/publicado18a880c2.1BA aplica el alcance H1 de Álbum, acceso y primer recorrido
offline; conserva native/auth/engine/route contracts, usa shared forms/headers/rows/actions y
actualiza Storybook con las piezas reales. [Plan y límites](2026-10-19-crate-v3-album-access.md),
[estado vigente](2026-10-19-crate-v3-current-state.md). Revisión pequeña review-1ba-album-access.html,
Storybook Reviews/1BA/Album and access; tres servicios activos. Stop1BA sin commit/push para Diego.
No certifica dispositivos nativos, AT, escrituras reales ni cierra toda la migración de Listen.

## 2026-10-19 — 1BA aprobado; publicación autorizada

Diego aprueba1BA con sus enmiendas y autoriza commit/push. Continuar con1BB, Home y colecciones,
usando el mockup y las correcciones confirmadas como referencia, actualizando Storybook y
manteniendo5186/6006/5174 activos. Detener1BB para revisión antes de su commit/push.

## 1BA publicado;1BB primer lote local

1BA aprobado/publicado43e34284. Se aplica la regla H2 de lotes revisables: primer lote1BB
Home y listas de Library (cabeceras, acciones, métricas, contribuciones y estados de lectura).
Detalles/editores de Playlist/Curated/HomePlaylist/HomeSection/Crate, coverflow y colaboradores
continúan en el próximo lote1BB; no están cerrados. [Plan y matriz de alcance](2026-10-19-crate-v3-home-library.md).
Enmienda de Diego: métricas contextuales (plays, albums/tracks, duración, match) usan MonoLabel
con mayúsculas del componente; identidad y prosa conservan su escritura. Stop1BB sin commit.

## 1BB primer lote publicado; detalles y editores en revisión

Primer lote aprobado/publicado `0f8cf24f`. El segundo lote aplica
[el plan de detalles y editores](2026-10-20-crate-v3-collection-details.md): presentación común
Playlist/Curated/HomePlaylist, estados de lectura de HomeSection, detalle público/autenticado de
Crate, formularios y diálogos de creación/edición/colaboración. El inventario y la matriz de
adopción se documentan en el README de Storybook; la revisión pequeña es
`review-1bb-collection-details.html` / `reviews-1bb-collection-details--complete`.
La enmienda posterior de Diego restaura hover en filas de álbumes de crate y en listados de
playlists; las demás filas mantienen su contrato. V2 coverflow, imágenes, controladores y API
conservados. Segundo lote sin commit/push hasta revisión;5186/6006/5174 siguen activos.

## 1BB segundo lote aprobado — publicación autorizada

Diego aprueba detalles/editores/colaboración y la enmienda CatalogSearch con artwork real.
Autoriza commit/push y continuar con el siguiente grupo. El segundo lote incluye la búsqueda
de dominio reutilizada en playlists/crates y la conservación de portadas en resultados,
selección, reapertura y collage. La evidencia focalizada queda en el README de Storybook y
el plan de detalles. Próximo checkpoint:1BC, dividido en lotes revisables según H2; primer
lote Explore y browse de género/década/categoría. Storybook y las tres instancias continúan;
parar cada lote nuevo para revisión antes de commit.

## 1BB publicado;1BC Explore/browse local para revisión

Segundo1BB aprobado/publicado `728af01c`, incluyendo detalles/editores/colaboración y búsqueda
CatalogSearch con portadas preservadas. Primer lote1BC cubre R02 Explore, género, década y
categoría: superficies sólidas, roles tipográficos, controles canónicos y navegación/lectura.
[Plan y límites](2026-10-20-crate-v3-explore-browse.md). Storybook y la revisión pequeña
`review-1bc-explore.html` usan las vistas reales; tres instancias activas. Se detiene sin commit
para Diego. Artist, eventos, Radio y Paths siguen en los próximos lotes1BC; no se certifica H2.

## 1BC Explore/browse y menús aprobados — publicación autorizada

Diego aprueba el primer lote1BC y la corrección de menús contextuales de Chrome. Autoriza
commit/push y continuar con el siguiente corte: páginas de artista. Se conserva la evidencia
de los tests focalizados y de ambos hosts en Storybook. Eventos, Radio y Paths siguen después.
Cada corte nuevo se detiene para revisión sin commit; las tres instancias permanecen activas.

## 1BC Explore publicado; Artist y estándar de acciones secundarias en revisión

Primer corte1BC publicado `a89bac48`: Explore/browse y corrección de menús Chrome. El segundo
corte cubre Artist según [su plan](2026-10-20-crate-v3-artist.md): hero y estados de lectura,
biografía editorial, agrupación de secciones, preparación de show y modal de setlist. Conserva
imágenes V2, fondo100px más abajo y degradado original. Cuatro familias compartidas Artist ya
tienen entradas Storybook; los controladores y vistas de un solo dominio siguen en Listen.

Diego confirma MonoLabel para TODO texto debajo de glifos de acciones secundarias. HeroActionBar
y los añadidos Artist/Album/Crate/Bandcamp lo aplican, cubriendo también playlists y géneros.
Play/Shuffle y Button convencionales mantienen sus roles. Inventario y contratos en Storybook;
review pequeña `review-1bc-artist.html` y `reviews-1bc-artist--complete`. Este segundo corte se
detiene sin commit; tres instancias activas. Eventos/Upcoming, Radio y Paths siguen pendientes
en próximos cortes1BC; H2 no queda certificado por este lote.

## 1BC Artist aprobado — publicación autorizada

Diego aprueba el segundo corte1BC y autoriza commit/push de Artist y del estándar de acciones
secundarias validado. Continuar con Upcoming y shows, usando la referencia aprobada y sus
enmiendas, actualizando Storybook y manteniendo5186/6006/5174 activos. El nuevo corte se
detiene para revisión antes de commit/push; Radio y Paths permanecen pendientes.

## 1BC Artist publicado; Upcoming y shows local para revisión

Artist publicado en `5f511815`. El tercer corte aplica
[el plan de Upcoming y shows](2026-10-20-crate-v3-upcoming-shows.md): vistas reales de Radar,
lectura personal/género, filtros canónicos, orden cronológico, marco/fecha/imagen común de
show y release y acciones del ticket. Se conserva la composición expandida aprobada.

La incidencia de Fontaines D.C. venía del payload de Radar con nombres sin porcentajes; el
ticket abierto recupera el perfil real con la lectura existente y caché, sin consultas de
perfiles en filas cerradas. Se verifican100/88/76 en Listen conectado a producción.
La revisión final detectó y corrigió autoridad404 con caché y refresco de asistencia: los
tests de integración usan el hook y la página reales, con transporte local simulado.

Storybook y `review-1bc-upcoming-shows.html` comparten las vistas de producción. Validación
focalizada final86tests Listen/17archivos,52Desktop,31i18n,25políticas y4checks de navegador
en375/1200px y ambos hosts. Tipado, lint, tres builds, bundle y catálogo correctos. Las tres
instancias siguen activas; tercer corte sin commit/push hasta revisión. Radio/Paths y nuevos
instrumentos siguen pendientes; este lote no certifica toda H2 ni plataformas nativas.

## Upcoming publicado; Radio y Paths en revisión local

Upcoming/shows y la enmienda de hover/timing se publicaron en668a9a8a. El siguiente corte1BC
aplica [el diseño visual de Radio y Paths](2026-10-20-crate-v3-radio-paths-design.md), con vistas
reales en Storybook y `review-1bc-radio-paths.html`. Diego aclara que busca presentación visual;
se conserva el flujo funcional actual. Su elección final es el coverflow original, que avanza
con cambios de tema; se retira el experimento de cámara espacial. Los instrumentos/mapasH3
siguen pendientes. Las tres instancias permanecen activas; este corte se detiene antes de commit.

## Radio y Paths aprobado — publicación autorizada; siguiente corte1BD

Diego aprueba Radio y Paths con el coverflow que solo avanza al cambiar de pista y autoriza
commit/push. El siguiente lote será1BD Ajustes de Listen: composición/navegación actual de
Settings, cuenta, interfaz, reproducción y conexiones. Mantener los controladores, permisos,
capability gates y acciones existentes; normalizar con componentes reales y revisión aislada
en5186/Storybook. Social, imports y compartir continúan en los siguientes lotes1BD. Las tres
instancias siguen activas y el nuevo corte se detiene para revisión antes de commit.

## Radio y Paths publicado; primer corte1BD Ajustes en revisión local

Radio/Paths publicado en `0e3640e7`. El primer corte1BD aplica [el plan de Ajustes](2026-10-20-crate-v3-settings.md):
preferencias/interfaz/idioma/reproducción, perfil y cuentas vinculadas, zona horaria y dispositivos
Connect tras Playback. Select/FormField reales, confirmaciones y autoridad nativa/API conservadas.
Diego añade MonoLabel tone=accent para títulos de sección y la cuadrícula responsive de Motion,
Effects y Content density. Sus dos fichas shared se actualizan; los labels de campo siguen sutiles
y los valores/prosa conservan su caso. Las explicaciones de Select se leen antes de seleccionar.

La revisión pequeña `review-1bd-settings.html` y `reviews-1bd-settings--complete` comparten vistas
reales con callbacks locales. Bandcamp, scrobbling, credenciales externas, ubicación/offline y
los flujos de servidores, social/imports/share siguen en otros lotes1BD; no se certifica H2 ni
los instrumentos H3. Tres instancias activas; primer corte1BD sin commit hasta revisión de Diego.

### Enmienda aprobada1BD — navegación por cinco pestañas

Diego aprueba Preferences, Playback, Account, Connections y Offline para este mismo corte.
Se reutilizan Tabs, `?tab=` y vistas reales; formularios/peticiones conservan su montaje al cambiar
mediante paneles ocultos. La barra móvil usa scroll horizontal y revela la selección. Connect pasa
a Connections y el temporizador a Playback; perfil/enlaces a Account, ubicación a Preferences.
La misma estructura se revisa en Storybook y preview aislado. La extracción OfflineSettingsView
solo separa presentación y callbacks locales de la autoridad de cuota/almacenamiento. Integraciones
pendientes mantienen sus flujos; sigue sin commit hasta revisión de Diego.

### Account aceptado; bloqueo explícito de commit

Account separa Profile/Listening preferences/Connected accounts/Security, Email primero en Input
readonly y campos responsive. Los proveedores usan logos existentes, EntityRow compacto, StatusDot
y acciones ghost próximas; APIs, IDs y autoridad OAuth no cambian. Diego acepta el aspecto y pide
no hacer commit/push hasta nueva instrucción. Claude trabajará Paths y retirará el coverflow: este
corte no debe modificar ni incluir ese trabajo. Las tres instancias siguen activas.

### Commit conjunto autorizado —1BD Settings y transición de Paths

Diego confirma que Claude ha terminado Paths y autoriza el commit de todo el lote. Incluye
Settings con cinco pestañas, Account normalizado y timezone automático fuera de ajustes, más
la transición pixelate-blur de portadas que sustituye el coverflow. Storybook/preview usan las
vistas reales y la documentación de Paths refleja la decisión posterior. El bloqueo previo
de commit queda revocado para este lote. No se ha solicitado despliegue ni nueva migración.

### Settings restantes publicado;1BD Comunidad en revisión

Diego aprobó y autorizó la publicación de Settings restantes (incluida la retirada de Quick
links). Publicado en `b78077aa`, junto con el commit previo pendiente `5337b239`.
El siguiente corte anunciado antes de comenzar es [1BD Comunidad](2026-10-20-crate-v3-community.md):
People/búsqueda, perfiles públicos, seguidores/seguidos y tarjetas de perfil. Vistas reales de
Listen con fundamentos existentes, callbacks y medios gestionados en adaptadores; Storybook en
inglés y `review-1bd-community.html` reutilizan la misma escena aislada. Fallos de lectura no se
presentan como vacíos/cero; nombres/bios conservan case y metadatos usan MonoLabel. Seguimiento,
perfiles propios, colecciones públicas y privacidad conservan la autoridad actual.

En revisión local, sin nuevo commit:75 tests Listen,52 Desktop,23 shared y4 casos browser en
ambos hosts a375/1200px; tipos de los tres consumidores, lint, i18n, builds y catálogo verdes.
Revisión fresca y correcciones comprobadas completas. Tres instancias activas. Imports/share y
los demás lotes1BD siguen después; no se certifica H2/H3 ni se ejecuta CI completa en este corte.

Enmiendas de revisión de Comunidad: métricas sociales/escucha comparten grid2/3columnas;
afinidad pasa al extremo derecho de PageHeader y al siguiente tier StatNumber(md). Los enlaces
compartidos pierden beams y mantienen foco visible. StatNumber cambia su caption a accent al
hover/foco de un enlace; lecturas sin enlace conservan gris. Contratos y ejemplos reales de
Foundations/StatNumber actualizados con sus fingerprints. Verificación scoped:53shared,
7Profile,4Admin y7browser verdes, tipos/lint/builds/catálogo correctos. Tres instancias activas;
todo este corte sigue sin commit hasta aprobación de Diego.

Diego aprueba los dos patrones de acciones de1BD: VIEW ALL en MonoLabel accent con un dot
decorativo y glow en vez de flecha; opciones de ContextMenu en MonoLabel mayúscula. La misma
SectionActionLabel compone secciones, perfiles y pie de búsqueda; copia única/localizada,
estados y navegación conservados. Storybook y preview aislado `review-1bd-action-labels.html`
actualizados con fuentes reales; regla registrada en shared/AGENTS.94Listen,92shared,7Admin,
52Desktop y12browser verdes; tipos, lint, i18n, builds/catálogo correctos. Se mantienen las tres
instancias. Esta aprobación visual no autoriza un nuevo commit; Comunidad sigue sin publicar.


Última enmienda local1BD: enlaces MonoLabel y opciones de ContextMenu pasan a accent al hover/
foco, sin fondo. SectionActionButton comparte VIEW ALL, Show more y More/Less con dot y sin
sangría; conserva44px y callbacks. PlayerBar mantiene Playing from en MonoLabel y ahora guarda/
restaura su origen junto a la cola, sin autoplay. Storybook, preview aislado de acciones y vista
de artista actualizados.72Listen,101shared,10Admin,52Desktop y12browser relevantes verdes;
tipos, lint, builds y catálogo correctos. Tres servicios activos; sigue pendiente de revisión,
sin commit/push. Evidencia y límites en el plan de Comunidad.


### Comunidad publicada;1BD Compartir e importaciones en revisión local

Comunidad y sus enmiendas de acciones/biografía publicadas en `028da356`, origin/feat/crate_v3.
Siguiente corte anunciado: [Compartir e importaciones](2026-10-20-crate-v3-sharing-imports.md).
ShareSheet, Bandcamp, Upload y RemoteImport componen vistas reales con fundamentos compartidos;
Contributions reutiliza su fila y confirmación. Se conservan autoridad nativa/API, protocolos
de upload, permisos/FLAC, progreso confirmado, cancelación/idempotencia/SSE y export/withdraw.

Diego detecta que el antiguo dropzone era cosmético y pide conservar una composición cuidada:
Upload vuelve a ser un destino de drop visible, centrado, con logo Crate y botón compartido
para elegir archivos; ya procesa drops, sin enviar hasta Import. El selector nativo queda
oculto tras ese botón accesible. Texto/drops vacíos conservan la selección y durante una
subida no se sustituye. No se convierte /upload en modal. Storybook en inglés y pequeño
preview5186 comparten la escena de cinco pestañas; sin ampliar el mockup histórico.
Este corte se detiene para revisión antes de un nuevo commit/push. Offline completa y1BE
siguen después; no se certifican H2/H3 globales ni la QA nativa/canónica de la fase.

Verificación del corte Compartir/importaciones:124Listen,78shared,18Admin,54Desktop y8browser
relevantes verdes; workflow estático Desktop1verde. Cinco typechecks, lint modificado, i18n,
catálogo y tres builds/bundle correctos; avisos existentes de chunks grandes conservados.
Revisión fresca:1hallazgo importante, Windows Tauri interceptaba drops HTML; resuelto en una
pasada con flags de host y regresión2RED→GREEN. No QA nativa real ni mutaciones en producción.
Diego retira toda la sección What happens next por técnica; logo/dropzone y picker centrados
en ambas vistas reales. HEAD/origin028da356, índice vacío, tres servicios activos; listo para
revisión sin commit/push. Evidencia completa y límites en el plan de este corte.

Enmiendas de revisión de Bandcamp y Contributions: los tiles reutilizan el EntityCard de álbum,
con menú sobre la esquina superior izquierda de la portada y título/artista sin acciones que
compriman su ancho. Contributions abre el álbum disponible y usa su AlbumCardMenu real y
perezoso; conserva exportación y confirmación de retirada. Sin álbum local no ofrece enlaces
ni reproducción rotos. Bandcamp sale del submenú y de las pestañas de Collection: queda una
sola vista `/bandcamp`, con redirección de enlaces antiguos y acceso existente desde Settings.
Su futura ubicación principal sigue pendiente de decisión.

Storybook y preview pequeño comparten las vistas reales y acciones locales. Verificación final
de estas enmiendas: 62 tests Listen, 54 Desktop y 11 casos de navegador verdes; tipos de
Listen, Desktop y Storybook, lint de los 34 archivos Listen modificados, catálogo y tres builds
correctos. Bundle inicial 203133 bytes gzip, dentro del presupuesto de 307200. Inspección real
de Contributions y su menú sin ejecutar acciones en producción; captura guardada en
`.artifacts/review/1bd-contributions-navigation.png`. Tres servicios activos; HEAD/origin
`028da356`, índice vacío. Se mantiene la parada para revisión antes de commit/push.

Nueva enmienda de Diego: Contributions pasa a MediaGrid/EntityCard con la misma densidad y
composición que Albums. Reutiliza modelo, artwork gestionado, reproducción, guardado y menú de
AlbumCard; Export/Remove contribution son opciones específicas, con confirmación explícita.
Los álbumes aún no disponibles permiten retirar la aportación sin navegación/reproducción rotas.
Storybook y preview pequeño comparten LibraryContributionCard y el builder real de acciones.
Se retiran los IDs de tarea de los avisos de retirada y de la confirmación visible de Upload;
mensajes amigables en los siete idiomas, con nombre del álbum o recuento de archivos y sin
afirmar que el trabajo ya ha terminado. 101 tests Listen, 54 Desktop y 4 casos browser verdes;
tipos, lint, locales, catálogo y builds correctos. Captura `1bd-contributions-grid.png`.
Las tres instancias siguen activas; se mantiene la parada sin commit/push.

Último ajuste visual de Contributions: el origen deja de ser InfoBadge y pasa a MonoLabel
mayúscula, Upload en gris e icono Solar de12px y Bandcamp en accent con marca de12px, ambos
decorativos. La vista real y Storybook usan el mismo componente.17 tests Listen,54 Desktop,
tipos/lint/catálogo y los cuatro casos browser relevantes verdes (un fallo previo aislado de
la escena de compartir pasó en su repetición focalizada, sin cambios de producto). Previews
activos; sigue sin commit/push. Captura:1bd-contribution-source-labels.png.

Diego aprueba Compartir/importaciones y todas sus enmiendas (Contributions en grid y MonoLabel
de origen) y autoriza commit/push. Siguiente lote anunciado:1BD Offline, biblioteca sin conexión,
gestión de descargas/almacenamiento y estados de disponibilidad. Se conservan los protocolos y
gates de plataforma, Storybook/preview pequeño con vistas reales y parada antes del nuevo commit.

Compartir/importaciones publicado en515bbb3b. Siguiente corte1BD Offline en revisión local:
OfflineLibraryView conserva pistas verificadas y hojas de reloj, añade duración/calidad propias
de pista a TrackRowContent y mantiene fallback48px sin fuentes de portada local inventadas.
OfflineSection conserva cuota/almacenamiento y callbacks; OfflineDownloadsView presenta estados,
recuentos y tamaño total del manifiesto con primitivas reales, sin progreso ficticio de bytes
ni cancel/retry individuales que el contexto no expone. MonoLabel técnico, identidad con case
original y gates readOnly/unsupported/busy/empty. Storybook en inglés y review-1bd-offline.html
usan las mismas vistas reales. La incrustación/extracción de portada y QA nativa siguen aparte.
Este nuevo corte se detiene sin commit hasta revisión de Diego; tres instancias activas.

Validación final de Offline:81tests Listen/12archivos,54Desktop/9 y4casos browser en ambos
hosts a375/1200px verdes; tipos, lint, siete catálogos y tres builds correctos. Bundle inicial
203156/307200bytes gzip, avisos existentes de chunks grandes conservados. Una revisión fresca
halló que el cero provisional de tamaño podía mostrarse como0B: se elevó a importante por
confundir dato desconocido con confirmado y se resolvió en una pasada2RED→GREEN, manteniendo
el cero verdadero de un manifiesto recibido. Sin hallazgos diferidos ni segunda revisión.
Captura1bd-offline-review.png; tres servicios activos, HEAD/origin515bbb3b e índice vacío.
Se detiene para revisión de Diego sin commit/push del nuevo corte. Sin QA nativa real ni
cambios de caché/extracción de portada o mutaciones en producción.

Diego amplía1BD Offline: incluir las portadas en la descarga y mostrarlas sin conexión. Se añaden
sidecars640px por álbum y portada de manifiesto, compartidos por pista y aislados por perfil.
Web conserva imágenes en su Cache Storage; Capacitor/Tauri reutilizan la descarga nativa staged,
verificación, exclusión de backup y cancelación. Los originales no se reescriben. CrateImage
prefiere una lease local (sin srcset remoto), los tracks mantienen ruta canónica al persistir y
las vistas reales de biblioteca/Settings comparten MediaCover48px. Descargas antiguas completan
portadas en sync online; ausencia de imagen no invalida audio. Clear/retirada elimina imágenes
sin referencias. Storybook y preview actualizados; prueba con recarga y red totalmente cortada.

Enmienda de alineación: Storage no rompe su valor en dos líneas; se corrige la receta compartida
Meter (columna de lectura max-content, mínima5ch) y se completa su entrada, docs y casos en el
catálogo. Dos consumidores reales conservados: Listen Offline/Stats y Admin SystemHealth. Sin
reparaciones CSS en callers ni cambios en el mockup histórico. Sigue sin commit para revisión.


Cierre local de las enmiendas1BD Offline/Bandcamp: la revisión fresca de portadas detectó cuatro
hallazgos importantes, resueltos en una única pasada TDD: rutas relativas en webviews nativas,
decodificación previa/evicción de imágenes corruptas, invalidación por perfil/asset y Meter a704px
con traducción larga. Meter apila su caption bajo20rem de ancho disponible; lectura de una línea
y rail visible, sin parches en callers. No segunda revisión ni certificación de dispositivos.

Diego intercambia protagonismo/formato en Bandcamp: Purchases primero y en región mayor con
MediaGrid/EntityCard; Radar en filas EntityRow con Open on Bandcamp y permisos/acciones reales.
La aclaración posterior conserva las acciones: no son filas inertes. Wishlist mantiene su grid.
Storybook y preview pequeño comparten las vistas reales y fixtures coherentes con permisos.

Validación relevante final:183Listen,54Desktop,31shared,11Admin y13casos browser distintos verdes;
cinco typechecks, lint33archivosListen, i18n0/0, catálogo59/93/120 y tres builds/bundle correctos.
JSinicial205131/307200bytes gzip, avisos existentes de chunks grandes. Capturas finales:
1bd-offline-artwork-alignment-final.png y1bd-bandcamp-purchases-radar.png. Se mantienen las tres
instancias; HEAD/origin515bbb3b, índice vacío. Parada para revisión sin commit/push. QA física de
iOS/Android/Tauri sigue explícitamente pendiente; no mutaciones ni importaciones en producción.


Enmienda final Settings1BD: Section expone `ruled`, ya existente en InstrumentPanel. La primera
sección visible de cada pestaña recibe false y las líneas internas se conservan; Connections
respeta el gate de Connect y empieza en OpenSubsonic sin línea cuando no está habilitado.
Sin nuevo fundamento ni CSS de reparación. Storybook y preview reutilizan esas props.
Regresión7RED→31GREEN; navegador4/4verde en ambos hosts375/1200, cinco pestañas y ambos estados
del gate Connect. Captura real1bd-settings-leading-rule.png; sin commit/push, tres servicios.

Verificación final de la regla Settings:119tests Listen/19archivos y54Desktop/9 verdes; tipos
Listen/Desktop/Storybook, lint17archivos, catálogo y tres builds/bundle correctos. Inspección real
confirma border0px en Offline y portada local visible. HEAD/origin515bbb3b, índice vacío.


Diego aprueba el cierre1BD Offline y sus enmiendas (portadas, Bandcamp y regla opcional de
Settings) y autoriza commit/push. Siguiente lote anunciado antes de empezar:1BE Stats y Crate
Digging, composición de métricas/listas/lecturas/estados y narrativa editorial con vistas reales.
Se conservan periodos, alcance propio/global/usuario, privacidad, datos horarios y acciones.
Lyrics/Info/output/targets/Tauri quedan para siguientes lotes internos1BE; sin nuevos instrumentos
H3 ni cambios de protocolo. Storybook y preview pequeño, tres servicios activos y parada para
revisión antes del próximo commit.
