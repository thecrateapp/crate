# Listen Design System — Visual QA Matrix

Fecha de referencia: 2026-09-06  
Rama: `codex/listen-design-system`

Esta matriz registra las superficies que deben conservar la paridad perceptual
del theme `dark + default` y de sus variantes explícitas. Las capturas puntuales
pueden variar con los datos de la biblioteca; los criterios de aceptación son
estructurales y de contraste.

| Superficie | Ruta                       | Baseline que se revisa                                                   |
| ---------- | -------------------------- | ------------------------------------------------------------------------ |
| Player     | `/` con una pista activa   | artwork, controles, progreso, volumen, estados activo/hover y dock móvil |
| Shell      | cualquier ruta autenticada | sidebar, topbar, navegación móvil, focus y overlays                      |
| Home       | `/`                        | hero, rails, cards, loading/empty/error y jerarquía de texto             |
| Library    | `/library`                 | tabs, filtros, filas, artwork y acciones                                 |
| Artist     | `/artists/:id`             | hero, metadata, acciones, tabs y artwork                                 |
| Album      | `/albums/:id`              | header, tracklist, badges, acciones y estados de selección               |
| Settings   | `/settings`                | selector theme/skin, formularios, radios, sliders y compatibilidad       |
| Stats      | `/stats`                   | paneles, gráficos, estados vacíos y superficies atmosféricas             |
| Jam        | `/jam` y `/jam/:roomId`    | cola, presencia, controles, estados de conexión y responsive             |

## Variantes verificadas

- `dark + default`: conserva la identidad cian y la apariencia actual.
- `light + default`: invierte superficies y texto con contraste AA sin alterar
  layout, densidad ni affordances.
- `dark + crateRed`: aplica la identidad rojo/gráfica y las superficies oscuras
  del skin sin cambiar el comportamiento de los componentes.
- `light + crateRed`: aplica la misma identidad en superficies claras.
- `system + default` y `system + crateRed`: resuelven el modo concreto mediante
  `prefers-color-scheme` y reaccionan a cambios del sistema operativo.
- `prefers-reduced-motion`: contrato automatizado en `index.css`, tokens de
  animación y `motion-availability.test.ts`; la herramienta de browser usada
  para la revisión no expone emulación de media features.

## Criterios de cierre

- El selector de apariencia usa radios nativos, labels y descripciones
  accesibles para elegir modo (`dark`, `light`, `system`) y skin (`default`,
  `crateRed`). Todos los skins están disponibles en ambos modos concretos.
- Las superficies no introducen overflow horizontal en móvil y el dock no
  cambia la jerarquía del contenido.
- Cada variante conserva una diferencia perceptible entre canvas, paneles,
  texto, focus, estados y controles destructivos.
- Los estados con transparencia se validan mediante composición con backdrop
  explícito; artwork sin color final conocido se mantiene como caso de revisión
  manual, no como falso positivo estático.

## Evidencia de esta iteración

- Preview conceptual de las cuatro variantes concretas: default dark/light y
  crateRed dark/light.
- Tests del selector de Settings para DOM accesible, persistencia y migración
  de la selección legacy `aurora`.
- Tests del resolver para variantes, `system`, `matchMedia`, limpieza de
  listeners y sincronización del Toaster con el modo resuelto.
- Tests de reduced motion y contraste alpha ejecutados junto con los gates del
  proyecto. La revisión visual manual en browser queda limitada a las
  capacidades disponibles del entorno de QA.
