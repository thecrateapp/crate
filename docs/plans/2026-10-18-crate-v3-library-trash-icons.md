# Library Trash icon retirement — checkpoint 1AE

> Execute inline with superpowers:executing-plans and focused TDD. Diego authorised the next
> bounded Admin group after approving/publishing 1AD. Stop at 1AE before commit/push.

**Goal:** Remove redundant Trash heading/action icons while retaining UX, real worker actions,
metadata, task states and confirmations. This is an icon group, not phase 6.4's indexed Trash.
**Base:** published 1AD `5e1d9c8f287804a834b3143f6367f7e5a2ef8e31`, feat/crate_v3 in the existing
isolated V3 worktree. Do not touch the MCP checkout, rebase, merge or create another branch.
**Spec:** DS §1.7, reviewed 1V inventory and Diego's retained-UX steering. Shared identity/fonts/
recipes; no new foundation variant. Keep the 1AD visual correction and every older specimen.

## Scope and contracts

Only production `app/ui/src/pages/Trash.tsx`; source policy, its affected tests and an isolated
real-page specimen plus checkpoint documentation. Preserve all helper/request/task/effect code:
GET quarantine, restore/hard-delete/hard-delete-all POST bodies, 120000ms and 10-minute task
waits, errors/toasts, disabling and both shared confirmations. App route/capability gate stays.
Remove header Trash2 and idle RefreshCw/Trash2/ArchiveRestore glyphs. Retain four explicitly
bounded loading sites (refresh, empty, list and row operation). Keep actionable names and
keyboard/focus; shared Button 44px targets, Bricolage heading, Poppins body and Mono metadata.
No invented counts, data/pagination, backend/library operations or additional streams.

Preview :5186 remains the user service. Add a real Trash specimen with labelled fictional
tracks and local actions/task completion, no production API or task connection; use the same
sample boundary pattern as 1AD. Previous 33 canonical PNGs/manifest remain 1M; pin258bbaee is
unchanged. No complete suites, CI dispatch, baseline generation, PR/deploy/release or Smart Mix.
Vitest --maxWorkers=1, Playwright --workers=1, serial check chains. Admin budget 532480B gzip.

## Task 1 — page and bounded source policy

**Files:** Trash.tsx, Trash.test.tsx / Trash.icons.test.tsx, admin-icon-policy.test.ts.
**Interface:** existing Trash component, real paths/task results, four named loading sites.

- [x] Add failing source-policy coverage and component cases: text controls/no retired glyphs,
      loading/busy, refresh, restore, individual/bulk confirmation/cancel focus, exact request
      payloads/timeouts, success/error, empty state and real metadata. Observe RED.
- [x] Remove redundant glyphs, bound loader sites, preserve behavior and use shared identity/
      typography/target sizes. Expand the live policy to the whole Trash file (14 files/44 sites),
      with exactly two existing shared ConfirmDialog uses; do not refresh the historical inventory.
- [x] Scoped unit tests GREEN; audit requests/helpers/state/effects/callbacks/confirmation against
      published source. No behavior or backend refactoring.

## Task 2 — persistent specimen and browser validation

**Files:** admin-trash-demo.html/.tsx, admin-trash-fixtures.ts, admin-trash-checkpoint.tsx/.spec.ts,
Vite/CSS/main preview entry, tests/admin-e2e/fixtures/trash-1ae.json and trash-icons.spec.ts.
**Consumes:** Task 1 page and its unchanged API/task contract; adapter redirects only Trash imports.

- [x] Add labelled ready/loading/empty and failing-task samples; local completion preserves
      paths and targets. No real API/SSE/tasks/library action. All real page controls remain.
- [x] Add failing desktop/mobile real-page browser checks: keyboard/dialog focus, correct IDs/
      bodies, loading completion/failure, readable data and no overflow/nested controls/traffic.
      Observe missing entry RED before wiring; check 44px actions and actual8px sample fields.
- [x] Wire the actual page at /admin-trash-demo.html and persistent #papelera-admin (1AE), keep
      1AD published and all previous specimens. Browser checks GREEN with one worker.

## Task 3 — evidence and 1AE review stop

- [x] Scoped types/lint/format, Admin/preview builds and budget, built-Admin 1440/768/390 checks;
      restore known generated build cache. No full suite/canonical captures.
- [x] Update authoritative plans/handover with exact 1AD publication, bounded 1AE scope/evidence,
      UX sites, bundle and remaining QA. One fresh read-only review of full pending 1AE, one
      Important/Critical repair pass if needed, explicit rulings on all findings/declined areas.
- [x] Verify preview service/HTTP, inspect actual specimen, save advisory proof and mark tab
      deliverable. Stop uncommitted at 1AE for Diego; do not publish another group.

## Implementation evidence before final review

Task 1 RED: four expected failures (live source policy, display heading, refresh/restore busy
semantics), 21 existing cases green. Minimal render changes then 26 scoped cases pass: 9 new
Trash control cases, the existing bulk-task test and 16 live-policy cases. Four explicit loader
sites and two bounded ConfirmDialog uses expand the policy to 14 complete files / 44 UX sites.
All ten helpers/action functions and the component's 13 pre-render declarations/statements,
three API calls, two task waits, seven state/effect calls, two entire confirmations, four
existing disabled conditions and eight callbacks are unchanged in the AST audit.

The missing preview entry was observed RED, then all four preview Chromium cases pass at
1440/768/390 plus persistent embedding. Three built-Admin cases pass at the same widths,
including the actual route gate, worker POST path/body, task completion, cancellation focus,
44 px targets, metadata and viewport bounds. The specimen exposes local ready/loading/empty
and next-task failure states with actual page controls and no API/SSE/library traffic.

Three strict scoped TypeScript configs, scoped ESLint/format, Admin build/types/budget and
10-entry preview build pass. Type checking caught the test-only Playwright-style `exact` option
on Testing Library getByRole; removed it (string names already match exactly). The temporary
strict test config also now includes the real test setup's matcher augmentation. No product
workaround or timeout inflation. Final Admin initial JS 526755 / 532480 B gzip, 10 assets,
5725 B margin, 12 B below published 1AD. Known generated build cache restored.

Real backend/worker/filesystem/integration, native/AT/other-engine/zoom, phase-close/full suites,
CI and canonical capture/comparison are pending. The current quarantine listing, error/toast
semantics and phase 6.4 index/pagination remain unchanged. No claim of a Trash data redesign.
Final review, proof and service/status ruling follow in the main handover.

## Final review and bounded stop

Fresh read-only review covered all 20 pending files, including nine untracked files, against
published 1AD. Verdict: ready for Diego's visual review; Critical 0 / Important 0 / Minor 2.
No source repair or second reviewer loop. Production/API/confirmation audit remains unchanged.

Minor coverage gap is deferred explicitly: individual cancellation focus and restore failure
are covered; bulk confirmation/success is covered, but bulk cancellation focus, pending loader/
aria-busy and bulk failure recovery lack dedicated assertions. The bulk logic and shared dialog
are unchanged; this is not a claimed test of every bulk state. The typography statement is
clarified: Mono paths, Poppins body including the existing technical line. Migrating that line
is outside this bounded icon group. Both minor observations are in the final handover/ledger.
All considered/deferred behaviors receive executor rulings there; no silent scope expansion.

Final proof: `.artifacts/review/checkpoint-1ae-library-trash.jpg` from actual IAB at 1310×1424,
marked deliverable at /admin-trash-demo.html. Preview user service active/HTTP200; HEAD/origin
remain published 1AD. The implementation is uncommitted for Diego at 1AE. Evidence remains
26 scoped unit +4 preview/+3 built-Admin browser, types/lint/builds/budget as recorded above.
No complete suites/CI/canonical refresh, backend/library operation, next group or publication.
