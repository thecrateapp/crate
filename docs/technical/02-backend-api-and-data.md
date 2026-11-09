---
title: Backend API and data layer
summary: FastAPI, PostgreSQL and projection contracts.
section: architecture
audience: [developer]
status: canonical
order: 60
verified: 2026-10-21
sources:
  - app/crate/api
  - app/crate/api/error_inbox.py
  - app/crate/error_inbox/views.py
  - app/crate/db
  - app/crate/projector.py
  - app/crate/db/user_stats_dashboard_surface.py
  - app/crate/db/instance_stats_dashboard_surface.py
  - app/crate/db/jobs/user_listening_projections.py
  - app/crate/db/domain_events.py
  - app/readplane/internal/routes/stats_dashboard.go
  - app/readplane/internal/snapshots/store.go
  - app/tests/test_user_listening_projections.py
  - app/tests/test_user_stats_dashboard_surface.py
  - app/tests/test_instance_stats_dashboard_surface.py
  - app/tests/test_projector.py
  - app/readplane/internal/routes/stats_dashboard_test.go
  - app/readplane/internal/snapshots/store_test.go
---

# Backend API and Data Layer

## FastAPI application structure

The application factory lives in `app/crate/api/__init__.py`.

Important characteristics:

- `create_app()` builds the FastAPI app.
- startup calls `init_db()` and the MusicBrainz initializer.
- request JSON serialization goes through Crate's custom JSON helpers.
- CORS is configured for admin/listen web origins, dev Vite ports, and native
  shell scenarios.

## Middleware stack

Three custom middlewares matter most:

- `AuthMiddleware` — user/session hydration and request auth handling
- `CacheInvalidationMiddleware` — emits invalidation events after write
  requests
- `MetricsMiddleware` — records API counters and latency

This means auth, cache invalidation, and metrics are not just route-local
concerns; they are part of the global request lifecycle.

## Router organization

Routers are grouped by domain under `app/crate/api`.

Notable route groups:

- `auth.py`: login, logout, provider discovery, OAuth flows, sessions, invites
- `me.py`: home discovery, likes, follows, saved albums, play events, stats,
  history, feed, and upcoming
- `playlists.py`: native playlists, collaboration, and playlist invites
- `social.py`: public profiles, user search, follows, and affinity
- `radio.py`: radio seeds and continuation
- `jam.py`: jam rooms, invites, and websocket-connected state
- `bandcamp.py`: per-user Bandcamp connection, collection sync, owned-purchase
  import, Radar, artist/album links, match management, and contribution export
  / withdrawal
- `subsonic.py`: Open Subsonic-compatible surface under `/rest`
- `acquisition.py`, `tidal.py`, `imports.py`, `scanner.py`, `tasks.py`,
  `settings.py`, `stack.py`, `enrichment.py`: admin and operational domains

### Registration order matters

Browse routers contain `{name:path}`-style catch-alls, so route registration
order in `app/crate/api/__init__.py` is important. Specific routes must remain
registered before browse routers or they can become unreachable.

## Data access layer

The DB layer lives under `app/crate/db`.

### Connection management

`app/crate/db/core.py` still provides the legacy psycopg2 pool and the
authoritative bootstrap entrypoint:

- DSN construction from environment variables
- optional DB provisioning
- `ThreadedConnectionPool`
- `init_db()` with PostgreSQL advisory locking
- Alembic bootstrap/upgrade orchestration

`app/crate/db/engine.py` provides the SQLAlchemy engine/session runtime used by
most modern code.

`app/crate/db/tx.py` defines the transaction helpers used by new runtime code:

- `transaction_scope()`
- `read_scope()`
- `optional_scope()`
- `register_after_commit()`

The preferred pattern for new code is explicit SQLAlchemy `Session` work inside
`transaction_scope()`.

### Schema bootstrap

The runtime bootstrap is now **Alembic-only**.

Current `init_db()` behavior in `app/crate/db/core_provisioning.py`:

1. acquire an advisory lock
2. run `alembic upgrade head`
3. attempt optional observability extension setup
4. seed genre taxonomy and admin user inside one transaction

The older “hybrid `_create_schema()` plus frozen runtime migration bridge”
model is no longer the active startup path.

## Module boundaries

The DB layer has been split by responsibility:

- `db/queries/*` — read-heavy SQL helpers
- `db/jobs/*` — daemon, batch, repair, and claim/update helpers
- `db/repositories/*` — write-oriented and domain-specific persistence helpers
- `db/orm/*` and `db/models/*` — selected ORM-backed CRUD domains
- `db/*.py` — compatibility facades and long-lived entrypoints

`crate.db` itself should now be treated as a compatibility facade. New code
should prefer importing concrete modules directly.

## Major table families

### Core library tables

- `library_artists`
- `library_albums`
- `library_tracks`
- `genres`, `artist_genres`, `album_genres`
- taxonomy graph tables

These still hold the canonical indexed library and much of the enriched entity
state.

### Operational tables

- `tasks`
- `task_events`
- `cache`
- `settings`
- `audit_log`
- `worker_logs`

These power system operation rather than library content.

### User/product tables

- `users`
- `sessions`
- `user_external_identities`
- follows, likes, saved albums
- playlists and collaboration tables
- jam room tables
- social/affinity state
- listening telemetry tables

### External ownership and contribution tables

Bandcamp and user uploads add a provenance layer on top of the shared library:

- `credential_secrets` stores encrypted external session material by opaque
  reference. Production should use a stable `CRATE_CREDENTIAL_KEY`.
- `bandcamp_connections` stores one Bandcamp connection per Crate user.
- `bandcamp_items` caches Bandcamp collection, wishlist, following, and linked
  release/track/artist items.
- `user_bandcamp_items` records which user owns, follows, or saved each
  Bandcamp item.
- `bandcamp_imports` tracks purchase-import tasks and imported Crate entity
  references.
- `bandcamp_library_matches` links Bandcamp items to Crate artist/album/track
  `entity_uid`s and syncs confirmed URLs back to `library_artists` and
  `library_albums`.
- `bandcamp_radar_items` stores user-scoped Bandcamp discovery candidates.
- `library_contributions` records albums a user added through Bandcamp or
  uploads, and powers portable export plus withdrawal.

## Read plane tables

The new read plane introduced several important tables:

- `ui_snapshots` — persisted snapshot payloads keyed by scope/subject
- `ops_runtime_state` — small, fast operational state blobs
- `import_queue_items` — normalized read model for import sources

There is also a compatibility facade at `app/crate/db/read_models.py` that
re-exports snapshot/runtime helpers without pushing new code back into
`crate.db.__init__`.

## Pipeline shadow tables

The analysis/bliss pipeline no longer relies only on legacy columns inside
`library_tracks`.

Important tables:

- `track_processing_state`
- `track_analysis_features`
- `track_bliss_embeddings`
- `track_popularity_features`

### Operational truth

`track_processing_state` is now the operational truth for claim/retry/recovery
in the analysis and bliss pipelines.

The shadow feature tables are the preferred source for new queries and status
surfaces. Legacy columns in `library_tracks` are still mirrored for
compatibility, but they are no longer the intended primary pipeline contract.

## Cache architecture

Crate uses a three-tier cache strategy:

### L1: in-process memory

- very fast
- process-local
- TTL-based

### L2: Redis

- shared across API and worker
- used for cache keys, invalidation replay, metrics buckets, and coordination

### L3: PostgreSQL fallback

- persistent across restarts
- used when Redis is unavailable or for compatibility fallbacks

Redis also serves a second role as the Dramatiq broker on DB 1.

## Domain events and snapshot projection

Crate now has an explicit domain-event bus in `app/crate/db/domain_events.py`.

Important properties:

- backed by Redis Streams
- consumer group used by the projector
- publishing can be deferred with `register_after_commit()`
- runtime includes diagnostics for sequence, lag, pending count, and recent
  events

Current notable event types include:

- `ui.invalidate`
- `ui.snapshot.updated`
- `library.acquisition.completed`
- `track.analysis.updated`
- `track.bliss.updated`
- `user.play_event.recorded`
- `user.listening_aggregates.updated`

`app/crate/projector.py` consumes those events and warms affected read models
such as:

- admin ops snapshots
- user home discovery snapshots

This is why many UI surfaces now behave like warmed read models rather than
live recomputation on every request.

For catalog/import changes, cache invalidation clears backend cache before the
event is published. The projector treats global scopes such as `home`,
`library`, `upcoming`, `curation`, `playlists`, `artist:*`, `album:*`, and
`playlist:*` as home-relevant and warms recent user home snapshots. Listen also
subscribes to the replayable cache invalidation SSE feed as a fallback, so home
sections such as Just Landed can refresh even if the snapshot stream reconnects
late.

## Listening telemetry model

The canonical listening telemetry table is now `user_play_events`.

Key properties:

- richer schema than the old `play_history`
- `client_event_id` supports idempotent retries per user
- captures timing, source attribution, device/app metadata, and completion
  semantics
- drives user listening aggregates and stats surfaces

`POST /api/me/play-events` is the preferred write path.

The older `play_history` table and `POST /api/me/history` endpoint remain only
as compatibility surfaces and should not be treated as the primary model.

Scrobbling is no longer performed inline in the telemetry write transaction; it
is queued as an asynchronous follow-up actor after commit.

## Authentication on the backend

The backend auth surface combines:

- password login
- Google OAuth
- Apple OAuth
- persisted sessions
- bearer-token identity for native Listen clients
- invite flows
- session list/revoke endpoints

JWT still exists, but it is not the whole story: session rows in PostgreSQL are
the management and revocation layer that sits behind the token.

## Subsonic compatibility

`app/crate/api/subsonic.py` exposes a parallel surface under `/rest`.

This is additive to Crate's native API and exists so the server can act as a
source for Open Subsonic-compatible clients.

## Design decisions in the backend layer

### Why hybrid SQLAlchemy plus explicit SQL

Crate intentionally mixes:

- SQLAlchemy `Session` and selected ORM-backed CRUD helpers for transactional
  domains such as auth, sessions, settings, and some write flows
- explicit SQL for queues, browse/search, analytics, read models, and pipeline
  claim/update logic

That keeps high-complexity SQL visible while still gaining transaction and
composition ergonomics where they help.

## Smart Mix data and HTTP boundaries

Smart Mix section verified against source on 2026-10-21.

Smart Mix persists versioned per-track profiles in `track_mix_profiles`, with claim and
processing state under pipeline `smart_mix`. Source/profile revisions govern publication;
profile reads, planning and compatibility are separate from backfill and coverage refresh.
The Go readplane serves the summary profile surface; full reads and planning retain their
FastAPI contract. Admin control requires `library.analysis.manage`; the Admin status GET can
schedule a coverage refresh, so HTTP method alone does not establish a pure read.
See [Smart Mix operation](smart-mix-operations.md) for current state semantics, provenance,
HTTP boundaries and evidence available to Hermes.

## Error inbox HTTP boundaries

`app/crate/api/error_inbox.py` serves `/api/admin/errors` under the OpenAPI tag `errors`.
Every route reads PostgreSQL (`error_issues`, `error_issue_triage`, `settings` and the
`error_inbox` and `error_inbox_access` rows of `ops_runtime_state`) or enqueues a worker
task. None calls Sentry, GitHub or a model: Investigate and Triage backlog only pin the
action's configuration (`accept_action`) and queue `ai`-lane tasks.

| Route                                                | Capability           | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/admin/errors`                              | `ops.errors.view`    | Issues with the critical lane first. Filters `status`, `lane`, `service`, `classification` and `release` (first or last release); `limit` 1–200 and an opaque `cursor`. A bad filter is `400 ERROR_INBOX_INVALID_FILTER`.                                                                                                                                                                                                      |
| `GET /api/admin/errors/summary`                      | `ops.errors.view`    | Open, critical, new and regressed counts, by service, the top three critical issues, `untriaged` (open issues whose latest event has no triage) and the last sync.                                                                                                                                                                                                                                                             |
| `GET /api/admin/errors/{id}`                         | `ops.errors.view`    | Detail with the digest, triage results (with the model while its invocation record is kept), when automatic triage queued the current digest and the token's known `write_access`; `404 ERROR_ISSUE_NOT_FOUND`.                                                                                                                                                                                                                |
| `POST /api/admin/errors/{id}/investigate`            | `ops.errors.manage`  | Queues `investigate_error_issue` for the latest event and returns `202 {task_id}`, one per issue and event while it is pending. `409 ERROR_ISSUE_NO_DIGEST` or `ERROR_ISSUE_ALREADY_INVESTIGATED`; `503` with the AI code (`AI_ACTION_DISABLED`, ...) when the action has no usable model.                                                                                                                                     |
| `POST /api/admin/errors/triage-backlog`              | `ops.errors.manage`  | Queues `triage_error_issue` for the open issues whose latest event has no triage, highest score first, at most 100, and returns `202 {queued, deduplicated, limit, task_ids}`. `503` when the action has no usable model.                                                                                                                                                                                                      |
| `POST /api/admin/errors/{id}/status`                 | `ops.errors.manage`  | Queues `update_error_issue_status` and returns `202 {task_id}`. `409 ERROR_TRACKING_NOT_CONFIGURED`, or `409 ERROR_TRACKING_WRITE_SCOPE_MISSING` when the token is known to lack `event:write`.                                                                                                                                                                                                                                |
| `POST /api/admin/errors/{id}/fix`                    | `ops.errors.manage`  | Launch fix: queues `dispatch_error_fix` with the issue and an optional `note` (at most 500 characters) and returns `202 {task_id}`. `409 ERROR_FIX_NOT_CONFIGURED`, `ERROR_FIX_UNSUPPORTED_ISSUE`, `ERROR_FIX_RECENTLY_REQUESTED` or `ERROR_FIX_IN_PROGRESS`.                                                                                                                                                                  |
| `POST /api/admin/errors/{id}/fix-runs/{run}/merge`   | `ops.errors.manage`  | Approve & merge: body `{head_sha}`, the reviewed commit. Queues `merge_error_fix` and returns `202 {task_id}`. `409 ERROR_FIX_HEAD_CHANGED`, `ERROR_FIX_NOT_MERGEABLE` (with the blockers) or `ERROR_FIX_NOT_CONFIGURED`.                                                                                                                                                                                                      |
| `POST /api/admin/errors/{id}/fix-runs/{run}/discard` | `ops.errors.manage`  | Discard: queues `discard_error_fix` and returns `202 {task_id}`. `409 ERROR_FIX_RUN_CLOSED` or `ERROR_FIX_NOT_CONFIGURED`.                                                                                                                                                                                                                                                                                                     |
| `GET`/`PUT /api/admin/errors/connection`             | `ops.runtime.manage` | Settings, `has_token`, the last access check (reset when a new token is saved) and the last sync. `PUT` validates (`422 ERROR_TRACKING_INVALID`) and stores the token in `credential_secrets`; it is never returned. `fix` carries the Launch fix settings and their write-only GitHub token: omitted keeps them, `null` turns Launch fix off. `triage` (`automatic`, `daily_max` 0–500) omitted keeps the AI triage settings. |
| `POST /api/admin/errors/connection/test`             | `ops.runtime.manage` | Queues `test_error_tracking_connection`, one pending at a time.                                                                                                                                                                                                                                                                                                                                                                |

Errors carry their code in the `X-Crate-Error` header and the message in `detail`. A request
that fails validation is answered with a fixed message, so a body carrying the token is
never echoed. The `ops` role holds both error capabilities; `owner` and `admin` hold all.
The System Health dashboard (`GET /api/admin/metrics/dashboard`) adds `errors`, the same
summary built with one query inside its 10-second cache; it is `null` when the summary
cannot be built. Without `ops.errors.view` the top critical issues come without titles,
which are event text.

## Precalculated listening statistics and snapshot fallback

Verified against implementation and tests on 2026-10-21. `user_play_events` is the event
source, not the dashboard query surface. Accepted events mark listening days dirty;
`db/jobs/user_listening_projections.py` rebuilds affected local days, first plays, sessions
and window aggregates. User timezone changes trigger a rebuild; session boundaries use a
30-minute gap. The aggregate runner serializes a user's projection work. Missing tracks
do not erase listening history. Instance statistics combine listeners; they are distinct
from an individual user's personal statistics and timezone.

The persisted dashboard scopes are `stats:dashboard` (user) and
`stats:dashboard:instance` (Crate Pulse). The subject key includes period and requested
limits; user keys have version `v2`. Both dashboard getters serve a snapshot fresh for
300 seconds, otherwise serve a usable snapshot up to 86,400 seconds old with `stale=true`
and schedule a deduplicated refresh. With no usable snapshot, the response is a cold
placeholder with `snapshot.pending=true`, `version=0`, `provisional=true` and
`computed_until=null`. Its zeroes are not evidence of zero listening. Refresh workers
build the projections and publish snapshots; the HTTP request never rebuilds the dashboard.
Read freshness, `built_at`, `source_seq`, `metrics_version`, timezone and `computed_until`
where available before comparing periods. Personal calendar-year/month windows and
instance rolling windows have different validation; do not assume parity.

The Go stats route authenticates the user and reads the matching persisted subject.
The snapshot store distinguishes fresh, stale-but-usable and expired records using its
scope freshness policy; decorated responses carry snapshot metadata. Missing/unusable
snapshots, store failures and unsupported query shapes try configured FastAPI fallback.
Without fallback, the route returns the corresponding error (including 404 for missing
snapshot and 503 for unavailable store). A readplane `hit` or HTTP 200 is not a claim of
fresh data. FastAPI fallback can enqueue the deduplicated refresh described above, so
this dashboard GET is not a pure operational observation for the Hermes pilot.

Domain writers append PostgreSQL outbox events in their transaction. The relay publishes
them to Redis Streams; the projector coalesces affected work and acknowledges only events
whose required projection actions succeed. Pending events are retried, and a failed
projection does not certify fresh snapshots. `user.play_event.recorded` updates recent
home playback; `user.listening_aggregates.updated` schedules user and instance stats
refreshes. Catalog invalidations can warm recent users' home snapshots. Observe outbox
backlog, stream lag/pending and snapshot age separately; source code alone cannot prove
that the current projector or fallback is healthy.

Implementation: `app/crate/db/user_stats_dashboard_surface.py`,
`app/crate/db/instance_stats_dashboard_surface.py`, `app/crate/db/jobs/user_listening_projections.py`,
`app/crate/db/domain_events.py`, `app/crate/projector.py`,
`app/readplane/internal/routes/stats_dashboard.go` and `internal/snapshots/store.go`.
Regression evidence: `app/tests/test_user_listening_projections.py` (incremental/full
parity, timezone/DST, deleted tracks), `test_user_stats_dashboard_surface.py` and
`test_instance_stats_dashboard_surface.py` (warm/cold reads and refresh scheduling),
`test_projector.py` (poison projection isolation), and
`app/readplane/internal/routes/stats_dashboard_test.go` / `internal/snapshots/store_test.go`.
