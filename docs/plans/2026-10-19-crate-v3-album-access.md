# 1BA — Album, access and the first offline journey

Base: 1AZ approved/pushed `18a880c2`, `feat/crate_v3`. Reference: approved5186mockup + confirmed amendments; approved Listen H1 plan. Actual pages remain the deliverable. Review in English, same scene in both hosts, all three services active. Stop before commit for Diego.

## 1. Access

Use one app-local AuthFrame and credentials view for Login/Register, one ServerSetupView, and callback presentation. Shared FormField/Input/Button and display headings own roles; remove local geometry, label and glass overrides. Preserve secure-write waiting, invite-only, OAuth/deep links and server validation. Test form associations/autocomplete, errors, loading and submission contracts.

## 2. Album and artist entry points

Preserve route identities (local/global/legacy), native/mobile cover composition, playback, selection, permissions and authenticated artwork lifecycle. Reconcile conventional selection controls through the action family, notices through solid surfaces, countdown through MonoLabel/StatNumber. Artist album/top-track entry points use SectionHeader and collection primitives. Actual AlbumHero/Actions consume pure app-local views reused in review; no mockup expansion or invented shared consumers.

## 3. Offline minimum

Reuse ordinary track visuals and media minimums for verified local groups. Offline progress is a small leaf, transport stays disabled without a current track, existing profile/ready-asset and reconnect authority remain unchanged. Empty is a real EmptyState; reconnect uses existing AuthContext/session flow, no new login/storage engine.

## 4. Evidence and review

Focused RED→GREEN tests, full instrumented first-journey contract through actual pages/controllers and engine/storage boundary tests; read-only live Album/Artist inspection. Two-host desktop/mobile scene measurements (8px labels, 40/44px forms,48px media, no overflow). Storybook documents app-local families, shared catalogue check stays enforced. Scoped types/lint/build/bundle. One fresh whole-change review under executing-plans; no native/AT or real production-write certification from fixtures. No full suites/canonical baseline regeneration.

## Independent review

One fresh whole-change review: no Critical; Important offline track semantics/names fixed with
valid list/listitem ownership, contextual playback names and keyboard activation test RED→GREEN.
Reviewer Minor (missing Artist and pending access specimens) promoted to Important for complete
checkpoint review: actual ArtistLibraryFrames adopted in production and scene, pending forms
exposed via local state; two-host browser test failed for absent coverage then passed. No deferred
minors. Reviewer declined independent execution, visual comparison, native/AT/prod writes/live
reconnect; author checks cover source/targeted tests/browser and read-only actual Album/Artist.
Real-device downloads, engines and production reconnect remain explicit QA limits.

Rulings: preserve native Album measurement to avoid unreviewed native geometry changes (later
native QA may require adjustment); use controlled write/player/storage boundaries for complete
journey (real device/write QA remains); stop uncommitted and run scoped checks per Diego/repo
(over skill defaults; phase validation remains). No new design alternative or runtime dependency.


### Validación final1BA

182pruebas Listen en34archivos,28guardas shared en4archivos y26Desktop en2archivos:236casos
focalizados verdes.4casos Playwright verdes (Storybook/standalone × desktop/mobile): acceso
pendiente/error/invite, selección y feedback real de menú, pre-release sin play, import con
confirmación, lista offline nombrada, teclado/seek, vacío,8px entre caption/control,40/44px forms,
48px covers y acciones44px; sin overflow. Caso adicional de semántica/nombre/teclado offline
RED→GREEN. Recorrido instrumentado completo verde; no engine/storage nativo real.

Tipos Listen/shared/Desktop/Storybook y lint de todos los TS/TSX afectados (0warnings) verdes.
Builds Listen, Storybook y preview verdes; input1BA incluido. Inicial Listen202193Bgzip/307200
de presupuesto,24assets. Catálogo53documentadas/93entradas/120fuentes válido.
Evidencia en.artifacts/review/1ba-*; captura review1ba-review.jpg y álbum vivo1ba-live-album.jpg.
Listen autenticado: Nights Of Lust, portada real cargada280px/título sin recorte; artista real con
Albums/Top Tracks y los dos grids comprobado sin play ni escrituras de producción.

Revisión independiente: ninguna crítica; importante de accesibilidad offline resuelta; menor
de cobertura promovida por completitud y resuelta con frames reales de artista/pending access.
No menores diferidos. Comparación/ejecución independiente, AT, dispositivos y writes/reconexión
de producción no certificados por el revisor; autor verifica contratos y navegador descritos.
Conservada composición nativa existente, pendiente QA real; ver reglas/decisiones en plan1BA.
Tres servicios5186/6006/5174 activos.1BA sin commit/push: detenerse para revisión de Diego.

### Enmiendas durante la revisión

TrackRowContent reserva columnas para QualityBadge, BPM, tonalidad, duración y acciones; los
valores ausentes conservan su hueco. QualityBadge es el componente real de Listen usado también
por hero y reproductor: Solar Soundwave y colores de tier, sobre InfoBadge24px/12px. Duración
conserva12px, análisis su rol técnico. Umbrales de contenedor480/620px, play blanco/cover48px y
ring V2 se mantienen. AIFF se clasifica lossless y números de fuente inválidos no se muestran.

La consulta get_artist_all_tracks y _format_artist_top_track omitían profundidad y frecuencia.
Consulta, respuesta y esquema conservan ahora bitrate/sample_rate/bit_depth por pista en una
sola lectura, sin N+1 ni inferencia desde el álbum. Serializador y consulta real PostgreSQL
RED→GREEN. Go delega Top Tracks en FastAPI. La API de producción conserva el contrato anterior
hasta desplegar este backend;5174 sigue conectado a ella. No hay despliegue de producción.

Columnas medidas iguales en el álbum real de Pantera, con BPM de2/3cifras. Selección Ctrl/Shift
comprobada en vivo y confirmada correcta por Diego: no se cambia su semántica. Storybook añade
Listen/QualityBadge y Listen/Album and access/TrackMetadata. Fundamentals documenta y registra
la receta. No se amplía el mockup histórico.

Show cards: el componente ya era GenrePill; el adaptador solo reenviaba nombres. UpcomingItem
conserva el perfil opcional; ArtistPageViewModel reutiliza el perfil ya recibido del mismo artista,
sin consultas nuevas. La vista expandida conserva porcentajes, incluido0%, y procedencia; cuando
solo existen nombres no inventa porcentajes. En The Streets se comprueba en vivo100/88/76%.
Escena y story ShowGenres usan la vista real; pruebas de modelo y render RED→GREEN.

Comprobación focalizada de filas/calidad:61Listen,27shared,3Admin,26Desktop y13backend verdes;
10casos de navegador entre ambos hosts y tres anchos; tipos de cuatro proyectos y lint verdes.
Builds Listen/Storybook/preview verdes; inicial202181Bgzip/307200,24assets. La enmienda de géneros
recibe además pruebas y verificación de los consumidores afectados. Continúa1BA sin commit/push.

Diego aprueba la composición del show como referencia para Listen y pide8px tras el separador
del mes. UpcomingMonthGroupView usa FormField kind=group y lo reutiliza UpcomingMonthGroup;
eliminado el margen local space-y de la etiqueta. Grupo nombrado/expansión RED→GREEN,30tests
de shows/artista verdes. Geometría8px medida en The Streets y en ambos hosts, escritorio/móvil.
La story ShowGenres reutiliza ese mismo frame/vista; el controlador inyecta la ruta canónica del
artista para mantener la vista de presentación independiente de API/auth.


### Última enmienda1BA: avatares compactos y presentación autocontenida

La subida global a48px había alcanzado dos identidades compactas de V2: AlbumHero24px y
PlayerTrackIdentity28px. Ambos usan ahora EntityAvatar con tamaños xs e inline, respectivamente;
Avatar define el nuevo tamaño finito28px, sin overrides en consumidores. CrateImage conserva
recuperación autenticada y notifica solo errores finales; el fallback mantiene la geometría y
una fuente nueva puede cargar. El avatar es decorativo cuando el nombre ya está junto a él.
Las portadas y miniaturas autónomas de pista/álbum/artista, incluidas las circulares de Stats,
conservan48px. ArtistAvatarExamples aparece en ambos reviews y en Storybook; Avatar,
EntityAvatar y MediaCover documentan la distinción y actualizan sus entradas del catálogo.

La vista de show importa su CSS de ticket (extraído sin cambios del CSS global de Listen),
para que producción y ambos previews tengan la misma composición sin compensaciones locales.
UpcomingItem vive en un módulo de tipos sin API; el modelo lo reexporta para compatibilidad.
La vista recibe la ruta canónica del artista desde su controlador. Storybook no carga API/auth.

Verificación de esta enmienda:84tests Listen verdes (4casos nativos previamente skipped),
78shared,17modelos/show y26Desktop;10casos navegador verdes entre los dos hosts, incluyendo
24/28px frente a48px, ticket opaco/máscara y8px tras el mes. Los builds de Listen, Storybook y
preview pasan; inicial202235Bgzip/307200,24assets. Evidencia1ba-avatar-* y captura comparativa
1ba-compact-artist-avatars.png;1ba-shows-spacing.png muestra ahora la story correcta del show.
Continúa1BA local, sin commit/push y sin despliegue. Top Tracks en producción sigue pendiente
del contrato backend descrito arriba; no se inventan datos mientras tanto.


### Enmienda1BA: hover/selección de pistas, Suggested y navegación

Diego revoca la supresión global de hover para las pistas. Solo TrackRow habilitado recupera
el wash accent4% con ratón/fine pointer; no se introduce hover persistente en táctil ni en filas
inhabilitadas. Las otras familias conservan su política anterior. La selección tenía un relleno
plano y ningún marcador; usa ahora la misma receta crate-row-highlight8%→transparente que
HairlineRow, con línea2px. Selección y pista actual conservan semántica independiente: solo la
pista actual tiene aria-current, título accent y el control/ring de reproducción. Los eventos de
selección múltiple, teclado y reproducción de TrackRow no se alteran.

SuggestedTrackRow era un botón local con título/metadatos/barra; ahora es un adaptador del
TrackRow real dentro de TrackList. Conserva referencias de entidad/álbum, datos técnicos que
lleguen en el payload, portada gestionada, duración, menú/like y el callback radio existente.
El score real sigue visible como InfoBadge porcentual; ausencia/valor no finito no se convierte
en cero. No se añaden llamadas por fila ni nuevas lecturas al reloj. Tipo SimilarTrack acepta
los campos canónicos que ya conserva PlayableTrackInput; la API de similitud enriquece las
referencias de álbum/artista en lote, sin necesidad de otro endpoint.

Los children de Collection usaban HairlineRow con padding10px/borde, frente a listen-nav-item
con padding8px de los padres. Comparten ahora el mismo item de navegación44px/14px, manteniendo
la sangría, destinos, aria-current, popover colapsado y sheet móvil. La fila de lista de texto
HairlineRow no se usa como parche de navegación. Escenas TrackInteractions/CollectionNavigation
se añaden solo al review pequeño1BA y Storybook. Catálogo HairlineRow/fundamentals actualizado.

Evidencia RED de los cuatro contratos y hover navegador antes del cambio. Verificación focalizada:
92Listen pasan (4skip nativos existentes), luego33casos adicionales/de consumidores de Suggested
incluyen los2tests nuevos de SuggestedTab;13shared,3Admin y26Desktop.23casos navegador verdes:
Hairline desktop/móvil, reproductor, sidebar/popup/sheet, selección separada y excepción hover.
Tipos Listen/shared/Desktop/Storybook y lint de cambios verdes. Evidencia1ba-row-*, screenshot
1ba-track-selection-states.png. Sin commit/push ni despliegue; tres previews continúan activos.

Cierre de la enmienda de filas: builds Listen/Storybook/preview verdes. Inicial Listen202227Bgzip
(24assets), presupuesto307200 intacto. Catálogo53/93/120 válido, diff whitespace limpio. Tres
servicios activos y vista viva recuperada tras HMR; checkpoint1BA permanece sin commit/push.

### Enmienda1BA: movimiento del disco, modos y Collection

Reproducido el salto: una corrección ordinaria del reloj de0,75s hacía avanzar91,92° en un
frame donde correspondían1,92°. El controlador dejaba de interpolar y reanclaba la fase al
tiempo de audio. Ahora una animación nativa de transform mantiene120°/s sin escrituras JS por
frame; el fallback conserva un único RAF. Progreso ordinario no reinicia ni reancla el giro.
Pausa, buffering, visibilidad y movimiento reducido congelan la fase; el jog captura la fase
visible, conserva el gesto y evita reanclarse a notificaciones anteriores al seek. Los saltos
grandes de reproducción siguen pudiendo reposicionar el disco. SpinningDiscFrame es el mismo
marco real en producción y revisión; autenticación de imágenes y autoridad de audio siguen
en sus consumidores originales.

PlayerSurfaceModeSwitch adopta ActionButton icon-only44px, sin contenedor visual, borde ni
texto debajo: seleccionado accent y alternativas blancas, tooltip, radios y flechas/Home/End.
Conserva las capacidades del renderer; móvil sigue ofreciendo disco/cover. Collection permanece
desplegado al entrar o navegar por sus rutas con sidebar expandido; no se contrae al pulsar
su cabecera. Popover colapsado y sheet móvil mantienen cierre y retorno de foco.

Revisión pequeña: `review-1ba-player-motion.html` y Storybook
`reviews-1ba-player-motion--complete`, más entradas DiscMotion/DisplayModes en Listen/Player.
Usa el controlador y marco reales, un reloj local4Hz y controles de corrección, buffering, seek
y carga de interfaz120ms. No introduce otra implementación visual ni reproducción real.

Validación de esta enmienda:98pruebas Listen verdes,4skips nativos existentes;11guardas de
componentes/tokens/radios;50Desktop.15casos navegador en ambos hosts,375/1200px y coarse/fine:
fase a120°/s, animación sin reinicio tras corrección/carga, pausa/buffering/reduced motion,
44px/iconos/teclado y Collection abierto por ruta; también filas y Shell. Tipos Listen,
Desktop y Storybook y lint cambiado verdes. Builds Listen/Storybook/preview verdes; inicial
202228Bgzip,24assets, límite307200 intacto. Evidencia `1ba-player-motion.png` en artifacts/review.
Estas comprobaciones no certifican FPS universales o dispositivos nativos. Stop1BA sin commit/push.

### Enmienda1BA: escala de artista y acabado del player

Diego confirma V2 como referencia de tamaños de imágenes por rol. La regresión de AlbumCards
venía de ArtistAlbumGroupFrame con MediaGrid compact (hasta8columnas), sustituyendo la rejilla
V2 de2/3/4/5. MediaGrid comfortable conserva ahora esa fórmula y gap16px, con tope5 desde1024px;
el artista la adopta sin overrides. Se mantienen las excepciones ya aprobadas de miniaturas48px
y avatares compactos24/28px. Verificado en Placebo:5columnas de226,8px al ancho disponible.

La biografía no estaba limitada por ArtistBioText: la receta compartida ModalBody imponía60ch
a toda la región de contenido. Retirada esa restricción en el componente/receta, sin reparación
local. En el modal real de896px, el cuerpo ocupa894px y los párrafos836px tras padding/scrollbar.
AppModal/ArtistBioProfile conserva texto completo, párrafos, enlaces, miembros y scroll.

El EQ estaba oculto por la preferencia de efecto apagado. Su acceso fullscreen ahora depende
de la capacidad del runtime, y puede abrir el panel con el efecto apagado sin activarlo ni
cambiar preferencias. Los pipelines sin soporte siguen sin ofrecer procesamiento. Retirado
el rótulo añadido en ExtendedPlayerHeader; la sección de pista actual de la cola ya existía
en V2 y conserva su función. ExtendedPlayerHeaderBar es la pieza real usada por app y revisión.
PlayerLyricsSurface reúne el contenedor plano de ambos fullscreen; retiradas las dos recetas
de degradado sin consumidores. Se conservan letras, seek, máscara de borde y scroll.

Revisión vigente: `review-1ba-artist-player.html`, Storybook
`reviews-1ba-artist-player--complete`; entradas relacionadas actualizadas en MediaGrid, AppModal,
Listen/Album and access, Listen/Player y fundamentos. Catálogo53/93/120, sin tocar deuda pendiente.
Regresiones reproducidas RED antes de las correcciones.81Listen verdes (4skips nativos previos),
66shared,11Admin,50Desktop;6casos de escala/ancho/cabecera/letras en ambos hosts a375/1200/1920px
y10casos de capas/consumidores de modales verdes. Tipos Listen/Desktop y Storybook verdes tras
aislar los tipos del header de aliases del runtime; lint cambiado0warnings,3builds verdes,
inicial202228Bgzip/307200 y24assets. Evidencias reales:1ba-artist-bio-width.png,
1ba-artist-album-scale.png y1ba-player-eq-access.png. Sin modificar audio, cuenta ni biblioteca.
Mantener5186/6006/5174 y parar1BA para revisión antes de commit/push.


## 2026-10-19 — 1BA aprobado; publicación autorizada

Diego aprueba1BA con sus enmiendas y autoriza commit/push. Continuar con1BB, Home y colecciones,
usando el mockup y las correcciones confirmadas como referencia, actualizando Storybook y
manteniendo5186/6006/5174 activos. Detener1BB para revisión antes de su commit/push.
