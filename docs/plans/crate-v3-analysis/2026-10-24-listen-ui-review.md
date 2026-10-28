# Listen · revisión independiente · 24 octubre 2026

**Seguimiento:** los 12 findings de este análisis están corregidos y verificados. Véase el [informe de cierre](2026-10-24-listen-findings-resolution.md), que conserva los resultados finales y los límites de la comprobación móvil. El diagnóstico que sigue describe el estado anterior a esas correcciones.

Revisión independiente de los archivos actuales de `/home/diego/.codex/worktrees/crate-v3-1q/crate`, rama `feat/crate_v3`, realizada por un agente distinto de los revisores de Admin y contrastada por el agente raíz. No es una comparación con `main` ni una revisión limitada al diff. El árbol contiene trabajo previo en curso. Solo análisis: no se ha modificado código del producto, datos ni preferencias. Se inició Listen local en `5174` contra la API local `8585` para la comprobación de navegador.

**Resultado: 12 findings — 10 P2 y 2 P3. Ningún P1 confirmado.** P2 identifica problemas de comportamiento, persistencia, accesibilidad o recuperación; P3 identifica consistencia visual o de contenido. Cada finding incluye fuente, efecto y corrección mínima.

Leídos completos `AGENTS.md`, `app/listen/AGENTS.md` y `app/shared/AGENTS.md`, incluido 1BD/1BE. Consultados el checklist de Admin como guía de roles/primitivas, las fuentes y tests de los consumidores correspondientes, y las instrucciones de `web-design-guidelines` con su [fuente actual](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). Los criterios de Listen, sus excepciones de artwork/player y las enmiendas del usuario prevalecen.

No se ha encontrado un P1 confirmado en Listen. Los defectos principales son de estado, persistencia de edición y accesibilidad; las migraciones recientes 1BD/1BE no se consideran drift por mantener componentes específicos de Listen.

## Evidencia y límites

- **Fuente:** inspección de rutas, controladores, vistas, shared y tests. No equivale a reproducción visual.
- **Diagnóstico aislado:** `/tmp/listen-review-oct24/diagnostic.test.tsx`, config `/tmp/listen-review-oct24/vitest.config.mjs`; API/player simulados; **5/5 casos pasan y confirman el comportamiento defectuoso descrito**. No son tests que certifiquen el comportamiento deseado. No hubo red, audio ni escrituras reales.
- **Diagnóstico de player delegado:** `/tmp/crate-listen-player-review-ppbq7l6i/closed-extended.test.tsx`, **1/1**, resultado en `/tmp/crate-listen-player-review-ppbq7l6i/result.json`. API/partes visuales simuladas; cero play/resume/pause/seek.
- **Navegador:** lo operó el agente raíz sobre Listen local `5174` con API local `8585`, en escritorio. Se confirmó el foco invisible de ExtendedPlayer tras abrir/cerrar con una pista restaurada en pausa. En Liked también se verificó que un filtro sin coincidencias deja cero filas y «Play 0» habilitado. No se pulsó Play ni se reprodujo audio; el efecto sobre la cola de L05 se comprobó solo con mocks. No se hizo verificación visual móvil/native.
- No se ejecutaron suites amplias, builds, lint ni typechecks: no hay implementación autorizada en este corte.

## Hallazgos

### L01 · P2 · El player expandido cerrado conserva foco y controles invisibles

**Ubicación:** [ExtendedPlayerView.tsx:70](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/player/ExtendedPlayerView.tsx:70), [PlayerBarSurfaces.tsx:62](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/player/bar/PlayerBarSurfaces.tsx:62).

El cierre sólo añade opacity/translate/pointer-events; la superficie permanece montada después del primer prepare/open y no se vuelve `inert`, `hidden` ni `aria-hidden`. Abrir y cerrar, o preparar desde el launcher, deja sus botones, radios, seek y tabs en la navegación de teclado. El diagnóstico conserva foco en Close player y el siguiente Tab entra en CD mode, dentro del panel invisible.

**Navegador raíz confirmado:** después de Close player, el siguiente Tab enfoca el radio Visualizer mode dentro del panel cerrado. Su rectángulo tiene top736px con innerHeight720px y no tiene ancestro hidden/inert/aria-hidden. AX conserva cola y controles después de cerrar. El cierre también dejó foco en Close player, con tabindex0. No se inició reproducción.

**Patrón/corrección mínima:** aislar el panel cerrado con `inert` y ocultarlo de AX; devolver el foco al launcher al cerrar. Conservar su animación de salida y los controles especializados. `AppModal` y el Digging actual son referencias de restauración/aislamiento, no una obligación de sustituir el diseño del player. Los tests actuales no excluyen Tab en `open={false}`.

### L02 · P2 · El fullscreen móvil no establece foco ni semántica modal

**Ubicación:** [FullscreenPlayerView.tsx:32](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/player/FullscreenPlayerView.tsx:32), [useFullscreenPlayerLifecycle.ts:30](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/player/useFullscreenPlayerLifecycle.ts:30).

La vista es un `div` fijo sin rol/nombre de diálogo, entrada de foco, contención, restauración o aislamiento del fondo. El lifecycle gestiona visibilidad, Escape y Back nativo. Por debajo de768px, al abrir por teclado el dock launcher se desmonta y el fondo (header/main/nav) sigue activo. Un teclado externo o lector puede recorrer controles cubiertos por el fullscreen.

**Evidencia:** fuente; requiere comprobación en navegador móvil/teclado. No hay test de contención/restauración fullscreen. **Corrección mínima:** establecer foco y aislamiento mientras está abierto, y restaurar al launcher; reutilizar el mecanismo de capas/foco de [AppModal.tsx:127](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/shared/ui/primitives/AppModal.tsx:127) conservando la composición especializada.

### L03 · P2 · Guardar una playlist ignora el orden que el editor permite cambiar

**Ubicación:** [playlist-actions.ts:264](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/playlist-actions.ts:264), [LibraryPlaylistsTab.tsx:148](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/LibraryPlaylistsTab.tsx:148). El control real está en [PlaylistComposerTrackListView.tsx:130](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/playlists/PlaylistComposerTrackListView.tsx:130).

El editor y su reducer reordenan las pistas mediante Dnd. Ambos adaptadores de guardado sólo actualizan metadatos, borran entradas retiradas y añaden nuevas; no envían el orden de `payload.tracks`. Reordenar dos pistas existentes y guardar anuncia Updated y cierra el editor, pero una lectura nueva conserva el orden anterior. También se pierde la posición elegida de una pista nueva intercalada entre existentes.

**Diagnóstico aislado confirmado:** guardar dos entradas existentes en orden inverso produce exclusivamente `PUT /api/playlists/10` de metadatos. **Corrección mínima:** persistir la secuencia final con el endpoint de reorder existente después de conciliar entradas, o una operación atómica equivalente. Referencia: [playlists.py:310](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/crate/api/playlists.py:310); CrateEditor ya persiste su reordenación en su controlador.

### L04 · P2 · Un rerender/refresh del padre puede borrar el borrador de playlist abierto

**Ubicación:** [PlaylistCreateModal.tsx:90](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/playlists/PlaylistCreateModal.tsx:90), [LibraryPlaylistsTab.tsx:323](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/LibraryPlaylistsTab.tsx:323), [use-playlist-page-controller.ts:97](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/use-playlist-page-controller.ts:97).

El efecto de inicialización resetea todos los campos cuando cambia cualquier `initial*`, incluido la identidad del array `initialTracks`, aunque el modal siga abierto y sea la misma playlist. Collection calcula `editableTracks(editingPlaylist)` de nuevo en cada render; detalle vuelve a construirlo al llegar un snapshot/SSE/safety-net. Un refresh puede borrar título, descripción, portada, añadidos y orden sin intervención del usuario.

**Diagnóstico aislado confirmado:** editar Original Name a Unsaved Draft y rerenderizar el padre con un nuevo array equivalente restaura Original Name. **Corrección mínima:** inicializar por apertura/identidad explícita del editor; conservar el draft durante refresh de la misma entidad. [CrateEditor.tsx:144](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/CrateEditor.tsx:144) ya distingue valores editados de datos entrantes. Añadir cobertura de refresh con borrador sucio, no sólo del primer open.

### L05 · P2 · «Play 0» reproduce toda la biblioteca de Liked

**Ubicación:** [LibraryLikedTab.tsx:84](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/LibraryLikedTab.tsx:84), [LibraryLikedView.tsx:37](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/LibraryLikedView.tsx:37).

Con una búsqueda sin coincidencias, el botón muestra el conteo real0 y sigue habilitado. `handlePlayAll` usa `filtered.length ? filtered : tracks`; el cero de un filtro activo activa el fallback a toda la colección. Se sustituye la cola por música que el usuario acaba de excluir.

**Diagnóstico aislado confirmado:** una biblioteca simulada con Alpha Track, filtro no-match-at-all y click en Play 0 llama `playAll` con Alpha Track. En navegador local se verificó cero filas y Play 0 habilitado, sin pulsarlo. **Corrección mínima:** reproducir solo el conjunto filtrado; deshabilitar/no-op cuando está vacío y mostrar un vacío contextual. Referencia: los estados `playlist.empty.noFilter` y los guards de playerTracks vacíos de los detalles de playlist.

### L06 · P2 · Varias lecturas fallidas se presentan como vacío o inexistencia sin Retry

Es el mismo patrón en cuatro superficies activas:

| Superficie y fuente                                                                                                                                                                                                                                                                                 | Trigger e impacto                                                                                                                                                                                                                           | Corrección mínima/referencia                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [LikedTracksContext.tsx:115](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/contexts/LikedTracksContext.tsx:115) → [LibraryLikedTab.tsx:74](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/LibraryLikedTab.tsx:74)                                              | Primer GET likes falla: el provider sólo termina loading, conserva[] y no expone error. La colección afirma que no hay likes y no ofrece Retry. El provider además alimenta corazones, de modo que desconocido se interpreta como no-liked. | Exponer estado de read/error/refetch y distinguir desconocido de vacío confirmado. LibraryAlbumsTab y LibraryArtistsTab ya componen ErrorState con Retry.              |
| [ArtistTopTracks.tsx:50](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/ArtistTopTracks.tsx:50), [ArtistTopTracks.tsx:57](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/ArtistTopTracks.tsx:57)                                                          | Ignora error/status/refetch tanto del artista como de sus pistas. Tras fallar queda título vacío o listado vacío, con Play activo; pulsarlo anuncia que no hay top tracks.                                                                  | Estado de artista/pistas diferenciado; Retry para fallo no404, EmptyState para éxito vacío y Play deshabilitado. Referencia ArtistReadState.                           |
| [Crate.tsx:170](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/Crate.tsx:170), [Crate.tsx:398](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/Crate.tsx:398)                                                                                              | Anonymous/Authenticated descartan error/status del detalle y convierten cualquier fallo no cacheado en CrateUnavailable. Playback también descarta error de `/playback` y deja Play deshabilitado sin causa ni reintento.                   | Conservar cached data; error con Retry frente a404 real. Mostrar fallo/reintento del bloque playback por separado. Referencia los reads de Crates index y HomeSection. |
| [PlaylistCreateModal.tsx:145](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/playlists/PlaylistCreateModal.tsx:145) → [PlaylistTrackSearchView.tsx:54](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/playlists/PlaylistTrackSearchView.tsx:54) | Un fallo de catálogo durante añadir pistas vacía results y muestra No tracks found. CatalogSearch ya admite error/onRetry, pero el controlador no los suministra.                                                                           | Mantener error separado y conectar el contrato existente de CatalogSearch, igual que Path/Radio search.                                                                |

**Evidencia:** fuente y tests actuales inspeccionados; no se han provocado fallos de la API real. Los recientes Stats, Contributions, Bandcamp y las listas Albums/Artists sí distinguen adecuadamente sus fallos no cacheados.

### L07 · P2 · Search etiqueta como B resultados todavía pertenecientes a A

**Ubicación:** [SearchResults.tsx:32](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/SearchResults.tsx:32), [SearchResults.tsx:101](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/SearchResults.tsx:101).

Cambiar `q` inicia la nueva petición pero mantiene `data` sin asociarlo a su query; la vista recibe inmediatamente el nuevo `query`, no tiene estado searching y sigue accionable. Mientras B tarda, el heading Results for B y la fuente de Play tracks usan B, aunque las tarjetas/pistas son A. AbortController evita aplicar algunas respuestas antiguas, pero no resuelve esta identidad del payload ya mostrado.

**Diagnóstico aislado confirmado:** tras cargar Alpha, navegar a Beta con la segunda Promise pendiente deja Results for Beta junto a Alpha Track, sin Finding your music. **Corrección mínima:** guardar `{query,data}` y estado de petición. Es correcto conservar contenido anterior como pide1BE, pero hay que identificarlo como contenido anterior y mostrar búsqueda en curso, o servir cache por query. Referencia [use-api.ts:280](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/hooks/use-api.ts:280) y CatalogSearch's `aria-busy`/loading cuando retiene resultados.

### L08 · P2 · La localización de conciertos conserva valores que el servidor rechazó

**Ubicación:** [ShowsLocationSection.tsx:153](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/settings/ShowsLocationSection.tsx:153), [ShowsLocationSection.tsx:185](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/settings/ShowsLocationSection.tsx:185).

City, mode y radius se cambian antes del PUT; sus catches sólo muestran toast y no restauran el valor confirmado. Tras un fallo el selector sigue mostrando una ciudad/radio/modo que Radar no usa. Tampoco hay pending/serialización: cambios rápidos pueden enviarse simultáneamente y una escritura anterior puede finalizar después de la nueva.

**Evidencia:** fuente; sin cambios reales de ubicación. **Corrección mínima:** conservar valor confirmado y rollback ante fallo; bloquear/serializar por campo y comprobar la identidad de respuesta. La preferencia remota de [ScrobbleSection.tsx:84](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/settings/ScrobbleSection.tsx:84) ya conserva/repone el valor anterior y tiene estado saving.

### L09 · P2 · La confirmación de Access Tokens permanece abierta al ocultar Connections

**Ubicación:** [AccessTokensSection.tsx:441](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/settings/AccessTokensSection.tsx:441), [SettingsPageView.tsx:68](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/SettingsPageView.tsx:68).

Settings conserva los paneles con forceMount/hidden para preservar borradores. AccessTokens controla `pending` con useState normal y su ConfirmDialog se porta al body; al cambiar de tab por historial, el panel se oculta pero el diálogo continúa por encima de la nueva pestaña. Puede rotar/revocar una credencial desde un contexto ya abandonado y conserva el foco bloqueado.

**Diagnóstico aislado confirmado:** abrir sólo la confirmación de un token simulado y cambiar SettingsPanelActivity a false deja alertdialog presente; ninguna operación de token fue enviada. **Corrección mínima:** integrar [useSettingsOverlay](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/settings/settings-panel-activity.ts:11) o limpiar `pending` al ocultar, como OpenSubsonic y SelectRow. Settings.test ya cubre este caso para OpenSubsonic pero no AccessTokens.

### L10 · P2 · Remove downloaded copies borra todo el perfil sin confirmación o undo

**Ubicación:** [OfflineSection.tsx:78](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/settings/OfflineSection.tsx:78), [use-offline-runtime.ts:372](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/contexts/use-offline-runtime.ts:372).

El botón de Settings llama directamente clearActiveProfile, que confirma EMPTY_SNAPSHOT y borra audio/artwork del perfil. No hay confirmación contextual ni ventana undo; un único toque elimina todas las copias y obliga a descargar de nuevo. El estado unsupported/readOnly/busy/empty está correctamente protegido, pero no evita una activación accidental cuando sí hay contenido.

**Evidencia:** fuente y test de OfflineSection que espera la llamada inmediatamente tras el click; no se activó el botón real. **Corrección mínima:** ConfirmDialog con alcance/conteos existentes y estado pending, cerrándose al éxito; preservar las capacidades actuales. Referencia ContributionWithdrawDialog y la confirmación de eliminación de playlist.

### L11 · P3 · HomePlaylist conserva copy temporal en inglés fuera de i18n

**Ubicación:** [HomePlaylist.tsx:37](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/HomePlaylist.tsx:37).

My New Arrivals construye This week + N previous weeks y Past N release weeks mediante templates ingleses; para un bucket también reutiliza release_week_label de la respuesta. El resto del hero usa t(), de modo que esta metadata permanece inglesa en los otros seis idiomas. Los tests actuales fijan expresamente el inglés.

**Corrección mínima:** helper semántico que devuelva índices/rango, y labels con ICU plurals en los siete catálogos; no inferir idioma del texto de backend. Referencia periodLabel/formatMonthTitle del Stats/Digging actual.

### L12 · P3 · ArtistTopTracks mantiene un header/lista local fuera del rol compartido

**Ubicación:** [ArtistTopTracks.tsx:104](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/ArtistTopTracks.tsx:104), [ArtistTopTracks.tsx:144](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/ArtistTopTracks.tsx:144).

Es la ruta ordinaria activa que conserva `h1 text-2xl font-bold` sin font-display, Back y Play en una única fila justify-between, más marco rounded/border/bg alrededor de un map local de pistas. El header no usa el wrapping por contenedor y el tratamiento de títulos de PageHeader; nombres largos pueden competir con las acciones en estrecho. El test sólo fija rounded-lg de Play.

**Evidencia:** fuente; hace falta inspección visual estrecha para valorar el resultado concreto. **Corrección mínima:** PageHeader con BackLink/actions y TrackList con el TrackRow real, manteniendo el playback y la escala artwork. Se han leído implementación/tests de ambos shared y consumidores en HomeSection/LibraryLiked; no se propone trasladar ningún control especializado a shared.

## Defectos condicionados y observaciones no elevadas

- **Connect, sólo si se habilita:** [Shell.tsx:28](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/layout/Shell.tsx:28) calcula clearance sólo por currentTrack local, mientras [usePlayerBarDisplayState.ts:73](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/components/player/bar/usePlayerBarDisplayState.ts:73) puede mostrar dock desde un snapshot remoto con cola local vacía. Faltaría espacio al final de página. Gate exige VITE_CRATE_CONNECT_FEATURE_ENABLED="true" más preferencia; default false en builds/compose y `.env.example` pide mantenerlo apagado para este release. No se presenta como fallo activo del preview. Corrección futura: compartir visibilidad real del dock con el shell. Tests Shell eliminan PlayerBar y tests PlayerBar fuerzan Connect off.
- **Jam, dormido:** FullscreenPlayerView/LyricsPanel/LyricsTab pasan seek directo a lyrics, omitiendo el gate de transport de los controles ordinarios. No elevar como regresión activa: JAM_ROOMS_ENABLED=false y todas las rutas jam/* redirigen a Home.
- **Cola fullscreen hasta20:** confirmado deliberado por commit0fd5c034 (#121,4abril). No se reporta el slice de19 próximos como defecto.
- **Artwork, tarjetas, SVG/Canvas/instrumentos, acentos de reproducción, Photo24/28 de byline y player, wash4% del TrackRow y cápsulas/roles técnicos:** excepciones válidas; no son duplicación o drift por sí mismas.
- **Sort Artists/Albums sólo móvil y recorte de Genre móvil:** no se elevan. Los introduce el cambio histórico9088e580 (#193,13junio) como capacidades/variantes móviles; [Explore.test.tsx:718](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/Explore.test.tsx:718) exige mostrar el ítem12 y ocultar13 en móvil, y [Explore.test.tsx:819](/home/diego/.codex/worktrees/crate-v3-1q/crate/app/listen/src/pages/Explore.test.tsx:819) exige el grid completo en desktop. Los tests Library:352/378 cubren los selectores móviles. No son pérdidas introducidas por V3; cualquier ampliación futura sería decisión del producto.
- No se reporta el uso de title si un wrapper lo transforma en el Tooltip compartido; no se cuentan presupuestos/registries como evidencia de fallo visual.

## Cobertura por ruta activa

Pass significa que no se detectó un nuevo defecto de fuente en el aspecto revisado; no significa certificación de navegador, native, red o audio.

| Ruta/familia                                                                                                                             | Cobertura                                                                                                                                            | Estado                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Shell, header, navegación desktop/móvil, Collection children, capas, player dock/expandido/fullscreen, queue/lyrics/EQ/output            | Fuentes, consumidores shared y tests; subreview independiente player. Fuente de progreso/RAF/motion, targets y capability gates.                     | Needs change L01/L02. Connect clearance condicionado, Jam dormido.                                       |
| `/`                                                                                                                                      | Home, hero/discovery rails, stream versionado, degraded polling, reads/cached/error, recomendados/replay/Upcoming adapters                           | Pass en fuente; no validación de audio ni SSE real.                                                      |
| `/home/section/:sectionId`                                                                                                               | Recents/mixes/suggested/upcoming/recommended/radio/favorites/essentials; header, MediaGrid, read retry y conversiones                                | Pass en fuente.                                                                                          |
| `/home/playlist/:playlistId`                                                                                                             | Hero, filtro, conversión de pistas, menú, compartir/radio y empty/error                                                                              | Needs change L11; contenido/acciones compartidas preservadas.                                            |
| `/explore` y `?genre=`, `?decade=`, `?playlistCategory=`                                                                                 | Landing/genre room/hero/related/shows/artists/albums, navegación que conserva query/hash, estados de read                                            | Pass en roles/primitivas/read; cap móvil histórico intencional y probado.                                |
| `/search`                                                                                                                                | Form vacío, URL/IME en global search, resultados por tipo, errores/retry y conservación de contenido                                                 | Needs change L07; diagnóstico mock.                                                                      |
| `/library`, `/collection`, `/collection/:section`                                                                                        | Seis tabs Artists/Crates/Playlists/Albums/Liked/Contributions, counts, filtros/sort, loading/error/empty, cards/menus/editors                        | Needs change L03–L06; shell y redirección Bandcamp preservan query/hash/state.                           |
| `/artists/:artistSlug`, `/catalog/artists/:globalArtistUid`                                                                              | Hero, follow/share/play adapters, top tracks, discografía, bio, shows/setlist, calidad por pista, canonicalización                                   | Pass en fuente del detalle; per-track quality y scopes correctos, sin imponer Admin sparse-icons.        |
| `/artists/:artistSlug/top-tracks`                                                                                                        | Identidad/artista/pistas, canonicalización, acciones/listado/tests                                                                                   | Needs change L06/L12.                                                                                    |
| `/artists/:artistSlug/:albumSlug`, `/artists/:artistSlug/albums/:albumSlug`, `/albums/:albumId/:slug`, `/catalog/albums/:globalAlbumUid` | Album data/selection/playback/actions/read errors, hero mobile/native, TrackRow y quality                                                            | Pass en fuente para estos aspectos; comparte conversiones/selección por identidad.                       |
| `/playlist/:id`                                                                                                                          | Hero, tracks/filtros, colaborar, editar/guardar/eliminar, permisos, offline, radio/share                                                             | Needs change L03/L04/L06; no mutaciones reales.                                                          |
| `/curation/playlist/:id`                                                                                                                 | Hero, filtro, follow/copy/radio/playlist/offline, estados de read                                                                                    | Pass en fuente; acciones/capacidades conservadas.                                                        |
| `/crate/:crateRef` auth/anonymous                                                                                                        | Coverflow/hero/cards, canonicalización, read/playback, owner/collaborator/follow/copy/download/offline, editor/members                               | Needs change L06; capas y artwork intencionales.                                                         |
| `/stats`, `/stats/global`, `/users/:username/stats`                                                                                      | Scope/period/month, dashboard pending0/cached/error/empty, Meter null vs0, headline, explorer/range identity, heatmap/decade instruments, affinities | Pass para criterios 1BE en fuente; no inventar Nivo para instrumentos aprobados.                         |
| `/stats/digging`                                                                                                                         | Story builder, period/owner/media/share adapter, scroll-lock compartido, keyboard/motion/hold y read states                                          | Pass en fuente actual; no compartir real.                                                                |
| `/upcoming`, `/shows` redirect y `?genre=`, `?show=`                                                                                     | Controller/model, fechas/filtros, featured/month groups, show cards/setlist/genre profile, read states                                               | Pass en fuente del flujo; settings ubicación L08 afecta sus preferencias.                                |
| `/paths`, `/paths/:id`                                                                                                                   | Endpoint search/debounce/error, crear/listar/borrar, Detail read/regenerate, cover journey, lista tracks                                             | Pass en fuente en aspectos revisados; operaciones sólo leídas, instrumento no penalizado por SVG/Canvas. |
| `/radio`                                                                                                                                 | Station rails, seeded/discovery, search identities/cancellation/error, start state/capabilities                                                      | Pass en fuente; no iniciar reproducción.                                                                 |
| `/people`, `/users/:username`, followers/following                                                                                       | Summary desconocido, search/error, profile/error404, afinidad/taste/library/network, follow y relaciones                                             | Pass en fuente; no escrituras sociales.                                                                  |
| `/settings` cinco tabs                                                                                                                   | Preferences/playback/account/connections/offline, leading rules1BD, hidden panels, forms/selects/switches, credentials/scrobble/Bandcamp/servers     | Needs change L08/L09/L10; capability/readOnly/busy gates offline Pass.                                   |
| `/bandcamp`                                                                                                                              | Status/read caching, purchases/radar/wishlist, EntityCard/EntityRow, guards y menús import/open, retry                                               | Pass en roles y1BD; no import/sync real.                                                                 |
| `/upload`                                                                                                                                | Drop target nativo, stage→explicit Import, empty/busy gates, direct/chunked, confirmed byte progress, receipts                                       | Pass en fuente1BD; no cargar archivos ni red.                                                            |
| `/offline`                                                                                                                               | Public guard, verified-only groups, local cover renderer, quality/duration, leaves de clock y navegación local                                       | Pass en fuente; no tocar almacenaje ni certificar filesystem native.                                     |
| `/login`, `/register`, `/auth/callback`, `/server-setup`                                                                                 | AuthFrame/Credentials forms, etiquetas/autocomplete, invite/probe/secure-session/deeplinks/status, errors                                            | Pass en fuente/contratos1BA; sin autenticación ni servidores nuevos.                                     |
| Legacy artist top-tracks, ArtistChildRoute y `/shows`                                                                                    | Compat/canonical redirects, orden de route-table, destino activo                                                                                     | Pass en fuente; no se cuentan como páginas nuevas.                                                       |
| `/jam`, `/jam/rooms/:roomId`, `/jam/invite/:token`                                                                                       | Tabla y gate revisados; fuentes lobby/room/invite y bypass lyrics considerado                                                                        | Not applicable como UI activa: gate false →Home.                                                         |

## Checklist resumido

| Criterio                                                            | Resultado                                                                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Jerarquía/contexto y tipografía ordinaria                           | Pass en composiciones recientes; Needs change ArtistTopTracks L12.                                        |
| Primitivas/roles, captions1BC, acciones de sección/context menus1BD | Pass en los consumidores inspeccionados; no se propone migración blanket ni variantes Admin.              |
| Datos desconocidos/0, loading/error/empty/cached                    | Needs change L06/L07; Stats1BE y OfflineDownloads conocidos/indeterminados Pass.                          |
| Comportamiento de filtros y persistencia                            | Needs change L03–L05/L08.                                                                                 |
| Teclado, foco y capas                                               | Needs change L01/L02/L09. L01 tiene prueba de browser raíz además del mock DOM.                           |
| Gestión offline y capacidades                                       | Capability/readOnly/unsupported/busy/verified-only Pass; eliminación global Needs change L10.             |
| i18n                                                                | Needs change L11; no se ejecutó i18n:check general.                                                       |
| Reduced motion y suscripciones de progreso                          | Pass de fuente en player, Stats y Digging; sólo leaves suscritas. No se certifica rendimiento real.       |
| Native/Tauri/Capacitor/remote providers                             | Not applicable a reproducción de este análisis; lectura de guards/capabilities y diferencias documentada. |

## Orden recomendado de corrección

1. L03–L05: conservar exactamente el contenido y el orden que el usuario ha editado o filtrado.
2. L01/L02/L09: cerrar y aislar correctamente capas y restaurar el foco al contexto activo.
3. L06–L08/L10: distinguir errores, conservar identidad de consultas y recuperar preferencias; dar contexto a la eliminación global de copias offline.
4. L11/L12: completar i18n y normalizar ArtistTopTracks con los componentes actuales.

Cada corrección debe incorporar la regresión correspondiente y una comprobación visual en el contexto afectado. Los seis diagnósticos temporales de este informe reproducen defectos; no reemplazan esos tests de corrección. Este documento y el [informe de Admin](/home/diego/.codex/worktrees/crate-v3-1q/crate/docs/plans/crate-v3-analysis/2026-10-24-admin-ui-review.md) mantienen alcances y findings separados.
