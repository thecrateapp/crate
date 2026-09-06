# Implementation Plan: Listen Design System

## What We're Building

Vamos a completar el design system de Listen partiendo del frontend actual, conservando su identidad como `default` y eliminando el drift visual y estructural que dificulta mantenerlo. El sistema soportará themes y skins desde el contrato inicial: los themes resolverán modo y accesibilidad; los skins expresarán identidad visual sin modificar layout ni comportamiento.

La implementación será incremental. Cada corte migrará un área concreta, conservará el comportamiento funcional y aportará inventario, tests, revisión visual y controles automáticos suficientes para demostrar que el área queda más limpia.

## Decisions Made

| #   | Decision                    | Choice                                                     | Category  |
| --- | --------------------------- | ---------------------------------------------------------- | --------- |
| 1   | Token architecture          | B+C: contrato semántico con resolver runtime ligero        | Technical |
| 2   | Theme and skin model        | B: themes y skins ortogonales                              | Visual    |
| 3   | Skin surface area           | B: tokens de identidad visual, sin layout                  | Visual    |
| 4   | Default parity              | B: paridad perceptual                                      | Visual    |
| 5   | Token governance            | B: registry, lint, allowlist y CI                          | Technical |
| 6   | Component architecture      | B: capas con contratos explícitos; C como evolución futura | Technical |
| 7   | CSS consumption             | A: CSS variables + Tailwind semántico                      | Technical |
| 8   | Migration and quality gates | A: cortes verticales con gates                             | Technical |

## Estado verificado

Última verificación: 2026-09-06, rama `codex/listen-design-system`.

Ya está implementado y validado:

- inventario reproducible de drift con allowlists propietarias y fecha de revisión;
- contrato de tokens semánticos para superficies, texto, estados, interacción,
  sombras, motion y visual recipes;
- consumo CSS/Tailwind semántico y conteo de consumidores reales, incluidos los
  bridges `@theme`;
- scope explícito de Listen mediante `data-crate-app`;
- resolver runtime de theme/skin con registry, matriz de compatibilidad, fallback
  y persistencia local;
- `dark + default`, `dark + aurora` y `high-contrast + default`;
- selector accesible con radios nativos, descripciones traducidas y explicación
  de combinaciones incompatibles;
- reduced motion existente y contrato de contraste base para el theme accesible;
- gates automatizados de drift, typecheck, lint, i18n, build, tests y React Doctor.

Pendiente antes de cerrar el plan:

- completar la revisión/migración de las áreas visuales de alto impacto que aún
  conservan recipes específicas legítimas;
- terminar la auditoría de ownership entre primitives, composites, domain y
  páginas, eliminando imports directos no justificados;
- hacer revisión visual del default y aurora en desktop/mobile, reduced motion y
  high contrast;
- ampliar la matriz WCAG AA a todos los estados interactivos y skins;
- actualizar las pantallas de referencia y cerrar el inventario final de drift.

## Implementation Steps

### 1. Baseline e inventario automatizado

- [ ] Congelar el inventario inicial de raw colors, utilities, inline styles, imports, tamaños de archivos y suppressions.
- [ ] Clasificar cada hallazgo como tokenizable, estado semántico, valor dinámico, vendor override o excepción legítima.
- [x] Definir el formato de allowlist con propietario, motivo, archivo y fecha de revisión.
- [x] Añadir un check reproducible para comparar el drift antes/después de cada corte.
- [ ] Registrar pantallas de referencia del default para Player, Shell, Home, Library, Artist, Album, Settings, Stats y Jam.

### 2. Contrato de tokens y runtime

- [ ] Definir tokens primitive mínimos y tokens semánticos consumibles por componentes.
- [ ] Consolidar surfaces, text, borders, accent, state, focus, motion, radius, shadow, spacing y typography.
- [ ] Separar el scope de Listen del shared UI con atributos de aplicación sin alterar Admin accidentalmente.
- [x] Crear el resolver runtime de `theme` y `skin` con registry, validación, fallback y persistencia local.
- [x] Establecer `dark + default` como combinación inicial y respetar reduced motion/contrast.
- [x] Mantener CSS variables como runtime; no introducir CSS-in-JS.

### 3. Primitives y composites canónicos

- [ ] Auditar y consolidar Button, ActionIconButton, Modal, Popover, Select, Input, Tabs, Card, Row, Badge y estados de carga/error.
- [ ] Definir variantes tipadas y slots; evitar nuevas boolean props acumulativas.
- [ ] Establecer dependencias permitidas entre primitives, composites, domain y páginas.
- [ ] Decidir por componente qué pertenece a `@crate/ui` y qué queda específico de Listen.
- [ ] Añadir tests de render, estados, teclado, focus y contrato de tokens.

### 4. Migración por áreas de alto impacto

- [ ] Player surfaces: PlayerBar, FullscreenPlayer, ExtendedPlayer, queue, lyrics, EQ, seekbar y visualizers.
- [ ] Shell y navegación responsive: sidebar, topbar, mobile dock y overlays.
- [ ] Home y discovery: cards, sections, empty/loading/error states.
- [ ] Library, Album, Artist y Playlist: list rows, metadata, artwork y acciones.
- [ ] Settings, Stats, Jam y social surfaces.
- [ ] Sustituir hardcodes por tokens semánticos y extraer páginas/contexts que excedan responsabilidades razonables.

### 5. Clean code y performance

- [ ] Dividir archivos grandes por responsabilidad, empezando por `JamSession`, `PlayerContext`, `HomeDiscoverySections`, `Settings` y `PlayerBar`.
- [ ] Reducir inline styles a valores calculados allowlisted; eliminar duplicación de estilos y helpers.
- [ ] Eliminar imports directos no justificados de primitives base desde features.
- [ ] Revisar `any`, non-null assertions, suppressions y efectos con dependencias incompletas.
- [ ] Pausar o degradar RAF cuando la pestaña no es visible o el usuario prefiere reduced motion.
- [ ] Mantener artwork, canvas, valores de audio y vendor overrides como excepciones documentadas, no como tokens falsos.

### 6. Quality gates y rollout

- [x] Lint de drift para colores, opacity utilities, inline styles y imports prohibidos.
- [x] Typecheck, ESLint, Prettier y tests Vitest/Testing Library por corte.
- [x] Tests de resolver, fallback, persistencia y combinaciones theme/skin.
- [ ] Revisión visual del default en desktop, mobile, reduced motion y high contrast.
- [ ] Verificar contraste WCAG AA en tokens de texto, controles y estados.
- [x] Añadir al menos un skin adicional para probar que el contrato no depende de valores del default.
- [x] Cerrar cada corte con métrica de drift, excepciones revisadas y lista de regresiones conocida.

## Definition of Done

Listen se considerará limpio cuando no existan nuevos hardcodes sin allowlist, los componentes consuman tokens semánticos, las excepciones dinámicas estén aisladas y explicadas, las capas de componentes tengan ownership claro, los archivos críticos estén separadas por responsabilidad, y CI compruebe tipos, lint, tests, accesibilidad y contrato de themes/skins. La paridad será perceptual: se preservará la identidad actual, no cada duplicación accidental.

## Out of Scope

- Rediseño de IA, navegación o funcionalidades de Listen.
- Rediseño de Admin, salvo cambios de shared UI necesarios y controlados.
- Editor libre para que usuarios creen combinaciones arbitrarias.
- Skins que cambien layout, densidad, tamaños interactivos o comportamiento.
- Reescritura completa de Listen en una única rama.

## Future Evolution

La opción C de componentes polimórficos queda como posible evolución para casos concretos, después de validar que los contratos actuales no cubren una necesidad real. También queda abierta una futura personalización avanzada, pero solo con validación de contraste, snapshots visuales y un modelo de compatibilidad explícito.
