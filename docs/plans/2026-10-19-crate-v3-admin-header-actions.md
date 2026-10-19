# Cabeceras de Admin: acciones compactas — estándar 1AQ

Diego aprobó la referencia de PlaylistEditor y después autorizó migrar las 18 cabeceras
inventariadas antes del siguiente grupo. Esta aplicación sigue en **1AQ local, sin commit**.
Las 17 cabeceras con acciones comparten 38 sitios de control; Roles adopta la composición sin
inventar acciones. También están aplicadas las tres acciones de fila de playlists que pidió
posteriormente. Esta autorización sustituye las notas previas de «solo propuestas» para esas
cabeceras, y no amplía las otras propuestas del inventario general.

## Receta acordada

- `PageHeaderLayout`, `PageHeaderActions` y `PageHeaderAction` son composiciones de Admin sobre
  Button y Tooltip compartidos. No hay una nueva foundation ni exportación de `@crate/ui`.
- Acciones arriba a la derecha, Button `variant="ghost"` / `size="icon-lg"`, 44 × 44 px, sin
  borde ni fondo permanente. El foco y hover del control siguen visibles; las filas no se iluminan.
- Tooltip compartido en portal y accesible por teclado. Los nombres precisos se mantienen en
  `aria-label`; `title` respalda el tooltip. En filas repetidas, Diego pidió tooltips solo con la
  acción: **Edit, Activate/Deactivate, Delete**; el nombre accesible conserva el objeto. SVG
  decorativos `aria-hidden`, iconos de Admin desde `lucide-react`.
- Un botón deshabilitado conserva su `disabled` nativo y un trigger de tooltip consultable
  con ratón y teclado, nombrado y marcado como deshabilitado. El mismo nodo Button se mantiene
  durante los cambios de disponibilidad; Radix conecta la descripción también al botón.
- La cabecera responde al ancho real de su contenedor (`@2xl`, 672 px). Estrecha: acciones en
  su propia línea superior derecha; portada e identidad conservan espacio. Ancha: se alinean
  arriba. No comprimir el título para acomodar una toolbar de texto.
- Cada trabajo tiene glifo propio y nombre preciso; Sync collection, Refresh Radar y Backfill
  URLs no se confunden con Refresh. Los loaders, disabled, busy, selección y permisos se
  conservan. Las confirmaciones finales y los formularios internos siguen con texto.
- Back queda fuera de la identidad. La pregunta sobre iconificar Back fue una consulta: sigue
  la flecha con texto y destino fijo `/playlists`, sin cambiar su contrato.
- `OpsPageHero` tiene `compactActions` opt-in para los ocho consumidores revisados. Tasks,
  Insights y Genres conservan su contrato predeterminado. No hay cambio de datos/API/SSE.
- Filas de playlists: mismos controles ghost/Tooltip; Pencil, Power/PowerOff y Trash2. Se
  mantienen navegación por teclado, stopPropagation, activación y ConfirmDialog textual. Una
  sola capa de padding de 16 px; se elimina la duplicación de 24 px de Card + 16 px de fila.

## Aplicación vigente

| Página y fuente | Acciones / glifos aplicados |
| --- | --- |
| [PlaylistEditor](../../app/ui/src/pages/PlaylistEditor.tsx#L914) | Copy / Eye / ListRestart / Save |
| [Dashboard](../../app/ui/src/pages/Dashboard.tsx#L142) | RefreshCw / Wrench |
| [Analysis](../../app/ui/src/pages/Analysis.tsx#L382) | RefreshCw / Fingerprint / TrendingUp / Orbit / AudioLines |
| [SystemHealth](../../app/ui/src/pages/SystemHealth.tsx#L950) | RefreshCw |
| [Trash](../../app/ui/src/pages/Trash.tsx#L235) | RefreshCw / Trash2 |
| [Contributions](../../app/ui/src/pages/Contributions.tsx#L87) | RefreshCw |
| [Discover](../../app/ui/src/pages/Discover.tsx#L338) | RefreshCw / ChartNoAxesCombined / Radar |
| [GlobalCatalog](../../app/ui/src/pages/GlobalCatalog.tsx#L163) | RefreshCw / GitMerge / DatabaseBackup |
| [I18nReview](../../app/ui/src/pages/I18nReview.tsx#L488) | RefreshCw |
| [Logs](../../app/ui/src/pages/Logs.tsx#L315) | Pause / Play / RefreshCw |
| [Stack](../../app/ui/src/pages/Stack.tsx#L586) | RefreshCw |
| [Health](../../app/ui/src/pages/Health.tsx#L636) | ScanSearch |
| [Bandcamp](../../app/ui/src/pages/Bandcamp.tsx#L211) | FolderSync / Radar / Link |
| [NewReleases](../../app/ui/src/pages/NewReleases.tsx#L549) | List / LayoutGrid / Radar |
| [Users](../../app/ui/src/pages/Users.tsx#L854) | MailPlus / UserPlus |
| [Upcoming](../../app/ui/src/pages/Upcoming.tsx#L294) | CalendarSync / Eraser |
| [Playlists](../../app/ui/src/pages/Playlists.tsx#L368) | FilePlus2 / ListPlus |
| [Roles](../../app/ui/src/pages/Roles.tsx#L55) | Solo lectura, sin toolbar ni acciones nuevas |

El [inventario verificable](crate-v3-analysis/admin-header-actions-1aq.json) incluye las
expresiones reales de nombre/carga, marcadores, líneas y hashes. El [inventario general](2026-10-19-crate-v3-admin-action-icons.md)
queda en **71 sitios: 45 aplicados, 11 propuestos y 15 existentes en su fase**. Las propuestas
restantes de fila/detalle requieren su propio alcance; no se han aplicado globalmente.

Los especímenes montan las páginas reales con datos ficticios y fronteras de API locales.
La validación focalizada y sus límites se registran en el estado vigente y handover. Se conserva
preview5186; stop1AQ antes de commit/push y sin avanzar otro grupo. No certifica backend vivo,
AT/nativo, otros motores ni comparación canónica. No hay baselines nuevos o suites/CI completas.
