# Crate MCP — Linux handoff after phase 5

This checkpoint completes phase 5 of the approved full-feature MCP plan. Work continues on
`feat/crate_mcp`, PR https://github.com/thecrateapp/crate/pull/292, targeting `main`.
Phase 4 was published in `7af26ed54dacaa2c994e078d7e68066d7a5ad80e`; the phase-5 commit contains
this document. No deployment, merge, production migration or feature activation has occurred.

## Start from Linux

There is no dependency on the previous macOS worktree. Do not use its absolute paths, virtualenv,
local databases, `/tmp` logs, personal plugins or browser state. Use repository-relative paths from
the root of your Linux checkout.

If no suitable checkout exists, create one in an available directory:

```bash
git clone https://github.com/thecrateapp/crate.git crate
cd crate
git fetch origin main feat/crate_mcp
git switch --track -c feat/crate_mcp origin/feat/crate_mcp
git status --short --branch
git log -3 --oneline
```

For an existing checkout, first verify its remote and preserve any local work. Fetch the same refs
and create the tracking branch if absent. If the local branch already exists, switch to it and
fast-forward only after inspecting divergence. Never reset/clean, force-push, recreate the branch
from `main`, or silently overwrite local changes. A new worktree is optional, not required.
Authentication to GitHub must use the Linux environment's existing credentials; request access
only if the clone/fetch itself cannot proceed. The repository remote may use HTTPS or SSH.

Read, in order:

1. Root `AGENTS.md` and the scoped instructions for every area you touch.
2. `docs/plans/2026-10-15-crate-mcp-feature-plan.md` — the approved full feature plan.
3. `docs/technical/crate-mcp.md`, especially phase 4 and phase 5.
4. This handoff and the current PR diff, checks and **persistent review** for the exact branch HEAD.

The plan contains historical clickable macOS paths. Resolve those references by their repository
suffix (`app/crate/...`, `app/ui/...`) on Linux; they are not executable checkout requirements.
Use the skills actually available in your environment and retain the plan's implementation/review
workflow. Do not assume that the previous agent's personal plugins exist on Linux.

## Environment and verification

Python **3.13** is pinned in `.python-version`. Node.js 20+ / npm and Docker Engine with Compose v2
are the documented local prerequisites. Follow `docs/technical/00b-development-setup.md` and the
current requirements/CI files rather than copying macOS binaries.

For host-based backend tests, a normal setup is:

```bash
python3.13 -m venv .venv
.venv/bin/python -m pip install -r app/requirements-test.txt
.venv/bin/python -m pip install ruff==0.15.22 pyright==1.1.411 bandit==1.9.4
npm ci
npm run --workspace=app/shared/ui build
```

The full requirements include worker/native dependencies; install their Linux prerequisites as
specified by the repository images/setup. `app/docs` is outside npm workspaces and only needs
`npm ci --prefix app/docs` when working on its build. Avoid dependency or lockfile upgrades.

PostgreSQL-backed tests use `pg_db`: it clones isolated migrated test databases from a template,
using configured `CRATE_POSTGRES_*` credentials or a `pgvector/pgvector:pg15` Testcontainer.
The user must have test-database creation privileges. Use only a dedicated local test instance.
The prior machine's port 33263 and containers are temporary and **must not be reused as Linux
configuration**. Never use production credentials, migrate a real library for a test, or count
skipped PostgreSQL tests as successful verification. Keep PostgreSQL pytest runs sequential when
sharing one instance; parallel template builds caused Docker stalls during development.

**User rule: never run complete suites during development. Run only focused selections; reserve
complete suites for the end of the whole feature.** A new machine is not a reason to run `pytest`
without file selection, `make dev-test`, or every frontend test. First inspect CI; rerun relevant
selections when new changes/failures justify it, not every previously green area.

Useful focused selections, from `app/`:

```bash
../.venv/bin/python -m pytest tests/test_task_cooperative_cancellation.py tests/test_task_control_actor.py tests/test_mcp_operations.py -q
../.venv/bin/python -m pytest tests/test_agent_runtime_policy.py tests/test_agent_runtime_admin_api.py -q
../.venv/bin/python -m pytest tests/test_agent_instance_migration.py tests/test_agent_library_migration.py tests/test_agent_access_migration.py -q
../.venv/bin/python -m pytest tests/test_task_runtime_contract.py tests/test_task_queue_routing.py tests/test_tasks_api.py -q
```

For changed Admin UI contracts, from the repository root:

```bash
npm run --workspace=app/ui test -- src/pages/Tasks.test.tsx src/lib/agent-integrations.test.ts
npm run --workspace=app/ui typecheck
```

Before beginning new feature work, inspect PR #292's latest CI and persistent review. Distinguish
real failures/findings from heuristic ECC bot comments: the previous commit's security scanner
was green despite its “no scanner evidence” heuristic and GitHub App Checks permission complaint.
Do not change installation permissions to appease that heuristic. The phase-4 persistent review
only contained a conditional import-order suggestion already covered by green Ruff/CI.
The phase-5 commit's fresh CI/persistent review may still be running when you start; read the
actual results and fix actionable findings before continuing.

## Delivered through phase 5

- Phases 0–3: remote HTTP MCP, separate service credentials, diagnostics, scoped actions,
  delegated OAuth, Admin integration management and exact human plan approval.
- Phase 4: the shared immutable plan/job engine, reviewed health/repair catalog, metadata,
  enrichment, generation-bound DSP, indexed-album sync, quality snapshots and portable metadata.
- Phase 5: **40 tools, 24 explicitly provisioned grants**, migration **124**;
  sanitized audit and enumerated metric reads; provenance/ancestry/children/partial-effects in
  `get_job`; exact-context job controls; shared typed schedules/runtime operations and real
  Dramatiq admission/adoption evidence; truthful Admin cancellation/concurrency.

Core phase-5 files:

- `agent_operations.py`, `agent_instance_operations.py`, `agent_runtime.py`,
  `agent_library_operations.py`, `agent_operation_catalog.py`, `agent_access.py`,
  `agent_discovery.py`, `agent_diagnostics.py` under `app/crate/`.
- `app/crate/mcp/{tools,schemas,operation_schemas}.py`.
- `app/crate/db/repositories/{agent_task_control,task_control,runtime_policy,agent_operation_jobs,agent_requests,tasks_creation,tasks_updates,tasks_maintenance}.py`.
- `app/crate/db/queries/{agent_operations,agent_operation_targets,agent_runtime_policy}.py`.
- `app/crate/{actors,worker,scheduler,resource_governor,runtime_policy_contract,task_registry}.py`.
- `app/crate/worker_handlers/{__init__,analysis,agent_library}.py`.
- Shared Admin repositories wired through `api/tasks.py`, `api/settings.py`,
  `api/admin_metrics.py`, `db/admin_tasks_surface.py` and `app/ui/src/pages/Tasks.tsx`.

Keep these invariants:

- API `/music` is read-only; filesystem writes and heavy work stay in workers. All SQL/scopes
  stay in `app/crate/db/`, with concrete imports, no external frozen facade import. No HTTP
  library-track aggregates, snapshot rebuilds, arbitrary task dispatch/settings/cron/force inputs.
- Job control defaults to the same principal and **exact authorization context**. Reviewed
  Admin/scheduler jobs need explicit instance scope, `ops.jobs.manage_instance`, the action grant
  and original domain grants. That never permits another integration's jobs.
- Retry reconstructs closed variants only: `compute_analytics {}` and
  `quality_check {scope: global}`; three retries per lineage, one active retry, no repair replay,
  no failed child outside its parent and no uncertain cancellation replay.
- Cancellation requests stay running until real worker acknowledgment. Propagate to children,
  preserve partial effects, skip cancelled-parent finalizers and preserve terminal race winners.
  Exceptions/timeouts/zombies with a request fail with reconciliation, no fake acknowledgment
  and no automatic retry. The agent engine must not terminalize the task before the actor's ack.
- `agent_control` on fast has timeout 60s, no auto-retry and one global control reservation
  separate from work slots. It accepts **only** preparation/application of job cancellation;
  no other operation can consume that reservation.
- Idempotent replay remains valid after the source changes state, and reauthorizes the original
  accepted grants. Do not evaluate mutable eligibility before returning an accepted replay.
- Known schedules and typed CAS only. Last enqueue is not last success. The initially runnable
  MCP schedule is `compute_analytics`; unsupported execution variants advertise missing contracts.
- Runtime slots govern actual new task starts, not process resizing. Claim checks the exact
  revision/hash used by resource admission. `effective_revision` remains null until actual
  consumers acknowledge use; reads/heartbeats never count. Missing required listener telemetry
  blocks downloads without recording adoption.
- Admin old interval maps remain accepted. Unsupported `min_slots>1` now returns 422 because
  Dramatiq has no minimum-process autoscaling. UI uses configured admission separately from
  observed process capacity.
- Migrations **118–124 are now published and immutable** (published as 109–115 and renumbered
  when main's deployed Smart Mix 109–117 merged). New schema work starts at the next
  actual head. Rollback 124 fences phase-5 tasks before dropping authorization fields.
- Keep the existing full private plan/result and compact/paginated MCP outputs. Do not expose
  arbitrary task params, audit details, secrets or large provider responses on shared surfaces.

Validation at this cut: independent SPEC and QUALITY/security review passed with no outstanding
P1/P2 findings; 274 distinct phase-5 cases were validated across initial and targeted regression
runs with real PostgreSQL/SDK, plus focused legacy, migration, transport/discovery, UI and boundary
selections. Counts overlap and must not be summed. Complete suites were not run. New CI must be
checked from GitHub because local `/tmp` evidence is intentionally not portable.

## What to do next

1. Confirm the remote phase-5 commit/checks and persistent review. Repair any actual regression
   with a focused test, including CI-only differences on Linux. Keep changes on `feat/crate_mcp`
   and the same PR #292; do not create another feature branch or PR.
2. Continue **phase 6: editorial playlists and the editorial creation skill**, following the
   already approved plan. Read its complete 6.1–6.4 requirements before implementation and trace
   Admin's system-playlist/editorial operations. Reuse the existing server model and plan engine,
   preserve static/smart scope, blueprint rules and locked/manual entries, order and exclusions.
   The skill supplies editorial judgment; authority, selection, approval and mutation guarantees
   remain server-side. Do not invent a parallel playlist model or expose a free-form “agent action”.
3. Finish that phase's focused tests and separate specification/quality reviews before declaring
   it complete. Report the next reviewable cut and any real limitations; keep the plan and guide
   current. Future commits use conventional messages (<72-char subject), no attribution footer.
4. Phase 7 remains final evaluations, interoperability/distribution/documentation and rollout
   readiness. External-provider production validation and public deployment are not established
   by local SDK tests. Do not enable flags, deploy or merge without user authorization.
5. Phase 8 remains manual/assisted shows: **Admin interface** and MCP, Crate's existing show model,
   text/link/flyer/tour extraction, configured vision-capable LLM and free local OCR even with no
   LLM, editable review and all tour dates, transactional durable dedupe/idempotence. On MCP, the
   calling agent does extraction. Do not start this tangential feature ahead of the approved
   sequence or lose these requirements during the handoff.

Diego prefers Spanish, concise technical progress, reviewable cuts, clean straightforward code and
no repeated permission questions for already approved work. Never run full suites mid-development.
