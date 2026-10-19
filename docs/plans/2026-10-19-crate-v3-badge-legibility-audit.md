# Legibilidad de chips, pills y badges — análisis posterior a 1AQ

Diego pide un resumen de familias y una propuesta antes de continuar. **Solo análisis, sin
cambio de estilos, componentes o contratos.** El 1AQ de cabeceras/filas está validado y sigue
sin commit/push. Esta propuesta no actualiza silenciosamente el estándar aprobado de tamaños.

## Medición real y base actual

La primera fila de `/admin-playlists-demo.html` usa ocho CrateChip iguales: JetBrains Mono400,
10px/10px de línea,16px de altura, padding2px8px, borde1px, cápsula; texto
`rgba(241,245,249,0.5)`. El filtro All5 usa CratePill: Mono11px, línea15.4px,32pxalto,
padding4px12px. No hay cambio de estilos durante esta inspección.

El plan vigente prescribe text-badge10px y text-label11px. A4/1AP unificó los tags16px y retiró
overrides de Analysis/Users; esa coherencia no resuelve la nueva petición de legibilidad. El
catálogo también expone otras bases informativas y contadores manuales aún heterogéneos.

| Familia real | Uso | Tipografía base | Altura base actual |
| --- | --- | --- | --- |
| CrateChip | Metadatos/flags estáticos: system, static, tracks, estado de generación | Mono10px |16px sin icono; el contenido puede elevarla |
| CrateBadge sm/md | Badges de estado/contenido, predominan en Listen | Hereda Poppins;10/12px |20px sm sin icono,22px con icono12px;26px md con línea16px |
| Badge de shadcn | Badge genérico usado en Admin, con6variantes y asChild | Hereda Poppins12px |26px base; muchas clases locales cambian tamaño/padding |
| CratePill | Toggle/filtro, acción o span estático según variant | Mono11px |mínimo32px,44px en puntero grueso |
| SegmentedControl | Grupo exclusivo radio/tabs con flechas y roving tabindex | Mono11px |mínimo32px,44px en puntero grueso |
| GenrePill/Row | Género con porcentaje, selección y/o retirada | Mono11px |mínimo32px,44px en puntero grueso |
| Contadores/etiquetas locales | Sidebar, rol y superpuestos; no una primitiva única | Variable |Sidebar incluye Badge con12px y rol10px; contador de cola Listen usa8px en caja14px |

Las alturas de base CSS se calculan sin overrides, con texto en una línea y las dimensiones de
iconos vigentes; no certifican cada consumidor. Badge/CrateBadge pueden cambiar al añadir
contenido. CratePill estático conserva hoy la altura de un control aunque no sea interactivo.

## Alcance y duplicación

El [inventario AST](crate-v3-analysis/badges-legibility-1aq.json) cuenta sitios JSX importados de
producción, no instancias renderizadas ni confirmaciones de drift:

| API | Admin | Listen | Otro shared |
| --- | ---: | ---: | ---: |
| CrateChip |205|1|0|
| CratePill |39|4|0|
| CrateBadge |0|51|1|
| Badge |99|0|0|
| SegmentedControl |14|10|0|
| GenrePill |1|3|0|
| GenrePillRow |3|4|1|

Hay54candidatos a overrides de geometría/tipografía, no54defectos confirmados:39Badge,
5CrateChip,6CratePill,3SegmentedControl,1CrateBadge. Incluyen usos justificados (targets de New
Releases, tabular-nums), redundancias y deuda de páginas aún en su fase. Los spans manuales,
renderers dinámicos y usos internos de las propias definiciones no se cuentan como importados.

Admin usa sobre todo CrateChip y Badge; Listen usa CrateBadge. Las tres bases informativas se
solapan en uso y tienen altura, fuente, forma y política de tono distintas. GenrePill tiene un
contrato de dominio que se conserva: nombre/porcentaje/procedencia y acciones separadas.

## Propuesta para discutir

1. Una receta informativa para metadatos, estados y contadores de fila/sidebar: **texto12px,
   línea16px, altura24px**, padding horizontal8px/vertical3px y borde1px. Mono para ese rol,
   color de texto secundario legible y contraste coherente; misma geometría en una fila. Unificar
   la base visual de CrateChip/CrateBadge/Badge y retirar su duplicación mediante sus consumidores.
2. Controles de filtro/selección: **texto12px, mínimo32px con ratón/44px táctil**. CratePill y
   SegmentedControl comparten la receta, conservando aria-pressed frente a radio/tabs. Campos
   categóricos siguen usando Select; pestañas de contenido siguen su receta subrayada propia.
3. GenrePill conserva su identidad y contrato con porcentaje; elevar nombre y porcentaje a12px
   con los objetivos32/44actuales. Sin convertirlo en tag genérico o perder el porcentaje.
4. Mantener la forma de cápsula de los chips actuales; tono, forma y color deben resolverse por
   rol compartido, sin fundamentos diferentes para Admin/Listen. Badge genérico y contadores
   locales se alinean tras revisar su contexto. Los contadores superpuestos del reproductor
   requieren su adaptación específica; no se cambian como efecto secundario de una variable.
5. Dar a cada rol una receta/token propio y quitar overrides de fuente, leading, altura y
   padding de los consumidores migrados. `text-badge` y `text-label` también aparecen fuera de
   estas cajas; un cambio global alteraría otros readouts/labels sin revisar sus contratos.

Orden sugerido tras acordar la propuesta: validar muestras reales de información24px/filtros32px,
con nombre largo, todos los estados y contadores; receta compartida y tests de ambos consumidores;
filas/headers de Admin ya revisados; consumidores de Listen y detalles restantes por su fase.
Todas las variaciones de una misma fila usan su rol correcto. Revisar contraste y wrap/altura de
filas, porcentajes, overlays, targets táctiles y bundle. Sin nuevas variantes por aplicación,
modos/temas ni cambios del pin258bbaee; sin regenerar baselines durante la iteración.

Fuentes: `app/shared/ui/primitives/CrateBadge.tsx`, `shadcn/badge.tsx`,
`primitives/SegmentedControl.tsx`, `domain/genres/GenrePill.tsx`, `tokens/typography.css` y
`tokens/recipes.css`; políticas/scoped AGENTS de shared y Listen, DS§2.2 y auditoría A4.


## Disposición posterior vigente — 2026-10-19

Diego aprobó implementar esta normalización en el mismo1AQ local. Las mediciones y la frase
«solo análisis» anteriores describen la auditoría inicial, no el estado actual. Ver colección
implementada en [ui-labels](2026-10-19-crate-v3-ui-labels.md), plan de normalización y estado
vigente. No se ha aprobado su commit. El análisis posterior de filas es una propuesta separada,
sin migración autorizada todavía.
