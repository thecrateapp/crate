# Library Health icon retirement — checkpoint 1AD

> Execute inline with `superpowers:executing-plans`, TDD and one fresh read-only final review.
> Diego approved/published 1AC and authorised this next bounded group. Stop uncommitted at 1AD.

**Base:** `439b3e78daf2719d86cee72dd5726f7bc210c504`, verified at origin. **Goal:** retire
redundant Library Health glyphs while preserving repairs, streams, filters and neutral severity.
**Spec:** DS §1.2/1.7, Task 1b.8 and reviewed 1V operations/settings inventory plus Diego's UX retention.

## Constraints and review focus

- Production scope is `app/ui/src/pages/Health.tsx`, including local IssueRow/ArtistGroupHeader;
  no other page, shared API, backend/provider/schema/dependency or permission change.
- Preserve every helper, callback, request path/body, task completion/toast, filter/stream effect,
  3s/5s reconnect and cleanup, repair eligibility, isAdmin scan gate and ConfirmDialog contract.
  Existing health/empty-state interpretation remains; future HealthScanTile contracts not done.
- Retire severity registry and header/empty/action glyphs. Keep exactly three Loader2 sites and
  two disclosure chevrons as functional UX with individual source-policy markers. Neutral
  SeverityMeter instruments and words remain unchanged. Shared error/confirmation controls stay.
- Group header currently nests action buttons inside a disclosure button. Replace with a single
  named disclosure button plus sibling actions; preserve pointer action isolation and expose
  aria-expanded/controls/region plus a stable accessible metadata description. No nested interactive controls; correct focus after confirmation.
- Text scan/fix/cleanup/dismiss/resolve/repair actions have 44 px targets, same API callbacks and
  busy states. Filters retain their existing 32 px fine / 44 px coarse shared pill contract.
- Reuse OpsPageHero; Bricolage titles/numerals, Mono labels and Poppins body/actions. Three
  vertically stacked Repair lanes readouts use `.crate-form-field` actual 8 px. Long paths,
  descriptions, mobile action wrapping and partial catalog must preserve useful content.
- Persistent preview imports the real page with page-specific fictional API/task-event adapters
  and entry-only EventSource replacement. Exercise scans, all repair lanes, resolve/dismiss,
  filters, empty/loading/failure and local task completion without any backend/real operations.
- Node 22; scoped serial Vitest `--maxWorkers=1` / Playwright `--workers=1`, relevant types/lint and
  app/preview builds. Admin gzip ceiling 532480 B. No full suites/CI or canonical baselines; pin
  app/web@258bbaee, Listen/Desktop/native exceptions and all previous checkpoints stay intact.

## Task 1 — production and consumer tests

- [x] Add failing component/policy cases for text controls, retained UX/busy, neutral severity,
      non-nested keyboard disclosure/action isolation, correct issue endpoints, bulk-confirmation,
      repair links, role gate, filter URL and loading/empty/error. Keep existing five helper tests.
- [x] Observe RED; migrate only presentation/contracts described above, preserving data logic.
- [x] Run targeted tests and structural audit of callbacks, helpers, streams and confirmation.

## Task 2 — real-page preview and validation

- [x] Observe missing ninth-entry/section 31 `#salud-admin` embedding RED, then add isolated fixture
      actions/events and actual Health. Keep all prior specimens, :5186 service and forwarding.
- [x] Verify desktop/tablet/mobile, fonts, real 8 px, targets, keyboard, local requests/confirmation,
      partial/empty/failure, no API traffic/overflow. Actual Admin tests intercept all operations.
- [x] Scoped types/lint, Admin budget and nine-entry preview build; restore only generated
      tsbuildinfo. Update final plans/handover/publication and exact verification limits.

## Task 3 — review stop

- [x] One fresh read-only review of full pending 1AD diff; rule on all findings/declined judgments.
      At most one Critical/Important RED→GREEN repair pass, no repetitive review loop.
- [x] Save advisory public preview proof, mark deliverable, verify service HTTP200 and stop 1AD
      uncommitted for Diego. No further group/PR/merge/rebase/deploy/release.

## Final evidence and rulings

The fresh read-only review found one Important accessible-summary regression and one Minor
fictional-result inconsistency. Both are accepted and repaired in one RED→GREEN pass:
`aria-describedby` retains visible metadata/confirmation warning with readable word boundaries;
fixture completion supplies scan counts or repair applied counts. Production data/stream/repair
logic remains unchanged. All declined-to-judge areas have executor rulings in the final handover.

Final: 30 scoped Vitest, four preview/four built-Admin Chromium, three strict scoped TS configs,
lint/format, contract audit and both builds pass. Initial JS 526766 / 532480 B gzip, ten assets,
5714 B margin. Advisory header/actions screenshots are in `.artifacts/review/`; public tab2 is
marked deliverable, service active HTTP200. HEAD/origin 439b3e78; stop at 1AD uncommitted for
Diego. Full CI/canonical/native/AT/other-engine QA and later Health/whole 1b.8 remain pending.

## Superseding 1AD composition

The icon-only composition above was not visually approved. Diego approved the issue-queue sketch
and authorised its implementation under `2026-10-18-crate-v3-health-inbox.md`. The primary queue,
secondary references and truthful data states replace the three-lane/impact cards and their
readout fields. Existing repairs/UX remain; the final handover owns current evidence and the
uncommitted 1AD review stop. Earlier metrics/review outcomes above are historical.

## Publication approval — 2026-10-18

Diego approved the final corrected 1AD and authorised commit/push, superseding the earlier
local-only stop. Product and scoped evidence remain unchanged. Next group: Library Trash /1AE,
with a new review stop before its publication. Main handover records the verified publication.
