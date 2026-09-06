# Listen Design System — Visual QA Matrix

Fecha de referencia: 2026-09-06  
Rama: `codex/listen-design-system`

Esta matriz registra las superficies que deben conservar la paridad perceptual
del theme `dark + default`. Las capturas puntuales pueden variar con los datos
de la biblioteca; los criterios de aceptación son estructurales y de contraste.

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

- `dark + default`: desktop y móvil; mantiene acentos cian y el contraste de
  la interfaz actual.
- `dark + aurora`: desktop; cambia identidad cromática sin alterar layout,
  densidad ni affordances.
- `high-contrast + default`: desktop y móvil; eleva texto, bordes, focus y
  estados, y bloquea la combinación incompatible con Aurora.
- `prefers-reduced-motion`: contrato automatizado en `index.css`, tokens de
  animación y `motion-availability.test.ts`; la herramienta de browser usada
  para la revisión no expone emulación de media features.

## Criterios de cierre

- El selector de apariencia usa radios nativos, labels y descripciones
  accesibles; las combinaciones incompatibles comunican el motivo y quedan
  deshabilitadas.
- Las superficies no introducen overflow horizontal en móvil y el dock no
  cambia la jerarquía del contenido.
- El theme accesible conserva una diferencia perceptible entre canvas, paneles,
  texto, focus, estados y controles destructivos.
- Los estados con transparencia se validan mediante composición con backdrop
  explícito; artwork sin color final conocido se mantiene como caso de revisión
  manual, no como falso positivo estático.

## Evidencia de esta iteración

- Preview local de Listen revisado en desktop `1280×720` y móvil `390×844`.
- Settings autenticado revisado contra una base efímera aislada: default,
  Aurora y high contrast.
- Consola sin warnings ni errores durante las interacciones del selector.
- Tests de reduced motion y contraste alpha ejecutados junto con los gates del
  proyecto.
