# PlaylistEditor icon retirement — checkpoint 1AQ

Diego approved1AP and authorized commit/push and this next group. Published1AP is
`d30b1c0244e5f57026dea3f27aacae815c04b41b`. Use the existing isolated worktree and branch;
stop1AQ without commit for review, preview active5186. No next group, PR/merge/rebase/deploy/
release, Smart Mix integration, fullsuite/CI or canonical refresh. Preserve earlier checkpoints.

Use superpowers:executing-plans inline, focused TDD and one fresh read-only final review.
Spec: DS1.7/1.2/8px fields/static tags, approved UX exceptions and1AP reconciliation.

## Review focus

- Scope is PlaylistEditor.tsx rendering, the explicitly amended Playlists creation fields/actions,
  and directly affected existing consumers/policies.
  Preserve interfaces/constants/helpers, hooks/dependencies/SSE identity and cleanup, unsaved
  form behavior, static/smart gates, route capability curation.playlists.write, all API paths,
  request bodies, validation, toast/refetch/navigation/drag identities and refinement contracts.
  The existing API/worker remains unchanged; no extra backend reads, persistence or integration.
- Retire decorative cover/rules/tracks headings and labelled Duplicate/Preview/Generate/Save/
  Upload/Remove/Add/Apply glyphs. Basic Remove rule/track/cover actions use named icon-only Trash2 buttons per Diego’s later
  amendment, retaining callbacks. Keep16direct editor UX sites:10loaders,1back ArrowLeft,1Search,
  1GripVertical drag handle and3basicRemove glyphs; creation adds1Remove rule site.
  Mark them aria-hidden with bounded data-admin-ux sites. Existing AIButton loading and shared
  Select disclosure/search/selection glyphs stay via2/7bounded consumers; artwork2sites delegate
  to the approved Admin wrapper, preserving cover/collage/Crate mark and Listen behavior.
- Native actions44px, descriptive accessible names, H1Bricolage>=20px, compact titlesPoppins,
  metadata/labelsMono400, static CrateChip default geometry without local font-size overrides.
  Read-only MetricTile label/value and all fields use real8px crate-form-field, no local margins.
  Category/Match/Sort use sharedSelect in creation and editor (7sites); preserve values, options,
  explicitNone/null category, defaults and callbacks. Filters/state toggles retain chips.
  Responsive forms/actions/rows preserve content and avoid overflow1440/768/390; preserve quiet
  row backgrounds, selection/drag feedback and functional glyphs. A5surface adoption remains
  explicitly assigned to6.8; do not redesign every inherited panel during this icon group.
- Actual page in persistent/standalone specimen, with importer-only API/useApi/LLM/SSE fixture
  boundaries. Full response-shaped local data, explicit manual pending/failure/SSE controls,
  static/smart/loading/missing/failed states, cover upload/remove, preview distributions, track
  search/add/remove/reorder, AI description/refinement/apply/dismiss and navigation placeholders.
  No live/backend/external requests, preferences or library mutations; no global EventSource patch.
- Focused Vitest maxWorkers1, preview and builtAdmin Chromium workers1, actual routes/gates and
  request payloads, keyboard/focus, busy/errors, source policy and extended Admin consistency
  guard with exact inherited surface owner record. Strict scoped types/lint, AST contracts,
  Admin/preview builds and <=532480Bgzip initial JS. One final independent review; one tested
  fix pass if needed, every declined behavior ruled/costed. Retain canonical1M/pin258bbaee.

### Task 1: Editor actions, specimen and bounded verification

- [x] Write focused real-page tests and source-policy/consistency RED before rendering edits.
- [x] Minimal rendering, typography/tag/8px corrections and bounded UX/control policy GREEN.
- [x] Actual persistent/standalone editor specimen and full local fixtures, consumer tests and
      builtAdmin gate/request checks, including manual failures and existing SSE contracts.
- [x] Scoped types/lint/AST/builds/bundle, update six plans/handover/current table and limits.
- [x] Fresh read-only review, one scoped repair pass if necessary, actual IAB proof and stop1AQ.

## Later user steering — 2026-10-19

Diego explicitly allows conventional basic actions such as Remove to be icon-only; Remove
cover/rule/track and create-rule use shared Button icon-lg (44px), name/title and Trash2. He
requests Select for Category, explicitly confirmed Match/Sort too, in creation and editing.
This overrides the earlier short-choice policy for these seven form controls. Other filters
and state toggles remain unchanged. An action icon inventory is requested for all Admin:
see [reviewed sites and proposals](2026-10-19-crate-v3-admin-action-icons.md). It proposes future
groups without applying them wholesale during1AQ. This amendment is part of the same review.

Final local stop: one fresh same-seat reviewer reports no remaining Critical/Important/Minor
findings, including the later amendments/inventory. The fixture duplicate-row-ID Minor was
reproduced and fixed. Evidence and nine declined-behavior rulings are in the latest handover
and this plan’s ledger.1AQ remains uncommitted; previewactive5186; no further group.

### Task 2: Search scope feedback within the same local 1AQ

- [x] Reproduce the search icon14px displacement before the fix.
- [x] Replace the remaining scope chips with shared Select; keep its defaults, values,
      callback, query semantics and static-playlist disabled gate.
- [x] Natural-height icon wrapper, aligned controls, two8px Field recipes, accurate scope copy.
      Shared form height40px fine/44px coarse; no local Select height override. Eight total
      amended form Select sites across creation/editor, including the new Search scope;
      all editor shared Select consumers7, including existing Field/Operator/Value controls.
- [x] Focused regressions, types/lint/build/bundle, updated action anchors and same-seat review.
- [x] Actual preview screenshot and final local stop1AQ, without commit or next group.

Later height feedback: RED1aq-form-height-red.log reproduces40expected/44actual on the
editor's Name input. Remove six local Input min-h-11 overrides (Name, Featured rank, Limit,
minimum, maximum, text/numeric rule value). Shared form40/44 remains authoritative; creation
already conforms. Regression checks every mounted input/Select, including between/text rules.

Final feedback validation: 52 affected Admin unit/policy cases and8short-Select policy cases
GREEN;7geometry/workflow browser cases (1310/768/390 fine,390coarse and creation1440/768/390)
and4builtAdmin editor capability/payload cases GREEN. Strict scoped types/lint and Admin build
pass; initial JS526295Bgzip/532480, margin6185B,9assets. AST122/66/94contracts unchanged
with the explicit scope-adapter disabled-gate equivalence. Current42action anchors/hashes
refreshed; historical1V/canonical1M untouched. Same-seat read-only delta review has no remaining
findings; its sole test-fixture premise Minor was corrected (12/12GREEN) without changing the
production default. IAB proof: checkpoint-1aq-form-heights.png and checkpoint-1aq-search-corrected.png.
The pre-existing async-loading scope default can differ from a synchronous mock; preserved here.
No live/backend/native/AT/fullsuite/CI certification. Preview remainsactive5186; stop1AQ
UNCOMMITTED for Diego, preserving all earlier checkpoints and original open owning-phase debt.

### 1AQ responsive rule row feedback — 2026-10-19

Campo, Operador y Valor comparten fila cuando la tarjeta dispone de 576 px; se apilan por debajo
de ese ancho. La condición usa el contenedor real de cada regla en creación y edición, evitando
el breakpoint de viewport que apilaba los campos dentro del iframe pese a tener espacio. Se
conservan las columnas 180 px / 160 px / resto, los 8 px bajo etiquetas, las alturas compartidas,
los glifos y todas las acciones/datos. Continúa el mismo 1AQ local sin commit, preview activo.

### Task 3: Rule row responds to available width

- [x] Reproduce three rows in a1128px frame despite enough rule width.
- [x] Four class changes only: @container and @xl rule grid in editor and creation.
- [x] Eight geometry/workflow cases, numeric-range and text values, fine/coarse pointers.
- [x] Same-seat read-only review: no actionable defects in this delta.
- [x] Exact embedded mockup, affected units/policies, types/lint, build/budget, actual IAB proof.
- [x] Refresh current inventory hashes/continuation evidence and stop1AQ without commit.

### 1AQ header standard and applicability — 2026-10-19

Diego approved compact header actions at the upper right, without border/permanent fill, using
shared Button ghost/icon-lg44px, Tooltip and descriptive accessible names. PlaylistEditor moves
Back outside identity, aligns its112px cover with copy, and uses Copy/Eye/ListRestart/Save with
existing callbacks, smart/static gates and busy states. Header layout follows available width;
Save + generate keeps its dynamic name. The later question about arrow-only Back is recorded
as a proposal; the actual Back text/destination remain unchanged.
The [standard and18-page applicability audit](2026-10-19-crate-v3-admin-header-actions.md) records
1applied reference,10Refresh candidates,6workflow adaptations and1page without actions. Other
headers are analysis only. The action inventory is now45sites:8applied,22proposed,15owning-phase;
current scan163lexical candidates/52files, including Preview. No historical1V/1M rewrite.
Keep the same local1AQ review stop, no commit/push or next group; preview remainsactive5186.

### Task 4: Header feedback and standard

- [x] RED Back remains inside identity; move it above the hero and align fixed112px artwork/copy.
- [x] RED header actions still textual; explicit amendment uses four shared icon-lg ghost actions.
- [x] Latest steering moves actions to the upper right; preserve dynamic name/tooltips and busy.
- [x] Five responsive/keyboard/tooltip cases; source-policy names are bounded to four exact sites.
- [x] Standard documented; inspect18existing headers and propose groups without migrating them.
- [x] Final affected tests, types/lint, build/budget, same-seat delta review and actual IAB proof.
- [x] Refreshed inventory/evidence and same uncommitted1AQ stop.

Final local evidence after rule/header/standard feedback: 63 affected Admin unit/policy cases
GREEN (new toolbar13/13 after removing unsupported Testing Library exact options),11real-editor
preview cases GREEN including exact1464host iframe and five responsive/focus/tooltip cases,
4builtAdmin gate/payload cases GREEN. Earlier creation-rule geometry3/3 remains valid; no new
production change there after its check. Strict scoped types/lint and Admin build pass. Bundle
526326Bgzip/532480, margin6154B,9initialassets. AST122non-render/66API-hook/94bindings unchanged
with the previously recorded scope-adapter gate equivalence. Header adds four specifically
registered UX sites (editor20direct, whole reviewed scope123), no new shared runtime.
Same-seat read-only review: no actionable production/standard defects; one documentary Minor
(Logs Refresh line anchor) repaired to338 and all header action anchors rechecked as exact
visible text or quoted action labels. Current action inventory45sites/8applied/22proposed/15
existing,13glyphfamilies; header applicability18files and hashes validated. No proposal was
implemented in another header; Back glyph-only remains a recorded proposal from a question.
IAB proof: checkpoint-1aq-header-standard.png and checkpoint-1aq-rule-row.png. Previewactive
5186/HTTP200; original phase/native/AT/live/canonical limits remain. Stop same1AQ UNCOMMITTED.
