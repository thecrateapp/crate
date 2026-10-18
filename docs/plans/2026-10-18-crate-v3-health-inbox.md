# Health issue queue — 1AD implementation plan

> Use `superpowers:executing-plans` inline, TDD and one fresh read-only final review.
> Diego approved the sketch and explicitly requested implementation and an uncommitted 1AD stop.
> His execution authorisation supersedes an additional plan-approval gate and commit defaults.

**Goal:** Show library problems and how to resolve them before secondary operational information.
**Architecture:** Recompose the real Health page around its existing snapshot, repair catalog and
task history. Preserve requests, stream identities/reconnect/cleanup, mutations, eligibility,
scan role gate and confirmation flow. Pure presentation helpers handle prioritisation and
truthful result summaries. No new shared foundation variant, backend, dependency or provider changes.
The approved drift correction below repairs only the existing shared default-border cascade.
**Tech stack:** React 19, existing shared V3 primitives/recipes, Vitest and Playwright on Node 22.
**Spec:** Diego's approved issue-queue sketch at
`.superpowers/brainstorm/873853-1792323386/content/health-inbox-v1.html` and the accepted intent:
see problems in the library and how to resolve them, using only available real data.

## Approved composition and executor decisions

One flat list groups recorded issues by check, most severe first. Each row has a readable title,
count, severity, description and a named Review issues disclosure. Expanded details show actual
cases, artist repair links, repair guidance from catalog capabilities, risk/scope and the existing
queue/cleanup/resolve/dismiss actions. A compact check timestamp replaces the hero summaries.
Activity and the repair catalog are secondary native disclosures, not prominent dashboard cards.
Remove Repair lanes, Latest repair impact and healthy-check KPI blocks.

Executor decisions: retain Admin's English UI, existing check names and actual routes. Keep type
filters reachable inside a secondary Filter issues disclosure, with visible active-filter context
and Clear filter. Use the existing pill sizes. A latest per-check run is labelled Latest check,
not evidence of a complete library scan. No issues, no result, a zero-match filter and stale
recorded data are distinct. Explicit task counters may be zero; missing counters stay unavailable.
Catalog absence permits issue inspection but does not imply manual or automatic repair support.
Counts and loaded rows may differ (existing endpoint defaults to 500); display that difference,
and never imply all cases have loaded. No invented scan stages, progress, coverage or new repair.

## Constraints

- Same isolated worktree/feat/crate_v3, base 439b3e78; preserve pending 1AD and all checkpoints.
- V3 fonts/tokens, no decorative Admin icons. Existing five functional glyph sites remain.
- Every vertical label/component pair uses `.crate-form-field` at actual 8 px; actions 44 px,
  shared filter pills 32 px fine / 44 px coarse. No shared/app-specific foundation variants.
- Existing API paths/arguments, SSE identities/reconnect timers, role gate, task handling and
  repair eligibility remain. Only add snapshot stale metadata assignments to existing readers.
- Scoped serial tests only: Vitest `--maxWorkers=1`, Playwright `--workers=1`. No full suites/CI,
  canonical captures, backend operations, Smart Mix, PR/merge/rebase/deploy/release/commit/push.
- Admin initial gzip ceiling 532480 B. Preview :5186 stays active; site pin app/web@258bbaee and
  33 canonical PNGs/manifest at 1M stay unchanged. Later HealthScan/data prerequisites stay open.

## Review focus

- Mixed severities inside one check: the group's worst recorded severity controls priority.
- Missing/zero/stale result metadata and positive counts with truncated/empty visible rows:
  no fabricated healthy claim, zero counter or complete coverage.
- Catalog failure, unknown check/severity and unlinked artists: usable inspection, no invented fix.
- Keyboard names/descriptions, confirmation focus, live removal, long paths and mobile wrapping:
  reachable actions with correct IDs and no nested controls or lost issue text.
- A repair finishing while filtered or disclosures closed: current query/streams and revalidation
  remain correct; activity never substitutes historic remaining counts for current snapshot data.

## Task 1 — truthful presentation model

**Files:** `app/ui/src/pages/Health.tsx`, `Health.test.tsx`.
**Interfaces:** `groupHealthIssues(issues)` returns `{check,severity,items}[]`; derive severity from
all items, preserve original cases, deterministic severity/key ordering. Export existing
`latestRepairSummary(task: TaskInsightLike | null)` for table-driven result tests.

- [x] Add failing cases for mixed severity/order, unknown/empty checks and task results with
      explicit zero, absent/null/negative/invalid counters, partial summaries and errors.
- [x] Observe RED, implement the helpers and safe Completed task wording; existing five helpers
      and all action/stream code remain. Run `Health.test.tsx --maxWorkers=1` to GREEN.

## Task 2 — real page and sample composition

**Files:** `Health.tsx`, `Health.icons.test.tsx`, `tools/design-system-preview/admin-health-*`.
**Consumes:** Task 1 helpers and existing snapshots/catalog/task result interfaces.

- [x] Add failing component cases for primary queue/secondary activity+catalog, readable details,
      actual counter/loaded limits, zero-match filter versus no-result/empty/stale, missing catalog,
      action isolation/IDs, role/busy, confirmation/focus and reconnect/cleanup.
- [x] Recompose the real page; move existing action callbacks into the issue detail, preserve
      artist grouping/route and confirmation. Stale state comes only from existing snapshot fields.
- [x] Update the persistent real-page specimen with no-result/stale/mixed/limited fictional modes
      and existing local completion, no API/SSE/library writes. Preserve all other specimens.
- [x] Run affected helper/component/source-policy tests serially to GREEN; inspect request and
      effect dependency diffs against the saved pre-composition source.

## Task 3 — validation and review stop

**Files:** `tests/admin-e2e/health-icons.spec.ts`, preview spec, plans/handover.

- [x] Update affected browser cases for named disclosure, secondary metadata, actual 8 px fields,
      44 px actions/shared pills, long mobile paths, sample states and absence of real traffic.
- [x] Run only affected serial Chromium specs, scoped types/lint, Admin budget/build and the
      existing preview build. Restore known generated tsbuildinfo; keep service active.
- [x] Update authoritative plan/DS/PD/decision/handover records; do not claim whole Task 1b.8/3.6.
- [x] One fresh read-only review of full pending 1AD, with one Important/Critical RED→GREEN repair
      pass if needed. Rule on every finding/declined area; no repeated reviewer loop.
- [x] Show the actual page in :5186, save advisory proof and mark deliverable. Verify service,
      source/bundle/evidence and stop at 1AD for Diego before commit.

## Final evidence and review ruling

Fresh read-only review: Critical 0 / Important 0 / Minor 2. One combined pass fixed duplicate
accessible age and outdated Queue repair guidance. Executor raised the declined UI batch-scope
claim as Important: confirmation copy now distinguishes check-wide eligible repair, loaded
fixable cases and recorded check count. New 1-loaded/600-recorded regression RED → GREEN; flow,
requests and eligibility unchanged. All review findings/declined areas are ruled on in the main
handover; no second review loop or publication approval.

Final scoped checks: 54 Vitest, six preview/four built-Admin Chromium, three strict TypeScript
configs, lint/format, contract audit and both builds pass. Initial JS 526787/532480 B gzip,
5693 B margin, ten assets. Generated build cache restored. Actual overview/detail proof saved
in ignored `.artifacts/review/checkpoint-1ad-health-inbox*.png`; :5186 active/HTTP 200, actual
sample tab marked deliverable. Full/live backend/native/AT/other-engine/CI/canonical QA remains
pending, including deliberate focus destination when the last group disappears. No complete
HealthScan or unloaded repair outcome claim. HEAD/origin remain published 1AC; stop 1AD uncommitted.

## Approved visual drift correction — 1AD remains uncommitted

Diego requested restoring the approved sketch's accents, action hierarchy and spacing after
comparison exposed a grey detail rail, neutral expanded disclosure/next step, smaller heavier
headings and denser detail. The measured cause of the grey rail is the unlayered universal
border-color in shared typography.css overriding layered utilities; the generated utility and
accent token are correct. This amendment permits the bounded shared cascade correction, not a
new identity/foundation variant. Health's approved typography dimensions/layout remain domain
composition; use existing fonts, colours, buttons and fields. Keep real cases, capability gates,
confirmations, routes, mutation callbacks, streams and recorded/loaded distinctions.

- [x] Observe failing computed-colour regressions with actual Admin and Listen CSS entries,
      plus desktop/mobile Health rail, expanded state and primary review hierarchy.
- [x] Place the default border rule in base; restore Health's accent state/primary next step,
      reviewed title sizes/weights, bounded content width and compact secondary detail controls.
- [x] Run affected serial unit/browser/consumer checks, types/lint, app builds/budgets and preview;
      verify source contracts, compare actual views with the sketch, update evidence/handover.
- [x] Keep :5186 active; stop for Diego at 1AD before commit/push. No full suites/CI/canon refresh.

### Visual correction evidence

The initial four browser regressions failed for the actual missing colours/type hierarchy in
Admin/Listen and desktop/mobile Health. Moving the default to base alone exposed preflight's
later reset: explicit colours passed but the default became currentColor. The retained regression
caught this; the final `:root, :root *` base selector preserves the default while all utility
layers win. No `!important`, caller colour override or new shared widget variant.

Health uses the approved domain composition: 1128 px maximum content width; 36–54 px/700 H1,
27 px/650 section title, 23 px/600 issue title; existing Bricolage/Poppins/Mono and semantic colours.
The detail rail is 1 px accent-action and the expanded disclosure is accent-action-hi. The same
artist-review route follows the actual cases as a shared primary Button. Eligible queue/cleanup
is primary where no artist review is available; other actions and case metadata remain visible
with secondary weight. Filter disclosure shares the heading row instead of adding an empty
vertical band. Both label/component gaps remain actual 8 px, all touch actions 44 px.

Final scoped results: 55 Health/policy and 71 shared Vitest, 8 Health +2 actual-Admin/Listen-CSS
+4 Admin-controls +3 tabs +9 focus preview Chromium cases, plus 4 built-Admin Health cases. The initial
combined preview run had 25/26 pass: focus-motion.spec.ts's "animates the ring on and fully off
with the real Listen search timing" missed its exit animation at line 199. An exact replay passed
without code/test changes, then all 9 focus cases passed together; the failure is recorded rather
than claiming a clean first pass. No focus motor/test/timeouts were changed. Three strict scoped
TS configs, scoped ESLint/format, contract audits and Admin/Listen/preview builds/budgets pass.
Admin 526767/532480 B gzip, ten assets, 5713 B margin; Listen 199918/307200 B, 23 assets. Only affected
serial chains, one worker, no full suite/CI/canonical capture. Known build caches restored.

The drift audit against the saved pre-correction source confirms 22 helpers/models, 9 API calls,
12 effect/query/ref calls, 13 state initialisers, 6 repair eligibility/counter declarations, all 10
inline callbacks, complete confirmation JSX and artist route/eligibility unchanged. The local
ArtistGroupHeader presentation now wraps its original cases before its repair link; an unlinked
case regression verifies that no case/action disappears or artist review route is invented.

Actual :5186 proof `.artifacts/review/checkpoint-1ad-health-drift-fixed.png`, same 1310×1424
viewport as the reference; the corrected real specimen was visually compared with the approved
sketch and marked deliverable. Data limits, full backend/SSE/native/AT/other-engine/CI/canonical
QA remain as previously recorded. Stop at 1AD, uncommitted, preview active, no next group.

## Publication approval — 2026-10-18

Diego approved the final corrected 1AD and authorised commit/push, superseding the earlier
local-only stop. Product and scoped evidence remain unchanged. Next group: Library Trash /1AE,
with a new review stop before its publication. Main handover records the verified publication.
