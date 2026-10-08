# app/crate/db — Database layer

Scope: everything under `app/crate/db/` (PostgreSQL 15 via SQLAlchemy 2.0 + Alembic).
Platform-wide rules (API is read-only on `/music`, worker-only filesystem writes,
deploy, testing policy) live in the root `AGENTS.md`; this file only covers the DB layer.

## Directory map

| Path                                                       | Use it for                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tx.py`                                                    | `transaction_scope()` (commit/rollback), `read_scope()` (always rolls back), `optional_scope(session)` (reuse caller session or open a _write_ scope), `register_after_commit(session, cb)` (side effects such as task dispatch only after commit) |
| `engine.py`                                                | Engine/session factory, `reset_engine()`. Only `get_pool_runtime` may be imported outside `db/`                                                                                                                                                    |
| `queries/`                                                 | Read-only SQL (`text()`), analytics, browse, bliss, home. Enforced read-only (see Tests)                                                                                                                                                           |
| `repositories/`                                            | Writes and domain persistence (upserts, playlists, auth, crates, tasks). Reads that pair with writes may live here too (`*_reads.py`)                                                                                                              |
| `jobs/`                                                    | Batch/daemon/maintenance DB work for worker handlers (claims, backfills, repair, popularity)                                                                                                                                                       |
| `orm/`                                                     | SQLAlchemy 2.0 `Mapped` models. `orm/contract.py:ACTIVE_ORM_MODELS` is checked against the live schema                                                                                                                                             |
| `models/`                                                  | Pydantic output models for DB results                                                                                                                                                                                                              |
| `schema_sections/`                                         | Idempotent DDL used by `schema_bootstrap.create_schema()` (called by migration `001`) and, for newer features, by the migration itself (`crates_v099/v100/v102.py`)                                                                                |
| `migrations/versions/`                                     | Alembic revisions `001`..`106`, linear, 3-digit string ids                                                                                                                                                                                         |
| `ui_snapshot_*.py`, `snapshot_events.py`                   | `ui_snapshots` read model: `get_or_build_ui_snapshot()` (read, else build + upsert with `source_seq`), `mark_ui_snapshots_stale()`, Redis pub of snapshot versions                                                                                 |
| `domain_events.py`, `domain_event_outbox.py`               | Transactional outbox: `append_domain_event(..., session=s)` enqueues in the caller's transaction; relay publishes to Redis Streams; projector consumes                                                                                             |
| `init_db.py`, `core_migrations.py`, `core_provisioning.py` | Startup: advisory lock, `alembic upgrade head`, seeds                                                                                                                                                                                              |
| `db/*.py` (flat)                                           | Legacy/compat facades (`library.py`, `auth.py`, `tasks.py`, `cache.py`, ...) and long-lived surface/home/ops modules. Do not add new flat facades                                                                                                  |
| `__init__.py`                                              | FROZEN compatibility facade (461 lines). Never add exports                                                                                                                                                                                         |

Table families: `library_*` (local files: `library_artists/albums/tracks`) vs
`global_catalog_*` (federated catalog: `global_catalog_artists/albums/tracks`, `_sources`,
`_search_documents`, ...). Admin browse/mutations must stay on local `library_*`
queries/repositories (`tests/test_admin_local_catalog_boundary.py`). Listen/global reads go
through `queries/global_catalog.py` and `jobs/global_catalog_*`.

## The session / `_impl` pattern

Every public DB function accepts `*, session: Session | None = None` so callers can compose
several calls into one transaction. Real example (`queries/crates.py:resolve_crate_ref`):

```python
def resolve_crate_ref(ref: str, *, session: Session | None = None) -> str | None:
    ...
    def _impl(current: Session) -> str | None:
        return current.execute(
            text("SELECT id::text FROM crates WHERE short_code = :short_code"),
            {"short_code": short_code},
        ).scalar_one_or_none()

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)
```

Writes use the same shape with `optional_scope` (`repositories/library_quarantine.py:quarantine_album`):
`with optional_scope(session) as s: return _impl(s)`. Note `optional_scope(None)` opens a
`transaction_scope` (commits), so in `queries/` prefer the explicit `read_scope()` branch above.
Each module ends with an explicit `__all__` listing its public names.

## Hard rules

1. All `session.execute`, `transaction_scope`, `read_scope`, `optional_scope`, `text`/`select`/`insert`/`update`/`delete`/`Session` imports stay inside `crate/db/`. Callers import concrete functions.
2. Nothing outside `crate/db/__init__.py` may `from crate.db import ...` / `import crate.db`. Legacy flat modules (`library`, `auth`, `playlists`, `shows`, `user_library`, `social`, `management`, `radio`, `tasks`, `cache`, `read_models`, `admin_surfaces`) may only be imported by their compat shims.
3. `queries/` never imports `transaction_scope` and never contains a string literal starting with `INSERT`/`UPDATE`/`DELETE`/`MERGE`. Writes go in `repositories/` or `jobs/`.
4. Thin facades stay thin: `queries/home.py`, `queries/auth.py`, `queries/genres.py`, `ui_snapshot_store.py`, `ops_snapshot.py`, `repositories/library*.py` facades, etc. must not import SQLAlchemy or open scopes; put SQL in the concrete split module.
5. Snapshot rebuilds belong in the projector/worker (`get_or_build_ui_snapshot` + domain events), not in HTTP handlers.
6. Side effects tied to a write (dispatch, events) go through `register_after_commit` or `append_domain_event(session=...)`, never fire-and-forget before commit.
7. Shipped migrations and their `schema_sections/*_vNNN.py` DDL are immutable.

Performance (library_tracks ~48K rows, hot HTTP paths):

- No `COUNT`/`SUM`/`AVG` over `library_tracks` per request; precompute into stats/snapshot tables.
- Batch lookups with `WHERE id = ANY(:ids)`; never loop single-row queries (N+1).
- Consolidate related reads into one CTE query and one `read_scope()` per request; pass the session down via `session=`.
- New indexes on large tables: `CREATE INDEX CONCURRENTLY` (pattern below).

## How to add a read query

1. Pick/create a module in `queries/<domain>_<topic>.py`; keep `from sqlalchemy import text`, `from crate.db.tx import read_scope`.
2. Write `def fn(..., *, session: Session | None = None)` with the `_impl` pattern; return plain dicts (`.mappings()`) or a `models/` Pydantic object.
3. Add it to the module `__all__`. Do not touch `crate/db/__init__.py`.
4. Import it from the router/service as `from crate.db.queries.<module> import fn`.

## How to add a write

1. Put it in `repositories/<domain>_*.py` (request-driven) or `jobs/<domain>.py` (worker/daemon/batch).
2. Use `optional_scope(session)` (composable) or `transaction_scope()` (self-contained job). ORM for simple CRUD on `orm/` models, `text()` for bulk/complex SQL.
3. Emit domain events in the same session (`append_domain_event(..., session=s)`) if snapshots/projector must react; use `register_after_commit` for task dispatch.

## How to add a migration

1. Next id = current head + 1 (`ls migrations/versions | tail`). File `NNN_snake_name.py` with `revision = "NNN"`, `down_revision = "<prev>"`, `branch_labels = None`, `depends_on = None`. No autogenerate (`env.py` has `target_metadata=None`); write raw SQL via `op.execute`.
2. DDL must be idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DO $$ ... IF NOT EXISTS (pg_constraint) $$`): migration `001` builds the current bootstrap schema, then `002+` re-run on top.
3. For non-trivial feature DDL, put it in `schema_sections/<feature>_vNNN.py` as `create_<feature>_vNNN_schema(cur)` and call it from both `upgrade()` (pass `op`) and the bootstrap section (e.g. `curation_crates.py`). Keep that file immutable after release.
4. Large-table indexes:
   ```python
   with op.get_context().autocommit_block():
       op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_x ON t (...)")
   ```
   (see `080_user_listening_hotpath_indexes.py`). Write a real `downgrade()` (`DROP ... IF EXISTS`).
5. If you add/change columns on a model in `ACTIVE_ORM_MODELS`, update the `orm/` mapping in the same PR.
6. Update `tests/test_crate_schema_definition.py::test_crate_migration_follows_the_current_main_head` (`get_heads() == ["NNN"]`) and add a migration test (pattern: `RecordingExecutor` + monkeypatched `op`, or source assertions like `tests/test_user_listening_hotpath_migration.py`).

## Listening stats projections

`user_play_events` is the source of truth; `jobs/user_listening_projections.py` derives
`user_track_daily`, `user_daily_listening`, `user_hourly_listening`, `user_entity_firsts`,
`user_listening_sessions` and the `user_*_stats` windows (see
`docs/technical/listening-stats-projections.md`).

- Any write to `user_play_events` calls `mark_listening_day_dirty(session, ...)` in the same
  transaction. The worker refresh only recomputes dirty local days.
- Day boundaries use `users.timezone`; never bucket listening by UTC date.
- `rebuild_user_listening_projections` is the reference result. Change the incremental path and the
  rebuild together; `tests/test_user_listening_projections.py` compares them.
- Stats queries read the projections, never `user_play_events` or `library_tracks` aggregates per
  request.

## Testing

- `pg_db` fixture (`tests/conftest.py`): clones a migrated + seeded template DB (`crate_test_*`) per test and yields the `crate.db` module. PG source cascade: env `CRATE_POSTGRES_*` (forced to db `crate_test`, never the dev DB) -> Testcontainers `pgvector/pgvector:pg15` -> skip.
- Run from `app/`:
  ```bash
  ../.venv/bin/python -m pytest tests/test_db_access_boundaries.py tests/test_db_facade_exports.py tests/test_runtime_boundaries.py -q
  ../.venv/bin/python -m pytest tests/test_orm_schema_contract.py tests/test_crate_schema_definition.py tests/test_db_architecture_adapters.py -q
  ```
  (~70s for both sets, mostly the template build.)
- What the guard tests enforce:
  - `test_db_access_boundaries.py`: no `transaction_scope`/`get_db_ctx` calls, `.cursor()`/`.raw_connection()`, `session.execute`/`cur.execute`, scope imports from `crate.db.tx`, non-`get_pool_runtime` imports from `crate.db.engine`, or `Session/select/insert/update/delete/text` imports from sqlalchemy in any path without a `db` directory part; `queries/` read-only (rule 3); a listed set of refactored modules never import the facade; `get_db_ctx` gone everywhere.
  - `test_db_facade_exports.py`: every public top-level function in each flat module the facade imports from (except `engine.py`/`tx.py`) is re-exported by `crate.db`. Adding a public function to e.g. `db/tasks.py` breaks this; add new functions in concrete modules instead.
  - `test_runtime_boundaries.py`: rule 2 and the thin-facade checks of rule 4.
  - `test_orm_schema_contract.py`: `ACTIVE_ORM_MODELS` tables equal the expected 12 and have zero drift vs the migrated head: PK, every ORM column present with same nullability and type family, single-column FKs incl. `ON DELETE`, ORM uniqueness enforced by a DB constraint/index. Extra DB columns are allowed.
  - `test_db_architecture_adapters.py`: advisory lock owns one raw connection for its lifetime; post-fork engine reset; repository reads own their `read_scope`.

## Pitfalls

- `optional_scope(None)` commits; it is not a read scope.
- Expression indexes are ignored by the ORM unique-set contract; real unique constraints are not.
- `CREATE INDEX CONCURRENTLY` fails inside a transaction; always wrap in `autocommit_block()`.
- The facade (`__init__.py`) imports many modules at once; importing `crate.db` in tests is fine, in runtime code it is a test failure.
- `conftest.py` comment says the fixture "drops the entire public schema"; it now clones/drops per-test databases instead.
