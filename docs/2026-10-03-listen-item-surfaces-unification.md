# Listen — unificación de superficies de álbum y pista

Fecha: 2026-10-03 · Rama: `codex/crate-coverflow-mockups`

## Problema

Varias superficies pintan álbumes y pistas con copias propias en lugar de `AlbumCard` / `TrackRow`, y su comportamiento ha divergido:

- Stats (top tracks, top álbumes, top artistas): el menú existe pero no se abre con clic derecho, long-press ni tecla de menú. Además se ven distintas de Home.
- `TrackRow` no tiene long-press ni tecla de menú. En móvil, el menú de pista solo se abre con "…".
- Hay filas de pista duplicadas: Home (Continue, Replay, Queue card), Stats (top tracks y Replay, esta última sin menú), Paths y las tres colas del player.
- La lista de álbumes de un Crate y las contribuciones del perfil no tienen menú.
- La card y la página de álbum construyen el menú con builders distintos.
- Stats reproduce una sola pista; el resto de listas reproduce la lista desde la posición pulsada.

## Decisiones

1. Al pulsar una pista en Stats se reproduce la lista desde esa pista; si ya está sonando, se alterna play/pause.
2. Hay un único menú de álbum, que es la unión de los dos actuales: reproducir, a continuación, aleatorio, añadir a Crate, añadir a playlist, guardar, radio, offline, descargar, ir a artista y compartir. El mismo builder sirve para la card y para la página.
3. Estética: el canon puro (el look de Home). El ranking y las métricas son slots discretos. No hay variante editorial.

## Diseño

### Hook compartido

`useItemActionTarget(actionMenu, { disabled })` en `@crate/ui/domain/actions`. Devuelve props para el elemento raíz: `onContextMenu`, `onKeyDown` (tecla ContextMenu y Shift+F10) y los handlers de long-press. Lo adoptan `AlbumCard`, `TrackRow`, `ArtistCard`, `PlaylistCard`, las filas de Home y la fila de cola. Se desactiva en los elementos sortables (dnd).

### `AlbumCard`

- `variant: "tile" | "row"`: `tile` es la card actual; `row` es la fila compacta (Crate, perfil, recientes).
- `rank?: number`
- `meta?: ReactNode`, para textos como "12 plays · 40 min" o "via Bandcamp".
- `extraActions?`, para casos como "quitar del Crate".
- Se mantienen `layout` y `compact`.

### `TrackRow`

- `rank?: number`
- `meta?: ReactNode`
- `density?: "default" | "compact"`, donde `compact` es la cola del player.
- `extraActions?`, para casos como "quitar de la cola".
- `showLike?` y `showDuration?`.
- Long-press y tecla de menú a través del hook compartido.
- Las entradas del menú se calculan solo al abrirlo (perezosas), porque `TrackRow` se usa en listas virtualizadas.

### Menú de álbum

Un solo builder en `components/actions/album-actions.ts`. `pages/album-menu-model.ts` pasa a reutilizarlo.

## Migración (por impacto)

1. Stats: top tracks a `TrackRow` (`rank`, `meta`, `queueTracks`); top álbumes a `AlbumCard` (`rank`, `meta`); top artistas con el hook.
2. `TrackRow`: long-press y tecla de menú.
3. Stats Replay a `TrackRow` compacta con `rank`.
4. Home Continue, Replay y Queue card a `TrackRow`.
5. Lista de álbumes del Crate a `AlbumCard` en variante `row`, con "quitar del Crate" para quien pueda editar; contribuciones del perfil a `AlbumCard` en variante `row`.
6. Una sola fila de cola, sobre `TrackRow` compacta, en lugar de las tres copias (QueuePanel, QueueTabRow, Fullscreen).
7. Paths: `TrackRow`, con la distancia en `meta`.
8. Menores:
   - Layout y `cover` en `HomeLibrarySections` y en `ExploreSearchResults`.
   - `showCoverThumb` en Search.
   - i18n de "Pre-release" y "Releases".

Fuera de alcance: los pickers y editores que tienen acciones propias (desplegable del TopBar, semilla de Radio, cola de Jam, Composer, gestión de contribuciones en Library, Setlist).

## Riesgos

- Rendimiento en las listas virtualizadas: menú perezoso y callbacks estables, para que `memo` siga sirviendo.
- `AlbumCard`/`TrackRow` dependen de los contextos de guardados, likes, offline y player. En Stats global o de otro usuario, el corazón refleja el estado del usuario actual.
- Conflicto entre long-press y dnd en filas sortables: en esos casos el hook se desactiva.

## Tests

- Clic derecho, long-press (`pointerType: touch`) y tecla de menú en `AlbumCard`, `TrackRow`, Stats, Crate y la fila de cola.
- Stats: el play reproduce la lista desde la posición pulsada.
- El menú de álbum es el mismo en la card y en la página.
