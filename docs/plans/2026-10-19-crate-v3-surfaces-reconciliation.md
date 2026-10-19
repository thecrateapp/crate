# Crate V3 — surfaces and containers (1AT)

Spec: approved mockup5186 + Diego's confirmed amendments; component-reconciliation-audit R1; design-system hairlines vs standalone objects. Approved1AS published9b5356862db1cef1d014c0b56c7a7e61bd7cad18. Stop before1AT commit/push.

## Scope

1. Card and its header/title/description/action/content/footer slots represent standalone objects. Solid surface-object (#0d0e14), quiet1px border, radius-panel14px, no blur/shadow. Keep24px base insets/gaps, standardize minimum-width/wrapping, preserve native props/ref/handlers; additive as semantics for root/title. Preserve the mockup's small card-title Poppins16px role rather than turn it into a page heading.
2. InstrumentPanel remains an unfilled ruled figure/section:22px top inset,20px header-to-content, MonoLabel captions, metadata/status separated, optional ruled=false. Complete visible naming even without headingLevel, description association and actions slot. Move repeated description composition from Listen Section and Admin OpsPanel into this shared contract; app data/actions stay injected. OpsPageHero/StatTile and broader page boxes remain later adoption work.
3. Separator documents existing horizontal/vertical1px subtle rules and decorative/semantic ARIA. It does not replace bordered fields or page grids.
4. Existing IconButton/ActionIconButton card variants use the same solid object surface and quiet border with no blur/shadow. Keep their fine/coarse geometry, tone/glow/state and callbacks. No play/ring/beam changes or global token retint.

## Steps

- Write focused RED regressions for Card native semantics and InstrumentPanel accessible naming/description/actions; consumer regression for OpsPanel/Listen Section. Characterize Separator semantics. Browser proof compares actual reference rules/styles and icon surfaces.
- Implement shared contracts and two adapters. Update the existing adoption debt entry only for removed OpsPanel tokens; retain remaining hero/stat/page debt.
- Document all three pending families before refreshing hashes; update the two existing icon entries. Add one SurfacesReview scene reused by standalone review-1at-surfaces.html and Storybook Reviews/1AT/Surfaces. Include object/panel separation, all Card slots, metadata/status/actions, ruled/unruled, separator orientations, long text/narrow widths, form and icon interactions. Do not grow the large mockup or add repair CSS.
- Run only affected unit/consumer/policy tests maxWorkers1; Playwright workers1 for both hosts and real consumers, relevant types/lint/builds/budgets. One fresh review of the whole checkpoint. No full suites, canonical baselines or manual CI. Preserve both previews.

## Boundaries

No mass migration of EntityCard/ShowCard/rows, page headers/heroes, metrics, dialogs or skeletons. Those have distinct contracts and will follow the requested grouping document. Card is an existing shadcn foundation; no new generic Surface wrapper. Both apps already consume InstrumentPanel; adapters stay app-local. Full/native/AT/live-backend QA remains deferred. Prior manual-browser URL policy denial is respected; no capture workaround.

## Evidence

- Implemented Card native semantics/wrapping and Poppins16/24, InstrumentPanel naming/description/actions, Separator catalogue and solid card-control surfaces. Admin OpsPanel and Listen Settings Section delegate to the shared panel. OpsHero/StatTile and other A5 consumers remain debt.
- RED shared/consumer regressions preceded implementation.41shared,36Admin,4Listen focused unit cases pass. Types shared/Storybook, scoped lint, catalogue28/93/120,25catalogue/preview/staged policy tests and both app/tool builds pass. Admin527161/532480Bgzip (5319B margin); Listen200102/307200B.
- One fresh review found missing grouping for fragment actions in OpsPanel. Corrected the shared actions slot; measured the real four Analysis buttons at390/1200. Removing the fix reproduced gap0; restoring it passes both cases. No remaining blocking finding from that review.
- Diego's review then identified loose captions (gap0) and mixed artwork control geometry (40/36). Scoped tests reproduced both defects before the fix. SurfacesReview and the affected ActionsReview samples now compose FormField kind=group with named groups and actual8px caption gaps; artwork uses two canonical IconButton card controls,40fine/44coarse with18px glyphs. No local size or margin repairs. Explicit compatibility galleries retain their contracts. Scope AGENTS/README require these checks in both hosts.
  -21surface/action browser cases pass across both hosts,390/1200,fine/coarse, plus2actual editor cases from the runtime surface change. Includes callbacks, focus, keyboard, semantic groups, computed geometry/fonts, descriptions, long content, real OpsPanel and independent approved mockup-frame geometry. No API calls in the isolated scene.
- The requested parallel [checkpoint-groups proposal](2026-10-19-crate-v3-component-checkpoint-groups.md) covers all68initial pending entries once and preserves distinct media/row/native contracts. Numbers are a pre1AT snapshot, not a second live registry.
- Both previews remain active. No1AT commit/push, canonical recording, full suite/CI, live backend/AT/native certification or manual-browser capture. Stop for Diego's review.

## Approval

Diego approved1AT and authorized commit/push on2026-10-19. The preceding local stops are
historical. Continue with1AU headers; its publication still requires Diego's review.
