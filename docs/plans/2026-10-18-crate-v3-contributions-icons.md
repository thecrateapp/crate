# Contributions icon retirement — checkpoint 1AF

> Execute inline with superpowers:executing-plans and focused TDD. Diego approved 1AE and
> authorised publication followed by the next bounded Admin group. Stop at 1AF before commit.

**Goal:** Retire redundant Contributions glyphs while preserving attribution, real album routes,
source/status metadata, refresh and loading. This is not an import-management redesign.
**Architecture:** Only the existing production Contributions render changes. Its helpers,
GET limit, state/effect and error behavior remain. A preview-only API adapter mounts that real
component with fictional data and no backend; actual routing helpers remain unchanged.
**Tech stack:** React 19, existing shared UI, Vitest/Testing Library and Chromium Playwright.
**Base:** 1AE `638f4b0debe3adcca2b7b31f1b3e89323c58ad7b`, verified at origin, existing V3 worktree.
**Spec:** DS §1.7, implementation Task 1b.8, accepted 1V inventory and retained-UX steering.

## Global constraints

- Only Admin; preserve Listen/Desktop, one identity, Bricolage/Poppins/Mono and real 8 px fields.
- No shared API/variant, dependencies, new backend, writes, streams, pagination or invented totals.
- Keep `/api/manage/contributions?limit=150`, album/cover helpers and contributor/source fallbacks.
- Keep real route/navigation permission `library.import.manage` and all previous checkpoints.
- Preview user service stays at :5186. No full suites, CI dispatch or canonical baseline refresh.
- Node 22; serial Vitest --maxWorkers=1, Playwright --workers=1. Admin ceiling 532480 B gzip.
- Pin app/web@258bbaee unchanged; no Smart Mix, rebase/merge/PR/deploy/release. No 1AF commit/push.

## Review focus

1. Long album/artist/contributor/source values should contain themselves at 390px; source remains
   deliberately truncated as before. Test viewport bounds and full link accessible name.
2. Missing identities/album IDs and unknown source codes retain truthful fallbacks; no new links
   for missing albums. Cover-helper output stays intact; cover branch tested in component only.
3. Initial/refresh failures preserve existing toast/empty or older-items behavior, not a newly
   certified fresh-data state. Test both without extending the data contract.
4. Rapid refresh during loading remains disabled and keyboard activation/navigation stay usable.
   Test a held promise, aria-busy/loaders and final enabled control. Native disabled buttons
   release focus during a held read as before this group; no automatic focus-return claim.
5. Live auth, actual covers/import ownership and data beyond the 150-item response remain integration
   QA. Built-Admin fixtures verify actual page mount/requests, not production authorization/disk.

### Task 1: Contributions page, specimen and scoped validation

**Files:** production `app/ui/src/pages/Contributions.tsx`; new `Contributions.test.tsx`;
`admin-icon-policy.test.ts`; new `tests/admin-e2e/fixtures/contributions-1af.json` and
`contributions-icons.spec.ts`; new preview `admin-contributions-demo.html/.tsx`,
`admin-contributions-fixtures.ts`, `admin-contributions-checkpoint.tsx/.spec.ts`; preview
Vite/CSS/main wiring; authoritative plans/handover.
**Interface:** Existing Contributions export/API types, actual album helpers, source attribution,
two precisely named Loader2 sites. Test fixture and local adapter share only response-shaped data.

- [x] Write component and whole-file source-policy tests first; run scoped Vitest and observe
      RED for decorative glyphs, display heading and busy state. Preserve read/route/fallback tests.
      Command: npm run --workspace=app/ui test -- src/pages/Contributions.test.tsx src/admin-icon-policy.test.ts --maxWorkers=1.
      Expected: new rendering requirements fail on the unchanged page, existing contracts pass.
- [x] Remove HandHeart/header tile and idle RefreshCw, retain conditional refresh/list Loader2
      with bounded data-admin-ux and aria-hidden. Existing loading drives aria-busy/disabled.
      Use shared solid surfaces, display heading, 44px refresh/album link and responsive containment.
      Run the same scoped command. Expected: all pass. Audit all pre-render/helper/API/callback code
      unchanged against published 1AE; no data/authorization/route edits.
- [x] Add preview browser tests first, run only the missing-entry case RED, then mount the real
      page through exact importer API isolation. Fictional ready/loading/empty/error samples,
      manually completed refresh, actual routing helpers, no backend/task/stream requests.
      Preserve navigation by a local sample route explaining the destination, with a return link.
      Add persistent #aportes-admin / 1AF, retaining published 1AE and previous examples.
- [x] Run preview cases at 1440/768/390 plus embedding and built-Admin cases at those widths,
      Playwright --workers=1, scoped files only. Expected: fonts, 44px, 8px, bounds, metadata,
      held refresh and keyboard navigation pass; no unexpected API traffic or browser error.
- [x] Run scoped strict TS, ESLint/Prettier/diff checks, Admin/preview builds and Admin bundle gate.
      Expected: pass and <=532480 B gzip; restore generated tsbuildinfo. No full suites/CI.
- [x] Update final docs/ledger with publication SHA, scope/evidence/limits, one fresh read-only
      final review of all pending files; Important/Critical one repair pass, Minor deferred.
      Verify user service/HTTP, inspect actual page and save advisory proof. Stop at 1AF uncommitted.

## Publication record

1AE publication replay passed 26 scoped Vitest and one embedding Chromium after published labels.
Commit/push `638f4b0debe3adcca2b7b31f1b3e89323c58ad7b` verified by remote ref; worktree clean before
this group. Earlier deferred Trash coverage/typography limits are preserved, not expanded here.

## Implementation evidence before final review

RED: four failures/22 passes on unchanged production (policy, display heading, album44px,
refresh busy). GREEN: 26 scoped Vitest (10 Contributions +16 policy). Whole-file policy now
covers15 files/46 exact UX sites. AST audit confirms three helper/action functions, four
pre-render declarations/statements, one API call, two route/cover helpers, three state/effect
calls, the disable condition and callback unchanged. No auth/route/shared/provider source edit.

Missing preview entry observed RED. First responsive pass exposed a603px intrinsic grid track
at768/390; explicit grid-cols-1 fixes only the preview's grid. Built-Admin then exposed30px
album links at768 due to the real sidebar; stack production rows/metadata untilxl and enforce
min44px links. Same 44px/viewport assertions retained. Final four preview +three built-Admin
Chromium pass at1440/768/390, workers1, including held reads, real limit150, metadata, keyboard
activation/Tab and sample album navigation. No unplanned real API traffic in the specimen.

Plan correction: automatic refresh focus return was not an existing behavior. Native disabled
buttons release focus during a held read, confirmed in Chromium; exact baseline disable/load
code remains. The test verifies keyboard activation and subsequent Tab access instead; no new
focus-restoration behavior is claimed. Existing initial/refresh error semantics stay unchanged.

Three strict scoped TS configs pass. ESLint first ran from repo root without the Admin config;
corrected scoped invocation in app/ui passes. Admin build/types, 11-entry preview build and
bundle gate pass:526770/532480B gzip,10 assets,5710B margin (+15B vs1AE). Known generated cache
restored. Native/AT/other engines/zoom, actual auth/backend/import ownership/covers and lists
beyond the150 response are pending. Canonical33 PNGs/manifest stay1M, reference pin unchanged.
Final review/proof/availability record follows in the main handover; no1AF publication.

## Final review and review stop

One fresh read-only review of all20 files/nine untracked: ready for Diego visual review,
Critical0 /Important0 /Minor1. No source repair/re-review. Deferred coverage: no long contributor
fixture or exact full-long-title browser name assertion; viewport checks alone do not establish
those cases. The final handover records all11 declined areas with executor ruling/cost, plus
plan corrections. Existing error/focus semantics, live backend/covers,150-item limit and broader
QA remain explicit boundaries rather than claimed completion.

Actual IAB Refresh/manual completion inspected, ready view saved at
.artifacts/review/checkpoint-1af-contributions.jpg (1310×1424), tab marked deliverable. Preview
user service active and entryHTTP200. HEAD/origin638f4b0d; original53177736 ancestor verified.
Known generated cache restored. All earlier checkpoints retained. 1AF stays uncommitted for
Diego; no additional group, publication or full-suite/CI/baseline action.
