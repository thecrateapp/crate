# Dashboard three-block implementation plan

> Execution: `superpowers:executing-plans`, inline in the existing V3 worktree. Diego approved
> the simplification and explicitly requested implementation on 2026-10-18. Stop at **1AB**
> before commit/push. His execution request covers this concrete application of the approved
> analysis; no additional permission round or implementer delegation.

**Goal:** Show the state of available service signals, reported work and current service
interruptions in three quiet blocks, using only existing ops payloads.

**Architecture:** A pure Admin model interprets the existing `OpsSnapshotData` without new
requests. Dashboard consumes it and the current shared provider. Shared InstrumentPanel,
MonoLabel, ProgressHairline and AppModal provide the existing identity; maintenance moves to
a secondary dialog. Preserve earlier Analysis/Ops font work and all historical specimens.

**Stack:** React19, existing router/shared primitives, Node22, Vitest/Testing Library/Playwright.
**Spec:** [Approved simplification analysis](2026-10-18-crate-v3-dashboard-simplification-analysis.md).

## Constraints and review focus

- No backend/schema/provider changes, new streams, polling, dependencies, real operations,
  full suites/CI, canonical baseline updates, publication or next checkpoint.
- Snapshot freshness requires valid built/expiry timestamps, correct order, no future build,
  `stale !== true`, unexpired deadline and no refresh error. Unknown dates stay unknown.
  Existing reports must expire on screen even without another render or stream event.
- Only explicit service booleans become responding/offline. Unknown is not offline or zero.
  The headline names reported services; it never claims worker/playback health.
  Event Redis uses `eventing.domain_events.redis_connected`, independently of cache Redis.
  Analysis has its own producer `stale`/`unavailable` markers: unavailable counts are omitted;
  stale counts are historical, and absent markers leave their freshness unknown even when
  the outer snapshot is current. Do not infer daemon liveness from REST's omitted markers.
- Full slots, pending imports, DB-heavy admission waits and old failed tasks are not new
  confirmed interruptions. Show last completed/failed record with its timestamp in Work;
  do not infer recovery, blockage, throughput, worker liveness or a stall threshold.
- Running/pending counts use all five queues only when each count is a valid nonnegative
  integer. Missing/bad queue values remain unavailable. Analysis/Bliss daemon activity uses
  its own explicit active counts; an empty task list does not imply global inactivity.
- Parse progress JSON safely; valid done/total or explicit bounded percent drives the rail.
  No invented percent/ETA; malformed structured data never leaks raw JSON into the UI.
- Links use existing capability-gated routes, including supported `/tasks?task=<id>`.
  Sync retains `/api/tasks/sync-library`; rebuild/wipe preserve bodies, toasts, typed guards.
  Existing admin-only destructive gating is retained and checked against the endpoint's
  `library.maintenance.manage` capability; sync uses `library.import.manage`.
- Existing Bricolage/Mono/Poppins hierarchy, 44px actions and `.crate-form-field` 8px pairs.
  Keep functional loading/close UX, remove retired diagnostics glyph approvals.

## Task 1 — model and three blocks

**Files:** create `app/ui/src/components/admin/dashboard-model.ts` and matching test;
replace `app/ui/src/pages/Dashboard.tsx` and its local pending test. Update the existing
whole-file icon policy.

**Interface:** `getDashboardModel(data: OpsSnapshotData, error: string | null, now: number)`
returns freshness, measured service signals, queue counts, parsed running work, daemon activity,
last completed/failed records and fresh offline-service attention rows. No effects or I/O.

- [x] Write model tests for fresh/expired/unknown/future/cached-error data, malformed progress,
      queue completeness, stale false signals, saturated normal work, daemon activity, dated records.
- [x] Run the targeted model test and observe RED before adding the model.
- [x] Replace the old Dashboard tests with the approved composition, honest state and expiry,
      task links, capability behavior and nested maintenance/confirmation contracts; observe RED.
- [x] Implement the pure model and page. Keep callback contracts exact. Expiry uses a local
      deadline timeout with cleanup, not a request or repeating sampling loop.
- [x] Run model/page/policy tests serially with `--maxWorkers=1`; fix meaningful failures.

## Task 2 — persistent preview and validation

**Files:** existing `tools/design-system-preview/admin-dashboard-*`, Dashboard fixtures/spec,
actual Admin Dashboard e2e spec; current plans/handovers/design records.

- [x] Adapt the existing fixture adapter to explicitly fictional active, idle, offline service,
      stale, partial, loading and failed-first-load reports. Keep all prior checkpoints and :5186.
- [x] Test three regions, no obsolete panels, fonts, long data/44px/8px, keyboard/permissions,
      confirmed offline versus expired data, refresh, safe progress, local maintenance and no API
      traffic at1440/768/390. Actual Admin tests intercept all operations; no production requests.
- [x] Run only affected model/page/policy/Analysis/Ops tests, browser specs and scoped lint/types;
      `--maxWorkers=1` / `--workers=1`. Build Admin, check532480Bgzip budget, build preview serially.
- [x] Restore generated tsbuildinfo only; update authoritative status/approved Task3.3 delta,
      evidence and limitations. One fresh read-only reviewer on the complete pending1AB diff,
      one RED→GREEN important repair pass if needed. Save visible preview proof.
- [x] **Stop uncommitted at1AB for Diego.** No further group, full CI or baseline work.

Self-review: every identified input class is assigned to Task1 model/page tests or Task2 real
browser cases. Maintenance stays accessible in a named secondary dialog; this is the executor's
choice of destination within the approved scope, not a new route or permission grant.
