---
title: Workers, tasks and background services
summary: Dramatiq ownership, queues and daemon responsibilities.
section: architecture
audience: [developer, operator]
status: canonical
order: 70
verified: 2026-10-21
sources:
  - app/crate/actors.py
  - app/crate/worker_handlers
  - app/crate/db/jobs/smart_mix_backfill.py
  - docker-compose.yaml
  - app/crate/resource_governor.py
  - app/crate/db/repositories/tasks_claims.py
  - app/crate/db/repositories/task_control.py
  - app/crate/db/repositories/agent_task_control.py
  - app/crate/db/repositories/tasks_creation.py
  - app/tests/test_task_control_actor.py
  - app/tests/test_task_runtime_contract.py
  - app/tests/test_resource_governor.py
  - app/tests/test_actors.py
---

# Worker, Tasks, and Background Services

## Why the worker exists

Crate's worker layer is not just “background jobs”. It is the write-capable
side of the system and is split into several production containers so heavy
work cannot starve playback or interactive admin/listen traffic.

Anything that can mutate the library or perform long-running work belongs here:

- downloads
- Bandcamp collection sync and purchase imports
- file moves
- tag writes
- image writes
- user upload normalization and contribution withdrawal
- scans and repairs
- enrichment fan-out
- storage migration
- audio analysis orchestration
- snapshot projection

The worker mounts `/music` read-write, unlike the API.

## Execution model

The Python worker entrypoint is `app/crate/worker.py`, but production does not
run every concern inside a single container anymore.

Current production split:

- `crate-worker`: `fast,default` queues, service loop, scheduler, watcher,
  imports, cleanup, Telegram, and write-capable general work.
- `crate-maintenance-worker`: `maintenance` queue for repair/sync/enrichment
  style work that can be deferred.
- `crate-analysis-worker`: `heavy` queue for CPU/DSP-heavy analysis,
  fingerprints, and bliss work.
- `crate-playback-worker`: `playback` queue for playback prepare and
  transcoding work with its own ffmpeg/thread limits.
- `crate-projector`: dedicated `projector` command consuming domain events and
  warming snapshots.
- `crate-media-worker`: Rust service used by API/worker paths for package
  generation, download artifacts, Redis progress, cancellation, and slot
  admission.

All Python worker containers initialize the DB/runtime they need, but flags such
as `--no-service-loop`, `--no-daemons`, `--no-projector`, and queue selection
keep each runtime narrowly scoped.

## Task model

Crate tasks are dual-represented:

- PostgreSQL row in `tasks`
- Dramatiq message delivered to an actor

### Why both exist

The DB row provides:

- a stable task id
- persistent status and progress
- cancellation
- task history in the UI
- a place to attach result and error payloads

The Dramatiq message provides:

- asynchronous execution
- queueing
- retries
- process isolation
- distribution over worker processes

This remains one of the most important architectural choices in the project.

## Task lifecycle

### Creation

`create_task()` / `create_task_dedup()`:

- insert a row into `tasks`
- derive queue/priority/runtime limits from config
- schedule Dramatiq dispatch only after the surrounding transaction commits
- can participate in a caller-owned session

### Execution

The actor wrapper in `app/crate/actors.py`:

- fetches the task row
- acquires Redis-backed locks/semaphores when needed
- marks the task as running
- starts heartbeat state
- calls the real handler
- records completion or failure
- releases locks

### Progress and events

- coarse progress lives on `tasks.progress`
- richer task activity lives in `task_events`
- SSE endpoints stream both global and per-task activity

### Cancellation

Cancellation is cooperative:

- the task row can be marked cancelled
- handlers poll for cancellation
- Crate does not kill threads preemptively during filesystem work

## Not all follow-up work is a DB task

The task model is important, but it is not the only async mechanism anymore.

Examples:

- the **projector** consumes Redis Stream domain events in its own loop
- **scrobble follow-ups** for play events are queued as direct actors after
  commit rather than as user-visible task rows
- **analysis/bliss daemons** claim pipeline work directly rather than routing
  every unit of work through a task row

That split is intentional: not every async unit needs to be operator-visible as
its own row in `tasks`.

## Queue and priority strategy

`app/crate/actors.py` defines per-task execution policy.

Queues:

- `fast` — lightweight HTTP/DB-heavy but short jobs
- `default` — mixed work, library pipeline, downloads, management
- `maintenance` — repair, sync, enrichment and other deferrable maintenance
- `heavy` — reserved for heavier CPU paths
- `playback` — playback preparation and transcode jobs

Bandcamp work is split by cost and risk:

- `bandcamp_sync_collection` runs on `maintenance` and records collection,
  wishlist, following, match candidates, and Radar entries.
- `bandcamp_import_purchase` runs on `default`, downloads an owned purchase into
  staging, reuses the upload/import path, records contribution provenance, and
  skips content that already exists in the shared library.
- `bandcamp_radar_refresh` runs on `fast`.
- contribution withdrawal/cleanup runs on `default` because it can delete
  library files when no other active contributor remains.

Priority bands broadly map to:

- urgent user actions
- immediate post-ingest work
- scheduled operational work
- lower-priority maintenance/backfills

## Coordination primitives

### Resource governor and maintenance window

`app/crate/resource_governor.py` protects interactive playback/API usage from
expensive background work. Governed tasks can be deferred based on:

- one-minute load ratio
- sampled iowait
- swap and available memory pressure
- active listeners and recent streams
- configured maintenance windows for destructive or heavy maintenance flows

The main knobs are `CRATE_RESOURCE_*` and `CRATE_MAINTENANCE_WINDOW_*`. Manual
or narrowly scoped tasks can bypass parts of this protection only when the task
type explicitly allows it.

### DB-heavy mutex

Some tasks should not overlap, especially ones that churn library state:

- `library_sync`
- `library_pipeline`
- `wipe_library`
- `rebuild_library`
- `repair`
- `migrate_storage_v2`

These use Redis-backed coordination so only one runs at a time across worker
processes.

### Download semaphore

Tidal, Soulseek, and Bandcamp import transfers are globally capped using a
Redis semaphore.

## Service loop responsibilities

`_run_service_loop()` is the second major part of the worker runtime.

On a cadence, it handles:

- filesystem watcher lifecycle
- scheduled task creation
- import queue refresh
- zombie task cleanup
- worker status cache updates
- ops runtime state updates
- queue depth metrics
- metrics flush to PostgreSQL
- incremental shadow read-model backfill for analysis/bliss pipeline tables
- old task/event/log/session/jam cleanup

This is what makes the worker feel like a living background runtime rather than
a pure broker consumer.

## Filesystem watcher

`app/crate/library_watcher.py` uses `watchdog` to:

- react to created and moved audio files
- debounce per album directory
- ignore files written by enrichment or artwork generation
- avoid infinite loops using runtime flags and suppression logic

Watcher events trigger sync and downstream processing rather than performing
heavy work inline.

## Scheduler

`app/crate/scheduler.py` implements configurable recurring tasks backed by
settings rather than static cron files.

Default schedules cover things such as:

- artist enrichment
- library pipeline
- analytics
- new releases
- incomplete download cleanup
- show sync

It checks both elapsed time and whether a same-type task is already
pending/running to avoid schedule storms.

## Analysis and bliss daemons

Separate long-lived daemons handle throughput-oriented analysis flows:

- audio analysis daemon
- bliss daemon

They claim work from `track_processing_state` and update the shadow pipeline
tables plus compatibility columns.

This is conceptually different from request-triggered tasks: the daemons absorb
newly indexed content and background resets without wrapping every track in a
task row.

## Projector loop

`crate-projector` is the dedicated consumer for the domain-event bus.

It:

- reads Redis Stream events through a consumer group
- retries its own pending messages first after a crash/restart
- decides whether ops or home snapshots need refreshing
- marks processed messages only after warming completes

This is the bridge between write-side mutations and snapshot-driven UI surfaces.

## Media worker bridge

`crate-media-worker` is a Rust service used for download/package work that
should not run inside request handlers. It supports ZIP64 packages, stores
job/progress state in Redis, honors cancel keys, and uses a Redis slot gate via
`CRATE_MEDIA_WORKER_MAX_ACTIVE` so package generation does not saturate the
host. Python code in `app/crate/media_worker.py` and
`app/crate/media_worker_progress.py` adapts it into the existing task/progress
model.

## Import queue

The service loop periodically normalizes external import sources into
`import_queue_items`, which gives the admin UI and ops snapshot a read model for
staging/import state rather than live rescans every time.

## Smart Mix campaign and worker ownership

Smart Mix section verified against source on 2026-10-21.

`backfill_smart_mix_profiles` coordinates bounded claims and queues
`compute_smart_mix_profile` children on `heavy`; `refresh_smart_mix_coverage` runs on
`maintenance`. Workers validate the captured source, claim and profile revision before
publication. Campaign pause/cancel stops further coordination without forcibly killing
already accepted child analyses. A completed coordinator or campaign does not prove current
coverage: exhausted failures and missing/outdated profiles remain separate observations.
See [Smart Mix operation](smart-mix-operations.md) for backfill priority, generations,
publication outcomes and the diagnostic sequence.


## Deferral, cancellation acknowledgement and replay

Verified against implementation and tests on 2026-10-21. Queue assignment is defined by
`actors.py` task policy and the deployed Compose commands, not by a task's display label.
`crate-fast-worker` adds `fast` capacity; `crate-worker` consumes `fast,default`, the
maintenance/analysis/playback workers consume their named queue, and projector and Rust
media worker have separate loops. A running container alone does not prove that the
required queue is consumed or that a particular handler is progressing.

Before claiming a task, the actor evaluates the resource governor, DB-heavy coordination,
download windows/listener limits and transfer slots where applicable. Deferral requeues
the same task with a delay and progress/reason evidence; it is not completion or a new
user operation. Runtime policy revision/hash are rechecked at the pending-to-running claim;
a concurrent policy change causes requeue without handler execution. Atomic claim prevents
duplicate broker messages from running the same task concurrently. Inspect persisted
status, progress, heartbeat, queue and reason before diagnosing a pending job as stuck.

Cancellation has two durable moments: `cancellation_requested_at` and
`cancellation_acknowledged_at`. Pending work can become cancelled immediately with
`effects=not_started`; running or delegated work must reach cooperative checkpoints and
wait for active descendants before acknowledgement. Checkpoint results can contain partial
effects. `completing` rejects cancellation; terminal responses do not imply rollback.
An interruption after a request must not be described as an acknowledged stop. The actor
emits the cancelled terminal event after acknowledgement, not merely after a request.

Broker redelivery and idempotent operation admission are different contracts. A stable
idempotency key plus the same payload recovers the admitted operation/job after a lost
response. It does not authorize a different selection or blindly rerun uncertain effects.
Agent retry/cancel is a closed catalog in `db/repositories/agent_task_control.py`; retry
requires a supported failed task, no cancellation uncertainty, depth/budget checks and
current grants for the underlying work. It creates a provenance-linked retry, rather than
resetting arbitrary work. Agent-origin handlers recheck authority before effects. Inspect
execution, verification and projection in the durable result separately and reconcile
uncertain outcomes before preparing another plan. The default Hermes pilot has read grants
only and cannot perform these controls.

Sources: `app/crate/actors.py`, `app/crate/resource_governor.py`,
`app/crate/db/repositories/tasks_claims.py`, `task_control.py`, `agent_task_control.py`
and `tasks_creation.py` in the same repository package. Regression coverage lives in
`app/tests/test_task_control_actor.py` (partial effects, interruption, descendants,
policy change before claim), `test_task_runtime_contract.py`, `test_resource_governor.py`
and `test_actors.py`. See [Agents and MCP](11-crate-mcp.md) for exact plan review;
these are implemented contracts, not general shell/restart/replay capabilities.
