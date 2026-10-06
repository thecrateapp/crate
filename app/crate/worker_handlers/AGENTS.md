# Background Processing: Worker Handlers, Actors, Daemons

Scope: `app/crate/worker_handlers/` plus the runtime that drives it: `actors.py`,
`broker.py`, `worker.py`, `scheduler.py`, `library_watcher.py`, `analysis_daemon.py`,
`projector.py` / `projector_daemon.py` / `domain_event_relay.py`, `resource_governor.py`,
`task_progress.py`, `media_worker*.py`. Platform rules (DB boundary, `/music` read-only in
the API, frozen `crate.db` facade, testing policy) live in the root `AGENTS.md`.
Long-form background: `docs/technical/03-worker-tasks-and-background-services.md`.

## Runtime map (production, `docker-compose.yaml`)

| Container                   | Command                                                    | Queues / loops                                                                                                             | `/music` |
| --------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------- |
| `crate-worker`              | `worker --queues default,fast --no-daemons --no-projector` | default + fast, service loop (scheduler, watcher, zombie cleanup, stale-pending redispatch, media-worker bridge), Telegram | rw       |
| `crate-fast-worker`         | `worker --queues fast --no-service-loop ...`               | fast only (extends `crate-worker`)                                                                                         | rw       |
| `crate-maintenance-worker`  | `worker --queues maintenance --no-service-loop ...`        | maintenance                                                                                                                | rw       |
| `crate-analysis-worker`     | `worker --queues heavy --no-service-loop --no-projector`   | heavy + analysis/bliss daemons                                                                                             | **ro**   |
| `crate-playback-worker`     | `worker --queues playback ...`                             | playback (ffmpeg transcodes into `/cache`)                                                                                 | **ro**   |
| `crate-projector`           | `projector`                                                | outbox relay + domain-event projection + snapshot warming                                                                  | ro       |
| `crate-media-worker` (Rust) | HTTP on :8687                                              | album/track ZIP packages, Redis progress/cancel                                                                            | ro       |

`run_worker()` in `worker.py` starts optional threads per CLI flag, then execs
`python -m dramatiq crate.actors --processes N --threads 1 --queues ...`. `orchestrator.py`
is legacy (`worker --legacy` only); do not extend it or `claim_next_task`.

## Task lifecycle

1. Enqueue (API, scheduler, another handler): `create_task(...)` or `create_task_dedup(...)`
   from `crate.db.repositories.tasks`. Inserts a `tasks` row (`pending`, pool/priority/
   `max_duration_sec`/`max_retries` copied from `TASK_POOL_CONFIG`) and dispatches to Dramatiq
   **after commit** (`register_after_commit`). Pass `session=` to join a caller's transaction.
2. Dedup: `create_task_dedup` takes a `pg_advisory_xact_lock` and skips insert if a
   `pending/running/delegated/completing` task of the same type matches `dedup_key` (or the
   sorted `params_json` when no key). Returns `None` on dedup. Shared keys: `task_dedup_keys.py`;
   scheduler uses `schedule:<task_type>`.
3. Actor: `actors._execute_task` loads the row, skips if cancelled, applies resource governor
   deferral, DB-heavy Redis mutex, download window/semaphore (re-enqueue with delay, row stays
   `pending`), then atomically claims `pending -> running` via `start_task`. Duplicate messages
   lose the claim and exit.
4. Handler: `handler(task_id, params, config) -> dict` (`TaskHandler` in
   `worker_handlers/__init__.py`). Heartbeat thread updates `heartbeat_at` every 15s.
5. Result: dict with `error` or `status in {"failed","conflict"}` -> `failed` (no retry);
   `{"_delegated": True, "chunks": n}` -> `delegated`, children fan in via `parent_task_id`;
   anything else -> `completed` (so `{"status": "skipped", ...}` is a success). Raised exception
   or `TimeLimitExceeded` -> `fail_or_retry_task` (DB `retry_count < max_retries` -> back to
   `pending`). A `task_done` event is published in every case.
6. After each message `_check_memory()` SIGTERMs the process above 1500 MB RSS; Dramatiq respawns it.

Healing: service loop marks zombies (no heartbeat 5 min) and redispatches `pending` rows older
than 300s. The `tasks` row is the source of truth; Redis messages can be lost or duplicated.

## Adding a task type end to end

1. Handler: `_handle_<name>(task_id, params, config) -> dict` in the matching
   `worker_handlers/<domain>.py`, added to that module's `*_TASK_HANDLERS` dict.
2. Registry: add the type to `_HANDLER_GROUPS` in `worker.py` (lazy import; duplicates raise).
3. Actor config: add `TaskPoolConfig(queue, priority, time_limit_seconds, max_retries)` to
   `TASK_POOL_CONFIG` in `actors.py`. Actors are registered from it; there is no decorator.
4. Optional: label in `task_registry.py`; `DB_HEAVY_TASKS` (`db/repositories/tasks_shared.py`, reused by
   `actors.DB_HEAVY_TASK_TYPES`) for full-library DB work; `RESOURCE_GOVERNED_TASK_TYPES` (`resource_governor.py`) for deferrable batch work;
   `DEFAULT_SCHEDULES` in `scheduler.py` for recurring runs.
5. DB access: put SQL in `crate/db/jobs/<domain>.py` (worker writes) or `db/queries/` (reads)
   and call it from the handler. Handlers never use `session.execute` / scopes directly.
6. API enqueue: endpoint validates, calls `create_task`/`create_task_dedup`, returns `task_id`.
   Clients follow `/api/events/task/{id}`.
7. Progress: `TaskProgress` + `emit_progress(task_id, p)` (DB write throttled to 1/s) and
   `emit_item_event(...)` / `emit_task_event(task_id, "progress"|"item"|..., data)` from
   `crate.db.events` for the task log. Read-model changes: `append_domain_event(...)` from
   `crate.db.domain_events`, with `session=` inside the write transaction (outbox).
8. Tests (below), plus the contract test that keeps steps 2 and 3 in sync.

## Hard rules

- Idempotent handlers. Retries, stale-pending redispatch and Dramatiq redelivery re-run the
  whole handler. Write to temp paths and `os.replace`; upsert instead of insert; re-check state
  before destructive steps.
- Filesystem writes to `/music` only from tasks on `default`, `fast` or `maintenance`.
  `heavy` and `playback` containers mount `/music:ro` in both dev and production compose.
- Pick the queue by behaviour: `fast` = short interactive I/O (enforced by
  `tests/test_task_queue_routing.py`); `default` = user-initiated mutations, imports, downloads;
  `maintenance` = deferrable scheduled/batch; `heavy` = CPU/DSP; `playback` = stream variants.
  Priority 0 user-facing, 1 follow-ups, 2 scheduled, 3 background batch.
- Set `time_limit_seconds` to a realistic upper bound; long loops must chunk or delegate
  (see `enrich_artists`, `analysis._try_complete_parent`) instead of raising the limit.
- Cooperative cancellation: poll `is_cancelled(task_id)` (`worker_handlers/__init__.py`) between
  items in any loop longer than a few seconds and return early.
- No DB transport outside `crate/db/` (`tests/test_db_access_boundaries.py`) and no new imports
  from the `crate.db` facade (`tests/test_runtime_boundaries.py`).
- Do not enqueue per-item tasks inside large loops; batch, or let daemons claim work.
- Never rebuild snapshots inline from handlers on hot paths; emit a domain event and let
  `crate-projector` warm them.
- Daemons claim with `FOR UPDATE SKIP LOCKED` (`db/jobs/analysis_claims.py`,
  `analysis_processing_sql.py`) and release claims when `resource_governor` says pause.
  Reuse that pattern for new continuous pipelines instead of task-per-track.

## Pitfalls

- `TASK_HANDLERS` keys and `TASK_POOL_CONFIG` keys must match exactly; a missing config makes
  `create_task` fall back to `default` / 1800s / 0 retries and no actor exists to run it.
- `DB_HEAVY_TASKS` in `db/repositories/tasks_shared.py` is the single source for the DB-heavy
  mutex, the admin gate display and legacy claims; `actors.DB_HEAVY_TASK_TYPES` is derived from it.
- `max_retries` in config drives both Dramatiq and the DB `retry_count`; non-idempotent work
  must keep it at 0.
- Deferred tasks stay `pending` and look stuck in the admin UI; check `progress` for the
  governor/download-window reason before "fixing" them.
- `analyze_tracks`, `analyze_all`, `compute_bliss`, `analyze_album_full` only reset pipeline
  state; the daemons in `crate-analysis-worker` do the real work.
- Album/track ZIP downloads are built by the Rust `crate-media-worker`, called over HTTP from
  `api/browse_album.py` / `api/browse_media.py` (`media_worker.py`), not via Dramatiq. Its Redis
  stream events are bridged into `task_events` only when the job id equals a task id
  (`media_worker_progress.bridge_media_worker_task_events`). The `crate_download` task builds
  crate ZIPs in Python into the download cache.
- `scrobble_play_event_actor` is a direct actor with no task row; follow that pattern only for
  invisible, high-volume follow-ups.

## Testing

Run from `app/` (no Docker needed; PG-backed tests skip without Postgres):

```bash
../.venv/bin/python -m pytest tests/test_task_runtime_contract.py tests/test_task_queue_routing.py tests/test_actors.py tests/test_task_dedup.py -q
../.venv/bin/python -m pytest tests/test_runtime_boundaries.py tests/test_db_access_boundaries.py -q
../.venv/bin/python -m pytest tests/test_projector.py tests/test_projector_daemon.py tests/test_domain_event_outbox.py tests/test_scheduler.py tests/test_analysis_daemon.py tests/test_media_worker_progress.py tests/test_resource_governor.py -q
```

Handler tests call `_handle_<name>(task_id, params, config)` directly and monkeypatch the
`crate.db.*` functions (model: `tests/test_jam_worker.py`, `tests/test_management_handlers.py`).
Cover: happy path result dict, skip/failed result shapes, cancellation, and a second run
(idempotency). Full suite in Docker: `docker compose -f docker-compose.dev.yaml exec worker pytest tests/ -v`.

- `task_registry.py` icons are emojis meant for Telegram notifications only; the admin UI renders
  its own status icons. Never surface them in UI text.
