# Normalización de overrides de componentes compartidos

2026-10-25 · plan aprobado por Diego · **no empezar hasta que termine el agente de bugs en curso.**
La medición y las normas resultantes están en [DESIGN.md](../../DESIGN.md), §8 "Usage norms (measured)".

## Objetivo

Los componentes de `@crate/ui` deben usarse sin retocarlos. Cuando varios llamadores repiten la
misma clase, al componente le falta una opción o tiene mal un valor por defecto. La corrección va
al componente, no a cada pantalla.

## Qué cuenta como override

| Tipo | Ejemplos | Tratamiento |
| --- | --- | --- |
| Layout del llamador | `w-full`, `min-w-0`, `col-span-*`, `order-*`, `self-*`, `flex-1` | Se queda: es posición en el contenedor |
| Geometría, color, tipografía y espaciado propio | `min-h-11`, `h-9`, `pl-9`, `sm:max-w-xl`, `bg-accent-action/10`, `mt-1` en un label, `rounded-*` | Se absorbe en el componente; objetivo cero |
| Receta de producto | `jam-*`, `home-hero-*`, `stats-*` | Se queda en la app; no entra en el componente compartido |

## Decisiones de Diego (2026-10-25)

- 44px solo con puntero táctil, que ya incorporan los controles compartidos. Con ratón, los
  controles vuelven a 32px (`sm`) o 40px (default), también en Admin, que no es una app móvil.
  Se eliminan los `min-h-11` de llamador.
- La escala de título de página estándar es Bricolage 800, `clamp(2.25rem,4vw,3.75rem)`.
- El radio del botón no se cambia en este plan: el compartido sigue en 4px y Listen sigue en 6px
  por override global.
- `InfoBadge` conserva sus seis tonos.

## Fase 0 — Medir y bloquear

- Crear `scripts/design-system/override-inventory.mjs`.
  - Parsea con la API de TypeScript todos los `.tsx` de producción de `app/listen/src` y
    `app/ui/src`.
  - Para cada elemento JSX importado de un componente compartido, extrae sus props y los tokens
    de `className`.
  - Clasifica cada token en una categoría: radius, height, width, padding, margin, bg, border,
    textColor, textSize, font, shadow, layout u other.
- Crear `scripts/design-system/override-budget.json`: el recuento por componente y categoría,
  excluyendo layout y las recetas de producto.
- Añadir un test, junto a `drift-inventory.test.mjs`, que falle si un recuento sube. Los techos
  solo pueden bajar.

## Fase 1 — Adoptar lo que ya existe

No cambia ningún componente compartido.

| Hueco | Sitios | Corrección |
| --- | --- | --- |
| `min-h-11` en `Button` (Admin) | 82 | Quitar. Revisar alineación en filas con controles mixtos |
| `min-h-11` en `FilterChip` (Admin) | 4 | Quitar |
| Buscador de icono más `Input pl-9` (Admin) | 13 | `SearchInput` |
| `InfoBadge` con colores de tono a mano (Admin) | 9 | `tone="accent"` / `active` |
| `Card` con `border-border-quiet bg-card` redundante (Admin) | 12 | Borrar las clases |
| Márgenes en `MonoLabel` | 46 | `gap` en el contenedor |
| Clases no definidas: `bg-canvas-surface` (11 archivos), `text-text-main`, `--color-popover-surface` | ~30 | Token real equivalente, verificado visualmente |

## Fase 2 — Dar al componente la opción que falta

Cambia componentes compartidos: cada uno actualiza su entrada del showcase, su story y sus tests,
y para en una revisión visual de Diego.

| Componente | Hueco medido | Cambio |
| --- | --- | --- |
| `DialogContent` | 20 de 22 usos fijan el ancho con clases | Prop `size` sobre `data-overlay-size`, como `AlertDialog`; migrar los usos |
| `MediaCover` | Tamaño vía `className` (48/56/64/88/96px) | Prop `size` semántica; migrar los usos |
| `AppModal` | 7 de 16 añaden flex y `max-h` al panel | Que el panel lo traiga por defecto |
| `TabsList` | 5 añaden `w-full max-w-full min-w-0` | Valor por defecto |
| `EmptyState` | 11 con padding vertical propio | Padding del componente; quitar el local |
| `Checkbox` en `FormField` inline | 4 con `mt-0.5` | Corregir la alineación en `FormField` |
| `SectionHeader` | 6 con `mb-3`/`mb-4` | Separación del propio componente o `gap` del contenedor, según la revisión |

## Fase 3 — Casos grandes, por separado

- `PageHero`: overrides de `contentClassName` y `artworkClassName` en cada uso. Requiere su propio
  análisis de variantes.
- Migrar el `Badge` de shadcn a `InfoBadge` (43 usos en Admin).
- Migrar el `PageHeader` de Listen y el PlaylistEditor de Admin a la escala de título 800.
- Admin `ConfirmDialog variant="destructive"` → `tone="danger"`.

## Verificación por bloque

- Tests focalizados de los componentes y consumidores tocados (Vitest `--maxWorkers=1`).
- `npm run design-system:showcase:check` cuando cambie un componente compartido.
- El inventario de overrides debe bajar en la categoría tratada y su techo actualizarse a la baja.
- Revisión visual en Admin (`:5173`) y Listen (`:5174`) antes de cada commit.
- Validación completa una sola vez al cerrar el plan.

## Estado (2026-10-25)

- **Fase 0 hecha.** `scripts/design-system/override-inventory.mjs` + test + `override-budget.json`,
  `npm run design-system:overrides` y paso de CI. Los iconos de `@crate/ui/icons` no cuentan.
- **Fase 1 hecha salvo los márgenes de `MonoLabel`** (pendiente de decisión de Diego):
  - 82 `min-h-11` de `Button`, 4 de `FilterChip` y casos especiales (Shell → `size="icon"`,
    Users "Generate" → `size="xs"`, Download y Jam sin alturas redundantes).
  - 15 buscadores de Admin → `SearchInput` con `onValueChange`, `label` igual a la etiqueta
    visible; política de iconos actualizada (12 aprobaciones de glifo `Search` retiradas).
  - 10 `InfoBadge` → `tone`; 12 `Card` sin clases redundantes.
  - `bg-canvas-surface` (28) eliminada sin cambio visual, `text-text-main` → `text-text-primary`,
    tooltip del radar de `AudioProfileCard` con `--surface-popover` (antes transparente).
  - Overrides: 900 → 726. Admin completo en verde (2189 tests), typecheck y lint limpios.
- Fallos previos ajenos a este plan: `drift-inventory.test.mjs` (3, tokens `--visualizer-ribbon-*`)
  y el showcase de `EqBands` (cambiado en `07afc79c5` sin refrescar).

## Estado (2026-10-26)

- **Fase 1 cerrada.** Los márgenes de `MonoLabel` se quedan como layout del llamador (Diego).
- **Fase 2 hecha.** `DialogContent` y `AppModal` con `size` (sin `maxWidthClassName`), panel de
  AppModal en columna flex, `MediaCover` con `size`, `TabsList` sin clases nulas, `EmptyState`
  centrado con norma de copy y migración de los estados vacíos hechos a mano, confirmaciones de
  Admin en `FormField` inline y `SectionHeader` espaciado por su contenedor.
- **Fase 3 hecha.** `ConfirmDialog` solo con `tone`, shadcn `Badge` sin consumidores
  (`InfoBadge`), receta `crate-page-title` (800) en PageHeader y Admin, PageHero con `inset`,
  `bleed`, `artworkSize` (dos escalas) y `artworkFrame`. Se retiran el saludo y la fecha de la
  Home de Listen.
- Hallazgo general: varias recetas de `recipes.css` no están en una capa y ganan a cualquier
  utilidad; muchos overrides eran código muerto.
- Overrides: 900 → 626 (158 métricas por componente y categoría en `override-budget.json`).
