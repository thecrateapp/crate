# System Playlists icon retirement — checkpoint 1AP

Execute inline with superpowers:executing-plans, focused TDD and one final fresh review.
Diego approved1AO, metadata400 and title-right icon-only view controls were validated and
published as ba63836d2a23bb774832c1703eab4e4116e1468f. Stop1AP uncommitted for review.
Spec: DS1.7/1.2/field8px,1V inventory and explicit UX amendments. This group is Playlists.tsx
and the existing Admin PlaylistArtwork wrapper. PlaylistEditor remains a later icon group;
its artwork consumer is affected/tested. Shared artwork needs one additive decorative-icon
opt-out with defaulttrue, Admin pinsfalse after spread; Listen retains default icons/transport.
No app-specific foundation style, dependency, SmartMix integration or data/API/auth change.

## Diego amendment — row hover surfaces, 2026-10-19

Diego requests no background illumination on playlist rows or any other row. Extend1AP with
shared TableRow/EntityRow/HairlineRow, track/table/interactive/profile row CSS and explicitly
inventoried Admin/Listen list rows (scripts/design-system/row-hover-scope.json). Remove only
pointer-hover fills and the home row artwork opacity lift; keep base/offline/selected/active/
focus surfaces, buttons/menu option interaction, grid cards, playback halo/ring/trail and all
data/events untouched. Scope is a single style amendment, not another page icon migration.
Prove shared/local row policy RED→GREEN, actual pointer backgrounds in browsers, selected row/
keyboard behavior and existing affected row/artwork consumers in both apps/Desktop aliases.
AST audit requires all other source text identical for these additional files. No full suites;
repeat Admin/preview builds and budget only because these new user changes invalidate the build.

## Review focus

- Preserve SystemPlaylist/filter/rule types and constants, state/effect/dependency logic,
  mode/category/query filters/counts/order, fetch-error behavior, route/sidebar/palette gate
  curation.playlists.write, every existing create/static/smart validation/payload/default,
  toggles/status/delete/confirm/toast/refetch/navigation contract and task-generation behavior.
  Existing smart rules are unchanged; do not integrate SmartMix or redesign the editor.
- Retire redundant header/empty/composer/labelled icons and ArrowRight beside Open editor.
  Activate/Deactivate/Delete/Remove rule become named text actions with contextual accessible
  names; keep original callbacks/disabled conditions. Preserve6concrete UX sites: search,
  3loaders,2panelcloseX. Shared ConfirmDialog1/AdminSelect4 sites bounded; actual cover/brand
  image/collage content stays, decorative fallback musical glyph disabled only in Admin.
- Shared PlaylistArtwork additive showFallbackIcon defaulttrue, no gradient/image/mark/URL/
  transport changes. Admin wrapper omits that prop from its public type and pinsfalse after
  spread. Inspect actual Listen/Admin/Editor callers; shared/default and real Listen wrapper
  scoped tests prove unchanged default, images/collages and CrateImage canonical transport.
  Source policy checks Playlists and Admin wrapper directly, exact false opt-out only.
- Diego additionally requests uniform row chips: remove local11px overrides, retain shared badge
  geometry/font and state colors; computed browser equality regression RED before fix.
- Bricolage headings at20px+, Poppins compact headings/rows/body, JetBrains metadata400. Every vertical label/control uses
  crate-form-field actual8px; keep shared chips/selectors and field values. Action groups wrap,
  44px action targets; no individual gap margins, new shared skin, URL or widget contract change.
- Actual Playlists page in standalone/persistent specimen: importer-only fictional API/image
  boundaries, full response-shaped fixtures, manual reads/mutations/failures, local route
  placeholders for editor navigation. Crate logo bytes copied from existing Admin asset into
  preview public path, not a new mark. No actual backend, external media/auth/preferences or
  library mutation. BuiltAdmin uses actual route/capabilities and request fixtures.
- Scoped serial Vitest --maxWorkers=1 in Admin/shared/Listen affected callers; existing Playlists
  and PlaylistEditor tests plus new focused behavior/policy tests. Preview/builtAdmin Chromium
  1440/768/390 workers1, static and smart composers, filters/actions/confirm/busy/failures,
  artwork defaults/branding, keyboard, fonts400,8px geometry and overflow. Strict scoped types,
  lint, literal-preserving AST contracts, app/preview builds and initialJS<=532480Bgzip.
- Earlier Users stickyheader/sharedSelectlabel minors stay;1AO typography Minor nowresolved.
  Canonical1M33PNG/manifest/pin258bbaee retained. A20/phase6.8/global1b.8 incomplete. No fullsuite/
  CI/baseline refresh/native/live certification. No nextgroup/commit/push/PR/merge/rebase/deploy/
  release before1APreview. One fresh read-only pending-package review, one tested Important/
  Critical fix pass; Minor deferred and every declined behavior ruled/costed in ledger/handover.

### Task 1: System Playlists and artwork opt-out

- [x] Shared/Listen/Admin consumer tests and source policy RED before implementation.
- [x] Minimal rendering/opt-out implementation, scoped unit GREEN without data/handler changes.
- [x] Actual standalone/persistent page and scoped builtAdmin browser checks.
- [x] Types/lint/AST/builds/budget/format, six plans and handover with evidence/limits.
- [x] Fresh review, one scoped repair pass, actual IAB proof and stop 1AP with preview active.

## Diego amendment — smart-rule operator selects, 2026-10-19

Replace only Operator segmented chips with existing shared AdminSelect in both create-smart
Playlists and PlaylistEditor. Keep exact ops arrays, value, field/operator reset callbacks,
validation and request bodies. No clear/empty option. This explicit user amendment overrides
the short-selector-chip rule at these two fields only. Actual8px Field wrapper stays.
Unit RED in both actual pages before change; keyboard selection/focus/reset/save and numeric
Between create payload must pass. Playlists policy now4bounded AdminSelect sites. No other
PlaylistEditor icon migration; the editor remains the next group.

## Final review ruling and audit

Fresh review: Critical 0 / Important 0 / Minor 4. The four directly requested behavior gaps
were closed in one tested pass under Diego's completion requirements; no second review. This
explicit ruling supersedes the generic Minor-defer sentence above for those four items only.
All declined-to-certify behaviors have executor rulings and costs in both handovers/ledger.
Final row scope: 45 roots / 33 TSX files, plus offline helper/four CSS recipes. Final bundle
526379 / 532480 B gzip, 6101 B margin. Stop local 1AP without commit/push.

Diego's follow-up audit covers any deviation, including architecture/data, UX/accessibility,
components/tokens, typography, geometry, copy, documentation, validation and scope. See
[the read-only report](2026-10-19-crate-v3-plan-audit.md). Findings are recorded without silently
implementing another migration or claiming phase completion.

## Diego approval — audit reconciliation, 2026-10-19

Diego authorizes correcting confirmed audit findings in their proposed order, keeping the
preview active and stopping at 1AP before commit. This supersedes the earlier read-only limit
for A1–A4/A6–A8. A5 is assigned an owner and page phase as the audit proposes; it does not
authorize a wholesale redesign of inherited panels. Existing native exceptions, data, handlers,
actions, permissions, UX glyphs, 8 px fields, checkpoints, pin and canonical evidence remain.
Use inline execution/TDD and one fresh final review of this amendment. Retain earlier review
freezes as historical evidence; final validation stays affected-only and serial.

### Task 2: Contrast and typography reconciliation (A1–A3)

- [x] Browser RED for the active Playlists count, Mono roles and compact display headings.
- [x] Minimal consumer fixes: inherit the pill foreground, Mono 400 in monospaced Badge callers
      and Translations, Poppins compact titles without changing their sizes. Keep legitimate
      Bricolage numerals at 16 px+, display titles at 20 px+, native exceptions and shared Badge.
- [x] Browser GREEN at 1440/390 including User Detail, Translations editor and expanded Health
      checks. Retain actual components/API fixtures; no data/handler edits.

### Task 3: Tag geometry and Translations copy (A4/A7)

- [x] Browser/shared component RED for inherited font weight/line-height and wrapping; actual
      Translations page test for zero/one/multiple published bundles.
- [x] Keep one shared static CrateChip recipe, remove redundant local geometry overrides in
      Analysis and Users. Preserve interactive pill targets, semantic colors, icons and content.
- [x] Affected Admin/shared/Listen tests and browser GREEN; no new runtime dependency or variants.

### Task 4: Prevention and documentation (A6/A8, A5 ownership)

- [x] Guard tests reject confirmed class misuse, including aliases/conditional classes; run the
      Admin guard in its normal scoped Vitest chain and CLI inventory. No budget ceiling increases.
- [x] Add a single current-state table, link the six plans/handovers and mark superseded local
      stops as historical. Give A5 residual categories an owner, phase and acceptance criterion.
- [x] Update audit dispositions and persistent 1AP review links. Scoped types/lint, affected
      tests/browser, app/preview builds and bundle budget; fresh review, one tested repair pass
      if required, actual IAB proof. Stop uncommitted at 1AP with preview service active.


Final audit-reconciliation review: Critical0/Important0/Minor2; both new A6 prevention gaps
(variant-prefixed utilities and lexical constant shadowing) closed in one tested pass,19guard
cases/17Node cases/CLI/types/lint green. UI remains the validated17preview+6builtAdmin build,
526377/532480B gzip,6103Bmargin. Full final review rulings and costs are in both handovers.
See the single current-state table; **stop1AP uncommitted, previewactive5186**.


### 1AP approved — publication preparation, 2026-10-19

Diego approved the final1AP and explicitly authorized commit/push followed by PlaylistEditor,
with functional UX preserved and the preview active. All77approved source/asset hashes match
before publication metadata changes. The persistent1AP label/footer now say published; only
its embedding expectation changes. Earlier1AP local stops are historical. The next checkpoint
is1AQ, to stop uncommitted for Diego; no PR/merge/rebase/deploy/release or fullCI/baselines.
The resulting verified publication SHA is recorded in the subsequent1AQ continuation record.
