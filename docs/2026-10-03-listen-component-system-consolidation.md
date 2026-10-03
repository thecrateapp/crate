# Listen: consolidación del sistema de componentes

Fecha: 2026-10-03 · Rama: `codex/crate-coverflow-mockups`

Plan derivado de 6 auditorías:

- superficies de álbum y pista (plan propio en `2026-10-03-listen-item-surfaces-unification.md`);
- resto de entidades;
- bloques de página;
- primitivas interactivas;
- uso de `@crate/ui`;
- admin (este último solo como referencia).

**Alcance: listen + `@crate/ui`. Admin queda fuera.** Admin tendrá un análisis y un plan propios. Cualquier cambio en `@crate/ui` debe ser compatible hacia atrás con admin (props nuevas opcionales, sin renombrar exports que admin usa). Tampoco se borra nada de `@crate/ui` que el análisis de admin proponga adoptar o mover (`composites/*`, `domain/stats/Ops*`).

## Diagnóstico

1. **Hay piezas compartidas que nadie usa y, mientras, la app mantiene copias.**
   - `domain/lists/*` (SectionHeader, MediaRail, MediaGrid, EmptyState), `domain/media/*` (MediaCover, MediaEntity), `domain/navigation/SearchBar`, `domain/shows/ShowCard`, `primitives/Spinner`, `primitives/StarRating` y `composites/ConfirmDialog` tienen 0 usos.
   - Listen mantiene en su lugar `HomeSectionLayout.SectionHeader`, `ExploreSectionHeader`, `SectionRail`, `ExploreSectionRail`, `LibraryPrimitives.{Spinner,EmptyState}`, `ShowsContent.EmptyState`, `UpcomingShowCard`, `InfoTabPrimitives.StarRating` y 6 confirmaciones hechas a mano.
2. **No hay un esqueleto común para las entidades.** Ocurre con álbum y pista (en curso) y también con el resto:
   - 6 implementaciones de playlist y 3 builders de menú de playlist.
   - 5 avatares y 6 filas de usuario.
   - 2 `RadioStationCard` distintos.
   - 2 tiles de género.
   - Solo 6 de 18 componentes con menú lo abren con clic derecho, long-press y tecla de menú. En táctil, varias cards no tienen "…" y no se descubre el menú.
3. **Bloques de página copiados:**
   - 5 heroes con el mismo esqueleto; la clase de las acciones secundarias está en 6 sitios y el portal del menú "…" de móvil en 4.
   - 11 variantes de error o no encontrado, unas 25 de estado vacío y unos 12 spinners.
   - 5 densidades de grid y 16 cabeceras de página simples.
   - `useSectionRail` mantiene un ResizeObserver y un listener de scroll para unos controles que nunca se pintan.
4. **Primitivas débiles o ignoradas:**
   - Botones: 297 `<button>` crudos (38 primarios y 13 de peligro hechos a mano, unos 97 sin `type`).
   - Formularios: 46 `<input>` y 7 `<textarea>` crudos con 6 recetas de estilo; 3 semánticas de toggle distintas y ningún `FormField`.
   - Modales: la cabecera se copia 11 veces y los motores de swipe-to-dismiss están duplicados.
   - Botón de play sobre artwork: 9 variantes.
   - Imagen: 13 hacks `onError → display:none` en imágenes.
   - Iconos: 416 tamaños de icono literales.
5. **Accesibilidad:**
   - El token de foco (`--focus-shadow`, 1px al 8%) es casi invisible; `ActionIconButton` y `ModalCloseButton` no tienen anillo de foco.
   - Las primitivas compartidas llevan etiquetas fijas en inglés: "Dialog", "Close", "Action sheet", "More actions", "Cancel/Confirm", "Search".
   - `ContextMenu` y los listbox propios no se navegan con flechas.
   - Hay botones dentro de `role=button`.
6. **Bugs visibles:**
   - `PathDetail` se queda cargando para siempre si el path no existe.
   - `SearchResults` y `CuratedPlaylistContent` devuelven `null`, así que la página sale en blanco.
   - `PeopleSearch` hace una petición por tecla.
   - JustLanded monta cada artista dos veces.
   - Las compras de Bandcamp usan `window.open` en lugar de `openExternalUrl`.
   - Hay 14 toasts y varios textos ("Radar", "Radio", "Core Tracks", "and more", "Listening History", "Following", "Pre-release") en inglés fijo.
7. **Tokens:**
   - 93 `rounded-[12px]` fuera de la escala, que acaba en `xl` = 8px.
   - `z-[1600]` y `z-[9999]` fuera de `tokens/z-index.css`.
   - 56 tamaños de texto arbitrarios y 130 `tracking-[…]`.
   - Colores de paleta en `CrateCard` y `CrateCoverFlow`.
   - `max-w-[1480px]` y alturas de hero repetidas.
8. **Código muerto y copias de lógica en listen:**
   - Copias muertas de `@crate/ui` sin importadores: `hooks/use-breakpoint`, `use-escape-key` y `use-dismissible-layer`; los shims `components/ui/{AppPopover,CrateBadge,VtNavLink}`.
   - Copias vivas que hay que cambiar por la versión compartida: `hooks/use-hover-capability`, `lib/input-capabilities` y `lib/offline.ts:129-160`.
   - Duplicados: 3 copias de `formatBytes` en listen y 11 de `clamp` en el player.
9. **No hay guardas que eviten el drift.**
   - `drift-inventory` no corre en CI ni tiene presupuestos.
   - `radius-policy` no cubre `rounded-[Npx]`.
   - No hay políticas de z-index, de tamaño de icono, de botones crudos ni de exports sin uso.

## Principios

- Un patrón, un componente. Los nuevos componentes de `@crate/ui` cumplen la regla de "usado por las dos apps", o son base del sistema (primitivas, formularios, shadcn), que queda exenta. Los wrappers de dominio de listen viven en listen.
- Los componentes de dominio reciben callbacks y props, no contextos.
- Look canónico: el de Home. El ranking y las métricas van como slots discretos.
- Toda lista larga construye el menú solo al abrirlo y mantiene `memo` efectivo, con callbacks estables.
- Cada fase termina con tests verdes (vitest de listen y de shared/ui, `tsc`, eslint, `i18n:check`) y una revisión independiente.

## Fases

### Fase 0: bugs, limpieza y base de guardas (bajo riesgo)

- **Bugs:**
  - `PathDetail` loader infinito → estado de no encontrado.
  - Página en blanco en `SearchResults` y `CuratedPlaylistContent` → estado de error.
  - Debounce en `PeopleSearch`.
  - Doble render de JustLanded.
  - `window.open` → `openExternalUrl` en `LibraryBandcampPurchases`.
- **i18n:** traducir los 14 toasts y los textos fijos listados en el punto 6 del diagnóstico.
- **Limpieza:**
  - Borrar las copias muertas y los shims de listen.
  - Re-exportar `offline` y `use-hover-capability` desde `@crate/ui`.
  - Añadir `formatBytes`, `formatRelativeTime` (i18n con `Intl.RelativeTimeFormat`) y `clamp` a `app/shared/web/utils.ts`, y sustituir las copias de listen.
- **Rails:** pintar los controles de `railControls` o eliminarlos junto con `useSectionRail`. Se eliminan: no hay diseño para ellos.

### Fase 1: primitivas en `@crate/ui` (solo shared/ui y sus tests)

- **Foco:** anillo visible de 2px con token, aplicado a todas las primitivas interactivas.
- **Etiquetas de las primitivas:** todas pasan a props traducibles, con el inglés como valor por defecto para no romper admin.
- **`AppModal`:** `title`, `description`, `aria-labelledby` automático y `size: sm|md|lg|xl`. Cabecera incluida con `ModalCloseButton`.
- **`ConfirmDialog`** sobre `AppModal`: `tone="danger"`, `pending` y etiquetas por props.
- **Motor de arrastre:** extraer `useSheetDrag`, compartido por `AppModal` y `MobileActionSheet`.
- **`Button`:**
  - `shape: rect|pill`, `loading` y variante `danger-soft`;
  - `type="button"` por defecto;
  - disabled a opacidad 50.
- **`IconButton`:** `size: sm|md|lg`, con objetivo táctil mínimo de 44px en móvil; `label` obligatoria, que alimenta `aria-label`; `tone`. `ActionIconButton` se mantiene como alias.
- **`FollowHeartButton`:** `loading` y etiquetas por props.
- **`PlayButton`** (domain/media): `size`, `reveal: hover|always`, `playing`.
- **Formularios:**
  - `FormField`: label, ayuda y error, con `aria-describedby` y `aria-invalid`.
  - `Switch`, `Checkbox` y `RadioGroup`, sobre Radix.
  - `SegmentedControl`: `variant: solid|tonal`, `as: tabs|radio`, navegación con flechas.
  - `SearchInput` con `debounceMs`, y `useDebouncedValue`.
- **Imagen:**
  - `Avatar`: `src`, `name`, `size` y `shape`; la URL se resuelve fuera y se inyecta.
  - `MediaCover`/`ArtworkSurface` con `fallback`, para eliminar los hacks de `onError`.
  - `Badge` con `tone` y variantes `quality`, `rank` y `count`.
- **`ContextMenu`:** navegación con flechas, Home/End y foco al abrir. `ItemActionMenuButton` con `aria-haspopup` y `aria-expanded`.
- **`notify`:** wrapper sobre sonner con `id` para deduplicar.

### Fase 2: bloques de página en `@crate/ui/domain` + migración en listen

- **Listas:**
  - `SectionHeader` (extender el existente): `as`, `size: md|lg|display`, `action`, `count`, `id`.
  - `MediaRail`: absorbe `SectionRail` y `ExploreSectionRail`.
  - `MediaGrid`: `density: compact|default|wide`, alineado con las columnas del rail.
- **Estados:**
  - `EmptyState`: `variant: inline|panel|dashed`, `icon`, `title`, `action`.
  - `ErrorState`: `kind: error|notFound|unavailable`, `onRetry`, `backTo`, `action`.
  - `LoadingState`: `section|page|screen`; `CrateLoader` pasa a `domain/brand`.
- **Hero:**
  - `PageHero`: `variant: media|artist|editorial|card`, `background.treatment`, `artwork`, `meta[]`.
  - `HeroActionBar`: acciones primarias, secundarias con etiqueta y menú "…" con un único portal móvil.
- **Página simple:** `PageHeader` + `BackLink`.
- **Listas de pistas:** `TrackList` virtualizado por umbral, sobre `WindowVirtualList`; se elimina la copia de `CuratedPlaylistTrackList`.
- **Filtros:** `FilterBar`, con slots de búsqueda, orden y chips.
- **Cabecera transparente:** declarativa desde la página, sin regex en `Shell`, y que se solidifica al hacer scroll.

### Fase 3: sistema de entidades

Depende del cierre de la unificación de álbum y pista.

- **Esqueleto común en `@crate/ui/domain/entity`:**
  - `EntityCard`: `article` con un `button` interior, `useItemActionTarget`, "…" con `menuButton: hover|always|none`, menú perezoso, `overlay.onPlay` y `overlay.follow`, `shape`, `rank`, `meta`.
  - `EntityRow`: densidad `default|compact`, `leading`, `trailing`.
  - `EntityAvatar`.
- **Wrappers de listen:**
  - `ArtistCard`: `tile|row|editorial`.
  - `PlaylistCard`: `tile|featured|row`; absorbe Featured, CustomMix, CoreTracks, `PlaylistListRow` y las filas de perfil.
  - `CrateCard`: `tile|row`.
  - `ShowCard`: sobre el `ShowCard` de shared, con variantes `row` colapsable, `preview` y `feature`.
  - `ReleaseRow`.
  - `RadioStationCard`: una sola.
  - `GenreTile`: `room|related`.
  - `UserRow`.
  - `JamRoomCard`, `PathRow` y `BandcampItem` (`tile|row`).
- **Builders de menú:**
  - Unificar artista (hero y card), playlist (card, página y curated) y crate (card y página).
  - Nuevos: género, usuario (seguir, ver perfil, compartir; da acceso a seguir en táctil), radio, sala de Jam, path y Bandcamp.
  - En el táctil, toda card con menú muestra "…".

### Fase 4: migración de primitivas en listen (por áreas, en paralelo)

Botones, botones de icono, botón de play, follow, formularios, confirmaciones, modales, avatares, imágenes, badges y `notify` pasan a las primitivas de la fase 1. Las áreas se reparten por directorio para no pisarse:

1. home, explore y search;
2. library, profile, people y stats;
3. páginas de artista, álbum, playlist, crate y género;
4. player, jam, radio, paths, settings, upcoming, bandcamp, auth y upload.

### Fase 5: tokens y guardas

- **Tokens:**
  - `--radius-panel` (12px) con la clase `rounded-panel`, para sustituir los 93 `rounded-[12px]` sin cambio visual.
  - `--z-player-popover`, para corregir `z-[1600]` y `z-[9999]`.
  - `--content-max-w` y `--hero-h-*`.
  - Escala `text-micro` y escala de tracking.
  - Colores de paleta en `CrateCard` y `CrateCoverFlow` → tokens.
- **Tamaño de icono:** codemod de `size={N}` → `CRATE_ICON_SIZE`, con el mapeo 15→16, 13→14, 17/19→18 y 9/10/11→12.
- **Guardas** (vitest de política en listen y shared, más presupuestos):
  - `rounded-[`, `z-[`, `shadow-[` y `text-[Npx]` fuera de la lista de permitidos.
  - Tamaño de icono fuera de la escala.
  - `<button>`, `<input>` y `<textarea>` crudos fuera de los wrappers permitidos.
  - Exports de `@crate/ui` sin uso.
  - Copias locales con el mismo nombre que un export de `@crate/ui`.
  - `design-system:drift` en CI, con presupuestos que solo pueden bajar.

## Ejecución

- Fases secuenciales: 0 → 1 → 2 → 3 → 4 → 5.
- Dentro de cada fase, los agentes trabajan en paralelo sobre conjuntos de ficheros disjuntos. Las primitivas de `@crate/ui` y los catálogos i18n tienen un único dueño por fase.
- Cada fase cierra con:
  - la suite completa de listen y la de shared/ui;
  - `tsc` de listen, shared/ui y admin (admin solo para comprobar que la compatibilidad no se rompe);
  - eslint;
  - `i18n:check`;
  - revisión independiente del diff;
  - capturas comparativas desktop y móvil de las superficies tocadas.

## Riesgos

- **Compatibilidad con admin:** props nuevas opcionales, mismos nombres de export y `tsc` de admin en cada fase.
- **Tests que dependen de la estructura del DOM** (`role=button` → `article` + `button`): se actualizan, no se borran.
- **Rendimiento:** menú perezoso y `memo` en rails y listas virtualizadas. Desaparecen los observers inútiles de los rails.
- **Cambio visual:** el objetivo es el look de Home sin cambios intencionados, salvo donde el canon lo exige (Stats, Crate, foco visible).
