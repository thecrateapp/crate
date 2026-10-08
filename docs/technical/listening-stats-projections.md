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

## Live today counter

`record_play_event` registers an after-commit callback that increments the Redis hash
`stats:today:{user}:{local day}` (48 h TTL). `GET /api/me/stats/today` reads it and falls back to
the `user_daily_listening` row, so the headline "minutes today" moves without rebuilding the
dashboard snapshot.

## Listen surfaces

- `/stats`: period picker, signal tape (custom SVG), headline numbers, artist of the period,
  highlights, heatmap, genre trend, music age and discoveries.
- `/stats/digging`: full-screen story chapters built from the same payload. The share action
  renders a 1080x1920 canvas card (`drawDiggingStoryCard`) for Instagram stories.

## Performance baseline

`CRATE_STATS_BENCH=1 pytest tests/test_stats_projection_bench.py -s` seeds 100K events over four
years. Reference numbers on a laptop: full rebuild about 800 ms, one-day incremental refresh about
125 ms, dashboard build 60-120 ms per window, `all_time` payload about 230 KB. None of this runs in
an HTTP request.
