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

| Checkpoint propuesto | Familia / alcance concreto | Consumidores iniciales | Salida revisable y aceptación |
| --- | --- | --- | --- |
| **1AV · Imagen e identidad** | MediaCover, Avatar, EntityAvatar, PlaylistArtwork, CrateLogo/BandcampLogo; contrato de imagen inyectable si se confirma necesario. Documentar/adoptar sin reemplazar el lifecycle de CrateImage/ArtworkSurface. | Listen AlbumCardParts + UserAvatar + PlaylistArtwork; comprobar consumidores Admin actuales de cada base modificada. | Página pequeña con artwork real/cargado/error/ausente, square/person/playlist, texto largo, badge y controles sólidos equivalentes. Fallback/responsive/auth adapter conserva srcSet/tickets/retry y geometría. **Primer checkpoint recomendado.** |
| **1AW · Entidad, pista y colección** | EntityRow/Card/PrimaryAction; TrackList/MediaGrid/MediaRail y fila Listen especializada; reutilizar HairlineRow/InfoBadge/GenrePill. Incluye estados de reserva que necesitan estos consumidores, sin una nueva card universal. | Listen LibraryAlbumsTab + ArtistCard + AlbumTrackList/PlaylistTrackList; un consumidor Admin existente afectado por cada fuente shared cambiada. | Misma entidad en row/card y colección,12/18 de Hairline, sin row background hover, selección/activo distintos, menú y navegación separados, widths largas y0/1/muchos, umbral virtualización/drag intactos. Ring de track preservado. |
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

| Checkpoint propuesto | Alcance | Dependencias y aceptación |
| --- | --- | --- |
| **1AY · Shell y búsqueda/colección básica** | DesktopShell, MobileShell, Sidebar, TopBar/Search, MobileBottomNav; Library artists/albums/liked y aliases. Mantener flujo de acceso existente, aplicar los fundamentos aprobados a PublicShell cuando la composición lo requiera. | Contratos mínimos H0 + cabeceras1AU, sin esperar fichas no modificadas de1AX. Quitar chrome glass/blur/lift contradictorio, usar fade sobre contenido según referencia. Safe areas con y sin player,44px, active marker, hover/focus, escroleo/header. Library adopta Tabs/helperURL con adaptador `/collection/:section`; conserva query/hash/history/unknown. No desaparecen otros tabs. |
| **1AZ · Player, cola y rendimiento de UI** | Bar, Fullscreen, Extended, Queue, Seek/Volume, Quality, resume/sleep; wrappers de acciones convencionales, separación de progreso y B24. EQ disponible sigue funcionando; la ampliación glyph/chain puede entregarse en H3 si necesita contrato. | H0/H1 shell. Play esencia/aura/ring y estela/dot sincronizados bajo drag, teclado y reloj. Controles sin track/buffer/offline/remote/locked, repeat/shuffle y menus intactos. Audio/crossfade por ref y un loop; ninguna lista/page se suscribe a progress. Lazy chunks preservados y sin importar EqBands al eager. |
| **1BA · Ruta Album y acceso/offline del primer recorrido** | Album local/global/legacy y Artist→Album/TopTracks; selección/acciones/imports/countdown; Login/Register/ServerSetup/callback con shared forms; offline mínimo hasta playback preparado y reconexión. | Contratos H0 y Shell1AY + Player1AZ, ambos deH1. Prueba del recorrido real o contrato instrumentado completo: acceder→buscar/colección→álbum→play→seek→cola→guardar/descargar→offline→volver. Permisos y errores reales, auth ticket cover, no regressión en helpers o engines. QA nativa sigue registrada aparte. |

H1 termina al poder demostrar ese recorrido con páginas reales y sus estados, no solo la escena
sin backend. Si no hay servidor/datos/dispositivo en el entorno, se entrega evidencia instrumentada
y se registra exactamente la prueba viva pendiente; no se declara validado lo que no se ejecutó.
No se publica como release ni se ocultan el resto de pantallas pendientes tras un “Listen listo”.

### H2 — cobertura de todas las rutas existentes

| Grupo/checkpoint propuesto | Superficies del inventario | Componentes/adopción y aceptación |
| --- | --- | --- |
| **1BB · Home y colecciones** | R01/R04/R08–R11: Home, Library completa, Playlist/Curated/HomePlaylist, HomeSection, Crates/editor | Heroes/SectionHeader, cards/rows/rails compartidos, forms y modales, coverflow/drag/colaboradores/descarga. StatBox pasa al rol común; StatStrip solo con segunda adopción real. Lista de cada tab/variante y acción cubierta; ninguna receta paralela ni override para esconder un fallo de base. |
| **1BC · Browse, eventos y descubrimiento actual** | R02/R05–R06/R12–R14: Explore/genre/decade/category, Artist completo, Upcoming/show, Radio y Paths | EventRow/CalendarDate, cards/rows, ficha editorial ArtistBio/Frame/Presentation, chips/filtros y acciones. Show sigue expandible; release adapta avatar/badges/fecha. Radio conserva debounce300 y start/session reales; Paths conserva creación/lista/detail. Mapa/mood/wheel/setlist ampliados quedan en H3 con precondiciones. |
| **1BD · Settings, social, imports y compartir** | R17–R22/R25: todos los ajustes, people/profile/connections, Bandcamp, Upload/Contributions, offline completa, ShareSheet y traducción | Labels/form fields uppercase y8px, valores con case original, Meter/StatusDot/Readout/StatNumber por rol; selector scalar como Select, acciones icon-only donde son claras, Solar. Mantener capability gates, siete locales, export/withdraw, colaboración, QR y canvas share esperando fuentes. StepRail se comparte solo cuando ambas apps usan fases reales. |
| **1BE · Stats, Digging, lyrics/info y demás superficies persistentes** | R15/R16/R24/R25; revisión transversal player output/targets, visualizer, InfoTab, fuente/provenance y Tauri chrome | Métricas/lecturas, stats/tape/heatmap y narrativa local, typography display/body/mono, live regions silenciosas. Nivo para charts estadísticos; instrumentos manuales donde corresponde. Output/Cast/Connect/visualizer/native guards conservados; no analyser ficticio. Retirada PD47 con prueba de imports y límites lazy. |

Los grupos1BB–1BE deben dividirse en lotes internos de consumidores coherentes si su diff deja de
ser revisable; cada lote tiene stop para Diego y muestra pequeña completa. Son un mapa de cobertura,
no permiso para un mega-commit de decenas de páginas. No se omite una familia por haber cerrado
sus componentes base. La tabla R01–R25 del inventario permite comprobar el cierre.

### H3 — instrumentos previstos y contratos de datos

Esta capa completa el producto V3 descrito en el plan original. No se mezcla en migraciones
visuales para simular avances, ni se elimina del alcance global por priorizar un primer corte.

| Instrumento / tarea original | Precondición | Implementación y salida |
| --- | --- | --- |
| EQ glyph/store/chain, Task4.3/4.5 y2.19 | Ganancias engine exactas; payload additive chain/genrePath cuando se necesite, parity cache/resolver; servidor antiguo soportado | Store/ref/cadencia, glyph barato eager, panel lazy, descripciones/locales, keyboard/drag; chain y walk con datos reales. Segundo consumidor Admin real para nuevas extracciones shared, o módulo local. Hold behavior4.4 no se cambia sin alcance propio. |
| Heatmap y Home DNA, Task4.6 | Dashboard/timezone/night_hours/privacy correctos, umbral muestra pequeña de2.20 si aplica | 7×24, DST/offsets, aria/roving/focus, reduced motion; Home desktop sin fetch móvil nuevo. No atribuir al StatsHeatmapCard actual todos esos contratos. |
| SetlistTicket, Task4.7a/b | Match/in_library actual y playlist/create actions reales | Ticket/expanded setlist; mismo contrato en Admin solo al adoptar, sin inventar disponibilidad. |
| MoodMap, Task4.8a/b | Snapshot/pools, coordenadas/análisis y capacidades válidas | Instrumento local Explore, selección/focus/empty. Browse moods existente no prueba que el mapa ya pueda dibujarse. |
| Paths RouteMap, Task4.9a/b y5.11 | Task de planificación, plan_meta y transiciones reales | Map/list equivalentes, progresión/replan/failure y accesibilidad. Preservar endpoint actual mientras falta metadata. |
| Radio Sound map, Task4.10a/b | Explain/bliss map, sesión ownership y payload de tracks | Mapa/sugerencias explicables reales, selección/queue, fallback sin datos; no synthetic similarity. |
| Devices, Task5.9 | Capability/build flag, dispositivo/checkpoint/presence y ConnectWS disponibles | Top-level devices y target popover; estados online/recent/offline/reconnecting sin controlar targets no soportados. |
| Genre wheel, Task5.10 | Runtime graph/snapshot Listen, no datos Admin-only | Explore/genre con búsqueda/teclado y fallback, presupuesto/render gating. |
| Visualizer/static analysed state, Task4.11/4.12 | Analyser existente o campos de análisis reales por runtime | Paleta de contenido con chrome V3, static/reduced effects sin FFT móvil; no waveform inventada ni dependencia pesada eager. |
| Mix strip/access tokens y follow-ons Smart Mix | Integración futura explícitamente fuera de esta tarea | Conservar pendientes5.13/5.14 y Access tokens; decidir su alcance entonces. No activar Jam ni hacer rebase por este plan. |

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

| Bloque actual | Reutiliza / adelanta trabajo ya previsto | Qué no queda certificado |
| --- | --- | --- |
| 1AQ–1AU y H0 | Reconciliación R1; Task1b.*, componentes y cabeceras de4.1 | No completan shell/player, adopción de páginas ni QA de fase. |
| H1 shell | **Task4.1** Shell/MobileBottomNav, navegación y loops; parte de6.13/6.14 Search/Library | El trabajo de cabeceras1AU no había cerrado estos consumers. |
| H1 player | **Task4.2**, B24 de4.1, Lyrics/Resume/sleep de6.16 | No integra decks Smart Mix ni certifica audio nativo. |
| H1/H2 pages | **6.12–6.16** Home, Explore, Artist/Album, colecciones, Settings/social/Bandcamp/Upload/offline/auth/share, Stats/Radar/Radio/Paths/Tauri | Un restyle no fabrica contratos backend/instrumentos de4.x/5.x. |
| H3 | **4.3–4.12,5.9–5.11** y dependencias backend explícitas | Las tareas MAIN/BEHAVIOUR/Smart Mix no se asumen disponibles ni autorizadas por este análisis. |
| H4 | QA fase7 y procedimiento CI/canónicas vigente | No se repite full VISUAL/test por cada checkpoint por una instrucción histórica. Diego exige ahora pruebas focalizadas seriales y cierre completo una sola vez. |

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

| Cambio | Comprobación necesaria |
| --- | --- |
| Base shared | Vitest del contrato y de los consumidores afectados Listen/Admin; `--maxWorkers=1`. Semántica/refs/callbacks y datos ausentes/0/long text, no solo snapshots de clases. |
| Page/composite Listen | Tests de presentación/controller/model afectados y ruta/acciones reales. 7catálogos/metadata si cambia copy; nombres accesibles y plural/locale también son copy. |
| Geometría y capas | Playwright `--workers=1`, ambas vistas pequeñas,390/768/1440 según contrato, fine/coarse,8px reales, equivalencia de control, computed fonts/overflow y layering/focus. Probar también un caller real afectado. |
| Playback | Seek drag/clock y beam/dot; play/ring/buffer; render counts y rAF compartido, no storage/fetch/frame; lazy boundaries y efectos reducidos. No asumir analyser. |
| Platform | Typecheck Listen/Desktop y pruebas Desktop afectadas; tests runtime flags/stubs/safe session/artwork si cambian. Prueba de dispositivo real queda separada si no disponible. |
| Governance | Lint/tipos del alcance; `design-system:showcase:check` y refresh por IDs documentados que cambian, policy tests relevantes, links y estado. No convertir todo pending a documented en bloque. |
| Builds/bundle | Build Listen y check bundle cuando cambia runtime; Admin build/gate si cambio shared afecta su runtime; herramientas si cambia escena/tooling. Evitar repetir una build verde si solo cambian notas. |

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
