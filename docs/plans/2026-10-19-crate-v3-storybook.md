# Crate UI Storybook Implementation Plan

> For agentic workers: use superpowers:executing-plans inline; stop at local1AQ, no commit/push.

**Goal:** A live, Git-tracked catalogue and design-system documentation, with mandatory updates for added/changed shared visual modules.
**Architecture:** Storybook React/Vite in tools/crate-ui-showcase imports actual @crate/ui source and tokens. Catalogue metadata links source, docs, stories and adoption/validation status; source fingerprints and a staged Git check enforce maintenance. Legacy modules start explicitly pending, not silently validated. Showcase code never enters shared/app production entries.
**Tech Stack:** Node22.23.3, React19.2.5, Vite8.1.5, Storybook10.6.2 React/Vite +docs+a11y devDependencies, existing Vitest/Playwright.
**Spec:** final 'Requisito añadido por Diego' section of 2026-10-19-crate-v3-component-reconciliation-audit.md, approved for implementation by Diego in this turn.

## Global Constraints

- Worktree /home/diego/.codex/worktrees/crate-v3-1q/crate, feat/crate_v3; preserve all prior1AQwork.
- Preview5186stays active. Storybook separate6006, localhost; no backend/cloud publication.
- Catalogue UI, docs, stories and metadata are English (Diego, later in this turn). Map the real Crate identity to the supported Storybook theme API; isolate Markdown styles from actual components.
- No runtime redesign or row-family migration. Existing defects shown honestly with known issues; do not fix by CSS in stories.
- One identity, actual fonts/tokens, app/web258bbaee unchanged; no selectable skins. Scene/layout decorators only.
- All new dependencies development-only, no shared runtime/export/dependency additions. No stories in shared tsup entries.
- Tests scoped, serial Vitest maxWorkers1 and Playwright workers1. No full suites/CI/canonical baselines.
- No commit/push/PR/merge/rebase/deploy/release. All work stops for1AQreview.

## Review Focus

- A source change cannot remain silently pending through a refreshed fingerprint; staged checks must compare previous metadata.
- Added/removed/renamed visual modules and missing docs/stories fail with actionable diagnostics; internal modules can belong to a documented family.
- Registry/index distinguish documented, adopted and validated; old pending modules are visible, not labelled complete.
- Actual component styles survive isolation, narrow widths and keyboard interaction without compensating CSS.
- Storybook remains outside source builds and peer dependencies, and both preview services survive the turn.

### Task 1: Runnable catalogue and mandatory-update policy

**Files:** tools/crate-ui-showcase/.storybook/{main.ts,preview.tsx}; showcase.css; catalogue.json; catalogue-policy.mjs and tests; scripts/design-system/check-showcase.mjs; root package/lock; shared root policy test; pre-commit/workflow integration.
**Interfaces:** validateCatalogue({files,read,previous})→diagnostics; catalogue entries with id/name/sources/fingerprints/coverage/docs/story/knownIssues. Static and staged readers reuse one validator. Storybook10.6.2 imports source and real fonts/tokens, scans fullshared/stories.

- [x] Write failing behavioural policy tests: new source, stale source, missing docs/story, fingerprint-only pending change, documented entry verification; RED.
- [x] Implement policy, baseline pending registry and build-safe Storybook configuration; pin devDependencies only; GREEN.
- [x] Wire check into rootcommand, shared selected policy test and pre-commit/staged path. Verify staged semantics in temporary Git fixture; no staging real files.

### Task 2: Foundations and first real components

**Files:** tools/crate-ui-showcase/{stories,docs,components}; README; registry entries; scoped tsconfig; browser tests/config.
**Interfaces:** entries reference stories/docs and actual source. Story titles stable, inventory page derives metadata; foundation cards read computed CSS token values, not copied color values. MDX links to same stories.

- [x] Browser RED for foundations, documentation navigation and first component stories, readable computed fonts/geometry and inventory coverage states.
- [x] Implement foundations, MonoLabel, StatusDot, StatNumber, HairlineList/Row, InfoBadge/FilterChip/SegmentedControl/GenrePill and compatibility examples. Keep original defaults/behaviour, expose known HairlineRow layout deficiency honestly.
- [x] Run scoped browser interactions (keyboard/toggle/radio/remove/counters/long labels), narrow/wide and docs navigation; GREEN.

### Task 3: Persistent review, verification and handover

**Files:** service outside repo to keep requested local server active; preview link; docs/plans masters/current-state; AGENTS policy guidance; plan and ledger.
**Interfaces:** Storybook6006active +existingpreview5186active. Maintenance command and diagnostics documented; generated production output excluded fromtracking/exports.

- [x] Build and typecheck showcase; policy/staged tests and affected primitive tests serial; validate no Storybook runtime imports/entries.
- [x] Fresh read-only review of this new scope; fix Important/Critical once with RED→GREEN; record limitations/rulings/minors.
- [x] Update handovers/catalogue guidance and open deliverable for Diego. Stop1AQuncommitted.

## Resultado local y límites de revisión

Storybook está disponible en6006, con contenido y navegación en inglés y tema de Crate obtenido
del registro de identidad real. Preview5186activo, con enlace al catálogo. No hay cambios a los
118anchors de producción en este bloque. La documentación inicial cubre10fichas;81pendientes.
El esquema/CLI, índice staged y comparación histórica tienen22casos verdes. El lote completo
focalizado suma144/144en11archivos;10/10casos de navegador cubren estilos reales en stories y
MDX, fuentes, teclado, anchos390/1200, inventario y navegación. Tipos/build/lint verdes. Admin
permanece526389Bgzip/532480; dependencias Storybook solo de desarrollo.

Revisión independiente del nuevo tooling: tres Important de enforcement y la muestra de fuente
reclasificada Important corregidos con RED→GREEN. Menor aplazado: props interactivos reales y
modo tabs de SegmentedControl; está declarado en su ficha. La adaptación posterior a inglés y
la identidad propia se verificó con regresiones de navegador y revisión visual del autor.

Decisiones: conservar el trabajo1AQ previo sin atribuirle esta revisión; no corregir HairlineRow
en stories; Node22 y cuatro paquetes Storybook fijados como devDependencies; Vite8 usa
holdUntilCrawlEnd=false por el arranque virtual probado; registrar los cinco transitivos compatibles
resueltos por npm; mantener pendientes adopción completa/AT/nativo/canónicas. El cambio de idioma
renombra los IDs iniciales no publicados; no sustituye checkpoints históricos. No se ha ejecutado
CI, stage, commit, push, PR, merge, rebase, deploy ni release en el checkout de trabajo.

Evidencia en `.artifacts/review/1aq-storybook-*`; ledger de ejecución en
`.superpowers/sdd/2026-10-19-crate-v3-storybook/progress.md`. El ledger se conserva por la parada
sin commit solicitada. Siguiente acción: revisión de Diego en1AQantes de completar más familias
R0o retomar migracionesR1–R4.


### Extensiones autorizadas en la misma revisión

Diego pidió inglés e identidad Crate, agrupación funcional y luego autorizó empezar R1 por
HairlineRow. Las91entradas tienen categoría principal; las10fichas CSF conservan meta.id estable
para que mover categorías no rompa URLs. Storybook 18/18 tras el arreglo compartido y su ajuste tipográfico;
ver estado vigente y plan Hairline para los límites posteriores a la entrega inicial de tooling.
La frase anterior de «118anchors sin cambios» describe solo R0: la primera R1 modifica HairlineList.
No se ha publicado ningún cambio. Se conserva el menor explícito de SegmentedControl.
