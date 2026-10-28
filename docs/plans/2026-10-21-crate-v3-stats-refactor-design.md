# Stats refactor: explorer, comparisons and instruments

Branch `feat/stats-explorer` (from `feat/crate_v3` at `6b05848b`). Covers `/stats`,
`/users/:u/stats` and `/stats/global` in Listen. Approved by Diego on 2026-10-21 after prototypes
(tape proposals 1–3, explorer chosen) and an audit of the current page.

## Goals

- Replace the top minutes tape with an **explorer**: pick any stretch of the period and see what
  defined it, down to a single day.
- Give every number context (previous period, "new", direction) and remove repeated information.
- Turn static cards into instruments you can interrogate (heatmap, highlights, replay, movement).
- Fix the snapshot contract so cold periods show "building" instead of an empty page.

Non-goals: Home "Listening DNA" tile, Admin heatmap, `heatmap_utc`, new chart libraries, changes to
how plays are recorded.

## Verified baseline (2026-10-21)

- One snapshot payload per subject and period: `/api/me/stats/dashboard` (read plane native),
  `/api/users/{u}/stats/dashboard` and `/api/stats/dashboard` (FastAPI only).
- Key `v2:user:{id}:{period}:{month}:{tracks}:{artists}:{albums}:{genres}:{replay}` in Python
  (`user_stats_dashboard_surface.py:48,59-74`) and Go (`stats_dashboard.go:16-25,76-86`); instance
  key `instance:{period}:…` has no version (`instance_stats_dashboard_surface.py:56-60`).
- `StatsDashboardResponse` (`api/schemas/me.py:791-813`) does not declare `snapshot`, so FastAPI
  drops it and cold payloads never poll (`use-stats-page-controller.ts:155-158`).
- Instance limits disagree (albums 10 API / 12 prewarm / 14 Listen): the key Listen requests is
  never prewarmed.
- Data sent but unused: `story.movers|comebacks`, `top_genres`, `replay` details,
  `artist_of_period.first_ever_day`, `highlights.longest_streak.start|end`, obsession `track_id`,
  i18n keys `stats.story.rising|newBlood|comeback…`.
- No previous-period values except `story.movers` and `genre_trend.delta_vs_previous`.
- Projections: `user_track_daily` PK `(user_id, day, entity_key, artist, album)`,
  `user_entity_firsts` PK `(user_id, entity_type, entity_key)`; nothing indexed by `day` alone.
  Next migration is `109`.

## A. Snapshot contract (fix first)

- Declare `snapshot { scope, subject_key, version, built_at, stale_after, stale, pending }` on
  `StatsDashboardResponse` (all three routes). Cold path keeps `pending: true`.
- Listen: `hasStats` treats `snapshot.pending` as not empty; the pending poll then works on the
  FastAPI fallback too.
- Unify instance limits to the Listen request (tracks 12, artists 10, albums 14, genres 10, replay
  36) in API defaults, prewarm and worker.
- Bump the user key to `v3` in Python and Go (and their tests) because sections B–C add payload
  fields; prefix the instance key with `v3:` as well. Old snapshots are ignored and rebuilt by the
  existing stale/refresh path.
- Every new payload field is declared in the Pydantic schema and the TS types in the same change.

## B. Explorer (replaces `StatsSignalTape` on the page)

`TapeBars` stays for Home's mini tape.

### Behaviour

- **Overview strip**: the whole period as mini bars, with a draggable/resizable window (pointer,
  touch, keyboard: arrows move 1 bucket, Shift+arrows 7, `+`/`−` resize; `role="slider"` with
  `aria-valuetext`). Month labels are links to the existing month view (`?month=`).
- **Detail chart**: the selected stretch at full height with gridlines and labels, average line,
  peaks in accent and accent dots on discovery days. Arrow keys move a cursor, Enter opens the day.
- **Panel "In this stretch"** (right; below on narrow containers, `aria-live="polite"`): dates,
  minutes, average/day, silent days, mood (label, energy and valence meters), top artist with
  share, top album, most played track, discoveries.
- **Day detail**: clicking a bucket shows what played that day (that week on weekly tapes), with
  "Back to the stretch".
- **Adaptive by period**: `7d`, `30d` and months have no strip (the whole period is the stretch);
  `90d`, `365d`, `year:*` open a 30-day window ending today; `all_time` uses the weekly tape with
  a 12-week default and a 400-day maximum.
- **Motion**: the window opens once from today backwards (≈1.1 s, ease-out-expo); nothing moves
  at rest; reduced motion renders the final state.
- Hand-built SVG instrument (§3.5), Listen-local, CSS in the stats recipe. 375 px and 1200 px
  layouts.

### Data

- **Client-side, instant**: minutes, average, silent days and mood come from `tape.points` and
  `tape.mood` (daily ≤ 120 days, weekly beyond, minutes-weighted).
- **Server, debounced 300 ms, aborted when superseded, cached per stretch**:
  `GET /api/me/stats/range`, `/api/users/{u}/stats/range`, `/api/stats/range` with
  `start`, `end` (inclusive local days, `end − start ≤ 400 days`, else 422) and `limit` (1–20).

```json
{
  "start": "2026-09-21",
  "end": "2026-10-20",
  "top_artists": [{ "artist_name": "", "artist_id": 0, "artist_slug": "", "minutes": 0, "plays": 0, "share": 0 }],
  "top_albums": [{ "album": "", "artist": "", "album_id": 0, "album_slug": "", "minutes": 0, "plays": 0 }],
  "top_tracks": [{ "track_id": 0, "title": "", "artist": "", "album": "", "album_id": 0, "plays": 0, "minutes": 0 }],
  "discoveries": [{ "artist_name": "", "artist_id": 0, "artist_slug": "", "first_day": "", "minutes": 0 }]
}
```

- `start`/`end` are local days of the subject (the user's timezone; UTC days for the instance,
  matching the instance tape). `share` is the item's share of the stretch's minutes. `limit`
  applies to each list. A day uses `start = end` with `limit = 20` tracks; a week on weekly tapes
  uses its Monday–Sunday bounds. Covers resolve only for returned rows (the existing
  `_TRACK_REF_JOINS` pattern).
- Query in `crate/db/queries/user_library_stats_range.py`: one CTE in `read_scope()` over
  `user_track_daily` (PK prefix range scan) and `user_entity_firsts`; `response_model`,
  `summary`, existing tags and OpenAPI contract test. User stats keep today's visibility
  (authenticated).

### Instance rollups (option A, for `/api/stats/range`)

- Migration `109`: `instance_track_daily` mirrors `user_track_daily` without `user_id`
  (`day, entity_key, artist, album, track_id, global_track_uid, track_entity_uid, track_path,
  title, genre, play_count, complete_play_count, skip_count, minutes_listened`) plus
  `listener_count`, keyed by `(day, entity_key, artist, album)`; `instance_entity_firsts
  (entity_type, entity_key, artist, album, first_day)` holds the first play by anyone on the
  instance, which is what "discovery" means in the global view. Indexes: `user_track_daily (day)`
  and `user_entity_firsts (entity_type, entity_key)` for the rebuilds.
- Days are user-local days summed across users, the same semantics as today's instance tape.
- Maintenance: after `refresh_user_listening_projections` commits, enqueue a deduplicated
  `rebuild_instance_listening_days(days)` task; it takes one advisory lock, deletes and rebuilds
  those days from `user_track_daily`, and refreshes instance firsts for the touched keys. The full
  rebuild path and the incremental path change together (`crate/db/AGENTS.md`).
- `backfill_instance_listening_rollups` (quiet) fills history once; the global explorer degrades to
  client-side numbers until it finishes.

## C. Page sections

Order (personal; others omit what they lack): header and freshness → headline numbers → explorer →
action band (Digging, Replay card) → artist of the period → highlights → movement → top tracks and
artists → top albums → listening band (heatmap) → sound profile and genres → music age → affinity.

1. **Freshness** (S): "Updated 4 min ago · today still counting" from `snapshot.built_at`,
   `computed_until` and `provisional`.
2. **Headline numbers with comparison** (M): minutes, plays, active days and artists each show the
   change against the previous period ("+12 % vs previous 30 days"). Like-for-like windows: rolling
   windows use the previous equal window; months and the current year compare the same elapsed
   days of the previous month/year; past years and months compare whole periods; `all_time` shows
   no comparison. New snapshot field `overview.previous { minutes, plays, active_days, artists,
   start, end }`.
3. **Artist of the period** (S): uses `first_ever_day`: "listening since 2019" or "discovered this
   period". Listener standing stays as is.
4. **Top artists without duplication** (S): when the hero is also #1, the list starts at #2; shows
   up to the 10 requested (6 today) with a thin share-of-minutes bar. Top tracks, albums and artists
   gain a "New" badge from `user_entity_firsts` (`is_new` per item, snapshot).
5. **Highlights, actionable** (S): the obsession plays its track (`track_id`); the longest streak
   shows its dates; "New artists" links to Movement.
6. **Replay card** (S): mosaic of the first four covers, localized `title_key`, track count and
   minutes, Play and Shuffle; replaces the bare button.
7. **Movement** (S–M): three columns, Rising (`story.movers`, +N plays), New (`story.discoveries`)
   and Back (`story.comebacks`), using the existing `stats.story.*` copy. Excludes the artist of the
   period and the top-3 artists to avoid repetition; global shows Rising only. Replaces the
   discoveries card.
8. **Listening heatmap** (M, design system §4.7, band variant): `ListeningHeatmap` +
   `heatmap-model.ts` replace `StatsHeatmapCard`. 168 cells as a `role="grid"` with roving focus,
   readout on hover/tap/focus ("Sunday 22:00 · 412 min", not announced), peak outlined, night
   band from `heatmap.night_hours`, "now" cell on the user's own `/stats` (DST-safe timer), fixed
   hour axis. Instance grid hidden below 3 listeners (D30, `heatmap.listener_count`). Band counters
   show heatmap facts (peak slot, night share, top genre) instead of repeating the headline
   numbers.
9. **Sound profile with reference** (S–M): meters compare with the previous period
   (`story.audio_profile_previous`) and name "your most energetic favourite" from the top tracks;
   unknown values render "—", not 0 %.
10. **Genres with direction** (S): each genre shows its change in points; the biggest faller is
    included. `genres_limit` stays in the key.
11. **Music age both ways** (S): adds the share of releases from the current year and the newest
    album (`music_age.share_this_year`, `music_age.newest_album`) next to the oldest.

All copy goes through `t()` in the 7 catalogs; no emojis; v3 tokens, primitives and recipes only.

## Tests and validation

- pytest: snapshot `snapshot` block on the three routes, limits alignment, key `v3` (Python + Go
  tests), each new snapshot field, previous-period windows (rolling, month, current year, past
  year, all_time), range endpoint (bounds, 422, day detail, three scopes, covers), instance
  rollups (incremental vs full rebuild equality, concurrent days, firsts), backfill.
- Go: dashboard key and fallback table tests.
- Vitest: explorer model (windowing, clamping, adaptive periods, client summaries, axis), view
  (keyboard, drag, day detail, fetch debounce/abort/cache), each section's states, heatmap model
  (DST, St John's, Kathmandu, invalid zone) and grid, 375 px renders.
- Storybook/showcase: update `ListenStats` stories and the Stats review host with fixtures for
  every new section; Playwright review spec at 375/1200 px.
- Full validation once at the end: Listen and Desktop typecheck, lint, i18n check, build and
  bundle, backend and read-plane tests.

## Delivery

One branch, phased commits, each green on its own: A → B backend → B frontend → C sections → C
heatmap → docs and full validation. Design-system and Listen plan documents are updated with the
decisions above.
