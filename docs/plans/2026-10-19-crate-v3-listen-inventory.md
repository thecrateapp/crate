# Crate V3 — inventario para priorizar Listen

Fecha: 2026-10-19. Estado: **análisis y propuesta; no implementación ni aprobación de nuevos checkpoints**.

Diego pide terminar primero Listen V3 y después continuar Admin. Este inventario cubre la UI que
Listen monta realmente, las bases compartidas que usa y la cobertura de producto que todavía
exige el plan. El [plan de ejecución](2026-10-19-crate-v3-listen-implementation-plan.md) distingue
un primer recorrido usable de la cobertura completa; ninguno equivale por sí solo a una release.

## 1. Foto de partida y método

- Workspace inspeccionado: `/home/diego/.codex/worktrees/crate-v3-1q/crate`, `feat/crate_v3`.
  Base publicada **1AT `67486e4c7414d7c6bca7a6701b35c73440f0dfce`**. Se incluyen las fuentes locales
  de **1AU en revisión, sin commit** para no proponer duplicados de cabeceras ya preparados.
- Autoridad: [estado vigente](2026-10-19-crate-v3-current-state.md), ajustes confirmados de Diego
  al mockup aprobado en 5186, [sistema de diseño](2026-10-14-crate-v3-design-system.md),
  [producto](2026-10-14-crate-v3-product-design.md) y registros finales de los
  [handovers](2026-10-16-crate-v3-linux-handover.md). Se conserva `app/web@258bbaee` como pin
  histórico; no se usa `vnext`. Los antiguos stops locales no revierten publicaciones posteriores.
- Inspección de rutas, imports de producción, componentes, recetas CSS, contratos y pruebas
  existentes. Los apéndices conservan el censo de subpaths y módulos visuales para que una familia
  secundaria no desaparezca del mapa por no figurar en el primer corte.
- **Documentado** significa ficha/escena en catálogo; **implementado** significa código existente;
  **adoptado** significa consumidor real identificado; **validado** exige evidencia del contrato y
  consumidor concreto. No son sinónimos. Una ficha `pending` no significa componente inexistente.
- Catálogo local inspeccionado: **93 entradas, 33 documentadas y 60 pendientes**. Cinco de las
  documentadas pertenecen a 1AU todavía pendiente de aprobación. La guarda de exports combina
  imports de Listen **o** Admin: no demuestra doble adopción. Los recuentos del apéndice son
  imports literales por archivo, no instancias, alcance de ejecución ni adopción semántica.
- Este análisis **no ejecuta tests, builds, backend, navegador ni QA nativa**. Los resultados
  históricos de 1AU (Listen **200109/307200 B gzip**, Admin **527180/532480 B**) se citan desde el
  estado vigente; no se vuelven a certificar. Las 33 capturas y manifest canónicos siguen en 1M.

## 2. Qué necesitamos para construir Listen sin más drift

La mayor parte del kit ya existe. El problema principal es cerrar sus contratos y adoptarlos,
no abrir otro paquete de primitivas ni convertir cada pantalla en una tarjeta universal.

| Capa / familia | Base existente y estado | Consumidor Listen real | Trabajo mínimo pendiente |
| --- | --- | --- | --- |
| Identidad, fuentes y tokens | `tokens`, iconos Solar, `crate-identity`, preferencias; documentado parcial | [main](../../app/listen/src/main.tsx), [CSS](../../app/listen/src/index.css) | Un solo lenguaje. Poppins web y excepciones nativas existentes; Bricolage para roles display, Mono400 uppercase en labels. Clasificar cada blur/gradiente: cromado heredado frente a efecto de contenido/playback aprobado. |
| Labels, valores y metadatos | MonoLabel, Readout, StatNumber, StatusDot documentados; Meter/ProgressHairline implementados, ficha pendiente | [SettingsPrimitives](../../app/listen/src/components/settings/SettingsPrimitives.tsx), [OfflineSection](../../app/listen/src/components/settings/OfflineSection.tsx), [ShowsContent](../../app/listen/src/pages/ShowsContent.tsx) | Adoptar por rol, sin convertir cada cifra en StatNumber. Evitar `StatBox` y labels manuales como nuevas bases. Dato ausente distinto de 0; fecha/unidad/porcentaje no son labels. |
| Formularios | Familia 1AR documentada: FormField, Input, Textarea, SearchInput, Select/AdminSelect, Checkbox, Switch, RadioGroup, Slider y controles de elección | [AccountSectionForms](../../app/listen/src/components/settings/AccountSectionForms.tsx), [CrateForm](../../app/listen/src/components/crates/CrateForm.tsx), Login/Register | Stacked 8 px reales mediante FormField/receta, mismos labels en inline; estados/refs/fieldset preservados. Elegir Select para campos de una elección, mantener filtros/toggles en su rol; no confundir el seek/EQ con Slider general. |
| Badges, filtros, géneros | InfoBadge, FilterChip, SegmentedControl, GenrePill documentados; compatibilidad explícita | [TrackRow](../../app/listen/src/components/cards/TrackRow.tsx), [QualityBadge](../../app/listen/src/components/player/bar/QualityBadge.tsx), AlbumHero y tarjetas | InfoBadge 24 px / Mono12; filtros/GenrePill 32 fine y 44 coarse. Mantener %/procedencia de GenrePill, quality y contador de cola con sus roles. Quitar overrides por consumidor cuando rehacen esos roles. |
| Acciones convencionales | Button/IconButton/ActionGroup documentados 1AS; ActionIconButton compatibilidad | [ServersSection](../../app/listen/src/components/settings/ServersSection.tsx), modales, tarjetas | Converger controles equivalentes, tooltips y 44 px táctiles. Preload `onPrepare`, enlaces, unavailable/busy y gates no se pierden. Bot Solar en las acciones AI aprobadas; ningún borrado global de iconos de Listen. |
| Superficies | Card/InstrumentPanel/Separator documentados 1AT | [Settings Section](../../app/listen/src/components/settings/SettingsPrimitives.tsx) | Panel abierto para secciones; Card sólida para objetos. Chrome con fade en lugar de blur, overlays con superficie y elevación propias. No transformar artwork ni aura de reproducción en paneles. |
| Cabeceras | PageHeader/Layout, SectionHeader, PageHero, HeroActionBar, BackLink; documentadas **local 1AU** | [AlbumHero](../../app/listen/src/components/album/AlbumHero.tsx), [CratePageHeader](../../app/listen/src/components/crates/CratePageHeader.tsx), Settings | Revisar 1AU antes de publicarlo. Después adoptar tamaño/slots ya aprobados; no resetear heroes o nativo. Acción superior derecha y back fuera de la identidad. |
| Imagen e identidad | MediaCover, Avatar, EntityAvatar, PlaylistArtwork y logos implementados; ficha pendiente | [AlbumCardParts](../../app/listen/src/components/cards/AlbumCardParts.tsx), [UserAvatar](../../app/listen/src/components/social/UserAvatar.tsx), [PlaylistArtwork local](../../app/listen/src/components/playlists/PlaylistArtwork.tsx) | Primer grupo propuesto: contratos de tamaño/forma/fallback y adaptador de imagen inyectable. Preservar CrateImage/ArtworkSurface, autenticación, tickets, retry, ready anterior, srcSet y carga diferida. |
| Fila y tarjeta de entidad | EntityRow, EntityCard, EntityPrimaryAction/useEntityMenu implementados; fichas pendientes | [AlbumCard](../../app/listen/src/components/cards/AlbumCard.tsx), [ArtistCard](../../app/listen/src/components/cards/ArtistCard.tsx), [PlaylistCard](../../app/listen/src/components/playlists/PlaylistCard.tsx), [UserRow](../../app/listen/src/components/social/UserRow.tsx) | Anatomía común con variantes finitas, enlaces/menú/acción separados, título/subtítulo/badges debajo y metadata legible. Mantener persona circular y obra cuadrada. No universalizar fila de show, track, persona y entidad. |
| Pistas y colecciones | HairlineRow documentado; TrackList, MediaGrid/Rail implementados, fichas pendientes | [AlbumTrackList](../../app/listen/src/components/album/AlbumTrackList.tsx), [PlaylistTrackList](../../app/listen/src/components/playlists/PlaylistTrackList.tsx), TrackRow y cola | Ritmo/estado activo/selección, grid/lista/rail y virtualización se documentan como contratos distintos. TrackList tiene umbral de virtualización; preservar drag, orden, selección y contexto de playback. |
| Eventos y fecha | Varias implementaciones locales; EventRow/CalendarDate común es propuesta | [ReleaseRow](../../app/listen/src/components/upcoming/ReleaseRow.tsx), [UpcomingShowCollapsedView](../../app/listen/src/components/upcoming/UpcomingShowCollapsedView.tsx) | Show conserva expansión/info; release converge a su anatomía, avatar y fila de badges. Fecha civil/locale/fallback compartidos. Geometría final de fecha requiere decisión, no copiar otro override. |
| Estados y reserva | LoadingState/EmptyState/ErrorState/Boundary, Skeleton y loaders implementados; fichas pendientes | [AppFallbacks](../../app/listen/src/app-shell/AppFallbacks.tsx), Home, Search, Library, CuratedPlaylist | Recuperar contratos 1R: demora de ruta, reserva real, retry, vacío de filtro/colección y offline. No inventar 0 durante carga ni spinner para todo. |
| Capas, menús y ayuda | AppModal, ConfirmDialog, AppPopover, Sheet/Dialog/Tooltip y menús existentes; fichas pendientes | [ItemActionMenu wrapper](../../app/listen/src/components/actions/ItemActionMenu.tsx), [entity-menu](../../app/listen/src/components/actions/entity-menu.tsx), formularios y player | Foco, Escape, portal único/gobernado, scroll lock, menú→sheet coarse, long press y regreso al trigger. Probar Select dentro de modal y popovers sobre player, sin subir z-index localmente. |
| Navegación y búsqueda | SkipLink/VtNavLink/Tabs/SearchBar/FilterBar implementados; fichas pendientes | Shell, [TopBarSearch](../../app/listen/src/components/layout/topbar/TopBarSearch.tsx), Library | Tabs de panel con subrayado 2 px, helper URL propio Listen. SearchInput es base; búsqueda con resultados/recientes sigue adaptador local. Conservar IME, debounce, historial, selección y navegación. |
| Reproducción especializada | PlayButton, FollowHeartButton y EqBands shared; bar/seek/queue/visualizer locales | [TrackRowPlaybackControl](../../app/listen/src/components/cards/TrackRowPlaybackControl.tsx), [PlayerSeekBar](../../app/listen/src/components/player/bar/PlayerSeekBar.tsx), Fullscreen/Extended | Preservar esencia del play, ring, aura y continuidad haz/punto aprobados. Eliminar chrome heredado, no efectos de contenido legítimos. Separar progreso, estado y acciones para evitar renders globales por tick. |
| Instrumentos de producto | Stats, EQ, Paths, Radio, shows; varios componentes locales actuales | Carpetas stats/player/upcoming, páginas Explore/Paths/Radio | Base local hasta segundo uso real. No añadir MoodMap, wheel, ruta o deck con datos ficticios. Respetar Nivo para charts estadísticos e instrumentos manuales cuando corresponde. |

**Colocación:** se modifica la base compartida existente; un módulo nuevo entra en `@crate/ui`
solo con dos consumidores reales Admin/Listen o una excepción de fundamento explícita y
justificada. Un instrumento específico de Listen permanece local. El requisito de mantener
compatibilidad Admin no obliga a migrar sus páginas ahora.

## 3. Cobertura por rutas y superficies reales

Fuente: [route-table](../../app/listen/src/app-shell/route-table.tsx). Cada fila es una unidad de
adopción y aceptación; los alias no añaden pantallas. Los archivos auxiliares de cada grupo están
en el apéndice de módulos. Todas las filas requieren desktop/mobile y estados de datos.

| ID | Ruta / entrada real | Composición y contratos que hay que cubrir | Primer corte / resto |
| --- | --- | --- | --- |
| R01 | `/` | [HomeContent](../../app/listen/src/pages/HomeContent.tsx), heroes canonical/discovery/legacy, rails Album/Artist/Playlist, recientes, replay, Radio y upcoming. Loading/error/cache, pull-to-refresh, track activo; no sumar versiones de hero como tres features. | Home funcional y sus rails existentes tras el recorrido básico; DNA se incorpora con datos existentes y contrato válido. |
| R02 | `/explore` + `?genre=`, `?decade=`, `?playlistCategory=` | [Explore](../../app/listen/src/pages/Explore.tsx), landing, GenreDetailHero/Sections, tiles, listas de década/categoría, búsqueda y volver. Query state conserva parámetros ajenos y hash. | Migrar browse existente; mood map/wheel son ampliaciones separadas. |
| R03 | `/search?q=` y dropdown TopBar | [SearchResults](../../app/listen/src/pages/SearchResults.tsx), grupos Artist/Album/Track, recientes/local/global, match, selección por teclado, pending/no query/no results/error. ArtistSuggestionModal y remote import son workflows propios. | Esencial para encontrar y reproducir; no sustituir por un SearchInput vacío. |
| R04 | `/library`, `/collection`, `/collection/:section` | [Library](../../app/listen/src/pages/Library.tsx): artists/crates/playlists/albums/liked/bandcamp/contributions, contadores, orden, view modes, filtros, refresh, vacío por pestaña. `?tab=` y path tab son adaptadores distintos. | Artists/albums/liked y navegación en el primer recorrido; ningún tab desaparece de la cobertura posterior. |
| R05 | `/artists/:artistSlug` y `/catalog/artists/:globalArtistUid` | [ArtistContent](../../app/listen/src/pages/ArtistContent.tsx), ArtistHeroSection, bio y modal, álbumes locales/globales, top tracks, comunidad y setlists. Missing photo/bio, catálogo sin copia local, follow/import/gates. | Identidad + álbumes + tracks/follow primero; todo el perfil después. |
| R06 | `/artists/:artistSlug/top-tracks`; legacy `/artists/:artistId/:legacySlug/top-tracks` | [ArtistTopTracks](../../app/listen/src/pages/ArtistTopTracks.tsx), TrackList y back; legacy usa [LibraryRouteCompat](../../app/listen/src/app-shell/LibraryRouteCompat.tsx). | Se prueba como consumidor de pistas, sin una página nueva para el redirect. |
| R07 | `/albums/:albumId/:slug`, `/catalog/albums/:globalAlbumUid`; `/artists/:artistSlug/:albumSlug` y `/artists/:artistSlug/albums/:albumSlug` | [AlbumContent](../../app/listen/src/pages/AlbumContent.tsx), hero, acciones, contributor, countdown, selección, track list, notices, menú. ArtistChildRoute resuelve formas legacy/locales. | Núcleo del primer recorrido; conservar helpers de rutas, remoto/pre-release/no playable/offline. |
| R08 | `/playlist/:id` | [PlaylistContent](../../app/listen/src/pages/PlaylistContent.tsx), header/artwork, filtro, tracks, owner/collaborator, create/edit/delete, drag, buscar/añadir, import y descarga. | Primera adopción de colección después de Album; permisos y payloads intactos. |
| R09 | `/curation/playlist/:id`, `/home/playlist/:playlistId` | [CuratedPlaylistContent](../../app/listen/src/pages/CuratedPlaylistContent.tsx), [HomePlaylist](../../app/listen/src/pages/HomePlaylist.tsx), mismo vocabulario de playlist, artwork editorial/mix/core tracks; acciones y fuente propias. | Mismo kit que R08, wrappers de datos conservados; no integrar Smart Mix. |
| R10 | `/home/section/:sectionId` | [HomeSection](../../app/listen/src/pages/HomeSection.tsx): agrupación paginada de Album/Artist/Track, header/back, loading/error. | Consumidor real de cards/rows y navegación, no otra familia de card. |
| R11 | Tab crates de Library y `/crate/:crateRef` | [Crates](../../app/listen/src/pages/Crates.tsx), [Crate](../../app/listen/src/pages/Crate.tsx), CrateCard/Create/Editor/AlbumPicker/Form, CoverFlow, members/follow, orden y ZIP. No hay `/crates` independiente en route-table. | Kit de colecciones; conservar CoverFlow y drag, estados vacía/privada/colaborativa/permisos. |
| R12 | `/upcoming`, `/shows` → redirect | [ShowsContent](../../app/listen/src/pages/ShowsContent.tsx), filtros/date sections, ReleaseRow, show cerrado/expandido, attendance, lineup, setlist prep y menú. | Familia eventos/fecha, manteniendo show desplegable aprobado. |
| R13 | `/radio` | [Radio](../../app/listen/src/pages/Radio.tsx), RadioHero, StationCard/Rail, session status, seed search y acciones. Descubrimiento no disponible, start pending/error, remoto activo. | Restyle del flujo actual primero; Sound map/explicación necesitan contrato de datos aparte. |
| R14 | `/paths`, `/paths/:id` | [Paths](../../app/listen/src/pages/Paths.tsx), EndpointPanel, PathRow, generación, sliders, [PathDetail](../../app/listen/src/pages/PathDetail.tsx), tracks/regen/delete. | Restyle funcional sin bloquear por el RouteMap futuro ni dibujar trayectorias sintéticas. |
| R15 | `/stats`, `/stats/global`, `/users/:username/stats` | [Stats](../../app/listen/src/pages/Stats.tsx), periodo, headlines, señal/heatmap, artistas/álbumes/tracks/listeners, géneros, perfil, discoveries/affinity. Datos propios/global/ajenos, privacidad/muestra pequeña, 0 vs ausencia. | Cobertura completa después del recorrido de escucha; heatmap depende del contrato horario real. |
| R16 | `/stats/digging` | [StatsDigging](../../app/listen/src/pages/StatsDigging.tsx), historia Digging, artwork, contadores/cierre, reveal reduced motion. | Familia editorial propia; no convertirla en el dashboard o card genérica. |
| R17 | `/people`, `/users/:username`, `/users/:username/followers`, `/users/:username/following` | [PeopleContent](../../app/listen/src/pages/PeopleContent.tsx), UserProfile/hero/taste/network/library/match, UserConnections, UserRow, hover card, follow y colaboradores. | Reutilizar identidad de persona, métricas y rows, preservando privacidad/relaciones propias. |
| R18 | `/settings` | [Settings](../../app/listen/src/pages/Settings.tsx): Account/profile/pulse/timezone, Playback, offline, language, interface, servers, Bandcamp, scrobble, shows location, sleep timer, OpenSubsonic, links; ConnectDevices montado dentro de Account. | Campos/acciones ya disponibles; Devices top-level es evolución de producto separada, Access tokens depende de su integración futura. |
| R19 | `/bandcamp` y tab Bandcamp de Collection | [Bandcamp](../../app/listen/src/pages/Bandcamp.tsx), BandcampItem/Cover/Actions, compras/imports, sync/support, permisos y conexión. | Import y provenance conservados; progreso real, sin rail de fases inventado. |
| R20 | `/upload` y Contributions tab | [Upload](../../app/listen/src/pages/Upload.tsx), file/chunk progress, validación/error/cancel y respuesta task; LibraryContributionsTab export/withdraw. | Restyle + fases solo si el task las emite. Un input file nativo es excepción funcional, no deuda a reemplazar por Input text. |
| R21 | `/server-setup`, `/login`, `/register`, `/auth/callback` | [PublicShell](../../app/listen/src/app-shell/PublicShell.tsx), ServerSetup, Login/Register, OAuthButtons, callback y server probe. Cookie web frente a sesión segura por servidor Capacitor/Tauri. | Acceso real dentro del primer recorrido; no modificar autenticación para igualar capturas. |
| R22 | `/offline` | [OfflineAccessRoute](../../app/listen/src/app-shell/OfflineAccessRoute.tsx) monta [OfflineLibrary](../../app/listen/src/pages/OfflineLibrary.tsx) solo con identidad offline sin sesión online; providers propios de player/offline. Si hay user redirige `/`; si no hay identidad offline, `/login`. | Estado de red y biblioteca preparada deben probarse; no es simplemente un tab más de Library. |
| R23 | `/jam`, `/jam/rooms/:roomId`, `/jam/invite/:token`; fallback `jam/*` | [feature-flags](../../app/listen/src/app-shell/feature-flags.ts) fija `JAM_ROOMS_ENABLED=false`; JamSession/Invite y componentes existen, pero las rutas activas redirigen `/`. | Inventariado, **no activado ni requisito del primer corte**. Compatibilidad de shared consumidores sí se preserva. |
| R24 | Overlays persistentes sin ruta | PlayerBar, fullscreen/extended, queue, lyrics, EQ, output/Connect/Cast, continue prompt, sleep timer; todos pueden montarse sobre cualquier página. | Parte esencial de la experiencia, no se certifican al aprobar Album. |
| R25 | Herramientas y plataforma sin ruta propia | TranslationOverlay, Toaster/Boundary, PWA/service worker, media session, permisos/reanudación, LinuxWindowTitlebar y panel dev Tauri. | Clasificar producción frente a dev; conservar funcionalidad e i18n. Pruebas nativas separadas. |

## 4. Inventario de reproducción y servicios que no deben perderse

| Subfamilia | Implementación real | Contrato a preservar / cerrar |
| --- | --- | --- |
| Transport local | [PlayerBar](../../app/listen/src/components/player/PlayerBar.tsx), bar/transport, SpectrumPlayButton y SpinningDiscPlayer | Play/pause, previous/next, buffering, repeat/shuffle, touch gestures; play con esencia/ring/aura aprobados. Cualquier reducción estética conserva estado y feedback. |
| Seek/volume | [PlayerSeekBar](../../app/listen/src/components/player/bar/PlayerSeekBar.tsx), PlayerSeekBarVariants, PlayerProgressBeam, seek model; PlayerVolumeControl/Slider | Mismo borde para haz/punto en drag y reproducción, tamaño aprobado, clamp/0/NaN/duración desconocida, teclado, 44 px target sin engordar el trazo. Volume y seek no son el mismo contrato. |
| Composición player | [lazy-player-surfaces](../../app/listen/src/components/player/lazy-player-surfaces.tsx), FullscreenPlayer*, ExtendedPlayer* y controles | Lazy boundaries, preload al focus/hover, close/restore focus, safe areas, controles con estado expanded; no importar EqBands/visualizer en el eager chunk para una story. |
| Cola | QueuePanel, QueueTrackRow, extended/QueueTab*, SuggestedTab y FullscreenPlayerTabs | Pasadas/actual/próximas, quitar/reordenar/sugeridas, duración/fuente, repetidas con keys correctas, queue lock de Jam aunque gate esté apagado. La fila de cola no se fuerza a EntityRow. |
| EQ | [EqualizerPanelSections](../../app/listen/src/components/player/EqualizerPanelSections.tsx), EqualizerPopover, Smart/AdaptiveReadouts, hooks/use-equalizer* | EqBands shared y controles especializados, modos/smart/preset/manual, remote/off/unavailable. Glyph/live store/chain son trabajos previstos, no implementados por documentar el panel. |
| Lyrics/info | LyricsPanel; extended/LyricsTab/LyricsLine/InfoTab* | Sincronización y texto largo, unavailable/plain/synced, progreso en leaf; quality/análisis/provenance con dato real. Mantener división de contextos de progreso/estado/acciones. |
| Salida y remoto | [PlaybackTargetMenu](../../app/listen/src/components/player/PlaybackTargetMenu.tsx), ConnectDevicesSection; contexts/use-player-connect* y lib/playback-target-* | Local/Cast/Connect/native son targets diferentes; states connecting/lost/locked/remote, volumen/seek permitidos, handoff/reanudación. No fingir control local del audio remoto. |
| Offline/download | OfflineContext, lib/offline-*, componentes download/task y OfflineLibrary | Ready/downloading/failed/evicted, cuota/bytes, cancel/retry, biblioteca offline-only, playback de archivos locales, resumen de task ZIP. Compartir presentación sin mover storage a shared UI. |
| Visualizer/analysed state | visualizer/*, WaveformCanvas, SpectrumPlayButton, [SpectrumRibbonCanvas](../../app/listen/src/components/player/SpectrumRibbonCanvas.tsx) | Efectos y reduced motion, hidden/off, sin analyser en pipeline móvil estable. El plan retira SpectrumRibbonCanvas (PD47), pero el archivo sigue presente: comprobar imports antes de retirarlo, no declarar la limpieza hecha. |
| Continuidad / tiempo | ContinuePlaybackPrompt, SleepTimerSection, crossfade hooks, player smart transition | Reanudar dispositivo/posición reales, cancelación/timer, progreso CSS/ref. Smart Mix/decks no se integran en este giro; flujo actual sigue funcionando. |

## 5. Desviaciones confirmadas por fuente y disposición

Los candidatos tipográficos necesitan además estilos calculados: la existencia de una clase no
prueba por sí sola el tamaño final. Estos hallazgos sí identifican recetas o comportamientos
concretos que contradicen el contrato o lo rehacen fuera de la base.

| ID | Evidencia | Disposición propuesta |
| --- | --- | --- |
| D01 | [Shell](../../app/listen/src/components/layout/Shell.tsx), DesktopShell y MobileShell conservan `backdrop-blur-xl`, `shadow-chrome` y `listen-glass-panel`; [index.css](../../app/listen/src/index.css) define blur24 y variantes dock. | Sustituir chrome por receta sólida/fade según referencia. Separar scrim necesario sobre hero de blur decorativo. No tocar la paleta extraída de artwork ni la aura aprobada del play. |
| D02 | [MobileBottomNav](../../app/listen/src/components/layout/MobileBottomNav.tsx) aplica drop-shadow/hover lift y texto local `0.59375rem`; usa dock redondeado. | Reconciliar contra referencia de nav, active line y safe areas. El tamaño móvil de label exige revisión explícita si no cumple legibilidad; no copiar su cifra al catálogo como verdad. |
| D03 | [Library](../../app/listen/src/pages/Library.tsx) rehace tamaño/fondo/estado de SegmentedControl mediante constantes; `setSearchParams({ tab })` sustituye el resto de query. [ExtendedPlayerTabs](../../app/listen/src/components/player/ExtendedPlayerTabs.tsx) rehace tonal tabs y tipografía por `itemClassName`. | Adoptar Tabs donde hay panel real y el helper Listen de URL en Library, con adaptador path para Collection; mantener otros params/hash/history y unknown fallback. Player tabs conservan estado local si no pertenecen a URL. |
| D04 | [CollectionSortDropdown](../../app/listen/src/pages/LibraryCollectionSortDropdown.tsx) construye button/listbox/options, dismiss y glass local. | Migrar selección de orden al Select compartido manteniendo label/valores; teclado/portal/overflow de consumidor. No crear otro dropdown visual. |
| D05 | [PlayerBarActionIconButton](../../app/listen/src/components/player/bar/PlayerBarActionIconButton.tsx) es button nativo con padding/lift/glow; [QueuePanel](../../app/listen/src/components/player/QueuePanel.tsx) corrige IconButton por `size-10`, cancelación de lift/drop-shadow y glyph `size-6`. | Convertir wrapper a adaptador de controles aprobados; preservar `onPrepare` y semántica expanded. Tamaños equivalentes no se reparan en callers. Playback especializado sigue separado. |
| D06 | [ReleaseRow](../../app/listen/src/components/upcoming/ReleaseRow.tsx) usa EntityRow con artwork64, title override `text-base font-extrabold`, fecha como tag icon+texto y countdown en caja; show cerrado tiene imagen88 y fecha local tres líneas. | Event row/date común con show expandible intacto. Fecha/avatar/badges y acciones son un contrato del grupo, no cuatro parches por página. |
| D07 | [ArtistCard](../../app/listen/src/components/cards/ArtistCard.tsx) define arrays de anchuras/max-width para variantes rail/grid; EntityCard y EntityRow exponen `classNames` para tipografía/estructura, menú y artwork. | No todos los overrides son errores: tamaños de editorial/perfil pueden ser variantes legítimas. Medir cada caso, trasladar los repetidos de anatomía al componente y retirar solo los que sustituyen su contrato. |
| D08 | [LibraryPrimitives.StatBox](../../app/listen/src/pages/LibraryPrimitives.tsx) dibuja número+label y caja propios. Settings ToggleRow conserva texto `text-sm font-medium` sin MonoLabel/FormField. | Adoptar el rol compartido correcto; StatStrip solo si se usa realmente en ambas apps. Toggle/label se reconcilia con la regla confirmada de label, sin transformar descripción en mayúsculas. |
| D09 | [use-audio-visualizer](../../app/listen/src/hooks/use-audio-visualizer.ts) llama setFrequenciesDb/setWaveform en su tick; [use-crossfade-progress](../../app/listen/src/hooks/use-crossfade-progress.ts) setProgress en rAF. | B24 sigue siendo trabajo real: ref-backed data/clock con suscripciones pequeñas; pruebas de renders y un solo loop. No reescribir motores por el restyle ni mezclar Smart Mix. |
| D10 | Campos scalar visibility/ordering en [CrateForm](../../app/listen/src/components/crates/CrateForm.tsx) y privacy/visibility en [PlaylistIdentitySection](../../app/listen/src/components/playlists/PlaylistIdentitySection.tsx) siguen en SegmentedControl; Paths conserva range nativo general. | Aplicar regla de Select en campos de elección y Slider general donde no sea un instrumento. Conservar filtros/mode toggles. Revisar alcance de reglas de input file y traducción, sin barrido ciego de controles nativos. |
| D11 | ArtworkSurface/CrateImage gestionan tickets/reintentos, mientras MediaCover resuelve src/fallback dentro de shared. | Diferencia funcional legítima, no duplicado que borrar. Contrato de render de imagen inyectable o adapter conserva el lifecycle local. Añadir pruebas de credenciales/fallback al adoptar. |
| D12 | Fichas documentadas de bases no equivalen a restyle de todos los callers; el [audit](2026-10-19-crate-v3-component-reconciliation-audit.md) y [grupo propuesto](2026-10-19-crate-v3-component-checkpoint-groups.md) registran adopción incompleta. | Cada checkpoint lista componentes base, callers reemplazados y residuos con dueño. No ampliar ceilings ni marcar familias completas por pasar guardas léxicas. |

## 6. Datos, gates y decisiones que no resuelve un restyle

| Capacidad | Disponible / dependencia real | Tratamiento para Listen primero |
| --- | --- | --- |
| Recorrido biblioteca→audio | APIs/runtimes actuales; streaming/covers autenticados y offline existen | Construir sobre contratos actuales, mocks para review y prueba real separada; no suponer que localhost previews tienen backend. |
| EQ glyph/chain/genre walk | Task4.3/4.5 y2.19; no se encontró EqGlyph/equalizer-live-store en `src`. `use-track-genre` aún tiene cache local. | Live store/glyph pueden empezar con ganancias reales del engine. Chain/walk solo con campos válidos; servidor antiguo conserva readout actual. Auditar contrato y backend antes del lote, sin inferir disponibilidad por un tipo futuro en el plan. |
| DNA/heatmap/timezone | Stats/Home ya obtienen dashboard; actual StatsHeatmapCard no implementa todo Task4.6 | Mostrar solo datos reales, probar DST/offsets, privacidad y muestra pequeña; no añadir fetch móvil de Home para rellenar un tile. |
| SetlistTicket | Ticket compartido planeado Task4.7b depende de `in_library`/match Task4.7a | Show/setlist actual sigue usable. No iluminar canciones como disponibles sin confirmación de backend. |
| MoodMap | Browse moods existe; snapshot/pools/mood map son Task4.8a/b | Migrar browse existente antes; mapa no usa puntos inventados ni confunde un contador mood con coordenadas de análisis. |
| Paths RouteMap | POST/detail actual existe; plan/task/meta y transiciones son Task4.9a/b y5.11 | Conservar flujo actual; mapa/lineas esperan plan_meta y relaciones reales. |
| Radio Sound map | Stations/search/session existen; explain/bliss map Task4.10a/b | Restyle actual no se bloquea. Gráfico y explicaciones se incorporan con capacidades/payloads reales. Debounce300 y protección de respuestas obsoletas se conservan. |
| Genre wheel | Task5.10 depende de runtime graph/snapshot de Genres | Género actual primero; no copiar wheel de marketing ni traer overrides Admin a Listen. |
| Devices | ConnectDevicesSection existe; contrato ampliado/capability/WS de Task5.9 no está certificado aquí | Mantener controles existentes y build flag; glyphs/checkpoints solo cuando servidor/target lo permiten. |
| Access tokens / Smart Mix | Dependencia explícita de merge/integración futura en el plan original | No integrar ni rebase. No cambiar secuencia de release conjunta por priorizar trabajo visual Listen. Registrar como fuera del corte actual. |
| Upload/download phases | El task puede devolver estado/progreso; no todo handler emite secuencia completa | Rail solo con fases emitidas y task asociado, percent solo con total válido; nunca un reloj sintético que parezca progreso real. |
| Jam | `JAM_ROOMS_ENABLED=false` | Mantener gate; compatibilidad de componentes al cambiar shared. Activarlo necesita alcance de producto propio. |

Decisiones verdaderamente visuales que requieren resolver con Diego antes de cambiar la referencia:

1. Fecha común show/release: formato tres líneas confirmado; **10/24/10 y columna48** eran una
   propuesta del roadmap, no una aprobación de sus tamaños para todas las variantes.
2. Variantes de EntityRow/Card: qué casos compacto/editorial/persona son intencionados. Presentar
   mismo dato en los casos reales, no eliminar todas las diferencias por nombre de componente.
3. Conflictos reales de legibilidad/mobile: labels de bottom nav, títulos largos, controles
   sobre cover pequeño y heroes nativos. HairlineRow ya tiene decisión **12/18 también móvil** y
   no se reabre sin motivo. Ninguna duda autoriza elegir silenciosamente otro tamaño.
4. Identidad/imagen de show/release: mantener show expandible; avatar y badges inferiores
   comunes según la última dirección. Una adaptación de imagen no borra lifecycle autenticado.

## 7. Matriz de estados obligatoria por familia

No se exige que cada estado sea visible en cada página. Se indica «no aplica» con motivo cuando
el contrato no lo permite; las muestras no inventan estados para completar una cuadrícula.

| Familia | Datos/negocio | Interacción y plataforma |
| --- | --- | --- |
| Page/section | loading inicial, warm/stale/reconnect si la API los expone, vacío, error con retry, dato anterior | foco al navegar/back, hash/query/history, heading hierarchy y landmarks |
| Row/card/rail/grid | 0/1/muchos, texto largo/no espacios/no-Latin, imagen loading/error/missing, badges 0/varios, local/global/pre-release | link vs play vs menu, selected vs current/active, sin fondo hover en rows, teclado/coarse, overflow/virtualización/drag |
| Form/control | default/filled/empty/readonly/disabled/invalid/required/indeterminate cuando aplique, fieldset | mismo label,8px stacked,40/44 y minimum44coarse, IME, keyboard, ref, hint/error id y opciones largas |
| Overlay/menu | empty/no actions, pending/destructive/unavailable, nested selector y tooltip | portal/z-index, focus trap/restore, Escape ordenado, outside click, scroll lock, touch long press y safe area |
| Player/audio | no track, buffer, playing/paused/end/error, duration0/unknown, seek drag, repeated queue items, remote/offline | reduced effects/motion, visibility suspend, progress leaf, key controls, dot/beam, analyser disponible/ausente |
| Offline/transfer | none/queued/downloading/ready/failed/cancelled/evicted, cuota/bytes ausentes | network loss/reconnect, sesión offline, retomado, cancel/retry, target local nativo |
| Responsive/a11y |390/768/1440 como targets focalizados y375 donde hay contrato previo | fine/coarse,44px reales, zoom/text expansion, reduced-motion/effects, forced-colors, foco visible,7locales y nombres accesibles. AT y motores nativos requieren validación propia. |

## 8. Qué se aplaza en Admin

Se aplazan migraciones y rediseños específicos de páginas Admin, retirada de sus iconos restantes
y sus instrumentos A5/3.x/6.x. Se conservan checkpoints, rutas, payloads, permisos y adaptadores.
Cada cambio shared sigue comprobando sus consumidores Admin afectados y el límite de bundle:
priorizar Listen no permite romperlos. No se exige llevar toda la página Admin al nuevo patrón
para justificar una ficha shared ya existente.

Los apéndices siguientes son evidencia de censo, **no aprobación de todos los componentes ni
una tarea de migrar todos los imports en un único commit**.

## Apéndice A — imports shared de producción observados

Censo estático del working tree1AU. Se excluyen `.test.*`/`.spec.*`. Cada número es archivos
con el subpath literal; un barrel puede exportar varias piezas y una pieza puede llegar por
reexport. No se infiere el consumo de una pieza a partir del barrel ni se cuentan instancias.
`0` significa sin import literal de ese subpath en esa app, no ausencia de dependencia transitiva.
No incluye imports CSS `@import` ni módulos shared/web por ruta relativa; esos tienen su mapa
funcional en los AGENTS y no son componentes visuales que haya que migrar.

| Subpath | Archivos Listen | Archivos Admin | Ejemplo real Listen |
| --- | ---: | ---: | --- |
| `@crate/ui/composites/ConfirmDialog` | 12 | 16 | [CrateEditor.tsx](../../app/listen/src/components/CrateEditor.tsx) |
| `@crate/ui/composites/GridSkeleton` | 4 | 2 | [HomeLibrarySections.tsx](../../app/listen/src/components/home/HomeLibrarySections.tsx) |
| `@crate/ui/domain/ArtistBioProfile` | 1 | 1 | [ArtistBioModal.tsx](../../app/listen/src/components/artist/ArtistBioModal.tsx) |
| `@crate/ui/domain/ArtistBioText` | 1 | 2 | [ArtistHeroSection.tsx](../../app/listen/src/components/artist/ArtistHeroSection.tsx) |
| `@crate/ui/domain/ArtistHeroFrame` | 6 | 1 | [ArtistHeroSection.tsx](../../app/listen/src/components/artist/ArtistHeroSection.tsx) |
| `@crate/ui/domain/ArtistHeroPresentation` | 1 | 1 | [HomeCanonicalHero.tsx](../../app/listen/src/components/home/HomeCanonicalHero.tsx) |
| `@crate/ui/domain/actions` | 34 | 0 | [CrateCard.tsx](../../app/listen/src/components/CrateCard.tsx) |
| `@crate/ui/domain/auth/OAuthButtons` | 1 | 1 | [OAuthButtons.tsx](../../app/listen/src/components/auth/OAuthButtons.tsx) |
| `@crate/ui/domain/brand/BandcampLogo` | 9 | 0 | [BandcampSupportButton.tsx](../../app/listen/src/components/bandcamp/BandcampSupportButton.tsx) |
| `@crate/ui/domain/brand/CrateLoader` | 1 | 0 | [CrateLoader.tsx](../../app/listen/src/components/ui/CrateLoader.tsx) |
| `@crate/ui/domain/brand/CrateLogo` | 5 | 3 | [PublicShell.tsx](../../app/listen/src/app-shell/PublicShell.tsx) |
| `@crate/ui/domain/entity` | 12 | 0 | [CrateCard.tsx](../../app/listen/src/components/CrateCard.tsx) |
| `@crate/ui/domain/entity/useEntityMenu` | 5 | 0 | [BandcampItem.tsx](../../app/listen/src/components/bandcamp/BandcampItem.tsx) |
| `@crate/ui/domain/filters` | 1 | 0 | [LibraryLikedTab.tsx](../../app/listen/src/pages/LibraryLikedTab.tsx) |
| `@crate/ui/domain/genres/GenrePill` | 13 | 2 | [AlbumHero.tsx](../../app/listen/src/components/album/AlbumHero.tsx) |
| `@crate/ui/domain/hero` | 9 | 0 | [AlbumActions.tsx](../../app/listen/src/components/album/AlbumActions.tsx) |
| `@crate/ui/domain/lists` | 23 | 0 | [ExploreDetailViews.tsx](../../app/listen/src/components/explore/ExploreDetailViews.tsx) |
| `@crate/ui/domain/media/MediaCover` | 1 | 0 | [AlbumCardParts.tsx](../../app/listen/src/components/cards/AlbumCardParts.tsx) |
| `@crate/ui/domain/media/PlayButton` | 2 | 0 | [CrateCoverFlow.tsx](../../app/listen/src/components/crates/CrateCoverFlow.tsx) |
| `@crate/ui/domain/navigation` | 7 | 0 | [JamLobbyView.tsx](../../app/listen/src/components/jam/JamLobbyView.tsx) |
| `@crate/ui/domain/navigation/BackLink` | 2 | 1 | [ExploreDetailViews.tsx](../../app/listen/src/components/explore/ExploreDetailViews.tsx) |
| `@crate/ui/domain/navigation/PageHeader` | 4 | 2 | [ExploreDetailViews.tsx](../../app/listen/src/components/explore/ExploreDetailViews.tsx) |
| `@crate/ui/domain/offline/OfflineBadge` | 6 | 0 | [AlbumHero.tsx](../../app/listen/src/components/album/AlbumHero.tsx) |
| `@crate/ui/domain/player/EqBands` | 1 | 1 | [EqualizerPanelSections.tsx](../../app/listen/src/components/player/EqualizerPanelSections.tsx) |
| `@crate/ui/domain/playlists/PlaylistArtwork` | 1 | 1 | [PlaylistArtwork.tsx](../../app/listen/src/components/playlists/PlaylistArtwork.tsx) |
| `@crate/ui/domain/states` | 24 | 0 | [ExploreDetailViews.tsx](../../app/listen/src/components/explore/ExploreDetailViews.tsx) |
| `@crate/ui/domain/states/LoadingState` | 1 | 3 | [AppFallbacks.tsx](../../app/listen/src/app-shell/AppFallbacks.tsx) |
| `@crate/ui/domain/tracks` | 3 | 0 | [PlaylistTrackList.tsx](../../app/listen/src/components/playlists/PlaylistTrackList.tsx) |
| `@crate/ui/icons` | 187 | 2 | [CrateAlbumPicker.tsx](../../app/listen/src/components/CrateAlbumPicker.tsx) |
| `@crate/ui/icons/translation` | 1 | 0 | [TranslationOverlay.tsx](../../app/listen/src/i18n/translation-mode/TranslationOverlay.tsx) |
| `@crate/ui/lib/appearance-token-registry` | 1 | 0 | [theme-color.ts](../../app/listen/src/lib/theme-color.ts) |
| `@crate/ui/lib/cn` | 18 | 7 | [TrackRowPlaybackControl.tsx](../../app/listen/src/components/cards/TrackRowPlaybackControl.tsx) |
| `@crate/ui/lib/content-density` | 1 | 0 | [content-density.ts](../../app/listen/src/lib/content-density.ts) |
| `@crate/ui/lib/crate-identity` | 1 | 1 | [main.tsx](../../app/listen/src/main.tsx) |
| `@crate/ui/lib/focus-ring-motion` | 1 | 1 | [main.tsx](../../app/listen/src/main.tsx) |
| `@crate/ui/lib/interface-preferences` | 4 | 1 | [InterfacePreferencesSection.tsx](../../app/listen/src/components/settings/InterfacePreferencesSection.tsx) |
| `@crate/ui/lib/motion-gate` | 2 | 1 | [EqualizerPanelSections.tsx](../../app/listen/src/components/player/EqualizerPanelSections.tsx) |
| `@crate/ui/lib/notify` | 80 | 0 | [CrateCreateModal.tsx](../../app/listen/src/components/CrateCreateModal.tsx) |
| `@crate/ui/lib/offline` | 1 | 0 | [offline.ts](../../app/listen/src/lib/offline.ts) |
| `@crate/ui/lib/read-css-color` | 2 | 0 | [canvas-color.ts](../../app/listen/src/lib/canvas-color.ts) |
| `@crate/ui/lib/toaster-config` | 1 | 1 | [main.tsx](../../app/listen/src/main.tsx) |
| `@crate/ui/lib/track-meta` | 1 | 1 | [TrackRow.tsx](../../app/listen/src/components/cards/TrackRow.tsx) |
| `@crate/ui/lib/use-breakpoint` | 15 | 0 | [use-genre-detail-model.ts](../../app/listen/src/components/explore/use-genre-detail-model.ts) |
| `@crate/ui/lib/use-debounced-value` | 1 | 0 | [use-debounced-value.ts](../../app/listen/src/hooks/use-debounced-value.ts) |
| `@crate/ui/lib/use-dismissible-layer` | 9 | 0 | [TopBarSearch.tsx](../../app/listen/src/components/layout/topbar/TopBarSearch.tsx) |
| `@crate/ui/lib/use-escape-key` | 2 | 0 | [ExtendedPlayer.tsx](../../app/listen/src/components/player/ExtendedPlayer.tsx) |
| `@crate/ui/lib/use-hover-capability` | 3 | 0 | [ArtistCardParts.tsx](../../app/listen/src/components/cards/ArtistCardParts.tsx) |
| `@crate/ui/primitives/ActionGroup` | 1 | 1 | [ServersSection.tsx](../../app/listen/src/components/settings/ServersSection.tsx) |
| `@crate/ui/primitives/ActionIconButton` | 1 | 2 | [JamHeroButtons.tsx](../../app/listen/src/components/jam/JamHeroButtons.tsx) |
| `@crate/ui/primitives/AppErrorBoundary` | 1 | 1 | [App.tsx](../../app/listen/src/App.tsx) |
| `@crate/ui/primitives/AppModal` | 10 | 2 | [CrateCreateModal.tsx](../../app/listen/src/components/CrateCreateModal.tsx) |
| `@crate/ui/primitives/AppPopover` | 7 | 2 | [AlbumTrackList.tsx](../../app/listen/src/components/album/AlbumTrackList.tsx) |
| `@crate/ui/primitives/Avatar` | 1 | 0 | [UserAvatar.tsx](../../app/listen/src/components/social/UserAvatar.tsx) |
| `@crate/ui/primitives/Checkbox` | 4 | 0 | [CrateForm.tsx](../../app/listen/src/components/crates/CrateForm.tsx) |
| `@crate/ui/primitives/CrateBadge` | 1 | 1 | [user-profile-model.ts](../../app/listen/src/pages/user-profile-model.ts) |
| `@crate/ui/primitives/ErrorState` | 1 | 13 | [CuratedPlaylist.tsx](../../app/listen/src/pages/CuratedPlaylist.tsx) |
| `@crate/ui/primitives/FilterChip` | 1 | 8 | [EqualizerPanelSections.tsx](../../app/listen/src/components/player/EqualizerPanelSections.tsx) |
| `@crate/ui/primitives/FollowHeartButton` | 10 | 0 | [AlbumActions.tsx](../../app/listen/src/components/album/AlbumActions.tsx) |
| `@crate/ui/primitives/FormField` | 10 | 1 | [CrateForm.tsx](../../app/listen/src/components/crates/CrateForm.tsx) |
| `@crate/ui/primitives/HairlineList` | 1 | 0 | [UpcomingShowExpandedView.tsx](../../app/listen/src/components/upcoming/UpcomingShowExpandedView.tsx) |
| `@crate/ui/primitives/IconButton` | 30 | 0 | [CrateAlbumPicker.tsx](../../app/listen/src/components/CrateAlbumPicker.tsx) |
| `@crate/ui/primitives/InfoBadge` | 33 | 26 | [AlbumHero.tsx](../../app/listen/src/components/album/AlbumHero.tsx) |
| `@crate/ui/primitives/InstrumentPanel` | 1 | 3 | [SettingsPrimitives.tsx](../../app/listen/src/components/settings/SettingsPrimitives.tsx) |
| `@crate/ui/primitives/Meter` | 1 | 1 | [OfflineSection.tsx](../../app/listen/src/components/settings/OfflineSection.tsx) |
| `@crate/ui/primitives/MonoLabel` | 8 | 17 | [CrateForm.tsx](../../app/listen/src/components/crates/CrateForm.tsx) |
| `@crate/ui/primitives/ProgressHairline` | 1 | 3 | [Upload.tsx](../../app/listen/src/pages/Upload.tsx) |
| `@crate/ui/primitives/PullIndicator` | 2 | 0 | [HomeContent.tsx](../../app/listen/src/pages/HomeContent.tsx) |
| `@crate/ui/primitives/QrCodeImage` | 1 | 0 | [JamRoomModalSections.tsx](../../app/listen/src/components/jam/JamRoomModalSections.tsx) |
| `@crate/ui/primitives/Readout` | 1 | 1 | [EqualizerPanelSections.tsx](../../app/listen/src/components/player/EqualizerPanelSections.tsx) |
| `@crate/ui/primitives/SearchInput` | 11 | 0 | [CrateAlbumPicker.tsx](../../app/listen/src/components/CrateAlbumPicker.tsx) |
| `@crate/ui/primitives/SegmentedControl` | 9 | 11 | [CrateForm.tsx](../../app/listen/src/components/crates/CrateForm.tsx) |
| `@crate/ui/primitives/SkipLink` | 1 | 1 | [Shell.tsx](../../app/listen/src/components/layout/Shell.tsx) |
| `@crate/ui/primitives/Slider` | 1 | 1 | [SettingsPrimitives.tsx](../../app/listen/src/components/settings/SettingsPrimitives.tsx) |
| `@crate/ui/primitives/StatNumber` | 2 | 0 | [OfflineSection.tsx](../../app/listen/src/components/settings/OfflineSection.tsx) |
| `@crate/ui/primitives/StatusDot` | 2 | 3 | [UpcomingShowCollapsedView.tsx](../../app/listen/src/components/upcoming/UpcomingShowCollapsedView.tsx) |
| `@crate/ui/primitives/Switch` | 3 | 0 | [VisualizerSettingsPanel.tsx](../../app/listen/src/components/player/visualizer/VisualizerSettingsPanel.tsx) |
| `@crate/ui/primitives/VtNavLink` | 2 | 2 | [MobileBottomNav.tsx](../../app/listen/src/components/layout/MobileBottomNav.tsx) |
| `@crate/ui/shadcn/button` | 64 | 51 | [PublicShell.tsx](../../app/listen/src/app-shell/PublicShell.tsx) |
| `@crate/ui/shadcn/input` | 13 | 24 | [CrateForm.tsx](../../app/listen/src/components/crates/CrateForm.tsx) |
| `@crate/ui/shadcn/skeleton` | 1 | 5 | [UserConnections.tsx](../../app/listen/src/pages/UserConnections.tsx) |
| `@crate/ui/shadcn/textarea` | 7 | 5 | [CrateForm.tsx](../../app/listen/src/components/crates/CrateForm.tsx) |

La ausencia de `shadcn/tabs` en este censo es consistente con Library/ExtendedPlayer usando
SegmentedControl todavía. Los controles shadcn internos consumidos por wrappers siguen dentro
del contrato aunque no tengan import directo Listen. Las fichas pendientes de esos internos se
completan al modificar su familia, sin crear un segundo set local.

## Apéndice B — censo de módulos visuales/adaptadores locales

Inventario de todos los `.tsx` de producción bajo `components`, `pages` y `app-shell` en esta
foto (352 archivos). No son352defectos ni352componentes a extraer: incluye vistas, wrappers,
controllers enTSX, barrels y rutas. Se usa como checklist de cobertura al cerrar familias; las
reglas de responsabilidad/estados se encuentran arriba. Los hooks/modelosTS, contextos, i18n,
storage y engines asociados se conservan y se prueban si la migración los afecta.

### `app/listen/src/app-shell`

[AppFallbacks](../../app/listen/src/app-shell/AppFallbacks.tsx); [AppLayoutRoute](../../app/listen/src/app-shell/AppLayoutRoute.tsx); [AppProviders](../../app/listen/src/app-shell/AppProviders.tsx); [AppRouter](../../app/listen/src/app-shell/AppRouter.tsx); [AuthenticatedApp](../../app/listen/src/app-shell/AuthenticatedApp.tsx); [LibraryRouteCompat](../../app/listen/src/app-shell/LibraryRouteCompat.tsx); [OfflineAccessRoute](../../app/listen/src/app-shell/OfflineAccessRoute.tsx); [PublicAppLayout](../../app/listen/src/app-shell/PublicAppLayout.tsx); [PublicAppProviders](../../app/listen/src/app-shell/PublicAppProviders.tsx); [PublicShell](../../app/listen/src/app-shell/PublicShell.tsx); [RouteGuards](../../app/listen/src/app-shell/RouteGuards.tsx); [TimezoneAutodetect](../../app/listen/src/app-shell/TimezoneAutodetect.tsx); [route-table](../../app/listen/src/app-shell/route-table.tsx).

### `app/listen/src/components`

[CrateAlbumPicker](../../app/listen/src/components/CrateAlbumPicker.tsx); [CrateCard](../../app/listen/src/components/CrateCard.tsx); [CrateCreateModal](../../app/listen/src/components/CrateCreateModal.tsx); [CrateEditor](../../app/listen/src/components/CrateEditor.tsx).

### `app/listen/src/components/actions`

[ItemActionMenu](../../app/listen/src/components/actions/ItemActionMenu.tsx); [entity-menu](../../app/listen/src/components/actions/entity-menu.tsx).

### `app/listen/src/components/album`

[AlbumActionNotices](../../app/listen/src/components/album/AlbumActionNotices.tsx); [AlbumActions](../../app/listen/src/components/album/AlbumActions.tsx); [AlbumHero](../../app/listen/src/components/album/AlbumHero.tsx); [AlbumHeroContributor](../../app/listen/src/components/album/AlbumHeroContributor.tsx); [AlbumTrackList](../../app/listen/src/components/album/AlbumTrackList.tsx); [ReleaseCountdown](../../app/listen/src/components/album/ReleaseCountdown.tsx).

### `app/listen/src/components/artist`

[ArtistAlbumsSection](../../app/listen/src/components/artist/ArtistAlbumsSection.tsx); [ArtistBioModal](../../app/listen/src/components/artist/ArtistBioModal.tsx); [ArtistCommunitySections](../../app/listen/src/components/artist/ArtistCommunitySections.tsx); [ArtistHeroSection](../../app/listen/src/components/artist/ArtistHeroSection.tsx); [ArtistLibrarySections](../../app/listen/src/components/artist/ArtistLibrarySections.tsx); [ArtistPageSections](../../app/listen/src/components/artist/ArtistPageSections.tsx); [ArtistSetlistSection](../../app/listen/src/components/artist/ArtistSetlistSection.tsx); [ArtistTopTracksSection](../../app/listen/src/components/artist/ArtistTopTracksSection.tsx).

### `app/listen/src/components/artwork`

[ArtworkSurface](../../app/listen/src/components/artwork/ArtworkSurface.tsx); [CrateImage](../../app/listen/src/components/artwork/CrateImage.tsx); [TrackCoverThumb](../../app/listen/src/components/artwork/TrackCoverThumb.tsx).

### `app/listen/src/components/auth`

[OAuthButtons](../../app/listen/src/components/auth/OAuthButtons.tsx).

### `app/listen/src/components/bandcamp`

[BandcampItem](../../app/listen/src/components/bandcamp/BandcampItem.tsx); [BandcampSupportButton](../../app/listen/src/components/bandcamp/BandcampSupportButton.tsx).

### `app/listen/src/components/cards`

[AlbumCard](../../app/listen/src/components/cards/AlbumCard.tsx); [AlbumCardParts](../../app/listen/src/components/cards/AlbumCardParts.tsx); [ArtistCard](../../app/listen/src/components/cards/ArtistCard.tsx); [ArtistCardParts](../../app/listen/src/components/cards/ArtistCardParts.tsx); [TrackRow](../../app/listen/src/components/cards/TrackRow.tsx); [TrackRowContent](../../app/listen/src/components/cards/TrackRowContent.tsx); [TrackRowParts](../../app/listen/src/components/cards/TrackRowParts.tsx); [TrackRowPlaybackControl](../../app/listen/src/components/cards/TrackRowPlaybackControl.tsx).

### `app/listen/src/components/crates`

[CrateCoverFlow](../../app/listen/src/components/crates/CrateCoverFlow.tsx); [CrateFollowButton](../../app/listen/src/components/crates/CrateFollowButton.tsx); [CrateForm](../../app/listen/src/components/crates/CrateForm.tsx); [CrateMembersModal](../../app/listen/src/components/crates/CrateMembersModal.tsx); [CratePageHeader](../../app/listen/src/components/crates/CratePageHeader.tsx).

### `app/listen/src/components/dev`

[TauriDevLogPanel](../../app/listen/src/components/dev/TauriDevLogPanel.tsx).

### `app/listen/src/components/explore`

[ExploreDetailViews](../../app/listen/src/components/explore/ExploreDetailViews.tsx); [ExplorePrimitives](../../app/listen/src/components/explore/ExplorePrimitives.tsx); [ExploreSearchResults](../../app/listen/src/components/explore/ExploreSearchResults.tsx); [ExploreViews](../../app/listen/src/components/explore/ExploreViews.tsx); [GenreDetailHero](../../app/listen/src/components/explore/GenreDetailHero.tsx); [GenreDetailSections](../../app/listen/src/components/explore/GenreDetailSections.tsx); [GenreTile](../../app/listen/src/components/explore/GenreTile.tsx).

### `app/listen/src/components/hero`

[ListenHeroActionBar](../../app/listen/src/components/hero/ListenHeroActionBar.tsx).

### `app/listen/src/components/home`

[CoreTracksArtwork](../../app/listen/src/components/home/CoreTracksArtwork.tsx); [CoreTracksPlaylistCard](../../app/listen/src/components/home/CoreTracksPlaylistCard.tsx); [HomeAlbumRails](../../app/listen/src/components/home/HomeAlbumRails.tsx); [HomeCanonicalHero](../../app/listen/src/components/home/HomeCanonicalHero.tsx); [HomeCustomMixes](../../app/listen/src/components/home/HomeCustomMixes.tsx); [HomeDiscoveryHero](../../app/listen/src/components/home/HomeDiscoveryHero.tsx); [HomeDiscoveryRails](../../app/listen/src/components/home/HomeDiscoveryRails.tsx); [HomeDiscoveryRecommendations](../../app/listen/src/components/home/HomeDiscoveryRecommendations.tsx); [HomeDiscoverySections](../../app/listen/src/components/home/HomeDiscoverySections.tsx); [HomeHeroContent](../../app/listen/src/components/home/HomeHeroContent.tsx); [HomeLegacyHero](../../app/listen/src/components/home/HomeLegacyHero.tsx); [HomeLibrarySections](../../app/listen/src/components/home/HomeLibrarySections.tsx); [HomeListeningHistory](../../app/listen/src/components/home/HomeListeningHistory.tsx); [HomePlaybackSections](../../app/listen/src/components/home/HomePlaybackSections.tsx); [HomeRadioRails](../../app/listen/src/components/home/HomeRadioRails.tsx); [HomeRecentEntities](../../app/listen/src/components/home/HomeRecentEntities.tsx); [HomeRecentEntityRows](../../app/listen/src/components/home/HomeRecentEntityRows.tsx); [HomeRecentSections](../../app/listen/src/components/home/HomeRecentSections.tsx); [HomeRecentlyPlayedSection](../../app/listen/src/components/home/HomeRecentlyPlayedSection.tsx); [HomeReplaySection](../../app/listen/src/components/home/HomeReplaySection.tsx); [HomeSectionCards](../../app/listen/src/components/home/HomeSectionCards.tsx); [HomeSectionLayout](../../app/listen/src/components/home/HomeSectionLayout.tsx); [HomeSections](../../app/listen/src/components/home/HomeSections.tsx); [HomeShowPrep](../../app/listen/src/components/home/HomeShowPrep.tsx); [HomeUpcomingFeature](../../app/listen/src/components/home/HomeUpcomingFeature.tsx); [HomeUpcomingFeatureCard](../../app/listen/src/components/home/HomeUpcomingFeatureCard.tsx); [HomeUpcomingPreviewPanel](../../app/listen/src/components/home/HomeUpcomingPreviewPanel.tsx); [HomeUpcomingSections](../../app/listen/src/components/home/HomeUpcomingSections.tsx); [MixArtwork](../../app/listen/src/components/home/MixArtwork.tsx).

### `app/listen/src/components/imports`

[RemoteImportAction](../../app/listen/src/components/imports/RemoteImportAction.tsx).

### `app/listen/src/components/jam`

[JamActivityPanel](../../app/listen/src/components/jam/JamActivityPanel.tsx); [JamAvatarBubble](../../app/listen/src/components/jam/JamAvatarBubble.tsx); [JamDeleteRoomModal](../../app/listen/src/components/jam/JamDeleteRoomModal.tsx); [JamHeroButtons](../../app/listen/src/components/jam/JamHeroButtons.tsx); [JamInvitePanel](../../app/listen/src/components/jam/JamInvitePanel.tsx); [JamLobbyView](../../app/listen/src/components/jam/JamLobbyView.tsx); [JamMembersPanel](../../app/listen/src/components/jam/JamMembersPanel.tsx); [JamOpenRoomsPanel](../../app/listen/src/components/jam/JamOpenRoomsPanel.tsx); [JamQueueListSections](../../app/listen/src/components/jam/JamQueueListSections.tsx); [JamQueuePanel](../../app/listen/src/components/jam/JamQueuePanel.tsx); [JamQueueSections](../../app/listen/src/components/jam/JamQueueSections.tsx); [JamQueueToolbarSections](../../app/listen/src/components/jam/JamQueueToolbarSections.tsx); [JamRoomActions](../../app/listen/src/components/jam/JamRoomActions.tsx); [JamRoomAutoDjOptions](../../app/listen/src/components/jam/JamRoomAutoDjOptions.tsx); [JamRoomCard](../../app/listen/src/components/jam/JamRoomCard.tsx); [JamRoomCreateOptions](../../app/listen/src/components/jam/JamRoomCreateOptions.tsx); [JamRoomCreatePanel](../../app/listen/src/components/jam/JamRoomCreatePanel.tsx); [JamRoomHeaderSections](../../app/listen/src/components/jam/JamRoomHeaderSections.tsx); [JamRoomHero](../../app/listen/src/components/jam/JamRoomHero.tsx); [JamRoomHeroSections](../../app/listen/src/components/jam/JamRoomHeroSections.tsx); [JamRoomModalSections](../../app/listen/src/components/jam/JamRoomModalSections.tsx); [JamRoomModals](../../app/listen/src/components/jam/JamRoomModals.tsx); [JamRoomPlaybackSections](../../app/listen/src/components/jam/JamRoomPlaybackSections.tsx); [JamRoomView](../../app/listen/src/components/jam/JamRoomView.tsx).

### `app/listen/src/components/layout`

[DesktopShell](../../app/listen/src/components/layout/DesktopShell.tsx); [MobileBottomNav](../../app/listen/src/components/layout/MobileBottomNav.tsx); [MobileShell](../../app/listen/src/components/layout/MobileShell.tsx); [Shell](../../app/listen/src/components/layout/Shell.tsx); [TopBar](../../app/listen/src/components/layout/TopBar.tsx); [transparent-header](../../app/listen/src/components/layout/transparent-header.tsx).

### `app/listen/src/components/layout/sidebar`

[Sidebar](../../app/listen/src/components/layout/sidebar/Sidebar.tsx); [SidebarBrand](../../app/listen/src/components/layout/sidebar/SidebarBrand.tsx); [SidebarNavigation](../../app/listen/src/components/layout/sidebar/SidebarNavigation.tsx).

### `app/listen/src/components/layout/topbar`

[ArtistSuggestionModal](../../app/listen/src/components/layout/topbar/ArtistSuggestionModal.tsx); [TopBarSearch](../../app/listen/src/components/layout/topbar/TopBarSearch.tsx); [TopBarSearchDropdown](../../app/listen/src/components/layout/topbar/TopBarSearchDropdown.tsx); [TopBarSearchView](../../app/listen/src/components/layout/topbar/TopBarSearchView.tsx); [TopBarUserMenu](../../app/listen/src/components/layout/topbar/TopBarUserMenu.tsx); [UserMenuAvatarButton](../../app/listen/src/components/layout/topbar/UserMenuAvatarButton.tsx).

### `app/listen/src/components/paths`

[PathRow](../../app/listen/src/components/paths/PathRow.tsx).

### `app/listen/src/components/player`

[ContinuePlaybackPrompt](../../app/listen/src/components/player/ContinuePlaybackPrompt.tsx); [EqualizerAdaptiveReadouts](../../app/listen/src/components/player/EqualizerAdaptiveReadouts.tsx); [EqualizerPanel](../../app/listen/src/components/player/EqualizerPanel.tsx); [EqualizerPanelSections](../../app/listen/src/components/player/EqualizerPanelSections.tsx); [EqualizerPopover](../../app/listen/src/components/player/EqualizerPopover.tsx); [EqualizerSmartReadout](../../app/listen/src/components/player/EqualizerSmartReadout.tsx); [ExtendedPlayer](../../app/listen/src/components/player/ExtendedPlayer.tsx); [ExtendedPlayerArtwork](../../app/listen/src/components/player/ExtendedPlayerArtwork.tsx); [ExtendedPlayerHeader](../../app/listen/src/components/player/ExtendedPlayerHeader.tsx); [ExtendedPlayerTabs](../../app/listen/src/components/player/ExtendedPlayerTabs.tsx); [ExtendedPlayerView](../../app/listen/src/components/player/ExtendedPlayerView.tsx); [FullscreenPlayer](../../app/listen/src/components/player/FullscreenPlayer.tsx); [FullscreenPlayerArtwork](../../app/listen/src/components/player/FullscreenPlayerArtwork.tsx); [FullscreenPlayerControls](../../app/listen/src/components/player/FullscreenPlayerControls.tsx); [FullscreenPlayerHeader](../../app/listen/src/components/player/FullscreenPlayerHeader.tsx); [FullscreenPlayerTabs](../../app/listen/src/components/player/FullscreenPlayerTabs.tsx); [FullscreenPlayerView](../../app/listen/src/components/player/FullscreenPlayerView.tsx); [JamQueueLockedNotice](../../app/listen/src/components/player/JamQueueLockedNotice.tsx); [LyricsPanel](../../app/listen/src/components/player/LyricsPanel.tsx); [PlaybackTargetButton](../../app/listen/src/components/player/PlaybackTargetButton.tsx); [PlaybackTargetIcon](../../app/listen/src/components/player/PlaybackTargetIcon.tsx); [PlaybackTargetMenu](../../app/listen/src/components/player/PlaybackTargetMenu.tsx); [PlaybackTargetPopover](../../app/listen/src/components/player/PlaybackTargetPopover.tsx); [PlayerBar](../../app/listen/src/components/player/PlayerBar.tsx); [PlayerSurfaceModeSwitch](../../app/listen/src/components/player/PlayerSurfaceModeSwitch.tsx); [PlayerTrackIdentity](../../app/listen/src/components/player/PlayerTrackIdentity.tsx); [QueuePanel](../../app/listen/src/components/player/QueuePanel.tsx); [QueueTrackRow](../../app/listen/src/components/player/QueueTrackRow.tsx); [RadioFeedback](../../app/listen/src/components/player/RadioFeedback.tsx); [SpectrumPlayButton](../../app/listen/src/components/player/SpectrumPlayButton.tsx); [SpectrumRibbonCanvas](../../app/listen/src/components/player/SpectrumRibbonCanvas.tsx); [SpinningDisc](../../app/listen/src/components/player/SpinningDisc.tsx); [SpinningDiscArtwork](../../app/listen/src/components/player/SpinningDiscArtwork.tsx); [SpinningDiscControl](../../app/listen/src/components/player/SpinningDiscControl.tsx); [lazy-player-surfaces](../../app/listen/src/components/player/lazy-player-surfaces.tsx).

### `app/listen/src/components/player/bar`

[PlayerBarActionButtons](../../app/listen/src/components/player/bar/PlayerBarActionButtons.tsx); [PlayerBarActionIconButton](../../app/listen/src/components/player/bar/PlayerBarActionIconButton.tsx); [PlayerBarArtwork](../../app/listen/src/components/player/bar/PlayerBarArtwork.tsx); [PlayerBarCompactActionButtons](../../app/listen/src/components/player/bar/PlayerBarCompactActionButtons.tsx); [PlayerBarDesktopActionButtons](../../app/listen/src/components/player/bar/PlayerBarDesktopActionButtons.tsx); [PlayerBarProgress](../../app/listen/src/components/player/bar/PlayerBarProgress.tsx); [PlayerBarSurfaces](../../app/listen/src/components/player/bar/PlayerBarSurfaces.tsx); [PlayerBarTrackActions](../../app/listen/src/components/player/bar/PlayerBarTrackActions.tsx); [PlayerBarTrackCopy](../../app/listen/src/components/player/bar/PlayerBarTrackCopy.tsx); [PlayerBarTrackInfo](../../app/listen/src/components/player/bar/PlayerBarTrackInfo.tsx); [PlayerBarTransportControls](../../app/listen/src/components/player/bar/PlayerBarTransportControls.tsx); [PlayerBarView](../../app/listen/src/components/player/bar/PlayerBarView.tsx); [PlayerProgressBeam](../../app/listen/src/components/player/bar/PlayerProgressBeam.tsx); [PlayerSeekBar](../../app/listen/src/components/player/bar/PlayerSeekBar.tsx); [PlayerSeekBarVariants](../../app/listen/src/components/player/bar/PlayerSeekBarVariants.tsx); [PlayerSurfaceFallback](../../app/listen/src/components/player/bar/PlayerSurfaceFallback.tsx); [PlayerTrackMenu](../../app/listen/src/components/player/bar/PlayerTrackMenu.tsx); [PlayerVolumeControl](../../app/listen/src/components/player/bar/PlayerVolumeControl.tsx); [PlayerVolumeSlider](../../app/listen/src/components/player/bar/PlayerVolumeSlider.tsx); [QualityBadge](../../app/listen/src/components/player/bar/QualityBadge.tsx); [WaveformCanvas](../../app/listen/src/components/player/bar/WaveformCanvas.tsx).

### `app/listen/src/components/player/extended`

[InfoTab](../../app/listen/src/components/player/extended/InfoTab.tsx); [InfoTabAudioProfile](../../app/listen/src/components/player/extended/InfoTabAudioProfile.tsx); [InfoTabBliss](../../app/listen/src/components/player/extended/InfoTabBliss.tsx); [InfoTabHero](../../app/listen/src/components/player/extended/InfoTabHero.tsx); [InfoTabHeroArtwork](../../app/listen/src/components/player/extended/InfoTabHeroArtwork.tsx); [InfoTabHeroIdentity](../../app/listen/src/components/player/extended/InfoTabHeroIdentity.tsx); [InfoTabHeroRating](../../app/listen/src/components/player/extended/InfoTabHeroRating.tsx); [InfoTabHeroStats](../../app/listen/src/components/player/extended/InfoTabHeroStats.tsx); [InfoTabMood](../../app/listen/src/components/player/extended/InfoTabMood.tsx); [InfoTabPrimitives](../../app/listen/src/components/player/extended/InfoTabPrimitives.tsx); [InfoTabQuietMetrics](../../app/listen/src/components/player/extended/InfoTabQuietMetrics.tsx); [InfoTabReach](../../app/listen/src/components/player/extended/InfoTabReach.tsx); [InfoTabSections](../../app/listen/src/components/player/extended/InfoTabSections.tsx); [InfoTabSource](../../app/listen/src/components/player/extended/InfoTabSource.tsx); [LyricsLine](../../app/listen/src/components/player/extended/LyricsLine.tsx); [LyricsTab](../../app/listen/src/components/player/extended/LyricsTab.tsx); [QueueTab](../../app/listen/src/components/player/extended/QueueTab.tsx); [QueueTabCurrentTrack](../../app/listen/src/components/player/extended/QueueTabCurrentTrack.tsx); [QueueTabPastTracks](../../app/listen/src/components/player/extended/QueueTabPastTracks.tsx); [QueueTabUpcoming](../../app/listen/src/components/player/extended/QueueTabUpcoming.tsx); [SuggestedTab](../../app/listen/src/components/player/extended/SuggestedTab.tsx); [SuggestedTrackRow](../../app/listen/src/components/player/extended/SuggestedTrackRow.tsx).

### `app/listen/src/components/player/visualizer`

[VisualizerSettingsPanel](../../app/listen/src/components/player/visualizer/VisualizerSettingsPanel.tsx).

### `app/listen/src/components/playlists`

[EditorialPlaylistArtwork](../../app/listen/src/components/playlists/EditorialPlaylistArtwork.tsx); [PlaylistArtwork](../../app/listen/src/components/playlists/PlaylistArtwork.tsx); [PlaylistCard](../../app/listen/src/components/playlists/PlaylistCard.tsx); [PlaylistCollaboratorsModal](../../app/listen/src/components/playlists/PlaylistCollaboratorsModal.tsx); [PlaylistComposerSections](../../app/listen/src/components/playlists/PlaylistComposerSections.tsx); [PlaylistComposerTrackList](../../app/listen/src/components/playlists/PlaylistComposerTrackList.tsx); [PlaylistCreateModal](../../app/listen/src/components/playlists/PlaylistCreateModal.tsx); [PlaylistDeleteModal](../../app/listen/src/components/playlists/PlaylistDeleteModal.tsx); [PlaylistHeroSection](../../app/listen/src/components/playlists/PlaylistHeroSection.tsx); [PlaylistIdentitySection](../../app/listen/src/components/playlists/PlaylistIdentitySection.tsx); [PlaylistTrackFilterBar](../../app/listen/src/components/playlists/PlaylistTrackFilterBar.tsx); [PlaylistTrackList](../../app/listen/src/components/playlists/PlaylistTrackList.tsx); [PlaylistTrackSearch](../../app/listen/src/components/playlists/PlaylistTrackSearch.tsx).

### `app/listen/src/components/radio`

[RadioStationCard](../../app/listen/src/components/radio/RadioStationCard.tsx).

### `app/listen/src/components/settings`

[AccountPulseListingField](../../app/listen/src/components/settings/AccountPulseListingField.tsx); [AccountSection](../../app/listen/src/components/settings/AccountSection.tsx); [AccountSectionForms](../../app/listen/src/components/settings/AccountSectionForms.tsx); [AccountTimezoneField](../../app/listen/src/components/settings/AccountTimezoneField.tsx); [BandcampSection](../../app/listen/src/components/settings/BandcampSection.tsx); [ConnectDevicesSection](../../app/listen/src/components/settings/ConnectDevicesSection.tsx); [InterfacePreferencesSection](../../app/listen/src/components/settings/InterfacePreferencesSection.tsx); [LanguageSection](../../app/listen/src/components/settings/LanguageSection.tsx); [LinksSection](../../app/listen/src/components/settings/LinksSection.tsx); [OfflineSection](../../app/listen/src/components/settings/OfflineSection.tsx); [OpenSubsonicCredentialsSection](../../app/listen/src/components/settings/OpenSubsonicCredentialsSection.tsx); [PlaybackSection](../../app/listen/src/components/settings/PlaybackSection.tsx); [ScrobbleSection](../../app/listen/src/components/settings/ScrobbleSection.tsx); [ServersSection](../../app/listen/src/components/settings/ServersSection.tsx); [SettingsPrimitives](../../app/listen/src/components/settings/SettingsPrimitives.tsx); [ShowsLocationControls](../../app/listen/src/components/settings/ShowsLocationControls.tsx); [ShowsLocationSection](../../app/listen/src/components/settings/ShowsLocationSection.tsx); [SleepTimerSection](../../app/listen/src/components/settings/SleepTimerSection.tsx).

### `app/listen/src/components/share`

[ShareSheet](../../app/listen/src/components/share/ShareSheet.tsx).

### `app/listen/src/components/social`

[CollaboratorPicker](../../app/listen/src/components/social/CollaboratorPicker.tsx); [ProfileHoverCard](../../app/listen/src/components/social/ProfileHoverCard.tsx); [ProfileHoverCardContent](../../app/listen/src/components/social/ProfileHoverCardContent.tsx); [UserAvatar](../../app/listen/src/components/social/UserAvatar.tsx); [UserProfileLink](../../app/listen/src/components/social/UserProfileLink.tsx); [UserRow](../../app/listen/src/components/social/UserRow.tsx).

### `app/listen/src/components/stats`

[CountUpNumber](../../app/listen/src/components/stats/CountUpNumber.tsx); [StatsArtistOfPeriod](../../app/listen/src/components/stats/StatsArtistOfPeriod.tsx); [StatsClosingCards](../../app/listen/src/components/stats/StatsClosingCards.tsx); [StatsGenreTrendCard](../../app/listen/src/components/stats/StatsGenreTrendCard.tsx); [StatsHeadlineNumbers](../../app/listen/src/components/stats/StatsHeadlineNumbers.tsx); [StatsHeatmapCard](../../app/listen/src/components/stats/StatsHeatmapCard.tsx); [StatsHighlights](../../app/listen/src/components/stats/StatsHighlights.tsx); [StatsMiniTape](../../app/listen/src/components/stats/StatsMiniTape.tsx); [StatsPeriodPicker](../../app/listen/src/components/stats/StatsPeriodPicker.tsx); [StatsReveal](../../app/listen/src/components/stats/StatsReveal.tsx); [StatsSignalTape](../../app/listen/src/components/stats/StatsSignalTape.tsx).

### `app/listen/src/components/stats/digging`

[DiggingStory](../../app/listen/src/components/stats/digging/DiggingStory.tsx).

### `app/listen/src/components/ui`

[CrateLoader](../../app/listen/src/components/ui/CrateLoader.tsx); [WindowVirtualList](../../app/listen/src/components/ui/WindowVirtualList.tsx).

### `app/listen/src/components/upcoming`

[ReleaseRow](../../app/listen/src/components/upcoming/ReleaseRow.tsx); [ShowCard](../../app/listen/src/components/upcoming/ShowCard.tsx); [UpcomingRows](../../app/listen/src/components/upcoming/UpcomingRows.tsx); [UpcomingShowCardViews](../../app/listen/src/components/upcoming/UpcomingShowCardViews.tsx); [UpcomingShowCollapsedView](../../app/listen/src/components/upcoming/UpcomingShowCollapsedView.tsx); [UpcomingShowExpandedView](../../app/listen/src/components/upcoming/UpcomingShowExpandedView.tsx).

### `app/listen/src/pages`

[Album](../../app/listen/src/pages/Album.tsx); [AlbumContent](../../app/listen/src/pages/AlbumContent.tsx); [Artist](../../app/listen/src/pages/Artist.tsx); [ArtistContent](../../app/listen/src/pages/ArtistContent.tsx); [ArtistTopTracks](../../app/listen/src/pages/ArtistTopTracks.tsx); [AuthCallback](../../app/listen/src/pages/AuthCallback.tsx); [Bandcamp](../../app/listen/src/pages/Bandcamp.tsx); [BandcampItemActions](../../app/listen/src/pages/BandcampItemActions.tsx); [BandcampItemCover](../../app/listen/src/pages/BandcampItemCover.tsx); [Crate](../../app/listen/src/pages/Crate.tsx); [Crates](../../app/listen/src/pages/Crates.tsx); [CuratedPlaylist](../../app/listen/src/pages/CuratedPlaylist.tsx); [CuratedPlaylistContent](../../app/listen/src/pages/CuratedPlaylistContent.tsx); [Explore](../../app/listen/src/pages/Explore.tsx); [ExploreLandingSections](../../app/listen/src/pages/ExploreLandingSections.tsx); [Home](../../app/listen/src/pages/Home.tsx); [HomeContent](../../app/listen/src/pages/HomeContent.tsx); [HomePlaylist](../../app/listen/src/pages/HomePlaylist.tsx); [HomeSection](../../app/listen/src/pages/HomeSection.tsx); [JamInvite](../../app/listen/src/pages/JamInvite.tsx); [JamSession](../../app/listen/src/pages/JamSession.tsx); [Library](../../app/listen/src/pages/Library.tsx); [LibraryAlbumsTab](../../app/listen/src/pages/LibraryAlbumsTab.tsx); [LibraryArtistsTab](../../app/listen/src/pages/LibraryArtistsTab.tsx); [LibraryBandcampHeader](../../app/listen/src/pages/LibraryBandcampHeader.tsx); [LibraryBandcampImported](../../app/listen/src/pages/LibraryBandcampImported.tsx); [LibraryBandcampPurchases](../../app/listen/src/pages/LibraryBandcampPurchases.tsx); [LibraryBandcampTab](../../app/listen/src/pages/LibraryBandcampTab.tsx); [LibraryCollectionSortDropdown](../../app/listen/src/pages/LibraryCollectionSortDropdown.tsx); [LibraryCollectionTabs](../../app/listen/src/pages/LibraryCollectionTabs.tsx); [LibraryContributionsTab](../../app/listen/src/pages/LibraryContributionsTab.tsx); [LibraryLikedTab](../../app/listen/src/pages/LibraryLikedTab.tsx); [LibraryPlaylistsTab](../../app/listen/src/pages/LibraryPlaylistsTab.tsx); [LibraryPrimitives](../../app/listen/src/pages/LibraryPrimitives.tsx); [Login](../../app/listen/src/pages/Login.tsx); [OfflineLibrary](../../app/listen/src/pages/OfflineLibrary.tsx); [PathDetail](../../app/listen/src/pages/PathDetail.tsx); [PathDetailParts](../../app/listen/src/pages/PathDetailParts.tsx); [Paths](../../app/listen/src/pages/Paths.tsx); [PathsParts](../../app/listen/src/pages/PathsParts.tsx); [People](../../app/listen/src/pages/People.tsx); [PeopleContent](../../app/listen/src/pages/PeopleContent.tsx); [PeopleSearch](../../app/listen/src/pages/PeopleSearch.tsx); [PeopleSummary](../../app/listen/src/pages/PeopleSummary.tsx); [Playlist](../../app/listen/src/pages/Playlist.tsx); [PlaylistContent](../../app/listen/src/pages/PlaylistContent.tsx); [Radio](../../app/listen/src/pages/Radio.tsx); [RadioHero](../../app/listen/src/pages/RadioHero.tsx); [RadioSeedPanel](../../app/listen/src/pages/RadioSeedPanel.tsx); [RadioSessionStatus](../../app/listen/src/pages/RadioSessionStatus.tsx); [RadioStationRail](../../app/listen/src/pages/RadioStationRail.tsx); [Register](../../app/listen/src/pages/Register.tsx); [SearchAlbumResults](../../app/listen/src/pages/SearchAlbumResults.tsx); [SearchArtistResults](../../app/listen/src/pages/SearchArtistResults.tsx); [SearchEmptyState](../../app/listen/src/pages/SearchEmptyState.tsx); [SearchErrorState](../../app/listen/src/pages/SearchErrorState.tsx); [SearchNoResultsState](../../app/listen/src/pages/SearchNoResultsState.tsx); [SearchResultSections](../../app/listen/src/pages/SearchResultSections.tsx); [SearchResults](../../app/listen/src/pages/SearchResults.tsx); [SearchResultsContent](../../app/listen/src/pages/SearchResultsContent.tsx); [SearchTrackResults](../../app/listen/src/pages/SearchTrackResults.tsx); [ServerSetup](../../app/listen/src/pages/ServerSetup.tsx); [Settings](../../app/listen/src/pages/Settings.tsx); [Shows](../../app/listen/src/pages/Shows.tsx); [ShowsContent](../../app/listen/src/pages/ShowsContent.tsx); [Stats](../../app/listen/src/pages/Stats.tsx); [StatsAnalyticsPrimitives](../../app/listen/src/pages/StatsAnalyticsPrimitives.tsx); [StatsAnalyticsSections](../../app/listen/src/pages/StatsAnalyticsSections.tsx); [StatsCollectionPanels](../../app/listen/src/pages/StatsCollectionPanels.tsx); [StatsDigging](../../app/listen/src/pages/StatsDigging.tsx); [StatsNarrativeSections](../../app/listen/src/pages/StatsNarrativeSections.tsx); [Upload](../../app/listen/src/pages/Upload.tsx); [UserConnections](../../app/listen/src/pages/UserConnections.tsx); [UserProfile](../../app/listen/src/pages/UserProfile.tsx); [UserProfileAvatar](../../app/listen/src/pages/UserProfileAvatar.tsx); [UserProfileHero](../../app/listen/src/pages/UserProfileHero.tsx); [UserProfileHeroSections](../../app/listen/src/pages/UserProfileHeroSections.tsx); [UserProfileLibrarySections](../../app/listen/src/pages/UserProfileLibrarySections.tsx); [UserProfileMatch](../../app/listen/src/pages/UserProfileMatch.tsx); [UserProfileNetworkSections](../../app/listen/src/pages/UserProfileNetworkSections.tsx); [UserProfileRelationships](../../app/listen/src/pages/UserProfileRelationships.tsx); [UserProfileSections](../../app/listen/src/pages/UserProfileSections.tsx); [UserProfileTaste](../../app/listen/src/pages/UserProfileTaste.tsx).

Otros puntos de entrada/soporte que completan la cobertura: [App](../../app/listen/src/App.tsx),
[main](../../app/listen/src/main.tsx), [TranslationOverlay](../../app/listen/src/i18n/translation-mode/TranslationOverlay.tsx),
[OfflineContext](../../app/listen/src/contexts/OfflineContext.tsx),
[PlayerContext](../../app/listen/src/contexts/PlayerContext.tsx),
[LinuxWindowTitlebar](../../app/listen-desktop/src/components/LinuxWindowTitlebar.tsx),
[platform](../../app/listen/src/lib/platform.ts) y
[reglas Desktop](../../app/listen-desktop/AGENTS.md).

1BE · Lyrics/info: adopción local de PlayerLyricsContent e InfoTabView, con adaptadores de datos,
media y navegación conservados. Catálogo inglés y review aislada cubren synced/plain/empty/error,
seek y lectura parcial/0/calidad completa. Pendiente revisión de Diego antes de commit. Output,
targets, visualizer y chrome nativo permanecen pendientes del siguiente lote interno.

1BE Output/targets: PlaybackTargetPanel/Picker son vistas Listen reutilizadas por producción,
Storybook y preview pequeño. Canónicas en carga/error/partial/empty/pending, motivos, acciones
Cast separadas y foco/teclado. Providers/autoridad/gates se conservan en Menu. Volume2px/44px
usa control real y comparte estilos de seek. Sin nueva página DevicesH3 ni QA física implícita.
Hover/mute/touch/foco y glow aprobados implementados; wheel consume scroll solo en las dos
superficies de volumen y conserva Shift1%/paso3%.170testsListen,48Desktop y16browser locales;
tipos/builds correctos. Output/Volume aprobado por Diego; siguiente lote: visualizador y estados
de análisis, conservando gates de analyser/motion y límites lazy.

1BE Visualizer: VisualizerSettingsPanel adopta formas y lecturas canónicas, mantiene análisis
pendiente/0/completo, rangos/modos/preferencias. MusicVisualizer/useMusicVisualizer conservan
capability y analyser real, congelan con motion/Effects y paran ocultos. SpectrumRibbonCanvas
sin importadores runtime y su drawer retirados(PD47); waveform vivo conservado. Escena real
Listen/Player/Visualizer and Analysis y preview pequeño. Aprobado por Diego para publicación.

Cierre Visualizer:115Listen/48Desktop/8browser,3tipos/3builds correctos. Popover padre/scroll
compartido, lecturas efectivas accesibles, static invalidado ante cambios y sin interpolación
pendiente. Diego aprueba el lote y autoriza commit/push; sigue chrome Tauri de1BE.

1BE EQ refinement: curva compartida con lecturas14pxMono, paneles acotados hasta720px y scroll.
Select compacto conserva todos los presets genéricos; curva disponible por pista es inventario
separado e informativo, solo fuente activa iluminada. ON/OFF chip conserva bypass/restauración,
OFF dibuja plano sin borrar ganancias. Nueva lectura privada/unaCTE sin alterar resolver/audio;
servidor antiguo limita a curva efectiva confirmada con aviso. EqBands deja cobertura pendiente
y tiene contrato/estados/stories interactivos en inglés. Tauri sigue pendiente por decisión de Diego.

EQ aprobado por Diego el 2026-10-21 para commit/push. Antes del cierre web: auditoría transversal R01–R25, clasificación del catálogo pendiente, sincronización del switch de Settings con el panel EQ y revisión del editor de Translation Mode (herramienta de desarrollo). Inventario completo de curvas pendiente de desplegar su endpoint; el fallback de producción es explícito. Tauri/Capacitor y los instrumentos H3 conservan su alcance separado.
