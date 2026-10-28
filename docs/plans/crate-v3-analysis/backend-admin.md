# Crate v3 analysis: backend data contracts for the Admin visuals

Scope: every Admin-side visualisation on the new site
(`worktrees/website/app/web/src/components/viz/*.astro`, data in
`src/content/admin/viz.ts`) mapped to the real backend in
`worktrees/crate-v3/app/crate` and `app/readplane`. For each visual: what exists,
whether it can be served within the performance rules, the freshness model, the
exact gaps and a proposed contract. GenreWheel is covered in a separate document
and only gets a pointer here.

Method: read from source only. No test, build or query was run. Paths below are
relative to `app/crate/` unless stated otherwise. Line numbers are from
`feat/crate_v3` on 2026-10-14.

---

## 1. Summary

| Visual | Backing data today | Perf verdict as-is | Freshness today | Main gap |
| --- | --- | --- | --- | --- |
| HealthScan | `REPAIR_CATALOG` (17 checks, risk/scope/confirm), `health_issues`, `health_check_runs`, `ops:health` snapshot + SSE | OK (small tables), but read-through build in request | SSE on mutation signal only; scheduled scans never signal | Per-check duration and found/fixed counts per run; labels live only in the admin frontend |
| AlbumSidecar | `get_portable_album_payload(album_id)` builds the exact `.crate/album.json`; worker writes it atomically | OK per album (scoped, indexed) | Task progress only | No persisted per-album sidecar state (written_at, hash, drift) |
| ReleaseTimeline | `new_releases` (detected, release_date, status, downloaded_at), `promote_due_releases`, `tidal_download`, `process_new_content`, `track_processing_state` | List endpoint and 5 s polling SSE hit the DB per client | Poll every 5 s per SSE connection | No stage timestamps after "downloading"; no release -> album link |
| EnrichmentOrbit | 6 artist sources with TTLs in `enrichment.py`, parallelism 3, 7 secondary sources across modules | Artist enrichment GET can fetch providers inline in the request | None (per-source state is a Redis TTL key) | No persisted per-source fetch state; no per-source live events |
| TrackReadout | All features + 20-float `bliss_vector` per track in `library_tracks` and shadow tables; pgvector HNSW | OK (PK / album_id reads) | Static per track | Raw vector not exposed (track info strips it); loudness / dynamic range units depend on analyzer path |
| QueueLanes | `TASK_POOL_CONFIG` (125 types, 5 queues), `tasks` table, `worker_live` runtime state, tasks snapshot + SSE | OK (small table) | Running/pending lists refresh every 15 s; history every 2 s | No per-queue throughput, pending capped at 12 globally, `recent` has no pool, no worker topology |
| GovernorGauges | `resource_governor.py` (load/iowait/swap/mem/listeners/streams, window, defer) | VIOLATION: `/api/admin/metrics/system` evaluates the governor and counts `library_tracks` in the request | On demand only | Governor never persisted; API container lacks the governor env, so it shows wrong thresholds |

Site numbers check against source: 17 health checks (`repair_catalog.py`),
4 auto / 13 confirm, 125 task types and the queue split
`maintenance 59 / default 37 / fast 26 / heavy 2 / playback 1`
(`actors.py:70`), 30 governed task types (`resource_governor.py:20`), 6 artist
sources with TTLs 7d/3d/30d/1d/30d/30d and parallelism 3 (`enrichment.py:30-77`).

---

## 2. Shared infrastructure the contracts build on

### 2.1 `ui_snapshots`: two patterns in the codebase

1. Read-through (`db/ui_snapshot_building.py:14`, `get_or_build_ui_snapshot`):
   returns the row if younger than `max_age_seconds`, otherwise runs `build()`
   inside the caller (HTTP handler or SSE generator) and upserts. `fresh=true`
   always builds. Used by `ops` (60 s), `ops:health` (30 s), `ops:tasks` (30 s),
   stack and logs surfaces. This is "rebuild snapshot in a request" whenever the
   warmer is late.
2. Serve-stale-and-schedule (`db/instance_stats_dashboard_surface.py:125-200`):
   fresh row -> return; stale row -> return it with `snapshot.stale=true` and
   schedule a deduplicated refresh task; no row -> cold placeholder plus
   schedule. Never builds in the request. This is the pattern every v3 admin
   surface should use.

Who warms what: `crate-projector` (`projector.py:220-297`) only refreshes
`ops/dashboard` (on ops, pipeline, federation, acquisition and invalidation
events), home discovery and stats. Health, tasks, stack and logs snapshots have
no warmer; they live on read-through.

Note on staleness marking: `mark_ui_snapshots_stale` sets
`stale_after = now - 1s`, but `snapshot_age_ok` only treats a row as stale when
`stale_after <= built_at`, so with a `max_age_seconds` argument the mark has no
effect on readers. Harmless today, misleading for v3 code that relies on it.

### 2.2 `ops_runtime_state` (key, payload_json, updated_at)

| Key | Writer | Cadence |
| --- | --- | --- |
| `worker_live` | `worker.py:336-445` service loop (crate-worker only) | 15 s |
| `analysis_status` | `worker.py:450-466` (COUNT over `library_tracks`, off-request) | 120 s |
| `public_status` | `db/ops_snapshot_pipeline.py:103` | with each ops build |
| import queue keys | `db/import_queue_*` | on change |

This table is the right home for small, frequently rewritten machine state
(governor samples, queue lanes). One upsert per tick on a single PK row is cheap.

### 2.3 Realtime channels

| Channel | Publisher | Consumer |
| --- | --- | --- |
| `crate:sse:task:{task_id}` | `db/events.py` `emit_task_event` (also inserts `task_events`, mirrors info/warn/error/item to `worker_logs`) | `GET /api/events/task/{task_id}` |
| `crate:sse:global` | every task event and task_done | `GET /api/events` (rebuilds a status payload per message) |
| `crate:sse:admin:tasks` | `db/repositories/tasks_shared.py:64` after every task commit (progress writes throttled to 1/s) | `GET /api/admin/tasks-stream` (debounced 2 s) |
| `crate:sse:admin:health` | API health mutations and `_handle_repair` only | `GET /api/admin/health-stream` |
| `crate:sse:snapshot[:{scope}:{subject}]` | `upsert_ui_snapshot` | `GET /api/admin/ops-stream` (ops/dashboard) |
| `crate:sse:cache-invalidation` | `broadcast_invalidation` | `GET /api/cache/events` (FastAPI and Go read plane) |
| `crate:domain_events` (Redis Stream) | outbox relay | projector only |

Task progress is not pushed: `emit_progress` only writes `tasks.progress`
(throttled to 1 write/s, `task_progress.py:131`); clients see it through the
tasks snapshot.

Each SSE connection holds its own Redis pubsub connection from a pool capped at
128 (`api/redis_sse.py`). Today the admin keeps `ops-stream` (context),
`/api/events` (notifications) and per-page `health-stream` / `tasks-stream`
open. One more stream per visual does not scale; see section 5.

### 2.4 Metrics

`metrics.py` stores per-minute Redis buckets keyed by metric name only
(`_bucket_key(name, minute)`), flushed to `metric_rollups` every 5 min. Tags are
written once per bucket with `SET NX` (`metrics.py:207`), so they are not
dimensions: `worker.resource.deferred{reason=...}` and
`worker.task.duration{type=...}` cannot be broken down by tag. Any per-reason or
per-queue count needs its own counter.

### 2.5 Go read plane

No admin routes (`app/readplane/internal/routes/server.go:103-140`). Auth knows
only `role`, not the permission strings the admin endpoints check
(`ops.tasks.manage`, `library.maintenance.manage`, ...). Admin traffic is one or
two operators, so the read plane buys nothing here. Recommendation: keep admin
surfaces on FastAPI, but make the handlers snapshot-only (pattern 2) and do DB
reads off the event loop. Revisit the read plane only for Listen-facing visuals.

---

## 3. Existing violations and hazards found on the way

| # | Where | What | Rule | Severity | Fix |
| --- | --- | --- | --- | --- | --- |
| V1 | `api/admin_metrics.py:173` -> `db/jobs/analysis_status.py:17` | `/api/admin/metrics/system` and `/metrics/dashboard` call `get_analysis_status()`: `SELECT COUNT(*) FROM library_tracks` plus a fallback inferred-state scan, per request. SystemHealth page loads it. | No COUNT on `library_tracks` in HTTP | High | Read `ops_runtime_state('analysis_status')` (already refreshed every 120 s) like `/api/manage/analysis-status` does |
| V2 | `api/admin_metrics.py:199` | Same endpoint runs `evaluate_resources()` in the API: samples `/proc/stat` with a 50 ms sleep, runs two counts over `user_play_events`, and uses API env. `crate-api` has no `CRATE_RESOURCE_*` / `CRATE_MAINTENANCE_WINDOW_*` env (compose 251-386), so it shows code defaults (10 listeners, window disabled) while workers run with 0/0 and the window enabled. | Heavy work in request; wrong data | High | Sample in the worker, persist (section 4.7) |
| V3 | `db/ops_snapshot.py` + `db/ops_snapshot_pipeline.py:63` + `db/queries/analytics_overview_stats.py:46` | `ops/dashboard` build runs COUNT/SUM/AVG over `library_tracks`. Read-through with 60 s max age: when the projector has had no event for 60 s, the next `/api/admin/ops-snapshot`, `/api/events`, `/api/worker/status`, `/api/stats`, `/api/manage/analysis-status` request builds it. `?fresh=true` always builds. | Snapshot rebuild in request; COUNT on `library_tracks` in HTTP | High | Pattern 2 (serve stale + schedule); projector or service loop warms on a timer; drop `fresh` from HTTP |
| V4 | `api/admin_ops.py:44`, `api/management.py:191`, `api/events.py:92` | SSE generators call `get_cached_*` synchronously inside `async def`: DB reads (and V3 rebuilds) run on the event loop. `/api/events` does it once per `crate:sse:global` message per client, i.e. per task event during scans. | SSE must not do heavy work per message | High | `asyncio.to_thread`, debounce like `tasks-stream`, snapshot-only reads |
| V5 | `projector.py:31-32` + `db/jobs/analysis_state_events.py:11` | Every analysed track emits `track.analysis.updated` / `track.bliss.updated`; each projector batch then rebuilds `ops/dashboard` (V3 query set) roughly every 5 s for as long as the analysis daemons run. Off-request but continuous load on 48K rows. | Worker-side cost | Medium | Coalesce pipeline-only events to one ops refresh per 60 s |
| V6 | `api/acquisition.py:164,190` | `/api/acquisition/stream` (3 s) and `/new-releases/stream` (5 s) poll the DB per connected client; `get_new_releases` joins `library_albums` on `LOWER(artist)`/`LOWER(name)` with no matching functional index. `/new-releases/snapshot` is not a snapshot. | Snapshot surfaces; no per-client polling | Medium | Worker-built `acquisition:new_releases` snapshot + snapshot channel |
| V7 | `api/enrichment.py:135` | `GET /api/artists/{id}/enrichment` falls back to `_fetch_enrichment(name)`: external provider calls inside the request. | No heavy work in API handlers | Medium | Return cached/DB data, enqueue a deduplicated `enrich_artist` |
| V8 | `db/queries/management.py:201,220` | `count_recent_active_users` / `count_recent_streams` filter `user_play_events.ended_at` but every index leads with `user_id` (or track ids), so each governor evaluation scans the table. Runs on every governed task start, every analysis daemon loop and V2. | Hot-path scans | Medium | `CREATE INDEX CONCURRENTLY idx_user_play_events_ended_at ON user_play_events (ended_at DESC)` |
| V9 | `api/admin_metrics.py:233` | `artwork_variant_health_sample()` stats up to 100 artwork files on disk per request (slow external disk). | IO in request | Low | Move into the governor/ops sampler, persist the sample |
| V10 | `worker_handlers/management.py:98`, `:589` | `health_check` and `library_pipeline` never call `publish_health_surface_signal()`, so an open Health page does not update after a scheduled scan. | Freshness bug | Low | Publish after `_persist_issues` (or warm the snapshot, section 4.1) |
| V11 | `db/health.py:168-190` | `resolve_stale_issues` issues one UPDATE per row. | N+1 | Low (worker) | `UPDATE ... WHERE id = ANY(:ids)` |
| V12 | `actors.py:604` | Governor deferral writes `tasks.progress` as a plain string, breaking the `TaskProgress` JSON shape every other writer uses. | Contract drift | Low | Structured progress (section 4.7) |

V1-V4 should be fixed before any v3 visual polls these surfaces more often.

---

## 4. Per visual

### 4.1 HealthScan

Site: 17 rows (number, label, description, scope, risk meter, auto/confirm badge,
result: clean / N fixed / N waiting), totals (checks, fix on their own, ask
first), a scanning cursor that walks the rows, footer "files go to Library
Trash".

Exists:

- Catalog: `repair_catalog.py` `REPAIR_CATALOG` (17 entries) with `risk`
  (safe/caution/destructive), `scope` (db/filesystem/hybrid), `support`,
  `requires_confirmation`, `supports_batch`, `supports_global_scope`,
  `supports_bulk_fix`. Served by `GET /api/manage/repair-catalog`. Auto =
  `requires_confirmation=False`: `stale_tracks`, `has_photo_desync`,
  `tag_mismatch`, `missing_cover` (4), matching the site.
- Labels and descriptions exist only in `app/ui/src/pages/Health.tsx` (and are
  copied into the site content).
- Results: `health_issues` (open/fixed/dismissed, `check_type`, `severity`,
  `details_json`, `identity_key`, `artist_id`, `album_id`, `resolved_at`),
  `health_check_runs (check_type PK, last_run_at, duration_ms, issue_count)`.
- Surface: `db/admin_health_surface.py` -> `ops:health` snapshot
  `{issues (<=500), counts, total, filter, runs}`; `GET /api/admin/health-snapshot`,
  `GET /api/admin/health-stream`, mutations under `/api/manage/health-issues/*`,
  `POST /api/manage/health-check` (task `health_check`, maintenance queue,
  governed, bypasses pressure when triggered from the console).
- Scan progress: `_handle_health_check` reports `{check, done, total}` through
  `TaskProgress` (`item` = current check type), visible in the tasks snapshot.
- Auto fixes run in `library_pipeline` (daily, maintenance window) with
  `auto_only=True, global_only=True`.
- Trash: `/api/manage/tracks/quarantine` (+ restore, hard delete).

Perf: tables are small (17 run rows; issues pruned after 30 days). Reads are
fine; the problems are read-through builds (`fresh=1` from the page) and the
500-issue payload pushed on every signal, which the visual does not need.

Freshness today: snapshot 30 s read-through; SSE only on API mutations and
repair (V10).

Gaps:

1. `health_check_runs.duration_ms` is the whole run's duration copied into every
   row (`health_check.py:227-262`, `db/repositories/health_issues.py:15`); no
   per-check timing for the scan cursor.
2. No per-run "found" vs "fixed" split. `resolve_issue` sets `status='fixed'`
   both for repairs and for issues that simply disappeared on rescan; no
   resolution source, no task id.
3. No per-check completion event during a scan, only the aggregated progress.
4. Labels/descriptions not in the backend catalog.
5. Scheduled scans do not signal (V10).

Proposed contract:

```ts
// GET /api/admin/health/checks        (snapshot-only read)
// SSE: event "health" on the admin live stream (section 5)
interface HealthChecksSurface {
  totals: { checks: 17; auto: number; confirm: number; open: number;
            waiting: number; fixed_last_run: number };
  last_run: { task_id: string; trigger: "schedule" | "console" | "pipeline";
              started_at: string; finished_at: string; duration_ms: number } | null;
  running: { task_id: string; check_type: string; done: number; total: number } | null;
  checks: Array<{
    check_type: string; label: string; description: string;
    risk: "safe" | "caution" | "destructive"; scope: "db" | "filesystem" | "hybrid";
    auto: boolean;                 // !requires_confirmation
    supports_global_scope: boolean; supports_batch: boolean;
    state: "never_run" | "clean" | "waiting" | "fixed" | "failed";
    open: number; found_last_run: number; fixed_last_run: number;
    last_run_at: string | null; duration_ms: number | null;
  }>;
  trash: { quarantined_tracks: number };
  snapshot: SnapshotMeta;          // existing decorate_snapshot block
}
```

- Live scan: new task event `health.check.completed`
  `{check_type, found, duration_ms, failed}` emitted by `_run_entries` after each
  check (17 rows per run, safe to persist) on `crate:sse:task:{id}`; the cursor
  follows `progress.item`, the result fills in from the event.
- Storage: migration adds `health_check_runs.found_count`, `fixed_count`,
  `task_id`, and makes `duration_ms` per check; `health_issues.resolution`
  (`repaired | disappeared | manual | dismissed`) and `resolved_task_id`.
  `RepairCatalogEntry` gains `label` and `description` (admin and site read them
  from `/api/manage/repair-catalog`).
- Computed by: `refresh_health_checks_snapshot()` in `db/admin_health_surface.py`
  (GROUP BY over `health_issues`, 17-row join on runs, quarantine count),
  called by the worker at the end of `health_check`, `repair`,
  `library_pipeline`; API mutations call a deduplicated
  `refresh_admin_surface(surface="health")` task on the fast queue instead of
  rebuilding. Subject `ops:health/checks`; the existing per-filter issue lists
  stay for the detail table.
- Tests: `tests/test_admin_health_surface.py` (payload from fixture issues,
  auto/confirm totals, resolution split), `tests/test_health_check.py`
  (per-check duration and completion events), migration test.

### 4.2 AlbumSidecar (portable metadata)

Site: album folder tree with `.crate/album.json`, the JSON (schema_version 1,
sorted keys, album/artist/tracks with analysis and bliss), identity tags in
every file (`crate_artist_uid`, `crate_album_uid`, `crate_track_uid`,
`crate_audio_fingerprint`), flow `write_portable_metadata` ->
`rehydrate_portable_metadata`.

Exists:

- Payload: `db/queries/portable_metadata.py:53` `get_portable_album_payload(album_id)`:
  album row, artist row, tracks with `COALESCE(shadow, library_tracks)` analysis,
  bliss vector, lrclib lyrics. Scoped by `album_id` (indexed).
- Writer: `portable_metadata.py:80` `write_album_sidecar` (temp file +
  `replace`, `indent=2, sort_keys=True`, adds `schema_version`, `generated_at`,
  `artwork_files`), `write_track_identity_tags`, `write_album_portable_metadata`.
- Tasks: `write_portable_metadata`, `rehydrate_portable_metadata`,
  `export_rich_metadata` (maintenance queue, governed, maintenance window unless
  scoped by album/artist). Endpoints `POST /api/manage/portable-metadata`,
  `/portable-metadata/rehydrate`, `/portable-metadata/export-rich`.
  `process_new_content` also writes sidecars for new albums.

Perf: preview of one album is three indexed reads; fine per request. Reading the
real file from `/music` in the API is allowed (read-only mount) but is IO on the
slow disk; not needed if the DB holds the state.

Freshness today: none beyond task progress; nothing records that an album has
a sidecar.

Gaps:

1. No per-album state: when the sidecar was written, with which
   `schema_version`, content hash, tags written / errors, last task.
2. No drift signal (DB changed after last write).
3. No library coverage figure (albums with sidecar, drifted, never written).
4. Lyrics text inflates the preview; the visual needs a truncated view.

Proposed contract:

```ts
// GET /api/admin/albums/{album_id}/portable-metadata   (+ /by-entity/{uid})
interface AlbumPortableMetadata {
  album_id: number; entity_uid: string;
  folder: { path: string; files: string[]; artwork_files: string[] }; // from DB rows, no FS walk
  identity_tags: ["crate_artist_uid","crate_album_uid","crate_track_uid","crate_audio_fingerprint"];
  preview: object;               // payload write_album_sidecar would produce, lyrics truncated
  preview_sha256: string;
  state: { written_at: string | null; schema_version: number | null;
           written_sha256: string | null; drift: boolean;
           tracks: number; tags_written: number; tag_errors: number;
           last_task_id: string | null } ;
}
// GET /api/admin/portable-metadata/summary   (snapshot ops:portable_metadata)
interface PortableMetadataSummary {
  albums: number; with_sidecar: number; drifted: number; never_written: number;
  schema_version: number; last_run: { task_id: string; finished_at: string } | null;
}
```

- Storage: new table `album_portable_metadata_state (album_id PK FK
  ON DELETE CASCADE, schema_version, written_at, payload_sha256, tracks,
  tags_written, tag_errors, last_task_id, last_error)`, upserted by the worker
  after each album (`db/repositories/portable_metadata_state.py`). Hash excludes
  `generated_at` so it is stable.
- Drift: computed in the request for one album (hash of the preview vs stored);
  library-wide drift computed by the worker at the end of write/rehydrate runs
  and nightly, stored in the summary snapshot.
- Live: per-album task event `portable.album.written` only for scoped runs
  (album/artist); full-library runs (4,400 albums) report progress only, to keep
  `task_events` small.
- Writes stay in the worker; the API only enqueues (`POST /api/manage/portable-metadata {album_id}` exists).
- Tests: payload/hash stability, state upsert, drift flag, summary builder.

### 4.3 ReleaseTimeline

Site: one release moving through Detected (`check_new_releases`) -> Release day
(`promote_due_releases`) -> Fetched (`tidal_download`: queued, downloading,
processing, completed) -> Imported (`process_new_content`: folders, artist,
genres, MBIDs, Bandcamp, lyrics) -> Analysed (daemons: features, bliss), with a
release clock (Day N relative to release date).

Exists:

- `new_releases` (`db/schema_sections/acquisition.py`): `detected_at`,
  `release_date`, `status` (`detected | downloading | downloaded | dismissed`),
  `downloaded_at`, `tidal_id/url`, `mb_release_group_id`, `release_type`,
  tracklist and preview JSON. Index on `(status, release_date, detected_at)` and
  `(LOWER(artist_name), LOWER(album_title))`.
- `check_new_releases` (12 h) and `promote_due_releases` (1 h,
  `worker_handlers/acquisition.py:1574`): marks `downloading`, queues
  `tidal_download` with `new_release_id` in params; the download handler marks
  `downloaded` (`:944`). `tidal_downloads` rows carry `task_id`, `status`,
  `completed_at`.
- Import: `library.acquisition.completed` domain event -> projector ->
  `queue_process_new_content_if_needed(force=True)`; `process_new_content`
  records its steps in `tasks.result.steps`.
- Analysis: `track_processing_state (track_id, pipeline, state, completed_at)`
  per track; `library_tracks.analysis_state / bliss_state`.
- Endpoints: `GET /api/acquisition/new-releases`, `/new-releases/snapshot`,
  `/new-releases/stream` (5 s poll, V6), `POST .../download`, `.../dismiss`,
  `/new-releases/check`.

Perf: list and stream query per client (V6). A per-release timeline is a
handful of indexed reads, fine.

Freshness today: 5 s polling per SSE client.

Gaps:

1. No timestamps after detection besides `downloaded_at`: no
   `download_queued_at`, no `imported_at`, `enriched_at`, `analysed_at`.
2. No durable release -> album link: everything matches by lowercase
   artist/title at read time. Only the Tidal path carries `new_release_id`;
   Soulseek/manual imports of a detected release never link.
3. No release -> task link (download task id only inside `tasks.params`).
4. The acquisition-completed event lives in the Redis stream (ephemeral), so it
   cannot be replayed for history.

Proposed contract:

```ts
// GET /api/acquisition/releases/{release_id}/timeline
interface ReleaseTimeline {
  release: { id: number; artist: string; title: string; release_type: string;
             release_date: string | null; detected_at: string; cover_url: string | null;
             album_id: number | null; prerelease: boolean };
  clock_days: number | null;                  // today - release_date, server computed
  stages: Array<{
    id: "detected" | "release_day" | "fetched" | "imported" | "analysed";
    task: string;                             // check_new_releases, promote_due_releases, ...
    state: "done" | "active" | "pending" | "failed" | "skipped";
    at: string | null; task_id: string | null;
    steps: Array<{ id: string; state: "done" | "active" | "pending" | "failed" }>;
  }>;
  analysis: { tracks: number; analysis_done: number; bliss_done: number } | null;
}
// GET /api/acquisition/new-releases  -> served from snapshot acquisition:new_releases
```

- Storage: `new_releases` gains `album_id` (FK `library_albums`, set on
  import), `download_task_id`, `download_queued_at`, `imported_at`,
  `enriched_at`, `analysed_at`, `last_error`.
- Who writes: `promote_due_releases` and manual download set
  `download_queued_at`/`download_task_id`; the download handler sets
  `downloaded_at`; `process_new_content` sets `album_id`, `imported_at` and
  `enriched_at` for matching releases of that artist (match once, by
  `mb_release_group_id` first, then normalised artist/title); a small
  reconciler in the crate-worker service loop (every 60 s, only releases with
  `status='downloaded' AND analysed_at IS NULL`, a handful of rows) checks
  `track_processing_state` for that album and stamps `analysed_at`. The timeline
  endpoint then reads one `new_releases` row plus, while analysis is active, a
  scoped count over that album's tracks (`library_tracks.album_id` index, about
  10-20 rows; not a library-wide aggregate).
- List: worker-built snapshot `acquisition:new_releases` (refreshed by
  check/promote/download/dismiss and the reconciler), SSE on its snapshot
  channel; drop the per-client poll loops. `album_id` removes the LOWER join.
- Tests: stage derivation table test, reconciler, snapshot builder, migration.

### 4.4 EnrichmentOrbit

Site: artist in the core, 6 artist sources on the inner ring with their cache
TTL (Last.fm 7d, Spotify 3d, MusicBrainz 30d, Setlist.fm 1d, Fanart.tv 30d,
Discogs 30d), 7 secondary sources on the outer ring (Cover Art Archive,
Deezer/iTunes, Wikidata, Wikipedia, Ticketmaster, lrclib, Bandcamp), and a
3-lane thread pool timeline.

Exists:

- `enrichment.py:30-77`: fetch order, `_SOURCE_TTLS_SECONDS`,
  `_PROVIDER_MIN_INTERVAL_SECONDS` (Redis slot limiter in
  `provider_rate_limits.py`), `enrichment_parallelism` (default 3, max 6),
  shared `ThreadPoolExecutor`. `enrich_artist` (`:328`) skips artists enriched
  within `enrichment_min_age_hours` (24 h), persists to `library_artists`
  (`enriched_at`, bio, tags, mbid, spotify/discogs ids, listeners, urls ...),
  similarities, genres, Bandcamp URL, photo.
- Per-source cache: `set_cache("enrichment:source:{source}:{artist}", ttl)`.
  `set_cache` writes Redis and returns (`db/cache_store.py:86-98`); the Postgres
  `cache` table is only a fallback, so per-source fetch time exists only as a
  Redis TTL.
- Album level: `library_albums.musicbrainz_albumid`, `has_cover`,
  `bandcamp_url(_updated_at)`, `lastfm_listeners`, `discogs_master_id`;
  `track_lyrics (provider, found, updated_at)`; schedulers `enrich_artists`
  (24 h), `rematch_album_mbids` (6 h).
- Secondary modules: `artwork.py`/`worker_handlers/artwork.py` (Cover Art
  Archive, iTunes), `lastfm.py`/`enrichment.py` (Deezer image fallback),
  `musicbrainz_ext.py`/`artist_bio_research.py` (Wikidata, Wikipedia),
  `ticketmaster.py`, `lyrics.py` (lrclib), `bandcamp/`.
- Endpoints: `GET /api/artists/{id}/enrichment` (cached payload, inline fetch
  fallback, V7), `POST /api/artists/{id}/enrich` (queues task).

Perf: per-artist reads are cheap. Library-wide coverage cannot be derived
without scanning Redis keys (not acceptable) and the inline fetch (V7) must go.

Freshness today: none; task progress for `enrich_artist(s)`.

Gaps:

1. No persisted per-source state (fetched_at, outcome, expiry, duration,
   error).
2. No per-source events while an artist is being enriched (the pool lanes).
3. No album-level fetch timestamps for MBID, covers, Last.fm, Discogs.
4. No library coverage per source.

Proposed contract:

```ts
// GET /api/admin/artists/{artist_id}/enrichment-status   (+ /by-entity/{uid})
interface ArtistEnrichmentStatus {
  artist: { id: number; name: string; enriched_at: string | null };
  parallelism: number;                         // enrichment_parallelism setting
  sources: Array<{
    id: "lastfm" | "spotify" | "musicbrainz" | "setlist" | "fanart" | "discogs";
    label: string; ring: "artist"; ttl_seconds: number; min_interval_s: number;
    status: "fresh" | "expired" | "empty" | "error" | "unconfigured" | "never";
    fetched_at: string | null; expires_at: string | null; duration_ms: number | null;
  }>;
  secondary: Array<{ id: string; label: string; role: string; scope: "album" | "track" | "artist";
                     coverage: { done: number; total: number } | null }>;  // this artist's albums/tracks
  last_task: { id: string; status: string; updated_at: string } | null;
}
// GET /api/admin/enrichment/summary    (snapshot ops:enrichment)
interface EnrichmentSummary {
  artists: number;
  by_source: Record<string, { fresh: number; expired: number; empty: number; error: number; never: number }>;
  albums: { with_mbid: number; with_cover: number; with_bandcamp: number; lyrics_tracks_found: number };
}
```

- Storage: `artist_enrichment_sources (artist_id, source, status, fetched_at,
  expires_at, duration_ms, error, PRIMARY KEY (artist_id, source))`, one
  batched `unnest` upsert per artist from `enrich_artist` (about 900 x 6 rows).
  Album side: `library_albums.mbid_checked_at`, `cover_checked_at` (stamped by
  the existing jobs) so "never tried" and "tried, nothing found" differ.
- Live: a Redis-only `publish_task_signal(task_id, "enrichment.source", {...})`
  (no `task_events` insert, no `worker_logs` mirror) emitted around each
  fetcher for scoped `enrich_artist` runs; the nightly `enrich_artists` batch
  only reports progress.
- Summary: built by the worker at the end of `enrich_artists` and daily
  (GROUP BY over about 5,400 rows plus album columns; no `library_tracks`
  aggregate except lyrics, which reads `track_lyrics`).
- Fix V7 in the same change.
- Tests: status derivation from TTL, batched upsert, summary builder, endpoint
  permission (`library.view` today; admin view should need an ops/library manage
  permission).

### 4.5 TrackReadout

Site: per track BPM, key + Camelot, loudness (LUFS), dynamic range (dB), five
features (energy, danceability, valence, acousticness, instrumentalness), the
20-float bliss vector as bars, "nearest neighbours in pgvector", track switcher
within one album.

Exists:

- `library_tracks`: `bpm, audio_key, audio_scale, energy, danceability,
  valence, acousticness, instrumentalness, loudness, dynamic_range,
  spectral_complexity, mood_json, bliss_vector (float8[]), bliss_embedding
  vector(20), analysis_state, bliss_state, analysis_completed_at,
  bliss_computed_at`. Shadow tables `track_analysis_features`,
  `track_bliss_embeddings` (HNSW cosine), `track_processing_state`
  (attempts, last_error). Portable payload already uses
  `COALESCE(shadow, library_tracks)`.
- Camelot mapping: `bliss.py:31` (`CAMELOT`).
- Endpoints: `GET /api/tracks/{id}/info` (FastAPI and Go read plane native)
  returns features but replaces the vector with a 3-value `bliss_signature`
  (`api/browse_media.py:334`); `/api/tracks/{id}/eq-features`;
  `/api/artists/{id}/analysis-data` (all tracks of an artist, keyed by title).
- Neighbours: `db/queries/bliss_similarity_candidates.py:13`
  `get_bliss_candidates` (`<=>` on the HNSW index, LIMIT).

Perf: single track = PK read; album = `album_id` index (about 10-30 rows);
neighbours = one HNSW probe with LIMIT. All fine per request, no snapshot.

Freshness: static until reanalysis; `track.analysis.updated` /
`track.bliss.updated` domain events exist if the page wants to refresh a track
being analysed.

Gaps:

1. Raw vector not exposed anywhere outside the sidecar payload.
2. Units are not uniform: loudness is EBU R128 integrated LUFS on the Essentia
   path but RMS dBFS on the fallback paths (`audio_analysis.py:584-596`,
   `:1123`); `dynamic_range` is Essentia `DynamicComplexity` on one path and a
   p95/p10 crest in dB on the other (`:600-603`, `:1125+`). There is no column
   recording which analyzer produced the row, so a "LUFS" / "dB" label is not
   always true.
3. Camelot not in any payload.

Proposed contract (new admin route; do not change `/api/tracks/{id}/info`,
which the read plane serves natively and the contract smoke compares):

```ts
// GET /api/admin/tracks/{track_id}/analysis?neighbours=8   (+ /by-entity/{uid})
// GET /api/admin/albums/{album_id}/analysis               (all tracks, same item shape, no neighbours)
interface TrackAnalysis {
  track: { id: number; entity_uid: string; title: string; artist: string; album: string; album_id: number };
  state: { analysis: string; bliss: string; analysis_completed_at: string | null;
           bliss_computed_at: string | null; attempts: number; last_error: string | null };
  figures: { bpm: number | null; key: string | null; scale: "major" | "minor" | null;
             camelot: string | null; loudness: number | null; loudness_unit: "LUFS" | "dBFS" | null;
             dynamic_range: number | null; dynamic_range_unit: "dB" | "complexity" | null;
             spectral_complexity: number | null };
  features: { energy: number | null; danceability: number | null; valence: number | null;
              acousticness: number | null; instrumentalness: number | null };
  mood: Record<string, number> | null;
  bliss: { vector: number[] | null };           // 20 floats
  neighbours?: Array<{ track_id: number; title: string; artist: string; distance: number }>;
}
```

- Storage: `library_tracks.analysis_method` (or on `track_analysis_features`)
  written by the analysis daemon (`essentia | librosa | native`), so units are
  reported honestly. Backfill leaves it NULL and the payload returns `null`
  units for those rows.
- Tests: serializer (camelot, units, COALESCE precedence), neighbours query
  bound by LIMIT, permission.

### 4.6 QueueLanes

Site: five lanes (maintenance, default, fast, heavy, playback) with task-type
count per queue, the containers that consume each queue, chips flowing queued ->
running -> done, governed tasks marked; GovernorGauges embedded below.

Exists:

- Static: `actors.py:70` `TASK_POOL_CONFIG` (queue, priority, time limit,
  retries) for 125 types; `task_registry.py` labels/categories;
  `RESOURCE_GOVERNED_TASK_TYPES`, `MAINTENANCE_WINDOW_TASK_TYPES`,
  `DB_HEAVY_TASK_TYPES`. `GET /api/admin/task-catalog` returns labels and
  categories only.
- Topology (compose only, not visible at runtime): crate-worker
  `default,fast` x3 processes (+ service loop), crate-fast-worker `fast` x2,
  crate-maintenance-worker `maintenance` x1, crate-analysis-worker `heavy` x1
  (+ analysis daemons), crate-playback-worker `playback` x1.
- Live: `tasks` (`status`, `pool`, `priority`, `created_at`, `started_at`,
  `updated_at`, `heartbeat_at`, `worker_id`, `progress`), 7-day retention.
  `get_task_activity_snapshot` (`db/queries/tasks.py:101`) gives running and
  pending lists plus `queue_breakdown {running, pending}` per pool and the
  DB-heavy gate. `worker_live` (15 s) stores it; `ops:tasks` snapshot
  (`db/admin_tasks_surface.py`) combines it with history; `tasks-stream`
  pushes at most every 2 s.
- Metrics: `worker.queue.depth`, `worker.queue.running`, `worker.queue.wait`,
  `worker.task.duration` (tags not usable, section 2.4).

Perf: the tasks table is small; fine. `task_counts` scans the whole table
because the counts have no `WHERE status IN (...)`; add it so `idx_tasks_status`
serves the query.

Freshness today: running/pending lists come from `worker_live` (15 s), so lanes
lag up to 15 s even though the stream pushes every 2 s.

Gaps:

1. No per-queue throughput (completed / failed in the last N minutes).
2. Pending list capped at 12 across all pools (`worker.py:379`): a busy
   maintenance queue hides the others.
3. `recent_tasks` has no `pool`, no duration.
4. No worker topology or liveness per queue.
5. Task catalog lacks queue / governed / window / DB-heavy flags.

Proposed contract:

```ts
// GET /api/admin/queues     (snapshot ops:queues, snapshot-only read)
// SSE: event "queues" on the admin live stream
interface QueuesSurface {
  generated_at: string;
  queues: Array<{
    queue: "maintenance" | "default" | "fast" | "heavy" | "playback";
    task_types: number;
    consumers: Array<{ service: string; processes: number; last_seen: string }>;
    pending: number; running: number; oldest_pending_s: number | null;
    completed_5m: number; failed_5m: number; deferred: number;
    running_tasks: Array<{ id: string; type: string; label: string; started_at: string;
                           percent: number | null; item: string | null; governed: boolean; worker_id: string | null }>;
    pending_tasks: Array<{ id: string; type: string; label: string; created_at: string;
                           priority: number; governed: boolean; deferred_until: string | null }>; // top 5 per queue
    recent: Array<{ id: string; type: string; status: string; finished_at: string; duration_ms: number }>; // last 5 per queue
  }>;
  db_heavy_gate: { active: number; pending: number; blocking: boolean };
}
// GET /api/admin/task-catalog  gains per type: queue, priority, time_limit_seconds,
//                              governed, maintenance_window, db_heavy
```

- Computed by: the crate-worker service loop. `publish_tasks_surface_signal`
  additionally sets a Redis dirty flag; the loop ticks every 2 s, rebuilds
  `ops:queues` when dirty or every 15 s, one `upsert_ui_snapshot` (which
  publishes the snapshot channel). Single writer, so it is deduplicated by
  construction. One CTE query: per-pool counts restricted to active statuses,
  `ROW_NUMBER() OVER (PARTITION BY pool ...)` for top N pending/running/recent,
  completed/failed counts over `updated_at > now() - 5 min`.
- Topology: each Dramatiq worker process sets
  `crate:workers:{hostname}:{pid}` `{service, queues, started_at}` with a 60 s
  TTL, refreshed every 30 s; the loop reads them (Redis SCAN on a small, fixed
  prefix, or a set of member keys).
- Client: animates chips by diffing ids between snapshots (pending -> running
  -> recent); the animation loop reads refs, the SSE effect depends only on the
  stream URL.
- Tests: CTE builder (per-pool top N, throughput window), dirty-flag cadence,
  catalog flags match `TASK_POOL_CONFIG` and governor sets.

### 4.7 GovernorGauges

Site: gauges for load ratio (limit 0.85), iowait (25 %), swap (30 %), listeners
(10), streams (10) with limit markers, status line "Allowed / Deferring",
maintenance window 02:00-07:00, list of governed tasks.

Exists:

- `resource_governor.py`: `build_snapshot` (`:283`) samples
  `os.getloadavg()/cpu_count`, iowait from `/proc/stat` (50 ms sample), swap and
  memory from `/proc/meminfo`, active users/streams from `user_play_events`
  (5 min / 3 min windows). `evaluate_resources` (`:217`) applies env thresholds;
  swap only counts when used swap >= 512 MB or available memory < 15 %.
  `evaluate_maintenance_window` returns `{enabled, start, end, now, in_window,
  seconds_until_start}`. Thresholds and window come only from env.
- Decisions: `should_defer_task` at task start (`actors.py:592-610`, re-sends
  the message with a delay and writes a plain-string progress), in long loops
  (`wait_while_pressured`), in the scheduler and on every analysis daemon loop.
  `record_decision` overwrites `cache:resource_pressure` in Redis with the last
  decision from any source (allowed decisions overwrite deferrals), and records
  deferral metrics (tags unusable).
- Exposure: only `GET /api/admin/metrics/system` (V1, V2, V9).
- Config: compose sets `CRATE_RESOURCE_MAX_ACTIVE_USERS=0` and
  `..._STREAMS=0` (any listener defers governed work) and enables the window on
  crate-worker, maintenance and analysis workers; code defaults (and the site)
  say 10/10. crate-api has none of these.

Perf: sampling is cheap in a worker loop, wrong in a request (sleep, two
counts, wrong env). V8 index needed either way.

Freshness today: computed per HTTP request; nothing persisted.

Gaps:

1. No persisted governor sample; no cadence.
2. No deferral history (last N, counts per reason over 24 h), no "deferred
   until" on tasks.
3. Thresholds visible only through env; the UI must show the configured values,
   not the site constants.

Proposed contract:

```ts
// GET /api/admin/governor      (reads ops_runtime_state('resource_governor') only)
// SSE: event "governor" on the admin live stream
interface GovernorSurface {
  enabled: boolean; sampled_at: string; sampled_by: string;   // "crate-worker"
  allowed: boolean; reason: string;
  reason_family: "load" | "iowait" | "swap" | "playback" | "maintenance_window" | "mixed" | null;
  gauges: Array<{
    id: "load_ratio" | "iowait_percent" | "swap_used_percent" | "memory_available_percent"
        | "active_users" | "active_streams";
    value: number | null; limit: number; direction: "max" | "min";
    over: boolean; raw?: Record<string, number | null>;      // load_1m, cpu_count, swap_used_mb ...
  }>;
  swap_gate: { min_swap_used_mb: number; min_memory_available_percent: number; active: boolean };
  window: { enabled: boolean; start: string; end: string; now: string; tz: string;
            in_window: boolean; seconds_until_start: number } | null;
  defer_seconds: number;
  governed_task_types: string[]; maintenance_window_task_types: string[];
  deferrals: {
    recent: Array<{ at: string; task_type: string; task_id: string | null; source: string;
                    reason_family: string; reason: string; defer_seconds: number }>;   // last 20
    last_24h_by_reason: Record<string, number>;
    deferred_now: number;                                     // pending tasks with deferred_until > now
  };
}
```

- Computed by: crate-worker service loop every 5 s (worker env is the one that
  governs default-queue work; maintenance and analysis workers share the same
  values in compose). Writes `ops_runtime_state('resource_governor')` and
  publishes `crate:sse:snapshot:ops:governor`. If the payload is folded into
  `ops:queues` instead, keep the 5 s governor cadence independent of the
  queue dirty flag.
- Deferral log: `record_decision` (when not allowed) pushes to Redis list
  `crate:governor:deferrals` (LPUSH + LTRIM 200) and `HINCRBY
  crate:governor:deferrals:{yyyymmddhh} {reason_family}` (TTL 25 h). Stop
  overwriting the last deferral with allowed decisions.
- Task side: deferral writes structured progress
  `{"phase": "deferred", "item": reason, "deferred_until": iso}` instead of a
  string (V12).
- Remove `evaluate_resources` and `get_analysis_status` from
  `_build_metrics_system`; read the persisted sample (fixes V1, V2).
- Index V8.
- Tests: sample serialisation (gauges, swap gate, window), deferral log
  trimming and hourly counters, `metrics/system` no longer touching
  `library_tracks` or `/proc` (assert via monkeypatch), settings parity test that
  the API reads the worker sample rather than its own env.

### 4.8 GenreWheel

Covered in the separate genre analysis. Relevant here only: `/api/genres` and
`/api/genres/{slug}` are already native in the Go read plane, and taxonomy
graph queries live in `db/queries/genres_taxonomy_graph*.py`.

---

## 5. Cross-cutting proposal: one admin live stream, one refresher

Boring, reuses what exists:

1. `GET /api/admin/live?surfaces=queues,governor,health,...` (FastAPI).
   One pubsub subscription per connection on the relevant
   `crate:sse:snapshot:{scope}:{subject}` channels; on connect it sends the
   current `ui_snapshots` / `ops_runtime_state` rows (read in
   `asyncio.to_thread`), then forwards `event: <surface>` messages with the new
   row. It never builds. Permission per surface checked at connect. Replaces the
   per-page `health-stream`, `tasks-stream` and `ops-stream` for v3 screens and
   keeps pubsub connections at one per admin tab.
2. `refresh_admin_surface(surface, subject)` task on the fast queue with
   `create_task_dedup` keyed by surface: the only way an API handler asks for a
   rebuild. Surfaces with a natural owner (queues, governor in the service loop;
   health and portable metadata at task end; enrichment summary after the
   nightly batch) refresh themselves.
3. All admin GET handlers use pattern 2 from section 2.1. Drop `fresh=true`
   from HTTP routes or make it enqueue instead of build.

Client rule (v3 animations): SSE effects depend only on the stream URL and
surface list; per-frame animation state lives in refs, never in effect deps.

## 6. Schema changes (one migration each, concurrent indexes)

| Table | Change | Visual |
| --- | --- | --- |
| `health_check_runs` | per-check `duration_ms`, add `found_count`, `fixed_count`, `task_id` | HealthScan |
| `health_issues` | add `resolution`, `resolved_task_id` | HealthScan |
| `album_portable_metadata_state` | new | AlbumSidecar |
| `new_releases` | add `album_id`, `download_task_id`, `download_queued_at`, `imported_at`, `enriched_at`, `analysed_at`, `last_error` | ReleaseTimeline |
| `artist_enrichment_sources` | new | EnrichmentOrbit |
| `library_albums` | add `mbid_checked_at`, `cover_checked_at` | EnrichmentOrbit |
| `library_tracks` or `track_analysis_features` | add `analysis_method` | TrackReadout |
| `user_play_events` | index on `ended_at DESC` | GovernorGauges (V8) |
| `tasks` | none (filter counts by status) | QueueLanes |

## 7. Suggested order

1. Fix V1-V4 (no UI change; protects everything that follows).
2. Governor sample + `/api/admin/governor` + V8 index (small, high value, also
   fixes the misleading SystemHealth panel).
3. Queues surface + task catalog flags + admin live stream.
4. Health checks surface + per-check events + catalog labels.
5. Track analysis endpoints (no storage change except `analysis_method`).
6. Portable metadata state + summary.
7. Release timeline columns, reconciler, snapshot (fixes V6).
8. Enrichment source state + summary (fixes V7).

Each step: pytest per changed public function (`cd app && ../.venv/bin/python
-m pytest tests/<file>.py -q`), migration test, and for any new route the
OpenAPI/permission tests the API package already enforces.

## 8. Open questions for Diego

1. Listener/stream thresholds: compose ships 0/0 (any listener pauses governed
   work), code and site say 10/10. Which one is the product default the UI
   should present?
2. HealthScan "fix on their own": auto fixes only run inside `library_pipeline`
   (daily, maintenance window). Should v3 show "fixed in last pipeline run", or
   should a console scan also apply the 4 safe fixes?
3. TrackReadout units: add `analysis_method` and label honestly, or relabel
   loudness and dynamic range generically until every track is reanalysed on one
   path?
4. ReleaseTimeline for non-Tidal acquisitions (Soulseek, upload): link a
   detected release to an imported album by MusicBrainz release group / name
   match at import time, or leave those timelines ending at "detected"?
5. Admin surfaces through the Go read plane: not recommended now (permission
   parity, low traffic). Confirm.
