# app/crate/api — FastAPI layer

Scope: HTTP routers, Pydantic API schemas, middleware and OpenAPI wiring for `crate-api`.
Platform-wide rules (read-only `/music`, DB facade freeze, deploy) live in the root `AGENTS.md`;
this file only covers what you need when editing `app/crate/api/`.

## Layout

- `__init__.py` — `create_app()`: lifespan bootstrap, middleware stack, OpenAPI variant endpoints, router registration order.
- `<domain>.py` — one router per domain (`router = APIRouter(tags=[...])`); some also export `admin_router` (`auth.py`, `management.py`, `i18n.py`) or `me_router` (`crates.py`).
- `browse.py` aggregates `browse_artist.py`, `browse_album.py`, `browse_media.py`.
- `subsonic/` — Open Subsonic `/rest` layer (`create_subsonic_router()`), own error type `OpenSubsonicError`.
- `schemas/` — Pydantic v2 request/response models; `schemas/__init__.py` re-exports them; shared models in `schemas/common.py` (`ApiErrorResponse`, `TaskEnqueueResponse`).
- `auth.py` (`AuthMiddleware`, `_require_admin`, `_require_users_*`), `auth_dependencies.py` (`require_auth`), `permissions.py` (roles -> capabilities, `require_permission`).
- `openapi.py` (security attachment, tag metadata, variants), `openapi_responses.py` (`AUTH_ERROR_RESPONSES`, `COMMON_ERROR_RESPONSES`, `error_response`, `merge_responses`).
- `cache_events.py` (`CacheInvalidationMiddleware`, `_INVALIDATION_RULES`), `metrics_middleware.py`, `trace_middleware.py`, `cast_cors.py`, `redis_sse.py` (pub/sub helpers for SSE).
- `_deps.py` — `json_dumps`, `library_path()`, `safe_path()`, batched ref helpers (`enrich_radio_tracks`).

## Conventions (taken from existing routers)

Endpoints are plain `def` by default (~810 sync vs ~90 async). FastAPI runs them in the threadpool, which is what makes the blocking DB calls safe. Auth is an imperative call at the top of the handler, not `Depends`:

```python
@router.get(
    "/api/admin/tasks-snapshot",
    response_model=AdminTasksSnapshotResponse,
    responses=AUTH_ERROR_RESPONSES,
    summary="Get the canonical admin tasks snapshot",
)
def api_admin_tasks_snapshot(request: Request, fresh: bool = False, limit: int = 100):
    _require_task_operator(request)          # -> require_permission(request, "ops.tasks.manage")
    return get_cached_tasks_surface(limit=limit, fresh=fresh)
```

(`tasks.py`)

Mutations that touch files or do heavy work queue a task and return `TaskEnqueueResponse`:

```python
actor = require_permission(request, "library.metadata.write")
task_id = create_task("update_artist_metadata", {..., "actor_user_id": actor.get("id")})
return {"task_id": task_id}
```

(`tags.py`; `create_task` / `create_task_dedup` come from `crate.db.repositories.tasks`. `create_task_dedup` returns `None` when deduplicated.)

- Auth: `AuthMiddleware` only resolves `request.state.user` (Bearer -> `?token=` -> `media_ticket` -> cookies -> trusted `Remote-User`). It never rejects anything. Every non-public handler MUST call a guard itself.
  - Logged-in user: `_require_auth(request)`
  - Privileged action: `require_permission(request, "<capability>")` with a capability from `permissions.ALL_CAPABILITIES`
  - `_require_admin` is just `require_permission(request, "admin.access")`. Prefer the narrowest capability (`library.metadata.write`, `ops.tasks.manage`, ...).
- Errors: `raise HTTPException(status_code=..., detail="...")`. Some older routers return `JSONResponse({"error": ...})` (`artwork.py`); `ApiErrorResponse` accepts both shapes, but new code should use `HTTPException`.
- Responses: set `response_model=`, `responses=` (build from `openapi_responses.py`, e.g. `merge_responses(AUTH_ERROR_RESPONSES, {404: error_response("...")})`) and `summary=` on every route. About 300 routes still lack `response_model`; don't add more.
- Pagination: bound `limit` with `Query(default, ge=1, le=N)` (e.g. `Query(50, ge=1, le=100)`) or clamp it (`min(max(limit, 1), 200)` in `tasks.py`). Never accept an unbounded limit.
- SSE: `StreamingResponse(gen, media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})`. Subscribe through `redis_sse.open_pubsub` / `close_pubsub`, emit a heartbeat about every 30s, and push snapshot payloads (`tasks.py::_tasks_stream`).
- JSON: the default response class serializes datetimes. When you serialize DB rows by hand, use `_deps.json_dumps`, not `json.dumps`.

## Hard rules

- NEVER import `sqlalchemy` `text/select/insert/update/delete/Session`, call `session.execute` / `.cursor()` / `transaction_scope`, or import `read_scope` / `transaction_scope` / `optional_scope` in this package. SQL belongs in `crate/db/queries` (read-only) or `crate/db/repositories` / `crate/db/jobs`. Enforced by `tests/test_db_access_boundaries.py`.
- NEVER `from crate.db import ...` here (currently zero occurrences in `api/`). Import concrete modules such as `crate.db.queries.tasks` or `crate.db.repositories.library`.
- NEVER write under `library_path()` from a handler. Tag, move, delete and artwork writes go through `create_task(...)`. Request-scoped scratch space is the only exception: `$DATA_DIR/uploads` staging (`acquisition.py`) and `tempfile.mkdtemp` for downloads cleaned up via `BackgroundTask` (`browse_album.py`).
- NEVER declare an `async def` route that calls sync DB/Redis/HTTP helpers directly. Either use `def`, or wrap the call in `await asyncio.to_thread(...)` / `run_in_threadpool`. Enforced for `auth.py` (`tests/test_api_blocking_boundaries.py`) and `federation.py` (`tests/test_federation_async_boundaries.py`).
- NEVER rebuild snapshots or heavy home/discovery sections inside a request. Serve the cached or stale surface and enqueue a refresh with `create_task_dedup(..., dedup_key=...)` (see `tests/test_listen_read_latency_contract.py` and `crate/db/home_section_surface.py`).
- NEVER aggregate over `library_tracks` in a request path. Use precomputed counts (`library_albums.track_count`, CTE pre-aggregation). The latency contract asserts this on the genre queries.
- NEVER loop over ids calling a per-row repository function (N+1). Batch the lookups the way `_deps.enrich_radio_tracks` -> `enrich_track_refs(track_ids)` does.
- MUST keep any user-supplied path inside the library with `safe_path(library_path(), user_path)` and return 404 when it yields `None`.

## Adding an endpoint

1. Pick the domain router. Create a new module only for a new domain, and if you do, register it in `create_app()`.
2. Watch the registration order. FastAPI matches the first route that fits, so register a literal path (`/api/artists/by-entity/...`) before a parametric sibling (`/api/artists/{artist_id}`) for the same method, in both the module and the `include_router` order. The `{name:path}` routes (`/api/stream/{filepath:path}`, `/api/track-info/...` in `browse_media.py`) are prefixed and must stay that way.
3. Add request/response models to `schemas/<domain>.py` and re-export them from `schemas/__init__.py`.
4. Put the SQL in `crate/db/queries/<x>.py` (reads) or `crate/db/repositories/<x>.py` (writes) and call those functions from the router.
5. Guard the handler with `_require_auth` or `require_permission`. If the path prefix is new, add it to `_AUTH_REQUIRED_PREFIXES` in `openapi.py`; otherwise the OpenAPI doc will show the route as public. OpenAPI security is derived from the path, not from your guard. Public routes go in the `_PUBLIC_*` sets.
6. Use an existing tag from `openapi.py::_TAG_METADATA`. The tag decides which variant spec (`/openapi-app.json`, `/openapi-collection-ops.json`, `/openapi-admin-system.json`) includes the route.
7. If the route is a mutation that should invalidate client caches, add a pattern to `cache_events._INVALIDATION_RULES`. The first match wins, so put specific patterns above broad ones. Do not invalidate `home` on high-frequency writes (see the comment on `/api/me/history`).
8. If the client sends a new request header, add it to `CORS_ALLOWED_HEADERS` in `__init__.py`.
9. If the route is also served by the Go read plane (`app/readplane`: `/api/catalog/*`, `/api/me/home/discovery*`, `/api/auth/me`, ...), keep the JSON shape identical and run `make readplane-contract-smoke`.
10. Add tests: a `test_app` client test, plus an assertion in `tests/test_openapi_contract.py` for the tag, the security entry and the `$ref` of the response schema.

## Testing

From `app/` (host venv; `test_app` mocks auth as an admin user and does not run the lifespan):

```bash
../.venv/bin/python -m pytest tests/test_db_access_boundaries.py tests/test_api_blocking_boundaries.py \
  tests/test_federation_async_boundaries.py tests/test_listen_read_latency_contract.py -q
../.venv/bin/python -m pytest tests/test_openapi_contract.py tests/test_api_security.py -q
../.venv/bin/python -m pytest tests/<file>.py -q -k <name>
```

In Docker: `docker compose -f docker-compose.dev.yaml exec worker pytest tests/<file>.py -q`.
Full isolated suite with lint and pyright: `make dev-test-backend`.

## Pitfalls seen in the code

- `__init__.py` still has the comment "browse has {name:path} catch-all". No such top-level catch-all exists anymore. Ordering still matters for literal vs parametric siblings.
- `_require_auth` has two import paths (`crate.api.auth` re-exports `auth_dependencies.require_auth`). Either works; most routers import it from `crate.api.auth`.
- Async SSE generators that call sync snapshot readers (`get_cached_tasks_surface` in `tasks.py::_tasks_stream`) run on the event loop. Keep those readers cache-only and cheap, or offload them.
- Lifespan startup enqueues bootstrap tasks (`_queue_*` in `__init__.py`). Use `create_task_dedup` with a versioned `dedup_key` so they don't requeue on every API restart.
