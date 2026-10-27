# Listening stats projections

How Listen Stats turns `user_play_events` into the dashboard, the signal tape, the live "today"
counter and the Crate Digging story, and which rules keep it cheap on hot paths.

## Source of truth

`user_play_events` stays the source of truth. Every derived table can be rebuilt from it. The
semantics are pinned under `metrics_version: "listening-v1"`: `play_count` counts accepted events,
minutes come from `played_seconds`, and completions and skips are separate metrics.

## Periods and timezone

- `users.timezone` (migration `104`) stores an IANA zone. Listen auto-detects it from the
  browser or device (`TimezoneAutodetect`) and only writes it when the user has none; the account
  settings field lets the user change it. Invalid zones are rejected by the profile schema.
- Every day boundary uses the user's local day. Users without a timezone fall back to UTC.
- `crate/db/queries/user_stats_periods.py` resolves a window into a `StatsPeriod` (local start
  and end day, previous comparable period, local today). Supported windows: `7d`, `30d`, `90d`,
  `365d`, `all_time`, `year:YYYY` (calendar year, provisional while it is the current year) and
  `month=YYYY-MM`. `normalize_user_stats_window` maps unknown values to `30d`.
- Changing the timezone schedules `refresh_user_listening_stats`; the projection state stores the
  zone it was built with, and a mismatch forces a full rebuild.

## Projection tables (migration `105`)

| Table                                   | Grain                                | Notes                                                  |
| --------------------------------------- | ------------------------------------ | ------------------------------------------------------ |
| `user_listening_dirty_days`             | user, local day                      | Marked inside the `record_play_event` transaction      |
| `user_track_daily`                      | user, day, entity key, artist, album | Plays, completions, skips, minutes, genre              |
| `user_daily_listening`                  | user, day                            | Existing table, now rebuilt per dirty day              |
| `user_hourly_listening`                 | user, day, hour                      | Feeds the weekday x hour heatmap                       |
| `user_entity_firsts`                    | user, entity kind, entity key        | First day an artist, album or track was played         |
| `user_listening_sessions`               | user, session start                  | Gaps-and-islands with a 30 minute gap                  |
| `user_listening_projection_state`       | user                                 | Timezone, `built_at`, `refreshed_at`                   |
| `user_{track,artist,album,genre}_stats` | user, `stat_window`                  | Rebuilt from `user_track_daily`, including `year:YYYY` |

`crate/db/jobs/user_listening_projections.py` owns the writes:

- `refresh_user_listening_projections` drains dirty days, recomputes only those days in the daily
  tables, updates firsts and sessions for the touched keys and rebuilds the window stats.
- `rebuild_user_listening_projections` recomputes everything. It is the reference result: a test
  asserts that the incremental path produces the same rows.
- The worker task `refresh_user_listening_stats` (debounced 300 s after a play) runs the
  incremental path through `user_library_aggregate_runner`.

Rule: anything that writes `user_play_events` must call `mark_listening_day_dirty` in the same
transaction, or the projections drift until the next full rebuild.

## Instance rollups (migration `135`)

`instance_track_daily` is `user_track_daily` summed across users per user-local day, with
`listener_count`; `instance_entity_firsts` keeps the first day anyone played an artist, album or
track. `crate/db/jobs/instance_listening_rollups.py` owns the writes:

- The runner enqueues them in the refresh transaction: an incremental refresh queues
  `rebuild_instance_listening_days` (dedup `instance-listening-days:<sha1 of the days>`); a full
  user rebuild queues `backfill_instance_listening_rollups` (dedup `instance-listening-backfill`).
  Batch rebuilds of several users queue one backfill after the loop, and a hard user delete
  queues it in the delete transaction.
- A day task rebuilds those days and refreshes firsts for its keys plus every key on those days,
  so a task shared by several listeners stays complete. It releases its dedup key before reading,
  so a refresh that commits while it runs enqueues a new task instead of being swallowed.
- API startup queues the backfill while `instance_listening_rollups_incomplete`
  (`crate/db/queries/instance_listening_status.py`, a read-only probe) is true: listening exists
  but the rollups miss its earliest day.

## Dashboard contract v2

`GET /api/me/stats/dashboard` serves the persisted `stats:dashboard` snapshot (stale-first, cold
payload with `provisional: true` when nothing is built yet). The worker prewarms `30d`, `90d`,
`year:{current}` and `all_time`. The Go read plane serves the same snapshot and accepts
`window=year:YYYY`.

The v2 fields are additive to the v1 payload and pinned by
`app/tests/fixtures/stats_dashboard_contract.json`:

- `timezone`, `provisional`, `computed_until`, `metrics_version`
- `tape`: `granularity` (`day` up to 400 days, `week` above), zero-filled `points`, `mood`
  (energy/valence per bucket), `peaks` and per-month `months`
- `highlights`: distinct `artist_count`, longest and current streak, new artists, longest
  session and the obsession day
- `artist_of_period`: plays, minutes, active days, top album and, when the artist has at least
  five listeners on the instance, `listener_top_percent`
- `heatmap` (7 x 24 cells, peak, night share), `music_age` (median year, decades, oldest album)
  and `genre_trend` (share and delta against the previous period)

`crate/db/queries/user_library_stats_signal.py` builds these sections. Its SQL is scoped with
`(CAST(:user_id AS integer) IS NULL OR user_id = :user_id)`, so the same queries build the
instance-wide Crate Pulse dashboard (`stats:dashboard:instance`), which the projector schedules
with a 300 s debounce and the worker builds. `GET /api/stats/dashboard` only reads that snapshot.

### Dashboard contract v3

v3 adds fields to v2 without removing any. The snapshot subject keys carry the `v3` prefix:
`v3:user:{id}:{period}:{month|default}:{tracks}:{artists}:{albums}:{genres}:{replay}` for users
and `v3:instance:{period}:...` for Crate Pulse. Python (`stats_dashboard_subject_key`) and the Go
read plane (`statsDashboardSubjectKey`) must produce the same bytes. The API and the prewarm use
the 12/10/14/10/36 limits.

- `snapshot`: `scope`, `subject_key`, `version`, `built_at`, `source_seq`, `stale_after`,
  `stale`, `pending` and `generation_ms`.
  - A cold payload has `version: 0` and `pending: true`. Listen refetches every 1.5 s, up to 40
    times (about a minute), until a versioned reading arrives.
  - `built_at` and `stale_after` are ISO 8601 timestamps with a timezone. FastAPI emits
    microseconds and `Z`. The read plane emits RFC 3339 with trailing zeros trimmed, and omits
    `pending`.
- `overview.previous`: the comparable previous window (`start`, `end`, `minutes_listened`,
  `play_count`, `active_days`, `artist_count`). It is `null` when the period has none, for
  example all time. The headline deltas compare against it.
- `is_new` on `top_tracks`, `top_artists` and `top_albums` items: the item's first-ever play falls
  inside the period. User dashboards read `user_entity_firsts` and Crate Pulse reads
  `instance_entity_firsts`, in one batched lookup (`queries/user_stats_new_flags.py`).
- `story.audio_profile_previous`: the audio profile of the previous window, or `null` when there
  is none. Unknown energy, valence, danceability or BPM is `null`, never `0`.
- `heatmap.night_hours`: the hours counted as night (22 to 5).
- `heatmap.listener_count`: distinct listeners in the period. It is set on Crate Pulse only.
- `heatmap.hidden_reason` (PD43): below three listeners the instance builder stores
  `"few_listeners"` with an all-zero grid, `peak: null` and `night_share: null`, so individual
  habits never leave the snapshot.
- `music_age.newest_album`: the newest release heard in the period.
- `music_age.share_this_year`: the share of minutes from releases dated in the year of the
  period's last day (`min(end - 1 day, today)`). Listen names that year in the copy.
- `genre_trend`: up to six entries plus an optional entry with `faller: true`. The faller is the
  biggest drop (at most -0.5 points) among the remaining current genres and the genres heard only
  in the previous window. Both windows are read in full, so deltas compare real shares.

The explorer reads a separate range endpoint, never the snapshot:
`GET /api/me/stats/range`, `/api/users/{u}/stats/range` and `/api/stats/range`
(`queries/user_library_stats_range.py`).

- Parameters: `start` and `end` are inclusive local days, and `limit` is 1-20 (default 3).
- A stretch that is inverted, ends after the subject's today, or spans more than 400 days
  returns 422.
- Today is the subject's local day for users and UTC for the instance.
- Each request opens one read scope. That scope covers the profile lookup, the timezone and the
  CTE over `user_track_daily` or `instance_track_daily`.
- The response holds `start`, `end`, `available`, `top_artists` (with `share`), `top_albums`,
  `top_tracks` and `discoveries`.
- The instance answers `available: false` with empty lists until the rollups cover history. Listen
  shows that answer but does not cache it.

## Live today counter

`record_play_event` registers an after-commit callback that increments the Redis hash
`stats:today:{user}:{local day}` (48 h TTL). `GET /api/me/stats/today` reads it and falls back to
the `user_daily_listening` row, so the headline "minutes today" moves without rebuilding the
dashboard snapshot.

## Listen surfaces

- `/stats`: period picker, the stats explorer (range window over the tape, backed by
  `/api/me/stats/range`, `/api/users/{u}/stats/range` and `/api/stats/range`), headline numbers,
  artist of the period, highlights, heatmap band, genre trend, music age and movement.
- `/stats/digging`: full-screen story chapters built from the same payload. The share action
  renders a 1080x1920 canvas card (`drawDiggingStoryCard`) for Instagram stories.

## Performance baseline

`CRATE_STATS_BENCH=1 pytest tests/test_stats_projection_bench.py -s` seeds 100K events over four
years. Reference numbers on a laptop: full rebuild about 800 ms, one-day incremental refresh about
125 ms, dashboard build 60-120 ms per window, `all_time` payload about 230 KB. None of this runs in
an HTTP request.
