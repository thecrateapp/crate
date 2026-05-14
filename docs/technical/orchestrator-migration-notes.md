# Orchestrator vs Dramatiq — Feature Audit

> Generated: 2026-05-10
> Scope: `app/crate/orchestrator.py` (legacy) vs `app/crate/worker.py` + `app/crate/actors.py` (Dramatiq)

---

## Unique orchestrator.py features

| Feature                              | Status in Dramatiq | Notes / Gap                                                                                                                                                           |
| ------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Multiprocess pool with autoscale** | ❌ Missing         | Orchestrator scales workers up/down based on pending task count every 30s. Dramatiq uses a fixed `--processes` count; no queue-depth autoscale.                       |
| **RSS-based recycle (>1.5 GB)**      | ⚠️ Partial         | `actors.py` `_check_memory()` sends SIGUSR1 when RSS > 1.5GB, triggering Dramatiq restart. **Gap**: no per-task RSS check during execution; only checked at task end. |
| **Task count-based recycle (>200)**  | ❌ Missing         | Orchestrator child processes exit after completing 200 tasks. Dramatiq processes run indefinitely (until RSS limit or external restart).                              |
| **`LibraryWatcher` in main process** | ✅ Present         | `worker.py` `_run_service_loop()` starts `LibraryWatcher` in a background daemon thread. Same behavior as orchestrator.                                               |
| **Cleanup de zombie/orphaned tasks** | ✅ Present         | `worker.py` calls `cleanup_orphaned_tasks()` on startup and `cleanup_zombie_tasks()` + `redispatch_stale_pending_tasks()` in the service loop.                        |

---

## Detailed gaps

### 1. Autoscale

- **Orchestrator**: `_autoscale()` checks `pending_count` vs `current` workers every 30s. Spawns new workers if `pending > current` and `current < max`.
- **Dramatiq**: Fixed `--processes` CLI argument. No dynamic scaling based on queue depth.
- **Migration path**: Evaluate `dramatiq` `--processes` bump via supervisor or container orchestrator (e.g. Docker Compose `deploy.replicas` with HPA). Alternatively, wrap Dramatiq CLI in a thin supervisor that adjusts `--processes` and restarts.

### 2. Task-count recycle

- **Orchestrator**: `_worker_process_entry()` breaks its `while` loop after `tasks_completed >= max_tasks` (default 200).
- **Dramatiq**: Processes never recycle on task count. Memory leaks in long-running handlers accumulate indefinitely (mitigated only by RSS check).
- **Migration path**: Add a task counter to `_execute_task()` in `actors.py` and call `sys.exit(0)` or `os.kill(os.getpid(), signal.SIGUSR1)` after N tasks. Dramatiq will restart the process.

### 3. Per-task RSS check

- **Orchestrator**: Checks RSS at the top of every task-claim loop, before claiming a new task.
- **Dramatiq**: Checks RSS only in `_execute_task()` `finally` block, after the task finishes.
- **Migration path**: Move `_check_memory()` to the start of `_execute_task()` so heavy tasks trigger recycle sooner.

---

## No action required (parity achieved)

- **Filesystem watcher**: `worker.py` service loop starts `LibraryWatcher` identically.
- **Zombie/orphan cleanup**: `worker.py` service loop runs the same cleanup functions.
- **Signal handling**: Both handle SIGTERM/SIGINT gracefully.
- **Worker status cache**: `worker.py` updates `worker_status` cache every 15s.

---

## Decision

Do **not** delete `orchestrator.py` until:

1. Task-count recycle is implemented in `actors.py`.
2. Autoscale strategy is documented (supervisor/HPA vs. custom wrapper).
3. RSS check is moved to task-start in `actors.py`.
