# Remove Library Timeline — replacement scope for checkpoint 1AG

> Execute inline with superpowers:executing-plans and focused TDD. Diego explicitly requested
> removal after reviewing the local icon-retirement specimen. This supersedes that proposal.

**Goal:** Remove Library Timeline from Admin and the active mockup without broken old URLs.
**Base:** published1AF `1b8ab82362f696f16ea481b3789436443b199d5d`;1AG remains uncommitted.
**Scope:** delete the production page/lazy import/sidebar destination, preserve library.view on
the old `/timeline` compatibility redirect to Browse. Remove active Timeline demo code/fixtures/
old tests/aliases; retain a lightweight HTML redirect for its old URL and a retirement record
at the existing #cronologia-admin checkpoint. Withdraw A14/Timeline from active phase6.4/PD targets.
**Preservation:** copy the withdrawn local proposal and proof into ignored review storage before
deletion; retain published checkpoints/inventory and historical records. Other domain timelines,
Listen/Desktop and the public backend endpoint/contract are outside this Admin-screen removal.
No data deletion, backend/shared API change or new dependency. No commit/push or next group.

## Review focus

- Old Admin URLs reach Browse via replace and keep existing authentication/capability gates;
  no request to /api/timeline, no lazy Timeline chunk.
- Sidebar/palette contain no Timeline destination; back/forward/collapse/search/close still work.
- Old standalone preview redirects to the persistent retirement record; no orphan module/iframe.
- Future active plans must not recreate Timeline/A14; distinguish release/artist/ops timelines.
- Preserve the withdrawn1AG artifacts and all published checkpoints; no actual backend/data work.

### Task 1: Retirement, compatibility and evidence

- [x] Add failing actual-App router/gate/source retirement tests and Sidebar absence coverage;
      run scoped Vitest with --maxWorkers=1. Expected RED: Timeline still mounted/imported/listed.
- [x] Archive the local proposal; remove page/lazy/menu and obsolete fixture/demo/tests, replace
      old route with protected Browse redirect, old preview HTML with redirect and checkpoint with
      a clear retirement note. Return source icon policy to15 whole files/46 exact sites. Expected GREEN.
- [x] Replace old Timeline browser tests with actual Admin redirect/no-request/navigation tests
      at1440/768/390 and preview redirect/absence tests at same widths plus persistent record.
      Expected all pass, --workers=1, no canonical screenshots. Run affected tests only.
- [x] Scoped strict TS/lint/format, Admin/preview builds and initial bundle <=532480B; restore
      generated cache. Update active plans and authoritative final handover, preserving history.
- [x] One fresh read-only review of the complete pending replacement diff; Important/Critical
      one tested repair pass, Minor deferred. Inspect actual preview/navigation, save proof, verify
      active :5186 service and stop at1AG without commit/push.

No full suites/CI/baselines, reference-pin change, Smart Mix, PR/merge/rebase/deploy/release.

## Recorded evidence

Expected RED: 3 retirement failures / 7 green. Final: 31 scoped Vitest across five files,
3 preview and 3 built-Admin Chromium cases at 1440/768/390, two scoped strict TS configs,
scoped lint, Admin/preview builds. Initial JS 526680 / 532480 B gzip, 5800 B margin.
Generated cache restored. Logs: `.artifacts/review/1ag-removal-*`.

Actual IAB retirement/navigation inspected; service active/HTTP 200. Proof:
`.artifacts/review/checkpoint-1ag-timeline-retired.jpg`. The 23-file withdrawn proposal archive
and SHA256 manifest are retained in this plan's ignored SDD workspace. One fresh read-only
review covered all 19 pending files: Critical 0, Important 0, Minor 1. Deferred minor: the
design-system StatStrip consumer table still names the deleted Timeline StatCard; explicit
retirement amendments take precedence. Executor rulings and limits are in the final handover.
Source remained frozen after review; no 1AG publication, no next group.

## Approval — 2026-10-18

Diego approved 1AG and explicitly authorised fixing the stale StatStrip reference, commit and
push. The reference is corrected and specimen publication labels are updated. Earlier local
stops and deferred-minor wording are historical. Next bounded group must stop at 1AH for review.
