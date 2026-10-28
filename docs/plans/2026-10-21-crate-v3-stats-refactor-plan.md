# Stats Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Stats explorer, previous-period comparisons, actionable sections and the listening heatmap across `/stats`, `/users/:u/stats` and `/stats/global`.

**Architecture:** The dashboard snapshot (Python builders, Go read-plane key) gains declared fields and a `v3` key. A new range endpoint reads per-user daily projections and new instance rollup tables maintained by the projection pipeline. Listen replaces the signal tape with a hand-built SVG explorer and upgrades each section in place.

**Tech Stack:** FastAPI + SQLAlchemy `text()` CTEs in `crate/db`, Postgres 15, Dramatiq tasks, Go read plane, React 19 + Vitest + Testing Library, i18next catalogs.

**Spec:** `docs/plans/2026-10-21-crate-v3-stats-refactor-design.md`

## Global Constraints

- Worktree `.claude/worktrees/stats-explorer`, branch `feat/stats-explorer`; never touch the parent worktree (Codex works there).
- SQL only in `app/crate/db/` (`_impl` + `read_scope()`/`transaction_scope()`, `session=` kwarg, `__all__`); API never imports SQLAlchemy; no `from crate.db import …` outside the package.
- Requests never aggregate `library_tracks` or `user_play_events`; range queries read `user_track_daily`, `user_entity_firsts`, `instance_track_daily`, `instance_entity_firsts` only.
- Range: `end − start ≤ 400 days`, `end ≥ start`, `end ≤ subject's today`; `limit` 1–20; violations → HTTP 422.
- Snapshot key version `v3` for user (Python and Go) and instance keys; instance limits 12/10/14/10/36.
- Every new payload field is declared in Pydantic (`app/crate/api/schemas/me.py`) and TS (`app/listen/src/components/stats/stats-types.ts`) in the same task.
- Listen: all copy via `t()` with keys in all 7 catalogs (`app/listen/src/i18n/catalogs/{en,es,ca,de,eu,fr,it}.json`), then `npm --prefix app/listen run i18n:check -- --write-metadata`; no emojis; v3 tokens/primitives (`MonoLabel`, `InfoBadge`, `ActionButton`, `MediaCover`…); hand-built SVG/HTML instruments, no chart libraries; reduced motion renders final state; `react-hooks/exhaustive-deps` is off — dependency arrays reviewed by hand.
- Commands (run from the worktree root):
  - Frontend tests: `cd app/listen && npx vitest run <files>`; typecheck `npm run --workspace=app/listen typecheck`; lint `cd app/listen && npx eslint --max-warnings=0 <files>`.
  - Backend tests: `"$SP/pytest-docker.sh" app/tests/<file>.py` (script created in Task 1, `SP=/tmp/claude-1000/-home-diego--codex-worktrees-crate-v3-1q-crate/bed97ea9-a623-4ab8-9bbc-9869123c9849/scratchpad`).
  - Ruff: `pipx run ruff==0.15.22 check app/crate app/tests && pipx run ruff==0.15.22 format --check app/crate app/tests`.
  - Go: `docker run --rm -v "$PWD/app/readplane:/src" -w /src golang:1.23 go test ./internal/routes/...`.
- Commit after each task with a conventional message; `docs/plans/*` needs `git add -f`.

## Review Focus

1. **Local-day boundaries**: a user far from UTC (e.g. `Pacific/Kiritimati`) asking for "today" must get plays of their local day, not UTC's. → Task 3 `test_range_days_follow_user_timezone`.
2. **Empty and sparse stretches**: a stretch with no plays shows zeros and "—" mood, never NaN or a crash. → Task 11 `summarizes an empty stretch without NaN`, Task 13 `renders an empty stretch`.
3. **Rapid window drags**: a slow older response must never replace a newer stretch. → Task 12 `ignores a stale response that resolves after a newer stretch`.
4. **Range limits at the edges**: exactly 400 days is accepted, 401 rejected; a weekly bucket click asks for Monday–Sunday clipped to the period. → Task 4 `test_range_accepts_400_days_and_rejects_401`, Task 11 `weekly bucket range is clipped to the tape end`.
5. **Global before backfill / tiny instances**: the global explorer degrades (`available: false`) instead of erroring, and the heatmap grid hides under 3 listeners. → Task 7 `test_instance_range_unavailable_before_backfill`, Task 20 `hides the instance grid below three listeners`.

---

## Phase A · Snapshot contract

### Task 1: Declare the snapshot block and treat pending as non-empty

**Files:**
- Create: `$SP/pytest-docker.sh` (outside the repo)
- Modify: `app/crate/api/schemas/me.py:791` (`StatsDashboardResponse`)
- Modify: `app/listen/src/pages/use-stats-page-controller.ts:198` (`hasStats`)
- Test: `app/tests/test_stats_dashboard_snapshot_meta.py` (new), `app/tests/test_openapi_contract.py`, `app/listen/src/pages/Stats.test.tsx`

**Interfaces:**
- Produces: `StatsSnapshotMetaResponse` (fields below); `StatsDashboardResponse.snapshot: StatsSnapshotMetaResponse | None`.

- [ ] **Step 1: Create the backend test harness** — `pytest-docker.sh` builds `musicdock-worker` once (`docker compose -f docker-compose.dev.yaml -f docker-compose.readplane.dev.yaml build worker` when the image is missing), brings up `docker compose -f docker-compose.test.yaml --project-name crate-test up -d --wait`, then runs the same `docker run … --entrypoint python musicdock-worker -m pytest "$@" -q` as `make dev-test-backend` (env vars copied from `Makefile:411-419`, mounting the worktree). Verify: `"$SP/pytest-docker.sh" app/tests/test_user_stats_periods.py` → passes.
- [ ] **Step 2: Write failing tests**
  - `test_cold_dashboard_keeps_pending_snapshot` parametrized over `/api/me/stats/dashboard`, `/api/users/{username}/stats/dashboard`, `/api/stats/dashboard` with an empty snapshot table: `response.json()["snapshot"]["pending"] is True` and `["version"] == 0`.
  - In `test_openapi_contract.py`: `StatsDashboardResponse` schema has property `snapshot` referencing `StatsSnapshotMetaResponse`.
  - In `Stats.test.tsx`: `it("shows the building state, not the empty state, for a pending cold snapshot")` with `baseDashboard` + `snapshot: { pending: true, version: 0 }` and `play_count: 0` → `queryByTestId("empty-state")` is null.
- [ ] **Step 3: Run** both suites → FAIL (`snapshot` missing / empty state rendered).
- [ ] **Step 4: Implement** `StatsSnapshotMetaResponse(BaseModel)`: `scope: str | None`, `subject_key: str | None`, `version: int | None`, `built_at: str | None`, `source_seq: int | None`, `stale_after: str | None`, `stale: bool = False`, `pending: bool = False`, `generation_ms: int | None` (all defaulting to `None` unless stated); add `snapshot` to `StatsDashboardResponse`. Listen: `hasStats = Boolean(overview?.play_count) || dashboard?.snapshot?.pending === true`; add `pending?: boolean` to `StatsSnapshot` if absent.
- [ ] **Step 5: Run** tests → PASS. **Step 6: Commit** `fix(stats): keep the snapshot block so cold dashboards poll`.

### Task 2: Versioned keys and aligned instance limits

**Files:**
- Modify: `app/crate/db/user_stats_dashboard_surface.py:48`, `app/crate/db/instance_stats_dashboard_surface.py:37,46-60`, `app/crate/api/analytics.py:111`, `app/crate/worker_handlers/analysis.py:212`, `app/readplane/internal/routes/stats_dashboard.go:77`
- Test: `app/tests/test_user_stats_dashboard_surface.py`, `app/tests/test_instance_stats_dashboard_surface.py`, `app/readplane/internal/routes/stats_dashboard_test.go`

**Interfaces:**
- Produces: user key `v3:user:{id}:{period}:{month|default}:{t}:{a}:{al}:{g}:{r}`; instance key `v3:instance:{period}:{t}:{a}:{al}:{g}:{r}`.

- [ ] **Step 1: Failing tests** — `stats_dashboard_subject_key(17, window="30d", month=None, tracks_limit=12, artists_limit=10, albums_limit=14, genres_limit=10, replay_limit=36) == "v3:user:17:30d:default:12:10:14:10:36"`; `instance_stats_subject_key(window="30d", month=None, …defaults) == "v3:instance:30d:12:10:14:10:36"`; instance `_DEFAULT_LIMITS["albums"] == 14`; Go `TestStatsDashboardSubjectKey` expects `"v3:user:17:30d:default:12:10:14:10:36"`.
- [ ] **Step 2: Run** pytest + Go → FAIL. **Step 3: Implement** the constants/format changes and align API default (`albums_limit` 14) and worker default (14). **Step 4: Run** → PASS (also `app/tests/test_stats_dashboard_contract.py`). **Step 5: Commit** `feat(stats): version dashboard keys v3 and align instance limits`.

---

## Phase B · Explorer backend

### Task 3: User range query

**Files:**
- Create: `app/crate/db/queries/user_library_stats_range.py`
- Test: `app/tests/test_user_stats_range.py`

**Interfaces:**
- Produces:
  - `MAX_RANGE_DAYS = 400`
  - `validate_stats_range(start: date, end: date, *, today: date) -> None` (raises `ValueError`)
  - `get_user_stats_range(user_id: int, start: date, end: date, *, limit: int = 3, session=None) -> dict` returning `{"start": iso, "end": iso, "available": True, "top_artists": [...], "top_albums": [...], "top_tracks": [...], "discoveries": [...]}` with item keys exactly as in the spec JSON (tracks also carry the `_TRACK_REF_JOINS` ref fields used by `StatsTrackRefResponse`).
  - Ordering: `minutes DESC, plays DESC, name`; `share = item_minutes / stretch_minutes` (0 when the stretch is empty); discoveries: `user_entity_firsts` artists with `first_day` in range, by minutes in range, max 10.

- [ ] **Step 1: Failing tests** (seed with `seed_stats_library()`, `seed_listening_history(user_id=1, events=500, days=120)`, `recompute_user_listening_aggregates(1)`):
  - `test_range_tops_are_ordered_and_shares_are_minute_shares` — descending minutes; `top_artists[0]["share"] == pytest.approx(minutes / total)`.
  - `test_day_detail_only_contains_that_day` — `start == end` with `limit=20`; every track appears in `user_track_daily` for that day.
  - `test_discoveries_are_artists_first_heard_inside_the_range`.
  - `test_validate_rejects_inverted_future_and_too_long_ranges` — 401 days, `end < start`, `end > today` raise; 400 days passes.
  - `test_range_days_follow_user_timezone` — user `Pacific/Kiritimati`, play at 23:30 UTC appears in the next local day's range.
- [ ] **Step 2: Run** → FAIL (module missing). **Step 3: Implement** one CTE in `read_scope()` (PK prefix scan on `user_track_daily`), covers only for returned rows. **Step 4: Run** → PASS. **Step 5: Commit** `feat(stats): add the user listening range query`.

### Task 4: Range routes for me and users

**Files:**
- Modify: `app/crate/api/schemas/me.py` (new models), `app/crate/api/me.py` (route after `stats_dashboard` :1090), `app/crate/api/social.py` (after :206)
- Test: `app/tests/test_stats_range_api.py`, `app/tests/test_openapi_contract.py`

**Interfaces:**
- Consumes: Task 3 functions.
- Produces: `StatsRangeArtistResponse`, `StatsRangeAlbumResponse`, `StatsRangeTrackResponse`, `StatsRangeDiscoveryResponse`, `StatsRangeResponse { start, end, available: bool = True, top_artists, top_albums, top_tracks, discoveries }`; routes `GET /api/me/stats/range` (`stats_range`) and `GET /api/users/{username}/stats/range` (`social_profile_stats_range`) with `start: date = Query(...)`, `end: date = Query(...)`, `limit: int = Query(3, ge=1, le=20)`, `response_model=StatsRangeResponse`, existing `responses`/tags, `summary="Listening summary for a date range"`; `ValueError` → `HTTPException(422)`.

- [ ] **Step 1: Failing tests** — 200 shape for both routes; `test_range_accepts_400_days_and_rejects_401`; 422 for `end < start`; 404 for unknown username; OpenAPI: both paths reference `StatsRangeResponse` and require security.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** (plus `test_db_access_boundaries.py`) → PASS. **Step 5: Commit** `feat(stats): expose range summaries for me and other listeners`.

### Task 5: Instance rollup tables (migration 109)

**Files:**
- Create: `app/crate/db/schema_sections/activity_v109.py` (`create_instance_listening_rollups_v109_schema(op)`), `app/crate/db/migrations/versions/109_instance_listening_rollups.py` (revision `"109"`, down `"108"`)
- Modify: `app/tests/test_crate_schema_definition.py:98` (heads `["109"]`)
- Test: `app/tests/test_listening_projection_migrations.py`

**Interfaces:**
- Produces: tables `instance_track_daily` (columns per spec, PK `(day, entity_key, artist, album)`, index `(day)`), `instance_entity_firsts` (PK `(entity_type, entity_key)`, index `(entity_type, first_day DESC)`); indexes `idx_user_track_daily_day ON user_track_daily(day)`, `idx_user_entity_firsts_key ON user_entity_firsts(entity_type, entity_key)`. All `IF NOT EXISTS`, following `activity_v105.py`.

- [ ] **Step 1: Failing test** `test_v109_creates_instance_rollups_and_indexes` with `RecordingExecutor`/`_replay` asserting the four statements. **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** (+ schema definition test) → PASS. **Step 5: Commit** `feat(stats): add instance listening rollup tables`.

### Task 6: Maintain instance rollups

**Files:**
- Create: `app/crate/db/jobs/instance_listening_rollups.py`
- Modify: `app/crate/db/jobs/user_listening_projections.py:527` (return rebuilt `days` and touched `keys`), `app/crate/worker_handlers/analysis.py:126` (enqueue), `app/crate/task_registry.py:40`, `app/crate/actors.py:70`, `app/crate/worker_handlers/analysis.py:1124`, `app/crate/api/__init__.py:145` (backfill trigger)
- Test: `app/tests/test_instance_listening_rollups.py`, `app/tests/test_user_listening_projections.py`

**Interfaces:**
- Produces:
  - `rebuild_instance_listening_days(session, days: list[date] | None) -> int` — advisory lock `pg_advisory_xact_lock(hashtext('instance_listening_rollups'))`, delete + insert from `user_track_daily` grouped by `(day, entity_key, artist, album)`, `listener_count = COUNT(DISTINCT user_id)`; `None` = all days.
  - `rebuild_instance_entity_firsts(session, keys: dict[str, list[str]] | None) -> int` — `MIN(first_day)` from `user_entity_firsts`, removing keys no user has.
  - `instance_listening_rollups_incomplete(session) -> bool`; `queue_instance_listening_backfill_if_needed() -> str | None`.
  - Task types `rebuild_instance_listening_days` (params `{"days": [iso], "keys": {...}}`, dedup key `instance-listening-days:` + sha1 of sorted days) and `backfill_instance_listening_rollups` (dedup `instance-listening-backfill`), same pool as `refresh_user_listening_stats`.
  - `refresh_user_listening_projections(...)` result gains `"days": [iso]` and `"keys": {...}` (empty on no-op; full rebuild reports `"full": True`).

- [ ] **Step 1: Failing tests** — two users seeded (`seed_listening_history(user_id=1…)`, `user_id=2`): `test_full_rebuild_matches_sum_of_user_days`; `test_incremental_day_rebuild_equals_full_rebuild` (new plays for one day, refresh, rebuild that day only, compare with a full rebuild); `test_rebuild_is_idempotent`; `test_instance_firsts_take_the_earliest_listener`; `test_backfill_is_queued_only_when_rollups_are_empty` (monkeypatch `create_task_dedup`); `test_refresh_reports_rebuilt_days_and_keys`; handler test that `refresh_user_listening_stats` enqueues `rebuild_instance_listening_days` with those days.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (incremental and full paths change together). **Step 4: Run** (+ `test_user_listening_projections.py`, `test_projector.py`) → PASS. **Step 5: Commit** `feat(stats): maintain instance listening rollups`.

### Task 7: Instance range route

**Files:**
- Modify: `app/crate/db/queries/user_library_stats_range.py`, `app/crate/api/analytics.py` (after :104)
- Test: `app/tests/test_stats_range_api.py`, `app/tests/test_openapi_contract.py`

**Interfaces:**
- Produces: `get_instance_stats_range(start: date, end: date, *, limit: int = 3, session=None) -> dict` (UTC `today`; same shape; `available=False` and empty lists when `instance_listening_rollups_incomplete`); route `GET /api/stats/range` (`api_instance_listening_stats_range`, tags `analytics`, `AUTH_ERROR_RESPONSES`).

- [ ] **Step 1: Failing tests** — `test_instance_range_sums_listeners` (two users), `test_instance_range_unavailable_before_backfill`, OpenAPI ref. **Step 2–4:** run, implement, run → PASS. **Step 5: Commit** `feat(stats): add the instance range summary`.

---

## Phase C1 · Snapshot additions

### Task 8: Previous-period overview

**Files:**
- Modify: `app/crate/db/queries/user_stats_periods.py` (new fn), `app/crate/db/queries/user_library_stats_signal.py:808` (`get_stats_signal` adds `overview_previous`), `app/crate/db/user_stats_dashboard_surface.py:148` (`_with_signal` moves it to `overview.previous`), `app/crate/db/instance_stats_dashboard_surface.py:63`, `app/crate/api/schemas/me.py:419`, `app/listen/src/components/stats/stats-types.ts:6`
- Test: `app/tests/test_user_stats_periods.py`, `app/tests/test_user_stats_signal.py`, `app/tests/test_instance_stats_dashboard_surface.py`

**Interfaces:**
- Produces: `previous_window(period: StatsPeriod) -> tuple[date, date] | None` (inclusive local days): rolling `Nd` → the N days before `start`; current month → first day of previous month through the same elapsed day (capped at its last day); closed month → whole previous month; current year → Jan 1 of previous year through `today − 1 year` (Feb 29 → Feb 28); closed year → whole previous year; `all_time` → `None`. `StatsOverviewPreviousResponse { start, end, minutes_listened: float, play_count: int, active_days: int, artist_count: int }`; `StatsOverview.previous?: StatsOverviewPrevious | null`.

- [ ] **Step 1: Failing tests** — one per window kind including Feb 29; `test_overview_previous_totals_match_daily_rows`; instance payload has `overview.previous`. **Step 2–4.** **Step 5: Commit** `feat(stats): compare overview with a like-for-like previous period`.

### Task 9: "New" flags and previous sound profile

**Files:**
- Modify: `app/crate/db/user_stats_dashboard_surface.py:77` (`build_user_stats_dashboard`), `app/crate/db/instance_stats_dashboard_surface.py:63`, `app/crate/db/queries/user_library_stats_story.py:210,494`, `app/crate/db/queries/user_library_stats_global.py:1376`, schemas `StatsTrackResponse:443`, `StatsArtistResponse:473`, `StatsAlbumResponse:485`, `StatsStoryResponse:603`; TS `StatsTrack`, `StatsArtist`, `StatsAlbum`, `StatsStory`
- Test: `app/tests/test_user_stats_signal.py`, `app/tests/test_instance_stats_dashboard_surface.py`

**Interfaces:**
- Produces: `is_new: bool` on top tracks/artists/albums (first play of that entity inside the period, matching the entity keys `_rebuild_firsts` writes at `user_listening_projections.py:230-268`; instance uses `instance_entity_firsts`; always `False` for `all_time`); `story.audio_profile_previous: StatsAudioProfileResponse | None` (same producer on `previous_window`, `None` when there is none).

- [ ] **Step 1: Failing tests** — `test_top_items_flag_entities_first_heard_in_period`, `test_all_time_marks_nothing_new`, `test_audio_profile_previous_uses_previous_window`. **Step 2–4.** **Step 5: Commit** `feat(stats): flag new entities and keep the previous sound profile`.

### Task 10: Music age both ways and heatmap facts

**Files:**
- Modify: `app/crate/db/queries/user_library_stats_signal.py:616,651`, schemas `StatsHeatmapResponse:748`, `StatsMusicAgeResponse:768`; TS `StatsHeatmap`, `StatsMusicAge`
- Test: `app/tests/test_user_stats_signal.py`

**Interfaces:**
- Produces: `music_age.share_this_year: float | None` (share of minutes from releases of the period's last year), `music_age.newest_album: StatsYearAlbumResponse | None`; `heatmap.night_hours: list[int]` (the 22–05 hours constant at `user_library_stats_signal.py:26`), `heatmap.listener_count: int | None` (instance only: distinct users with hourly rows in period).

- [ ] **Step 1: Failing tests** — `test_music_age_reports_newest_and_current_year_share`, `test_heatmap_exposes_night_hours`, `test_instance_heatmap_counts_listeners`. **Step 2–4.** **Step 5: Commit** `feat(stats): add music age range and heatmap facts`.

---

## Phase B · Explorer frontend

### Task 11: Explorer model

**Files:**
- Create: `app/listen/src/components/stats/explorer/stats-explorer-model.ts`, `…/stats-explorer-model.test.ts`

**Interfaces:**
- Produces:
  - `type ExplorerWindow = { from: number; to: number }` (bucket indexes, `to` exclusive)
  - `type ExplorerMode = { kind: "full" } | { kind: "window"; defaultSpan: number; minSpan: number; maxSpan: number }`
  - `explorerMode(selection: StatsPeriodKey, tape: StatsTape): ExplorerMode` — `7d`, `30d`, `month:*` → full; weekly tape → `{12, 2, 57}`; otherwise `{30, 7, min(count, 400)}`.
  - `defaultWindow(count: number, mode: ExplorerMode): ExplorerWindow`; `clampWindow(window, count, mode): ExplorerWindow`.
  - `bucketRange(tape: StatsTape, index: number): { start: string; end: string }` (weekly: Monday–Sunday clipped to `tape.end`); `stretchRange(tape, window)`.
  - `summarizeStretch(tape: StatsTape, window: ExplorerWindow): { buckets: number; minutes: number; average: number; silent: number; energy: number | null; valence: number | null }` (mood minutes-weighted from `tape.mood`, matching weekly mood buckets by Monday).

- [ ] **Step 1: Failing tests** — `chooses full mode for short periods`, `uses weekly spans on all-time tapes`, `clamps windows to min/max and edges`, `weekly bucket range is clipped to the tape end`, `summarizes minutes, silent days and weighted mood`, `summarizes an empty stretch without NaN`. **Step 2–4.** **Step 5: Commit** `feat(listen): add the stats explorer model`.

### Task 12: Range data hook

**Files:**
- Create: `app/listen/src/components/stats/explorer/use-stats-range.ts`, `…/use-stats-range.test.ts`
- Modify: `app/listen/src/components/stats/stats-types.ts` (`StatsRange`, item types mirroring Task 4)

**Interfaces:**
- Produces: `useStatsRange(base: string | null, range: { start: string; end: string } | null, limit: number): { data: StatsRange | null; loading: boolean; error: boolean }` — 300 ms debounce, `api(path, "GET", undefined, { signal })`, module cache (32 entries) keyed by URL, responses applied only for the latest key.

- [ ] **Step 1: Failing tests** (fake timers, mocked `@/lib/api`): `collapses rapid changes into one request`, `aborts the superseded request`, `ignores a stale response that resolves after a newer stretch`, `serves a cached stretch without a request`, `reports errors without throwing`. **Step 2–4.** **Step 5: Commit** `feat(listen): fetch stats range summaries`.

### Task 13: Explorer view and panel

**Files:**
- Create: `app/listen/src/components/stats/explorer/StatsExplorerView.tsx`, `StatsExplorerPanel.tsx`, `StatsExplorer.tsx`, tests `StatsExplorerView.test.tsx`, `StatsExplorerPanel.test.tsx`
- Modify: `app/shared/ui/tokens/recipes.css` (`.stats-explorer-*` near the stats recipes, reduced-motion block), 7 catalogs

**Interfaces:**
- Consumes: Tasks 11–12.
- Produces: `StatsExplorer({ tape, selection, rangeEndpoint }: { tape: StatsTape; selection: StatsPeriodKey; rangeEndpoint: string })`; pure `StatsExplorerView` (props: tape, mode, window, cursor, callbacks `onWindowChange`, `onOpenBucket`, `onMonth`) and `StatsExplorerPanel` (props: summary, range data, loading, available, `day` detail or null, `onBack`, `onPlayTrack`).
- i18n (en source): `stats.explorer.hint` "Drag the window, stretch its edges or pick a day.", `.window` "Selected stretch", `.windowValue` "{start} – {end}", `.stretch` "In this stretch", `.days` "{count, plural, one {# day} other {# days}}", `.average` "Average {minutes}/day", `.silent` "{count, plural, one {# day without listening} other {# days without listening}}", `.topArtist` "Artist of the stretch", `.topAlbum` "Album of the stretch", `.topTrack` "Most played track", `.mood` "Mood of the stretch", `.energy` "Energy", `.valence` "Valence", `.discoveries` "Discoveries", `.noDiscoveries` "None in this stretch", `.day` "Day in detail", `.week` "Week in detail", `.back` "Back to the stretch", `.nothingPlayed` "Nothing played that day.", `.plays` "{count, plural, one {# play} other {# plays}}", `.unavailable` "Top items for this stretch are still being prepared.", `.openDay` "Select to see the day".

- [ ] **Step 1: Failing tests** — view: `moves and resizes the window with the keyboard` (ArrowRight, Shift+ArrowRight, `+`, `-`; `aria-valuetext`), `drags the window with the pointer`, `opens a bucket with Enter`, `has no slider in full mode`, `month labels link to the month view`, `renders at 375px`; panel: `shows client numbers instantly and server blocks after loading`, `renders an empty stretch`, `shows the unavailable notice`, `lists the day's tracks and returns to the stretch`.
- [ ] **Step 2–4.** Then `npm --prefix app/listen run i18n:check -- --write-metadata`. **Step 5: Commit** `feat(listen): add the stats explorer`.

### Task 14: Wire the explorer into the page

**Files:**
- Modify: `app/listen/src/pages/use-stats-page-controller.ts` (`rangeEndpoint`), `app/listen/src/pages/Stats.tsx:68` (replace `StatsSignalTape`), remove `StatsSignalTape.tsx` and the `StatsSignalTapeView` component if unused (keep `TapeBars` and `stats-tape-model.ts` for Home's `StatsMiniTape`, moving `TapeBars` to `components/stats/TapeBars.tsx` if needed), `tools/crate-ui-showcase/stories/ListenStats.stories.tsx`, `tools/crate-ui-showcase/reviews/StatsOverviewReview.tsx`, `tools/crate-ui-showcase/stats-review.spec.ts`
- Test: `app/listen/src/pages/Stats.test.tsx`, `app/listen/src/components/home/HomeReplaySection` tests

**Interfaces:**
- Produces: `StatsPageController.rangeEndpoint: string` — `/api/me/stats/range`, `/api/users/${encodeURIComponent(username)}/stats/range`, `/api/stats/range`.

- [ ] **Step 1: Failing tests** — `renders the explorer for personal, user and global stats with their range endpoints`; Home mini tape still renders. **Step 2–4.** Then `npm run design-system:showcase:check` and the Playwright review spec at 375/1200. **Step 5: Commit** `feat(listen): replace the signal tape with the explorer`.

---

## Phase C2 · Page sections

### Task 15: Freshness and headline comparison

**Files:** Modify `app/listen/src/components/stats/StatsHeadlineNumbers.tsx`, create `app/listen/src/components/stats/StatsFreshness.tsx`; modify `app/listen/src/pages/Stats.tsx`; tests `StatsHeadlineNumbers.test.tsx`, `StatsFreshness.test.tsx`; catalogs.

**Interfaces:** `StatsFreshness({ snapshot, computedUntil, provisional })`; headline deltas from `overview.previous` (`+12 %`, `−3 %`, "—" when previous is 0 or absent). Copy: `stats.freshness.updated` "Updated {time}", `.counting` "today still counting", `stats.compare.vsPrevious` "vs previous {period}", `.noPrevious` "No previous period".

- [ ] Tests: `shows relative update time and counting state`, `shows signed deltas against the previous period`, `hides comparison for all time`. Implement, run, commit `feat(listen): add freshness and previous-period deltas to stats`.

### Task 16: Artist hero, top lists and "New" badges

**Files:** Modify `StatsArtistOfPeriodView.tsx`, `app/listen/src/pages/StatsCollectionPanels.tsx` (`TopArtistsPanel:117`, `TopTracksPanel:45`, `TopAlbumsPanel:246`); tests `StatsCollectionPanels.test.tsx`, a new `StatsArtistOfPeriodView.test.tsx`; catalogs.

**Interfaces:** hero line from `first_ever_day` (`stats.artistOfPeriod.since` "Listening since {year}", `.discovered` "Discovered this period"); top artists skip the hero when it is `top_artists[0]`, render up to 10 with a share bar (`minutes / overview.minutes_listened`); `InfoBadge` "New" (`stats.badges.new`) when `is_new`.

- [ ] Tests: `starts top artists at #2 when the hero is #1`, `renders up to ten artists with share bars`, `badges new tracks, artists and albums`, `hero says listening since or discovered`. Implement, run, commit `feat(listen): deduplicate the artist hero and badge new entities`.

### Task 17: Actionable highlights and Replay card

**Files:** Modify `StatsHighlightsView.tsx`, `StatsHighlights.tsx`, `app/listen/src/pages/StatsPageView.tsx:155` (`StatsActionBandView`), `app/listen/src/pages/Stats.tsx:178`; create `app/listen/src/components/stats/StatsReplayCard.tsx`; tests; catalogs.

**Interfaces:** obsession plays via `playAll([toPlayerTrack(track)], 0, …)`; streak shows `start`–`end`; "New artists" links to `#movement`; `StatsReplayCard({ replay, onPlay, onShuffle })` with four-cover mosaic, `localizedReplayTitle`, track count and minutes.

- [ ] Tests: `plays the obsession track`, `shows streak dates`, `links new artists to movement`, `replay card plays and shuffles`. Implement, run, commit `feat(listen): make stats highlights and replay actionable`.

### Task 18: Movement section

**Files:** Create `app/listen/src/components/stats/StatsMovement.tsx` (+ test); modify `app/listen/src/pages/Stats.tsx` (replace `StatsDiscoveriesCard`), `StatsClosingCards.tsx`/`StatsClosingViews.tsx` (remove the discoveries card); catalogs (reuse `stats.story.rising|newBlood|comeback|…`).

**Interfaces:** `StatsMovement({ story, exclude, scope })` — columns Rising (`delta_play_count`), New, Back; `exclude` = artist of the period + top-3 artist names; global renders Rising only; `id="movement"`.

- [ ] Tests: `excludes the hero and top three artists`, `shows only rising on global`, `shows empty copy per column`. Implement, run, commit `feat(listen): add the stats movement section`.

### Task 19: Genres with direction, music age both ways, sound profile reference

**Files:** Modify `StatsGenreTrendView.tsx`, `StatsClosingViews.tsx` (`StatsMusicAgeCardView`), `app/listen/src/pages/StatsSoundProfileView.tsx`, `app/listen/src/pages/stats-page-model.ts:110-133`; tests; catalogs.

**Interfaces:** each genre shows signed points (`stats.genreTrend.delta` "{delta} pts") and the biggest faller is included; music age adds `share_this_year` and `newest_album`; sound profile meters show the previous value marker and "your most energetic favourite" (top track with max energy); unknown values render "—".

- [ ] Tests: `shows genre direction and the biggest faller`, `shows newest album and this year's share`, `marks the previous sound profile`, `renders unknown audio values as a dash`. Implement, run, commit `feat(listen): add direction and reference to stats sections`.

### Task 20: Listening heatmap band (§4.7)

**Files:** Create `app/listen/src/components/stats/ListeningHeatmap.tsx`, `app/listen/src/components/stats/heatmap-model.ts` (+ tests); modify `app/listen/src/pages/Stats.tsx` (replace `StatsHeatmapCard`), `app/shared/ui/tokens/recipes.css:2220-2249`; delete `StatsHeatmapCard.tsx`; catalogs.

**Interfaces:** `buildHeatmapModel(heatmap: StatsHeatmap, { timezone, now }: { timezone: string | null; now: Date })` → levels, peak, night band, `nowCell | null` (null on invalid zone); `ListeningHeatmap({ heatmap, timezone, showNow, scope })` — `role="grid"`, one 24-column grid per `role="row"`, roving tabindex, readout on hover/tap/focus ("{weekday} {hour}:00 · {minutes}", not announced), peak outline, night band, counters (peak slot, night share, top genre), hidden grid below 3 listeners for global.

- [ ] Tests: model `computes the now cell across DST`, `handles St John's and Kathmandu offsets`, `returns no now cell for an invalid zone`; view `moves focus with arrow keys and shows the readout`, `outlines the peak and night band`, `hides the instance grid below three listeners`. Implement, run, commit `feat(listen): add the listening heatmap band`.

---

## Phase D · Docs and validation

### Task 21: Documentation and full validation

**Files:** Modify `docs/plans/2026-10-14-crate-v3-design-system.md` (§4.7 counters decision, explorer entry), `docs/plans/2026-10-19-crate-v3-listen-implementation-plan.md` (new section), `app/listen/AGENTS.md` (Stats rules: explorer, range endpoint, v3 key).

- [ ] **Step 1:** Update the docs above.
- [ ] **Step 2: Full validation** — Listen + Desktop typecheck, `npm run --workspace=app/listen lint`, `npm run --workspace=app/listen i18n:check`, `npm run --workspace=app/listen test`, `npm run --workspace=app/listen build && npm run --workspace=app/listen check:bundle`, `npm run design-system:showcase:check`, Playwright stats review spec, ruff, Go tests, and `"$SP/pytest-docker.sh" app/tests/` (excluding the two suites `make dev-test-backend` ignores).
- [ ] **Step 3: Commit** `docs(stats): record the refactor decisions`, then request the final branch review.
