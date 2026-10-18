# Crate v3 Implementation Plan

> **For agents:** REQUIRED SUB-SKILL: use `viterbit-ai-tools:executing-plans` to run this plan task
> by task. One task is one commit unless the task says otherwise. Stop at every checkpoint and wait
> for Diego. Commit messages below describe future commits; do not create a commit without
> Diego's go-ahead. Published checkpoints through 1AA (`13272706`) are recorded in the handover. 1AB three-block Dashboard is visually approved for commit/push; continue one bounded Admin icon group and stop at1AC for review.

**Goal:** Ship Crate v3. Admin (`app/ui`) and Listen (`app/listen`, also shipped as Capacitor
iOS/Android and inside the Tauri shell `app/listen-desktop`) adopt the visual language of the new
site, and the site's visualisations (genre taxonomy wheel, health scan, queue lanes, governor
gauges, release rail, album sidecar, track readout, enrichment orbit, EQ curve, setlist ticket,
heatmap, mood map, sound map, route map and the rest) become product features that read real,
precomputed data.

**Architecture:** One design system, two tracks (design-system spec §0.1).

- **Track A, language migration.** Behaviour-identical restyles, one screen per commit, on top of
  the tokens and primitives already on the branch.
- **Track B, instruments on real data.** Each instrument ships with its backend contract:
  - The request path only reads a precomputed payload by key: `ui_snapshots`,
    `ops_runtime_state`, a Redis runtime key or a primary-key read.
  - Heavy work runs in workers, the projector or deduplicated tasks.
  - Admin instruments share one live stream per tab (`AdminLiveProvider`). Listen reuses
    `/api/cache/events`, the home discovery stream and the Connect WebSocket.
  - Motion is data-driven: springs re-target from refs, one visibility-gated rAF per visual, and
    the final state renders under reduced motion.

Listen and Admin share one visual identity: the same tokens, primitives, recipes and interaction
rules. Differences are domain-specific components and workflows, never app-specific foundational
styles. Existing local duplicates are transitional debt scheduled in block 1b/page migrations; do
not add new variants. Every relevant checkpoint compares the two consumers and runs drift gates.
Shared components live in `@crate/ui` only when both apps render them in the same change.

**Tech Stack:**

- Frontend: React 19, Vite, Tailwind 4, TypeScript, `@crate/ui` (tsup), Nivo for statistical
  charts only.
- Frontend tests: Vitest 4.1.6 with jsdom and Testing Library; Playwright 1.63 (`listen-visual`,
  `appearance`, `admin-e2e`).
- Backend: FastAPI, SQLAlchemy 2.0, PostgreSQL 15, Redis 7 (cache and durable), Dramatiq, Go read
  plane.
- Backend tests: pytest with the `pg_db` fixture (Testcontainers fallback); Go table tests and the
  read-plane contract smoke.
- Runtimes: Capacitor (iOS 16.4 from Task 0.13; Android WebView) and Tauri 2
  (WebKit, WebView2, WebKitGTK).

**Sources of truth (read the relevant section before each task):**

- `docs/plans/2026-10-14-crate-v3-product-design.md` (cited as `PD §n`): information architecture,
  per-screen design, data contracts, backend work and the `PDn` decisions. The full TypeScript
  contracts live there; tasks below cite them instead of repeating them.
- `docs/plans/2026-10-14-crate-v3-design-system.md` (cited as `DS §n`): tokens, primitives, panel
  anatomy, motion, accessibility, governance and the `[Dn]` decisions.
- `docs/plans/crate-v3-analysis/*.md`: evidence. `coverage.md` §8 indexes the surfaces with no site
  visual (`A1`–`A26`, `L1`–`L29`).
- This plan owns task dependencies and internal milestone order; the handover owns current status.
  The approved joint-release sequence and the Checkpoint 1A exception below supersede the original
  phased public rollout. No task list grants permission to publish, commit or access production.
- The five canonical v3 documents and `crate-v3-analysis/` are tracked. The analysis reports
  describe the original investigation baseline, not the current implementation status.
- The "26 verified mapping cards" cited by PD and DS are not in the repo or in
  `crate-v3-analysis/` (`coverage.md:13` names them without a path). They are not a source for
  this plan: PD and DS already carry every verified correction, and Task 0.4 removes the
  references. If Diego still has the cards, Task 0.1 commits them under
  `docs/plans/crate-v3-analysis/cards/` instead and Task 0.4 cites that path. Phase 0 closes the
  open decisions.

**Visual reference:** the new site only. `site:` means `app/web/` at the approved site SHA, read from its git tree until website is integrated. Port values,
geometry and math from:

- `site:src/components/viz/*.astro` and `site:src/scripts/viz/*.ts`
- `site:src/scripts/motion/*`, `site:src/lib/{counter,json-lines,system-map}.ts`
- `site:src/styles/{tokens,base}.css`

Never ship the site's marketing devices: demo loops, auto-cycling, seeded or example data, or
simulated thread pools. Do not read or use any other design branch.

**Pinned site reference:** `feat/website` at `258bbaee` (2026-10-14, the SHA
`crate-v3-analysis/site-visuals.md` records). The site branch keeps moving, so:

- every `site:` line number in PD, DS and this plan refers to `258bbaee`;
- each port PR records the site SHA it copied, in the PR body or in the header of the ported test
  fixture;
- before each internal milestone that ports site math (Genres, Ops, Health, Stats, and the P1 groups),
  one re-sync step diffs the ported `site:` files between the pin and the site head
  (diff `app/web/src/scripts` and `app/web/src/lib` between the pin and the proposed site SHA),
  reviews the changes with Diego and moves the pin only then.

**Repo rules that apply:**

- AGENTS.md: "If you touch it, you test it".
- The API never writes to `/music`. All DB access goes through `app/crate/db` concrete modules,
  with `read_scope()` for reads and `transaction_scope()` for writes, and `session=` passed down.
- `crate/db/__init__.py` is frozen. No `COUNT/SUM/AVG` over `library_tracks` in a request; batch
  with `ANY(:ids)`; one CTE per surface; no snapshot rebuild in a request.
- SSE/WebSocket effect dependencies never include per-frame values.
- Commits: conventional commits, no attribution footers, first line under 72 characters, body
  explains why. When executing interactively, commit only with Diego's go-ahead.

**Conventions in this plan:**

- Registry, generator and harness names below are current paths, not a requirement to retain the
  theme system. Preserve them through the primitive batch; Task 1.13 migrates their consumers.
  Later tasks use the resulting single-identity equivalent and never recreate removed variants.

- Paths are relative to the `crate-v3` worktree. `sm:` means
  `/Users/diego/Code/Ninja/musicdock/worktrees/smart-mix-phase-1/` (branch
  `codex/feat-smart-mix-phase-1`, not merged).
- `[MAIN]` marks a task that ships as its own small PR against `main`; `feat/crate_v3` takes it by
  an integrator-approved update from `main`. Start these tasks only when Diego assigns them;
  critical operational deployments remain independent of the joint UI release.
- `[BLOCKED: smart-mix]` marks a task that needs `codex/feat-smart-mix-phase-1` merged into `main`
  first.
- `[BEHAVIOUR]` marks a task that changes behaviour (listed in PD §3.4.2; Task 0.4 adds the rows
  that are missing there). It goes in its own PR with a release-note line.
- IDs: `Bn`, `PDn`, `Vn`, `Gn` and `[Dn]` as in the two design documents. `P0`/`P1`/`P2` and sizes
  `S`/`M`/`L` as in PD.
- Migrations are linear Alembic revisions; `main` is canonical for numbering. The original
  analysis recorded head 108 and Smart Mix revisions 109–114. Those numbers and the reported
  dev/lab database versions are historical inventory, not the state to deploy against.
  After Smart Mix merges and v3 rebases, inspect the actual schema and single-head test, then
  allocate a new revision from the actual `main` head. Reuse any integration tooling already
  present; never renumber deployed revisions or recreate a resolved migration.
  Task 2.13 adds or extends a renumber helper only if the resulting unmerged branch needs one.
  Any database version repair requires a verified code-to-schema mapping, backup and separate
  operational approval; there is no unconditional `alembic stamp` step.

  Migration numbers are written `NNN` below. Every migration:

  - puts its DDL in an immutable `app/crate/db/schema_sections/<area>_vNNN.py` called from
    `upgrade()` and from the bootstrap;
  - uses `ADD COLUMN IF NOT EXISTS`, nullable columns, and `autocommit_block` for concurrent
    indexes (pattern of `080_user_listening_hotpath_indexes.py`);
  - updates `app/tests/test_crate_schema_definition.py` (head assertion);
  - is checked before merge: `alembic heads` on the PR's merge result prints one head;
  - never changes the meaning of a column an older image still writes (see Rollback).

- New task types are registered in five places, checked by `app/tests/test_task_runtime_contract.py`
  and `test_task_queue_routing.py`:

  1. `app/crate/actors.py` `TASK_POOL_CONFIG`;
  2. a `TaskTypeInfo` in `app/crate/task_registry.py`;
  3. a handler in a `*_TASK_HANDLERS` dict;
  4. the handler group tuple in `app/crate/worker.py`;
  5. the notification flags on `TaskTypeInfo` (added in Task 2.11a): `notify: bool = True` gates
     the Telegram completion message (`actors.py:821` calls `notify_task_completed` for every
     completed task today, and `telegram.send_message` sends whenever `telegram_enabled=true`);
     `quiet: bool = False` additionally skips the tasks-surface signal, the `crate:sse:global`
     publish and default visibility in history and lanes. Every `refresh_*` and `build_*` type is
     `quiet=True`; every `backfill_*` type and `compute_music_path` is `notify=False`.
     `test_task_runtime_contract.py` asserts both sets.

  Each new type also requires regenerating the site's `src/data/scale.json` (Site drift,
  Phase 7).

- **Coalescing is trailing-edge, and no `tasks` row exists before the build is due.**
  - Recipe (helper `app/crate/coalesce.py`, Task 2.11b: `schedule_coalesced(key, task_type,
params, window_seconds)` and `dispatch_due()`): the first trigger sets `<key>:dirty` and
    `ZADD crate:coalesce:due NX <now + window> <key>`; later triggers only set dirty. A due step in
    the crate-worker service loop (single writer, every iteration, about 2 s) reads
    `ZRANGEBYSCORE crate:coalesce:due -inf <now>`, removes each due key with `ZREM` and only then
    calls `create_task_dedup`. Projector actions keep their own due set, checked by the projector
    loop. The builder clears dirty before building and, if dirty is set again during the build,
    re-adds the key with a new due time.
  - Why not a Dramatiq `delay=` message: the task row would exist from the first trigger, and
    `redispatch_stale_pending_tasks(age_seconds=300)` (crate-worker service loop, every 60 s;
    `worker.py` `_run_service_loop`, `db/repositories/tasks_maintenance.py`) re-dispatches every
    pending row older than 300 s with no delay. Every window above 300 s (mood map ≥ 900 s,
    insights 30 min, bliss map 6 h) would collapse to about 5 minutes, and the delayed message
    would later run a second build.
  - A cold read (row missing) skips the window and calls `create_task_dedup` at once; the window
    applies only to dirty or stale rows. Every new surface is also warmed once at crate-worker
    start (deduplicated), so first views do not wait a full window.
  - The leading-edge pattern of `schedule_instance_stats_dashboard_refresh`
    (`instance_stats_dashboard_surface.py:190-198`) drops the last change of a burst and is not
    copied.
  - Tests per surface: a burst of N triggers produces exactly one build after the window, and
    that build reflects the last trigger; with the redispatcher run inside the test, a 900 s
    window is not dispatched at 360 s; a cold read schedules immediately.
- **Demand gating.**
  - Live readers mark their audience in Redis: the Admin live stream (2.14), the tasks stream
    (2.11c), the acquisition stream (5.6) and the Stack endpoints (5.5) set
    `admin:live:viewers:<surface>` with `EX 60` on connect and on every 30 s heartbeat or poll.
  - Helper `app/crate/admin_viewers.py` (Task 2.11c): `async def amark_viewer(*surfaces)` on
    `api/redis_sse.get_async_redis()` (one pipelined `SET` per call) for async SSE generators,
    and sync `mark_viewer` / `has_viewers` for workers and plain `def` endpoints. An async
    generator never calls the sync client: a slow Redis would block every SSE client in that
    worker. The key names are constants in that module, imported by both the endpoints and the
    samplers (`admin:live:viewers:stack`, never a second name such as `stack:viewers`).
  - Samplers and writers run at their fast cadence only while the key exists. While slow or idle
    they check it once per second (one `EXISTS`), so a new viewer gets a fresh sample within about
    a second. Each sampler or writer has a test: when the key appears, the next sample arrives
    within about 1 s.
  - Hidden Admin tabs are not viewers: `AdminLiveProvider` closes its stream after 30 s hidden
    (Task 3.1), and the Dashboard never subscribes to the fast `queues` and `governor` surfaces
    (Task 3.3).
  - Runtime-only samples (governor, Redis, acquisition, event pipeline, stack) live in the Redis
    key `crate:runtime:<surface>` with a TTL plus a publish, and are persisted
    (`ops_runtime_state`, or `ui_snapshots` for the stack) only on a verdict or state change or at
    most once per 60 s.
- **Single writers.** Samplers and surface writers start only when `run_worker` runs with
  `start_service_loop` true. Only crate-worker does; crate-fast-worker `extends` crate-worker and
  inherits its environment, so env switches alone would start a second writer there. The
  `CRATE_*_ENABLED` variables are off-switches only. Each such task adds a test that a worker
  started with `--no-service-loop` starts no sampler or writer. Samplers that make network or
  socket calls (governor, Redis, acquisition, stack) run in their own daemon threads with short
  timeouts, never as steps of the serial service loop. Two exceptions: worker heartbeats (2.15a),
  where every worker registers itself, and the stack sampler (5.5), whose process PD54 decides
  (crate-api behind a leader lock, or crate-worker behind a read-only socket proxy).
- **Per-item task events** (repair items, portable tracks, enrichment sources) go through
  `publish_task_signal` (Task 2.17c): task channel only, no `task_events` row, no `worker_logs`, no
  `crate:sse:global`.

Status: implementation in progress. Tasks 0.0, 0.1 steps 1–2, 0.2–0.10, 0.12 and 0.13 have
local implementation recorded in the handover. This does not close CI, screenshot or device QA.
Task 0.11 is complete with reviewed Linux baselines and green comparison CI at `cf477986`.
Checkpoint 0 remains open for 0.14/0.15 and device reviews (0.14 may wait until the wheel).
Diego approved Checkpoint 1A (1.2–1.4) on 2026-10-15 after reviewing the mockup and authorised
commit/push of that batch and its persistent preview, published as `efe6cf2e` on `origin/feat/crate_v3`.
Tasks 1.5–1.6 are implemented and approved at Checkpoint 1B; Diego authorised their commit/push. Runtime theme retirement (1.13 / Checkpoint 1M) is implemented locally for review. Local full-suite results
are in the handover; Linux baseline comparison and full frontend CI pass on 1E. Device/runtime
QA and later tasks' own visual gates remain pending.

---

## Command reference

### Where tests run

The canonical clone is `/Users/diego/Code/crate-v3`, with its own `.git`, `node_modules` and
`.venv`. Assigned agents use isolated worktrees on the internal disk. The removed external
worktree is not an execution target; its Vitest timeout patch is historical and must not be used.

Local task tests run in the tree being edited. The integrator repeats the task verification after
integration. CI remains required for full QA and is not implied by local results. Pushes, commits,
PRs and workflow dispatches require Diego's go-ahead; no agent pushes work merely to obtain QA.
Committed visual PNGs come only from the approved Linux amd64 CI job, never from the Mac.

### Named commands used by the tasks

| Name               | Command (repo root unless noted)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PY <file>`        | `cd app && ../.venv/bin/python -m pytest tests/<file> -q` in `/Users/diego/Code/crate-v3` (venv from Task 0.2). `pg_db` tests need Docker running (Testcontainers fallback)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `PY-ALL`           | `make dev-test-backend` (pyright, ruff, full pytest in the isolated test stack)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `GO`               | `make readplane-test && make readplane-vet`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `GO-SMOKE`         | `make dev-back`, then `make readplane-contract-smoke`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `VT-UI <path>`     | `npm run --workspace=@crate/ui test -- <path>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `VT-ADMIN <path>`  | `npm run --workspace=app/ui test -- <path>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `VT-LISTEN <path>` | `npm run --workspace=app/listen test -- <path>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `TYPES`            | `npm run --workspace=@crate/ui typecheck && npm run --workspace=app/ui typecheck && npm run --workspace=app/listen typecheck && npm run --workspace=app/listen-desktop typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `LINT`             | `npm run --workspace=app/ui lint && npm run --workspace=app/listen lint && uv run ruff check app/crate app/tests && uv run ruff format --check app/crate app/tests`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `GATES`            | `node --test scripts/design-system/*.test.mjs && npm run design-system:drift -- --check && npm run design-system:tokens:check && npm run design-system:layers`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `TOKENS-GEN`       | `npm run design-system:tokens:generate`, after any change to `app/shared/ui/lib/appearance-token-registry.ts`. Commit the generated `app/shared/ui/tokens/themes.css`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `I18N`             | `npm run --workspace=app/listen i18n:check`. After editing catalogs: `(cd app/listen && node scripts/i18n-check.mjs --write-metadata)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `BUNDLE`           | `npm run --workspace=app/listen build && npm run --workspace=app/listen check:bundle` (300 KB gzip of initial JS; write the measured number in the PR)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `BUNDLE-ADMIN`     | `npm run --workspace=app/ui build && npm run --workspace=app/ui check:bundle` (from Task 0.12; the PR records the delta against the ceiling)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `VISUAL`           | `docker run --rm --platform linux/amd64 --ipc=host -v "$PWD":/work -v crate-v3-node-modules:/work/node_modules -w /work mcr.microsoft.com/playwright:v1.63.0-noble bash -lc 'h=$(sha256sum package-lock.json \| cut -d" " -f1); [ "$(cat node_modules/.lock-hash 2>/dev/null)" = "$h" ] \|\| { npm ci && echo "$h" > node_modules/.lock-hash; }; npm run test:listen-visual'`. The host is an Apple M5 (arm64) and CI runs linux/amd64; Chromium text antialiasing can differ between architectures by more than `maxDiffPixels: 250`, so a local run forces amd64 (emulated and slow) and is advisory. **Committed PNGs come only from the `update-listen-visual` `workflow_dispatch` job** (amd64, Task 0.11): run it and download its artefact; never commit baselines recorded on the Mac. `npm ci` runs only when the `package-lock.json` hash differs from the stamp in the named volume. Baselines are Linux only (no `{platform}` in `snapshotPathTemplate`) |
| `ADMIN-E2E`        | `npm run test:admin-e2e` (from Task 0.11 it also checks the Linux-only Admin captures in the same container image; their PNGs come from the same `workflow_dispatch` job)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `APPEARANCE`       | `npm run test:appearance -- --project=chromium` (existing harness name; migrate to the single Crate v3 token contract in 1.13, with no variant matrix)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### Definition of done (applies to every task)

- [ ] **Tests first for logic.** Write table tests for pure math and models. Render tests check the
      final state, interactions and lifecycle (the loop stops on unmount and when hidden; a stream
      opens once). pytest covers every changed public function; Go table tests cover every read-plane
      change. A `TEST_GAP:` comment is allowed only for rAF, IntersectionObserver or WebGL scheduling,
      which Playwright or the QA pass covers instead.
- [ ] **Drift tests** wherever data is copied across languages, apps or repos. Each task lists its
      drift tests.
- [ ] **Reduced motion** renders the final state without rAF, springs, scramble, stagger or
      count-up, and interaction is unchanged.
- [ ] **Loops settle.** rAF runs only while a spring or position is unsettled (DS §3.8 rule 3,
      PD7). Elapsed-time text (running chips, the active Health row) is written into text nodes from a
      1 s timer, never from a rAF. Idle states render one static frame. Each visual has a test that its
      loop stops after settling while the underlying task is still running. This matters on Capacitor
      and Tauri, where background throttling is disabled.
  - Gates: Listen `isMotionBlocked()`; shared code `@crate/ui/lib/motion-gate.ts`; Admin
    `useMotionAllowed()` (media query only).
  - CSS springs only through longhand properties behind `@supports (transition-timing-function:
linear(0, 1))`, and no final state may depend on an animation running.
- [ ] **Mobile.**
  - Listen: 375 px wide, 44 px hit areas on coarse pointers, `--listen-safe-*` insets, and no
    `filter: blur` on Android WebView or WebKitGTK.
  - Admin: the 1000 px and 760 px breakpoints, with container queries inside panels.
- [ ] **Copy.**
  - Listen strings go into all 7 catalogs (`app/listen/src/i18n/catalogs/{en,es,fr,de,it,ca,eu}.json`)
    plus the `.metadata` hashes (`I18N`). Every Listen task that adds visible text or an
    `aria-label` lists the catalog prefixes it touches in its Files.
  - Counts use ICU plurals, and each new counted prefix is added to
    `app/listen/src/i18n/plural-counts.test.ts` (DS §6.9 item 7).
  - Admin copy is English.
  - Shared components take copy as props.
- [ ] **Conventions.**
  - Admin uses `sonner`; V3 removes almost all Admin icons (DS §1.7 / Task 1b.8).
    `lucide-react` is only the source for reviewed functional exceptions. Listen keeps
    `@crate/ui/icons` and `notify`.
  - Nivo only for statistical charts (PD1). No emojis.
  - A component goes into `@crate/ui` only when both apps import it directly in the same change.
- [ ] **Performance.** Applies the rules listed under "Repo rules that apply", plus:
  - SSE reads run in `asyncio.to_thread`.
  - Per-frame values live in refs.
  - No new `style={{}}`.
  - Background work follows the Conventions: trailing-edge coalescing, demand gating, single
    writers, quiet refresh tasks.
- [ ] **Single visual identity.** Crate v3 only, with semantic design tokens and no literal colours
      in consumers. No alternate skins, modes, accent, material, radius or typography selectors.
      Canvas, WebGL and Nivo resolve the Crate v3 tokens; resize/context restoration keeps them correct.
      Until 1.13 removes the old runtime, preserve its token generation and compatibility plumbing;
      do not add new variants or widen the screenshot matrix. Motion and accessibility remain supported.
- [ ] **Older servers.** Every Listen instrument that reads a new endpoint or field has a test with
      a fixture returning 404 or the old shape, asserting the defined fallback renders (Rollout →
      Flags).
- [ ] **Budgets.**
  - `GATES` stays green. Drift ceilings move only deliberately, and the commit body lists the
    tokens added.
  - `BUNDLE` for every Listen change and `BUNDLE-ADMIN` for every Admin change (from Task 0.12).
    A ceiling rises only deliberately, with the delta in the PR. `TYPES` and `LINT` always.
- [ ] **Accessibility.**
  - The figure `aria-label` is a sentence built from the real numbers.
  - Every SVG, canvas or WebGL layer has an HTML equivalent.
  - Keyboard path and visible `focus-ring` marker, with the shared on/off motion (DS §1.9.5).
  - A `forced-colors` pass.
  - State is never conveyed by colour alone.
- [ ] **Visual baselines.** Re-record them intentionally whenever a Listen screen or an Admin
      capture changes, through the `update-listen-visual` job (the only source of committed PNGs,
      `VISUAL`), and review every diff. Tasks that change Listen pixels in the same area are grouped
      into one PR with a single re-baseline.
- [ ] **Site drift coupling** checked (DS §6.5). Note in the PR when the site test must change on
      the `feat/website` merge, and record the site SHA any ported math or values came from (pinned
      `258bbaee`).

---

## Phase 0 — Close the open decisions and stabilise the committed foundation

The original four commits established the visual baseline; subsequent commits implemented most
of Phase 0. They are history, not a current progress counter. The handover records completion and
QA separately. Documents are tracked, the internal clone exists and Bricolage is in place.

**Current order:** 1A–1C and provisional 1D are approved/pushed. Further focus-fade visual
polishing is deferred. Diego approved publication of 1E, its Linux capture run and continuation.
Task 0.11 is complete: 31 reviewed Linux PNGs and green comparison/full frontend CI on `cf477986`
(run `38808354069`). Task 1.0 is published at Checkpoint 1F (`6e793ebd`, Linux images `82f14594`); capture review,
comparison/full frontend CI (`38860652793`) and the local route walkthrough are complete.
InstrumentPanel 1.7 is published at 1G (`473604f7`); Meter 1.8 at 1H (`6a5b3366`, Linux images
`ef5e7f52`). Readout 1.9 is published (`a80f396b`, Linux images `dd71eb72`);
ProgressHairline 1.10 is published (`0660fbd2`, Linux images `3f470ec6`);
shared toaster configuration 1.11 is published (`7b46021d`, Linux images `181ca4d4`);
cleanup 1.12 is the current local checkpoint. Smart Mix and Phase 0
gates remain separate: runtime qualification 0.15 and device QA are pending; production measurement
0.14 is needed before the wheel and requires assignment.

The integration sequence is Smart Mix on `main` → approved rebase of `feat/crate_v3` → website
integration → internal milestones → one joint P0 major for Listen, Admin, site and docs. R0 work
on `main` starts only when assigned, with critical deployments observed independently.

### Task 0.0: Settle the brand font licence before anything is pushed (PD4 / [D3])

**Status: done 2026-10-15.** Diego chose Option 2 with no Cabinet anywhere: Bricolage Grotesque
(SIL OFL 1.1) is the display face in every runtime and on cratemusic.app and the docs site.

**Why:** a reading of the licence text, not legal advice. Cabinet Grotesk's ITF Free Font License
2.0 §02 forbids distribution "through another font website, font library, marketplace, repository,
download service, application or platform" and making the font "available for use by third parties
through any website, application, online service". `thecrateapp/crate` is public and third parties
run its GHCR images, so the font cannot ship in the product. Diego chose an OFL face over asking
ITF for an exception: it removes the question for every runtime and every fork.

**Files (done on `feat/crate_v3`, folded into the original font commit):**

- Removed: `app/shared/fonts/cabinet-grotesk/*`, `app/shared/fonts/cabinet-grotesk.css`
- Added: `app/shared/fonts/bricolage-grotesque/` (`bricolage-grotesque-latin-opsz-normal.woff2`,
  `bricolage-grotesque-latin-ext-opsz-normal.woff2`, `OFL.txt`; unmodified from
  `@fontsource-variable/bricolage-grotesque` 5.3.0) and `app/shared/fonts/bricolage-grotesque.css`
- Modified: `app/ui/src/index.css`, `app/listen/src/index.css` (import),
  `app/shared/ui/tokens/semantic.css`, `app/shared/ui/lib/appearance-token-registry.ts`
  (`--font-display-stack`), `runtime-contract.test.ts`, `appearance-token-registry.test.ts`

**Steps (done):**

1. Swap the files and the `--font-display-stack` value; the type scale and every component stay as
   they are (components only reference `font-display`).
2. Rewrite the unpushed history so the swap lands inside the original font commit (formerly
   `38c7576c`, now `d9df9d51`); the website branch (`feat/website`, `app/web` and `app/docs`) is rewritten the same
   way.
3. Verify: `git log --all --stat | grep -i cabinet` prints nothing for `feat/crate_v3`, and
   `npm run --workspace=app/shared/ui build` passes.
4. Metric follow-ups (opsz, tracking, vertical metrics) are in DS 1.2.1 and the decision register;
   Task 0.11's `VISUAL` captures check them.

### Task 0.1: Track docs and integrate the branches

**Status:** tracking steps 1–2 done. Rebase, push and PR work are pending Diego's go-ahead.
The five canonical docs and historical evidence are tracked; do not repeat the old ignore changes.

**Remaining steps (when assigned):**

1. After Smart Mix merges to `main`, update remote refs from `/Users/diego/Code/crate-v3` and
   rebase the integration branch onto that actual merge result. The integrator owns this operation;
   coordinate any published history before rewriting it.
2. Reconcile Smart Mix overlap: Android EQ, Camelot, migrations, backend runtime, settings and
   catalogs. Re-evaluate 2.9b, 2.13 and 5.14 against the integrated code; do not recreate modules or
   renumber migrations already settled by the Smart Mix agent. Resolve symbols, not stale lines.
3. Integrate `feat/website` (`app/web` and `app/docs`) into `feat/crate_v3` after a reviewed diff.
   Keep visual reference pin `258bbaee` until Diego approves a resync and all three design docs
   record the replacement SHA. A branch location alone never changes the pin.
4. Push, open PRs or dispatch CI only after explicit approval. Keep `feat/crate_v3` as the product
   integration branch until the joint P0 major. Foundation is an internal checkpoint, not a public
   release or permission to retire the branch.
5. Verify the integrated result with the relevant task and release gates when assigned. The site
   screencast and screenshots are re-recorded from the final v3 UI, with no instance domain.

### Task 0.2: Internal working clone

**Status: done.** The standalone clone is `/Users/diego/Code/crate-v3`; its object store and local
dependencies are on the internal disk. Do not recreate it or restore the removed external worktree.
Assigned agents use isolated internal-disk worktrees; the integrator owns canonical status updates.
Baseline measurements and CI/device results must remain attributed to the revision actually tested.
No new verification is implied by this status entry.

### Task 0.3: Reconciled decisions and delivery protocol

**Status: product decisions accepted.** The decision register carries PD1–PD54. The latest accepted
amendment replaces all theme/skin/mode/accent variants with the single Crate v3 identity (PD53,
DS D13/D16/D41/D42). It preserves semantic tokens, accessibility and motion. Full runtime removal
is Task 1.13, not part of the current primitive batch.

PD48 now includes the small Admin capture set and the accepted 520 KiB initial-JS ceiling; the
recorded Admin baseline is 514,659 B gzip. Baselines and CI results still require actual review.
The joint major retains the existing P0 boundary; P1/P2 and coverage remain later work unless Diego
expressly changes scope. R0 `[MAIN]` fixes remain separately assigned and operationally isolated.

Task estimates and calendar assumptions are provisional and need updating for the joint-release
protocol and Task 1.13. Do not treat summed task-days as an accepted delivery date or reopen the
settled visual decisions. No commit, push, PR, deployment or production query is authorised by a
recorded decision.

### Task 0.4: Align names, contracts, facts and order across the v3 docs

**Status:** original alignment implemented. Comparison columns below preserve the pre-alignment
baseline; the current decision register and rollout supersede historical alternatives.

**Files:**

- Modify: `docs/plans/2026-10-14-crate-v3-design-system.md` (the sections named below)
- Modify: `docs/plans/2026-10-14-crate-v3-product-design.md` (the sections named below)

**Steps:**

1. Settle each name and contract once, and edit every place in PD and DS that differs:

   | Item                                                | Spec says                                                                                                                                                                                                                                                           | Product design says                                                                                                                                                                                   | Use                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
   | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Admin live stream route                             | `/api/admin/live` (DS §3.9, §4.19, §4.20), a separate `/api/admin/health-checks-stream` (DS §4.14), 5 s and 15 s polling "until the live stream exists" (DS §4.23, §4.24)                                                                                           | `/api/admin/live-stream`                                                                                                                                                                              | `/api/admin/live-stream` everywhere. Delete the health-checks stream alternative and the polling fallbacks: 2.14 ships before those panels, and a second per-surface stream breaks the one-stream-per-tab rule. Close PD §5.3.1's UNCERTAIN: Traefik routes only the listed GET prefixes to the read plane (`docker-compose.yaml:460-478`) and `/api/admin/*` goes straight to crate-api, so the suffix is a naming convention, not a routing need                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
   | Admin live files                                    | `contexts/AdminLiveContext.tsx`, `hooks/use-admin-live.ts`                                                                                                                                                                                                          | `contexts/AdminLiveProvider.tsx`                                                                                                                                                                      | `app/ui/src/contexts/AdminLiveProvider.tsx` plus `app/ui/src/hooks/use-admin-live.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
   | Admin module homes                                  | DS §4.0 homes under `components/viz/…` (`QueueLanes`, enrichment, stack map, event pipeline), `components/viz/StepRail.tsx`                                                                                                                                         | domain folders, no `components/viz`                                                                                                                                                                   | domain folders (`components/{health,ops,genres,analysis,acquisition,federation}`, `components/album/portable-metadata`, `components/artist/enrichment`); `StepRail` in `components/admin/StepRail.tsx` (moves to `app/shared/ui/domain/tasks/StepRail.tsx` in 6.15; PD §3.1.4 and §4.22 name that path, not `@crate/ui/domain`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
   | `PageHeading`                                       | `components/layout` (DS §2.5)                                                                                                                                                                                                                                       | `components/admin` (PD §3.1.4)                                                                                                                                                                        | `app/ui/src/components/layout/PageHeading.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
   | Snapshot reconnect hook                             | `use-snapshot-stream.ts`                                                                                                                                                                                                                                            | same                                                                                                                                                                                                  | `app/ui/src/hooks/use-snapshot-stream.ts`; replaces `use-sse.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
   | Effective-EQ inheritance field                      | `inheritedPath` (DS §4.1 `EffectiveEq`)                                                                                                                                                                                                                             | `genrePath` (PD §4.12; also DS §4.4, plan 2.19)                                                                                                                                                       | `genrePath`. Replace DS §4.1's type with a pointer to PD §4.12, whose chain links carry the optional `genre`/`genrePath`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
   | Paths column                                        | `music_paths.plan JSONB` (DS §4.8, DS §4.0 "blocked by `music_paths.plan`")                                                                                                                                                                                         | `music_paths.plan_meta`                                                                                                                                                                               | `plan_meta`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
   | Setlist helper                                      | `@crate/ui/lib/setlist.ts` "to avoid explicit exports" (DS §4.6)                                                                                                                                                                                                    | `@crate/ui/domain/shows/setlist.ts` with explicit exports (PD §4.18)                                                                                                                                  | `@crate/ui/domain/shows/setlist.ts` with explicit `exports` entries                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
   | Route layout module                                 | `lib/sound-map/path-route-layout.ts` (DS §4.8)                                                                                                                                                                                                                      | —                                                                                                                                                                                                     | `app/listen/src/components/paths/path-route-layout.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
   | Health surface (PD §4.2 is canonical)               | DS §4.14: `auto`, `bulk_fix`, `totals.{auto_checks,confirm_checks,auto_open}`, `last_run{started_at,duration_ms}`, `phase: scan\|fix\|revalidate\|sync`, `trash{track_files,updated_at}`, separate stream with `event: surface`/`event: check`, 6 h stale threshold | `checks[].unattended`, `fix_mode: global\|bulk\|per_artist`, `totals.{unattended,confirm,open_unattended}`, `last_scan`, `running.phase: scan\|repair\|sync\|revalidate`, `trash.albums_quarantined`  | PD §4.2 fields. `health-scan` is an event type on the single `health` surface, not a second surface (PD §4.2, §5.3.1, plan 2.14, 2.17c). The event union keeps `fixed`, emitted by repair runs (2.17d). Rewrite DS §4.14 Data to match                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
   | Active node fill (`SystemMap.astro:185`, `#0b1d24`) | new `--surface-accent-active` = `color-mix(accent-action 11%, surface-canvas)` ≈ `#0a1d25`                                                                                                                                                                          | "no new tokens", `color-mix(accent-action-hi 10%, surface-object)` ≈ `#16242b` (PD §3.1.1)                                                                                                            | DS's `--surface-accent-active`; delete PD's formula. Created in its first consumer, Task 3.7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
   | EQ blast radius                                     | client re-resolve (DS §4.4) vs "server-computed" (DS §4.3)                                                                                                                                                                                                          | client re-resolve, with the tie-break described as current behaviour: "depth first, then slug order; Go `ORDER BY depth, path COLLATE "C"`" (PD §4.6.1)                                               | client re-resolve over the wheel payload; albums and tracks are the sum of `eq.reach` over the nodes whose resolved source changes, exact because reach follows the track's single primary genre. Tie-break, stated as it is: the client mirrors Python's `resolve_genre_eq_preset` (`genre_taxonomy.py`), a BFS over parents sorted at each level, so equal-depth ties resolve in path order. Go today orders by the owner's slug (`ORDER BY depth, slug` in `genreTaxonomyContext` and `genrePresetSQL`, `readplane/internal/catalog/genre.go`), so the servers can disagree: owners `c` and `z` at depth 2 via parents `b` and `a` give `z` in Python and `c` in Go. Go moves to path order in Task 2.18a (G2 parity). "Slug order" describes neither implementation. The `a`/`b`/`z`/`c` case goes into `genre_eq_path_cases.json` (2.18a), read by pytest, the Go table test and `genre-wheel-math.test.ts`. Delete "server-computed" from PD §4.6.1 and DS §4.3 |
   | Genre wheel node aliases                            | —                                                                                                                                                                                                                                                                   | "aliases with origin" and alias search, but `nodes[]` carries only `alias_count` (PD §4.6.1, §4.6.3)                                                                                                  | add `aliases: {alias: string; origin: string}[]` per node to `GenreWheelPayload` (Task 2.18b)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
   | Admin genre wheel and enrichment sources endpoints  | `GET /api/genres/taxonomy/wheel` with `_require_auth` (DS §4.3); `GET /api/artists/{id}/enrichment/sources` (DS §4.18, plan 2.18c, 3.7, 3.12a)                                                                                                                      | `GET /api/admin/genres/wheel` and `GET /api/admin/artists/{id}/enrichment/sources`, both `library.view` (PD §1 table, §4.5, §4.6.3)                                                                   | the PD routes and permission, in DS §4.3, DS §4.18 and plan 2.18c, 3.7 (`use-genre-wheel`), 3.12a. `POST /api/artists/{id}/enrichment/refresh` keeps its path (PD §4.5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
   | Listen wheel contract                               | "rebuild when the global catalog serving mode flips" (DS §4.3)                                                                                                                                                                                                      | `ListenGenreWheelPayload`, core nodes only, "no local overrides" (PD §4.6.3)                                                                                                                          | `ListenGenreWheelPayload` with its triggers (Task 5.10): core nodes only; structure and `eq.*` come from the live, override-aware runtime graph (local overrides and suppression applied, as `/eq` resolves them), so the Listen wheel and the genre-page "EQ inherited from …" line agree with Smart EQ's `genrePath`; still no unmapped tags, provenance, suppression flags or custom gains. Cached under its own Listen scope `genre_wheel` (5.10), never `library`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
   | `LegendStrip`                                       | fifth shared primitive used by both apps (DS §2.3, §3.2)                                                                                                                                                                                                            | four primitives (PD §3.1.4)                                                                                                                                                                           | drop it from DS §2.3 and §3.2; legends are an inline `dl` of swatch plus `MonoLabel` inside each instrument until two apps share one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
   | Scramble and count-up                               | `@crate/ui/lib/scramble.ts` (DS §1.8.4, §2.4)                                                                                                                                                                                                                       | app-local until both apps call it (PD §3.1.4)                                                                                                                                                         | app-local first, moved to `@crate/ui/lib/` by the task where the second app adopts it: scramble is Admin-local from 3.1 (first caller: 3.7's `GenreEqInheritancePanel` display word) and moves in 4.5 (Listen's EQ trail; 4.6's Stats top genre reuses it); count-up moves in 3.6. Correct DS §1.8.4 and §2.4 to "Admin-local until 4.5"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
   | Spring, `use-eq-morph`, visible loop                | `lib/spring.ts`, `lib/use-eq-morph.ts`, `lib/use-visible-loop.ts` in `@crate/ui/lib` from the `EqBands` fix (DS §2.4, §4.1 Home)                                                                                                                                    | "Motion gate, `stepSpring`, `useVisibleLoop`" in `@crate/ui/lib` at the `EqBands` morph fix (PD §3.1.4)                                                                                               | only `motion-gate.ts` and `eq-curve.ts` go into `@crate/ui/lib` in 0.7 (`export-usage-policy.test.ts` checks every `lib/*` export and follows only `export … from`). Spring and `useEqMorph` live in `domain/player/eq-morph.ts` (not exported) until 4.3, where Listen's `EqGlyph` imports `use-eq-morph` directly and `use-eq-morph.ts` re-exports the spring helpers; 3.5's `GovernorGauges` is the second, direct importer of `spring.ts`. `use-visible-loop` is Admin-local from 3.4 and moves with its first Listen importer. Fix PD §3.1.4, DS §2.4 and DS §4.1 Home                                                                                                                                                                                                                                                                                                                                                                                           |
   | `nivoTheme` count                                   | "replaces six inline themes" (DS §2.5)                                                                                                                                                                                                                              | "3 hex themes plus inline objects" (PD §3.1.4)                                                                                                                                                        | 3 `NIVO_THEME` constants (`AudioProfileCard.tsx`, `ArtistStats.tsx`, `Insights.tsx`) plus 6 inline `theme={{…}}` objects in 4 files (`TrackTable.tsx`, `ArtistStats.tsx`, `Dashboard.tsx` ×3, `SystemHealth.tsx`); Task 3.1 lists them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
   | `.stats-heatmap*` recipe                            | visual CSS lives in the app (DS §6.7)                                                                                                                                                                                                                               | extend the shared recipe (PD §4.17)                                                                                                                                                                   | Listen CSS in 4.6, moved to shared `recipes.css` in 5.12 when Admin adopts it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
   | Ticket recipe                                       | `.setlist-ticket-*` in shared `recipes.css` (DS §4.6)                                                                                                                                                                                                               | —                                                                                                                                                                                                     | Listen `index.css` in 0.9, moved to shared `recipes.css` in 4.7b when Admin adopts the ticket                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
   | Imports surface                                     | —                                                                                                                                                                                                                                                                   | `GET /api/imports/queue` with `updated_at`, four totals, a fixed order and a 50-imported cap (PD §4.3)                                                                                                | PD §4.3's contract is canonical and Task 5.7a implements it: route `/api/imports/queue` (not `/surface`), items with `updated_at`, `totals {pending, queued, importing, failed}`, pending, queued, importing and failed first, then the last 50 imported. Staged imports run `import_queue_item` and `import_queue_all`, not `process_new_content`; both write per-item status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
   | Maintenance window                                  | catalog `maintenance_window` as `"unscoped" \| "unscoped_or_large_limit" \| null` (DS §4.19) and "the two values only" (DS §4.20)                                                                                                                                   | `"none" \| "unscoped" \| "unscoped_or_large_limit"` (PD §4.8, plan 2.15c)                                                                                                                             | 14 types, all only when unscoped; `backfill_track_audio_fingerprints` also when `limit` > `CRATE_MAINTENANCE_WINDOW_FINGERPRINT_LIMIT`. No type is "always" (`_requires_maintenance_window` returns `not _has_specific_scope(params)` for the 11 `MAINTENANCE_WINDOW_TASK_TYPES` too). Two shapes: the task-catalog field is `"none" \| "unscoped" \| "unscoped_or_large_limit"` for every type (2.15c); `GovernorSurface.governed.window_rule` is a 14-entry record holding only the two scoped values (2.16). Fix DS §4.19 and §4.20. The window applies only when `CRATE_MAINTENANCE_WINDOW_ENABLED` is true (code default false, compose true)                                                                                                                                                                                                                                                                                                                    |
   | G1 data model (blocking)                            | `core_eq_gains`, `eq_source`, `metadata_overridden`; the live columns hold the curator value (DS §4.3 Preconditions and pytest list)                                                                                                                                | same (PD §4.6.3 item 5, PD §5.3.4 "Genres (G1, PD18)" row)                                                                                                                                            | Task 2.18d's model is canonical: `genre_taxonomy_nodes.local_eq_gains`, `eq_override` (`none \| set \| cleared`), `local_name`, `local_description`; `eq_gains`, `name` and `description` keep the core release value; live = `COALESCE(local, core)`, with `eq_override = 'cleared'` meaning inherit. The PD model is not rollback-safe: the pre-v3 seeder runs on every boot and rewrites `eq_gains`, `name` and `description` of core genres. Derived fields: `nodes[].eq.overridden = eq_override <> 'none'`; `totals.overridden_nodes` counts nodes with `eq_override <> 'none' OR local_name IS NOT NULL OR local_description IS NOT NULL`; Go `genrePresetSQL` reads the same live value. Add 2.18d's rollback test (run the pre-v3 seeder SQL over a v3 row; every override survives) to the PD and DS test lists. `genre_taxonomy_edges.suppressed` stays as it is                                                                                           |
   | G1 ship order                                       | read-only wheel before G1; "EQ edit … after G1, G2, G3 and G7, plan Task 3.8"; "G3 (plan Task 3.8)", "Edge hiding (plan Task 3.8)"; core writes hidden "until G1 ships" (DS §4.3, §4.4, §6.11)                                                                      | "The read-only wheel (plan 3.7) ships before G1, G2, G3, G7"; "Until G1 and G2 ship, every EQ write on a core genre is disabled" (PD §4.6.1, PD18, §5.5)                                              | 2.18a–e (G1, G2, G3, G7 and suppression) land in the Genres group before 3.7; 3.8 is frontend only; nothing is disabled in any release. Delete PD §4.6.1's "Until G1 and G2 ship…" paragraph, PD18's "Until it ships, EQ writes on core genres are disabled", the ordering lines in PD §5.5 and DS §6.11, and DS §4.3/§4.4's "until G1" gating. In DS §4.3, G3 and edge hiding become backend 2.18e / 2.18d, UI 3.8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
   | Analysis coverage fields                            | "no lyrics coverage, no portable-metadata coverage" (DS §4.5 Coverage)                                                                                                                                                                                              | same, with new `lyrics_done`, `portable_written`, `portable_never`, `portable_drift` (PD §4.7 Data)                                                                                                   | as Task 3.9a: the `analysis_status` block (cheap counters every 120 s, full scans every 15 min) already spreads `get_portable_metadata_status()` (`db/jobs/analysis_status.py`), which stores `lyrics_cached`, `lyrics_found`, `lyrics_missing`, `portable_sidecar_albums`, `portable_audio_tag_albums`, `portable_audio_tag_tracks`, `portable_tag_errors` and `rich_export_*`. `AnalysisStatusResponse` declares them under those names; only `fingerprint_failed` (3.9a) and portable `drift` (3.10a) are new. Rewrite PD §4.7 Data and the DS §4.5 Coverage bullet                                                                                                                                                                                                                                                                                                                                                                                                |
   | Smart Mix coverage row                              | —                                                                                                                                                                                                                                                                   | "Smart Mix after its merge" in the Coverage panel (PD §4.7)                                                                                                                                           | add to PD §4.7: `StatusDot` plus the word `idle`, `running` or `paused`; Start, Pause and Resume as `CratePill` actions; Cancel through `ConfirmDialog`; campaign state from `GET /api/admin/smart-mix/status` (`sm:app/crate/api/smart_mix_admin.py`), refetched on the task's `task_done`, no new stream (Task 5.14 item 3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
   | Health `running` key and writers                    | "a Redis key with a 90 s TTL refreshed by each scan event"; `refresh_admin_surface` with a "generation counter" (DS §4.14 Data)                                                                                                                                     | 30 s heartbeat thread, deletion in `finally`, snapshot written at start and end of `health_check`, `repair` and `library_pipeline`; `refresh_admin_surface` trailing-edge (PD §4.2 items 5–6, §5.3.2) | PD §4.2 items 5–6 (Tasks 2.17b, 2.17c); `refresh_admin_surface` uses the Conventions due-set recipe, no generation counter (2.11b). Rewrite DS §4.14 Data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
   | Health drill-down                                   | —                                                                                                                                                                                                                                                                   | "a paginated read of open issues" for one check type, with no route or shape (PD §4.2 item 9)                                                                                                         | add Task 2.17c's contract to PD §4.2 item 9: `GET /api/admin/health-checks/{check_type}/issues?cursor=&limit=` (`library.repair.run`), keyset-paginated by artist, returning `{check_type, total_issues, total_artists, artists: [{artist_id, artist, issues: […]}], next_cursor}`, refetched when the `health` live event changes that check's `open`. `/api/admin/health-stream` becomes a deprecated alias for one release; the Health page opens no stream of its own (3.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
   | Coalescing recipe                                   | "enqueue with `delay=window`" (DS §3.9)                                                                                                                                                                                                                             | same (PD §5.3.2, §4.2 item 6, §4.6.3 item 2)                                                                                                                                                          | the Conventions due-set recipe: no `tasks` row before the build is due, because `redispatch_stale_pending_tasks(age_seconds=300)` re-dispatches older pending rows with no delay; cold reads schedule at once. Windows: genre wheel ≥ 120 s, mood map ≥ 900 s, insights 30 min, bliss map 6 h, ops 60 s, admin surfaces 5 s, federation structure ≥ 5 s. Rewrite DS §3.9 and PD §5.3.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
   | Demand gating cadence                               | "check the key on every tick" (DS §3.4, §3.9); "the next tick rebuilds" (DS §4.19)                                                                                                                                                                                  | "check the key once per second (one Redis `EXISTS`)" (PD §5.3.1)                                                                                                                                      | PD's 1 s `EXISTS` check, also in DS §3.4, §3.9, §4.19, §4.20, §4.23 and §4.24. Add the hidden-tab rule to PD §4.1, §5.3.1 and DS §3.9: `AdminLiveProvider` closes the stream after 30 s hidden, and the Dashboard never subscribes to `queues` or `governor` (3.1, 3.3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
   | Viewer and runtime key names                        | `stack:viewers` (DS §3.9, §4.22)                                                                                                                                                                                                                                    | `admin:live:viewers:stack` (PD §4.8, §5.3.1); runtime keys `crate:runtime:<surface>`                                                                                                                  | `admin:live:viewers:<surface>` everywhere, one constant per surface in `app/crate/admin_viewers.py`; runtime samples in `crate:runtime:<surface>` (`governor`, `acquisition`, `event_pipeline`, `redis`, `stack`); never `crate:ops:governor`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
   | Stack persistence                                   | —                                                                                                                                                                                                                                                                   | stack endpoints "only read `ui_snapshots('ops:stack','global')`", sampled every 10 s (PD §4.8)                                                                                                        | each sample goes to `crate:runtime:stack` plus a publish; `ui_snapshots('ops:stack','global')` is written only on a state change or at most once per 60 s; the GET reads the Redis key, else the row; `stack-stream` forwards published payloads (5.5). Fix PD §4.8 Stack and DS §4.22                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
   | Mood map refresh                                    | 300 s window; `scopesForUrl` maps mood map and explore page to `explore` and `library`; `explore` broadcast on every build (DS §4.10)                                                                                                                               | ≥ 900 s; `explore` only; broadcast only when counts or sample change (PD §4.14)                                                                                                                       | PD §4.14 (Tasks 4.8a, 4.8b). Fix DS §4.10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
   | Genre wheel Listen scope                            | —                                                                                                                                                                                                                                                                   | `/api/catalog/genre-wheel` with no scope; by prefix `lib/cache.ts` maps it to `library`                                                                                                               | a dedicated `genre_wheel` scope, broadcast by `refresh_genre_wheel_snapshot` only when the `crate-core` row's version or digest changes; an explicit `scopesForUrl` branch before the `/api/catalog` and `/api/browse` prefix rules (5.10). Add to PD §4.6.3, §5.3.5 and DS §4.3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
   | Genre wheel triggers                                | —                                                                                                                                                                                                                                                                   | `index_genres` and `process_new_content` completion, deletes, curator mutations (PD §4.6.3 item 2)                                                                                                    | trigger from the choke point: `set_artist_genres` and `set_album_genres` (`db/repositories/genres_assignments.py`) schedule a refresh after commit, only when the stored set changed (covering `enrich_artist(s)` Last.fm tags, `POST …/enrichment/refresh` and the genre indexer), plus `db/jobs/repair_artist_jobs.py`'s `artist_genres` rewrite, curator mutations, deletes and a nightly floor (2.18b). Update PD §4.6.3 item 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
   | EQ drag writes                                      | "Drag updates are batched to one `onBandChange` per frame" (DS §4.1 Motion)                                                                                                                                                                                         | per-frame writes (PD §4.12 Actions)                                                                                                                                                                   | during a drag or key repeat, gains go to the engine through a ref (Web Audio ramp; Android native `setEq` throttled to 15–20 Hz) and to the live store at most once per frame; prefs (`localStorage` plus `EQ_PREFS_EVENT`) are written once on pointerup, blur or 150 ms after the last key (0.7, 4.3). Fix DS §4.1 and PD §4.12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
   | Federation topology triggers                        | —                                                                                                                                                                                                                                                                   | "other federation events to the topology", no coalescing (PD §4.10)                                                                                                                                   | structural events (pairing, grant, peer, `catalog.sync.completed`, `health.polled`) rebuild with trailing-edge coalescing ≥ 5 s; `federation.stream.*` and relay events only set a dirty key, honoured while `admin:live:viewers:federation` exists (at most one rebuild per 5 s) and otherwise left to the 60 s health-poll floor (5.8). Fix PD §4.10 and DS §4.21                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
   | Acquisition covers (B20)                            | —                                                                                                                                                                                                                                                                   | "server-side cover lookup" as an endpoint (PD §4.4)                                                                                                                                                   | `POST /api/acquisition/covers {items: [{artist, album}]}` (≤ 50): one `MGET` or `= ANY(:keys)` read of a cover cache keyed by normalised (artist, album), hits only; misses enqueue one deduplicated fast task (batch, 3 s provider timeout, positive and negative results cached with a TTL); results arrive through `publish_task_signal` or a later request; no provider call in a request (5.6). Add to PD §4.4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
   | Acquisition sampler cadence                         | 2 s while watched or while transfers are active (DS §3.9)                                                                                                                                                                                                           | same (PD §4.4)                                                                                                                                                                                        | 2 s only while `admin:live:viewers:acquisition` exists; every 30–60 s without viewers while transfers are active (keeps `ops_runtime_state('acquisition')` and the lifecycle reconciler current); idle otherwise (5.6). Fix PD §4.4 and DS §3.9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
   | Paths planning (B18)                                | —                                                                                                                                                                                                                                                                   | synchronous routes kept through v3.0; phase C in Phase 5 (PD §4.16)                                                                                                                                   | the task route (`compute_music_path`, `POST /api/paths/plan`, `/regenerate?mode=task` → 202) lands in 4.9a; new Listen builds and 4.9b's Regenerate use only it; `plan_meta` is written only inside the task (plus a backfill); the synchronous routes get a deprecation date, a per-user rate limit, and skip LLM refinement. Update PD §4.16 and PD36                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
   | PD43 on the server                                  | —                                                                                                                                                                                                                                                                   | hidden below 3 listeners in the UI (PD §4.17)                                                                                                                                                         | the instance builder hides it: below 3 listeners `heatmap.cells` is an all-zero 7×24 grid (shipped Listen builds call `cells.flat()`), `peak` and `night_share` are `null`, and `hidden_reason` is `"few_listeners"`; same for `heatmap_utc` (2.20, 5.12). Add the response change to PD §3.4.2 and §4.17                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
   | Redis-durable memory                                | "512 MB … the value in `docker-compose.yaml`, which the site test reads; 384m is only the home compose" (DS §6.5)                                                                                                                                                   | same (PD §5.3.6)                                                                                                                                                                                      | crate-redis-durable has `mem_limit` 512m (`docker-compose.yaml`) or 384m (`docker-compose.home.yaml`), and `--maxmemory 384mb` in both. The site test (`content/architecture/viz.test.ts`) pins the redis-server flags (`--maxmemory 384mb`, `noeviction`) from `viz.ts`, not the container limit; `map.ts` memory figures are untested. The RedisPair durable meter uses `maxmemory` (384 MB), not the container limit (5.4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
   | Admin screenshots                                   | "Admin has no screenshot suite; functional Playwright only [D25]" (DS §6.6)                                                                                                                                                                                         | PD48: "Admin functional tests only until instruments stabilise"                                                                                                                                       | a small Admin capture set from Task 0.11 (before Task 1.0), extended by each P0 page task; the Admin bundle ceiling from Task 0.12. Fix DS §6.6 and PD48                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
   | New tokens                                          | first consumers listed (DS §1.9.4)                                                                                                                                                                                                                                  | —                                                                                                                                                                                                     | owning tasks: `--text-display-page` and `--tracking-headline` in 3.1; `--text-display-entity` in 4.7b; `--text-display-readout` (a minifier-safe guarded fallback, verified when 3.9b implements it) in 3.9b; `--text-subhead` in 4.1; each with `cn.ts` registration and the ceiling bump listed in the commit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
   | Camelot module                                      | —                                                                                                                                                                                                                                                                   | "moved in a small `[MAIN]` PR tagged `[BEHAVIOUR]`" that rewires `bliss._key_compatibility` (PD §4.7, PD2)                                                                                            | 2.9b adds `app/crate/camelot.py` and its fixture and rewires `bliss._key_compatibility` to it, tagged `[BEHAVIOUR]`: flat keys (`Bb`, `Eb`, `Ab`, …) stop falling back to neutral compatibility, so Radio and Paths key scoring changes for tracks Essentia tagged with flats (PD §3.4.2, §4.7). The Smart Mix branch imports `crate.camelot` when it next merges `main`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
   | Site pin and register range                         | —                                                                                                                                                                                                                                                                   | "decision register `[D1]`–`[D40]`" (PD header); PD53 mapped to "—"                                                                                                                                    | pin `258bbaee` in the PD and DS headers (plan header); PD header range `[D1]`–`[D43]` (DS has [D41] and [D42]; Task 0.3 adds [D43] = PD54); PD53's column becomes `[D41], [D42]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

2. Fix the facts and examples that contradict the code:
   - EQ example strings (PD §4.11, §4.6.2, DS §4.2, DS §4.4). `black-metal` has `_EQ_BLACK_METAL`,
     `doom-metal` has `_EQ_DOOM`, and clearing `hardcore-punk` inherits punk from punk. Use
     "Equalizer: Smart, Thrash metal, from Metal", `SMART · Thrash ← metal`, and for Clear
     "powerviolence will inherit hardcore from hardcore punk".
   - Radio weights (PD34, PD §5.3.6, DS §4.9, DS §6.5): the site weights are correct for
     discovery radio; the only site fix is "Camelot" → "Key". Remove "Radio weights" from the
     "product contradicts" lists.
   - "Claims on the site … that the product contradicts" (PD §5.3.6, DS §6.5 last paragraph):
     drop Paths costs (the site's 1.0/1.6/2.5 match `db/paths_scene._genre_neighbors`) and
     NIGHT_HOURS (`[22,23,0..5]` matches `_NIGHT_HOURS`). Rewrite the redis-durable sentence, which
     mixes two settings: crate-redis-durable has `mem_limit` 512m in `docker-compose.yaml` (384m in
     `docker-compose.home.yaml`) and `--maxmemory 384mb` in both. The site test
     (`content/architecture/viz.test.ts`) pins the redis-server flags (`--maxmemory 384mb` and the
     policy, from `viz.ts:10`), not the container limit, and `map.ts` memory figures are not tested
     at all, so "`map.ts` matches the file the site test reads" is wrong too. The RedisPair durable
     meter warns at 75 % of `maxmemory` (384 MB), not of the container limit, because `noeviction`
     rejects writes there. The real production mismatches are the `docker-compose.project.yaml`
     limits: crate-api 1536m (site 768 MB, also the PD §4.8 Stack example "412 / 768 MB"),
     readplane 256m (site 128 MB), postgres 4g (site 1 GB), projector 768m (site 512 MB). The
     Stack map reads real limits from the sampler, never from `map.ts`.
   - DS §6.5 docker-compose row: "PD45 lowers `maxmemory`; the branch that lands second updates
     the site test" instead of "keep".
   - Admin colour counts (PD §2.3 item 6, DS §0.3, §1.1.4): "~1,400 `*-white/N` (+~200 bare
     `*-white`)", "~48 violet/fuchsia/blue/sky", "89 inline hex in `.ts`/`.tsx`". The
     emerald/green/red/rose (398) and amber/yellow/orange (~288) counts stand.
   - PD §4.3 cites `IDENTITY_TAG_KEYS` as existing; it does not (Task 3.10a creates it).
   - PD §5.3.3: replace the UNCERTAIN note on completion notifications with the rule in
     Conventions (`notify`/`quiet` on `TaskTypeInfo`); the code sends for every type today.
3. Add the missing rows to PD §3.4.2 (behaviour changes to warn about before merging):
   - task streams and `GET /api/tasks/{id}` are restricted to the owner and the capability that
     queued the task (Task 2.2);
   - the projector resumes its side-effecting projections (post-acquisition `process_new_content`,
     per-user home rebuilds, recently-played refreshes), behind
     `CRATE_PROJECTOR_SIDE_EFFECTS_ENABLED` (Task 2.10);
   - genre counts drop under the PD21 definition (Task 2.18c);
   - `GET /api/admin/health-snapshot?check_type=` is replaced by the paginated drill-down and kept
     one release as a deprecated alias, and `/api/admin/health-stream` is deprecated the same way
     (Task 2.17c);
   - the instance heatmap is a zero grid with `hidden_reason: "few_listeners"` below 3 listeners
     (Task 2.20, PD43);
   - the synchronous Paths routes skip LLM refinement and are rate-limited per user (Task 4.9a);
   - disabled enrichment sources are no longer fetched (Task 3.12c, PD29);
   - mood playback samples from a pool of at most 400 uids instead of `ORDER BY RANDOM()` over
     every match (Task 4.8a);
   - `/api/me/upcoming` setlists move to a top-level map; per-show fields stay, deprecated, until
     the minimum client version stated in PD §4.18 (Task 4.7a);
   - `reanalyze_album` is deduplicated (Task 3.9a);
   - the v2 genre tree shows `—` counts while the wheel snapshot is cold (Task 2.18c).
     Also state in PD §4.18 that per-show `probable_setlist` fields stay in `/api/me/upcoming` until
     that minimum client version. Keep the PD §3.4.2 row that says Task 2.9b changes Camelot key
     scoring: it is a behaviour change (flat keys now score), shipped with the `bliss.py` rewire.
4. One delivery order. Replace PD §5.5 and DS §6.11 with a one-line pointer to this plan's phases
   and Rollout → Milestones. PD §3.1.7's "must be reconciled into one order" is then closed. That
   pointer replaces PD §5.5's "With PD2 = (a), Smart Mix merges before plan Phase 2B" and "The
   read-only wheel (plan 3.7) ships before G1…" lines: `main` is canonical for migration numbers,
   and 2.18a–e land before 3.7.
5. Mapping cards: remove the "26 verified mapping cards" references (PD header and "Relation to
   other documents", DS §4 intro) and state that PD and DS carry every verified correction, or cite
   `docs/plans/crate-v3-analysis/cards/` if Task 0.1 committed them.
6. Keep the single Crate v3 identity decision aligned in DS §6.9 item 6, PD53 and Task 1.13.
7. Verify:
   - `grep -n "inheritedPath\|music_paths.plan JSONB\|lib/setlist\|health-checks-stream\|/api/admin/live?\|LegendStrip\|server-computed\|Black metal\|Doom ← metal\|hardcore from punk\|core_eq_gains\|eq_source\|metadata_overridden\|crate:ops:governor\|/api/imports/surface\|stack:viewers\|Until G1\|until G1\|lyrics_done\|portable_written\|then slug order" docs/plans/2026-10-14-crate-v3-{product-design,design-system}.md | grep -v "no \`LegendStrip\`"`prints nothing (DS keeps its two "there is no`LegendStrip`" lines);
   - `grep -c "local_eq_gains" docs/plans/2026-10-14-crate-v3-{product-design,design-system}.md`
     prints a non-zero count for both files.

Commit: `docs(v3): align names, contracts and delivery order across the v3 docs`.

### Task 0.5: Amend the chart rule (PD1 / [D1])

Only after Diego approves PD1 (b).

**Files:**

- Modify: `AGENTS.md:69`
- Modify: `app/ui/AGENTS.md:28`
- Modify: `app/listen/AGENTS.md:60`
- Modify: `app/shared/AGENTS.md` (charts paragraph)

**Steps:** replace "Charts use Nivo" with this rule:

> Statistical charts (bar, line, pie, scatter, heatmap, radar) use Nivo with the app's token-resolved
> theme. Instruments (EQ curve, genre wheel, readouts, rails, lanes, gauges, maps, mood map,
> heatmap band, ticket, crossfade strip, orbit, topology) are hand-built SVG, HTML/CSS, Canvas 2D or
> WebGL2, following `docs/plans/2026-10-14-crate-v3-design-system.md` §3.5. No new chart libraries;
> recharts stays out.

In `app/listen/AGENTS.md`, delete the "do not add new custom charts elsewhere" clause. Precedent:
`EqBands` and the Stats signal tape.

Commit: `docs(agents): allow hand-built instruments next to Nivo charts`.

### Task 0.6: `surface-object` token and drift ceilings

The drift check fails today. This task and Task 0.7 bring it back to green and land in the same PR.

**Files:**

- Modify: `app/shared/ui/lib/appearance-token-registry.ts` (new role `surface-object` = card solid, `#0d0e14` in default dark)
- Modify (generated): `app/shared/ui/tokens/themes.css`
- Modify: `app/shared/ui/tokens/surfaces.css` (utility `bg-surface-object`)
- Modify: `app/listen/src/components/upcoming/ShowCard.tsx` (`bg-card` → `bg-surface-object`, first consumer)
- Modify: `scripts/design-system/drift-budget.json`:
  - `definitions` and `foundationDefinitions` raised to the measured values (138 + 1 and 95 + 1);
  - `arbitraryUtilities` 64 → 61, the measured value.
- Test: `app/shared/ui/lib/appearance-token-registry.test.ts`

**Steps:**

1. Failing test: the registry resolves `surface-object` to `#0d0e14` in default dark and to the
   card solid value in every other preset.
2. Implement, run `TOKENS-GEN`, and apply the `ShowCard` change.
3. Verify:
   - `VT-UI lib/appearance-token-registry.test.ts`
   - `GATES`: only `inlineStyles` may still fail, until Task 0.7.
4. Commit: `fix(ui): add the surface-object token and restore drift ceilings`. The body lists the
   ceilings raised and why.

### Task 0.7: `EqBands` spring morph without inline styles (fixes the `ce506e86` regression)

**Why:** handles glide 500 ms while the curve jumps; four `style={{}}` push the drift check over
budget.

**Why `eq-morph.ts` is not in `lib/`:** every `lib/*.ts` file is a package export, and
`app/shared/ui/export-usage-policy.test.ts` fails on any export no app imports
(`expect(unused).toEqual(Object.keys(UNUSED_EXPORT_ALLOWLIST))`). The policy follows
`export … from` but not `import`, so a spring module that only `EqBands` imports would read as
unused. `domain/*` exports only `.tsx`, so a `.ts` helper next to `EqBands` is not checked. Each
helper moves to `lib/` in the task where an app imports it directly (DS §2.4: the first consumer
keeps a local copy until then).

**Files:**

- Create: `app/shared/ui/domain/player/eq-morph.ts` (not exported), test `eq-morph.test.ts`
  - `stepSpring` (semi-implicit Euler), `springsSettled` (|Δ| and |v| below 0.01), `createSpringSet`
  - `dt` clamped to 50 ms, 1/60 on the first frame
  - `useEqMorph`: rAF only until settled; skips the dragged band; first paint equals the target;
    motion gate injected
  - promoted in Task 4.3: `useEqMorph` to `@crate/ui/lib/use-eq-morph.ts` (Listen `EqGlyph`
    imports it directly) and the spring helpers to `@crate/ui/lib/spring.ts`, which
    `use-eq-morph.ts` re-exports with a relative `export … from` so the policy counts them;
    Task 3.5 (Admin `GovernorGauges`) is the second, direct importer of `spring.ts`
- Create: `app/shared/ui/lib/motion-gate.ts`, test `motion-gate.test.ts`
  - `isMotionBlocked`, `subscribeToMotionAvailability`, `useMotionAllowed`
  - inputs: `prefers-reduced-motion`, `data-crate-motion`, `document.hidden`; guards for a missing
    `matchMedia` in jsdom
  - first app importer: Listen `motion-availability.ts` (below)
- Create: `app/shared/ui/lib/eq-curve.ts`, test `eq-curve.test.ts`
  - `gainToY`, `eqCurvePath`, `formatGain` (0.1 dB), band constants, extracted from `EqBands.tsx`
  - consumed through `EqBands`' re-export, which the policy follows
- Not in this task: `use-visible-loop.ts` has no consumer yet. Task 3.4 creates it Admin-local
  (`app/ui/src/lib/motion/use-visible-loop.ts`, first importer `QueueLanes`); it moves to
  `@crate/ui/lib/` in the first Listen task that imports it directly (DS §2.4).
- Modify: `app/shared/ui/test-setup.ts`: shared fakes for `ResizeObserver`, `matchMedia`,
  `IntersectionObserver` and `EventSource`, reusing Listen's polyfills
  (`app/listen/src/test-setup.ts:79,108`)
- Modify: `app/shared/ui/domain/player/EqBands.tsx`
  - geometry through SVG attributes and refs; handles positioned in the same frame as the curve;
    initial positions in `useLayoutEffect`; `transition-[top] duration-500` removed
  - each band a vertical `role="slider"` with `aria-valuetext` from props
  - keys: ↑/↓ 0.5 dB, PgUp/PgDn 3 dB, Home/End limits
  - `animate` prop; dragging bypasses the spring
  - drag and key repeat: curve and handles are drawn by ref; `onBandInput(band, gain)` fires at
    most once per animation frame, and `onBandChange` (the commit) fires once on pointerup, blur
    or 150 ms after the last key press. Batching to one write per frame would still be 60 writes a
    second: each `setCustomEqualizerGains` does 3 synchronous `localStorage` writes and dispatches
    `EQ_PREFS_EVENT` (`lib/equalizer-prefs.ts`), every snapshot subscriber re-renders, and on
    Android `useEqualizerRuntime` calls the Capacitor bridge (`androidNativeEngine.setEq`)
  - re-exports the `eq-curve` helpers so existing imports keep working
- Modify: `app/shared/ui/domain/player/EqBands.test.tsx`
- Modify: `app/listen/src/hooks/use-equalizer.ts` (`updateBand` splits into a live path and a
  commit): the live path writes gains to the engine through a ref (web: `setEqualizer` from
  `lib/gapless-player` with the existing ramp in `lib/equalizer.ts`; Android:
  `androidNativeEngine.setEq` throttled to 15–20 Hz) and never touches prefs; the commit calls
  `setCustomEqualizerGains` once. Test `use-equalizer.test.tsx` (new if missing)
- Modify: `app/listen/src/lib/motion-availability.ts` (wraps the shared DOM gate and keeps its API and preference store)
- Modify: `app/ui/src/components/genres/GenreEqEditor.tsx` (passes `animate={useMotionAllowed()}`)
- Delete (after `grep -rn "components/player/EqBands\|components/genres/EqBands" app/` shows no importer): `app/listen/src/components/player/EqBands.tsx`, `app/ui/src/components/genres/EqBands.tsx`

**Steps:**

1. Failing tests:
   - `stepSpring` at 120/14 settles within 65 frames at 60 Hz, overshoots at most 5% on a 12 dB
     step, and clamps `dt` to 50 ms.
   - `useEqMorph` (fake rAF): the first paint writes the target with no frames; the loop stops once
     settled; motion blocked writes the target at once; the dragged band is never sprung.
   - `EqBands`: handles and curve read the same `gainToY` per frame; sliders expose
     `aria-valuenow` and `aria-valuetext`; ArrowUp adds 0.5 dB; with `animate={false}` there is no
     rAF call; a 60-move drag fires `onBandChange` once; held ArrowUp commits 150 ms after the last
     key.
   - `use-equalizer`: a 60-move drag causes 1 `localStorage` write set and 1 `EQ_PREFS_EVENT`;
     on Android the native `setEq` call count stays within the 15–20 Hz throttle.
   - `motion-gate`: each input blocks motion.
   - `export-usage-policy.test.ts` stays green with no new allowlist entry.
2. Implement.
3. Verify:
   - `VT-UI lib/`, `VT-UI domain/player/eq-morph.test.ts`, `VT-UI domain/player/EqBands.test.tsx`
     and `VT-UI export-usage-policy.test.ts`
   - `VT-LISTEN src/components/player/EqualizerPanel.test.tsx src/hooks/use-equalizer.test.tsx`
   - `VT-ADMIN src/components/genres/GenreEqEditor.test.tsx`
   - `GATES`: `inlineStyles` 93 → 89 or lower; everything green
   - `TYPES`, `BUNDLE` (`PlayerBar` must not import `EqBands`)
4. Mark the rAF timing assertions that jsdom cannot cover with `TEST_GAP:`.
5. Commits:
   - `fix(eq): move curve, bars and handles together with shared springs`
   - `perf(eq): write EQ preferences once per drag instead of per frame`

### Task 0.8: Listen EQ panel residue and Admin editor flattening

**Files:**

- Create: `app/listen/src/lib/equalizer-labels.ts`
  - `PRESET_LABELS` moved out of `EqualizerPanelSections.tsx`
  - Smart EQ source labels moved out of `EqualizerSmartReadout.tsx:83-90`, now as i18n keys
- Modify: `app/listen/src/components/player/EqualizerPanelSections.tsx` (drop the duplicated `EqualizerModeBadge`)
- Modify: `app/listen/src/components/player/EqualizerSmartReadout.tsx` (keys `player.equalizer.presets.*`, `player.equalizer.sources.*`; "Inherited from" through the existing `player.equalizer.genre.from`)
- Modify: `app/listen/src/i18n/catalogs/*.json` (7) and `.metadata/*.json` (6)
- Modify: `app/ui/src/components/genres/GenreEqEditor.tsx` (no box-in-box; `white/*` and hex replaced by tokens)
- Test: `app/listen/src/components/player/EqualizerSmartReadout.test.tsx` (new), `EqualizerPanel.test.tsx`, `app/ui/src/components/genres/GenreEqEditor.test.tsx`

**Rule:** do not touch `app/listen/src/lib/equalizer.ts`. The site's `content/listen/viz.test.ts` parses
`EQ_PRESETS`, its `label:` entries and `EQ_GAIN_MAX = 12;`.

**Steps:**

1. Failing tests:
   - every source renders its translated label;
   - one mode indicator in the header;
   - `de` and `eu` labels fit (no overflow class).
2. Implement and run `I18N`.
3. Verify: the three Vitest files, `I18N`, `VISUAL` (no baseline for the EQ panel yet; added in
   0.11).
4. Commits:
   - `feat(listen): localise EQ preset and source labels`
   - `refactor(ui): flatten the genre EQ editor onto tokens`

### Task 0.9: Real ticket notches and setlist row entrance

**Files:**

- Modify: `app/listen/src/components/upcoming/UpcomingShowExpandedView.tsx`
  - notches as a CSS mask on two stacked boxes, with `-webkit-mask` for iOS 15
  - rows keyed by title
- Modify: `app/listen/src/index.css`, ticket recipe named `.setlist-ticket-*` (Listen-only until
  Task 4.7b moves it to the shared `recipes.css`, DS §6.7):
  - `:nth-child(1..20)` delays of 55 ms;
  - longhand `animation-*` properties, no `opacity: 0` base;
  - `animation: none` under `[data-crate-motion="reduced"]` and `prefers-reduced-motion`.
- Test: `app/listen/src/components/upcoming/UpcomingShowCardViews.test.tsx`

**Steps:**

1. Failing tests:
   - notch markup present;
   - no element with a canvas-coloured circle;
   - rows render in order with stable keys;
   - the reduced-motion class disables the animation.
2. Implement.
3. Verify: the Vitest file, `GATES`, `VISUAL` (the Radar baseline changes and is re-recorded in
   0.11).
4. Commit: `fix(listen): cut real ticket notches and stagger setlist rows`.

### Task 0.10: Contrast pairings and the amber hue

**Status:** local implementation recorded. The retired variant's contrast exception is not a v3
requirement and must not be fixed by adding variant tokens. Task 1.13 removes the obsolete fixture
and known-below-AA allowance with the retired runtime. Crate v3 contrast and QA still apply.

**Files:**

- Modify: `app/shared/ui/lib/color-contrast.test.ts`
  - `--text-subtle` on canvas, object and popover
  - `--accent-action-hi` on canvas and object
  - `--state-warning-text` on canvas and object
- If PD11 = (a): modify `app/shared/ui/lib/appearance-token-registry.ts` (warning `#fbbf24`), run `TOKENS-GEN`, update `appearance-token-registry.test.ts`

**Steps:**

1. Add the pairings and assert AA at body size for the Crate v3 identity. fg-3 is expected around 4.9:1 on the
   canvas and 4.7:1 on the popover.
2. If PD11 = (a), change the hue.
3. Verify: `VT-UI lib/color-contrast.test.ts lib/appearance-token-registry.test.ts`, `GATES`,
   `APPEARANCE`.
4. Commits:
   - `test(ui): cover label and accent contrast pairings`
   - `feat(ui): align the warning hue with the site amber` (only if PD11 = (a))

### Task 0.11: Visual fixtures, Admin captures and re-recorded baselines

**Status — Checkpoint 1E:** capture infrastructure, deterministic seven-page Admin fixtures and
both Smart EQ scenes are published. Successful Linux run `38807507930` at `c7e9e961` produced
31 reviewed PNGs (24 Listen / seven Admin), imported with the original provenance manifest.
The shared runtime guard blocks local baseline recording; advisory `CRATE_VISUAL_SMOKE=1`
renders write only to ignored test results. Imported-baseline revision `cf477986` passes full
Frontend Tests and visual comparison in run `38808354069`: appearance 26, Listen 34 / four
intentional skips, Admin 12. **Task 0.11 is complete.** Task 1.0 proceeds in a separate local
checkpoint; its own visual/route gates still precede 1.7.

**Files:**

- Modify: `tests/listen-visual/fixtures.ts`
  - the Radar show gets `probable_setlist`, `probable_setlist_context` and
    `probable_setlist_status`
  - add an EQ panel state: Smart mode with a chain
- Modify: `tests/listen-visual/listen-pages.spec.ts` (new capture: open the EQ popover on desktop and the EQ sheet on mobile)
- Create: `tests/admin-e2e/screenshots.ts` (helper: reduced motion, fixed clock, Linux only, the
  pinned container) and captures of Dashboard, Tasks, Health, Genres, Album, Settings and System
  from the existing `tests/admin-e2e` fixtures (every `/api/**` call is already served from
  fixtures). They are recorded before Task 1.0, because the foundation changes Admin pixels
  broadly (card borders in 1.0, toasts in 1.11, 17 `ConfirmDialog` importers in 1b.1, selects to
  chips in 1b.2, the status-colour codemod in 1b.6) and `ADMIN-E2E` alone is functional.
- Modify: `.github/workflows/test-frontend.yml`
  - the `appearance-chromium` and `admin-e2e` jobs run inside
    `container: mcr.microsoft.com/playwright:v1.63.0-noble` (today `appearance-chromium` runs on
    bare `ubuntu-latest` after `npx playwright install --with-deps chromium`);
  - new `update-listen-visual` job on `workflow_dispatch` (linux/amd64, same container): runs
    `npm run test:listen-visual -- --update-snapshots` and the Admin captures with
    `--update-snapshots`, and uploads both PNG sets as an artefact. It is the only source of
    committed PNGs: the host is arm64, CI is amd64, and Chromium text antialiasing can differ
    between them by more than `maxDiffPixels: 250` (`VISUAL`)
- Modify: `playwright.listen-visual.config.ts` (`snapshotPathTemplate` without `{platform}`) and
  the Admin e2e config (same template for the captures)
- Delete: the darwin PNGs under `tests/listen-visual/listen-pages.spec.ts-snapshots/` (CI never
  checks them; keeping them doubles every re-baseline)
- Modify: the Linux PNGs (22 existing plus the new EQ captures) and add the 7 Admin captures

**Steps:**

1. Add the fixtures. The fixture throws on unknown `/api/**` paths, so every endpoint the new
   screens call needs an entry.
2. Switch CI to the container and the configs to platform-free paths; delete the darwin PNGs.
3. Re-record through the `update-listen-visual` job and commit its artefact. A local `VISUAL` run
   (forced to amd64) is advisory only.
4. Review every PNG diff by eye. Token, font, notch and EQ changes are expected; anything else is a
   bug to fix first.
5. Verify: `VISUAL` and `ADMIN-E2E` (with the captures) pass in CI.
6. Commits:
   - `ci(listen): run visual tests in the pinned Playwright image`
   - `test(ui): capture Admin pages before the v3 restyle`
   - `test(listen): re-record visual baselines for the v3 tokens`

### Task 0.12: Bundle budgets in CI for both apps (PD48)

**Files:**

- Modify: `.github/workflows/test-frontend.yml`: after the "Build Listen" step, add
  `npm run --workspace=app/listen check:bundle`; after the "Build Admin" step, add
  `npm run --workspace=app/ui check:bundle`
- Create: `app/ui/scripts/check-bundle-budget.mjs` (port of `app/listen/scripts/check-bundle-budget.mjs`)
  and the `check:bundle` script in `app/ui/package.json`, with the accepted 520 KiB ceiling
  (recorded initial-JS baseline 514,659 B gzip; compare future results to the revision measured)
- Create: `app/ui/src/App.bundle.test.tsx` (pattern of Listen's `AppRouter.bundle.test.tsx`): every
  page route in `App.tsx` stays behind `lazy()`; each instrument route added later (Genres wheel,
  Tasks lanes, Health scan, Stack map, Federation topology, Analysis readout) adds its assertion in
  its own task

**Steps:**

1. Add the steps, the Admin script and the lazy-boundary test.
2. Verify that both CI steps pass and print their gzip numbers. Record both in the PR as the v3
   baselines. Admin gets its ceiling now rather than in Phase 7: every instrument (wheel, stack map,
   topology, orbit, HealthScan, lanes, Nivo small multiples) lands after this, and a regression
   found at the end would be measured against a baseline that already contains it. Each Phase 3
   and 5 PR records its `BUNDLE-ADMIN` delta and raises the ceiling deliberately.
3. Commit: `ci: enforce the initial JS budget in both apps`.

### Task 0.13: iOS deployment target (PD42 / [D11])

Keeping iOS 15.0 (`app/listen/ios/App/Podfile:1`, `platform :ios, '15.0'`) breaks three things:

- Tailwind 4.2.4's `color-mix` fallback cannot resolve `--color-accent-action:
var(--accent-action)` and falls back to `transparent`, so every `bg-accent-action/4`, `/8`,
  `/14` and `border-accent-action-hi/40` (hover, active row wash, halo, chip hover) disappears
  below Safari 16.2. The token CSS already has about 374 `color-mix` uses.
- The numeral tiers and readout word use `cqi`, and `InstrumentPanel` uses `@container`; iOS 15
  supports neither. `font-size: var(--text-numeral-xl)` becomes invalid at computed-value time and
  falls back to the body size.
- Subgrid rows need Safari 16 or Chrome 117 (also above the WebView2 111 Windows floor).

**Files (if [D11], the recommendation):**

- Modify: `app/listen/ios/App/Podfile` (`platform :ios, '16.4'`), `app/listen/ios/App/App.xcodeproj/project.pbxproj` (`IPHONEOS_DEPLOYMENT_TARGET = 16.4`)
- Release note: iOS 15 devices stay on the last v2 build.

**Fallback contract:** Task 1.4 guards rem numeral fallbacks with `@supports not (font-size: 1cqi)`
so LightningCSS retains them after minification; Task 4.6
uses no subgrid.

**If 15.0 is kept anyway:** add literal rgba tokens for the four alpha steps through the registry
(`TOKENS-GEN`), guard panels with `@supports (container-type: inline-size)`, and name the real
iOS 15 device used at Checkpoint 4, because CI cannot test it.

**Steps:** change the target, run `npx cap sync ios` and the iOS build workflow on the branch,
then commit `chore(ios): raise the deployment target to 16.4`.

### Task 0.14: Measure the production genre graph (read-only)

**Why:** the wheel's geometry and level-of-detail rules are tuned for 61 core nodes. MusicBrainz
sync creates an overlay node for every related genre it meets, and the production overlay, orphan
and unmapped counts are unknown (DS §4.3 asks for them before the LOD is final).

**Steps (read-only, with Diego's approval):**

1. On production, one query each: nodes by `origin`; orphans (no parent path to a family);
   unmapped raw tags; edges grouped by `source`, `locked` and `created_by IS NULL`.
2. Record the numbers in the draft PR. Task 3.7 sets the LOD thresholds, the "Unplaced" sector and
   the `+N` collapse from them; Task 2.18b uses the edge breakdown for the provenance fallback.

No commit.

### Task 0.15: A pinned WebKitGTK 2.40 runtime for the desktop gate

**Why:** Task 7.3 requires Tauri runs on Linux WebKitGTK 2.40 (the floor the bundle declares) and
Windows WebView2 111, but no such host exists:
`docs/testing/tauri-linux-desktop-results-2026-09-30.md` lists "WebKitGTK 2.40, X11, … other OSes:
Pending", only 2.50 and 2.52 were ever run, and CI checks symbols only.

**Files:**

- Create: `tests/desktop-webkitgtk/Dockerfile` (Debian 12 with `libwebkit2gtk-4.1-0=2.40.*` from
  `snapshot.debian.org`, plus Xvfb) and a script that runs the Tauri Linux build in it against the
  dev stack and takes the Linux desktop smoke captures
- Modify: `docs/testing/tauri-linux-desktop-results-2026-09-30.md` (or a new dated results file)

**Steps:**

1. Build the image and run the smoke once; record the result.
2. If 2.40 cannot be provisioned reliably, downgrade the gate instead: the existing symbol check
   plus a CSS feature audit (`color-mix`, `cqi`, `@container`, `linear()`, masks) against the
   WebKitGTK 2.40 and WebView2 111 support tables; record it in DS §3.11 and Task 7.3 in the
   same commit. Windows WebView2 111 follows the same rule (a fixed-version runtime on a Windows VM, or the
   audit).

Commit: `test(desktop): run the Linux smoke on WebKitGTK 2.40`.

### Checkpoint 0

Every CI job on the draft PR is green: typecheck, lint, Vitest for all three packages and the
desktop app, policies, drift, tokens, layers, i18n, builds, `check:bundle`, listen-visual,
appearance, admin-e2e and backend.

Diego reviews the EQ morph:

- on Listen web and Tauri (Web Audio EQ);
- on Android native (`setEq`; re-verified after the Smart Mix merge, which replaces this path with
  `NativeEqController`, PD2);
- on iOS, where the EQ is unavailable and nothing must change.

He also reviews the ticket on Radar on a phone.

---

## Phase 1 — Shared visual infrastructure in `@crate/ui`

### Checkpoint 1A — Authorised pre-merge primitive batch

Tasks 1.2 (`MonoLabel`), 1.3 (`StatusDot`) and 1.4 (`StatNumber`) are implemented and locally
validated. Diego reviewed and approved their mockup on 2026-10-15 and authorised the batch's
commit/push together with a persistent preview. CI baselines and device QA remain pending.

- Keep existing semantic tokens and generation; no theme runtime removal in this batch.
- Serialise changes to `typography.css`, `cn.ts`, token definitions, generated CSS and drift ceilings.
- The ongoing review surface is `tools/design-system-preview/`; run `npm run design-system:preview`.
  Extend it at each checkpoint using real components and preserve approved examples.
- Never claim Checkpoint 0 passed from a focused test or mockup review.

### Checkpoint 1B — Rows and chips, independent of Smart Mix

Checkpoint 1A was committed/pushed as `efe6cf2e`. **1.5 HairlineList / HairlineRow and 1.6 CratePill /
CrateChip** are implemented locally, with tests first and an updated persistent preview at
<http://127.0.0.1:5186/#filas-y-chips>. Stop for Diego's review with this local diff and actual
results in the handover. Diego approved this checkpoint on 2026-10-15 and authorised its commit/push.
Seven local browser checks cover
real typography, interaction, coarse targets and held-pointer reduced motion; CI captures and
native/runtime qualification remain separate gates.

Task 1.7's first Admin adoption waits for 1.0; Task 0.11's Admin captures still precede 1.0. Theme
runtime removal 1.13 remains later. The production measurement 0.14 can wait until the wheel.

### Checkpoint 1C — GenrePill with percentages, before the next infrastructure block

Diego approved 1B and authorised its commit/push; it is published as `c28a97e0`. Prioritise Task 1.6a
and show the retained percentage-bearing GenrePill at <http://127.0.0.1:5186/#genre-pill>.
Preserve its data, provenance and actions; the local visual proposal needs review before proceeding.
Diego approved the GenrePill visual treatment on 2026-10-15. This task uses the existing shared component and is independent of Smart Mix. Task 1.7 still waits
for Admin 1.0 and its capture prerequisites; this review does not close Phase 0.

### Checkpoint 1D — Global keyboard focus and text selection

After Diego approved GenrePill 1C, continue with Task 1.1 independently of Smart Mix. Inventory
legacy focus shadows, migrate to the shared flush search-style ring and preserve inset offsets. Extend the
same mockup at `#foco` with keyboard, field, CTA, row and selection examples. Test before changes
and record local/browser/appearance results separately from pending CI/device QA. Stop for Diego's
review. Diego explicitly authorised publication of 1C/1D on 2026-10-15; the focus remains provisional.
Continue Task 0.11 before Admin 1.0 → InstrumentPanel 1.7.

### Checkpoint 1E — capture preparation before Admin changes

Diego approved/published 1E and authorised canonical Linux captures. The existing mockup at
`#base-admin` now shows seven actual committed Linux Admin references. Preserve approved
primitives and provisional focus. Recording run `38807507930`, manifest/image review and comparison
run `38808354069` pass; Task 0.11 is complete before the separate 1F Admin change.

### Checkpoint 1F — Admin card contrast

Task 1.0 is published as `6e793ebd`, with reviewed canonical images in `82f14594`.
The 31 prior Linux PNGs are unchanged; two new scenes cover the legacy KPI grid and crop modal.
Full comparison/frontend CI passes in run `38860652793`. The local route walkthrough is complete,
with the pre-existing Artist alias defect and deeper-state limits recorded in the handover.
Review the retained local before/after examples at <http://127.0.0.1:5186/#contraste-admin>.

### Checkpoint 1G — InstrumentPanel

Task 1.7 is implemented locally with Listen Settings Section and Admin System Resources as first
adopters. Review <http://127.0.0.1:5186/#paneles>, including the corrected inherited Settings box
and spacing. Shared 744, Admin 252, Listen 2,854 and Desktop 50 unit tests pass; four existing
Listen skips remain. Preview 28, Admin browser 15 and Listen smoke 34 / four skips pass; spec and
quality reviews pass. Details and budgets are in the handover. Diego approved the corrected visual
checkpoint on 2026-10-16 and authorised publication, Linux capture/review and continuation to Meter
1.8. Canonical Linux capture/diff review passes in run `38864631250` (26 unchanged, seven expected
changes); comparison/full frontend CI passes in run `38865107324` on `c44b31f3`.

Only primitives and helpers that both apps import directly in the same change.

- `export-usage-policy.test.ts` only proves that one app imports a module, so the both-apps rule is
  enforced in review.
- Each task names its adopter in each app. If an app is not ready, the piece stays app-local
  (DS §2.1).
- New tokens land in the commit of their first consumer. The ceilings rise by exactly the number of
  tokens added, and `unreferencedTokens` stays 0.
- Tasks 1.4–1.8 all move Listen pixels. They go in one PR, one commit per task, with a single
  re-baseline at the end.

### Task 1.0: Keep Admin cards visible on the new canvas (PD6 / [D6])

**Current inventory / Checkpoint 1F:** the historical estimate below is superseded by the
`cf477986` inventory: 99 real background-token usages across 39 files, but only two borderless
card callsites remain: `AudioProfileCard.StatBox` (four KPIs) and the `ImageCropUpload` modal.
These hairlines are a temporary repair to legacy surfaces. Diego reaffirmed on 2026-10-16 that
Audio Profile's final design is the unboxed, icon-free site TrackReadout (Task 3.9b), not these KPIs.
The mockup shows his reference separately, labelled as the target rather than an implementation.
Existing Card/Badge/Select recipes already supply their borders; artwork placeholders, progress
tracks, hover states and calendar cells with grid separators are not card surfaces. Apply PD6(a)
only to those two callsites. The seven initial Admin baselines do not show either state, so add
focused real-Album scenes with deterministic analysis data and an open synthetic-image crop.
Their Linux baselines and the route walkthrough belong to this task's own visual QA.

**Local status:** both hairlines are implemented with browser regressions in
`tests/admin-e2e/card-contrast.spec.ts` and the persistent 1F before/after preview. Tests reproduced
0px borders before the fix; Admin 248 unit / 14 browser and preview 26 pass afterwards. Types,
lint, builds and the 532,480 B budget pass (515,384 B initial JS gzip). Spec/quality review passes.
Diego approved publication and continuation on 2026-10-16. Source `6e793ebd` and reviewed Linux
images `82f14594` are published. Capture run `38859757212` and full comparison CI `38860652793`
pass. The local walkthrough surveyed all 34 route patterns, including Logs and real entity detail;
the existing Artist-alias defect and untested deeper/permission states are recorded in the handover.
**Task 1.0's contrast, capture/comparison and route-walk requirements are complete.**

**Why:** `d9df9d51` changed `--crate-token-surface-card-solid` from `#16161e` to `#0d0e14`, about
1.07:1 against the `#0a0a0f` canvas (`crate-v3-analysis/v3-state.md:322`). Admin uses `bg-card`,
`bg-muted` and `bg-secondary` about 100 times, about 36 of them with no border. Only a few Admin
pages are restyled early, so every other page would ship cards that blend into the background.
This task runs before any Admin adoption (1.7 onwards).

**Files:**

- If PD6 = (a): Modify every borderless `bg-card`, `bg-muted` and `bg-secondary` in `app/ui/src`
  (inventory: `grep -rn -E "bg-(card|muted|secondary)\b" app/ui/src | grep -v "border"`), adding
  `border border-border-quiet` in one mechanical commit.
- If PD6 = (b): Modify `app/shared/ui/lib/appearance-token-registry.ts` (an Admin-only lifted card
  value), run `TOKENS-GEN`, and update `appearance-token-registry.test.ts`.
- Test: `ADMIN-E2E` with the Admin captures from Task 0.11 re-recorded (through the
  `update-listen-visual` job) and every diff reviewed; for (b) the registry test.

**Steps:** take the inventory and record it in the PR, apply the change, run `ADMIN-E2E`,
re-record and review the Admin captures, and walk every Admin route by hand.

Commit: `fix(ui): keep Admin cards visible on the v3 canvas`.

### Task 1.1: Global focus and selection rules

**Status:** implemented locally at Checkpoint 1D after Diego approved GenrePill 1C. The persistent
mockup is at <http://127.0.0.1:5186/#foco>. Diego accepted the current state provisionally to keep
moving; further focus-fade visual polishing is deferred, without final visual parity approval.
Actual checks and pending QA are recorded in the handover. Diego explicitly authorised this
checkpoint's commit/push on 2026-10-15; further visual polishing remains deferred.

**Files:**

- Modify: `app/shared/ui/tokens/interactive.css`:
  - `:focus-visible` 2 px `focus-ring` outline, offset 0 on controls and CTAs (−2 px inset on
    edge-to-edge rows), matching the existing Listen search ring as requested by Diego on 2026-10-15;
  - `::selection` `accent-action` background with `surface-canvas` text;
  - system `Highlight` outline in forced colours, retaining browser adjustments.
- Add: `app/shared/ui/lib/focus-ring-motion.ts` and behavioural tests. Reproduce the existing
  Listen search's 500 ms `cubic-bezier(0.22, 1.18, 0.36, 1)` on/off animation, without a delay:
  fade and expand an additive focus shadow, contract it on blur, and reverse from its rendered
  subpixel shadow. Do not animate outline width: its integer rounding breaks the smooth fade.
  Suppress the static outline only during motion and restore it on completion/cancellation.
  Install once in Listen, Admin, Desktop and both preview/appearance harness entries, with
  disposal for hot reload. Preserve existing hover/press transitions and shadows; skip/cancel
  motion for system/Crate reduced motion and forced colours. Keep static CSS as fallback, including SVG controls and missing additive animation support.
- Modify: every local focus shadow/ring call site, including `focus-within`. Inventory first with
  `rg 'focus(-visible|-within)?:(shadow|ring)' app/`. Also retire old recipe focus declarations
  and provisional 1B/1C outlines; preserve selection, status and validation rings. Keep inset
  exceptions explicit, including the clipped Listen TopBar search input and trigger.
- Remove the redundant `--focus-shadow` semantic alias while retaining the inline `--shadow-focus`
  bridge and `--focus-ring` runtime token. Bind the root ring alias directly to its stable
  foundation value so portals outside an appearance scope do not lose their colour when an
  unused Tailwind inline bridge is discarded. Lower definition ceilings by one; do not raise budgets.
- Modify the appearance harness and persistent preview so local CSS cannot mask the shared focus
  rules. Keyboard/pointer, text-selection, forced-colours and geometry checks use real styles.
- Test: appearance harness (`APPEARANCE`), real TopBar search in desktop/mobile and open/closed
  states, plus a policy assertion that no local focus shadow/ring remains in shared or app sources.
  Temporal browser tests sample initial/intermediate/final entry and settled-focus exit, compare
  the original native search transition, and exercise reversal, inset geometry and preference
  changes. Settled screenshots alone do not verify the requested on/off effect.

**Steps:**

1. Write the policy assertion (failing).
2. Implement.
3. Verify: `VT-UI design-token-policy.test.ts`, `APPEARANCE`, `GATES`, `VISUAL` (focus is not
   captured; expect no diff).
4. Commit: `feat(ui): use one accent outline for keyboard focus`.

### Task 1.2: `MonoLabel` ARIA pass-through and eyebrow size

**Files:**

- Modify: `app/shared/ui/primitives/MonoLabel.tsx`
  - `id`, `role` and `aria-*` pass through
  - `as`: `p|span|div|h2|h3|dt|figcaption|legend`
  - `size: "label" | "eyebrow"`
- Modify: `app/shared/ui/tokens/typography.css` (`--text-eyebrow` 0.71875rem / 1.4); `app/shared/ui/lib/cn.ts` (register the key)
- Test: `app/shared/ui/primitives/MonoLabel.test.tsx`, `app/shared/ui/lib/cn.test.ts`

**Steps:**

1. Failing tests:
   - props pass through;
   - falsy meta parts are dropped;
   - separators carry `aria-hidden`;
   - the eyebrow class is applied;
   - `twMerge` keeps `text-eyebrow`.
2. Implement.
3. Verify: `VT-UI primitives/MonoLabel.test.tsx lib/cn.test.ts`, `GATES` with existing ceilings.
   Typography utilities belong to `@theme`; do not raise the root semantic-definition budget.
4. Commit: `feat(ui): let MonoLabel carry ARIA props and an eyebrow size`.

### Task 1.3: `StatusDot` pulse and forced colors

**Files:**

- Modify: `app/shared/ui/primitives/StatusDot.tsx`
  - `pulse` gated by `motion-gate`
  - `title`-only dot becomes `role="img"`
  - forced colors: `CanvasText` border, `Highlight` fill for `on`
- Test: `app/shared/ui/primitives/StatusDot.test.tsx`

**Steps:** failing tests for the pulse class (absent under reduced motion), the `role="img"`
labelling, and that no new tone exists. Then implement and run `VT-UI primitives/StatusDot.test.tsx`
and `GATES`.

Commit: `feat(ui): add a motion-gated pulse to StatusDot`.

### Task 1.4: `StatNumber` tiers (PD8 / [D8])

**Files:**

- Modify: `app/shared/ui/primitives/StatNumber.tsx`
  - sizes `sm|md|lg|xl`, weight 800 on `lg`/`xl`
  - `unit` slot, `labelPosition`, `as: span|dd|div`, `align`
  - value node accepts a ref'd child; always `tabular-nums`
- Modify: `app/shared/ui/tokens/typography.css` (`--text-numeral-{xl,lg,md,sm}`, `--tracking-numeral`, `--tracking-numeral-sm`, `--leading-numeral`); `app/shared/ui/lib/cn.ts`
  - each numeral tier uses `@theme inline` for its clamp and `@utility text-numeral-*` for a
    guarded rem fallback inside `@supports not (font-size: 1cqi)`. Consecutive rem/clamp declarations
    are insufficient: LightningCSS removes the fallback during minification
- Test: `app/shared/ui/primitives/StatNumber.test.tsx`

**Steps:**

1. Failing tests:
   - each size class;
   - the unit renders inline on the baseline;
   - the label renders above and below;
   - `as="dd"`;
   - a ref'd child span keeps its node across re-renders;
   - Tailwind-compiled and LightningCSS-minified CSS retain each guarded rem fallback and clamp.
     The focused CSS regression suite covers all four numeral tiers; other display tiers remain
     their later tasks' responsibility.
2. Implement.
3. Verify: the test and `GATES` with unchanged ceilings; typography `@theme` declarations do not
   count as root semantic definitions. `VISUAL` and `BUNDLE` remain applicable follow-up gates;
   do not claim CI screenshots reviewed from the focused local pass.
4. Commit: `feat(ui): add display numeral tiers to StatNumber`.

### Task 1.5: `HairlineList` / `HairlineRow` v3 API

**Status:** implemented and approved by Diego at Checkpoint 1B on 2026-10-15; commit/push authorised. The setlist tests retain
row identity/order while expecting readable spaces between index, title and trailing metadata.

**Files:**

- Modify: `app/shared/ui/primitives/HairlineList.tsx`
  - `ruled` (default true)
  - `active`: 2 px `accent-action-hi` bar plus `from-accent-action/8` wash, scaleY in 250 ms
    `ease-snap`
  - `truncate` (default true)
  - `asChild`: the single child fills the row, `min-h` 32 px (44 px on coarse pointers)
  - pass-through props, hover `bg-accent-action/4`
- Test: `app/shared/ui/primitives/HairlineList.test.tsx`

**Steps:**

1. Failing tests: the active bar renders; an `asChild` link fills the row; `truncate={false}`;
   props pass through.
2. Implement. Listen call sites stay compatible (defaults unchanged).
3. Verify: the test, `VT-LISTEN` on the files that render `HairlineList` (`grep -rln HairlineList app/listen/src`), `VISUAL`.
4. Commit: `feat(ui): add active and link rows to HairlineList`.

Admin adopts it in Task 3.3, which fixes the "Listen only" rule breach.

### Task 1.6: `CratePill` variants and the Listen radius exemption (PD3 / [D2])

**Status:** implemented and approved by Diego at Checkpoint 1B on 2026-10-15; commit/push authorised. Existing static+active
Admin labels use CrateChip; Dashboard navigation uses action pills. Defaults infer toggle from a
callback and static otherwise; explicit static/action ignore `active`. Browser checks verify the
scale effect is off under OS and Crate reduced-motion preferences, even while pressed.

**Files:**

- Modify: `app/shared/ui/primitives/CrateBadge.tsx`
  - `CratePill`: `variant: toggle|action|static`; only `toggle` emits `aria-pressed`
  - `min-h-8` (44 px on coarse pointers), `tracking-chip`
  - press `scale(.95)` through longhand `ease-spring-snappy`
  - `data-slot="chip"`
  - `CrateChip` static tag recipe
- Modify: `app/shared/ui/tokens/typography.css` (`--tracking-chip`) and `lib/cn.ts` (tracking merge)
- Modify: `app/shared/ui/tokens/interactive.css` (scale-longhand feedback, spring feature fallback,
  reduced-motion cascade) and the compiled CSS regression tests
- Adapt the eight static+active Admin pill consumers to CrateChip, and the three Dashboard
  navigation pills to `variant="action"`; retain data/callback behavior
- Extend `tools/design-system-preview/` and its local browser smoke checks for Checkpoint 1B
- Modify: `app/listen/src/index.css` (radius pin selector `:is(button,a).rounded-full[class*="px-"]` gains `:not([data-slot="chip"])`)
- Modify: `app/listen/src/radius-policy.test.ts` (exemption asserted)
- Test: `app/shared/ui/primitives/CrateBadge.test.tsx`

**Steps:**

1. Failing tests:
   - `action` has no `aria-pressed`;
   - `toggle` reflects `active`;
   - `min-h-8` is present;
   - the radius policy passes with chips exempted.
2. Implement.
3. Verify: `VT-UI primitives/CrateBadge.test.tsx`, `VT-LISTEN src/radius-policy.test.ts src/badge-policy.test.ts`, `GATES`, `VISUAL` (chips change; review).
4. Commit: `feat(ui): give chips a 32 px target and an action variant`.

### Task 1.6a: Preserve GenrePill percentages and align its chip treatment

**Status:** visual treatment approved by Diego at Checkpoint 1C on 2026-10-15; implementation
committed as `e60e6f50` and publication authorised. He authorised continuing with global focus/selection (1.1) at Checkpoint 1D. This is an explicit completion of the existing DS §2.2 "chip look" entry, not replacement
of the genre component or migration of its data.

**Files:**

- Modify `app/shared/ui/domain/genres/GenrePill.tsx` and its test: rounded-full mono label,
  tracking-chip, tabular accent-hi percentage, 32px/44px targets and independent navigation/removal
  controls. Preserve the item API, source tooltip, row ordering/max and `onSelect` object identity.
- Preserve `resolveGenrePercent`: explicit percent first, otherwise rounded share × 100, no weight
  fallback, no percentage when missing, no renormalisation. Keep 0% and 100% visible.
- Modify only the genre recipe in `app/shared/ui/tokens/recipes.css`; CrateBadge keeps its own
  surface. Internal interactive controls also carry the Listen radius exemption slot.
- Extend `tools/design-system-preview/` at `#genre-pill` with real GenrePill/GenrePillRow instances,
  percentage and missing-data examples, selection/removal and long names. Preserve approved 1A/1B.
- Lower `scripts/design-system/drift-budget.json` when obsolete arbitrary percentage styling drops;
  do not add tokens or increase ceilings.

**Steps:** tests first; implement the visual treatment without changing profiles or callers;
run the shared suite, relevant app suites/policies, typechecks, lint, builds, gates, bundle budgets
and the local preview browser checks. Record actual results in the handover. Stop at Checkpoint 1C
for Diego to review the percentage-bearing component. Its commit/push was authorised on 2026-10-15.

### Task 1.7: `InstrumentPanel` with first adopters in both apps

**Local status / Checkpoint 1G:** implemented after 1F's Linux comparison and local route walk.
Props-only shared primitive and both real adopters are in place. Remove the obsolete
`.settings-section` fill/full-border recipe with its last caller; retain the real Settings controls,
descriptions and accessible section names. Tests reproduce the inherited CSS and assert transparent
sections with only a top rule at desktop/mobile widths. The primitive leaves block margins to its
parent; a real Admin browser regression verifies the 24px gap before Metric Streams. Actual checks
are in the handover.
Diego approved the corrected checkpoint on 2026-10-16 and authorised commit/push, canonical Linux
capture/review and continuation to 1.8. Published as `473604f7`; Linux capture/diff review passes
in run `38864631250`; comparison/full frontend CI passes in `38865107324` on `c44b31f3`.

**Files:**

- Create: `app/shared/ui/primitives/InstrumentPanel.tsx`, test `InstrumentPanel.test.tsx` (DS §2.3)
  - `<figure aria-label={summary}>`, `pt-5.5 border-t border-border-quiet`, `@container`
  - header made of two `MonoLabel`s and a status slot in `aria-live="polite"`
  - `as`, `headingLevel`
- Modify (Listen adopter): `app/listen/src/components/settings/SettingsPrimitives.tsx` (`Section` renders `InstrumentPanel as="section"`)
- Modify (Admin adopter): `app/ui/src/pages/SystemHealth.tsx` (the "Resources" `OpsPanel` becomes `InstrumentPanel`; no decorative panel/header icons per DS §1.7)
- Test:
  - `app/listen/src/pages/Settings.test.tsx`
  - `app/ui/src/pages/SystemHealth.test.tsx`: new page test, using `renderWithAdminProviders` from `app/ui/src/test/render-with-admin-providers.tsx`
  - `tests/admin-e2e/instrument-panel.spec.ts`: real Resources keeps the page's 24px gap before Metric Streams

**Steps:**

1. Failing tests:
   - the summary becomes the figure `aria-label`;
   - the status region is `aria-live="polite"`;
   - the `ruled` toggle works;
   - the heading level is respected;
   - Settings sections and the System Resources panel render inside a figure or section with the
     rule.
2. Implement.
3. Verify: the three tests, `GATES`, `TYPES`, `VISUAL` (single Crate v3 Settings captures;
   re-record through the approved CI job).
4. Commit: `feat(ui): add InstrumentPanel and adopt it in Settings and System`.

### Task 1.8: `Meter` with first adopters

**Published status / Checkpoint 1H:** primitive and both adopters implemented, with the
persistent specimen at <http://127.0.0.1:5186/#meters>. Valid samples use a bounded ARIA meter;
missing/invalid ranges use a described group (DS §2.3). Web storage uses profile bytes/quota;
native filesystems and unavailable estimates retain counts/bytes without a quota meter.
Real browser QA reproduced a collapsed track in Admin's five-column tile; both adopters now
use full-width meter rows, tested at desktop/mobile widths. All local gates and spec/quality reviews
pass (Shared 753 / Admin 257 / Listen 2,867 / Desktop 50 unit; Admin 17 / Listen 40 browser,
preview 31). Final results and unchanged budgets are in the handover.
Diego approved 1H on 2026-10-16 and authorised its publication/Linux captures and continuation
to Readout 1.9. Published `6a5b3366`; 35 Linux images/provenance `ef5e7f52` are reviewed.
Comparison/full frontend CI passes in run `38869556811`.

**Files:**

- Create: `app/shared/ui/primitives/Meter.tsx`, test `Meter.test.tsx` (DS §2.3)
  - `role="meter"`; `--v` written through a ref
  - limit tick; `over` changes the label text; `null` shows `n/a`
  - forced colors
- Modify (Listen): `app/listen/src/components/settings/OfflineSection.tsx` (`readyTrackCount / trackCount` and `totalBytes` against `navigator.storage.estimate()`)
- Modify (Admin): `app/ui/src/pages/SystemHealth.tsx` (transcoding usage)
- Test: `app/listen/src/components/settings/OfflineSection.test.tsx` (new), `app/ui/src/pages/SystemHealth.test.tsx`

**Steps:**

1. Failing tests:
   - the fill and tick positions;
   - the over label reads `over · max N`;
   - `null` shows `n/a`;
   - the ARIA values;
   - `storage.estimate` missing renders the count meter only.
2. Implement.
3. Verify: the tests, `GATES`, `BUNDLE`, `VISUAL` (settings).
4. Commit: `feat(ui): add Meter for offline storage and transcoding usage`.

### Task 1.9: `Readout` with first adopters

**Published status / Checkpoint 1I:** shared primitive and both real EQ adopters implemented; mockup
<http://127.0.0.1:5186/#readout> retains the earlier checkpoints. Visible previews leave the stable
sr-only status untouched until commit. Interrupted manual previews yield to committed external
mode changes. Shared 4 / Listen 9 / Admin 7 focused tests and preview 33 / Admin 18 / Listen 40 browser checks
pass; spec/quality reviews approve. All 3,937 frontend unit tests, types/lints/builds/gates and bundle
budgets pass; full results are recorded in the handover.
Diego approved 1I on 2026-10-16 and authorised commit/push, Linux CI captures and continuation to
ProgressHairline 1.10. Published `a80f396b`; Linux run `38871597394` passes with 36 reviewed PNGs
(33 identical, two EQ headers changed, one new GenreEqEditor scene), imported in `dd71eb72`.
Comparison/full frontend CI passes in run `38872274120`.

**Files:**

- Create: `app/shared/ui/primitives/Readout.tsx`, test `Readout.test.tsx`
  - visible mono line with reserved width
  - separate sr-only `announcement`, updated only on commit
- Modify (Listen): `app/listen/src/components/player/EqualizerPanelSections.tsx` (header trail line)
- Modify (Admin): `app/ui/src/components/genres/GenreEqEditor.tsx` (status line)
- Test: `EqualizerPanel.test.tsx`, `GenreEqEditor.test.tsx`
- Test: `tests/admin-e2e/readout.spec.ts` opens the real genre editor, checks local commit/reset
  announcements with no API writes, and adds a focused capture for the next Linux review.

**Steps:** failing tests check that a visible-only change does not change the announcement node and
that the reserved width is set. Then implement and run the tests, `GATES` and `VISUAL` (EQ panel).

Commit: `feat(ui): add Readout for live text that never reflows`.

### Task 1.10: `ProgressHairline` with first adopters

**Local status / Checkpoint 1J:** primitive and three planned callsites implemented, with the
persistent mockup at <http://127.0.0.1:5186/#progreso>. Known values use a ref-written scale; unknown
values keep the 36% block static unless onscreen and motion is allowed. Tasks retains its existing
stream/server percentage and explanatory text. ScanProgress is migrated and unit-tested but has
no active production consumer; do not invent a route for this task. Upload preserves chunk-count
callbacks and adds confirmed byte progress per file after successful chunks. Direct fetch uploads
remain indeterminate because that transport has no byte telemetry. Tests-first and focused checks
pass, along with all 3,962 unit tests and preview 35 / Admin 20 / Listen 42 browser checks.
Spec/quality reviews and all type/lint/build/bundle/tooling gates pass; results are in the handover.
Diego approved 1J on 2026-10-16 and authorised commit/push, Linux CI captures and continuation to
the shared toaster configuration (Task 1.11). Published `0660fbd2`; Linux run `38876594597` passes
with 40 reviewed PNGs (35 unchanged, Tasks changed, four new progress scenes), imported in `3f470ec6`.
Comparison/full frontend CI passes in run `38877216337`.

**Files:**

- Create: `app/shared/ui/primitives/ProgressHairline.tsx`, test `ProgressHairline.test.tsx`
  - determinate `role="progressbar"` with `--p` through a ref
  - indeterminate 36% block only while visible and motion is allowed; static otherwise
- Modify (Admin): `app/ui/src/pages/Tasks.tsx` (task progress), `app/ui/src/components/scanner/ScanProgress.tsx`; drop the `shadcn/progress` re-export from `app/ui/src/components/ui/index.ts` if it is now unused
- Modify (Listen): `app/listen/src/pages/Upload.tsx` (per-file byte progress)
- Test: `app/ui/src/components/scanner/ScanProgress.test.tsx` (new if missing), `app/listen/src/pages/Upload.test.tsx`
- Test: `app/ui/src/pages/Tasks.test.tsx` exercises real snapshot/SSE progress without a new stream;
  `tests/admin-e2e/progress-hairline.spec.ts` and `tests/listen-visual/upload-progress.spec.ts`
  add desktop/mobile layout and real-control checks, with four captures for the next Linux review.
- Modify: `scripts/design-system/drift-budget.json`: lower `directShadcnImports` if it drops; never raise it
  - Current inventory scans Listen/shared only: removing the two Admin imports and unused barrel
    does not change its measured 96. Leave that ceiling and inventory scope unchanged in 1J.

**Steps:**

1. Failing tests: the ARIA values; indeterminate is static under reduced motion; no rAF when hidden.
2. Implement.
3. Verify: the tests, `GATES`, `BUNDLE`.
4. Commit: `feat(ui): add ProgressHairline for task and upload progress`.

### Task 1.11: Shared toaster config (PD12 / [D10])

**Published status / Checkpoint 1K:** one typed config is mounted by Admin and Listen, retaining
their positions, Listen's theme/native-mode synchronization and its mobile bottom-chrome offset.
The base duration remains 4000ms; per-call overrides and `notify` stay intact. Shared object-card
recipes supply 380px maximum width, 12/16px padding, 14px messages, mono 11.5px muted descriptions
and ghost actions, without default icons or `richColors`. Mockup <http://127.0.0.1:5186/#toasts>
uses an actual scoped Sonner instance, manual fictional examples and local-only retry; indefinite
duration and embedded positioning are preview-only. All 3,971 units and preview 37 / Admin 21 /
Listen 42 browser checks pass, alongside types/lints/builds/budgets/tooling gates. Spec/quality
reviews approve; full evidence is in the handover. Diego approved 1K on 2026-10-16 and authorised
commit/push, Linux CI captures and continuation to cleanup Task 1.12. Keep its next review checkpoint.
Published `7b46021d`; Linux run `38880022435` passes with 43 reviewed PNGs (40 unchanged and three
new toast scenes), imported in `181ca4d4`. Comparison/full frontend CI passes in `38880774591`.

**Remaining DS §5.10 consumer checklist:** contextual MonoLabel type words, task-id/Open task links
and inline-first feedback are pending the screen migrations. Preserve caller semantics/i18n rather
than inserting generic global labels. Task 1.11 completes configuration only, not all of §5.10.

**Files:**

- Create: `app/shared/ui/lib/toaster-config.ts`, test `toaster-config.test.ts` (class names and durations; no `richColors`)
- Modify: `app/ui/src/App.tsx:466`, `app/listen/src/main.tsx:71` (mount `Toaster` with the config)
- Modify: `app/listen/src/toast-policy.test.ts` (or the Listen toast policy file) to forbid `richColors`
- Modify: `app/shared/ui/tokens/recipes.css` (shared styles, including a stronger muted-description
  selector than Sonner's late-injected dark rule, collapsed-stack hiding and visible keyboard focus)
- Test: `tests/admin-e2e/toaster.spec.ts` (real local genre save) and
  `tests/listen-visual/upload-progress.spec.ts` (real local Upload outcome); three focused toast
  captures join the next approved Linux run. The persistent preview adds desktop/390px checks.

**Steps:**

1. Failing tests: the config has no `richColors`; both apps import the config. The policy reads
   both entry files.
2. Implement.
3. Verify: `VT-UI lib/toaster-config.test.ts`, `VT-LISTEN src/toast-policy.test.ts`, `ADMIN-E2E`.
4. Commit: `feat(ui): share one toaster config and drop rich colours`.

### Task 1.12: Remove dead shared components

**Local status / Checkpoint 1L:** dependency review found no production consumers for the four
shared components. They and their two exclusive test files are removed, along with obsolete
export, token, GenrePill and local-copy exceptions. The app-local Ops/ShowCard implementations
and shared `show-types.ts`, its tests and explicit exports remain intact. Wildcard exports need
no manifest change. The measured drift ceilings drop from 54 to 53 arbitrary utilities and 89
to 88 inline styles. The persistent mockup at <http://127.0.0.1:5186/#limpieza> records the cleanup
using current primitives and retains every previous specimen; it does not recreate the deleted UI.
Spec/quality reviews pass after restoring the preview panels' visible/accessibly named headings.
Verification passes, including the corrected stale local-copy policy, four typechecks, both lints,
builds/budgets, design gates and preview 39 / Admin 21 / Listen 42 browser cases. Exact full-suite
and focused-rerun results are in the handover. Diego approved 1L on 2026-10-16 and authorised
commit/push, Linux captures and continuation to theme runtime retirement 1.13. Keep the next checkpoint.
Published `2c90a6f2`; recording `38883592145` passes with all 43 PNGs byte-identical to the reviewed
1K references. The original manifest is imported in `bf1fa793`; comparison/full CI passes
in `38885478542`.

**Files:**

- Delete: `app/shared/ui/domain/stats/{OpsPageHero,OpsPanel,OpsStatTile}.tsx`, `app/shared/ui/domain/shows/ShowCard.tsx` (verify no importer with `grep -rn` first)
- Delete: `app/shared/ui/domain/stats/semantic-shadows.test.tsx` and `domain/shows/ShowCard.test.tsx`
  (nine tests exclusively covering the retired components; retain `show-types.test.ts`).
- Modify:
  - `app/shared/ui/export-usage-policy.test.ts:33` (allowlist)
  - `app/listen/src/genre-pill-policy.test.ts:15-17` (the `shared/domain/shows/ShowCard.tsx`
    allowlist entries)
  - `app/listen/src/component-policy.test.ts` (the now-stale local ShowCard duplicate exception)
  - `app/shared/ui/design-token-policy.test.ts:28,33,34` (the `ShowCard.tsx` budgets and the
    `domain/stats/OpsPageHero.tsx` icon budget)
  - `app/shared/AGENTS.md` and `app/ui/AGENTS.md` (remove active guidance pointing to deleted copies)
  - `scripts/design-system/drift-budget.json` (lower the two measured ceilings; never raise them)
  - `tools/design-system-preview/{main.tsx,preview.spec.ts,README.md}` (cleanup inventory and
    accessible desktop/390px checkpoint). Existing layer-test fixture strings are not real imports.
  - `app/shared/ui/package.json` only if exports are explicit (none of the four are; keep unchanged)

**Steps:** delete the files, update the allowlists, then run `VT-UI`,
`VT-LISTEN src/genre-pill-policy.test.ts`, `GATES` and `TYPES`.

Commit: `chore(ui): remove unused shared ops and show components`.

### Task 1.13: Retire the theme runtime and migrate visual preferences (PD53)

**Status: published `21873d24`; reviewed Linux captures from `38888497469`. Comparison CI follows.** Diego assigned
this task on 2026-10-16 after approving 1L. The consumer/transport/persistence inventories find
no technical coupling to unmerged Smart Mix or the site; execute on the current v3 branch. This
explicit assignment supersedes the earlier integrated-baseline scheduling prerequisite for 1.13
only. Integration order, approved rebase and site pin remain unchanged. After integration, audit
and reconcile any new Smart Mix settings before the joint major. This deliberate behaviour
change fixes the same Crate v3 identity for Listen and Admin.

**Inventory before editing:**

- Shared: `app/shared/ui/lib/{appearance-types,appearance-resolver,appearance-token-registry,theme-skin}.ts`,
  `app/shared/ui/primitives/ThemeScope.tsx`, their tests and exports, CSS generation and
  `app/shared/ui/tokens/{themes,semantic,surfaces,radius,typography}.css`.
- Listen/Admin: startup/bootstrap, `app/listen/src/components/settings/ThemeSkinSection.tsx`,
  `app/listen/src/lib/{theme-color,motion-availability,content-density}.ts`, Settings, the seven
  catalogs and metadata, toaster/native status bars, user/local storage persistence, media-query
  and runtime subscribers. Follow all callers; include Smart Mix-added settings after rebase.
- Desktop: `app/listen-desktop/src/lib/linux-theme.ts`, `linux-theme.css`, startup, native window
  chrome and tests. Inventory Capacitor bootstrap, manifest/theme-colour and share rendering.
- Compatibility: `app/listen/src/lib/{playback-target-cast,cast-session-client}.ts`, cast appearance
  payload types and `app/crate/api/schemas/cast.py`; retain a safe fixed-value compatibility shape
  for older receivers/servers where required. Do not redesign Cast or change public schemas casually.
- Verification: shared appearance/contrast/runtime tests, `tests/appearance`, Listen visual and
  Admin captures, mobile/desktop tests, token generation/drift/bundle policies and technical docs.

**Steps:**

1. Record actual consumers, persisted preference keys, transport contracts and obsolete exports.
   Separate functional preferences (motion, effects safety, density, locale) from visual overrides.
2. Write migration tests for default, every legacy skin/mode/override, invalid/unknown payloads,
   returning users and old-server/receiver compatibility. All resolve to the fixed Crate v3 design;
   preserve reduced motion and functional preferences, including OS accessibility settings.
   Keep palettes derived from artwork/visualizer data as content, without chrome-theme opt-ins.
3. Replace the selectable theme runtime and Settings UI with fixed Crate v3 tokens. Remove skin,
   light/dark/system mode, accent, material, radius and typography overrides, their editors, previews,
   flags and runtime subscriptions. Retire GTK accent and album-driven chrome tint overrides.
4. Migrate/normalise stored visual preferences safely and idempotently; clear only inventoried
   obsolete keys. Keep motion/accessibility controls independent of the removed appearance store.
   Keep semantic design tokens, the Nivo chart configuration and token-based canvas/WebGL palettes.
5. Simplify the registry/generator to one Crate v3 output. Preserve existing registry paths and
   generation until their consumers are migrated in this task; rename files only if justified.
   Remove obsolete variant CSS, exports, the retired variant's known-below-AA exception, selectors,
   subscriptions and fixtures. Regenerate tokens and adjust exact drift ceilings deliberately.
6. Replace variant-matrix tests with one Crate v3 contract: text/accent/warning AA on actual surfaces,
   deterministic startup despite legacy preferences, motion/forced-colors/keyboard behaviour,
   stable canvas/WebGL on resize or context restoration, native chrome and older-peer transport.
7. Run focused tests, `TOKENS-GEN`, `GATES`, `TYPES`, `LINT`, `I18N`, both bundle gates and the
   single-identity visual/device QA when assigned. Baselines remain CI-only and require review.
   Record behaviour migration in the release note; no public release before the joint major.

**Local result:** fixed shared identity, independent functional preference migration, all consumer
bootstrap/platform/Cast migrations and the memory-only `#identidad` mockup are implemented.
Independent spec/quality reviews approve. Chromium 41, WebKit 41, preview 41 and Admin 21 browser
checks pass. Listen’s 43 passing checks plus the isolated mobile Smart EQ replay cover all
non-skipped cases; four existing skips remain. Full/focused unit invocation details, six types,
three lints, i18n, Rust, builds, budgets and remaining device/Linux QA are recorded precisely in
the handover. Raw input budget drops 10→8; direct shadcn imports 96→95. No ceiling increases.
Diego approved **Checkpoint 1M** and authorised commit/push, Linux recording and Task 1b.1
on 2026-10-16. Preserve the next review stop.

**Proposed commit after approval:** `refactor(ui): retire visual themes for the Crate v3 identity`.

### Checkpoint 1

Before this checkpoint:

- Every primitive has a direct importer in Admin and in Listen. The exceptions are `StatNumber` and
  `HairlineList` in Admin, which are adopted in Tasks 3.1 and 3.3. (`LegendStrip` is not a
  primitive; Task 0.4 drops it.)
- PD6 is applied (Task 1.0).
- CI is green and `BUNDLE` is within the Phase 0 baseline plus less than 3 KB; `BUNDLE-ADMIN`
  is within its ceiling.

Diego reviews Settings and System side by side with the site's panel anatomy. Foundation is an
internal milestone, completed with Tasks 1b.3/1b.4 and the single-identity runtime retirement 1.13.
It grants no public release and does not retire the integration branch.

---

## Phase 1b — The cross-screen layer

Phase 1 covers primitives, focus and the toaster. The components that render on every screen
(dialogs, forms, tabs, states, track rows, media grids, status colour) follow the recipes in
DS §5.5–5.11 and PD §3.1.5, and need an owner before any screen is restyled.

Only two of these tasks are needed by the instruments: 1b.3 (tabs, e.g. the Wheel/Tree/Grid toggle)
and 1b.4 (warming, empty and error states). They complete the internal Foundation milestone.
1b.1, 1b.2, 1b.5, 1b.6, 1b.7 and the Admin icon migration 1b.8 may run alongside later internal
groups when assigned and gate
only Phase 6. Product work continues into `feat/crate_v3`; it does not move to `main` after Foundation.

Each task below follows the same shape: inventory with `grep`, failing render and a11y tests,
implement, `VISUAL` re-baseline (one per task), `ADMIN-E2E` with the Admin captures re-recorded and
reviewed (Task 0.11), `TYPES`, `LINT`, `GATES`, one commit.

### Task 1b.1: Dialogs, sheets, popovers, menus and tooltips

**Files:**

- Modify: `app/shared/ui/shadcn/{dialog,alert-dialog,sheet,popover,dropdown-menu,context-menu,tooltip,overlay-close-button}.tsx`, `app/shared/ui/primitives/{AppModal,AppPopover}.tsx`, `app/shared/ui/composites/ConfirmDialog.tsx`
- Modify (Listen): `app/listen/src/components/actions/{ItemActionMenu,entity-menu}.tsx`
- Modify (Admin): the 15 actual consumers (20 instances; previous 17 included implementation/barrel) of `app/ui/src/components/ui/confirm-dialog.tsx` move to the shared `ConfirmDialog`; `app/ui/src/components/ui/{AppPopover,music-context-menu}.tsx`
- Delete: `app/ui/src/components/ui/confirm-dialog.tsx` and its test
- Test: the shared component tests (focus trap, Escape, `aria-modal`, destructive confirm uses the
  failed/destructive colour from PD10), `ItemActionMenu.test.tsx`, `ContextMenu.test.tsx`

Status: **Checkpoint 1N ready for visual review; focused checks and SPEC/QUALITY pass**, preview `#capas`; stop for Diego's review
before publication. Scope also includes shared actions `ContextMenu`/`MobileActionSheet` so
their former glass recipe cannot survive through Listen's adapter. Preserve gesture behavior.
All 20 Admin consequences use already available metadata; localized Listen consequence copy
lands with domain/page migrations. Typed WIPE/REBUILD, async/stacked focus and close geometry
are covered. Built-in close sits 16 px from top/right with title space reserved; sample labels
use existing FormField with 8 px gap. All four overlay routes reuse OverlayCloseButton (40 px /
24 px icon, transparent hover); legacy local glass/scrim overrides retire from AppModal callers.
Form restyling remains 1b.2. During development run focused cases only; full validation runs once
when development/the phase closes, per Diego's 2026-10-16 instruction.

Commit: `feat(ui): restyle dialogs and menus and share one ConfirmDialog`.

### Task 1b.2: Form controls

**Files:** `app/shared/ui/shadcn/{input,textarea,select}.tsx`, `app/shared/ui/primitives/{Switch,Checkbox,RadioGroup,SearchInput,FormField,SegmentedControl}.tsx`, `app/shared/ui/composites/AdminSelect.tsx`; selects with 7 options or fewer become chips (`CratePill` toggle) at their call sites (inventory first). Inputs and selects at 6 px radius (PD15).

Test: each primitive test (labels, `aria-invalid`, keyboard); a policy assertion that no new
`<select>` with 7 options or fewer appears.

Checkpoint split for review (2026-10-16): **1O** covers the nine used shared form
components and consolidates Admin's local AdminSelect through the existing shared composite.
Preserve all public props, keyboard, refs, debounce and clear behavior; RadioGroup has zero
consumers and stays unchanged. `rounded-lg` is the existing 6 px token. Keep the functional
iOS 16 px font exception. The preview extends `#formularios`; 1N remains unpublished and its
review source is saved in ignored `.artifacts/checkpoint-1n-source.patch`.

**1P** migrates the 28 fixed short selects (22 Admin, six effective Listen controls) and
reviews six SegmentedControl callers, distinguishing panels/tabs from filters/radios. Preserve
the 17 dynamic Admin option sources; fixed playlist field lists have 15 options and remain
selects. The policy against new short selects lands with that migration, using the inventory
rather than guessing cardinality from fixtures. Track the DS §5.6 Radio seed debounce here
explicitly; Admin navigation SearchBar styling remains with its shell migration. Task 1b.2
is not complete until these follow-up checks/migrations are addressed.

Status: **Task 1b.2 complete in the 1N–1P publication cut.** The nine foundations, shared
AdminSelect, 28 short-choice migrations, six caller reviews, AST policy and 300 ms Radio
debounce are implemented. Search preserves IME/caret behavior; typed confirmation reuses
FormField. Diego's latest correction standardizes every stacked label/control pair at 8 px
through `.crate-form-field`, including existing forms in both apps. Focused verification,
SPEC/QUALITY reviews and advisory captures are recorded in the handover. Diego authorised
finishing this cut through commit/push and handing continuation to Linux. Next is Task 1b.3,
checkpoint 1Q; do not run full suites during development iteration.

Commit: `feat(ui): restyle form controls in the v3 language`.

### Task 1b.3: Text tabs with the state in the URL

**Files:** `app/shared/ui/shadcn/tabs.tsx` (text tabs, 2 px `accent-action-hi` underline), a URL-param helper per app (`app/ui/src/hooks/use-tab-param.ts`, `app/listen/src/hooks/use-tab-param.ts`; app-local because routers differ). Pages adopt the helper in their Phase 3–6 tasks.

Test: tab ARIA, the helper round-trips `?tab=` and ignores unknown values.

Status: **Checkpoint 1Q approved and published as `e863c227` on 2026-10-16**, preview at
`http://127.0.0.1:5186/#pestanas`. The shared Radix wrapper retains its public props,
controlled/uncontrolled state, orientation and `default`/`line` variant names; both names
render the same text recipe. It uses Mono 11.5 px / .14em uppercase, a real 2 px
`accent-action-hi` underline, 44 px targets and one scrollable horizontal row.
Inventory found one production consumer, Admin Download; its five actual panels have a
keyboard regression test. Existing Library/ExtendedPlayer tab adapters remain for their phases.

Both app-local `useTabParam(values, defaultValue, { param?, replace? })` hooks return a
readonly `[tab, setTab]`. Missing/unknown values read as the default without rewriting the
URL. Invalid writes are ignored; valid changes push history by default, replacement is opt-in,
and repeated current writes do nothing. Other query values (including repeats), path, hash,
route state and scroll survive. The preview imports both actual hooks; `listenTab` is only
its second sample's isolated parameter, not a new production URL contract.

Focused tests/types/lint, preview geometry and the Admin bundle gate are recorded in the
handover. No page URL migration, new dependency, canonical image/manifest update or CI run.
Diego authorised 1Q publication and continuation to 1b.4, with the next review stop at 1R.
Full validation remains once at development/phase close.

Commit: `feat(ui): add text tabs that keep their state in the URL`.

### Task 1b.4: Loading, empty and error states

**Files:** `app/shared/ui/domain/states/*`, `app/shared/ui/domain/lists/EmptyState.tsx`, `app/shared/ui/primitives/ErrorState.tsx`, `app/shared/ui/composites/{CardSkeleton,GridSkeleton,TableSkeleton}.tsx`, `app/shared/ui/shadcn/skeleton.tsx`; Admin `components/ui/{card,grid,table}-skeleton.tsx` and `PageSpinner` call sites replaced by reserved geometry (PD50).

Test: `states.test.tsx` (each state names itself to assistive tech; skeletons reserve the final
geometry; no `animate-spin` outside buttons).

Status: **Checkpoint 1R implemented locally, awaiting Diego's review** at
`http://127.0.0.1:5186/#estados`. Shared static skeletons, inline empty states, compact/page
errors and delayed route loading are implemented. Two Admin PageSpinner definitions/four
callsites and both Listen shell fallbacks use the shared indicator. Three Admin skeleton
subpaths re-export the shared composites; the dead local ErrorState retires. Preserve public
aliases, callbacks, capability checks, URL redirects and translated caller copy.

Loading sections accept the caller's final layout. Library Albums/Artists now match actual
card padding/circle cap, media density and mobile sort-row height. Home/Radio rails and user
rows get matching placeholder shapes. Generic section placeholders remain compatibility
fallbacks for complex, unmigrated page layouts; their exact multi-section geometry and direct
CrateLoader users remain page-phase work. PD50 is applied to migrated foundation/route files,
not claimed globally. Do not restyle unrelated screens to satisfy a global spinner assertion.

The preview keeps the same readings in loading and ready, retains last sample data on
stale/error/retry/offline and names every state. Loading/empty omit a header status. The page
error identifier sits in its eyebrow, never beside the large title (Diego's review correction).
Final focused verification, bundle size and QA limits are recorded in the handover. Stop at
1R before commit/push or Task 1b.5. No full suites or canonical baseline/CI update in iteration.

Commit: `feat(ui): one set of loading, empty and error states`.

### Task 1b.5: Track rows and media grids

**1S local review — 2026-10-16:** 1R is approved/published as `093dcb1f`. The persistent
`#pistas` specimen uses the real row composition/control, shared media and table recipes.
Keep the existing active Listen halo, layers and advancing progress ring; Diego explicitly
requires their essence. His next review amendment retains the horizontal seek trail with
2 px default / 1 px thin strokes and a full keyboard/touch interaction area. The latest review
uses one common moving edge for beam and point (4 px idle / 6 px engaged), verified with natural
continuous/reversing drag frames; equal-timing independent animations were insufficient. Changes stay
inside existing PlayerSeekBar contracts; its local CSS is reused by production and preview.
Metadata uses existing row data only. Preserve native artwork, offline/remote behavior,
selection, menus and virtualization. Narrow container metadata must leave title/actions space.
See the final handover for focused checks, bundle sizes and outstanding QA. Stop at 1S before
commit/push or 1b.6; no canonical recording or full CI/suite during this iteration.

**Files:** `app/shared/ui/domain/tracks/TrackList.tsx`, `app/shared/ui/domain/lists/MediaGrid.tsx`, `app/shared/ui/domain/media/{MediaCover,PlayButton}.tsx`, Listen `components/cards/{TrackRow,TrackRowParts,AlbumCard,ArtistCard}.tsx`, Admin `components/album/TrackTable.tsx` (DS §5.5).

Test: `TrackList.test.tsx`, `lists.test.tsx`, `TrackRow.test.tsx`, `AlbumCard.test.tsx`,
`ArtistCard.test.tsx` (mono meta, current-track row, 44 px targets on coarse pointers).

Commit: `feat(ui): restyle track rows and media grids`.

### Task 1b.6: Admin status colour

**Linux checkpoint 1T, 2026-10-16 — local review.** Diego approved 1S and authorised
commit/push (`124b36a8`, verified at origin), then this task. Admin state colours now follow
meaning: accent for active/success, amber plus words for waiting/failure/review, neutral for
inactive/missing and descriptive metadata. Severity/risk/log levels use the Admin-local neutral
three-segment `SeverityMeter` plus a word. Destructive triggers are neutral; only shared
ConfirmDialog owns the destructive confirmation button. The source policy has no exceptions.
The persistent specimen at `#estado-admin` renders real OpsStatTile, SeverityMeter, IssueList
and ConfirmDialog with fictional data. Icons remain for 1b.8.

Diego's iteration instruction overrides the capture re-recording step below: do not regenerate
local canonical baselines or dispatch full CI here. Focused consumer checks and advisory preview
captures support this local review; canonical Linux CI record/import/comparison and native/AT
QA remain pending. Stop at 1T before commit/push or 1b.7. Final checks and limitations are in the
handover. The earlier 1S local-only note is superseded by its publication record.

**Files:**

- Modify: `app/ui/src/**`, a codemod following the PD §3.1.6 table and PD10 (a) / [D4] (about 398,
  288 and 48 classes):
  - emerald/green (ok, done, active, on) → `text-accent-action-hi` or `StatusDot on`;
  - red/rose (failed) → `state-warning` plus the word "failed" (or the existing status word);
  - amber/yellow/orange → `state-warning*`;
  - violet/fuchsia/blue/sky → `accent-*` or neutral;
  - `danger` only on the destructive action inside the shared `ConfirmDialog` (1b.1). No green or
    blue status anywhere. Mapping to `state-success*` or `state-danger*` would pass a palette-name
    policy while Admin kept green and red status everywhere.
- Create: `app/ui/src/status-colour-policy.test.ts` forbidding the `emerald`, `green`, `red`,
  `rose`, `violet`, `fuchsia`, `blue` and `sky` utilities and any `state-success*` or
  `state-danger*` class in `app/ui/src` (danger lives only in
  `@crate/ui/composites/ConfirmDialog`), with an allowlist that may only shrink

Test: the policy; `ADMIN-E2E` with the Admin captures re-recorded and reviewed.

Commit: `refactor(ui): move Admin status colours onto state tokens`.

### Task 1b.7: Skip link in both shells

**Linux checkpoint 1U, 2026-10-17 — local review.** Diego approved 1T and authorised publication
(`5308c391`, verified at origin) plus this task. Both shells now use shared `SkipLink` as their
first keyboard stop. Admin owns `admin-main-content`; Listen DesktopShell/MobileShell each own
`listen-main-content`, with `tabIndex={-1}`. Activation focuses the current main without replacing
search/hash state; native anchor fallback remains if no target exists. All seven Listen catalogs
include the translated label and source metadata. This is explicit skip navigation only; the
route-change heading focus/announcement work remains assigned to Tasks 3.2/4.1.

The persistent specimen at `#saltar-contenido` uses isolated demo documents with real shared
SkipLink/main, avoiding nested main landmarks and API-dependent app chrome. Actual Shell
integration is covered by the app tests. Keep existing specimens and :5186 active. Stop at 1U
before publication or Task 1b.8. No local canonical baseline generation or full CI/suite here.

**Files:** `app/ui/src/components/layout/Shell.tsx`, `app/listen/src/components/layout/Shell.tsx` (first focusable element; target `main` with `tabIndex={-1}`); copy in the 7 Listen catalogs.

Test: `Shell.test.tsx` in both apps (first Tab focuses the link; Enter moves focus to `main`).

Commit: `feat(a11y): add a skip link to both shells`.

### Task 1b.8: Remove almost all Admin icons (Diego, 2026-10-16)

**Scope:** the Admin app, including labelled navigation and actions. Default to text, display
figures, mono labels, rules and dots with state words; remove decorative and redundant icons.
Listen/desktop player and navigation icon policy is unchanged. This is an explicit V3 direction,
not authorisation to execute a blanket icon deletion before a reviewed inventory.

**Linux checkpoint 1V, 2026-10-17 — inventory review.** Diego approved/published 1U
(`afed5a3c`, verified at origin). The [1V inventory](2026-10-17-crate-v3-admin-icon-inventory.md)
indexes 142 production Admin files: 72 with runtime glyph imports, 543 bindings, 625 direct JSX
sites and passed/mapped/wrapped entry points. Categories overlap and conditional shared routes
are not counts of visible icons. The reproducible report and 25 individual review cases propose
zero permanent action-glyph exceptions; marks/QR/instruments/Listen presentation are explicit
content cases. No production icon removal, shared contract change or policy allowlist yet.
Review `#iconos-admin` in the persistent :5186 mockup; stop at 1V before publication or the first
migration group (proposed: Sidebar/CommandPalette/Shell). Full scoped results/limits are in the
final handover. This inventory checkpoint does not complete Task 1b.8.

**Linux checkpoint 1W, 2026-10-17 — first migration group, local review.** 1V is approved/published
as `cd5bf5e7`. Sidebar/CommandPalette/Shell now retire redundant destination, command/result and
profile/action glyphs, preserving names, capabilities, callbacks, counts and keyboard operation.
Diego clarified during implementation that conventional UX glyphs remain (back/forward,
collapse/expand, menu, close, search, etc.). Nine concrete current uses are bounded in
`admin-icon-policy.test.ts`; the original zero-exception 1V proposal is superseded for these uses.
The compact text rail is 144px, expanded 240px; drawer layout preserves full labels and its stored
rail preference. Focus returns from drawer/palette/help. The shared APIs, Listen and Desktop are
unchanged. SearchBar and the role AdminSelect are explicitly pending nested surfaces, not approval
for extra decorative glyphs. The live real-component specimen is `#navegacion-admin`; stop at 1W
before publication or the next group. Relevant scoped tests/build/budget pass; see final handover.

**Linux checkpoint 1X, 2026-10-17 — second bounded group, local review.** 1W is approved/published
as `52eaa6a5`. SearchBar and AIButton retire redundant result/recent/empty-state and action glyphs;
functional Search/clear/busy/Select glyphs remain bounded in the expanded source policy. Real
artwork, routes, 200ms debounce/cache/recents, LLM gating, callbacks and keyboard behavior stay.
Affected clear/AI/role-select/recent targets are 44px. Diego's follow-up fixes shared Select popper
viewport clipping without an API change; run shared and Listen selector checks too. Review the
real controls at `#controles-admin`; stop at 1X before publication or the operations/page groups.

**Linux checkpoint 1Y, 2026-10-17 — operational surface contracts, local review.** Diego approved
1X, committed/pushed as `b628a438` and verified at origin. Admin-local OpsPageHero, OpsPanel and
OpsStatTile retire their decorative icon contract and empty icon boxes. All 125 callsites across
ten pages and the three existing 1T specimens omit the retired prop; titles, values, captions,
tones, action/children slots, callbacks and page logic remain. Remove only unused Lucide imports;
page-specific action/row glyphs remain for later bounded groups. Labels/readings use the shared
8px `.crate-form-field` recipe. Source policy covers the three surfaces and all Admin consumers,
including aliases/spreads; UX glyphs supplied by action/content slots remain. Review real
components at `#superficies-admin`; stop at 1Y before publication or the next group. This does
not finish 1b.8 or the operations/page migrations. Scoped evidence and limits: final handover.

**Linux checkpoint 1Z, 2026-10-17 — Logs/Stack pages, local review.** Diego approved/published 1Y
as `ea6ebdc8` and authorised the next bounded group with UX glyphs retained. Logs and Stack remove
redundant refresh/restart/summary decoration. Service actions now have visible text and specific
accessible names; log disclosure uses a chevron, expanded state and a named region. Retain live
pause/resume, start/stop, search, loading and external-navigation UX. All 27 helper/action/hook
bodies are unchanged; no stream, API path, route, capability or action-eligibility edits. New/touched
action/search/select targets are 44px; service-state chips follow the shared 32px fine-pointer /
44px coarse-pointer contract. Read-only service fields use `.crate-form-field` at 8px.
The source policy covers both entire page files and bounds their retained sites/shared consumers.
Header count/status summaries consistently use static CrateChip tags, without mixed pill sizing.
Review real pages with fictional adapters at `#operaciones-admin`; stop at 1Z before publication
or another group. Other operations/settings/library pages and the rest of 1b.8 remain pending.

**Linux checkpoint 1AA, 2026-10-18 — Analysis page, local review.** Diego approved 1Z and
it is committed/pushed as `2efb4754` (local/origin SHA verified). The next bounded group covers
Analysis and its local pipeline, mini-metric and recent-track components. Retire action/header/
coverage/output decoration and local icon props; preserve the initial loader and eight action
spinners, with named loading/busy states. All eight queue paths/bodies, notifications, disable/
recovery behavior, 800ms snapshot refresh, normalization/metrics and shared provider remain intact.
Nine header summaries consistently use static CrateChip tags; local read-only readings adopt the
8px `.crate-form-field` recipe and actions have 44px targets. Source policy covers ten migrated
files, 34 concrete UX sites and bounded shared consumers. A sixth isolated preview entry mounts
actual Analysis with fictional snapshot/actions at `#analisis-admin`; earlier checkpoints remain.
Focused checks and both builds pass; Admin initial JS is 526053 / 532480 B gzip (6427 B margin).
Diego’s same-checkpoint follow-up removes the static Operator notes panel; Recent outputs now
uses the full available width, preserving both recent-track cards.
Diego's further follow-up adds the latest audio fingerprint to Recent outputs. The additive
`last_fingerprinted` projection (track metadata, actual computed timestamp, source; no raw hash)
is sampled off-request by the existing 120s worker step and declared in the API/optional Admin
type. Legacy/missing data stays empty. Three named result cards share a full-width panel, with
three columns at xl. This narrowly advances the data contract at Diego's request; the later
unified `recent`/TrackReadout work in 3.9a/3.9b remains pending.
Stop at 1AA for Diego before commit/push or another group. This does not finish 1b.8, the
operations family or later Analysis instruments. Canonical/native/full phase QA remains pending.

**Files:**

- Inventory `lucide-react` imports, icon props/maps and wrapped/shared icons in `app/ui/src/**`.
  Record every retained functional exception and why text or a simple marker is insufficient.
  Preserve conventional functional UX glyphs under Diego's 2026-10-17 clarification; record actual
  callsites, accessible names and touch targets. This does not retain redundant page/action icons.
- Modify `app/ui/src/components/layout/{Sidebar,CommandPalette,Shell}.tsx` and the page/component
  callsites identified by the inventory. Task 3.2 adopts text navigation and reconciles this work;
  each later page task starts with the same policy rather than reintroducing icons.
- For shared components that already expose an icon prop, Admin omits it. Do not remove icons
  globally from shared controls used by Listen; if a shared control needs an opt-out, change it
  with consumer tests and preserve the other app's behaviour.
- Create `app/ui/src/admin-icon-policy.test.ts`: a source-policy check over the inventoried icon
  entry points, with explicit per-callsite reviewed exceptions that may only shrink. Do not rely
  only on direct `lucide-react` imports; wrapped icons/props need coverage too.
- Update the affected route/component tests, `Sidebar.test.tsx`, `CommandPalette.test.tsx` and
  `Shell.test.tsx` for text labels, capabilities, keyboard operation, state and 44px touch targets.
  Remove unused icon imports; remove the package only if no justified import remains.

**Steps:** inventory first and show it at a checkpoint; write failing render/accessibility and
policy tests; migrate a reviewable group at a time; run `VT-ADMIN`, `TYPES`, `LINT`, `BUNDLE-ADMIN`
and `ADMIN-E2E`; record/review Linux captures of changed states. Keep the persistent mockup current
and stop for visual review/publication approval per group. No behaviour or permissions are removed.

Commit per reviewed group: `refactor(ui): replace redundant Admin icons with text`.

### Checkpoint 1b

After the last of the parallel 1b tasks, Diego walks Admin and Listen with the shared layer
restyled. Unrestyled screens then read as v3 at the level of tokens, dialogs, forms, states, rows
and status colour, with almost all Admin icons retired under 1b.8. Until then the baseline for an un-migrated screen is the foundation (tokens,
focus, toasts, tabs, states) plus whichever 1b tasks have shipped (Rollout → Partial migration during development). This checkpoint gates Phase 6, not the internal Foundation milestone.

---

## Phase 2 — Backend contracts and preconditions for the P0 visuals

Three groups:

- **2A**: independent `[MAIN]` hotfixes, started only when Diego assigns them. Small separately
  approved PRs/releases remain possible; the joint product major grants no automatic assignment.
- **2B**: platform preconditions, each reviewed and observed independently when assigned. 2.10
  keeps its isolated deployment; 2.11a–c keep separate operational observation.
- These fixes may proceed separately from the product branch when assigned. After Smart Mix
  merges, inspect the actual `main` code before applying the original recipes; overlap may have
  changed consumers or already fixed a finding. Production actions still require approval.
- **2C**: P0 instrument contracts for Operations, Health, Genres, EQ and Stats. Integrate them
  before their UI in the relevant internal milestone. Existing-client compatibility still applies;
  an empty consumer list allows technical isolation, not unapproved publication.
  The original `main` consumers below must be revalidated against the Smart Mix merge result:

  | Task            | Consumers on `main` today                                                                                                                       | Consequence                                                                              |
  | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
  | 2.14, 2.15a–c   | none (additive)                                                                                                                                 | can ship early                                                                           |
  | 2.20            | `night_hours` and `listener_count` are additive; shipped Listen builds read the instance `heatmap.cells` with `cells.flat()`                    | the PD43 hidden shape keeps a zero 7×24 grid, never `null`; `[BEHAVIOUR]` for the hiding |
  | 2.16            | v2 `SystemHealth.tsx` reads `/api/admin/metrics/system`                                                                                         | values change to the worker's real ones (PD §3.4.2 row)                                  |
  | 2.17a           | v2 `Health.tsx`, `ArtistRepairDialog.tsx`, `Dashboard.tsx` labels                                                                               | the task updates them in the same PR                                                     |
  | 2.17c           | v2 `Health.tsx:568` `handleFixType` posts no body; the `shadow_quality_tracks` fix-all and the bulk `artist_layout_fix` from #289 would get 409 | the task updates v2 `Health.tsx` in the same PR                                          |
  | 2.17b, 2.17d    | scheduled `health_check` and `library_pipeline` runs                                                                                            | 2.17d is `[BEHAVIOUR]` (PD24); ships with the Health group                               |
  | 2.17e           | v2 `Trash.tsx` reads `/api/manage/tracks/quarantine`                                                                                            | response shape kept; pagination params optional                                          |
  | 2.18c, 2.18c-go | v2 Genres tree counts; `/api/catalog/genres` and Explore fallbacks read by shipped Listen builds; Go `/api/genres` and genre-detail counts      | ship together with the Genres group; `[BEHAVIOUR]`; the migration is additive            |
  | 2.18d, 2.18e    | the seeder on every boot; v2 `GenreEqEditor` writes; MusicBrainz sync; `generate-eq` callers                                                    | ship with the Genres group; `[BEHAVIOUR]` each                                           |
  | 2.19            | shipped Listen builds read `/eq`                                                                                                                | additive fields only                                                                     |

Every endpoint task adds `app/tests/test_openapi_contract.py` assertions.

### 2A — Independent fixes on `main`

#### Task 2.1: Federation approve uses the pairing id (B14) `[MAIN]`

**Files:**

- Modify: `app/crate/db/repositories/federation.py:155`
  - `list_peers()` gains `pending_pairing_uid`
  - one `LEFT JOIN LATERAL` picking the latest inbound `remote_pending` pairing that has not
    expired
- Modify: `app/crate/api/admin_federation.py:317` (`approve_pairing` rejects an expired pairing with 400)
- Modify: `app/ui/src/pages/federation/PeersPanel.tsx:56`
  - approve posts `pairing_uid`
  - Approve shown only for inbound, unexpired pairings
  - Sync shown only with `federation.catalog.sync.manage`
- Modify: `app/ui/src/pages/Federation.tsx` (`canSyncCatalog`)
- Test: `app/tests/test_admin_federation.py`, `app/ui/src/pages/federation/PeersPanel.test.tsx` (existing; new cases)

**Steps:**

1. Failing pytest:
   - an expired pairing returns 400;
   - `list_peers` returns the uid only for an inbound pending pairing.
2. Failing Vitest:
   - the approve URL uses `pairing_uid`;
   - an outbound pending peer shows no Approve.
3. Implement.
4. Verify: `PY test_admin_federation.py`, `VT-ADMIN src/pages/federation/PeersPanel.test.tsx`.
5. Commit: `fix(federation): approve pairings by pairing id and expiry`.

#### Task 2.2: Owner checks on radio sessions and task streams (B15, B16) `[MAIN]` `[BEHAVIOUR]`

Two PRs. B15 is a one-helper fix and ships first, alone; B16 follows without touching any enqueue
call site.

**Why the B16 scope is wider than Listen:** Admin follows tasks through `lib/tasks.ts` and
`use-task-events.ts` (SSE plus polling) in TagEditor, AlbumHeader, TrackTable, the artist artwork
and metadata editors, ArtistRepairDialog, Genres, Health, NewReleases, Trash and Album. The
`librarian`, `editor` and `curator` roles have no `ops.*` capability (`api/permissions.py:57-113`),
so an "ops only" rule would take task progress away from them. `GET /api/tasks/{task_id}`
(`api/tasks.py:290`) only calls `_require_auth`, so the same data must be guarded there too.

**Why a choke point:** `app/crate/api` has 142 `create_task`/`create_task_dedup` calls in 31 files.
Threading the owner through each would hold a security hotfix behind a wide refactor.

**Files (PR 1, B15):**

- Modify: `app/crate/api/radio.py`. `/api/radio/next`, `/feedback` and `DELETE /session/{id}` load the
  session through one helper. That helper returns 404 when `session["user_id"]` does not match the
  caller.
- Test: `app/tests/test_radio_contracts.py`: another user gets 404 on next, feedback and delete

**Files (PR 2, B16):**

- Create: `app/crate/request_context.py` (outside `api/` and `db/`): a `contextvars.ContextVar`
  holding `{user_id, capability}` for the current request (precedent: `_trace_id_var` in
  `api/trace_middleware.py`)
- Modify: `app/crate/api/permissions.py` (`require_permission`, `require_any_permission`) and
  `app/crate/api/auth_dependencies.py` (`require_auth`, imported as `_require_auth` across the
  routers): set the contextvar with the user and the capability checked (none for
  `_require_auth`)
- Modify: `app/crate/db/repositories/tasks_creation.py` (`create_task`, `create_task_dedup` read the
  contextvar and store `owner_user_id` and `owner_capability` in params when it is set). No call
  site changes; tasks created outside a request (worker, scheduler, projector) have no owner
- Create: `app/crate/api/task_access.py` (`require_task_access(request, task)`): allowed for the
  owner, ops roles, or holders of the recorded `owner_capability` (for example
  `library.metadata.write`, `curation.genres.write`); 404 otherwise. Tasks without an owner (queued
  before the deploy, or by the system) stay readable for one release by ops roles and by any role
  holding a `library.*` or `curation.*` write capability.
- Modify: `app/crate/api/events.py` (`/api/events/task/{task_id}`) and `app/crate/api/tasks.py:290`
  (`GET /api/tasks/{task_id}`) call it
- Test:
  - `app/tests/test_request_context.py` (new): `require_permission` sets the capability;
    `_require_auth` sets only the user; the value does not leak between requests
  - `app/tests/test_task_access.py` (new): parametrised roles (`admin`, `ops`, `librarian`,
    `curator`, `editor`, `user`) × task types (a metadata write, a genre task, a Listen
    download, a legacy task without owner) for both endpoints; a task created inside a request
    carries the owner, one created by a worker has none
  - `app/tests/test_events_streams.py`: owner, other user, legacy task

**Steps:** failing tests first, then implement, then run
`PY test_radio_contracts.py test_request_context.py test_task_access.py test_events_streams.py`.

Commits (one per PR):

- `fix(security): check the radio session owner`
- `fix(security): restrict task streams to the owner and the queuing capability`

Release note: task streams and task detail are visible to the user who queued the task and to
holders of the capability that queued it; Listen-only users can no longer read other users'
tasks.

#### Task 2.3: Keep play-event payloads out of the ops snapshot (B19) `[MAIN]`

**Files:**

- Modify: `app/crate/db/domain_events.py` (`_decode_stream_messages`, `get_domain_event_runtime`)
  - drop `payload_json`
  - redact subjects of scope `user`, `home:discovery` and `home:user:*` before anything is persisted
- Test: `app/tests/test_domain_events.py`

**Steps:**

1. Failing tests:
   - `recent_events` items carry no `payload_json`;
   - a `user` subject reads `user`;
   - a `home:user:42` invalidation reads `home:user`.
2. Implement.
3. Verify: `PY test_domain_events.py`, `PY test_ops_snapshot.py`.
4. Commit: `fix(privacy): keep play event payloads out of the ops snapshot`.

#### Task 2.4: Remote stream events stop rebuilding ops (B11) `[MAIN]`

**Files:**

- Modify: `app/crate/projector.py:231-238` (`_projection_actions`)
  - only scope `federation.import` (and the `federation.import.*` types) maps to `ops`
  - remove `federation.stream.*` and `federation.catalog.*` from `_OPS_EVENT_TYPES`
- Test: `app/tests/test_projector.py`

**Steps:**

1. Failing table test:

   | Event                                                                                                           | Actions |
   | --------------------------------------------------------------------------------------------------------------- | ------- |
   | `federation.stream.*`, `federation.relay.*`, `federation.catalog.*`, `federation.peer.*`, `federation.health.*` | none    |
   | `federation.import.*`                                                                                           | `ops`   |

2. Implement.
3. Verify: `PY test_projector.py`.
4. Commit: `perf(projector): stop rebuilding ops on remote stream events`.

#### Task 2.5: Stats schemas keep `snapshot.pending` (B12) `[MAIN]`

**Files:**

- Modify: `app/crate/api/schemas/me.py:791` (`StatsDashboardResponse.snapshot: StatsSnapshotResponse | None` with `version`, `built_at`, `stale`, `pending`)
- Modify: `app/crate/api/schemas/common.py:32` (`SnapshotMetadataResponse.pending: bool = False`)
- Modify: `app/listen/src/pages/use-stats-page-controller.ts` (`hasStats` is true when `overview.play_count` is set or `snapshot.pending`)
- Test:
  - `app/tests/test_stats_api_contracts.py`: `snapshot.pending` survives on `/api/me/stats/dashboard` (FastAPI fallback), `/api/users/{u}/stats/dashboard` and `/api/stats/dashboard`
  - `app/listen/src/pages/stats-page-model.test.ts` (or a new controller test): a pending cold payload does not render the empty state

**Steps:** failing tests first, then implement, then run `PY test_stats_api_contracts.py test_openapi_contract.py` and `VT-LISTEN src/pages/stats-page-model.test.ts`.

Commit: `fix(stats): keep the pending flag so snapshot polling works`.

#### Task 2.6: One stats dashboard limits constant `[MAIN]`

**Why:** the instance prewarm uses `albums_limit=12`, the API default is 10, and Listen
`/stats/global` sends 14. So Crate Pulse never hits the prewarmed key.

**Files:**

- Create: `app/crate/stats_dashboard_limits.py` (`DEFAULT_STATS_DASHBOARD_LIMITS = {tracks: 12, artists: 10, albums: 14, genres: 10, replay: 36}`)
- Create: `app/tests/fixtures/stats_dashboard_limits.json` (the same values; the drift fixture)
- Modify:
  - `app/crate/db/instance_stats_dashboard_surface.py` (`_DEFAULT_LIMITS`)
  - `app/crate/db/user_stats_dashboard_surface.py`
  - `app/crate/api/analytics.py` (defaults)
  - `app/crate/worker_handlers/analysis.py` (the two `or 12` fallbacks)
- Test:
  - `app/tests/test_instance_stats_dashboard_surface.py`: the default request subject key equals one
    of `schedule_instance_stats_dashboard_refresh`'s keys; the constant equals the JSON fixture
  - `app/listen/src/pages/stats-page-model.test.ts`: `STATS_DASHBOARD_LIMITS` equals the same JSON
    fixture, read from `../../../tests/fixtures/stats_dashboard_limits.json`

**Steps:** failing drift tests first, then implement, then run `PY test_instance_stats_dashboard_surface.py` and `VT-LISTEN src/pages/stats-page-model.test.ts`.

Commit: `fix(stats): use one limits constant so prewarmed snapshots hit`.

#### Task 2.7: A failing health check keeps its issues (B13) `[MAIN]`

**Files:**

- Modify: `app/crate/health_check.py:244-256` (`_run_entries`)
  - a raising check skips `resolve_stale_issues` and keeps its previous `issue_count`
  - the error is logged, and kept for `last_error` after Task 2.17b
- Modify: `app/crate/worker_handlers/management.py:98,589` (`health_check` and `library_pipeline` publish the health signal at the end)
- Test: `app/tests/test_health_check.py`

**Steps:**

1. Failing tests:
   - a check that raises leaves its open issues open and its run count unchanged;
   - the signal is published after both handlers.
2. Implement.
3. Verify: `PY test_health_check.py test_health_issue_persistence.py`.
4. Commit: `fix(health): keep open issues when a check fails`.

#### Task 2.8: Curation clears the current explore cache key `[MAIN]`

**Files:**

- Modify: `app/crate/api/curation.py:123,139` (`listen:explore_page:v1:{user}` → `v2`)
- Test: the curation API test file (`grep -rln "api/curation" app/tests`), with a new case asserting the v2 key is deleted

Commit: `fix(curation): clear the current explore page cache key`.

#### Task 2.9: Acquisition snapshot and stream require acquisition rights (PD46) `[MAIN]` `[BEHAVIOUR]`

**Files:**

- Modify: `app/crate/api/acquisition.py:283-291,343` (`require_any_permission(request, ("library.import.manage", "library.tidal.manage"))`)
- Test: the acquisition API tests (`grep -rln "acquisition/snapshot" app/tests`). A Listen-only user gets 403; an acquisition role gets 200.

Commit: `fix(security): require acquisition rights for the acquisition stream`.

Release note: API clients reading Soulseek or Tidal queues need the capability.

#### Task 2.9b: One Camelot mapping for v3 and Smart Mix `[MAIN]` `[BEHAVIOUR]`

**Rebase gate:** re-evaluate after Smart Mix merges. The original recipe below describes the
pre-merge code; keep one mapping, avoid recreating an existing module, and update tests/callers
for the actual integrated behaviour. This `[MAIN]` work starts only on explicit assignment.

**Why:** Smart Mix already ships `sm:app/crate/smart_mix/camelot.py` with enharmonics and rewires
`bliss._key_compatibility` to it. A second copy in v3 would conflict on merge. One module on
`main` serves both branches. v3's own consumers (the 3.9b readout, the 4.9a Paths serializer) need
only the display mapping, but the module replaces `bliss.CAMELOT`, so this is a small `[MAIN]` PR
tagged `[BEHAVIOUR]` (PD §4.7, PD2): Essentia's flat keys (`Bb`, `Eb`, `Ab`, …) fall back to
neutral key compatibility today and score through the enharmonics afterwards, which changes Radio
and Paths key scoring.

**Files:**

- Create: `app/crate/camelot.py` (ported from `sm:app/crate/smart_mix/camelot.py`: pure;
  enharmonics Db→C#, Eb→D#, Gb→F#, Ab→G#, Bb→A#; `to_camelot`, `camelot_relationship`)
- Create: `app/tests/fixtures/camelot_cases.json` (read later by `@crate/ui/lib/camelot.ts` in 3.9b)
- Modify: `app/crate/bliss.py` (`_key_compatibility` imports `crate.camelot`; the `CAMELOT` table at `:31` is deleted)
- Test: `app/tests/test_camelot.py` (new, from the fixture), plus a `bliss` case: a flat key (`Bb`) scores as `A#` instead of neutral

The Smart Mix branch then imports `crate.camelot` and deletes its own module when it next merges
`main` (its own rewire of `bliss._key_compatibility` becomes a no-op).

Release note: key scoring in Radio and Paths now understands flat keys, so some suggestions change.

Commit: `feat(analysis): add one shared Camelot mapping with enharmonics`.

### 2B — Platform preconditions (no UI change)

#### Task 2.10: The projector consumes new domain events (B1) and coalesces ops rebuilds (V5) `[BEHAVIOUR]`

**Why the order of steps matters:** the consumer group has not read `>` since 2026-04-27. Once the
reader is fixed, `XREADGROUP '>'` delivers everything after the group's frozen last-delivered id:
the whole retained stream (`_MAX_LEN = 50000`, `db/domain_events.py:24`), about six months of
stale events. Replaying them has side effects, not only load:

- `library.acquisition.completed` → `_queue_post_acquisition_processing` →
  `queue_process_new_content_if_needed(artist, force=True)` (`projector.py`), so a forced
  `process_new_content` would run again for every old acquisition and write to the library;
- home discovery and `_HOME_EVENT_TYPES` events call `get_cached_home_discovery(fresh=True)` per
  user; `user.listening_aggregates.updated` triggers stats rebuilds; play events refresh
  recently-played;
- all of it on a 0.25 CPU projector (`docker-compose.yaml:680`) at 200 events per 5 s, roughly
  20 minutes, plus every new v3 projector action.

**Why `[BEHAVIOUR]`:** if B1 holds, no side-effecting projection has run since 2026-04-27, so this
task switches them back on in steady state, not just for the backlog. The main one is the forced
`process_new_content` per acquisition, which duplicates the watcher's non-forced call from the
scoped sync, forces enrichment and writes to the library; the others are per-user home rebuilds
and recently-played refreshes. They come back behind their own switch, deployed off.

**Files:**

- Modify: `app/crate/db/domain_events.py:243-255` (`list_domain_events`)
  - `any(msgs for _, msgs in entries)` decides whether the PEL was empty
  - the PEL and `>` are read in the same tick, or with `XAUTOCLAIM` on min-idle, so deferred
    events never block new ones
- Modify: `app/crate/projector.py`
  - backlog guard: an event whose stream id is older than the cut id recorded by the one-time
    SETID step (below) is XACKed without projecting. The guard never applies by age alone: an
    acquisition event deferred because the artist still has in-flight Soulseek downloads
    (`_queue_post_acquisition_processing` returns `False`, often for more than 10 minutes) and
    every event from a projector outage stay pending until processed
  - `CRATE_PROJECTOR_SIDE_EFFECTS_ENABLED` (default off at deploy): gates post-acquisition
    processing, per-user home rebuilds and recently-played refreshes; while off they are skipped
    exactly as they are today
  - the `ops` action is coalesced trailing-edge (Conventions, projector due set), at most one ops
    refresh per 60 s; the projector is the single owner of `ops/dashboard` (2.11b)
  - `CRATE_DOMAIN_EVENTS_CONSUMER_ENABLED` (default on): turns domain-event consumption off
    without an image rollback
- Create: `app/crate/projector_backlog.py`: a one-off guarded step that records the current
  last-delivered id as the cut, moves the consumer group to the stream tip
  (`XGROUP SETID crate:domain_events <group> $`), guarded by a Redis flag so it runs once, and
  enqueues one explicit warm task (ops plus the home surfaces of recently active users)
- Modify: `app/tests/test_domain_events.py` (the fake Redis returns `[(stream, [])]` for an empty PEL, as redis-py does)
- Test: `app/tests/test_domain_events.py`, `app/tests/test_projector.py`

**Steps:**

1. Failing tests:
   - with an empty PEL the reader issues a `>` read and returns the new messages;
   - a deferred message in the PEL does not hide new ones;
   - a backlog of ids older than the cut is acked; `queue_process_new_content_if_needed` is never
     called and no home rebuild runs;
   - an acquisition event deferred for 15 minutes (after the cut) is still processed once the
     downloads finish;
   - after a simulated 15-minute projector outage, acquisition events are processed, not dropped;
   - with `CRATE_PROJECTOR_SIDE_EFFECTS_ENABLED` off, no side-effecting action runs and the
     events are acked as today; on, each runs once;
   - the SETID step runs once (flag set), records the cut and enqueues one warm task;
   - the consumer switch off reads nothing;
   - a burst of ops actions inside 60 s rebuilds once, after the window, with the last state.
2. Implement.
3. Verify: `PY test_domain_events.py test_projector.py`.
4. Before the deploy, read-only with Diego's approval: size the backlog with
   `XINFO GROUPS crate:domain_events` and `XLEN crate:domain_events`, and record both, plus the
   current hourly rate of `process_new_content` runs and the queue depths.
5. Deploy 2.10 alone with side effects off. The SETID step runs at projector start; then
   `XINFO GROUPS` shows lag near zero and trending down. Watch projector CPU (0.25 CPU limit) for
   one day.
6. Turn `CRATE_PROJECTOR_SIDE_EFFECTS_ENABLED` on and watch for another day: queue depth per pool,
   `process_new_content` runs per hour (against step 4's rate), home rebuilds per hour and
   projector CPU. Turn it off again on any spike; no image rollback is needed.
7. Commit: `fix(projector): consume new domain events and coalesce ops rebuilds`.

Release note: the projector processes domain events again; post-acquisition processing, home
rebuilds and recently-played refreshes resume once the side-effects switch is turned on.

#### Tasks 2.11a–c: Quiet task types, stale-served ops surfaces and the tasks writer (B2)

Three PRs, each shipped and observed on its own (they touch the busiest Admin paths, and one
rollback should not revert all of them). Every later task type depends on 2.11a; the genre wheel
(2.18b) needs 2.11a and 2.11b, not 2.11c.

#### Task 2.11a: `notify` and `quiet` flags on task types

**Why:** every completed task sends Telegram today (`actors.py:821`, no type filter in
`telegram.py:114`) and publishes `task_done` on `crate:sse:global` (`db/events.py:80`), and every
create, start, update and complete registers the tasks-surface signal (`tasks_creation.py:42`,
`tasks_updates.py:19,85,112`). The frequent refresh tasks v3 adds must do none of that.

**Files:**

- Modify: `app/crate/task_registry.py` (`TaskTypeInfo.notify: bool = True`, `TaskTypeInfo.quiet: bool = False`)
- Modify: `app/crate/actors.py` (skip `notify_task_completed` when `notify` is false; skip the
  global publish when `quiet`)
- Modify: `app/crate/db/repositories/tasks_creation.py` and `tasks_updates.py` (skip
  `register_tasks_surface_signal` for quiet types)
- Modify: `app/crate/db/queries/tasks.py` (history hides quiet types unless `?include_internal=1`)
- Test: `app/tests/test_task_runtime_contract.py`:
  - a quiet task's full lifecycle emits zero tasks-surface signals, makes no `send_message` call
    and no `crate:sse:global` publish;
  - every `refresh_*`/`build_*` type is quiet and every `backfill_*` type has `notify=False`
    (the rule is asserted over the registry, so later types are covered).

**Steps:** failing tests first, then implement, then run `PY test_task_runtime_contract.py`.

Commit: `feat(tasks): add notify and quiet flags to task types`.

#### Task 2.11b: Serve stale ops surfaces and coalesce their refreshes `[BEHAVIOUR]`

**Files:**

- Create: `app/crate/coalesce.py` (Conventions → coalescing): `schedule_coalesced(key, task_type,
params, window_seconds)` and `dispatch_due()` over `crate:coalesce:due`; the due step runs in
  `app/crate/worker.py` `_run_service_loop` (crate-worker only), which also warms new surfaces
  once at start (deduplicated)
- Create: `app/crate/db/ui_snapshot_serving.py` (part of the `ui_snapshot_*` family)
  - `serve_snapshot_or_schedule(scope, subject, *, task_type, dedup_key, window_seconds, max_age_seconds)`
  - returns the row with `stale` set and schedules a coalesced refresh when it is stale or dirty;
    when the row is missing it schedules at once (`create_task_dedup`) and returns a
    `pending`/`warming` payload
  - never builds
- Ownership and max age: the projector is the single owner of `ops/dashboard` (2.10 coalesces it
  at 60 s on events). Event-driven surfaces are served with a long `max_age_seconds` (15-minute
  floor), so age alone triggers only a rare safety refresh; with today's 60 s, every Admin page
  load after a quiet minute would rerun the `library_tracks` aggregates. `refresh_admin_surface`
  skips `ops` while the projector's dirty or due key for it is set.
- Modify: the ops/dashboard, health, stack and logs surfaces (`app/crate/db/ops_snapshot*.py`, `app/crate/db/admin_*_surface.py`) and `app/crate/db/ui_snapshot_building.py:14` call sites in request paths
- Modify: `app/crate/api/admin_ops.py` (`fresh` becomes a debounced nudge and never builds)
- Create task type `refresh_admin_surface` (for every surface except tasks):
  - queue fast; dedup key `admin-surface:<surface>`
  - trailing-edge coalescing (Conventions, 5 s window): a mutation committed during a running
    refresh sets the dirty key again and the refresh re-runs once after it, so nothing is lost
    and no generation counter is needed
  - `quiet=True`; registered in the five places (Conventions)
- Modify: `app/ui/src/contexts/OpsSnapshotContext.tsx:364-376` (no `fresh=1` on focus, visibility or online)
- Test:
  - `app/tests/test_coalesce.py` (new): a burst of N triggers produces one build after the window
    that reflects the last trigger; with `redispatch_stale_pending_tasks` run inside the test, a
    900 s window is not dispatched at 360 s and exactly one build runs after the window; no
    `tasks` row exists before the key is due; a cold read schedules immediately; a
    `--no-service-loop` worker runs no due step.
  - `app/tests/test_ui_snapshot_serving.py` (new):
    - stale row served and the refresh scheduled once, after the last trigger;
    - cold returns `pending` and schedules at once;
    - the builder monkeypatched to raise is never called;
    - with no events, repeated GETs of `ops/dashboard` inside 15 minutes schedule nothing;
    - `refresh_admin_surface` skips `ops` while the projector key is set;
    - a mutation during a running refresh produces exactly one more refresh.
  - `app/tests/test_task_queue_routing.py`, `app/tests/test_task_runtime_contract.py`
  - `app/ui/src/contexts/OpsSnapshotContext.test.tsx` (new): focus and visibility trigger no
    `fresh=1` request

**Steps:** failing tests first, then implement, then run `PY test_coalesce.py test_ui_snapshot_serving.py test_task_queue_routing.py test_task_runtime_contract.py` and `VT-ADMIN src/contexts/OpsSnapshotContext.test.tsx`.

Commit: `perf(admin): serve stale ops surfaces and refresh them off the request path`.

Release note: Admin ops pages show the last built state and refresh in the background; `fresh=1`
no longer forces a rebuild.

#### Task 2.11c: Tasks surface writer and viewer keys

**Why the tasks surface is not a task:** the tasks stream (`api/tasks.py:95-115`) re-reads the
tasks surface with a 2 s max age on every `TASKS_SURFACE_STREAM_CHANNEL` signal, and every task
create, start, update and complete registers that signal. A refresh task's own lifecycle would wake
the stream, find the surface stale and schedule another refresh: one task per debounce window,
forever, while any Tasks or History tab is open.

**Files:**

- Create: `app/crate/admin_viewers.py` (Conventions → demand gating): key constants per surface;
  `async def amark_viewer(*surfaces)` (one pipelined `SET admin:live:viewers:<surface> 1 EX 60` on
  `api/redis_sse.get_async_redis()`); sync `mark_viewer(*surfaces)` and `has_viewers(surface)` for
  workers and plain `def` endpoints
- Create: `app/crate/admin_surface_writer.py`, a dedicated thread in crate-worker (service loop
  only): builds the tasks surface on its dirty flag with a 3 s minimum interval, only while
  `admin:live:viewers:tasks` exists (checked once per second), and upserts the row; the API serves
  it read-only. Task 2.15b adds the queue lanes to the same thread.
- Modify: `app/crate/api/tasks.py` (the tasks stream calls `await amark_viewer("tasks")` on connect
  and on each heartbeat and reads the row in `to_thread`; never builds)
- Test:
  - `app/tests/test_admin_surface_writer.py` (new): no rebuild without viewers; no rebuild faster
    than 3 s under a stream of `update_task` calls; when the viewer key appears the next build
    follows within about 1 s; a `--no-service-loop` worker starts no writer.
  - `app/tests/test_admin_viewers.py` (new): `amark_viewer` sets every key with `EX 60` in one
    pipeline; the tasks-stream generator never calls the sync client (patched to raise); endpoints
    and samplers import the same key constants.

**Steps:** failing tests first, then implement, then run `PY test_admin_surface_writer.py test_admin_viewers.py`.

Commit: `perf(admin): build the tasks surface in one worker thread`.

#### Task 2.12: SSE reads off the event loop; pubsub on several channels (B4)

**Files:**

- Modify:
  - `app/crate/api/admin_ops.py:44`, `app/crate/api/management.py:191`, `app/crate/api/events.py:92`: reads in `asyncio.to_thread`, debounced, never build
  - `app/crate/api/redis_sse.py`: `open_pubsub(*channels)`, `close_pubsub`
  - `app/crate/db/ops_snapshot_eventing.py`: surface catalog entries for the channels used by Phase 2C
- Test: `app/tests/test_redis_sse.py` (new: several channels subscribe and unsubscribe), `app/tests/test_events_streams.py` (a generator never calls the builders: monkeypatch them to raise)

**Steps:** failing tests first, then implement, then run `PY test_redis_sse.py test_events_streams.py`.

Commit: `perf(api): read SSE payloads off the event loop`.

#### Task 2.13: Play events by end time (V8) and one presence count

This performance index is assigned independently or integrated before Ops. After Smart Mix is on
`main` and v3 has rebased, take the actual migration head plus one; do not use the old 108/114
snapshot as current state. Re-evaluate any renumber helper against what the Smart Mix integration
already provided. A stamp/backup recipe applies only to databases proven to need it and requires
its own operational approval. `main` remains canonical for numbering.

**Files:**

- Conditional: reuse `scripts/db/renumber_migrations.py` if Smart Mix integration supplied it.
  Add or extend it only when inspection proves a remaining unmerged branch needs renumbering;
  otherwise omit this helper and its proposed commit. It must dry-run the revision/section-file/
  bootstrap/head-test mapping and test inline-DDL and section-file fixtures. Do not assume a
  database is at revision 114 or run a stamp from a historical example. Any repair recipe is
  specific to the inspected database/schema and separately approved after backup.
- Create: `app/crate/db/migrations/versions/NNN_user_play_events_ended_at.py` (`CREATE INDEX CONCURRENTLY idx_user_play_events_ended_at ON user_play_events (ended_at DESC)` inside `autocommit_block`)
- Create: `app/crate/db/schema_sections/activity_vNNN.py`
- Modify: `app/crate/db/queries/management.py`
  - new `count_recent_playback_activity(*, session=None)`: one statement with
    `COUNT(DISTINCT user_id) FILTER (5 min)` and `COUNT(*) FILTER (3 min)`
  - returns `None` on failure
- Modify (callers): `app/crate/resource_governor.py`, `app/crate/actors.py:393,409`, `app/crate/db/ops_snapshot_activity.py` (`build_runtime_payload`)
- Test:
  - `app/tests/test_recent_playback_activity.py` (new, `pg_db`): windows, and `None` when the
    query fails
  - `app/tests/test_crate_schema_definition.py` (head)
  - `app/tests/test_resource_governor.py`

**Steps:** failing tests first, then implement, then run the tests above. Before merge,
`alembic heads` on the merge result prints one head.

Commits:

- `chore(db): add a migration renumbering script for unmerged branches` (only if the conditional helper work remains necessary)
- `perf(db): index play events by end time for presence counts`

### 2C — Contracts for the P0 instruments

#### Task 2.14: One Admin live stream

**Files:**

- Create: `app/crate/api/admin_live.py`. Route `GET /api/admin/live-stream?surfaces=...`:

  - surface registry `{name: (capability, channel, kind, reader)}`;
  - at connect, filter to allowed surfaces; 403 only when none is allowed; 400 on an unknown name;
  - snapshot surfaces re-read the row by primary key with `asyncio.to_thread(get_ui_snapshot)` on
    each version publish and skip versions already sent;
  - runtime surfaces forward the published payload verbatim;
  - heartbeat every 30 s with server time;
  - on connect and on every heartbeat, `await amark_viewer(*allowed)` (Task 2.11c, one pipelined
    call on the async client; never the sync client inside the generator). A hidden Admin tab
    closes its stream after 30 s (Task 3.1), so it stops renewing the keys (Conventions → demand
    gating).

  Initial surfaces: `queues`, `governor`, `health` (which carries two event types, `health` and
  `health-scan`; `health-scan` is not a separate surface). Later tasks add `pipeline`, `redis` and
  `federation`.

- Modify: `app/crate/api/__init__.py` (`create_app()` registers the router with an existing ops tag)
- Modify: `app/crate/api/schemas/operations.py` (event payload models)
- Test:
  - `app/tests/test_admin_live_stream.py` (new):
    - permission filtering;
    - unknown surface returns 400;
    - a published version is forwarded once;
    - builders are never called;
    - heartbeat carries server time;
    - connect and heartbeat set the viewer keys with `EX 60` through the async client; the
      generator never calls the sync Redis client (patched to raise);
    - a closed stream stops renewing its keys (they expire after 60 s).
  - `app/tests/test_openapi_contract.py`

**Depends on:** Task 2.11c (`admin_viewers.py`).

**Steps:** failing tests first, then implement, then run `PY test_admin_live_stream.py test_openapi_contract.py`.

Commit: `feat(admin): add one live stream for the v3 instruments`.

#### Task 2.15a: Structured deferrals (V12) and worker heartbeats

**Files:**

- Modify: `app/crate/resource_governor.py`
  - add `deferral_progress(family, reason, until)` with the canonical JSON prefix
    `{"phase": "deferred"`
  - add `reason_family()`
  - do not reshape `DEFAULT_*` or `RESOURCE_GOVERNED_TASK_TYPES = frozenset(`: the site parses them
- Modify: `app/crate/actors.py:597-625,654`. Write the deferral only when family, reason or until
  changes: every `update_task` wakes `tasks-stream`.
- Modify: `app/crate/db/repositories/tasks_updates.py` (`start_task` clears the marker)
- Modify: `app/crate/worker.py` (`run_worker` starts a daemon thread in every worker, with or without the service loop: `HSET crate:workers <service:host> {service, queues, processes, started_at}` plus `ZADD crate:workers:seen`, every 30 s, entries pruned after 90 s; no `SCAN`)
- Test:
  - `app/tests/test_resource_governor.py`: progress shape and reason families
  - `app/tests/test_task_runtime_contract.py`: `start_task` clears the marker
  - `app/tests/test_worker_heartbeat.py` (new): fields, pruning

**Steps:** failing tests first, then implement, then run the three files.

Commit: `feat(worker): record structured deferrals and worker heartbeats`.

#### Task 2.15b: Queue lanes query, payload and writer

**Files:**

- Create: `app/crate/db/queries/task_queues.py`
  - `get_queue_lanes_activity(pending_per_queue=5, running_per_queue=10, recent_per_queue=5, *, session=None)`,
    one CTE: - counts per pool on active statuses; - pending top N as one `LATERAL` per pool (`WHERE status='pending' AND pool=:p ORDER BY
priority, created_at LIMIT :n`, plus a `pool IS NULL` branch read as `default`), so each
    branch uses the partial index `(pool, priority, created_at) WHERE status='pending'`. No
    `ROW_NUMBER() OVER (PARTITION BY …)`: it sorts every pending row on each run (thousands
    during an import or enrichment backlog) and cannot use that index; - running = `running | delegated | completing`; - recent terminal rows in the last 10 minutes and 5-minute throughput, bounded by
    `created_at > now() - interval '1 day'` (or a partial index; see step 4); - deferred counted with `progress LIKE '{"phase": "deferred"%'`, never a jsonb cast.
- Create: `app/crate/ops_queues.py` (outside `db/`)
  - `build_queues_surface_payload()` merges:
    - `TASK_POOL_CONFIG` counts;
    - the governed, window and db-heavy sets;
    - parsed progress (`percent` null when `total <= 0`);
    - consumers grouped by service;
    - heavy-lane daemon state from `ops_runtime_state('analysis_status')`.
  - The hash excludes `generated_at`.
- Modify: `app/crate/admin_surface_writer.py` (the dedicated crate-worker thread from Task 2.11c,
  never the serial service loop, where it would stall behind `ImportQueue.refresh_pending_state()`
  and the scheduler). `publish_tasks_surface_signal` fires on every `update_task` progress write,
  so with any active task the dirty flag is always set; the cadence therefore is:

  - while `admin:live:viewers:queues` exists: rebuild when `GETDEL crate:ops:queues:dirty` is set,
    at most once per 3 s;
  - otherwise: rebuild every 15 s, only for `worker_live`.

  Upsert `ui_snapshots('ops:queues','global')` when the hash changed, the row is missing, or 30 s
  have passed; the upsert and its 30 s keepalive run only while viewers exist. The writer checks
  the viewer key once per second, so a new viewer gets a fresh row within about 1 s (never sooner
  than 3 s after the previous rebuild), and the GET serves the stale row meanwhile. `worker_live` is derived from the same query (retiring the full-table scan) and is
  still written every 15 s, not at the rebuild cadence.

- Modify: `app/crate/db/admin_tasks_surface.py` (`publish_tasks_surface_signal` also sets the dirty key, EX 60)
- Optional: migration `NNN_tasks_terminal_partial_index.py`, only if `EXPLAIN` on production shows a
  scan
- Test: `app/tests/test_queue_lanes_surface.py` (new, `pg_db`):
  - top N per pool, not capped globally;
  - order is priority, then age;
  - the 10-minute window and 5-minute throughput;
  - a NULL pool reads `default`;
  - deferred parsed from both the legacy text and the JSON form;
  - the governed flag;
  - `task_types` per queue equals `TASK_POOL_CONFIG`;
  - delegated counts as running;
  - `percent` is null when total is 0;
  - `generated_at` is excluded from the hash;
  - a missing row forces a write;
  - the rebuild count under a stream of `update_task` calls, with and without the viewer key;
  - no rebuild faster than the 3 s minimum interval;
  - when the viewer key appears, the next rebuild follows within about 1 s;
  - `worker_live` is written every 15 s whatever the rebuild cadence;
  - a `--no-service-loop` worker starts no writer.

**Steps:**

1. Failing tests.
2. Implement.
3. Verify: `PY test_queue_lanes_surface.py test_admin_surface_writer.py test_task_runtime_contract.py`.
4. Run `EXPLAIN (ANALYZE, BUFFERS)` of the CTE on production data, read-only and with Diego's
   approval. Add the partial index only if the 1-day bound is not enough.
5. Commit: `feat(ops): build the queue lanes surface in the worker`.

#### Task 2.15c: Queue endpoint and task-catalog flags

**Files:**

- Modify: `app/crate/api/admin_ops.py` (`GET /api/admin/queues`, `ops.tasks.manage`, reads the row, `{warming: true, ...static counts}` when it is missing)
- Modify: `app/crate/api/schemas/operations.py` (`QueuesSurfaceResponse`, PD §4.8)
- Modify: `app/crate/api/tasks.py` (`api_task_catalog`) and `app/crate/api/schemas/tasks.py` (`TaskCatalogResponse`)
  - per type: `queue`, `priority`, `governed`, `maintenance_window`
    (`none|unscoped|unscoped_or_large_limit`), `db_heavy`, `listener_sensitive`, `quiet`
  - no type is "always" window-governed: `_requires_maintenance_window` returns
    `not _has_specific_scope(params)` for the 11 `MAINTENANCE_WINDOW_TASK_TYPES`, `library_sync`
    and `repair` (`unscoped`), and also `limit > CRATE_MAINTENANCE_WINDOW_FINGERPRINT_LIMIT` for
    `backfill_track_audio_fingerprints` (`unscoped_or_large_limit`). A scoped
    `write_portable_metadata` with `album_id` bypasses the window.
  - the catalog also reports `maintenance_window_enabled` (`CRATE_MAINTENANCE_WINDOW_ENABLED`;
    code default false, compose true)
- Modify: `app/crate/api/admin_live.py` (`queues` surface)
- Modify: `app/crate/db/queries/tasks.py` and `app/crate/api/tasks.py` (`list_tasks` gains a `pool` filter for `?queue=`)
- Test: `app/tests/test_tasks_api.py`

  - the endpoint never builds;
  - permission is enforced;
  - catalog flags equal `TASK_POOL_CONFIG` and the frozensets;
  - the window rule equals `_requires_maintenance_window` for all 14 types, each with a scoped and
    an unscoped params case, plus a large-limit case for the fingerprint backfill, with the window
    enabled (a drift test);
  - the pool filter works.

  Plus `app/tests/test_openapi_contract.py`.

**Steps:** failing tests first, then implement, then run `PY test_tasks_api.py test_openapi_contract.py`.

Commit: `feat(api): expose queue lanes and task catalog flags`.

#### Task 2.16: Governor sampler and surface (fixes B3)

**Files:**

- Modify: `app/crate/resource_governor.py`
  - pure `load_limits()` and `evaluate_snapshot()`; `evaluate_resources` uses them, wording
    unchanged
  - `record_decision` keeps the last deferral (read with `max_age_seconds=5`)
- Create: `app/crate/resource_governor_surface.py` (outside `db/`)
  - `build_governor_surface()`
  - `write_governor_surface()`: writes the sample to the Redis key `crate:runtime:governor` (TTL
    3 × cadence; the `crate:runtime:<surface>` naming of Conventions → demand gating) plus a
    publish on `crate:sse:admin:governor`; persists
    `set_ops_runtime_state('resource_governor')` (a Postgres JSONB upsert, `db/ops_runtime.py:41`)
    only when the verdict changes or at most once per 60 s
  - window tz from the worker's `TZ`
  - `GovernorSurface.governed.window_rule` (PD §4.8) is a 14-entry record holding only the two
    scoped values (`unscoped`, `unscoped_or_large_limit`); the task-catalog field of 2.15c keeps
    the three values, `none` included
- Modify: `app/crate/worker.py`
  - a `governor-sampler` daemon thread in crate-worker, started only with the service loop:
    every 5 s while `admin:live:viewers:governor` exists, every 60 s otherwise, checking the key
    once per second in between. A fixed 5 s cadence would be 17,280 upserts and 17,280
    `count_recent_playback_activity` queries a day purely for the UI (dispatch evaluates resources
    itself). `GET /api/admin/governor` marks no viewer, so the Dashboard can read it (Task 3.3)
  - `CRATE_GOVERNOR_SAMPLER_ENABLED` is an off-switch only (off in tests and smoke composes)
  - `get_task_activity_snapshot` gains a `deferred_count` FILTER persisted in `worker_live`
- Modify: `app/crate/api/admin_metrics.py`
  - `GET /api/admin/governor` (`ops.health.view` or `ops.tasks.manage`): reads the Redis key,
    falls back to the persisted row, `{status: "warming"}` when both are missing
  - `_build_metrics_system` takes `resource_pressure` from the persisted sample and the analysis
    block from `build_analysis_payload()` (B3)
- Modify: `app/crate/api/admin_live.py` (`governor` surface), `app/crate/db/ops_snapshot_eventing.py` (catalog)
- Test:
  - `app/tests/test_resource_governor.py`:
    - `evaluate_snapshot` and `evaluate_resources` give the same reasons;
    - the window rule matches `_requires_maintenance_window` for the 14 types (scoped and
      unscoped), and reports nothing when the window is disabled.
  - `app/tests/test_governor_surface.py` (new): gauges, swap gate, window, disabled state,
    null values, the kept deferral; no DB write while idle and the verdict unchanged; when the
    viewer key appears the next sample arrives within about 1 s; `window_rule` has 14 entries and
    no `none` value; a `--no-service-loop` worker starts no sampler.
  - `app/tests/test_admin_metrics.py` (new or existing):
    - `metrics/system` no longer calls `evaluate_resources` or `get_analysis_status`;
    - `GET /api/admin/governor` returns 200 with `build_snapshot` patched to raise, returns
      warming without a row, and sets no `admin:live:viewers:*` key.
  - `app/tests/test_openapi_contract.py`

**Steps:** failing tests first, then implement, then run the four files.

Commits:

- `feat(ops): sample the resource governor in the worker`
- `perf(admin): read governor and analysis state from runtime rows`

#### Task 2.17a: Health labels move into the repair catalog

**Files:**

- Modify: `app/crate/repair_catalog.py`
  - `label=` and `description=` keyword arguments appended after the positional strings of every
    `RepairCatalogEntry` (the site's positional parser keeps working); labels in Title Case
  - also in `repair_catalog_payload()`
- Modify: `app/crate/api/schemas/management.py` (`RepairCatalogEntryResponse`)
- Modify: `app/ui/src/pages/Health.tsx:147,167` (delete `CHECK_LABELS` and `CHECK_DESCRIPTIONS` and read the catalog), `app/ui/src/components/artist/ArtistRepairDialog.tsx:107`, `app/ui/src/pages/Dashboard.tsx` (`prettifyHealthType`)
- Test: `app/tests/test_repair.py` (17 entries, unique label and description each), `app/ui/src/pages/Health.test.tsx`, `ArtistRepairDialog.test.tsx` (new if missing)

**Steps:** failing tests first, then implement, then run `PY test_repair.py test_openapi_contract.py` and `VT-ADMIN src/pages/Health.test.tsx`.

Site coupling: `site:src/content/admin/viz.test.ts` parses `CHECK_LABELS` and
`CHECK_DESCRIPTIONS`. Note this in the PR (Phase 7.6).

Commit: `refactor(health): move check labels into the repair catalog`.

#### Task 2.17b: Per-check results and scan events

**Files:**

- Create: migration `NNN_health_check_results.py` and `app/crate/db/schema_sections/health_vNNN.py`
  - `health_check_runs.task_id`, `last_error`
  - `health_issues.resolution` (`repaired|disappeared|manual|dismissed`), `resolved_task_id`
- Modify: `app/crate/health_check.py`
  - time each check
  - publish `health-scan` events (`started|completed|failed`) on `crate:sse:admin:health:scan`,
    for full and selected scans only, never for per-artist rechecks; the emitter accepts `fixed`
    too, which repair runs send from Task 2.17d (PD §4.2 event union)
  - a `running` Redis key with a 90 s TTL, refreshed on each event and by a 30 s heartbeat thread
    that runs for the whole task (scan events fire only at the start and end of each check, so a
    filesystem check slower than 90 s, such as Unindexed Files over 1.2 TB, would let the key
    expire mid-check and HealthScan would lose its cursor); the thread stops and the key is
    deleted in the task's `finally`, on completion and on failure (PD §4.2 item 5)
- Modify: `app/crate/db/repositories/health_issues.py`
  - new `persist_health_check_results(...)`: upserts, `ANY(:ids)` stale resolution with
    `resolution='disappeared'`, and per-check run records with duration and error, all in one
    transaction
  - `record_health_check_runs` takes per-check values
- Modify: `app/crate/db/health.py` (`resolve_stale_issues` in a single `UPDATE ... WHERE id = ANY(:ids)`)
- Modify: `app/crate/actors.py` (dispatch hook: governor deferral or DB-heavy wait writes `queued` for `health_check`, `library_pipeline` and `repair`)
- Test:
  - `app/tests/test_health_check.py`: events started and completed per check, failed, per-check
    duration, no events for artist rechecks; a 120 s check keeps `running` present (heartbeat,
    with a fake clock); the key is gone after completion and after a failure
  - `app/tests/test_health_issue_persistence.py`: one transaction, `ANY(:ids)`, resolution set
  - `app/tests/test_crate_schema_definition.py`

**Steps:** failing tests first, then implement, then run the three files.

Commit: `feat(health): record per-check results and stream scan progress`.

#### Task 2.17c: Health checks surface and endpoints `[BEHAVIOUR]`

**Depends on:** Task 2.17e (trash index), which lands first in the Health group.

Drill-down contract (added to PD §4.2 item 9 by Task 0.4). Paginating by issue would split an
artist's issues across pages and break `groupIssuesByArtist` and the per-artist fix-all, so the
page unit is the artist:

```ts
// GET /api/admin/health-checks/{check_type}/issues?cursor=&limit= (library.repair.run).
// Keyset-paginated by artist (cursor = last artist key, limit = artists per page, default 25, max 100); one query on
// idx_health_issues_open_identity; no snapshot write. Refetched when the `health` live event
// changes that check's `open`; no stream of its own.
interface HealthCheckIssuesPage {
  check_type: string;
  total_issues: number;
  total_artists: number;
  artists: Array<{
    artist_id: number | null;
    artist: string | null;
    issue_count: number;
    issues: HealthIssue[];
  }>; // existing issue shape, ≤ 100 per artist
  next_cursor: string | null;
}
```

**Files:**

- Modify: `app/crate/db/queries/health_issues.py` (`get_health_check_summary_rows(*, session=None)`: one CTE grouping open issues on `idx_health_issues_open_identity`, the 17 run rows, the quarantined album count and the trash totals from `trash_track_files`)
- Modify: `app/crate/db/admin_health_surface.py` (orchestration only)
  - `build_health_checks_payload` (PD §4.2 fields, including `trash.albums_quarantined`)
  - `refresh_health_checks_snapshot`, which writes `ui_snapshots('ops:health','checks')`
  - `get_health_checks_surface`: serve stale and schedule; when cold, return `warming` with the
    catalog built from code; merge the `running` key at read time
- Modify: `app/crate/db/events.py`: new `publish_task_signal(task_id, event, data)`: publishes on
  `crate:sse:task:{id}` only; no `task_events` row, no `worker_logs`, no `crate:sse:global`
  (Conventions; reused by 3.10a and 3.12a)
- Modify: `app/crate/api/management.py`
  - `GET /api/admin/health-checks` (`library.repair.run`)
  - `POST /api/manage/health-check` uses `create_task_dedup(dedup_key="health-check:full")` and
    returns the existing task with `deduplicated: true`
  - `fix-type`: dedup per check; body `{confirm: bool}`; 409 without it on confirm checks
  - repair per-item events go through `publish_task_signal`
  - the drill-down is the paginated read above (a new query in `db/queries/health_issues.py`);
    `GET /api/admin/health-snapshot?check_type=` stays one release as a deprecated alias of it
    (logs a deprecation warning)
  - `/api/admin/health-stream` (`_health_stream`, opened by v2 `Health.tsx:404` per check type, a
    B4 site) stays one release as a deprecated alias that forwards the `health` surface signal and
    re-reads the paginated page; Task 3.6 removes its `EventSource`
- Modify: `app/crate/worker_handlers/management.py`: `health_check`, `repair` and
  `library_pipeline` call `refresh_health_checks_snapshot()` at start and at end (PD §4.2 item 6),
  so a scheduled scan publishes a new snapshot version; Task 2.7's signal alone would only make the
  live stream re-read an unchanged row
- Modify: `app/ui/src/pages/Health.tsx` (v2, on `main`): `handleFixType` (`:568`) sends
  `{confirm: true}` after the existing confirmation for the bulk `artist_layout_fix`, and the
  `shadow_quality_tracks` fix-all gains a `ConfirmDialog` before it sends `{confirm: true}`. Without
  this, the 409 breaks both actions in production as soon as this task reaches `main`.
- Modify: `app/crate/api/admin_live.py` (`health` surface, carrying `health` and `health-scan`
  events)
- Test:
  - `app/tests/test_admin_health_surface.py` (new):
    - payload and totals;
    - `unattended` follows the PD24 rule;
    - cold returns `warming`;
    - a stale read schedules without building;
    - the `running` merge;
    - trash totals come from the table, with `Path.rglob` patched to raise.
  - `app/tests/test_api.py`: fix-type 409 and confirm; the bulk `artist_layout_fix` case now posts
    `confirm`; health-check dedup; the deprecated `health-snapshot` alias returns the paginated
    shape; the issues page keeps every issue of an artist on one page, and the cursor walks all
    artists once
  - handler tests (`app/tests/test_repair.py` or `test_health_check.py`): a scheduled scan writes
    a new `ops:health/checks` version at start and at end; so do `repair` and `library_pipeline`
  - `app/tests/test_events.py` (or the existing events test): `publish_task_signal` never writes a
    row or publishes globally
  - `app/ui/src/pages/Health.test.tsx`: fix-type posts `{confirm: true}`; the
    `shadow_quality_tracks` fix-all asks first
  - `app/tests/test_openapi_contract.py`

**Steps:** failing tests first, then implement, then run the files above and
`VT-ADMIN src/pages/Health.test.tsx`.

Commit: `feat(api): serve the health checks surface from a snapshot`.

Release note: `fix-type` requires `{confirm: true}` for checks that need confirmation;
`/api/admin/health-snapshot` and `/api/admin/health-stream` are deprecated.

#### Task 2.17d: Pipeline phases and the unattended set (PD24) `[MAIN]` `[BEHAVIOUR]`

**Files:**

- Modify: `app/crate/worker_handlers/management.py`
  - `_handle_library_pipeline` runs health → repair → sync and closes the health part after
    repair
  - the repair report is built from persisted issues, so repairs set `resolution='repaired'`
  - per-check fixed counts (also in `_handle_repair`), each published as a `health-scan` `fixed`
    event (PD §4.2)
  - if PD24 = (a), gate on `requires_confirmation`
- Test: `app/tests/test_repair.py`
  - the pipeline set excludes confirm checks (`shadow_quality_tracks`);
  - fixed counts are recorded and one `fixed` event per check is published;
  - resolution is set.

**Steps:** failing tests first, then implement, then run `PY test_repair.py`.

Commits:

- `fix(health): stop unattended destructive repairs in the pipeline`
- `feat(health): record what each repair run fixed`

#### Task 2.17e: Trash index

**Why:** `GET /api/manage/tracks/quarantine` (`api/management.py:1253-1281`) runs
`root.rglob("*")` and then `read_tags()` and `read_audio_quality()` for every file under the
quarantine root on every request. The Health footer (P0) links to `/trash` with a count, and the
Trash `StatStrip` (Task 6.4) shows files and size, so both need an index the worker maintains.

**Files:**

- Create: migration `NNN_trash_track_files.py` and `app/crate/db/schema_sections/trash_vNNN.py`
  (`trash_track_files`: `quarantine_path` PK, `size`, `mtime`, `artist`, `album`, `title`,
  `format`, `quarantined_at`, `source_track_id`)
- Create: `app/crate/db/repositories/trash_index.py` (upsert, delete, paginated read, totals)
- Modify: the quarantine, restore and hard-delete handlers (`grep -rn "def _handle_.*quarantine" app/crate/worker_handlers`): write or delete the row in the same transaction as the move
- Create task type `reconcile_trash_index` (maintenance, deduplicated, `quiet=True`): walks the
  quarantine root in the worker, seeds the table and corrects drift; the health run calls it
- Modify: `app/crate/api/management.py` (the quarantine endpoint reads the table; same response
  shape as today, with optional `limit`/`offset`, so the v2 Trash page keeps working)
- Test:
  - `app/tests/test_trash_index.py` (new, `pg_db`): handlers keep the table in step; reconcile
    seeds and corrects drift
  - the endpoint with `Path.rglob` and `read_tags` patched to raise
  - `test_task_runtime_contract.py`, `test_crate_schema_definition.py`

**Steps:** failing tests first, then implement, then run the files above.

Commit: `perf(trash): read the trash from an index the worker maintains`.

#### Task 2.18a: The EQ inheritance path from every resolver

**Files:**

- Modify: `app/crate/genre_taxonomy.py:1043`
  - `resolve_genre_eq_preset` tracks predecessors and returns `path` and `template`
  - export `EQ_TEMPLATES`, built from the `_EQ_*` constants; keep the literals and the
    `eq_gains=_EQ_X` syntax
  - new `genre_preset_payload(slug)` helper
- Modify: `app/crate/equalizer.py:443`, `app/crate/api/browse_media.py:809`, `app/crate/api/catalog.py:1098` (the global uid branch now resolves the preset)
- Modify: track genre cache key `listen:track_genre:v1` → `v2` (`browse_media.py:878`)
- Modify: `app/readplane/internal/catalog/genre.go` (`genreTaxonomyContext`, `genrePresetSQL`)
  - one helper replaces `genrePresetSQL` and the inline preset subquery
  - tie-break parity (G2): today both queries pick the owner with `ORDER BY depth, slug`, the
    owner's slug, while Python's `resolve_genre_eq_preset` is a BFS over parents sorted at each
    level, so equal-depth ties resolve in path order. Owners `c` and `z` at depth 2 via parents `b`
    and `a` give `z` in Python and `c` in Go. The helper accumulates `path` in the recursive CTE as
    a `text[]` of slugs and orders by `depth, path` with each element `COLLATE "C"`: element-wise
    array comparison matches Python's `sorted()`, while a joined string would not (`a-b>…` sorts
    before `a>…` in C collation, but `"a" < "a-b"` in Python)
  - lower-cases names; emits `eq_preset_resolved.path` and `preset.path`
- Modify: `app/readplane/cmd/readplane-contract-smoke/main.go` (extend "p2 genre detail", "p2 track genre", "p2 track entity genre")
- Create: `app/tests/fixtures/genre_eq_path_cases.json`: small graphs with the expected `path`
  and owner per node: multi-parent, the `a`/`b`/`z`/`c` equal-depth case, a hyphenated-slug prefix
  case (`a` vs `a-b`), a cycle and an orphan. Task 2.18d adds override and cleared cases. One
  fixture is read by pytest, by a Go table test and by `genre-wheel-math.test.ts` (3.7, later in
  `@crate/ui` with 5.10), so the client blast radius and both servers cannot drift apart
- Test:
  - `app/tests/test_genre_taxonomy.py`:
    - paths powerviolence → hardcore-punk, funk → soul, crust-punk → punk, thrash-metal → metal;
    - direct preset gives `[self]`; unknown gives `None`;
    - every case of `genre_eq_path_cases.json` (multi-parent tie-break, `a`/`b`/`z`/`c`, prefix
      slugs); a cycle terminates.
  - `app/tests/test_equalizer.py`
  - catalog genre test: global uid returns a preset
  - Go table tests in `app/readplane/internal/catalog`, reading `genre_eq_path_cases.json`
  - Drift test `app/tests/test_eq_templates_drift.py` (new): every `_EQ_X` equals
    `EQ_PRESETS[x.lower()]` parsed from `app/listen/src/lib/equalizer.ts`. It is a subset check:
    Listen has extra presets.

**Steps:** failing tests first, then implement, then run `PY test_genre_taxonomy.py test_equalizer.py test_eq_templates_drift.py`, `GO` and `GO-SMOKE`.

Commit: `feat(genres): return the EQ inheritance path from every resolver`.

#### Task 2.18b: Genre wheel snapshot builder and triggers

**Files:**

- Create: `app/crate/db/jobs/genre_wheel.py`. `build_genre_wheel_payload(scope)`:
  - reads `genre_taxonomy:revision` first;
  - one CTE over `artist_genres`, `album_genres`, aliases and `library_albums.track_count`
    (never `library_tracks`);
  - membership per PD21: artist `weight >= 0.70`; album
    `GREATEST(album_weight, artist_weight * 0.70) >= 0.45`; union across aliases;
  - structure, path, template and flags from the runtime graph; roll-ups are set unions over
    runtime-graph descendants;
  - an explicit read of node origin, edge provenance and alias origin. Provenance fallback:
    `source='manual' AND created_by IS NULL AND NOT locked` maps to `other` (MusicBrainz sync
    stores `manual` until Task 2.18e; curator edges always set `created_by`, `api/genres.py:606,654`);
    unknown values map to `other`. Task 0.14's edge breakdown confirms the mapping;
  - `aliases: {alias, origin}[]` per node (PD §4.6.3 after Task 0.4), so the inspector and the
    `/` search can match aliases;
  - reach follows `_pick_track_primary_genre`, including the fallback to artist genres;
  - `primary_parent` is the sorted-first parent.
- Create: `app/crate/db/genre_wheel_surface.py`
  - `get_genre_wheel_surface()` serves stale through `serve_snapshot_or_schedule` (2.11b); a
    cold read schedules the build at once, not after the window
  - `schedule_genre_wheel_refresh()`: trailing-edge coalescing through `app/crate/coalesce.py`
    (Conventions due set, no `tasks` row before it is due) with a window of at least 120 s, key
    `genre-wheel:local`; on `None` from `create_task_dedup` the caller resolves the active task with
    `find_active_task_by_type_params`; dirty set during a build schedules again
  - writes `ui_snapshots('genre-wheel','local')` through `decorate_snapshot`
- Create task type `refresh_genre_wheel_snapshot` (`TaskPoolConfig("fast", 1, 300, 1)`):
  - handler in `app/crate/worker_handlers/analysis.py`
  - `GENRE_WHEEL_DEDUP_KEY` in `app/crate/task_dedup_keys.py`
  - `quiet=True`; registered in the five places
- Triggers: only events that change genre membership or structure. Membership is triggered at its
  choke point, not from a list of tasks, because `enrich_artist`/`enrich_artists` rewrite
  `artist_genres` from Last.fm tags (`enrichment.py`), as do the genre indexer, the
  enrichment refresh endpoint of Task 3.12a and `db/jobs/repair_artist_jobs.py`; a task list would
  leave "applies to N genres · M albums · K tracks" stale with no bound:
  - Modify: `app/crate/db/repositories/genres_assignments.py`: `set_artist_genres` and
    `set_album_genres` call `schedule_genre_wheel_refresh()` after commit, only when the stored
    genre set changed (the trailing window absorbs bulk enrichment and `index_genres`);
  - Modify: `app/crate/db/jobs/repair_artist_jobs.py`: the `artist_genres` rename path schedules
    the same way;
  - `app/crate/genre_taxonomy.py` (`invalidate_runtime_taxonomy_cache_after_commit`) for
    curator taxonomy mutations;
  - artist and album deletes;
  - a nightly floor (scheduler entry), like moods and insights;
  - batch jobs (MusicBrainz sync, cleanup, infer) suppress per-row invalidation and publish one
    revision and one schedule at the end. Today `sync_musicbrainz_genre_graph_batch`
    (`genre_descriptions.py:653`) calls `upsert_genre_taxonomy_node/edge` without a shared
    session, so each row commits and invalidates on its own.
  - No generic `library` trigger: every `library` invalidation reaches the projector
    (`_PROJECTOR_RELEVANT_INVALIDATION_SCOPES`) and fires on covers, tags, crates and enrich
    (`api/cache_events.py:470-500`).
- Modify, only if PD23 says so: `app/crate/api/cache_events.py` (`_should_append_invalidation_domain_event` gains the `genre:` prefix)
- Test:
  - `app/tests/test_genre_wheel_surface.py` (new, `pg_db`):
    - counts use the thresholds and are distinct across aliases;
    - roll-ups;
    - reach with the artist fallback;
    - `eq.path` order; `primary_parent`;
    - flags orphan, cycle, multi_parent and empty;
    - provenance fallback, including the `manual` + `created_by IS NULL` case;
    - aliases with origin;
    - revision read before data;
    - dirty set during a build schedules again;
    - 100 triggers inside the window produce 1 build that includes the last change;
    - a MusicBrainz sync batch publishes one revision and one schedule;
    - an `enrich_artist` run that changes an artist's tags schedules exactly one build after the
      window; one that writes an unchanged tag set schedules none;
    - a cold `get_genre_wheel_surface()` schedules at once.
  - `app/tests/test_projector.py`, `app/tests/test_task_runtime_contract.py`
  - `app/tests/test_listen_read_latency_contract.py`: the builder and endpoint never reference
    `library_tracks` or `get_or_build_ui_snapshot`

**Steps:** failing tests first, then implement, then run the four files.

Commit: `feat(genres): build the taxonomy wheel snapshot in a task`.

#### Task 2.18c: Wheel endpoint; remove request-time genre aggregates (B7) `[BEHAVIOUR]`

Ships with the Genres internal milestone (2.18a–e, 3.7), not early: the v2 Genres page and shipped
Listen builds read the endpoints it changes.

**Files:**

- Modify: `app/crate/api/genres.py`
  - `GET /api/admin/genres/wheel` (permission `library.view`, PD §4.6.3): plain `def`; returns `ready`/`stale` with
    the payload, or `warming` with a `task_id` that may be null
  - `/taxonomy/tree`:
    - counts from the snapshot (PD21 definition); while the snapshot is cold, counts are `null`
      and the v2 tree renders `—`;
    - nodes gain `eq_own_gains`, `eq_preset_path`, `eq_clear_effective` and `origin`;
    - the tree inspector bug is fixed in Task 3.7.
  - Sound Intelligence health reads the snapshot's `totals.eq` (direct, inherited, none) and
    `totals.eq_reach` (PD §4.6.3); there is no `eq_coverage` field
- Modify: `app/crate/api/schemas/genres.py` (`GenreWheelResponse`, tree node fields); `app/crate/api/schemas/__init__.py`
- Modify: `app/crate/api/catalog.py:221`, `app/crate/api/browse.py:54`
  - the fallbacks serve stale and enqueue; cold returns the existing empty shape and schedules the
    build at once (2.11b), so shipped Listen builds show an empty genre list only until the first
    build finishes, which the release note states
  - the ed25519 verification moves to the builder
- Modify: `app/ui/src/components/genres/GenreTaxonomyTree.tsx` (v2): `null` counts render `—`
- Modify: `app/crate/db/queries/sound_intelligence.py` (no `library_tracks` scan in a request)
- Test:
  - `app/tests/test_genres_api.py`: ready, stale, warming; tree fields; cold tree counts are `null`;
    a cold read schedules the build immediately; Sound Intelligence health reads `totals.eq`
  - `app/tests/test_openapi_contract.py`
  - `GenreTaxonomyTree.test.tsx`: `null` counts render `—`
  - every test asserting the old counts, updated for the new definition (PD21) with a note in the
    PR

**Steps:** failing tests first, then implement, then run `PY test_genres_api.py test_openapi_contract.py test_listen_read_latency_contract.py`.

Commit: `feat(api): serve the genre wheel and stop counting genres per request`.

Release note: genre counts follow the new membership thresholds (lower than before), and genre
lists can be empty right after the first deploy, for as long as the first snapshot build takes
(it is scheduled on the first read and at worker start).

#### Task 2.18c-go: `genre_counts` table and the Go read plane (B7) `[BEHAVIOUR]`

**Depends on:** 2.18b (builder) and 2.18c (it ships in the same release as 2.18c: the Go routes
and the FastAPI fallbacks must show one count definition, PD21).

**Why:** 2.18c only changes FastAPI. `GET /api/genres` and the genre-detail related counts are
served by the Go read plane, which keeps running a per-request `GROUP BY` and (for the list) no
thresholds, so Listen and Admin would show different numbers and the request-time aggregate would
remain. PD §4.6.3 item 6 makes the builder write the counts and the Go routes read them.

**Files:**

- Create: migration `NNN_genre_counts.py` and `app/crate/db/schema_sections/library_vNNN.py`:
  `genre_counts` (`genre_id` PK, `artists`, `albums`, `tracks`, `computed_at`), additive,
  `CREATE TABLE IF NOT EXISTS`; updates `test_crate_schema_definition.py`
- Modify: `app/crate/db/jobs/genre_wheel.py` (2.18b): the builder upserts `genre_counts` (PD21
  thresholds, union across aliases; the same per-genre figures the snapshot carries)
  in the same transaction that writes `ui_snapshots('genre-wheel', ...)`, and deletes rows for
  genres that no longer exist; nothing writes it from a request
- Modify: `app/readplane/internal/catalog/store.go` (`genresSQL`): reads `genre_counts` joined to
  the genre rows instead of the `GROUP BY` over `artist_genres`/`album_genres`, the aliases `OR`
  join and the per-row `LATERAL`
- Modify: `app/readplane/internal/catalog/genre.go` (`relatedGenresSQL`): related counts come from
  `genre_counts`; no per-request aggregate
  - empty `genre_counts` (cold, before the first build): the route returns its existing empty
    shape and the FastAPI fallback of 2.18c schedules the build; shipped Listen builds see an
    empty list only until the first build finishes (same release note as 2.18c)
- Modify: `app/readplane/internal/catalog/query_latency_test.go` (the `genresSQL` and
  `relatedGenresSQL` cases point at the new queries)
- Test:
  - `app/tests/test_genre_wheel_surface.py`: `genre_counts` equals the snapshot's counts for the
    same fixture; the table and the snapshot are written in one transaction (a failure between
    them leaves neither); deleted genres are removed
  - Go table tests in `app/readplane/internal/catalog/`: `genresSQL` and `relatedGenresSQL`
    return the stored counts, never touch `artist_genres`/`album_genres` (query text assertion),
    and handle the empty table
  - read-plane contract smoke: `/api/genres` and genre detail shapes unchanged, counts equal
    FastAPI's `/api/catalog/genres` for the seeded fixture
  - `app/tests/test_crate_schema_definition.py`

**Steps:** failing tests first, then implement, then run `PY test_genre_wheel_surface.py test_crate_schema_definition.py` and `go test ./internal/catalog/...` from `app/readplane`, then the read-plane contract smoke.

Commit: `perf(readplane): serve genre counts from the table the wheel builder writes`.

Release note: shared with 2.18c.

#### Task 2.18d: Curator overrides that survive restarts and rollbacks (G1, G2) `[BEHAVIOUR]`

**Why here:** the pre-v3 seeder runs on every boot (`init_db` in the API, worker and projector,
`db/init_db.py:141-144`) and upserts `eq_gains = EXCLUDED.eq_gains`, `name`, `description` and
`origin = 'core'` for the core genres (`db/jobs/genre_taxonomy.py:219-252`). Landing this before
Task 3.7 means EQ editing on core genres never has to be disabled in a release. Overrides live in
new columns the old seeder never writes, so an image rollback cannot overwrite them. This model is
canonical; Task 0.4 rewrites PD §4.6.3 item 5, the PD §5.3.4 G1 row and DS §4.3 to match.

**Files:**

- Create: migration `NNN_genre_overrides.py` and `app/crate/db/schema_sections/library_genres_vNNN.py`
  - `genre_taxonomy_nodes.local_eq_gains`, `eq_override` (`none|set|cleared`, so "clear to
    inherit" is representable on a core node), `local_name`, `local_description`
  - if PD18 = (a) with hideable core relations: `genre_taxonomy_edges.suppressed`
  - `eq_gains`, `name` and `description` keep meaning "the core release value"; the live value is
    `COALESCE(local, core)` (with `eq_override = 'cleared'` meaning inherit)
- Modify: `app/crate/db/jobs/genre_taxonomy.py:219-252`: the seeder refreshes the core columns
  only and stops forcing `origin='core'` on overlay nodes
- Modify: `app/crate/genre_taxonomy.py` (`_get_runtime_taxonomy_graph`: the runtime graph reads
  the live value; NULL means inherit; suppressed edges leave the graph),
  `app/readplane/internal/catalog/genre.go` (same rule, on top of 2.18a's tie-break parity, G2)
- Modify: `app/crate/api/genres.py`
  - `PATCH /eq-preset` and `PATCH /taxonomy/{slug}` write the `local_*` columns; "reset to core"
    clears them
  - `wheel_patch` on every mutation response (PD §4.6.3)
  - if PD18 = (a): `PUT /api/genres/taxonomy/{slug}/relations` accepts `suppressed: true` on
    locked core edges (locked edges still cannot be removed); `GenreWheelPayload.edges[]` gains
    `suppressed`
- Modify: `app/crate/db/jobs/genre_wheel.py` (2.18b): `nodes[].eq.overridden = eq_override <> 'none'`;
  `totals.overridden_nodes` counts nodes with `eq_override <> 'none' OR local_name IS NOT NULL OR
local_description IS NOT NULL`
- Modify: `app/tests/fixtures/genre_eq_path_cases.json` (2.18a): override and cleared cases
- Test:
  - `app/tests/test_genre_taxonomy.py`:
    - seed, edit, reseed keeps the edit;
    - reset restores core;
    - the release digest is unchanged;
    - the override and cleared fixture cases;
    - rollback safety: run the pre-v3 seeder SQL (copied verbatim into a fixture) over a
      v3-shaped row with overrides, and assert every override survives.
  - Go parity table test (the shared fixture, overrides included)
  - `app/tests/test_genre_wheel_surface.py`: `eq.overridden` and `totals.overridden_nodes`
  - `app/tests/test_genres_api.py` (`wheel_patch`, reset to core, suppression if PD18 = (a)),
    `test_crate_schema_definition.py`

**Steps:** failing tests first, then implement, then run `PY test_genre_taxonomy.py test_genre_wheel_surface.py test_genres_api.py test_crate_schema_definition.py`, `GO` and `GO-SMOKE`.

Commit: `fix(genres): keep curator edits to core genres across restarts`.

Release note: core-genre EQ and metadata edits persist across restarts and image rollbacks.

#### Task 2.18e: MusicBrainz provenance, cycle guard and AI drafts (G3, G7, [D35]) `[BEHAVIOUR]`

Separate from 2.18d so the override model ships and is observed on its own.

**Files:**

- Modify: MusicBrainz sync (`genre_descriptions.py`, `sync_musicbrainz_genre_graph_batch`) writes
  `source="musicbrainz"`; the health AI filter reads `ai_proposal` (G3). The 2.18b provenance
  fallback for legacy `manual` + `created_by IS NULL` edges stays for rows written before this
- Modify: `app/crate/db/repositories/genres_taxonomy_edges.py` (parent-cycle guard returning HTTP
  400, G7; `VALID_RELATION_TYPES` untouched)
- Modify: `app/crate/api/genres.py`: `generate-eq` defaults to `apply=false` ([D35])
- Test:
  - `app/tests/test_genre_taxonomy.py`: a MusicBrainz sync writes `musicbrainz`; a parent edge that
    would close a cycle returns 400
  - `app/tests/test_genres_api.py`: draft generate does not write; `apply=true` still does
  - the health AI filter test reads `ai_proposal`

**Steps:** failing tests first, then implement, then run `PY test_genre_taxonomy.py test_genres_api.py`.

Commit: `fix(genres): record MusicBrainz provenance and refuse parent cycles`.

Release note: "Generate with AI" previews instead of applying.

#### Task 2.19: Effective EQ chain in one query (B8)

**Files:**

- Create: `app/crate/db/queries/equalizer_resolution.py`
  - `get_track_eq_resolution_inputs(key, user_id, *, session=None)`, where the key is a global
    uid, entity uid or track id
  - one CTE:
    - the global catalog row joined to the library track by primary key or entity uid, then to the
      album;
    - candidate presets with `target_entity_uid = ANY(:uids) AND (user_id = :uid OR user_id IS NULL)`,
      aligned with `idx_equalizer_presets_user_target` and `idx_equalizer_presets_instance_target`;
    - album and artist genres, `LIMIT 10` each, as `json_agg`.
- Modify: `app/crate/equalizer.py`
  - `SMART_EQ_CHAIN` order
  - `resolve_effective_track_eq` evaluates the whole chain in memory and returns `chain[]`
    (applied, shadowed or absent, with gains and a reason) and `genrePath`
  - a forced taxonomy revision check (one Redis GET), so another API worker is not 30 s stale
- Modify: `app/crate/genre_taxonomy.py:861-935` (`_get_runtime_taxonomy_graph`)
  - the forced check bypasses the 30 s TTL, and a reload is 3 queries (nodes, aliases, edges) with
    no lock today, so the check needs a single-flight reload: a `threading.Lock` with a
    double-checked revision, plus a minimum reload interval per process (2 s; the current graph is
    served meanwhile)
  - bulk taxonomy jobs publish one revision at the end (2.18b), so per-edge churn does not reach
    `/eq`
- Modify: `app/crate/db/queries/browse_media_track_genres.py` (accept `session=`)
- Modify: `app/crate/api/schemas/media.py:155` (`EqChainLinkResponse`, `chain: list = []`, `genrePath`), `app/crate/api/browse_media.py:621,632`, `app/crate/api/catalog.py:1226`
  - the `unavailable` fallback returns every link `absent` with reason `remote_track`
- Test:
  - `app/tests/test_equalizer.py`:
    - each chain position as applied;
    - shadowed links carry gains;
    - absent reasons;
    - another user's preset never appears;
    - exactly one `read_scope` per resolution, with the taxonomy graph stubbed and the revision
      check counted separately;
    - the catalog fallback.
  - `app/tests/test_genre_taxonomy.py`: 20 concurrent resolutions after a revision bump cause
    exactly one reload; simulated per-edge revision churn causes at most one reload per 2 s.
  - `app/tests/test_openapi_contract.py`
  - Parity fixture `app/tests/fixtures/adaptive_eq_cases.json`, read by a new pytest case for
    `compute_audio_analysis_gains` and by `app/listen/src/lib/adaptive-eq.test.ts` for
    `computeAdaptiveGains` (a drift test)

**Steps:** failing tests first, then implement, then run `PY test_equalizer.py test_genre_taxonomy.py test_openapi_contract.py` and `VT-LISTEN src/lib/adaptive-eq.test.ts`.

Commit: `perf(eq): resolve the effective EQ chain in one query`.

#### Task 2.20: Night hours, instance heatmap fields and Crate Pulse privacy (PD43) `[BEHAVIOUR]`

**Why on the server:** PD43 (hide the instance heatmap below 3 listeners) is a privacy rule.
Hiding it only in `Stats.tsx` would still send the per-hour grid of a 1–2 listener server to every
authenticated user through `/api/stats/dashboard`, and shipped Capacitor builds ignore a new
client rule.

**Files:**

- Modify: `app/crate/db/queries/user_library_stats_signal.py`
  - `_heatmap` adds `night_hours` (from `_NIGHT_HOURS`)
  - the instance builder adds `listener_count` (in the same CTE pass as the heatmap)
- Modify: `app/crate/db/instance_stats_dashboard_surface.py` (the instance builder): when
  `listener_count < 3`, `heatmap.cells` becomes an all-zero 7×24 grid, `peak` and `night_share`
  become `null`, and `hidden_reason: "few_listeners"` is set. Not `cells: null`: the v2
  `StatsHeatmapCard` calls `heatmap.cells.flat()` and shipped builds would throw. The same rule
  covers `heatmap_utc` when Task 5.12 adds it.
- Modify: `app/crate/api/schemas/me.py` (`StatsHeatmapResponse.night_hours: list[int] = []`,
  `listener_count: int | None = None`, `hidden_reason: Literal["few_listeners"] | None = None`) and
  the `/api/stats/dashboard` response model
- Modify: `app/tests/fixtures/stats_dashboard_contract.json` (`heatmap` keys)
- Test:
  - `app/tests/test_user_stats_signal.py`
  - `app/tests/test_instance_stats_dashboard_surface.py`: with 2 listeners the payload carries
    zero cells, `peak: null`, `night_share: null` and `hidden_reason: "few_listeners"`; with 3
    it carries the real grid and no `hidden_reason`; user stats are never hidden
  - `app/tests/test_stats_api_contracts.py`, `app/tests/test_openapi_contract.py`

**Steps:** failing tests first, then implement, then run the four files.

Commit: `feat(stats): expose night hours and hide the instance heatmap below 3 listeners`.

Release note: Crate Pulse shows no listening hours on servers with fewer than 3 listeners.

### Checkpoint 2

1. Review assigned 2A/2B results and actual compatibility tests. Their independent operational
   releases need explicit approval; 2.10 and 2.11a–c retain their isolated observation protocols.
   Integrate 2C contracts before the matching UI milestone; no intermediate public UI release.
2. Only with Diego's approval, record production evidence: domain-event lag, request-time build
   absence and the new CTE plans. Local implementation does not imply this gate has passed.
3. Diego reviews each `[BEHAVIOUR]` diff and release-note entry. The joint P0 major stays gated.

---

## Phase 3 — Admin instruments

P0 first, in internal-milestone order (Genres, then Operations and the shell, then Health and the
Dashboard; Rollout → Milestones), then the rest of the Admin chapters in priority order:

- Analysis readout (P1)
- Album sidecar (P1)
- Release timeline (P1)
- Enrichment orbit (P2)

Each instrument builds its backend contract first (Phase 2C for P0; a backend sub-task below for
P1/P2). Every page gets functional Vitest coverage and the `ADMIN-E2E` smoke. Admin takes the
largest visual change in v3, so each P0 page task adds one reduced-motion capture to the Admin
screenshot harness of Task 0.11, and one lazy-route assertion to `App.bundle.test.tsx` (Task 0.12).

### Task 3.1: Admin building blocks

Lands with the first internal milestone (Genres): 3.7 needs `PageHeading`, the Nivo theme and the
Admin scramble.

**Files:**

- Create: `app/ui/src/components/layout/PageHeading.tsx` (eyebrow `MonoLabel`, display title in `text-display-page` with `tracking-headline`, lede, meta, actions), test `PageHeading.test.tsx`
- Modify: `app/shared/ui/tokens/typography.css` (`--text-display-page` and `--tracking-headline`,
  DS §1.9.4, their first consumer) and `app/shared/ui/lib/cn.ts` (register both keys); drift
  ceilings +2, listed in the commit body
- Create: `app/ui/src/components/admin/StatStrip.tsx` (2–6 `StatNumber`s on hairlines; the first direct Admin import of `StatNumber`), test `StatStrip.test.tsx`
- Create: `app/ui/src/hooks/use-snapshot-stream.ts`
  - replaces `app/ui/src/hooks/use-sse.ts` and the 6 copied reconnect effects
  - deps `[url, enabled]`; `withCredentials`; 5 s reconnect; version guard
  - test `use-snapshot-stream.test.ts`
- Create: `app/ui/src/contexts/AdminLiveProvider.tsx` and `app/ui/src/hooks/use-admin-live.ts`
  - one `EventSource` to `/api/admin/live-stream` per tab
  - surfaces registered by mounted hooks; the URL key is stable and sorted; with no surface
    registered the provider opens no `EventSource` (a page with no live instrument opens no stream)
  - gated per capability
  - closes the `EventSource` once `document.visibilityState` has been `hidden` for 30 s and
    reopens it on `visible`, re-reading the registered surfaces once on reopen; otherwise a
    background tab (OpsSnapshotContext keeps its stream open when hidden today) would renew the
    viewer keys forever and keep every sampler on its fast cadence
  - tests `AdminLiveProvider.test.tsx`: no EventSource while no surface is registered, and exactly one once the first registers; one EventSource across N updates; a 403 surface is never
    requested; the URL updates only when the surface set changes; after 30 s hidden there is no
    open EventSource (so no viewer key is renewed) and becoming visible reopens exactly one
- Create: `app/ui/src/lib/nivo-theme.ts` (token-resolved through `readCssColorToken`, resolved from the single Crate v3 tokens), test `nivo-theme.test.ts`
- Modify (every Nivo theme in Admin moves to `nivo-theme.ts`, so none is missed): the 3
  `NIVO_THEME` constants (`components/album/AudioProfileCard.tsx:30`, which 3.9b later deletes;
  `components/artist/ArtistStats.tsx:9`; `pages/Insights.tsx:67`) and the 6 inline
  `theme={{…}}` objects in 4 files (`components/album/TrackTable.tsx:647`,
  `components/artist/ArtistStats.tsx:237`, `pages/Dashboard.tsx:1080,1124,1177`,
  `pages/SystemHealth.tsx:483`). Test: a policy assertion in `nivo-theme.test.ts` that no
  `NIVO_THEME` constant and no inline `theme={{` remains in `app/ui/src`
- Create: `app/ui/src/lib/motion/scramble.ts`
  - port of `site:src/scripts/motion/scramble.ts`: no I/O/Q, WeakMap cancel, motion gate injected
  - test `scramble.test.ts`
  - Admin-local until Task 4.5 moves it to `@crate/ui/lib/scramble.ts` (Listen's EQ trail is
    the second adopter); its first Admin caller is 3.7's `GenreEqInheritancePanel`
- Modify: `app/ui/src/App.tsx` (mount `AdminLiveProvider` inside the shell)
- Modify: `app/ui/src/test-setup.ts`: shared fakes for `ResizeObserver`, `matchMedia`,
  `IntersectionObserver` and `EventSource` (reuse Listen's polyfills; today Admin mocks
  `EventSource` case by case)

**Steps:**

1. Write the failing tests for each block.
2. Implement.
3. Verify: `VT-ADMIN` on the six test files, `VT-UI lib/cn.test.ts`, `GATES`, `TYPES`, `LINT`,
   `ADMIN-E2E` (the Admin captures move with the Nivo theme; review them), `BUNDLE-ADMIN`.
4. One commit per block:
   - `feat(ui): add PageHeading and StatStrip for Admin pages`
   - `feat(ui): add one Admin live stream provider`
   - `refactor(ui): replace copied SSE reconnects with one hook`
   - `feat(ui): theme Nivo charts from tokens`
   - `test(ui): add shared jsdom fakes for Admin`

### Task 3.2: Admin shell chrome

**Files:**

- Modify: `app/ui/src/components/layout/Sidebar.tsx`
  - `MonoLabel` group labels; regrouped if PD14 = (a)
  - active item with a 2 px `accent-action-hi` bar
  - text navigation without decorative item icons; reconcile Task 1b.8 and keep its reviewed exceptions narrow
  - badges as a mono count plus `StatusDot`
  - the collapsed 72 px rail keeps only the dots
- Modify: `app/ui/src/components/layout/Shell.tsx`
  - flat header with a bottom hairline after scroll
  - breadcrumb `ADMIN · 07 / OPERATIONS · TASKS`
  - page transition: opacity plus 8 px over 0.35 s `ease-out-expo`; none under reduced motion
  - mobile top bar and navigation sheet (DS §5.4) below 760 px
- Modify: `app/ui/src/components/layout/CommandPalette.tsx` (popover recipe; task actions show
  their queue in mono from the task-catalog flags of 2.15c; PD §3.2.1, DS §5.4)
- Modify: `app/ui/src/App.tsx` routes, only if the check below finds the shadowing
- Delete: `app/ui/src/pages/Shows.tsx`, `app/ui/src/pages/Profile.tsx` (unrouted), `app/ui/src/components/ui/error-state.tsx` and its test (dead; `index.ts` updated)
- Test:
  - `app/ui/src/components/layout/Sidebar.test.tsx` (groups, `aria-current`, badge text)
  - `Shell.test.tsx` (breadcrumb; mobile top bar opens the sheet and traps focus)
  - `CommandPalette.test.tsx` (queue tag per task action)
  - a router test for PD §3.2.3: `artists/:artistId/:slug` is not shadowed by the album route
  - `ADMIN-E2E`

**Steps:**

1. Write failing tests.
2. Implement.
3. Verify: the tests, `TYPES`, `LINT`, `ADMIN-E2E`.
4. Commits:
   - `feat(ui): restyle the Admin shell with chapter groups`
   - `chore(ui): delete unrouted Admin pages and dead error state`

### Task 3.3: Dashboard tiles and the health tile (P0 · M)

> **Approved composition amendment, 2026-10-18 / 1AB:** Diego approved the three-block
> operational Dashboard: report/service state, reported work and fresh service interruptions,
> using only current payloads. See `2026-10-18-crate-v3-dashboard-implementation.md` and the final
> handover. This supersedes the four-tile/recent-album/diagnostics composition below, retained
> as historical planning context. It does not claim the future health surface/scan instruments,
> governor, worker-liveness or other backend prerequisites complete. Stop for visual review at1AB.

**Files:**

- Create: `app/ui/src/components/health/HealthScanTile.tsx`
  - 17 bars in catalog order: unattended checks full width, confirm checks at 82%
  - tone from `checkTone`; waiting issues as a `StatNumber`
  - a cursor driven by `health-scan` events
- Create: `app/ui/src/components/health/check-tone.ts`, test `check-tone.test.ts`
- Create: `app/ui/src/components/health/use-health-checks-surface.ts` (initial GET plus the `health` surface from `use-admin-live`, whose `health` and `health-scan` events update it)
- Create: `app/ui/src/components/admin/DashboardTiles.tsx`
  - Operations: queue sums from the ops snapshot (`worker_live.queue_breakdown` already holds
    running and pending per queue) plus the governor word from `GET /api/admin/governor` (which
    marks no viewer), read on load and when the ops snapshot updates; omitted while that endpoint
    is 404 or warming, since 2.16 ships in a later group. The tile never subscribes to the
    `queues` or `governor` live surfaces: the Dashboard is the Admin landing page, and an idle or
    background Dashboard would otherwise keep both samplers on their fast cadence (5 s governor
    samples, queue-lane rebuilds every 3 s)
  - Listeners: `active_users_5m` with "plays · 3 min"
  - Library: `~` counts
- Modify: `app/ui/src/pages/Dashboard.tsx`
  - the tile row: links on titles only, so no interactive content is nested
  - "Needs attention" as `HairlineList` (Admin adopts it)
  - Advanced diagnostics:
    - the event-bus card becomes one summary line linking to `/system#event-pipeline` (only with
      `ops.health.view`); the "SSE surfaces" tile stays;
    - formats become a proportional hairline bar;
    - decades become a hairline histogram.
  - Maintenance panel last, with typed confirmation.
  - Without `library.repair.run`, the Health tile falls back to `health_counts`.
- Test:
  - `app/ui/src/pages/Dashboard.test.tsx` (new):
    - tiles render from fixtures;
    - the permission fallback;
    - no `<a>` inside an `<a>`;
    - `/health?check=` row links;
    - the Scan pill dedup response;
    - the Dashboard registers only the `health` live surface, never `queues` or `governor` (so
      it sets neither `admin:live:viewers:queues` nor `:governor`).
  - `HealthScanTile.test.tsx`: warming, never scanned, clean, stale, live cursor, reduced motion
    (static cursor, no transition class)
  - `tests/admin-e2e`: Dashboard capture

**Mobile:** tiles go 4 → 2 → 1.

**Steps:**

1. Write failing tests.
2. Implement.
3. Verify: the tests, `TYPES`, `LINT`, `ADMIN-E2E`.
4. Commit: `feat(ui): show live health and operations tiles on the Dashboard`.

### Task 3.4: Tasks page with QueueLanes (P0 · L; fixes B10)

**Files:**

- Create: `app/ui/src/components/ops/queue-lanes-model.ts`, test `queue-lanes-model.test.ts`. Pure
  `reconcileLanes(prev, surface, width)` returns chip intents and zone targets:
  - queued: fit count by width, plus `+N`;
  - running: non-overlapping packing, with indeterminate chips packed left, plus `+N`;
  - done: the latest chip plus a count;
  - only chips that vanish without a transition fade;
  - deferred chips get the amber state and the `waits · 14:05` text.
- Create: `app/ui/src/components/ops/QueueLanes.tsx`
  - five lanes; live load numeral (PD35); consumers meta
  - heavy lane shows the daemon state
  - chips are `<button>`s keyed by task id, with a roving tabindex per lane
  - one visibility-gated rAF writing `transform` by ref, running only while a chip is moving;
    running chips' elapsed time is written into text nodes from a 1 s timer, so a long-running
    task does not keep a 60 fps loop alive
  - figure sentence; the polite region announces only failures and deferral changes, throttled
- Create: `app/ui/src/lib/motion/use-visible-loop.ts`, test `use-visible-loop.test.ts`
  (IntersectionObserver plus `visibilitychange`; `frame` held in a ref; deps
  `[ref, enabled]`; guards a missing `IntersectionObserver`). Admin-local: `QueueLanes` is its
  only importer, and DS §2.4/§6.4 put a shared lib module in `@crate/ui` only in the change where
  both apps import it. It moves to `@crate/ui/lib/use-visible-loop.ts` in the first Listen task
  that imports it directly (expected 4.8b's `use-mood-map-canvas.ts`), deleting the Admin copy.
- Create: `app/ui/src/components/ops/use-queues-surface.ts`
- Modify: `app/ui/src/pages/Tasks.tsx`
  - remove the per-card `useTaskEvents` in `ActiveTaskCard` (B10)
  - `WorkerControlPanel` header becomes `CratePill` action variants: Restart crate-worker (through
    `ConfirmDialog`, with a note that the band goes stale) and Cancel all (copy states the real cap:
    "at most 50 running and 50 pending per click", asserted in Vitest; `api_cancel_all_tasks` lists each status with the default `limit=50`)
  - delete the slots stepper and every `refreshTasks(true)` (`fresh=1`)
  - the selected task detail is the only per-task stream
  - `?queue=` filters the history through the pool filter
  - `StatStrip`; history as a table
- Test:
  - `queue-lanes-model.test.ts`
  - `app/ui/src/components/ops/QueueLanes.test.tsx`:
    - static render from a fixture;
    - deferred and governed classes plus their text;
    - reduced motion places chips at their final positions with no rAF;
    - the EventSource opens once across N snapshots;
    - selecting a chip calls back;
    - the loop stops after the chips settle while a task is still running, and the elapsed text
      still advances each second.
  - `use-visible-loop.test.ts`: no IntersectionObserver means no loop and no throw
  - `app/ui/src/pages/Tasks.test.tsx` (new): no `EventSource` per card; opening the detail opens
    one stream
  - `tests/admin-e2e`: Tasks capture
  - mark the rAF smoothing with `TEST_GAP:`

**Steps:**

1. Write failing tests.
2. Implement.
3. Verify: the test files above (`VT-ADMIN src/lib/motion/use-visible-loop.test.ts` included),
   `TYPES`, `LINT`, `ADMIN-E2E`, `BUNDLE-ADMIN`.
4. Commit: `feat(ui): show real queues as lanes on the Tasks page`.

### Task 3.5: GovernorGauges on Tasks and System (P1 · M; ships after the P0 groups)

**Depends on:** Task 4.3 (Listen player and EQ group), which moves the spring helpers to
`@crate/ui/lib/spring.ts`. Do not pull 3.5 ahead of 4.3.

**Files:**

- Create: `app/ui/src/components/ops/governor-format.ts` (scale, sticky upward scale, status copy, announcement, `any listener defers` when the limit is 0), test `governor-format.test.ts`
- Create: `app/ui/src/components/ops/governor-store.ts` (external store; `useSyncExternalStore` for the discrete verdict, window and staleness only; values flow through `store.subscribe` into springs), test `governor-store.test.ts`
- `GovernorGauges` imports `@crate/ui/lib/spring.ts` directly: Admin becomes its second, direct
  importer (Listen consumes it through `use-eq-morph`, 4.3), so the spring module serves both
  apps and the export policy stays green.
- Create: `app/ui/src/components/ops/GovernorGauges.tsx`
  - five shared `Meter`s, with springs at 170/18 from `@crate/ui/lib/spring.ts` writing through
    `valueRef`; the loop stops once the springs settle
  - variants `embedded` and `standalone`
  - stale after 30 s by the local clock, with a re-GET every 15–30 s while stale
- Modify: `app/ui/src/pages/Tasks.tsx` (embedded below the lanes)
- Modify: `app/ui/src/pages/SystemHealth.tsx`
  - standalone at the top of Resources
  - remove the `ResourceCard` "Resource Governor" (~1249–1300) and the "Batch open/deferred" chip
    (~1033–1044)
  - rename the Nivo series "Load at deferral"
- Test:
  - `GovernorGauges.test.tsx`:
    - warming, disabled, allowed;
    - deferring with the server reasons verbatim;
    - stale; `n/a`;
    - the over label text;
    - limit 0;
    - the loop stops once the springs settle.
  - `SystemHealth.test.tsx`, `Tasks.test.tsx`

**Steps:**

1. Write failing tests.
2. Implement.
3. Verify: the tests, `VT-UI export-usage-policy.test.ts`, `TYPES`, `LINT`.
4. Commit: `feat(ui): show the resource governor as live gauges`.

### Task 3.5b: System residue (P1 · M; coverage A16)

**Files:**

- Modify: `app/ui/src/pages/SystemHealth.tsx`
  - XL health score as `StatNumber size="xl"`
  - API latency strip on hairlines
  - the 14 metric streams as Nivo small multiples (shared theme from 3.1) with `?period=` in the
    URL (Task 1b.3 helper)
  - route latency table in the DS §5.5 table recipe
- Test: `SystemHealth.test.tsx` (score, the period param round-trips, small multiples render from
  a fixture with Nivo mocked)

**Steps:** failing tests first, then implement, then run the test, `TYPES`, `LINT`, `ADMIN-E2E`.

Commit: `feat(ui): restyle System metrics as small multiples`.

### Task 3.6: Health page with HealthScan (P0 · L+)

**Files:**

- Create: `app/ui/src/components/health/health-scan-model.ts` (pure reducer), test `health-scan-model.test.ts`
  - 150 ms minimum dwell queue
  - reconnect merge with `running`
  - rows keyed by `check_type`
  - a surface event during a run keeps the overlay until `last_scan.task_id` matches
- Create: `app/ui/src/components/health/HealthScan.tsx`
  - three L numerals with count-up
  - 6-column rows; the active row's elapsed time comes from a 1 s timer, and rAF runs only while
    the cursor or a count-up is moving
  - status line
  - footer with trash track files (from the 2.17e index), plus quarantined albums without a link
- Create: `app/shared/ui/lib/count-up.ts`, test `count-up.test.ts`: the count-up logic moved out of
  Listen's `CountUpNumber.tsx` (Admin is the second adopter); `CountUpNumber` imports it in the
  same change, motion gate injected
- Create: `app/ui/src/components/health/HealthScanRow.tsx`, `RiskMeter.tsx` (3 segments plus a word), tests
- Create: `app/ui/src/components/health/HealthIssueDrilldown.tsx` (extracted from `Health.tsx` ~960–1150; `fixAllMode` and `groupIssuesByArtist` keep their tests)
  - reads `GET /api/admin/health-checks/{check_type}/issues` (2.17c), one page of artists at a
    time with "Load more" on `next_cursor`
  - refetches when a `health` live event changes that check's `open`; no stream of its own
- Modify: `app/ui/src/pages/Health.tsx`
  - remove the inline hero, the catalog card, the tasks-stream subscription and the
    `/api/admin/health-stream` `EventSource` (`Health.tsx:399-404`); the page reads only the
    `health` surface of the one Admin live stream
  - `?check=` through `useSearchParams` (replaces `useState` at :312)
  - new `ConfirmDialog`s for the `shadow_quality_tracks` fix-all and for `dismiss-type`
  - keep "Run cleanup now"
  - `Fix 500 of N` labelling
- Test:
  - `health-scan-model.test.ts`
  - `HealthScan.test.tsx`:
    - warming, never scanned, failed, offline, queued;
    - the polite region announces only phase changes;
    - named action buttons.
  - `RiskMeter.test.tsx`
  - `app/ui/src/pages/Health.test.tsx`: the deep link; `fixAllMode` global now asks for
    confirmation; the page opens no `EventSource` of its own (only the provider's)
  - `HealthIssueDrilldown.test.tsx`: an artist's issues stay together across pages; a `health`
    event that changes the check's `open` refetches the first page
  - `count-up.test.ts`; Listen `CountUpNumber` tests still pass
  - the loop stops after settling while a scan is still running
  - `tests/admin-e2e`: Health capture

**Mobile:** under 1000 px hide scope and risk; under 760 px hide the index and description.

**Steps:**

1. Write failing tests.
2. Implement.
3. Verify: the tests, `TYPES`, `LINT`, `ADMIN-E2E`.
4. Commit: `feat(ui): turn the Health page into a live scan instrument`.

### Task 3.7: Genres wheel, read-only (P0 · L)

**Depends on:** 2.18a–e (the Genres group), Task 3.1 and Task 0.14's production numbers. Before
porting, run the site re-sync step (plan header: pinned site reference) for
`site:src/scripts/viz/taxonomy-math.ts` and `genre-view.ts`.

**Files:**

- Create: `app/ui/src/lib/genre-wheel-math.ts`, test `genre-wheel-math.test.ts`
  - port of `site:src/scripts/viz/taxonomy-math.ts` (`buildTaxonomy`, `radialLayout`) with:
    - visited-set guards;
    - an "Unplaced" sector;
    - ring extension `256 + 34·(ring − 3)`;
    - parent edges keyed `child>parent`;
    - LOD label selection, with the thresholds, the "Unplaced" rule and the `+N` collapse set from
      Task 0.14's overlay, orphan and unmapped counts (recorded in the PR);
    - a client re-resolve for previews and the blast radius that mirrors Python's
      `resolve_genre_eq_preset`: a BFS over parents sorted at each level, so equal-depth ties
      resolve in path order (Go matches it from 2.18a, element-wise `ORDER BY depth, path`); the
      blast radius is the nodes whose resolved source changes, and its albums and tracks are the
      sum of their `eq.reach` (exact, because reach follows each track's single primary genre).
  - Copy the site's tests (from the pinned SHA) and add cycle, multi-parent, orphan, unplaced and
    depth ≥ 3 cases, plus multi-parent cases where setting a preset on a non-path ancestor switches
    a node's source. Every case of `app/tests/fixtures/genre_eq_path_cases.json` (2.18a, including
    the `a`/`b`/`z`/`c` and prefix-slug cases) runs here too, read from
    `../../../tests/fixtures/genre_eq_path_cases.json`, so the client, Python and Go cannot drift.
- Create: `app/ui/src/components/genres/GenreWheel.tsx`
  - SVG, memoised on the revision; hover is O(degree) through `classList` refs
  - roving tabindex; `/` focuses a search combobox that matches names and aliases
  - `role="group"` with focusable `<g>` nodes
  - the own-preset node is filled fg at .55 (not cyan); the pinned node uses
    `fill-surface-accent-active` (site `#0b1d24`; an SVG `fill`, not `bg-`)
  - the draw-in runs once; nothing loops while idle
- Modify: `app/shared/ui/lib/appearance-token-registry.ts`: new `--surface-accent-active` =
  `color-mix(in srgb, var(--accent-action) 11%, var(--surface-canvas))` (DS §1.9.1, first
  consumer); `TOKENS-GEN`; utility in `app/shared/ui/tokens/surfaces.css`; drift ceilings +1
  (DS §6.2); registry and contrast tests in the same commit
- Create: `app/ui/src/components/genres/GenreWheelInspector.tsx` (counts, relations as `HairlineList` with provenance, aliases with origin from the payload), `GenreEqInheritancePanel.tsx` (Admin-local; the display word scrambles 420 ms through the Admin `lib/motion/scramble.ts` of 3.1, its first caller), `MiniEqBars.tsx` (Admin-local; site micro sizes allowed here), `use-genre-wheel.ts` (reads `GET /api/admin/genres/wheel`, `library.view`; handles `ready`, `stale` and `warming`)
- Modify: `app/ui/src/App.bundle.test.tsx` (the Genres route stays lazy)
- Modify: `app/ui/src/pages/Genres.tsx` (`GenreList` default view Wheel, with Tree and Grid kept, PD19; the genre detail locator next to `GenreEqEditor`, rendered outside the curator gate)
- Modify: `app/ui/src/components/genres/GenreTaxonomyTree.tsx`
  - `:617` passes `initialGains` only for direct presets and uses display names
  - remove the dead "Generate playlist" action at `:951` (G9)
- EQ writes on core genres stay enabled: Tasks 2.18d and 2.18e, in the same internal milestone and
  landed before this task, make them persist, so nothing is disabled.
- Test:
  - `genre-wheel-math.test.ts`
  - `GenreWheel.test.tsx`:
    - the figure sentence;
    - nodes are focusable;
    - hover sets the path classes;
    - Escape clears;
    - `/` search finds a node by alias;
    - no draw-in under reduced motion.
  - `GenreWheelInspector.test.tsx`: blast radius from the client re-resolve, including a
    multi-parent switch; aliases with origin
  - `appearance-token-registry.test.ts`, `color-contrast.test.ts` (the new token)
  - `GenreTaxonomyTree.test.tsx`: `initialGains` regression
  - `Genres` page test
  - `tests/admin-e2e`: Genres capture

**Steps:**

1. Write failing tests.
2. Implement.
3. Verify: the tests, `TYPES`, `LINT`, `ADMIN-E2E`.
4. Commits:
   - `feat(ui): make the genre wheel the default Genres view`
   - `fix(ui): pass only direct presets to the genre EQ editor`

### Task 3.8: Genre editing from the wheel (frontend for G1, G3, G7)

Frontend only. The backend (overrides in `local_*` columns, seeder, resolver parity, `wheel_patch`
and suppression in Task 2.18d; MusicBrainz provenance, the cycle guard and AI drafts in Task
2.18e) ships before Task 3.7.

**Files:**

- Modify: `GenreWheelInspector.tsx` (edit EQ, reset to core, link mode, unmapped mapper; if
  PD18 = (a), a "Hide on this server" action on locked core edges, drawn dashed when
  `edges[].suppressed`), `GenreEqEditor.tsx` (ghost of the persisted curve; consumes the PATCH
  response merged over the refetch)
- Test (Vitest): inspector edit flows; reset to core; PATCH merge; link mode disables cycle-forming
  parents; suppression toggle (if PD18 = (a)); the curator gate.

**Steps:** failing tests first, then implement, then run the Vitest files, `TYPES`, `LINT`,
`ADMIN-E2E`.

Commit: `feat(ui): edit relations, aliases and EQ from the genre wheel`.

### Task 3.9a: Analysis readout backend `[BEHAVIOUR]`

Camelot is not part of this task: `app/crate/camelot.py` and its fixture come from Task 2.9b.

**Files:**

- Create: `app/crate/db/queries/track_analysis_readout.py`
  - `get_album_track_analysis`
  - `get_recent_analysed_tracks`
  - `get_track_bliss_neighbours`: seed subquery, `bliss_embedding IS NOT NULL`, `id <> :id`,
    `playable_track_clause`
  - a shared serializer that clamps and rounds values
- Create: `app/crate/api/admin_analysis.py`
  - `/api/admin/albums/{id}/analysis` and `/by-entity/{uid}/analysis`
  - `/api/admin/tracks/{id}/neighbours?limit=` (1–12)
  - schemas in `api/schemas/operations.py` or a new `api/schemas/analysis.py`
- Modify: `app/crate/worker.py:449-470` (the `analysis_status` block, split by cadence)
  - the cheap `track_processing_state` `GROUP BY` and `recent` stay in the 120 s step;
  - the full scans (the lyrics `MATERIALIZED` regexp CTE over `library_tracks`, the fingerprint
    counts, the portable counts and drift) move to a separate 15 min step that writes the same
    `ops_runtime_state('analysis_status')` fields, and runs sooner when the lyrics, fingerprint or
    portable tasks set a dirty flag (PD §4.7); the 120 s step never runs them, so it issues no
    per-album query and no `library_tracks` scan beyond the existing `GROUP BY`;
  - adds `recent`;
  - adds `fingerprint_failed` to `db/jobs/analysis_status.py` (one more `FILTER` in its existing
    query). The block already stores lyrics coverage (`lyrics_cached`, `lyrics_found`,
    `lyrics_missing`) and portable counts (`portable_sidecar_albums`,
    `portable_audio_tag_albums`, `portable_tag_errors`, …) through
    `get_portable_metadata_status()`, but nothing declares them; portable `drift` arrives with
    3.10a's `catalog_changed_at` column.
- Modify: `AnalysisStatusResponse` and `_empty_analysis_payload` (`db/ops_snapshot_pipeline.py`)
  declare `recent`, `stale`, `unavailable`, `updated_at`, `fingerprint_failed` and the existing
  lyrics and portable fields the Coverage panel (PD §4.7) reads
- Modify: `app/crate/api/management.py:1479-1497` (`/api/manage/analysis-status`): returns
  `build_analysis_payload()` (reads `ops_runtime_state`, `_empty_analysis_payload()` when missing)
  and never calls `get_analysis_status()`, whose cold path runs `SELECT COUNT(*) FROM
library_tracks` plus a `MATERIALIZED` regexp CTE over every track
- Modify: `/info` adds `bliss_vector`, rounded and clamped identically in:
  - `app/crate/api/browse_media.py` (`_serialize_track_info_row`), `api/schemas/media.py`
    (`TrackInfoResponse`) and the `api/catalog.py` allowlist (at most 20 floats);
  - `app/readplane/internal/catalog/helpers.go` (`serializeTrackInfo`);
  - the smoke shape assertion;
  - `tests/listen-visual/fixtures.ts`.
- Modify: `app/crate/api/management.py` (`reanalyze_album` uses `create_task_dedup(dedup_key="album:{id}")`)
- Test:
  - `app/tests/test_track_analysis_readout.py` (new, `pg_db`): serializer, album order and states,
    recent `LIMIT` and order, neighbours limit and null vector
  - `app/tests/test_analysis_status.py` (or the existing analysis status test, `pg_db`):
    `fingerprint_failed`; the declared lyrics and portable fields round-trip through the schema
    the 120 s step issues no lyrics CTE and no per-album query; the 15 min step runs the lyrics
    CTE at most once per 15 min unless the dirty flag is set
  - the analysis-status endpoint with `get_analysis_status` patched to raise returns the stored
    payload, or the empty one when the row is missing
  - `reanalyze_album` twice returns the same task (`deduplicated: true`)
  - API permission tests
  - `test_openapi_contract.py`
  - Go table test
  - `GO-SMOKE`

**Steps:** failing tests first, then implement, then run the files above.

Commits:

- `feat(analysis): serve album readouts and bliss neighbours`
- `perf(analysis): never count analysis status in a request`

Release note: re-analysing an album that is already queued returns the queued task.

### Task 3.9b: Shared `TrackReadout` in Admin Analysis, Admin Album and Listen Info tab

**Visual target confirmed 2026-10-16:** follow the site `TrackReadout.astro` at pin `258bbaee`,
reaffirmed by Diego's screenshot: large BPM/key/loudness/dynamic-range figures beneath top rules,
five thin feature bars and a bipolar 20-value Bliss strip. No per-metric boxes, metric icons,
header icons or substituted radar. Preserve V3 typography/tokens, real state and honest units;
the reference's LUFS label does not override the `dB` contract until validated integrated LUFS
exists. 1F's legacy contrast repair does not implement or approve the final Audio Profile.
This confirmation does not silently reorder the backend/Camelot/shared-consumer prerequisites.

**Files:**

- Create: `app/shared/ui/domain/analysis/TrackReadout.tsx` (props only; title slot for the Admin scramble; `reducedMotion` prop; `dl` figures; five feature bars; 20-bar bliss strip; springs through refs from `@crate/ui/lib/spring.ts`), test `TrackReadout.test.tsx`
- Create: `app/shared/ui/lib/camelot.ts`, test `camelot.test.ts`. It reads `app/tests/fixtures/camelot_cases.json` (Task 2.9b): a drift test against Python.
  - Only the shared `TrackReadout` imports it, and `export-usage-policy.test.ts` follows
    `export … from` but not `import`, so `TrackReadout.tsx` re-exports `toCamelot` with a relative
    `export { toCamelot } from "../../lib/camelot"`; Listen's track-row meta (`124 · 8A`, Task
    6.13) later becomes a direct importer
- Modify: `app/shared/ui/tokens/typography.css` and `app/shared/ui/lib/cn.ts`:
  `--text-display-readout` (DS §1.9.4, its first consumer), with a guarded fallback verified after
  compilation/minification when this later task implements it; update only the measured drift
  metric affected, with no automatic root semantic-definition ceiling increase
- Create: `app/ui/src/components/analysis/LatestAnalysisPanel.tsx` (chips, "Latest" follows new arrivals, a chip pins), `AlbumAnalysisPanel.tsx` (selection from `TrackTable`; Re-analyse with `library.analysis.manage`; 10 s polling while tracks are pending, page visible only, 10 min cap), tests
- Modify:
  - `app/ui/src/pages/Analysis.tsx`: coverage 5fr and readout 7fr; the empty state is not
    "Re-analyze all"
  - `app/ui/src/pages/Album.tsx`, `app/ui/src/components/album/TrackTable.tsx`: delete
    `AudioProfileCard.tsx` and the radar tooltip
- Create: `app/listen/src/components/player/extended/InfoTabReadout.tsx`
  - adapter from `TrackInfo` to the readout item
  - keeps the last item while `useTrackInfo` loads
- Modify: Listen Info tab sections
  - delete `InfoTabAudioProfile.tsx`, `InfoTabBliss.tsx`, `InfoTabQuietMetrics.tsx` and the
    duplicate loudness rows in `InfoTabSource.tsx`
  - reuse `player.info.metric.*` keys; add only `player.info.fingerprintUnavailable` (7 catalogs)
- Test:
  - `TrackReadout.test.tsx`: final state, nulls, no rAF under reduced motion, aria sentence
  - `camelot.test.ts`
  - Admin panel tests: follow/pin; polling stops
  - `app/ui/src/pages/Album.test.tsx`
  - `InfoTabReadout.test.tsx`
  - `I18N`, `BUNDLE` (extended player chunk), `VISUAL` (home-player)

**Steps:** failing tests first, then implement, then run the tests above,
`VT-UI export-usage-policy.test.ts`, `GATES`, `TYPES` and `BUNDLE-ADMIN`.

Commit: `feat(analysis): show one track readout in Admin and Listen`.

### Task 3.10a: Album sidecar backend (P1 · M)

**Files:**

- Create: migration `NNN_album_portable_metadata_state.py` and `app/crate/db/schema_sections/library_vNNN.py`. New `album_portable_metadata` columns:
  `schema_version`, `payload_digest`, `section_digests`, `artwork_files`, `rehydrated_at`,
  `last_task_id`, `last_error`, `catalog_changed_at` (`ADD COLUMN IF NOT EXISTS`, nullable).
- Modify: `app/crate/portable_metadata.py`
  - Create `IDENTITY_TAG_KEYS` (it does not exist yet), built from the `_identity_tags` keys and
    keeping the literal strings
  - keep the literal line `PORTABLE_SCHEMA_VERSION = 1` (`:15`; the site parses it)
  - `portable_payload_digest` and `portable_section_digests`, excluding volatile and local keys
    plus the PD30 keys
  - `on_track` callback in the tag loop
- Modify: `app/crate/db/queries/portable_metadata.py`
  - `get_portable_album_payload(..., session=None)`, keeping the literal lines
    `"schema_version": 1` (`:299`) and `"bpm": track.get("analysis_bpm")`
  - `get_album_portable_metadata_view` in one `read_scope`
- Modify: `app/crate/db/repositories/portable_metadata.py` (`mark_album_portable_metadata` fields; new `mark_album_portable_rehydrated` that leaves `sidecar_written_at`, `tags_written` and `tag_errors` alone)
- Modify: `app/crate/api/management.py`
  - `GET /api/manage/albums/{id}/portable-metadata` and `/by-entity/{uid}`: auth check before
    the 404
  - rehydrate takes `album_id` and resolves the path from the DB
  - enqueue with `dedup_key="portable-metadata:album:{id}"`
- Modify: `app/crate/worker_handlers/management.py:2355,2469` (`portable_track` events), `app/crate/worker_handlers/enrichment.py:1345`
  - `_handle_write_portable_metadata` also runs library-wide (`list_portable_album_ids`); with
    `emit_task_event` each track would cost a `task_events` row plus a `crate:sse:global` publish
    (about 48K of each for a full export). So `portable_track` is emitted only for album-scoped
    runs (`album_id` or `album_entity_uid` param), through `publish_task_signal` (2.17c);
    library-wide runs report progress through `update_task` only
- Modify: the writers that change album, track or artist metadata the sidecar carries (tag edits,
  renames, repairs, rehydrate: `db/repositories/portable_metadata.py`, the management and repair
  handlers) set `catalog_changed_at = now()` on the album's `album_portable_metadata` row (upsert
  when the row does not exist)
- Create: a nightly maintenance task (scheduler entry) that recomputes current digests in batches
  and sets `catalog_changed_at` where the digest differs from the stored `payload_digest`: the
  floor for writers that were missed. It is the only place a per-album payload is built in bulk
- Modify: `app/crate/worker.py`, the 15 min scan step of 3.9a: portable `drift` =
  `COUNT(*) FILTER (WHERE catalog_changed_at > sidecar_written_at)` over `album_portable_metadata`
  (3.9a declared the field); never a per-album payload build (about 13K queries per run), and not
  in the 120 s step
- Test:
  - `app/tests/test_portable_metadata.py`:
    - the digest is stable across volatile keys;
    - `IDENTITY_TAG_KEYS` equals the `_identity_tags` keys;
    - `on_track` fires;
    - rehydrate preserves the tag counts;
    - a tag edit, rename, repair or rehydrate sets `catalog_changed_at`; a sidecar write moves
      `sidecar_written_at` past it (no drift); the nightly recompute sets it where digests differ;
    - the drift count is `catalog_changed_at > sidecar_written_at` and issues no per-album query.
  - handler: a library-wide run emits zero per-track events; no `portable_track` message reaches
    `crate:sse:global`
  - `app/tests/test_portable_metadata_view.py` (new, `pg_db`): never, in sync, drift, unknown;
    changed sections
  - API 403 before 404
  - handler event and dedup
  - `test_crate_schema_definition.py`

**Steps:** failing tests first, then implement, then run the files above.

Commit: `feat(sidecar): track portable metadata sync per album`.

### Task 3.10b: Album sidecar panel

**Files:**

- Create: `app/ui/src/lib/json-lines.ts` (port of `site:src/lib/json-lines.ts` without `typedAt`) and its ported test
- Create: `app/ui/src/hooks/use-auto-follow-scroll.ts` (yields on wheel, pointer or key; reused by Logs in 5.1), test
- Create: `app/ui/src/components/album/portable-metadata/{PortableMetadataPanel,SidecarTree,SidecarJson,SidecarFlow}.tsx`, `use-portable-metadata.ts`, tests
- Modify: `app/ui/src/pages/Album.tsx` (panel between `TrackTable` and `RelatedAlbums`; fetched when first visible; `onMetadataTaskQueued('portable', taskId)` wired)
- Test:
  - each component: states never, in sync, drift, unknown, queued, error
  - `Album.test.tsx`
  - the Restore `ConfirmDialog` copy
  - reduced motion: no sweep or stagger

**Steps:** failing tests first, then implement, then run the tests.

Commit: `feat(ui): show the album sidecar and its sync state`.

### Task 3.11a: Release lifecycle backend (P1 · L)

**Files:**

- Create: migration `NNN_new_release_lifecycle.py` and `app/crate/db/schema_sections/acquisition_vNNN.py`
  - columns: `library_album_id`, `download_task_id`, `download_queued_at`, `import_task_id`,
    `imported_at`, `analysed_at`, `failed_stage`, `last_error`, `lifecycle_reason`,
    `lifecycle_updated_at`
  - one-off backfill
- Modify: `app/crate/db/orm/releases.py`; `app/tests/test_orm_schema_contract.py`
- Create: `app/crate/db/repositories/new_release_lifecycle.py` (request-path atomic writers: `queue_release_download`, dismiss with event)
- Modify: `app/crate/db/jobs/acquisition.py`. Worker writers: `mark_download_failed`,
  `link_downloaded_albums`, `queue_release_import`, `mark_imported`, `reconcile_lifecycle`. Each
  appends `acquisition.release.updated` in the same session.
- Create: `app/crate/db/queries/new_releases_surface.py` (one CTE), `app/crate/db/new_releases_surface.py` (orchestration, serve stale), `app/crate/release_lifecycle.py` (pure `derive_release_lifecycle`)
- `PROCESS_NEW_CONTENT_PHASES` tuple. Projector action `new-releases` (trailing-edge coalesced). A
  60 s reconciler in the service loop (crate-worker only), only while there is work. Task type
  `refresh_new_releases_surface` (fast, cold reads only, `quiet=True`).
- Modify: `app/crate/api/acquisition.py`
  - `/snapshot` reads the row
  - `/stream` pubsub with `to_thread`
  - `/new-releases` filters in memory
- Modify: `app/crate/api/schemas/acquisition.py`
- Test:
  - `app/tests/test_release_lifecycle.py` (new): a table of about 14 cases
  - `app/tests/test_new_release_lifecycle_jobs.py` (new, `pg_db`)
  - builder test
  - `test_projector.py`, `test_acquisition_handlers.py`, `test_api.py`
  - `test_openapi_contract.py`, `test_permissions.py`, `test_task_queue_routing.py`
  - migration test

**Steps:** failing tests first, then implement, then run the files above.

Commit: `feat(acquisition): track each new release from detection to analysis`.

### Task 3.11b: ReleaseRail on New Releases

**Files:**

- Create: `app/ui/src/components/admin/StepRail.tsx` (shared by release, setup, imports and key rotation; vertical under a 900 px container), test
- Create: `app/ui/src/components/acquisition/{ReleaseRail,ReleaseRailCompact}.tsx`, `release-lifecycle.ts` (`clockLabel`, `railProgress`, `stageTitle`), tests
- Modify: `app/ui/src/pages/NewReleases.tsx`
  - band in place of `OpsPageHero` and the 4 tiles
  - compact rails on rows; `?release=` deep link
  - focus button on the title or cover, with links as siblings
  - step chips via `CrateChip`
- Test:
  - `app/ui/src/pages/NewReleases.test.tsx` (new)
  - `ReleaseRail.test.tsx`: states skipped, waiting, failed with retry, analysed N/M
  - `release-lifecycle.test.ts`
  - Discover and Upcoming link tests

**Steps:** failing tests first, then implement, then run the tests.

Commit: `feat(ui): follow each release on a live lifecycle rail`.

### Task 3.11c: Release timelines for non-Tidal acquisitions (PD27 / [D33]; P1 · M)

**Why:** 3.11a links albums only through the lower-cased name backfill and
`link_downloaded_albums` on the Tidal path, so releases acquired through Soulseek or uploads never
reach Fetched, Imported or Analysed on the ReleaseRail, one of the site mocks being made real.

**If PD27 = (a)** (the recommendation):

**Files:**

- Modify: `app/crate/db/jobs/acquisition.py` (`mark_imported`, `link_downloaded_albums`): for any
  import source, match a `new_releases` row to the imported `library_albums` row by
  `new_releases.mb_release_group_id = library_albums.musicbrainz_releasegroupid` first, then by
  normalised artist and title (the normaliser of 3.11a's backfill); an ambiguous match (more than
  one candidate) stays unlinked and records `lifecycle_reason`
- Modify: the import handlers that complete an import (`process_new_content`,
  `_handle_import_queue_item` and `_handle_import_queue_all`, `library_upload` in
  `worker_handlers/acquisition.py`; grep for the symbols): call the linker with the imported album
  ids, in the same session that appends `acquisition.release.updated`
- Test: `app/tests/test_new_release_lifecycle_jobs.py` (`pg_db`): a Soulseek import links by
  release group; a name-only fallback links; an ambiguous name match stays unlinked; an upload
  import links; the Tidal path is unchanged

**Steps:** failing tests first, then implement, then run the test file.

Commit: `feat(acquisition): follow non-Tidal releases on the lifecycle rail`.

**If PD27 = (b):** no backend change; `ReleaseRail` shows `detected` only for non-Tidal sources,
with a `ReleaseRail.test.tsx` case, and the stage copy says so.

### Task 3.12a: Enrichment sources backend (P2 · L) `[BEHAVIOUR]`

**Files:**

- Create: migration `NNN_artist_enrichment_sources.py` and `app/crate/db/schema_sections/enrichment_sources_vNNN.py`
- Modify: `app/crate/enrichment.py`
  - add the `FetchOutcome`, lane, wait and fetch timings, and `force_sources` (skips min-age and
    provider caches) below the constant definitions
  - do not mention `_ENRICHMENT_FETCH_ORDER`, `_SOURCE_TTLS_SECONDS` or
    `_PROVIDER_MIN_INTERVAL_SECONDS` above them (site drift)
  - add `enrichment_source_catalog()`
- Create: `app/crate/db/jobs/enrichment_sources.py` (batch upsert with `unnest`), `app/crate/db/queries/artist_enrichment_status.py` (one CTE)
- Modify: `app/crate/db/events.py`
  - per-source events through `publish_task_signal` (from 2.17c): task channel only
  - run key as a hash per source with `EXPIRE 600`
  - per-artist lock `SET NX`
- Modify: `app/crate/api/enrichment.py`
  - `GET /api/admin/artists/{id}/enrichment/sources` (`library.view`) and `POST /api/artists/{id}/enrichment/refresh`, plus by-entity variants,
    returning `TaskEnqueueResponse`
  - V7: `GET /api/artists/{id}/enrichment` stops calling providers and enqueues instead. Listen's
    bio hook gets `{}` when cold.
- Modify: `app/crate/api/cache_events.py:490` (the regex becomes `/enrich$`)
- One-off task `backfill_enrichment_sources` (`notify=False`)
- PD29 (wiring the enrichment source toggles) is Task 3.12c, its own `[BEHAVIOUR]` PR
- Test: outcome classification and lane parsing; signal order; upsert (`pg_db`); CTE status and secondary coverage (no `library_tracks` in the SQL); 404/403; dedup response; V7; `publish_task_signal` never global; the regex; backfill

**Steps:** failing tests first, then implement, then run the tests.

Commit: `feat(enrichment): record each source fetch per artist`.

### Task 3.12b: EnrichmentOrbit tab

**Files:**

- Create: `app/ui/src/components/artist/enrichment/{EnrichmentOrbit,PoolLanes}.tsx`, `orbit-math.ts`, `run-model.ts`, `orbit-frame.ts`, tests (outer offset −π/2 + π/7)
- Create: `app/ui/src/components/artist/ArtistEnrichmentPanel.tsx` (lazy), `app/ui/src/hooks/use-artist-enrichment-sources.ts`, `use-enrichment-run.ts` (open `EventSource` first, then GET, then filter `enrichment.source`)
- Modify:
  - `app/ui/src/components/artist/artistPageTypes.ts`, `artistPageData.ts`: new `enrichment` tab
    before About
  - `app/ui/src/pages/Artist.tsx:908`: Enrich no longer reloads the page (PD31)
- Test: the math, the reducer, panel states, keyboard; the loop stops when idle; a `TEST_GAP:` for rAF

**Steps:** failing tests first, then implement, then run the tests.

Commit: `feat(ui): show enrichment sources as a live orbit on the artist page`.

### Task 3.12c: Honour the enrichment source toggles (PD29 / [D38]) `[MAIN]` `[BEHAVIOUR]`

Only if PD29 = (a) (the Task 0.3 recommendation); with (b) the Settings toggles are hidden instead
(`app/ui/src/pages/Settings.tsx`, a page test) and this task is "no backend work".

**Files:**

- Modify: `app/crate/enrichment.py`: each provider fetch checks the `enrichment_sources` setting
  (`api/settings.py`, `VALID_ENRICHMENT_SOURCES`); a disabled source is skipped and recorded as
  `disabled` in the 3.12a source rows (instrumentation below the constant definitions, site drift)
- Modify: `app/crate/api/settings.py`: alias `setlistfm` → `setlist` on read and write (both keys
  accepted for one release), and add `discogs` to `VALID_ENRICHMENT_SOURCES` and the default
- Modify: `app/ui/src/pages/Settings.tsx` (the Discogs toggle; the `setlistfm` label keeps working)
- Test:
  - `app/tests/test_enrichment.py`: a disabled source is never fetched (provider client patched
    to raise); enabled sources are unchanged
  - `app/tests/test_settings_api.py` (or the existing settings test): the alias round-trips;
    Discogs is accepted
  - `app/ui/src/pages/Settings.test.tsx`: the Discogs toggle

**Steps:** failing tests first, then implement, then run the tests above.

Commit: `feat(enrichment): honour source toggles`.

Release note: enrichment sources switched off in Settings are no longer fetched.

### Checkpoint 3

Apply this review to the Admin milestone just completed. The P0 major reviews Dashboard, Tasks,
Health and read-only Genres; gauges/editing/readouts are later P1 work and do not expand the P0 gate.

Diego reviews in the dev stack with real data:

- the Dashboard;
- Tasks with lanes and gauges;
- Health with a live scan;
- the Genres wheel, read-only, then the editing flows;
- the Analysis and Album readout.

Confirm in each case that:

- the browser devtools show one live `EventSource` per tab;
- there is no `fresh=1`;
- there are no request-time builds in the API logs.

---

## Phase 4 — Listen instruments

P0 first:

- shell, player bar and fullscreen player;
- EQ glyph, EQ panel and the Smart EQ chain;
- Stats heatmap.

Then P1:

- setlist ticket with `in_library`;
- moods;
- Paths;
- Radio.

Then P2: the visualizer palette source (PD40) and the mobile analysed state (PD41).

Every task re-records the affected baselines and runs `BUNDLE`.

### Task 4.1: Shell chrome and client loops (P0 · M; B24)

**Files:**

- Modify:
  - `app/listen/src/components/layout/sidebar/Sidebar.tsx` (active bar, mono labels; the
    Discovery-radio glow driven by `useAudioVisualizer` at `:7,21` removed)
  - `app/listen/src/components/layout/Shell.tsx` (gradient fade instead of blur)
  - `app/listen/src/components/layout/MobileBottomNav.tsx` (22 px icon, 10 px mono label, 2 px
    top bar drawn in, no pill, 44 px)
- Modify: the mini player, which gets a 1 px progress line written by ref from a `usePlayerProgress` leaf
- Modify: `app/listen/src/hooks/use-audio-visualizer.ts:44-72` (analyser data held in refs and read in rAF; no `setState` at 20 fps)
- Modify: `app/listen/src/hooks/use-crossfade-progress.ts`
  - ref-based
  - callers `FullscreenPlayer.tsx`, `ExtendedPlayer.tsx` and `usePlayerBarController` subscribe
    once
  - the artwork fade goes through a CSS variable
- Modify: `LyricsPanel.tsx:41` (progress subscribed in the line leaf only)
- Modify: the shared `@crate/ui/domain/navigation/PageHeader` and `@crate/ui/domain/lists/SectionHeader` restyle (Listen consumers only)
- Modify: `app/shared/ui/tokens/typography.css` and `app/shared/ui/lib/cn.ts`: `--text-subhead`
  (DS §1.9.4; first consumer the `SectionHeader` title); drift ceilings +1
- Modify: `<html lang>` follows the active locale (PD49) in the i18n bootstrap
- Test:
  - render-count tests: crossfade progress causes no per-frame React state; the visualizer stores
    data in refs
  - `MobileBottomNav.test.tsx`, PageHeader and SectionHeader tests, the i18n `lang` test
  - `app/listen/src/app-shell/AppRouter.bundle.test.tsx`: lazy boundaries unchanged

**Steps:**

1. Write failing tests.
2. Implement.
3. Verify: the tests, `BUNDLE`, `VISUAL` (all pages move; re-record intentionally), `TYPES`, `LINT`.
4. Commits:
   - `perf(listen): keep audio and crossfade frames out of React state`
   - `feat(listen): restyle the shell and tab bar in the v3 language`

### Task 4.2: Player bar, fullscreen, extended player and queue (P0 · M)

**Files:**

- Modify: `app/listen/src/components/player/PlayerBar.tsx`, `bar/*`
  - title in display 700; mono time codes written by ref
  - hairline seek that grows on hover; round play disc; ghost icons
  - `QualityBadge` as a mono tag
- Modify: `FullscreenPlayer*.tsx` (title clamp, 44 px seek targets, 64 px disc, text tabs, EQ sheet without glass)
- Modify: `ExtendedPlayer.tsx`, `ExtendedPlayerTabs.tsx` (header `NOW PLAYING · from <source>`; Suggested rows with mono meta from the existing `distance`)
- Modify: `QueuePanel.tsx`, `extended/QueueTab.tsx`, the queue tab in `FullscreenPlayerTabs.tsx` (header with totals; track rows)
- Modify: the 7 catalogs plus `.metadata`: `player.header.*` (`NOW PLAYING · from <source>`) and
  `player.queue.*` (`QUEUE · 24 tracks · 1 h 42 min`, ICU plurals for the track count and the
  duration units); add both prefixes to `app/listen/src/i18n/plural-counts.test.ts`
- Test: `PlayerBar.test.tsx`, `FullscreenPlayer.test.tsx`, `ExtendedPlayer` and queue tests; reduced motion; `plural-counts.test.ts`, `catalogs.test.ts`, `I18N`; `VISUAL` (home-player); `BUNDLE` (PlayerBar is eager)

**Steps:** failing tests first, then implement, then run the tests.

Commit: `feat(listen): restyle the player bar, fullscreen and queue`.

### Task 4.3: EQ live store and EQ glyph (P0 · M)

**Files:**

- Create: `app/listen/src/lib/equalizer-live-store.ts`
  - initialised lazily from `getEqualizerSnapshot()`
  - `publishEqualizerLiveState` deduplicates by value
  - `useEqualizerLiveState` through `useSyncExternalStore`
  - test `equalizer-live-store.test.ts`
- Modify: `app/listen/src/hooks/use-equalizer-runtime.ts` (publishes in `useEffect` the exact gains handed to the engine)
- Modify: the live path of `app/listen/src/hooks/use-equalizer.ts` (Task 0.7): during a drag or
  key repeat it publishes to the live store at most once per animation frame and never touches
  prefs, so the eager `EqGlyph` in the `PlayerBar` follows the drag without per-frame React state,
  bridge traffic or storage I/O (DS §3.8 rule 4)
- Move: `useEqMorph` from `app/shared/ui/domain/player/eq-morph.ts` to `app/shared/ui/lib/use-eq-morph.ts`, and the spring helpers to `app/shared/ui/lib/spring.ts` (tests move with them; `EqBands` imports the new paths). `EqGlyph` imports `use-eq-morph` directly, and `use-eq-morph.ts` re-exports the spring helpers with a relative `export … from`, so the export policy counts both; Task 3.5's `GovernorGauges` later imports `spring.ts` directly.
- Android: the Android parts of this task (published gains equal the native engine gains) are
  built against today's `androidNativeEngine.setEq` path. Smart Mix replaces it with
  `NativeEqController` (one gain set applied to every deck, PD2), so they are re-verified after
  the Smart Mix merge (Task 5.14) unless Smart Mix has merged first.
- Create: `app/listen/src/components/player/EqGlyph.tsx`
  - memoised; uses `@crate/ui/lib/eq-curve` and `@crate/ui/lib/use-eq-morph` (never imports
    `EqBands`)
  - springs at 120/14; first paint is the final state
- Create: `app/listen/src/components/player/EqualizerGlyphButton.tsx` (owns the `aria-label`, e.g. "Equalizer: Smart, Thrash metal, from Metal", and `aria-expanded`)
- Modify: the 7 catalogs plus `.metadata`: `player.equalizer.glyph.*` (mode words and the
  `aria-label` sentence)
- Modify:
  - `bar/PlayerBarDesktopActionButtons.tsx:74` (the `SlidersHorizontal` button);
    `PlayerBarActionIconButton` gains `aria-expanded`
  - `ExtendedPlayerHeader.tsx`: falls back to the icon when the EQ is unavailable
  - `FullscreenPlayerControls.tsx`: 48 px button
- Test:
  - `equalizer-live-store.test.ts`
  - `use-equalizer-runtime.test.tsx`: published gains equal the engine gains
  - `EqGlyph.test.tsx`: label per mode; no rAF under reduced motion; first paint final; a
    60-move drag publishes at most one live-store update per frame and writes no prefs; the `de`
    and `eu` mode labels fit (no overflow class)
  - `catalogs.test.ts`, `I18N`
  - `PlayerBar.test.tsx`, `FullscreenPlayer.test.tsx`
  - `app-shell/AppRouter.bundle.test.tsx`: the eager chunk does not include `EqBands`
  - `VT-UI export-usage-policy.test.ts`
  - `BUNDLE`: less than 2 KB added

**Steps:** failing tests first, then implement, then run the tests.

Commit: `feat(listen): show the live EQ curve as the EQ button glyph`.

### Task 4.4: Hold the last Smart EQ curve while resolving (PD32 / [D29]) `[MAIN]` `[BEHAVIOUR]`

Only if the decision is to hold.

**Files:** `app/listen/src/hooks/use-equalizer-runtime.ts` (`useResolvedEqualizer` keeps the last resolved gains while `status === "loading"`), test `use-equalizer-runtime.test.tsx`.

**During a Smart Mix transition** (two decks, one gain set applied to both sessions by
`NativeEqController` after the Smart Mix merge): hold the outgoing track's gains, applied to both
sessions, until the incoming track resolves; then switch once. Tests: the hold case in
`use-equalizer-runtime.test.tsx` (gains unchanged while the incoming track is `loading`, one switch
when it resolves); after the merge, the same case in Smart Mix's `NativeEqControllerTest`. The
Android part of this task is re-verified after the Smart Mix merge (PD2).

Commit: `fix(eq): keep the last Smart EQ curve while the next track resolves`.

### Task 4.5: EQ panel v3, Smart EQ chain and the shared genre walk (P0 · M)

**Files:**

- Modify:
  - `app/listen/src/components/player/EqualizerPanel.tsx`
  - `EqualizerPanelSections.tsx`: trail as a `Readout`; 21 presets as `CratePill` toggles; chain
    from `chain[]` with applied, shadowed and absent links; shadowed links preview a ghost curve
  - `EqualizerSmartReadout.tsx`
  - `EqualizerAdaptiveReadouts.tsx`: `GenreResolutionChip` becomes the walk
- Modify: `EqualizerPopover.tsx` (`max-h` and `overflow-y-auto`)
- Modify: `app/listen/src/hooks/use-track-genre.ts` (reactive `useApi` instead of a module `Map` cache), `app/listen/src/lib/cache.ts` (`scopesForUrl` for `*/genre`, plus the `genre_taxonomy` scope if PD23 = (b))
- Create: `app/shared/ui/domain/genres/GenreEqWalk.tsx`
  - presentational; copy, links or buttons by props; token utilities only
  - adopted in this PR by Listen (this task) and by Admin `GenreEqInheritancePanel.tsx` (its
    header)
  - test `GenreEqWalk.test.tsx`
- Move: `app/ui/src/lib/motion/scramble.ts` (Task 3.1) → `app/shared/ui/lib/scramble.ts` with the
  motion gate injected; its test moves too. Listen is the second adopter: the EQ trail scrambles
  the current word (420 ms) in `EqualizerPanelSections.tsx`, and Admin's
  `GenreEqInheritancePanel.tsx` (3.7) switches to the shared import in the same change, deleting
  the Admin copy (DS §2.1 rule 2). Task 4.6 reuses it.
- Modify: the 7 Listen catalogs (chain, states and reasons)
- Test:
  - `EqualizerPanel.test.tsx`:
    - chain states;
    - hover preview;
    - keyboard sliders;
    - `Flat · Smart EQ unavailable` with a warn dot;
    - EQ off disables the sliders.
  - `GenreEqWalk.test.tsx`; Admin `GenreEqInheritancePanel.test.tsx`
  - `scramble.test.ts` in `@crate/ui`; the EQ trail scramble is skipped under reduced motion;
    `VT-UI export-usage-policy.test.ts`
  - older server: an `/eq` payload without `chain` or `genrePath` renders the v2 Smart EQ readout
    (no chain, no walk)
  - `catalogs.test.ts`, `I18N`
  - `VISUAL`: the EQ baseline from 0.11 changes
  - `BUNDLE`: the popover chunk stays lazy

**Steps:** failing tests first, then implement, then run the tests.

Commit: `feat(eq): explain the Smart EQ chain and its genre walk`.

### Task 4.6: Stats heatmap band, counters and the Home tile (P0 · M)

**Files:**

- Create: `app/listen/src/components/stats/heatmap-model.ts`, test `heatmap-model.test.ts`
  - `cellLevel`, `nowCell(tz, date)`, `msUntilNextHour(tz, date)`
  - DST in Europe/Madrid, America/St_Johns, Asia/Kathmandu, and an invalid timezone
  - weekday parsing in `en-US`
- Create: `app/listen/src/components/stats/ListeningHeatmap.tsx`
  - variants `band` and `tile`; HTML grid of 168 cells; `::before` opacity, not `color-mix`
  - one `style` per cell (`--stats-level`, `--stats-delay`); peak outline
  - night band from `night_hours`
  - readout without `aria-live` on hover
  - `role="grid"`; each `role="row"` is its own `grid-template-columns: repeat(24, minmax(0,1fr))`
    grid (no subgrid: it needs Safari 16 or Chrome 117, above the iOS 15 and WebView2 111 floors;
    no `display: contents`); roving tabindex; forced colors
- Move: the `.stats-heatmap*` recipe from `app/shared/ui/tokens/recipes.css` (~line 2440) to
  Listen CSS (`app/listen/src/index.css` or a stats stylesheet it imports), then extend it:
  longhand animations behind `@supports`; reduced-motion rules. It is Listen-only until Task 5.12,
  and DS §6.7 keeps visual-specific CSS in the app so Admin does not download it.
- Modify: `app/listen/src/components/stats/StatsHeatmapCard.tsx` (deleted, replaced)
- Modify: `app/listen/src/pages/Stats.tsx`
  - the band at full width
  - `id="listening"` through `StatsReveal`; a hash scroll effect after load
  - `scroll-margin-top`
  - the now outline only on the user's own stats
  - Crate Pulse labelled "listener local time"; when the server sends `hidden_reason:
"few_listeners"` (Task 2.20 hides it below 3 listeners, PD43) the band renders a one-line
    hidden state instead of the zero grid
- Modify: `StatsHeadlineNumbers.tsx` (`StatNumber size="xl"`; the top genre scrambles only when it
  changes, through the shared `@crate/ui/lib/scramble.ts` from 4.5), `CountUpNumber.tsx` (duration prop)
- Modify: `app/listen/src/components/home/HomeReplaySection.tsx`, `app/listen/src/pages/HomeContent.tsx` (Listening DNA tile, desktop only, linking to `/stats#listening`)
- Modify: the 7 catalogs (`stats.heatmap.*`, `stats.headline.*`, `home.sections.listeningDna.*`); add `stats.heatmap.` and `stats.headline.` to `fullyLocalizedStatsPrefixes` in `catalogs.test.ts`
- Test:
  - `heatmap-model.test.ts`
  - `ListeningHeatmap.test.tsx`, with a TS fixture: 168 cells, peak, night band, now only when
    passed, pending skeleton, zero minutes; each row declares its own 24-column grid
  - older server: a heatmap without `night_hours` renders without the night band
  - `Stats` page test: hash scroll
  - `HomePlaybackSections.test.tsx`
  - Crate Pulse renders the `few_listeners` hidden shape (zero cells, `peak: null`) as the hidden
    state, never as an empty grid; the server-side hiding is tested in 2.20
  - the top genre scrambles only on change and not under reduced motion
  - `VISUAL` (stats, home-player), `BUNDLE`, `I18N`

**Steps:** failing tests first, then implement, then run the tests.

Commit: `feat(stats): show listening hours as a full heatmap band`.

### Task 4.7a: Setlist library match backend (P1 · M; PD5, B22) `[BEHAVIOUR]`

**Files:**

- Create: `app/crate/setlist_matching.py`
  - matcher moved from `app/crate/api/browse_artist.py:254-300`
  - hardened `contains` rule: word boundary, at least 4 characters, both directions
- Modify: `app/crate/db/queries/browse_artist_tracks.py` (`get_setlist_match_candidates(artist_names)`: `LOWER(a.artist) = ANY(:names)`, id, uid and title only)
- Modify: `app/crate/db/cache_store.py` (`get_cache_many(keys)`: MGET without L1, plus one `SELECT … key = ANY(:keys)` fallback; a `KEEPTTL` write helper)
- Modify: `app/crate/setlistfm.py`
  - the match is stored at setlist write
  - `mode='rematch'` on `refresh_probable_setlist`: own pending key, `KEEPTTL`, no provider call,
    emits only on a payload change
  - batched reads
  - `shape_probable_setlist`
- Modify:
  - `app/crate/api/me.py:423,1442`: top-level `probable_setlists` map, status, source; the
    per-show `probable_setlist*` fields stay, deprecated, for shipped Capacitor builds until the
    minimum client version in PD §4.18
  - `app/crate/db/home_builder_upcoming_feed.py:42`: same fields; insights get the enriched shows
  - `app/crate/api/browse_artist.py:1335-1357,1920`: setlist-playable reads stored ids with
    `ANY(:ids)`
  - `app/crate/api/enrichment.py`: the stored setlist is overlaid; `total_shows` fixed in 4 places
- Modify: the rematch triggers in `worker_handlers/enrichment.py` (after `process_new_content`, only if an entry exists) and `worker_handlers/management.py:696,736`
- Add a one-off backfill task (rematch all keys)
- Test:
  - `app/tests/test_setlist_matching.py`: cases moved from `test_track_versions.py:212-251`, plus
    the false positives
  - batched candidates (`pg_db`)
  - `test_setlistfm.py`: rematch, `KEEPTTL`, no HTTP call, emit only on change, dedup
  - `get_cache_many` with Redis and the fallback
  - `me.upcoming` and home in a single batched read (assert the call count)
  - setlist-playable from stored ids
  - the per-show fields are still present
  - `test_openapi_contract.py`

**Steps:** failing tests first, then implement, then run the tests.

Commit: `feat(setlists): store which probable setlist songs are in the library`.

Release note: `/api/me/upcoming` carries setlists in a top-level `probable_setlists` map; the
per-show fields are deprecated.

### Task 4.7b: Shared SetlistTicket in Listen and Admin (P1 · M)

**Files:**

- Create: `app/shared/ui/domain/shows/{SetlistTicket,ProbableSetlist}.tsx`, `app/shared/ui/domain/shows/setlist.ts`
  - `setlist.ts` gets explicit `exports` and `publishConfig.exports` entries in
    `app/shared/ui/package.json`
  - tests
- Modify: `app/shared/ui/tokens/typography.css` and `app/shared/ui/lib/cn.ts`:
  `--text-display-entity` (DS §1.9.4; first consumer the ticket artist); drift ceilings +1
- Modify (Listen):
  - `UpcomingShowExpandedView.tsx`: compose the shared ticket; countdown key word (PD51); footer
    `N of M playable`; Play uses the same stored match
  - `components/artist/ArtistSetlistSection.tsx` (modal)
  - Home show prep
- Modify (Admin):
  - `app/ui/src/components/shows/ShowCard.tsx`: the expanded body uses the ticket and measures
    with `ResizeObserver`
  - `app/ui/src/pages/Upcoming.tsx`
  - `app/ui/src/components/artist/ArtistSetlistSection.tsx`: detail slot for frequency columns;
    remove `fuzzyMatchTrack` and the `/track-titles` fetch
- Move: the `.setlist-ticket-*` recipe from `app/listen/src/index.css` (Task 0.9) to
  `app/shared/ui/tokens/recipes.css`, which Admin imports through `@crate/ui/tokens/index.css`
  (DS §4.6); otherwise Admin renders the ticket without notches, perforation or entrance
- Modify: the 7 Listen catalogs
- Test:
  - shared ticket tests: states pending, missing, partial and zero local; `aria-label`
  - Listen and Admin integration tests; Admin asserts the notch class renders with its styles
  - older server: `/api/me/upcoming` without the `probable_setlists` map falls back to the
    per-show fields; with neither, the ticket renders without the setlist
  - `tests/listen-visual/fixtures.ts` gains the `probable_setlists` map; `VISUAL` (radar),
    `BUNDLE`, `I18N`

**Steps:** failing tests first, then implement, then run the tests.

Commit: `feat(setlists): show in-library songs on one shared ticket`.

### Task 4.8a: Mood map backend (P1 · M; B6) `[BEHAVIOUR]`

**Files:**

- Create: `app/crate/moods.py` (`MOOD_PRESETS` moved from `app/crate/api/browse_media.py:1643`, plus `mood_region` and `third_axis`)
- Create: `app/crate/db/jobs/explore_mood_map.py`
  - one `MATERIALIZED` features CTE
  - 9 upserts in one transaction
  - `get_explore_mood_map()` with a single `get_ui_snapshot`
- Modify: `app/crate/db/queries/browse_media_mood.py` (`get_mood_tracks_by_uids`)
- New task type `refresh_explore_mood_map` (fast, `quiet=True`):
  - trailing-edge coalescing (Conventions due set, never a `delay=` message) with
    `MOOD_MAP_WINDOW_SECONDS = 900`, the PD §4.14 minimum: `track.analysis.updated` is emitted per
    track (`db/jobs/analysis_state_events.py`), so a 300 s window would rebuild the full-catalog
    `MATERIALIZED` features CTE over 48K tracks every 5 minutes for days during an analysis
    backfill
  - projector triggers: `track.analysis.updated` with state `done`,
    `global_catalog.reconcile.completed`, `federation.catalog.sync.completed`, and
    `ui.invalidate` on `global_catalog`
  - nightly schedule
  - the handler compares the mood counts and the sample hash with the previous row and broadcasts
    the `explore` scope only when either changed, so an unchanged rebuild does not make every
    Listen client refetch the mood map and the explore page
- Modify:
  - `app/crate/db/cache_invalidation.py`: the `explore` scope
  - `app/crate/api/browse_media.py`: `GET /api/browse/mood-map`; moods and explore-page counts
    from the snapshot; mood playback from pools
  - `app/crate/api/schemas/media.py`
- Test:
  - `app/tests/test_explore_mood_map.py` (new, `pg_db`):
    - counts equal `count_mood_presets`, kept only as a test reference;
    - the bit mask;
    - plotted vs analysed;
    - remote tracks;
    - pool atomicity.
  - a single primary-key read for fresh, stale and missing
  - the projector triggers and the trailing-edge coalescing, using `MOOD_MAP_WINDOW_SECONDS`: a
    burst of `track.analysis.updated` events spread over 30 minutes produces at most two builds
  - an unchanged rebuild broadcasts nothing; a changed count broadcasts `explore` once
  - `test_explore_contracts.py`, `test_openapi_contract.py:1364`, `test_browse_queries.py:1382`

**Steps:** failing tests first, then implement, then run the tests.

Site coupling: `site:src/content/listen/viz.test.ts` reads `MOOD_PRESETS` from `browse_media.py`
and must read `app/crate/moods.py` instead (Phase 7.6).

Commit: `perf(moods): precompute mood counts, map and playback pools`.

Release note: mood playback samples from a precomputed pool of at most 400 tracks instead of a
random order over every match.

### Task 4.8b: MoodMap on Explore (P1 · M)

**Files:**

- Create: `app/listen/src/components/explore/mood-map/MoodMap.tsx`, `mood-map-model.ts`, `use-mood-map-canvas.ts`, `use-mood-map-playback.ts`, tests
  - Canvas 2D
  - sprites from `readCanvasColorToken`, with alpha from parsed rgba
  - `lighter` compositing on the fixed Crate v3 canvas
  - labels nudged so they do not collide
  - points cross-fade on a new version
- Uses `@crate/ui/lib/scramble.ts` (moved to shared in Task 4.5) for the readout word.
- Move: `app/ui/src/lib/motion/use-visible-loop.ts` (Task 3.4) → `app/shared/ui/lib/use-visible-loop.ts`
  if `use-mood-map-canvas.ts` is its first direct Listen importer (the cross-fade loop); Admin
  switches to the shared import and its copy is deleted in the same change.
- Modify:
  - `app/listen/src/pages/ExploreLandingSections.tsx:194`: replace `MoodBrowseSection` and delete
    `MOOD_COLORS`; on an older server (`/api/browse/mood-map` 404) the moods render as a hairline
    list from `/api/browse/moods`
  - `app/listen/src/lib/cache.ts`: an explicit branch placed before the `/api/catalog` and
    `/api/browse` prefix rules maps `/api/browse/mood-map`, `/api/browse/moods` and
    `/api/browse/explore-page` to `explore` only (removed from `library`). By prefix they would
    inherit `library`, which every crate edit, cover, tag change and artist enrich broadcasts
    (`api/cache_events.py` `_INVALIDATION_RULES`), so every crate edit by any user would make each
    Listen client with Explore open refetch them
  - `app/listen/src/pages/Explore.test.tsx`: the `useApi` call count
- Modify: the 7 catalogs (`explore.moods.map.*`)
- Test:
  - model tests: decode, region, label nudge, pick
  - `MoodMap.test.tsx`: warming, empty, error list fallback; offline-only disables Play; a
    separate sr-only node; no canvas in jsdom does not throw; the sprites resolve Crate v3 tokens and rebuild on canvas restoration
  - older server: `/api/browse/mood-map` 404 renders the hairline list
  - `app/listen/src/lib/cache.test.ts`: the three URLs resolve to `explore` and never to `library`
  - a new Explore landing baseline (fixture `/api/browse/mood-map`), `BUNDLE`, `I18N`

**Steps:** failing tests first, then implement, then run the tests.

Commit: `feat(explore): place moods on a real energy and valence map`.

### Task 4.9a: Paths planning in a task and plan metadata (P1 · L; B18) `[BEHAVIOUR]`

**Why the task route comes first:** `POST /api/paths`, `/regenerate` and `/preview` plan
synchronously today (up to 100 KNN queries, graph loads and an LLM call in the request, B18).
Writing `plan_meta` there and promoting Regenerate in 4.9b would grow and expose that path. So the
task route (formerly phase C of 5.11) lands here, before the route map, and the synchronous routes
shrink.

**Files:**

- Create: migration `NNN_music_paths_plan_meta.py` (`music_paths.plan_meta` JSONB plus a summary backfill)
- Create task type `compute_music_path` (fast, priority 0, `notify=False`, registered in the five
  places): plans, refines with the LLM and writes the steps and `plan_meta` in the worker; emits
  `path_planner`, `path_genre_route`, `path_steps` (at most 5 batches) and `path_review` on the task
  channel through `publish_task_signal` (2.17c)
- Modify: `app/crate/api/paths.py` (the Paths router; grep `def .*regenerate`)
  - `POST /api/paths/plan` and `POST /api/paths/{id}/regenerate?mode=task` → 202 with `task_id`,
    deduplicated per path; owner checks through Task 2.2's `require_task_access`
  - the synchronous `POST /api/paths`, `/regenerate` and `/preview` stay for shipped Capacitor
    builds with a deprecation date in the response headers (`Deprecation`, `Sunset`) and the
    release note, a per-user rate limit, and no LLM refinement when called synchronously
- Modify:
  - `app/crate/db/paths_scene.py`: `GENRE_EDGE_COSTS`, bidirectional `genre_hop_edge`
  - `app/crate/db/paths_service_planning.py`, `paths_service_writes.py`: `plan_meta` written only
    inside `compute_music_path`, after LLM refinement; the backfill covers existing paths
  - `app/crate/db/paths_llm_refinement.py`: reports `replaced`
  - `app/crate/db/queries/paths_store_queries.py`, `paths_service_payloads.py`: expose
    `plan_meta`; Camelot per step from `crate/camelot.py`
- Test:
  - `test_paths_scene_engine.py` (costs equal `_genre_neighbors`; bidirectional lookup),
    `test_paths_queries.py` (`pg_db`), `test_paths_llm_refinement.py`, service unit tests,
    `test_crate_schema_definition.py`
  - task route: 202 with a task id; dedup returns the same task; another user gets 404; the task
    emits its events in order and writes `plan_meta`
  - the synchronous routes never call `refine_music_path_with_llm` (patched to raise), carry the
    deprecation headers and return 429 past the rate limit
  - `test_task_runtime_contract.py`, `test_task_queue_routing.py`, `test_openapi_contract.py`

**Steps:** failing tests first, then implement, then run the tests.

Commits:

- `feat(paths): plan paths in a task and stream their steps`
- `feat(paths): store how each path was planned`

Release note: synchronous path planning no longer runs LLM refinement, is rate-limited per user and
is deprecated in favour of the task route.

### Task 4.9b: Route map on Paths, phase A (P1 · L)

**Files:**

- Create: `app/listen/src/components/paths/{PathRouteMap,PathRouteGlyph,PathGenreRail}.tsx`, `path-route-layout.ts`, tests
  - SVG; `pathLength`
  - `:nth-child` delays in a recipe, no inline styles
  - traveller from `currentTrack` when `playSource` is this path
  - roving tabindex
- Modify:
  - `app/listen/src/pages/PathDetail.tsx`
  - `app/listen/src/pages/PathDetailParts.tsx`: remove the rail and its 2 `style={{}}`
  - `app/listen/src/components/paths/PathRow.tsx`
  - `app/listen/src/pages/paths-model.ts`: `path_genre`, `updated_at`, `plan_meta`
  - the Paths create and Regenerate actions use only the task route (4.9a) and follow
    `/api/events/task/{id}`, deduplicating streamed steps by index; on an older server (404 on
    `/api/paths/plan`) they fall back to the synchronous route
- Modify: the 7 catalogs (`paths.route.*`)
- Test:
  - layout: energy interpolation, label density at 8 or fewer, fewer than 2 steps
  - map: Enter calls `playFromStep`, `aria-current`, reduced motion
  - glyph tests
  - Regenerate posts the task route and renders streamed steps once each (duplicates by index
    dropped)
  - older server: `plan_meta` null renders the route without the planner line (`—`); a 404 on the
    task route falls back to the synchronous route
  - a new `/paths/:id` baseline and fixture
  - `GATES` (inline styles drop), `BUNDLE`, `I18N`

**Steps:** failing tests first, then implement, then run the tests.

Commit: `feat(paths): draw each path as a route through its genres`.

### Task 4.10a: Radio explain and bliss map backend (P1 · L)

**Files:**

- Modify: `app/crate/radio_engine.py`
  - per-pick terms captured in `_select_radio_candidate_from_rows`
  - a ring of 60 explanations, penalties rounded to 4 decimals
  - a per-session lock for next and feedback
  - `session_explain()`; feedback returns the target block
- Modify: `app/crate/api/radio.py` (`GET /api/radio/session/{id}`, owner-only)
- Create: `app/crate/db/queries/bliss_map.py`, `app/crate/bliss_map.py`
  - PCA with sign normalisation and Procrustes alignment
  - atomic `{rev}.desktop.bin` and `{rev}.mobile.bin`, keeping 2 revisions
  - always upserts, including `empty`
- New task type `build_bliss_map` (maintenance, `quiet=True`): trailing-edge 6 h trigger from `bliss_daemon` through the Conventions due set (a `delay=` message would be re-dispatched by the 300 s redispatcher and rebuild the PCA map every 5 minutes during a bliss backfill), plus a nightly run
- Create: `app/crate/api/bliss_map.py`
  - registered under the `radio` tag
  - metadata, plus `.bin` through `resolve_confined_path` with ETag, 304, and `private`
    immutable caching
  - the revision is validated
- Create: `app/tests/fixtures/bliss_projection_cases.json` (Python and TS projection parity)
- Test:
  - the terms reproduce the cost for the 3 profiles
  - the `like_blend` curve
  - the explain endpoint reads no DB
  - the ring is bounded; the lock
  - map: deterministic build, stable signs, alignment, file layout, `empty`, warming enqueues,
    caching headers
  - the projection fixture
  - `test_openapi_contract.py`

**Steps:** failing tests first, then implement, then run the tests.

Commit: `feat(radio): explain each radio pick and precompute the sound map`.

### Task 4.10b: Sound map on Radio (P1 · L)

**Files:**

- Create: `app/listen/src/lib/sound-map/{math,projection,cloud,scene-math,radio-fit}.ts` (ports of `site:src/scripts/field/math.ts`, `decodeCloud`, `scene.ts` nearest and segment; projection tested against the shared fixture), tests
- Create: `app/listen/src/components/sound-map/{sound-field,sound-field-2d}.ts`, `SoundMapFigure.tsx`
  - WebGL2 with colours as uniforms from tokens, resolved from the single Crate v3 tokens; handling
    context lost and restored; DPR ≤ 2
  - Canvas 2D fallback
  - dynamic import
  - idle renders one static frame; it orbits only during the reveal or while the user interacts,
    never as a standing loop (DS §3.8 rule 3, PD7)
- Create: `app/listen/src/components/radio/{RadioSessionMap,RadioScorePanel,RadioQueuePanel,RadioFeedbackReadout}.tsx`, `use-radio-session-explain.ts`, tests
- Modify:
  - `app/listen/src/pages/Radio.tsx`; `RadioHero.tsx` replaced; on an older server
    (`/api/bliss/map` 404) the Radio hero renders without the map
  - `RadioSessionStatus.tsx`: from `playSource`
  - `app/listen/src/components/player/RadioFeedback.tsx`: awaits the response
  - `app/listen/src/pages/use-radio-controller.ts`: seed search debounced; `/api/genres` fetched
    once
- Modify: the 7 catalogs. Copy says "Key" (not Camelot) and "vs previous pick", and carries the
  PCA caveat.
- Test:
  - pure math tests: fit, projection parity
  - panels: legacy queue, `global_catalog`, 404 back to idle
  - older server: `/api/bliss/map` 404 renders the hero without the map
  - idle schedules no frame after the first; uniforms resolve from the single Crate v3 tokens on mount/context restoration
  - `TEST_GAP:` for WebGL
  - a `/radio` baseline with the static fallback
  - `BUNDLE`: the renderer in a lazy chunk
  - `I18N`

**Steps:** failing tests first, then implement, then run the tests.

Commit: `feat(radio): show the live session on the library sound map`.

### Task 4.11: Visualizer palette from Crate v3 tokens (PD40 / [D16]; P2 · S)

**Files:** `app/listen/src/components/player/visualizer/{useVisualizerPalette,useVisualizerConfig,visualizer-colors}.ts`
and their tests, settings/catalog consumers identified in 1.13.

Use fixed Crate v3 tokens for product chrome. Data-derived palettes inside the visualizer/artwork
remain content; do not introduce a selectable skin or an album-palette chrome tint option. Task 1.13
retires persisted overrides and theme controls; this later visualizer task must not reintroduce them.
Album artwork remains content. Test the token palette, native/static fallback and any remaining
functional visualizer settings; run `I18N`, focused tests and the single-identity `home-player` baseline.

Proposed commit after approval: `refactor(listen): use Crate v3 tokens in the visualizer`.

### Task 4.12: Static analysed state for audio-reactive visuals on mobile (PD41; P2 · S)

**Files:**

- Modify: the analyser-driven components (`components/player/SpectrumPlayButton.tsx`, the
  visualizer family under `components/player/visualizer/`): on Capacitor (iOS and Android native
  playback, where no Web Audio analyser carries the signal) they render a static state from the
  track's analysis (energy and BPM from `useTrackInfo`) instead of reading an `AnalyserNode`; no
  new endpoint
- Test: `SpectrumPlayButton.test.tsx` and the visualizer tests with the Capacitor platform
  mocked: no `AnalyserNode` is created or read, and the static state renders from the analysis
  fields; web keeps the live analyser

Commit: `feat(listen): show analysed state instead of live audio on mobile`.

### Checkpoint 4

Review the Listen milestone just completed. The joint P0 gate covers shell/player/EQ/Stats plus
existing ticket changes; complete moods, Paths, Radio and other P1/P2 reviews only when those
tasks are assigned. Their list below is not additional scope for the P0 major.

Diego tests on Listen web, Tauri (macOS and Linux), Android native and iOS Capacitor:

- player and EQ (glyph and chain);
- Stats;
- Radar ticket;
- Explore moods;
- Paths;
- Radio.

`BUNDLE` stays at or below the Phase 0 baseline plus the agreed delta. The Linux baselines are
re-recorded and reviewed. On iOS, use the supported minimum 16.4 established by Task 0.13.

---

## Phase 5 — P1/P2 instruments and dependent work

Each task follows the same shape: backend contract first, then the UI, with tests. Contracts and
anatomy are in the cited PD and DS sections.

### Task 5.1: Logs terminal (P1 · M)

PD §4.8 Logs: terminal recipe, chrome row `LOGS · live · 100 lines` with a stream dot, level
filter chips plus search, task-id links, auto-follow that yields to user input, and a worker roster
(seen within 60 s is on).

**Files:**

- Modify: `app/crate/api/admin_metrics.py` (`/api/admin/logs-snapshot`, served stale since
  Task 2.11b): an additive `workers` field read from the `crate:workers` hash and the
  `crate:workers:seen` sorted set of Task 2.15a (`{service, host, queues, last_seen_at}`; no
  `SCAN`, no DB); `api/schemas/` response model
- Modify: `app/ui/src/pages/Logs.tsx`: terminal recipe; `use-auto-follow-scroll` (3.10b), which
  yields to wheel, pointer and key input; level and worker filter chips (`CratePill` toggles) and
  search, in the URL (`?level=&worker=&q=`, 1b.3 helper); task ids link to `/tasks?task=`; the
  roster as hairline rows with `StatusDot` (`on` when seen within 60 s); the existing
  `/api/admin/logs-stream` subscription kept through `use-snapshot-stream` (3.1); no `fresh=1`
  in the loader or the retry
- Test:
  - pytest (`app/tests/test_admin_metrics.py`): `workers` comes from the heartbeat keys, an entry
    older than 90 s is absent, and no DB or `SCAN` call happens; `test_openapi_contract.py`
  - `app/ui/src/pages/Logs.test.tsx` (new): level and worker chips filter the lines; search;
    task-id links; auto-follow pauses on wheel and key input and resumes at the bottom; the roster
    dot states; no request carries `fresh=1`; reduced motion (no smooth scroll)

**Steps:** failing tests first, then implement, then run `PY test_admin_metrics.py test_openapi_contract.py`,
`VT-ADMIN src/pages/Logs.test.tsx`, `TYPES`, `LINT`, `ADMIN-E2E` and `BUNDLE-ADMIN`.

Commits:

- `feat(api): list live workers next to the logs`
- `feat(ui): show logs as a live terminal`

### Task 5.2: Insights snapshot (B5) and page (P1 · M)

**Why the maintenance queue:** the builder runs today's 10+ `COUNT`/`SUM` queries over
`library_tracks` in one transaction (PD §4.7). On the fast queue it would hold a slot that serves
interactive work (covers, artwork, `refresh_admin_surface`), and with no window it could run per
event.

**Files:**

- Create:
  - `app/crate/db/queries/insights_surface.py` (the existing queries as one CTE where they share
    scans)
  - `app/crate/db/insights_surface.py` (`serve_snapshot_or_schedule`, 2.11b): serves
    `ui_snapshots('insights','global')` stale up to 24 h; cold returns the empty shape plus
    `snapshot {version: 0, stale: true, pending: true}` and schedules at once
  - task type `refresh_insights_snapshot`: maintenance queue, deduplicated, `quiet=True`, in
    `RESOURCE_GOVERNED_TASK_TYPES` and the db-heavy set, registered in the five places
  - triggers: a nightly schedule, `process_new_content` completion and analysis backfill
    completion, each through the Conventions due set with a 30-minute trailing window
    (`INSIGHTS_WINDOW_SECONDS = 1800`)
- Modify: `app/crate/api/analytics.py` (`/api/insights` reads the snapshot; the response model
  declares `snapshot`)
- Modify: `app/ui/src/pages/Insights.tsx` (Nivo theme small multiples, `StatStrip` with meters, PD §4.7)
- Test:
  - pytest (`pg_db`) for the builder; the cold shape; the endpoint with the builder patched to
    raise (never builds); a burst of triggers yields one build after 30 minutes; the 900 s
    redispatcher case does not dispatch early (Conventions)
  - `app/tests/test_task_queue_routing.py`: maintenance queue; `test_task_runtime_contract.py`;
    `test_openapi_contract.py`
  - `app/ui/src/pages/Insights.test.tsx` (new, Nivo mocked): each panel state, pending

**Steps:** failing tests first, then implement, then run `PY test_insights_surface.py test_task_queue_routing.py test_task_runtime_contract.py test_openapi_contract.py`, `VT-ADMIN src/pages/Insights.test.tsx`, `TYPES`, `LINT`, `BUNDLE-ADMIN`.

Commits:

- `perf(insights): build insights in a task instead of per request`
- `feat(ui): restyle Insights as small multiples`

### Task 5.3: Event pipeline band (P2 · M; requires 2.10)

**Files:**

- Create: `app/crate/event_pipeline.py` (pure record and redaction)
- Modify:
  - `app/crate/domain_event_relay.py`, `app/crate/projector.py`: an optional `trace=` collector;
    return shapes unchanged
  - `app/crate/projector_daemon.py`: after `XACK`, the record goes to the Redis key
    `crate:runtime:event_pipeline` with a TTL plus a publish, only while
    `admin:live:viewers:pipeline` exists (checked once per second); it is persisted to
    `ops_runtime_state` at most once per 60 s or on a status change; a 15 s heartbeat
  - `app/crate/db/domain_event_outbox.py`: `get_outbox_runtime` counts per status through the
    partial indexes
- Modify: `app/crate/api/admin_ops.py` (`GET /api/admin/event-pipeline`, `ops.health.view`), the `pipeline` live surface
- Create: `app/ui/src/components/ops/event-pipeline/{EventPipelinePanel.tsx,trace-rows.ts}`, tests
- Modify: `app/ui/src/pages/SystemHealth.tsx` (`#event-pipeline` anchor with an explicit `scrollIntoView`)
- Test:
  - `test_domain_event_relay.py`, `test_projector.py`, `test_global_catalog_projector.py`:
    unchanged results, plus the trace
  - `test_projector_daemon.py`
  - status rules: lag and stalled thresholds
  - redaction
  - no DB write per batch while idle; the trace is skipped without viewers
  - Vitest: the panel and trace-rows states

Commit: `feat(ops): trace domain events from outbox to projector`.

### Task 5.4: Redis pair (P2 · M) `[MAIN]` (PD45 only)

`[MAIN]` applies to the PD45 compose change: it ships alone as a small PR to `main` with its
release note (decision register, "Behaviour changes"); the Redis pair itself stays in the v3 work.

**Files:**

- Create: `app/crate/redis_runtime.py` (own short-timeout clients; `pipeline(transaction=False)`, `execute(raise_on_error=False)`)
- Modify:
  - `app/crate/config.py`: `get_broker_redis_url` via `urlsplit`
  - `app/crate/broker.py`
  - `app/crate/worker.py`: a dedicated `redis-sampler` daemon thread (PD §4.8, DS §4.24), started
    only when the service loop runs, like the governor sampler of 2.16, and never a step of the
    serial service loop, where an unreachable durable instance would add timeout latency to every
    iteration next to the 2 s media-worker bridge, the 3 s Jam tick and the 120 s analysis scans.
    ≤ 1 s socket timeouts and `pipeline(transaction=False)`. Every ~15 s while
    `admin:live:viewers:redis` exists, every 300 s otherwise, checking the key once per second;
    the sample lives in `crate:runtime:redis` with a TTL plus a publish, persisted to
    `ops_runtime_state('redis_runtime')` at most once per 60 s
  - `app/crate/db/ops_runtime_views.py`: `get_redis_runtime_state`
- Modify: `app/crate/api/admin_metrics.py` (`GET /api/admin/redis`), the `redis` live surface
- Create: `app/ui/src/components/ops/redis-pair/{RedisPair.tsx,redis-pair-model.ts,use-redis-runtime.ts}`, tests
  - the durable memory meter is `used / maxmemory` and warns at 75 % of `maxmemory` (384 MB in
    both composes), never of the container `mem_limit` (512m base, 384m home): `noeviction`
    rejects writes at `maxmemory`
- Modify: `app/ui/src/pages/SystemHealth.tsx`
- Test:
  - parse and deltas, including resets; `ttl_share`; `maxmemory` 0; CONFIG denied
  - the durable warn threshold is computed from `maxmemory_bytes`, not from a container limit
  - `same_instance`; error classes; no password in the payload
  - broker key names
  - the queue tuple drift test against `TASK_POOL_CONFIG`
  - `test_redis_runtime_roles.py` updated
  - cadence switches with the viewer key (the next sample within about 1 s); no DB write while
    idle; a `--no-service-loop` worker does not sample
  - an instance that hangs (socket patched to block) does not delay the service loop: its
    iteration timing is unchanged while the sampler thread times out and reports
    `available: false`
  - the endpoint; Vitest model and panel

Commits:

- `feat(ops): sample cache and durable Redis for the System page`
- PD45 separately: `chore(compose): leave headroom under the redis memory limit`. The site's drift
  test pins the redis flags in `docker-compose.yaml`; note it in the PR (Task 7.6).

### Task 5.5: Stack map (P1 · L) `[MAIN]` (PD44 only) `[BEHAVIOUR]`

`[MAIN]` applies to the PD44 restart policy: the `api/stack.py` deny list and its tests ship alone
as a small PR to `main` with its release note, before the Stack map (decision register,
"Behaviour changes"); the sampler and the map stay in the v3 work.

**Depends on:** PD54 = [D43] (Task 0.3). The Files below follow the recommendation (a), a thread
in crate-api; with (b) `stack_sampler.py` runs as a daemon thread in crate-worker (service loop
only, single writer) against a read-only docker-socket-proxy service added to the composes, and the
leader lock is dropped. Everything else is the same.

**Files:**

- Modify: `app/crate/docker_ctl.py`
  - `get_container()` gains health, OOM, exit code, RW mount and labels
  - stats through `GET /containers/{id}/stats?stream=false&one-shot=true` (without `one-shot`
    Docker waits for a second CPU sample, about 1–2 s per container)
  - `_request` takes a per-call timeout (2 s for stats; today a fixed 30 s, `docker_ctl.py:17`) and
    returns the status
- Create: `app/crate/stack_sampler.py`
  - runs in a dedicated thread inside crate-api, never as an asyncio task: `docker_ctl._request`
    is synchronous Unix-socket I/O and would block the event loop that serves Admin and the
    Listen fallback
  - leader lock with renewal (pattern of the `api/jam.py` heartbeat lock)
  - a bounded pool (at most 4) for per-container stats, with a total budget below the interval;
    stats are skipped when the budget would be exceeded
  - demand gating through `admin:live:viewers:stack`, the constant from `app/crate/admin_viewers.py`
    used by both sides (the `api/stack.py` read endpoints call `mark_viewer("stack")`, and
    `stack-stream` calls `await amark_viewer("stack")`): full sampling every 10 s while it exists;
    otherwise only the container list every 10 minutes and no stats; the key is checked once per
    second
  - Redis-first like every other runtime sampler: each sample goes to `crate:runtime:stack` with a
    TTL plus a publish; `ui_snapshots('ops:stack','global')` is upserted only when a container's
    state changes or at most once per 60 s, never on every 10 s sample
  - real memory limits come from the sampled containers (`docker-compose.project.yaml` sets
    crate-api 1536m, readplane 256m, postgres 4g, projector 768m); never from the site's `map.ts`
  - `CRATE_STACK_SAMPLER_ENABLED` (off-switch)
- Modify:
  - `app/crate/db/admin_stack_surface.py`: read-only; the GET reads `crate:runtime:stack`, else the
    row; `stack-stream` forwards published payloads verbatim
  - `app/crate/api/stack.py`: PD44 policy by compose label for actions, detail and logs (replaces
    the `librarian-` allowlist); actions stay 200
  - `app/crate/api/schemas/utility.py`: `warming`
- Create: `app/ui/src/components/ops/stack-map/{StackMap,StackNodeDetail}.tsx`, `topology.ts`, `system-map.ts` (port of `site:src/lib/system-map.ts` and its tests), `stack-map-model.ts`, tests
- Create: a Vitest drift test. `topology.ts` services must exist in `docker-compose.yaml`
  (pattern `^  crate-<id>:$`).
- Modify: `app/ui/src/pages/Stack.tsx`, new `Stack.test.tsx`
- Test:
  - stats parsing for cgroup v1 and v2
  - the policy
  - reads never touch Docker
  - lock and demand gating; no stats without viewers; the endpoints and the sampler use the same
    key constant; when the key appears the next full sample follows within about 1 s
  - ten samples with no state change write `ui_snapshots` once (the 60 s floor); a state change
    writes at once; `stack-stream` forwards a published sample without a DB read
  - the sampler is never called on the event loop, and a slow stats call (patched to sleep past
    the timeout) does not delay a concurrent request
  - the budget skips stats when exceeded
  - `TestStackAPI`
  - the boundary test: `db/admin_stack_surface.py` does not import `crate.docker_ctl`
  - Vitest

Commits:

- PD44 separately, first: `fix(stack): deny restarts of core services` (`api/stack.py` policy and
  `TestStackAPI` policy cases).
- `feat(ops): draw the live stack as a system map`.

### Task 5.6: Acquisition lanes on `/download` (P1 · L; B9, B20)

Cover contract (B20; Task 0.4 adds it to PD §4.4). `Download.tsx` today calls Last.fm
`album.getinfo` once per search result from the browser (`loadLastFmAlbumCover`, with the Last.fm
key). Moving that one-to-one into a FastAPI handler would make N synchronous provider calls per
search page on the API threadpool, the V7 violation again, and slow Last.fm responses would starve
the threadpool that also serves Admin and the Listen fallback routes:

```ts
// POST /api/acquisition/covers (library.import.manage or library.tidal.manage)
// body: { items: Array<{ artist: string; album: string }> }   // ≤ 50
// One get_cache_many read (Task 4.7a: Redis MGET, one `key = ANY(:keys)` fallback) of a cover cache
// keyed by normalised (artist, album). Never calls a provider in the request.
interface AcquisitionCoversResponse {
  covers: Record<string, string | null>; // hits only: key → URL, or null for a cached negative
  task_id: string | null; // set when misses were enqueued
}
```

Misses enqueue one deduplicated task `lookup_acquisition_covers` (fast, `quiet=True`, dedup key
from the sorted miss keys) that fetches them in a batch with a 3 s provider timeout per call,
caches positive and negative results with a TTL, and publishes the hits on the task channel through
`publish_task_signal`; the client applies them as they arrive, or simply re-requests.

**Files:**

- Create: `app/crate/acquisition_runtime.py`, an `acquisition-sampler` daemon thread in
  crate-worker (service loop only; never in the serial loop, where a slskd call with a 10 s timeout
  would stall the scheduler and zombie cleanup). slskd and Tidal calls use a 2 s timeout. Cadence:
  - every 2 s only while `admin:live:viewers:acquisition` exists (checked once per second);
  - every 30–60 s while transfers are active and nobody watches, enough to keep
    `ops_runtime_state('acquisition')` and the release lifecycle reconciler current; a Soulseek or
    Tidal backlog lasts hours, and polling slskd every 2 s for nobody breaks the demand-gating
    rule;
  - not at all when idle with no viewers.
    It writes the Tidal and Soulseek queues to `crate:runtime:acquisition` with a TTL plus a
    publish, and persists `ops_runtime_state('acquisition')` only when the lane counts change or at
    most once per 60 s.
- Modify: `app/crate/api/acquisition.py` (the stream and snapshot handlers; grep for the routes)
  - the stream forwards on pubsub, reads in `to_thread`, and calls
    `await amark_viewer("acquisition")` (Task 2.11c) on connect and on each heartbeat
  - search status as a task
  - `POST /api/acquisition/covers` (contract above)
- Create: task type `lookup_acquisition_covers` (registered in the five places) and its handler;
  the cover cache through `db/cache_store.py`
- Modify: `app/ui/src/pages/Download.tsx`: stops reading the Last.fm key and calling Last.fm;
  requests covers for the visible results in one batch
- Create: `app/ui/src/components/acquisition/AcquisitionLanes.tsx` (QueueLanes model, local), tests
- Modify: `Download.tsx` (tabs in the URL, quality chips, tables), new `Download.test.tsx`
- Test:
  - the sampler: no slskd call and no DB write while idle with no transfers; with an active
    transfer and no viewer, at most one slskd call per 30 s; with the viewer key, the 2 s cadence
    and the next sample within about 1 s of the key appearing; a slow slskd marks the lane
    unavailable without blocking; a `--no-service-loop` worker does not sample
  - the stream never builds and never calls the sync Redis client
  - covers: the endpoint makes zero HTTP calls (provider client patched to raise); hits come
    from one batched read; misses enqueue a single deduplicated task; the task caches positive
    and negative results; more than 50 items returns 422
  - `test_openapi_contract.py`, `test_task_runtime_contract.py`, `test_task_queue_routing.py`
  - Vitest: lanes, the covers batch request, no Last.fm URL in `Download.tsx`

Commits:

- `perf(acquisition): sample download queues in a worker`
- `fix(security): look up download covers on the server`
- `feat(ui): show downloads as source lanes`

### Task 5.7a: Imports surface backend (PD16; P1 · M)

**Why:** staged imports run `_handle_import_queue_item` and `_handle_import_queue_all` in
`worker_handlers/acquisition.py` (grep the symbols; about lines 2601 and 2649 after Task 0.1's
rebase). They emit only info events, never call `process_new_content`, and finish with
`start_scan()`. `import_queue_items` has no `task_id` or `last_error` column, so a row cannot be
linked to its task, and the enqueue paths (`api/imports.py`) use `create_task` without dedup.

Contract: PD §4.3's `GET /api/imports/queue` is canonical; this task implements it as written
there (one contract, no second shape here):

- route `GET /api/imports/queue` (`library.import.manage`);
- items carry `discovered_at` and `updated_at`;
- `totals` is `{pending, queued, importing, failed}`;
- order: pending, queued, importing and failed first, then the last 50 imported;
- one CTE over `import_queue_items` by status (`idx_import_queue_items_status_updated`) plus tasks
  by `task_id = ANY(:ids)`; it never walks `/music` or the staging folders.

**Files:**

- Create: migration `NNN_import_queue_task_link.py` and `app/crate/db/schema_sections/acquisition_vNNN.py` (`import_queue_items.task_id`, `last_error`)
- Modify: the enqueue paths in `api/imports.py`: `create_task_dedup(dedup_key="import:{source}:{path}")`
  (`import:all` for import-all), setting `status='queued'` and `task_id` on the row in the same
  transaction; `POST /import` and `/import-all` return `TaskEnqueueResponse {task_id, deduplicated}`
- Modify: `_handle_import_queue_item` emits its real phases through `TaskProgress` and writes
  `importing`, `imported` or `failed` with `last_error`
- Modify: `_handle_import_queue_all` writes the same per-item status and `last_error` for each item
  (PD §4.3), not only one `importing` phase with a count
- Modify: `app/crate/db/import_queue_read_models.py` (the CTE above), the existing
  `/api/imports/*` router (`GET /api/imports/queue`), `app/crate/api/schemas/` (response model)
- Test: `pg_db` tests for the read model (order, the 50-imported cap, `updated_at`, the four
  totals) and the task link; dedup returns the existing task; `import_queue_item` phases and
  `last_error`; `import_queue_all` writes per-item status, including one failed item among
  successes; `test_openapi_contract.py`; `test_crate_schema_definition.py`

Commit: `feat(imports): link staged imports to their tasks and phases`.

### Task 5.7b: `/imports` page

**Files:**

- Create: `app/ui/src/pages/Imports.tsx` (hairline queue; a `StepRail` per import draws only the
  phases the handler actually emits; items without a task show a status dot), `Imports.test.tsx`
- Modify: route and sidebar (02 Imports)

Test: states pending, queued, importing with phase, imported, failed with error; rail stages equal
the emitted phases.

Commit: `feat(ui): add an Imports page for staged imports`.

### Task 5.8: Federation topology (P2 · L; requires 2.1 and 2.4)

**Why the triggers are split:** Task 2.4 stops `federation.stream.*` and the other federation
events from rebuilding ops (B11). `federation.stream.ticket.created` (`api/federation.py`) and
`federation.stream.proxy.completed` (`api/federation_remote.py`) fire for every remote track play,
so routing them to an uncoalesced topology action would bring B11 back on the topology snapshot:
two CTE rebuilds, a `ui_snapshots` upsert and a publish per play, growing with remote playback.

**Files (backend):**

- Create: migration `NNN_federation_catalog_counts.py` (`federation_catalog_cursors.item_count`, `last_delta_count`)
- Create: `app/crate/db/queries/federation_topology.py` (one CTE; effective pairing state derived
  from `expires_at`, since `expire_pairings` is never called; counts read from
  `federation_catalog_cursors`, no catalog-item `COUNT`), `app/crate/db/federation_topology_surface.py`
  (serve stale; cold returns `snapshot {version: 0, stale: true, pending: true}` and schedules once)
- Modify:
  - `app/crate/federation/events.py`: emitters after commit for every federation mutation
    (pairing, grant, peer)
  - `app/crate/projector.py`, the topology projector action (projector due set, Conventions):
    - structural events (pairing, grant, peer, `federation.catalog.sync.completed`,
      `federation.health.polled`) rebuild with trailing-edge coalescing over a 5 s window;
    - `federation.stream.*` and relay events only set `federation-topology:dirty`; it is
      honoured only while `admin:live:viewers:federation` exists (at most one rebuild per 5 s)
      and otherwise waits for the 60 s health-poll floor
  - `_handle_health_poll`: emits `federation.health.polled` (the 60 s floor)
  - `_sync_single_peer_catalog`: writes the counts
- Modify: `app/crate/api/admin_federation.py` (`GET /api/admin/federation/topology`,
  `federation.nodes.view`), `app/crate/api/admin_live.py` (the `federation` surface)

**Files (UI):**

- Create: `app/ui/src/components/federation/{FederationTopology,TopologyInspector}.tsx`, `topology-layout.ts`, `topology-diff.ts`, `use-topology-animation.ts`, tests
- Modify: `app/ui/src/pages/Federation.tsx`
  - tabs in the URL, `?tab=&node=`
  - `StreamsPanel` filtered by node
  - `PanelState` gains Retry and loses its red
- Modify: `app/ui/src/App.bundle.test.tsx` (the Federation route stays lazy)

**Test:**

- `app/tests/test_federation_topology.py` (new, `pg_db`): the CTE; pairing state derived from
  `expires_at`; counts read from `federation_catalog_cursors` with no catalog-item `COUNT`; the
  endpoint with the builder patched to raise (never builds); the cold shape
- `app/tests/test_projector.py`: routing for the new events; N stream events inside the window
  produce one build while a viewer exists; with no viewer, stream events produce no rebuild and
  the next health poll does; structural events coalesce to one build per window
- emitter tests: every federation mutation appends its event only after commit (a rolled-back
  transaction emits nothing)
- `test_openapi_contract.py`, `test_crate_schema_definition.py`
- Vitest: `topology-diff.ts` (no animation without a diff), `topology-layout.ts`, and
  `FederationTopology.test.tsx` (at most 9 peers plus `+N`, pending first, reduced motion,
  keyboard path, figure sentence)

**Steps:**

1. Failing tests (backend), implement, then run `PY test_federation_topology.py test_projector.py test_openapi_contract.py test_crate_schema_definition.py`.
2. Commit the backend half.
3. Failing tests (UI), implement, then run `VT-ADMIN src/components/federation/`, `TYPES`, `LINT`,
   `ADMIN-E2E` (a Federation capture) and `BUNDLE-ADMIN`.
4. Commit the UI half.

Commits:

- `feat(federation): build the topology snapshot from federation events`
- `feat(federation): show peers and relays as a live topology`

### Task 5.9: Devices in Listen Settings (P2 · M; PD38)

PD38 (decided 2026-10-15): build Devices in v3 even though Crate Connect is off in production;
it stays invisible until `VITE_CRATE_CONNECT_FEATURE_ENABLED` is on. "Review Crate Connect" is the
next initiative after v3.

**Files:**

- Modify: `app/crate/api/connect_ws.py` (B21: heartbeat refreshes presence and hub TTLs; disconnect touches `last_seen_at`)
- Modify: `app/crate/db/repositories/playback_state.py:228` (one LEFT JOIN with a raw checkpoint), `app/crate/db/cache_store.py` (`get_cache_many` from 4.7a)
- Modify: `app/listen/src/lib/listen-device.ts:231` (`form_factor`, `os`, `display_mode`), `contexts/player-context.ts` (WS `status`)
- Create: `app/listen/src/components/devices/{DeviceGlyph,DeviceConstellation,DeviceProgressLine}.tsx`, `device-family.ts`, `device-progress.ts`, `use-device-roster.ts`, tests
- Modify:
  - `app/listen/src/components/settings/ConnectDevicesSection.tsx`, moved to a top-level Devices
    section in `pages/Settings.tsx`
  - `PlaybackTargetPopover.tsx`, `PlaybackTargetIcon.tsx`: mini glyphs
- Modify: the 7 catalogs plus `.metadata`: `settings.devices.*` (`DEVICES · 2 online · 1 recent`,
  `stopped at 2:14 · 3 h ago`, `Reconnecting`), with ICU plurals for the counts; add the prefix to
  `plural-counts.test.ts`
- Test:
  - `test_playback_state.py`, `test_connect_ws_v2.py`
  - Vitest: roster merge, family table, projection, reduced motion
  - older server: a roster without `checkpoint` renders devices without the progress line
  - `AccountSection.test.tsx`
  - settings baselines with the Connect flag
  - `plural-counts.test.ts`, `catalogs.test.ts`, `I18N`

Commit: `feat(listen): show your devices and the shared playback position`.

### Task 5.10: Listen genre wheel, phase 2 (PD20)

**Files:**

- Move: `app/ui/src/components/genres/GenreWheel.tsx` → `app/shared/ui/domain/genres/GenreWheel.tsx`; `app/ui/src/lib/genre-wheel-math.ts` → `app/shared/ui/lib/genre-wheel-math.ts` (deleting the Admin copies in the same PR); `genre-wheel-math.test.ts` moves too and keeps reading `app/tests/fixtures/genre_eq_path_cases.json`
- Create:
  - builder subject `crate-core` (`ListenGenreWheelPayload`, PD §4.6.3 after Task 0.4), built in
    the same `refresh_genre_wheel_snapshot` run as `local`: core nodes only; structure and `eq.*`
    from the live, override-aware runtime graph (local overrides of 2.18d and suppressed edges
    applied, as `/eq` resolves them), so the Listen wheel, the genre-page "EQ inherited from …"
    line and Smart EQ's `genrePath` agree for the same track; still no unmapped tags, provenance,
    suppression flags or custom gains
  - triggers: the same membership triggers as 2.18b, curator overrides (they change `eq.*`), the
    core release seed when its digest changes, and the global catalog serving mode flipping
  - a Listen invalidation scope `genre_wheel` (`app/crate/db/cache_invalidation.py`), broadcast by
    the handler only when the `crate-core` row's version or digest changes
  - Go route `/api/catalog/genre-wheel` in `app/readplane/internal/routes/server.go`, with table
    tests and the contract smoke
  - FastAPI fallback
- Modify: `app/listen/src/pages/Explore.tsx` (desktop wheel at 1000 px and wider), `components/explore/GenreDetailHero.tsx` (locator), `EqualizerSmartReadout.tsx` ("Inherited from" links)
- Modify: `app/listen/src/lib/cache.ts`: an explicit `scopesForUrl` branch, placed before the
  `/api/catalog` and `/api/browse` prefix rules, maps `/api/catalog/genre-wheel` to `genre_wheel`
  only. By prefix it would inherit `library`, which every crate edit, cover, tag change and artist
  enrich broadcasts, and each Listen client with Explore open would refetch the whole wheel
- Test:
  - both apps' wheel tests
  - pytest: the `crate-core` subject carries no overlay, provenance, suppression or custom-gain
    fields; each trigger schedules one build; for an overridden core node, the Listen row's
    `eq.path` equals the `/eq` `genrePath` of a track in that genre; an unchanged rebuild
    broadcasts no `genre_wheel` invalidation
  - `app/listen/src/lib/cache.test.ts`: `/api/catalog/genre-wheel` resolves to `genre_wheel` and
    never to `library`
  - the Go family-map drift test (G10)
  - older server: `/api/catalog/genre-wheel` 404 keeps the v2 Explore genre list
  - Listen baseline, `BUNDLE`, `I18N`

Commit: `feat(explore): browse genres on the taxonomy wheel`.

### Task 5.11: Paths phase B (P1 · L)

Phase C (planning in a task, B18) moved into Task 4.9a, ahead of the route map.

**Files:**

- `app/listen/src/components/paths/PathRouteMap.tsx`: the route drawn over `SoundMapFigure`
  (4.10b), with steps projected from `bliss_vector` and the phase A layout as the fallback (no
  bliss map, older server, or WebGL unavailable)
- Test: projection of steps through the shared fixture of 4.10a; the fallback renders phase A;
  reduced motion; `BUNDLE` (the renderer stays lazy)

Commit: `feat(paths): draw paths over the sound map`.

### Task 5.12: Admin quiet-hours heatmap, heatmap phase 2

**Files:**

- Modify: the instance builder (`heatmap_utc` in the same CTE pass; below 3 listeners it gets the
  same hidden shape as Task 2.20: a zero grid, `peak: null`, `hidden_reason: "few_listeners"`)
- Move: `ListeningHeatmap` and its model → `app/shared/ui/domain/stats/` (explicit `.ts` exports); update the Listen and Admin chart exceptions in the AGENTS files in the same PR
- Move: the `.stats-heatmap*` recipe from Listen CSS (Task 4.6) back to
  `app/shared/ui/tokens/recipes.css`, now that both apps render it
- Modify: `app/ui/src/pages/Settings.tsx` (`DownloadWindowCard`: UTC grid, window band, "Use quietest window", which updates local state and runs the existing PUT; with `hidden_reason` the grid shows the hidden state and the action is disabled with the reason)
- Test:
  - pytest (`test_instance_stats_dashboard_surface.py`): `heatmap_utc` has 168 cells built in the
    same pass; with 2 listeners it carries the hidden shape, with 3 the real grid
  - Vitest: the quietest-window search (ties, wrap-around midnight, window length), "Use quietest
    window" updates local state and sends the existing PUT once, and is disabled with the hidden
    shape
  - the moved `ListeningHeatmap` tests pass in `@crate/ui`; Listen Stats tests unchanged;
    `export-usage-policy.test.ts`
  - `VISUAL` (stats), `BUNDLE`, `ADMIN-E2E`

**Steps:** failing tests first, then implement, then run the tests.

Commit: `feat(ui): pick the download window from real listening hours`.

### Task 5.13: Mix strip, phase A (web and desktop; P2 · L)

Not blocked: built from client data only.

**Files:**

- Create: `app/listen/src/components/player/mix/{TransitionStrip,TransitionInstrument}.tsx`, `mix-model.ts`, `mix-math.ts` (Gapless-5 `sqrtPower` and the Android `equalPower`), `transition-clock.ts`
- Modify: `contexts/use-player-engine-callbacks.ts` (clear `crossfadeTransition` on prev, jump and seek; freeze the playhead while paused via a ref)
- Mount points:
  - `extended/QueueTab.tsx`
  - a memoised prop-less island in `FullscreenPlayerTabs.tsx`
  - compact in `QueuePanel.tsx`, desktop only
- Modify: the 7 catalogs plus `.metadata`: `player.mix.*` (mode words and the reason strings)
- Test:
  - laws pinned (0.707 crossing)
  - the live edge uses the transition ids
  - Vitest copy honesty: per-locale patterns forbid beatmatch, sync, lock, handoff and automix in
    all 7 catalogs
  - `catalogs.test.ts`, `I18N`

Commit: `feat(listen): show the next crossfade in the queue`.

### Task 5.14: Smart Mix-dependent follow-ons

**Integration note:** the current protocol merges Smart Mix before v3 rebase. The merge rules below
record the expected overlap, not instructions to delay its independent merge until v3 tasks exist.
After rebase, mark already-satisfied prerequisites from evidence and adapt 2.9b/2.13 to the actual
Camelot and migration state. No duplicate module or unnecessary migration rewrite.

Follow-on implementation starts only after Smart Mix is on `main` and integrated into v3.
Migration numbering follows the actual merged head: `main` is canonical. The original six-revision
renumber/stamp recipe is conditional history; do not apply it if the Smart Mix merge already settled
those numbers. Any required stamp/deployment operation remains separately approved.

Merge rules for the Smart Mix merge, whichever side lands second:

- Listen catalogs: merge keys by hand; never hand-merge `app/listen/src/i18n/catalogs/.metadata/*.json`,
  regenerate it with `(cd app/listen && node scripts/i18n-check.mjs --write-metadata)`.
- Camelot: reconcile the actual integrated mapping with 2.9b; maintain one implementation and
  move/retarget imports only where still required. Do not require a nonexistent pre-merge v3 module.
- Refresh the `browse_media.py`, `actors.py`, `worker.py` and `resource_governor.py` line
  references in this plan's open tasks after the merge.
- Android EQ: re-verify the Android parts of Tasks 4.3 and 4.4 on `NativeEqController` (published
  gains equal the gains applied to every deck; the transition hold of 4.4 applies one gain set to
  both sessions), and add 4.4's hold case to Smart Mix's `NativeEqControllerTest`. Repeat
  Checkpoint 0's Android EQ review on a device.

1. **Mix strip phase B.** Android plans are published from `installTransitionPlans`, with the
   clock from `resolveNativeCrossfadeTransition`. `includeProfiles` is behind a server capability,
   because the request model is `extra='forbid'`. Tests include an old-server compatibility case.
2. **Access tokens.** Covers:

   - `app/listen/src/components/settings/access-tokens/*`;
   - `GET /api/auth/access-tokens/policy`, with route metadata defined after
     `_is_vdj_access_token_request`;
   - `last_used_at` touched only on allowed requests.

   Tests include the parametrised scope × route table.

3. **Smart Mix coverage, units and settings.** The site's Analysis chapter sells "Backfills you
   control": the Smart Mix profile backfill can be started, paused, resumed and cancelled
   (`sm:app/crate/api/smart_mix_admin.py`: `GET /api/admin/smart-mix/status`, `POST /backfill`,
   `/backfill/pause`, `/backfill/resume`, `/backfill/cancel`; `SmartMixCoverage.tsx` with
   `idle | running | paused`).

   - Files: `app/ui/src/components/SmartMixCoverage.tsx` (from `sm:`) restyled as a row of the
     3.9b Coverage panel on `app/ui/src/pages/Analysis.tsx`:

     - the stacked hairline bar reads counters added to the 120 s `analysis_status` block (never
       counted in a request);
     - campaign state as `StatusDot` plus the word `idle`, `running` or `paused`;
     - Start, Pause and Resume as `CratePill` action variants; Cancel through `ConfirmDialog` with
       a consequence line;
     - campaign state from `GET /api/admin/smart-mix/status`, refetched on load and on the
       backfill task's `task_done` (no new stream, no polling loop).

     LUFS and loudness units per PD25 in `@crate/ui/domain/analysis/TrackReadout.tsx` and Listen
     `InfoTabReadout.tsx`; `app/listen/src/components/settings/SmartMixSettings.tsx` (from `sm:`)
     on `InstrumentPanel` and the Phase 1b form controls.

   - Tests: pytest for the new counters in the 120 s block (`pg_db`); `AnalysisStatusResponse`
     declares them; Vitest for the coverage row in each state (idle shows Start, running shows
     Pause, paused shows Resume; Cancel asks first and posts only after confirmation; `task_done`
     refetches the status once) and the unit labels in both apps; `SmartMixSettings` render test;
     `I18N` for any new unit strings; settings baselines.

4. **Later: `rms_envelope` lanes.**
   - Files: migration `NNN_track_rms_envelope.py` (nullable column), a throttled
     `backfill_track_rms_envelope` task (`notify=False`, maintenance queue, governed), the mix
     strip lanes in `app/listen/src/components/player/mix/TransitionInstrument.tsx`.
   - Tests: the backfill respects its batch size and the governor; the lanes render without the
     envelope (older server or not yet backfilled); `test_crate_schema_definition.py`.

Commit messages follow the same pattern, e.g. `feat(listen): explain access token reach`.

### Checkpoint 5

Diego reviews System (gauges, pipeline, Redis), Stack, Logs, Download, Imports and Federation, then
Listen Devices and the mix strip.

---

## Phase 6 — Coverage screens (surfaces with no site visual)

Track A restyles using the recipes in DS §5 and coverage.md §2, on top of the shared layer from
Phase 1b (this phase depends on it). Rules:

- one screen per commit, behaviour identical;
- a page test for every Admin page that has none today;
- Listen baselines re-recorded per screen;
- no new primitives, except moving an existing Admin-local component into `@crate/ui` when a
  Listen screen in this phase adopts it (6.14, 6.15), deleting the Admin copy in the same change.

| Task | Surface (coverage id)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Files                                                                                                                                                                                                     | Tests                                                                                | Commit                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| 6.1  | Admin Browse (A4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `app/ui/src/pages/Browse.tsx`                                                                                                                                                                             | `Browse.test.tsx`                                                                    | `feat(ui): restyle Browse as a media grid`                            |
| 6.2  | Admin Artist residue (A5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `pages/Artist.tsx`, `components/artist/*` (tabs in `?tab=`, `ArtistNetworkGraph` retinted by tokens)                                                                                                      | `Artist.test.tsx`                                                                    | `feat(ui): restyle the artist page`                                   |
| 6.3  | Admin Album residue (A6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `pages/Album.tsx`, `TrackTable.tsx`, `TagEditor`, `MatchCard`                                                                                                                                             | `Album.test.tsx`                                                                     | `feat(ui): restyle the album page`                                    |
| 6.4  | Timeline (A14), Trash (A7: `StatStrip` of files and size plus paginated rows, read from the 2.17e index), Contributions                                                                                                                                                                                                                                                                                                                                                                                                 | `pages/Timeline.tsx`, `pages/Trash.tsx`, `pages/Contributions.tsx`                                                                                                                                        | page tests; Trash paginates and never triggers a disk walk                           | `feat(ui): restyle timeline, trash and contributions`                 |
| 6.5  | Upcoming calendar (A9; `source` per show on `/api/upcoming`, PD §4.4), Bandcamp (A10), Discover (A11, after B5)                                                                                                                                                                                                                                                                                                                                                                                                         | `api/upcoming` router and schema (additive `source`), `pages/Upcoming.tsx`, `pages/Bandcamp.tsx`, `pages/Discover.tsx`                                                                                    | pytest for `source` plus `test_openapi_contract.py`; page tests                      | one commit per page                                                   |
| 6.6  | Users (A18; B17 presence rewrite first), Roles (A19)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `db/queries/auth_presence.py:48-82` (`LATERAL` top-1, one `MGET`), `pages/Users.tsx`, `pages/Roles.tsx`                                                                                                   | pytest plus `EXPLAIN`; page tests                                                    | `perf(users): find each user's last play with one lateral` + restyles |
| 6.7  | Global catalog (A24; B17 status snapshot at reconcile completion)                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `db/queries/admin_global_catalog.py`, reconcile handler, `pages/GlobalCatalog.tsx`                                                                                                                        | pytest, page test                                                                    | `perf(catalog): write global catalog status at reconcile end`         |
| 6.8  | Playlists and editor (A20), Translations (A21)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `pages/Playlists*.tsx`, `pages/I18nReview.tsx`                                                                                                                                                            | page tests                                                                           | per page                                                              |
| 6.9  | Admin Settings (A22): section nav in `?section=`; shared primitives replace the local `Section`/`StatTile`/`PanelCard`/`StatusDot`; schedules with an additive `last_runs` read                                                                                                                                                                                                                                                                                                                                         | `pages/Settings.tsx`, `api/settings.py`                                                                                                                                                                   | pytest for `last_runs`; `Settings.test.tsx`                                          | `feat(ui): restyle Admin settings with live schedules`                |
| 6.10 | Federation tabs (A23), Login/Setup (A3, setup step rail following the real pipeline)                                                                                                                                                                                                                                                                                                                                                                                                                                    | `pages/federation/*`, `pages/Login.tsx`, `pages/Setup.tsx`                                                                                                                                                | page tests                                                                           | per page                                                              |
| 6.11 | Genres residue (A25): tree as hairlines, grid as `GenrePill`s                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `components/genres/GenreTaxonomyTree.tsx`                                                                                                                                                                 | tree test                                                                            | `feat(ui): restyle the genre tree and grid`                           |
| 6.12 | Listen Home residue (L11), Explore residue (L12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `pages/HomeContent.tsx`, `components/home/*`, `pages/ExploreLandingSections.tsx`                                                                                                                          | tests, baselines                                                                     | per screen                                                            |
| 6.13 | Listen Search (L13), Artist (L14), Album (L15)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `pages/Search*.tsx`, `pages/Artist*.tsx`, `pages/Album.tsx`                                                                                                                                               | tests, baselines (artist ×4)                                                         | per screen                                                            |
| 6.14 | Listen Library (L16), Crates (L17), Playlists (L18). Library renders a `StatStrip` (PD §4.20): move `app/ui/src/components/admin/StatStrip.tsx` to `app/shared/ui/primitives/StatStrip.tsx` with token-only class names, switch Admin to it and delete the Admin copy                                                                                                                                                                                                                                                   | `pages/Library*.tsx`, `pages/Crate*.tsx`, `pages/Playlist*.tsx`, the `StatStrip` move                                                                                                                     | tests, baselines; `StatStrip.test.tsx` in `@crate/ui`; `export-usage-policy.test.ts` | per screen; `refactor(ui): share StatStrip with Listen`               |
| 6.15 | Listen Settings residue (L21), Social (L22, `StatStrip` from 6.14), Bandcamp (L23), Upload (L24: after upload, a step rail of the returned `library_upload` task's own phases emitted through `TaskProgress`, preparing → importing → syncing, drawn only as emitted (PD §4.22); move `app/ui/src/components/admin/StepRail.tsx` to `app/shared/ui/domain/tasks/StepRail.tsx`, the one destination named by PD §3.1.4 and DS §2.5, Admin switched and its copy deleted), Offline library (L25), Auth (L26), Share (L27) | the corresponding pages, the `StepRail` move                                                                                                                                                              | tests, settings baselines; `StepRail.test.tsx` in `@crate/ui`                        | per screen; `refactor(ui): share StepRail with Listen`                |
| 6.16 | Listen Stats residue and Digging (L19), Radar residue (L20), Radio and Paths residue (L28), Lyrics (L8), Visualizer family (L9), Resume and sleep timer (L10), Tauri chrome (L3: `LinuxWindowTitlebar.tsx` → `@crate/ui/icons`)                                                                                                                                                                                                                                                                                         | the corresponding files                                                                                                                                                                                   | tests, baselines                                                                     | per screen                                                            |
| 6.17 | Cleanup (PD47, PD50)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | remove `SpectrumRibbonCanvas`; unused Nivo packages (Admin bump, chord, geo, heatmap if unused, network; Listen core and line), `leaflet` in Listen, `gl-matrix` in Admin; `animate-spin` outside buttons | `TYPES`, builds, `BUNDLE`                                                            | `chore: remove unused visual dependencies`                            |

Mobile, i18n and reduced-motion rules apply to every row.

### Checkpoint 6

Diego walks every Admin route and every Listen route on desktop and on a phone, against the site
side by side.

---

## Phase 7 — QA and release gates

Apply the following gates to the joint P0 scope before the major. Examples of P1/P2 instruments
below receive these same checks only in their later assigned milestones; they do not expand P0.
Internal reviews record partial results without claiming the final gate passed.

### Task 7.1: Full CI on each release

Run on the joint P0 release candidate and the appropriate internal integration checks, all green
before publication; separately assigned R0 releases retain their own approved scope:

- `TYPES`, `LINT`, `GATES`, `I18N`, `BUNDLE`, `BUNDLE-ADMIN`;
- Vitest for all packages; `VISUAL` (Linux amd64, in the pinned image); `APPEARANCE`; `ADMIN-E2E`
  with the Admin captures;
- `PY-ALL`, `GO`, `GO-SMOKE`.

Record both bundle numbers in the PR.

### Task 7.2: Accessibility pass

- Run the `web-design-guidelines` review on every v3 instrument and page.
- Keyboard-only walkthrough of the wheel, lanes, health rows, readout chips, ticket, mood labels,
  route map and devices.
- VoiceOver on macOS and iOS, TalkBack on Android: figure sentences and live regions must stay
  quiet on hover.
- `forced-colors` emulation in Chromium for every instrument.
- Fix anything found and commit `fix(a11y): ...` per finding.

### Task 7.3: Runtime matrix and reduced motion

Matrix: web Chromium/Firefox/Safari; Tauri on macOS, Windows (WebView2 111) and Linux (WebKitGTK
2.40, in the pinned runtime of Task 0.15, or the symbol check plus CSS feature audit if 0.15
downgraded the gate); iOS Capacitor on the oldest supported version (16.4, the deployment target
since Task 0.13); a mid-range Android device. Visual target: the single Crate v3 identity,
including startup migration from legacy visual preferences (1.13); no variant matrix.

At internal milestones, test the affected runtimes and record what remains pending. The joint
major changes Listen and `@crate/ui`, so the full matrix is required before release; an internal
Admin-only review is not a substitute. Runtime-gate effort remains a provisional estimate to
refresh after integration, not an accepted schedule.

For each runtime, check:

- reduced motion via OS settings and Listen `data-crate-motion`;
- `linear()` fallbacks; masks with `-webkit-mask`;
- WebGL point counts (6K on mobile; lower to ~4K when `deviceMemory ≤ 4`);
- background tabs: loops stop; on Tauri, background throttling is disabled.

Record the results in the PR.

### Task 7.4: Performance verification on production data

Read-only, with Diego's approval:

- `make pg-perf-snapshot` before and after;
- `EXPLAIN (ANALYZE, BUFFERS)` for every new CTE;
- projector lag and CPU over 24 h;
- the number of SSE connections per Admin tab (expected: ops-stream, notifications and one live
  stream);
- API p95 on `/api/tracks/*/eq` before and after 2.19;
- idle load with no Admin tab open, and again with only a hidden Admin tab and with an idle
  Dashboard open: `ops_runtime_state` upserts per hour, sampler cadences (expected: the slow
  cadences, and no `admin:live:viewers:*` key after 60 s), `refresh_*` task count per hour,
  `process_new_content` runs per hour against the Task 2.10 baseline, and Telegram messages
  (expected: none for quiet types);
- during an analysis or bliss backfill: mood map, insights and bliss map builds per hour
  (expected: at most one per window, never one per 5 minutes).

Any regression blocks the release.

### Task 7.5: Final visual baselines

Re-record every Listen baseline from the final single-identity Crate v3 release candidate through
the approved Linux amd64 `update-listen-visual` job; review all diffs. Add the small Admin set and
the final site/docs screenshots and screencast. Remove retired variant fixtures in 1.13; no
instance domain may appear in recorded assets.

Commit: `test(listen): re-record visual baselines for v3`.

### Task 7.6: Site drift coupling

Do this if `feat/website` has merged first; otherwise the website PR does it. Update in `site:`:

- `src/content/admin/viz.test.ts`: read labels and descriptions from `repair_catalog.py`;
  `MOOD_PRESETS` path; task pool count; migrations count;
- `src/content/listen/viz.test.ts`: `app/crate/moods.py`; if it parses the Paths costs from
  `_genre_neighbors`, point it at `GENRE_EDGE_COSTS` (4.9a);
- the redis flags in `docker-compose.yaml` (PD45 lowers `crate-redis` `maxmemory`, Task 5.4); the
  test pins the redis-server flags (`--maxmemory`, the policy) from `content/architecture/viz.ts`,
  not the container `mem_limit`;
- `src/data/scale.json`: regenerate with `npm run build --prefix app/web`.

Fix the site copy the product contradicts:

- Radio score copy (PD34): "Camelot 0.05" → "Key 0.05" (`content/listen/en.ts:75`); the weights
  themselves are correct for discovery radio;
- the Stack map memory limits, which production sets in `docker-compose.project.yaml`: crate-api
  1536m (site 768 MB), readplane 256m (site 128 MB), postgres 4g (site 1 GB), projector 768m
  (site 512 MB). `map.ts` memory figures are untested. `redis-durable` is consistent: `map.ts`
  shows the 512 MB container `mem_limit` of `docker-compose.yaml` and `viz.ts` the
  `--maxmemory 384mb` flag (both composes); the Paths costs (1.0/1.6/2.5) and `NIGHT_HOURS` also
  match the product;
- relation count (4);
- the governor thresholds copy, per the PD33 decision.

Record in the PR the site SHA the drift tests were checked against (pinned `258bbaee`, or the SHA
of the latest re-sync step).

Commit: `test(web): follow v3 source changes in the drift tests`.

### Task 7.7: Release

Runs for the jointly approved P0 `v3.0.0` release after all internal milestones. Assigned R0
operational releases use their own approved scope and isolated rollout; no intermediate product
milestone publishes Listen/Admin/site/docs independently.

1. Release notes: every `[BEHAVIOUR]` item in the release and every matching PD §3.4.2 line; the
   API permission changes (2.2, 2.9); the count definition change (PD21); the iOS target (0.13);
   the P0 coverage boundary and single-identity preference migration (Rollout).
2. Mobile release gates: for a release that changes Listen or `@crate/ui`, satisfy
   `docs/technical/listen-mobile-release-gates.md` and record the devices used in
   `docs/technical/listen-mobile-device-matrix.md`. The tag always builds Android and iOS, but an
   Admin-only release changes nothing those artefacts contain, so its mobile gate is the
   automated build only and the release note says the mobile apps are unchanged.
3. Tag the release (annotated) on the `main` commit, which runs the Desktop, Android and iOS
   builds.
4. `make deploy-preflight VERSION=<sha>` then `make deploy VERSION=<sha>`.
5. Smoke on production:
   - the Admin and Listen surfaces in the release;
   - Listen on web and a phone;
   - `XINFO GROUPS` lag.

### Task 7.8: Technical docs

**Files:** `docs/technical/02-backend-api-and-data.md` (new endpoints, the live stream, viewer
keys and the async marking helper, deprecated `health-snapshot`, `health-stream` and synchronous
Paths routes), `03-worker-tasks-and-background-services.md` (new task types, `notify`/`quiet`,
samplers and writers, trailing-edge coalescing through the due set and why `delay=` is not used,
the projector side-effects switch, the migration renumbering script), `08-frontends-admin-and-listen.md`
(instrument conventions, `AdminLiveProvider`, the shared layer),
`listen-design-system-visual-qa.md` (Linux-only baselines, the container, the update job,
single-identity captures and the preference migration).

Verify: `node scripts/check-docs.mjs`. Commit: `docs(technical): document the v3 contracts and
conventions`. Lands with each internal milestone's review, or at the latest before `v3.0.0`.

### Task 7.9: Review of the bundle and visual checks

The Admin bundle ceiling exists from Task 0.12 and the Admin captures from Task 0.11.

1. Review the Admin ceiling's history (each Phase 3 and 5 PR recorded its delta) and lower it to
   the measured value plus the margin if instruments came in under budget.
2. Revisit PD48/[D25] and DS §6.7 now that the instruments exist: confirm the screenshot set
   (Listen Linux baselines, the Admin captures of 0.11 plus one per P0 page) and that
   visual-specific CSS lives in the apps; record the outcome in both registers.

Commit: `ci(ui): review the Admin bundle ceiling after the v3 instruments`.

---

## Rollout and release strategy

**Integration and publication are separate.** Task groups below are internal milestones with
review checkpoints, not permission to publish intermediate UI releases. Listen, Admin, site and
docs ship together once as the v3 major. The existing P0 boundary is retained: complete Genres,
player/EQ, Ops, Health and Stats plus their foundations and release gates. P1/P2 and Phase 6
coverage follow later unless Diego explicitly changes scope. Theme-runtime retirement 1.13 is a
foundation prerequisite for this major, not an expansion of the instrument scope.

**Branches and PRs:**

1. Smart Mix merges to `main` under its own assignment. The integrator then rebases
   `feat/crate_v3` onto that result, with approval and coordination of any published history.
   Reconcile migrations, Camelot, native EQ and catalogs before applying stale task recipes.
2. Integrate `feat/website` (site `app/web`, docs `app/docs`) into `feat/crate_v3`. Keep source pin
   `258bbaee` until a resync is reviewed and recorded. The final site assets show the real v3 UI.
3. Keep product changes and reviewed task diffs on `feat/crate_v3` through all P0 milestones.
   Foundation is internal; it neither publishes `v2.8.0` nor retires the branch. Integrate agent work
   through the single integrator, with verification after integration and no unsolicited commits.
4. R0 2A/2B and 2.9b remain independent `[MAIN]` work only when Diego assigns it. Backend fixes
   can use their own small PRs/releases after explicit approval. Preserve the isolated 2.10
   deployment and observation, and 2.11a–c's independent observation; do not bury these operational
   changes in the joint UI rollout. Absorb their actual `main` result through coordinated updates.
5. `[BEHAVIOUR]` changes remain separately reviewable with tests and release-note entries. An own
   PR requirement does not authorise merging, publishing or deploying ahead of the assigned gate.
   No push, PR, tag, deploy or production access without Diego's explicit go-ahead.

**Internal milestones and dependencies:**

| Milestone                   | Content and gate                                                                                                               | Publication                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| 1A pre-merge                | 1.2–1.4 approved by Diego on 2026-10-15 for commit/push. CI/device gates stay open.                                            | Local review only              |
| Integration                 | Smart Mix → rebase → website; reconcile overlap and approved source pin.                                                       | None                           |
| R0 (assigned independently) | 2A, 2.9b, 2B; 2.11a → 2.11b → 2.11c, isolated operational gates.                                                               | Only separately approved fixes |
| 1B pre-merge                | 1.5–1.6 local implementation and persistent preview, then Diego review.                                                        | Local review only              |
| Foundation                  | Applicable Phase 0 gates, 1.0–1.13, 1b.3/1b.4. Admin captures precede 1.0; 1.13 follows 1A review. 0.14 may wait until Genres. | None                           |
| Genres                      | 3.1, 2.18a–e including Go, 3.7; needs Foundation, 2.11a/b and 0.14.                                                            | None                           |
| Listen player and EQ        | 2.19, 4.1–4.5; needs Genres and integrated Smart Mix Android path.                                                             | None                           |
| Ops                         | 2.14, 2.15a–c, 3.2, 3.4; backend contracts precede instruments.                                                                | None                           |
| Health                      | 2.17a–e, 3.3, 3.6.                                                                                                             | None                           |
| Stats / joint P0 major      | 2.20, 4.6; all P0 gates, native QA and final site/docs assets reviewed.                                                        | One jointly approved `v3.0.0`  |
| Later                       | P1/P2, Phase 5/6 and Smart Mix-dependent follow-ons; parallel 1b tasks gate Phase 6.                                           | Subsequent approved work       |

The dependency chain remains Foundation → Genres → player/EQ → Ops → Health → Stats; it is not a
phase-number execution loop. In particular 4.5 shares the Admin panel from 3.7, and 3.5 needs 4.3's
shared spring helper. Smart Mix-first may satisfy or reshape formerly blocked tasks; inspect before
marking them complete. Backend contracts land before consumers, in the same reviewed milestone.

**Planning estimates:** the old estimates (~43 Foundation task-days, ~103 frontend task-days to P0,
plus runtime gates) were assumptions for several public releases. They are historical planning
inputs, not a delivery commitment. Re-estimate remaining work after 1A and branch integration,
including 1.13 and actual QA. Do not add P1/P2 to the major to justify a new date.

**Partial migration during development:** the integration branch may contain screens that inherit
only tokens/primitives while others are fully restyled. The P0 major still follows the original
coverage boundary: non-P0 screens use the shared layer already delivered, keep behaviour and
readable contrast; Phase 6 completes coverage later. Every released surface uses the one Crate v3
identity. There are no selectable theme variants and no intermediate public Foundation UI release.

**Flags (no new flag framework):**

- **Listen talks to servers of other versions.** Capacitor and desktop builds connect to many
  servers. Every new endpoint is additive, and Listen treats a 404, a missing field or `warming` as
  "hide the instrument and show the previous UI or a fallback". That tolerance is the feature
  flag. Each instrument task carries an "older server" test with the endpoint returning 404 or the
  old shape, and states its fallback where it replaces a v2 component: 4.5 (no `chain`/`genrePath`:
  the v2 readout), 4.6 (no `night_hours`: no night band), 4.7b (no `probable_setlists`: the
  per-show fields), 4.8b (mood map 404: a hairline mood list from `/api/browse/moods`), 4.9b
  (`plan_meta` null: no planner line; task route 404: the synchronous route), 4.10b (bliss map
  404: the hero without the map), 5.9 (no `checkpoint`: no progress line), 5.10 (genre wheel 404:
  the v2 genre list). In the other direction, shipped Listen builds keep working against v3
  servers: the PD43 hidden heatmap keeps a zero grid (2.20), and the synchronous Paths routes stay
  until their deprecation date (4.9a).
- **Existing build flags:**
  - Devices stays behind `VITE_CRATE_CONNECT_FEATURE_ENABLED` (PD38).
  - Task 1.13 removes `VITE_LISTEN_APPEARANCE_SETTINGS_ENABLED` with its editor and runtime;
    preserve the current plumbing until that assigned migration, with no new variant features.
- **Server off-switches** for the new background work: `CRATE_DOMAIN_EVENTS_CONSUMER_ENABLED`
  and `CRATE_PROJECTOR_SIDE_EFFECTS_ENABLED` (2.10; the second is deployed off and turned on after
  a day of observation), `CRATE_GOVERNOR_SAMPLER_ENABLED`, `CRATE_STACK_SAMPLER_ENABLED`, and the
  surface-writer, Redis and acquisition sampler switches added in 2.11c, 5.4 and 5.6. They are on by default in
  production and off in tests and smoke composes, but the loops start only in the process that
  owns them (Conventions → single writers), so inheriting crate-worker's environment never starts a
  second writer. They allow turning a loop off without an image rollback.
- **The genre wheel ships as the default view** with the Tree and Grid toggles kept, so curators
  have an immediate fallback.

**Rollback:** deploys are image-first with automatic rollback. Migrations are additive (nullable
columns, `IF NOT EXISTS`, concurrent indexes, no drops in v3), and no migration changes the
meaning of a column an older image still writes. The case that needed care is the genre seeder:
the pre-v3 seeder runs on every boot and rewrites `eq_gains`, `name` and `description` of the core
genres, so Task 2.18d keeps curator overrides in `local_*` columns the old seeder never touches
(tested by running the old seeder SQL over a v3 row). During a rollback the old image ignores the
overrides; rolling forward restores them. With that, an image rollback is safe at any point.
Backfills are idempotent. Every task that changes the meaning of an existing column applies the
same check.

**Communication:** each release note lists behaviour changes and permission changes, so API clients
know in advance.

---

## Risks

| #   | Risk                                                                                                                                                                                                                                                                                                          | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | The brand font licence forbids shipping Cabinet Grotesk in a public repo and in images third parties run                                                                                                                                                                                                      | Closed by Task 0.0 (2026-10-15): Bricolage Grotesque (OFL) behind `--font-display-stack`, history rewritten before the first push                                                                                                                                                                                                                                                                                                                                                                               |
| 1   | Fixing B1 replays about six months of retained domain events (side effects included), wakes a 0.25 CPU projector, and switches side-effecting projections (forced `process_new_content` per acquisition, home rebuilds) back on in steady state                                                               | 2.10 is `[BEHAVIOUR]`: it moves the group to the stream tip once, acks only events older than that cut without projecting (deferred and post-outage events are never dropped by age), coalesces ops trailing-edge, ships alone, deploys side effects off behind `CRATE_PROJECTOR_SIDE_EFFECTS_ENABLED`, watches queue depth and `process_new_content` runs per hour before turning them on, and keeps `CRATE_DOMAIN_EVENTS_CONSUMER_ENABLED` as an off-switch without an image rollback                         |
| 2   | Smart Mix (PD2, about 100 commits, still active) collides with v3 on migration numbers 109–114, the Phase 2 backend, the Android native EQ path (`CrateNativePlaybackService.java`, `NativeEqController.java`, `lib/android-native-engine.ts`, `contexts/player-*.ts`), catalogs, Settings and Admin Analysis | `main` is canonical for migration numbers; inspect the actual integrated head and reuse any Smart Mix resolution. Renumber only remaining unmerged conflicts; any proven repair/stamp needs backup and separate operational approval; one shared `crate/camelot.py` (2.9b, separately reviewed enharmonic scoring change where still applicable); the Android parts of 4.3 and 4.4 are re-verified after the merge, 4.4 defines the two-deck hold; merge rules in 5.14; single-head check on every migration PR |
| 3   | The joint release keeps the integration branch alive longer                                                                                                                                                                                                                                                   | A single integrator coordinates updates from `main`, small task diffs, CI and internal review checkpoints; keep the branch until the approved P0 major and re-estimate after Smart Mix/site integration                                                                                                                                                                                                                                                                                                         |
| 4   | Slow test feedback on the external disk                                                                                                                                                                                                                                                                       | A standalone clone on the internal disk (0.2), done before the font licence answer; CI as source of truth; single-file local runs; never commit the timeout patch                                                                                                                                                                                                                                                                                                                                               |
| 5   | Behaviour changes surprise operators: projector side effects resuming, PD24, PD29, PD43, PD46, G1, the Smart EQ hold, enrichment GET `{}`, task stream ownership, fix-type confirm, synchronous Paths without LLM, genre counts, mood pools, setlist map                                                      | One PR each, release notes, Diego's sign-off per item; consumers on `main` updated in the same PR (Phase 2 intro)                                                                                                                                                                                                                                                                                                                                                                                               |
| 6   | New background loops add load: governor, Redis, acquisition and stack samplers, surface writers, pipeline trace, refresh tasks; hidden Admin tabs or an idle Dashboard keeping samplers fast; coalescing windows collapsed to 5 minutes by the pending-task redispatcher                                      | Demand gating with viewer keys and a 1 s check; hidden tabs close their stream after 30 s and the Dashboard never subscribes to fast surfaces; async viewer marking in SSE generators; Redis-first runtime samples with rate-limited persistence; single writers in the service-loop process; samplers in their own threads; quiet refresh tasks; trailing-edge coalescing through the due set (no `tasks` row before it is due); off-switches; 7.4 idle-load measurements                                      |
| 7   | Drift and policy budgets with exact counts (inline styles, raw buttons, arbitrary values) cause merge conflicts and silent widening                                                                                                                                                                           | Ceilings move only with listed tokens; prefer SVG attributes, refs and `:nth-child`; `GATES` on every PR                                                                                                                                                                                                                                                                                                                                                                                                        |
| 8   | Shared component placement breaks the both-apps rule (it is review-only)                                                                                                                                                                                                                                      | Each Phase 1 task names its adopter in both apps; Phase 3/4 tasks move components into `@crate/ui` only in the PR where the second app adopts them                                                                                                                                                                                                                                                                                                                                                              |
| 9   | Visual baseline churn hides real regressions; local arm64 and CI amd64 pixels differ                                                                                                                                                                                                                          | Committed PNGs come only from the amd64 `update-listen-visual` job; Admin captures from 0.11, before the foundation changes Admin pixels; re-baseline per screen with a manual diff review; final re-record in 7.5                                                                                                                                                                                                                                                                                              |
| 10  | Site drift tests break when `feat/website` merges, and ports copy different site states                                                                                                                                                                                                                       | Task 7.6 lists every pinned file; whichever branch lands second updates the site; the site reference is pinned at `258bbaee`, each port records its SHA, and a re-sync step precedes each group that ports site math                                                                                                                                                                                                                                                                                            |
| 11  | WebGL2 on mid-range Android and WebKitGTK (sound map), and Canvas memory                                                                                                                                                                                                                                      | 2D fallback, DPR ≤ 2, point caps by `deviceMemory`, context-loss handling, 7.3 device tests                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 12  | Bundle creep: Listen's `PlayerBar` is eager and the EQ glyph and shared primitives sit in the initial chunk; Admin gains many instruments                                                                                                                                                                     | `BUNDLE` and `BUNDLE-ADMIN` in CI from 0.12, with lazy-route assertions per instrument; the glyph imports `lib/eq-curve`, not `EqBands`; heavy instruments lazy                                                                                                                                                                                                                                                                                                                                                 |
| 13  | Hand-built SVG instruments regress accessibility                                                                                                                                                                                                                                                              | HTML equivalents, roving tabindex, quiet live regions, forced-colors pass (7.2)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 14  | Genre counts drop after the count definition change (PD21); curators read it as data loss                                                                                                                                                                                                                     | Release note; same definition in Admin, Listen and the read plane                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 15  | Privacy: instance heatmap with few listeners, ops events, task streams                                                                                                                                                                                                                                        | PD43 enforced by the server below 3 listeners (2.20), so shipped clients never receive the grid; B19 and B16 hotfixes ship first, from `main`, without waiting for Phase 0                                                                                                                                                                                                                                                                                                                                      |
| 16  | iOS 15 CSS gaps: Tailwind's alpha ladders fall back to `transparent`, `cqi` and `@container` are missing, subgrid needs Safari 16                                                                                                                                                                             | Raise the target to 16.4 (Task 0.13, recommended); whatever the target, minifier-safe guarded rem numeral fallbacks (1.4) and no subgrid (4.6); if 15.0 stays, rgba tokens, `@supports` guards and a named iOS 15 device                                                                                                                                                                                                                                                                                        |
| 17  | Unconfirmed facts: B1 on production, `EXPLAIN` plans, the production genre overlay size                                                                                                                                                                                                                       | Verify each at the task that depends on it (marked UNCERTAIN in PD); the overlay size is measured in 0.14. Telegram is confirmed unfiltered and handled by `notify`/`quiet`                                                                                                                                                                                                                                                                                                                                     |
| 18  | Scope: about 30 instruments plus 50 coverage surfaces                                                                                                                                                                                                                                                         | Internal milestones preserve the P0 major boundary; P1/P2 and coverage remain later. The one joint release does not pull enrichment, federation, Redis, pipeline, devices or mix strip into P0                                                                                                                                                                                                                                                                                                                  |
| 19  | Release gates assume runtimes nobody has (WebKitGTK 2.40, WebView2 111) and run mobile device passes on every tag                                                                                                                                                                                             | Task 0.15 provisions a pinned WebKitGTK 2.40 runtime or downgrades that gate to the symbol check plus a CSS audit; 7.3 and 7.7 run only the runtimes a release changes                                                                                                                                                                                                                                                                                                                                          |

---

## Order and checkpoints

1. Checkpoints 1A (1.2–1.4) and 1B (1.5–1.6), including the persistent preview, were approved and
   published on 2026-10-15. GenrePill with percentages (1.6a / 1C) is approved and committed as `e60e6f50`.
   Task 1.1 / 1D is provisionally accepted at `#foco`, with visual polish deferred; Diego authorised commit/push of 1C/1D on 2026-10-15.
   Serialise overlapping token/cn/budget edits; future batches still stop for review.
2. Complete/review the applicable open Phase 0 gates when assigned. 0.11 precedes Admin 1.0;
   0.15 qualifies desktop or records the approved fallback; 0.14 waits only until the wheel.
3. Integrator-approved sequence: Smart Mix on `main` → rebase → website integration. Keep the
   visual source SHA pinned until a reviewed resync. Reconcile Smart Mix overlap before backend work.
4. Assigned R0 fixes keep separate `[MAIN]` branches and operational review/deployment gates;
   nothing starts automatically. 2.10 stays isolated; 2.11a → 2.11b → 2.11c are observed separately.
5. After review, complete Foundation (including 1.13), then Genres → player/EQ → Ops → Health →
   Stats as internal milestones. Contracts precede instruments; the shared-layer 1b tasks gate Phase 6.
6. Stop at each checkpoint for Diego. The joint `v3.0.0` contains the existing P0 scope plus the
   single Crate v3 identity across Listen, Admin, site and docs. P1/P2 remain subsequent work.
7. Full applicable Phase 7 QA and reviewed final screenshots/screencast precede the major. No
   checklist grants permission for commits, push, PRs, tags, deploys or production access.

### Checkpoint 1M — publication and Linux capture verification

Published and pushed as `21873d24997ca53ca3218c891a8d70fae296cc78`. Linux recording
[38888497469](https://github.com/thecrateapp/crate/actions/runs/38888497469) passes. Artifact
`12040079621` has verified SHA256 `4fdf97def687772a3830bb34671a79d944fc6530f498470b7743edef38940731`.
The original manifest identifies that production SHA, Linux x64 and the pinned Playwright
`v1.63.0-noble` image. Of 33 PNGs, 31 are byte-identical; only desktop/mobile Settings change
to the approved three functional preferences. Both changed images are reviewed and imported.
The ten obsolete skin/light captures were explicitly retired in the production commit.
Capture/provenance commit `297daaa1` is pushed. Full Frontend Tests and Linux visual comparison
pass in [38889352392](https://github.com/thecrateapp/crate/actions/runs/38889352392).
Next assigned task: 1b.1 / Checkpoint 1N, shared overlays/menus and one ConfirmDialog; preserve
its visual review/publication stop.

### Linux continuation — provisional 1AB and Dashboard product review, 2026-10-18

1AA is approved/published as 13272706. Local 1AB extends the icon guard to wholeDashboard, retaining
three concrete loading/disclosureUX sites and its data/actions/charts. Diego's font audit also
corrects common Admin Ops surfaces and Analysis to Bricolage/Mono roles with Poppins body/controls;
existing8px/44px contracts remain. Evidence and limits are in the final handover.

Diego then requested a simplification analysis because Dashboard mixes too much information.
He prioritised knowing whether the system and its jobs work. Read
[the proposed analysis](2026-10-18-crate-v3-dashboard-simplification-analysis.md). It recommends
state/freshness, work/progress and actionable current issues; it is not yet an approved change
of Task 3.3. Stop product work and publication at provisional 1AB; preserve all previous checkpoints.

### 1AB execution approval and local result — 2026-10-18

Diego explicitly approved implementing the Dashboard simplification with only existing real
data and stopping before commit. [Bounded execution plan](2026-10-18-crate-v3-dashboard-implementation.md)
records model/page tests, preview scenarios and validation. Three regions replace the older
composition; available signal limits, freshness, actual task progress and local maintenance
contracts are explicit. No new backend/provider/subscriptions. Whole 1b.8, future health/governor
instruments and phase QA are not complete. Stop at 1AB for Diego; final evidence in the handover.
