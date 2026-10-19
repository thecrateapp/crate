# Admin header migration — local 1AQ extension

Diego explicitly requests migrating all18inventoried headers before another group. Reference:
2026-10-19-crate-v3-admin-header-actions.md, now an implementation scope rather than proposals.
Use the isolated feat/crate_v3 workspace and keep preview5186 active; preserve all unpublished
1AQ work. No commit/push/nextgroup/fullsuite/CI/baseline/runtimebackend change.

## Review focus

Admin-only composition from existing shared Button/Tooltip; no new @crate/ui export. Ghost
icon-lg44px actions, precise accessible tooltip/title names, busy/disabled/pressed state and
capability predicates. Header actions top right, actual-container responsiveness, intact title/
metadata/artwork, back outside identity. Every operation retains its callback and payload;
complex actions have distinct glyphs/names, final dialogs stay textual. Roles stays read-only.
OpsPageHero is also used by Tasks/Insights/Genres outside this migration: preserve its default
rendering contract and opt reviewed consumers into the compact layout. No API/SSE/hook changes.
Keep8px form fields,40/44form geometry, identity/fonts, quiet rows and artwork.

### Task 1: Reusable Admin composition and complete consumer migration

- [x] RED component accessibility/forwarding and source adoption contract.
- [x] Shared-primitive Admin PageHeader composition; opt-in legacy host with unchanged defaults.
- [x] Migrate all18inventoried pages, exact glyph policy, semantic request/capability audit.
- [x] Focused affected VitestmaxWorkers1 and serial browser geometry/actions at1440/768/390.
- [x] Types/lint/build/budget, current inventory/docs/mockup, fresh read-only review, IAB proof.
- [x] Stop within same local1AQ without commit or advancing groups.

Task1 completa en working tree, sin commit. Evidencia final:307Vitest,80casos de preview de
la extensión más45de consumidores anteriores,26del build; todas las correcciones focalizadas
verdes, sin suites completas. Tipos/lint y budget526396Bgzip verdes. Revisión independiente y
fix-pass registrados en el ledger; estado/handover conservan límites y parada1AQ. La siguiente
petición de Diego es analizar legibilidad de chips antes de continuar, sin cambio de estilo aún.
