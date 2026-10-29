# Music Paths: latency closure checkpoint

Measured on 2026-10-29 against source commit `0c947f84`, stacked on PR2.
Scene planning meets the approved budgets. Full indexed acoustic verification
is recorded separately below; scene parity does not certify approximate
nearest-neighbor selection.

## Scene planning on the production catalog

| Case               | Requested / returned | Samples |     p50 |     p95 | Maximum | SELECTs |
| ------------------ | -------------------: | ------: | ------: | ------: | ------: | ------: |
| Citizen → Converge |              20 / 20 |      25 | 1.307 s | 1.447 s | 1.448 s |      13 |
| Punk → Electronic  |              20 / 20 |      25 | 1.446 s | 1.554 s | 1.572 s |       7 |
| Electronic → Punk  |              20 / 20 |      25 | 1.374 s | 1.607 s | 1.652 s |       7 |
| Citizen → Converge |            100 / 100 |      25 | 3.764 s | 4.179 s | 4.250 s |      13 |
| Punk → Electronic  |             100 / 97 |      25 | 3.215 s | 3.604 s | 3.666 s |       7 |

The targets are p95 ≤2 s for 20 songs and ≤6 s for 100. An additional reverse
100-song control returns all 100 in 3.283 s; it is a single probe, not a p95.
The 97-song forward result and its `insufficient_tracks` warning also occur in
the reference implementation. Optimization does not silently fill it with
weaker or unrelated songs.

Candidate retrieval now requests all scene pools in one SQL statement per helper
invocation, preserving
each genre's cap, per-performer ranking and existing join cardinality. Three
representative pool comparisons cover **5,326 complete rows** with identical
values and order. Candidate SELECTs fall from 4/7/3 to one per invocation;
Citizen still makes three invocations for its scene context. Whole-plan A/B
comparisons against `c6f4efb1` retain identical songs, ordering, anchors and
reports for all three cases at both 20 and 100 requested songs. The 125 accepted
timing samples have no output changes for their fixed case and seed. Musical
weights, routing, history, radio and fallback policies are unchanged.

### Method and boundaries

- All planning helpers execute their real read scopes against the production
  catalog: 137,764 tracks, PostgreSQL 15.18 and pgvector 0.8.5. The earlier
  PostgreSQL row estimate was stale; the exported snapshot provides the actual
  count.
- An isolated process loads the 21 verified local sources without deploying
  them. Every connection forces read-only transactions; a second guard rejects
  DML/DDL. AI, saved-path persistence and cache writes are blocked. No forbidden
  operation is attempted. Redis only issues `GET`/`PING`.
- Each run uses a synthetic neutral listener (`0`), the real empty history
  query, seed `musical-rotation-controlled`, and a warm taxonomy cache with its
  normal revision checks. A preliminary probe warms each case. Timed samples
  then run serially without this team's catalog export or other benchmarks.
- Timings cover complete in-process planning, including SQL and validation.
  Normal synchronous Redis reads during the call are included: the guard
  delegates to the original client, without a substituted or preloaded cache.
  Source loading, initial taxonomy warmup/connection, endpoint-ID resolution,
  subsequent metrics/printing, HTTP, authentication, response serialization and
  transport are outside the clock. These are case/seed measurements, not a
  production-wide request percentile. The original evaluator's scope label
  incorrectly excluded Redis transport; the public JSON corrects that label
  after inspecting the runner, without changing any duration.
  `redis_commands` records commands seen across the process, including warmup;
  it does not attribute them to individual timed samples.
- p95 is the nearest rank `ceil(0.95 × n)` of 25 samples, with no interpolation
  or discarded slow samples. Full distributions and source hashes are in the
  [sanitized evidence](music-paths-latency-evaluation.json).
- A combined 100-song run lost its distribution after an SSH reset. It is
  excluded completely; each case was repeated in a separate process, saving
  every sample incrementally. Only those complete distributions are reported.

### Reproduction recipe

Use an isolated process importing `app/` from this worktree at the recorded
source commit and an equivalently populated PostgreSQL catalog. Absolute
durations depend on hardware and physical layout; the exported private catalog
is not part of these fixtures.

1. Resolve Citizen and Converge from `library_artists`, matching names
   case-insensitively. Supply their local IDs as strings with type `artist`.
   The other two cases use type `genre`, slugs `punk` and `electronic`, in both
   directions. Resolve these references before starting the timer.
2. Force `default_transaction_read_only=on` on every connection checkout and
   reject DML/DDL in the SQL execution hook. Keep the normal `read_scope` and
   `optional_scope` implementations. Use real empty user tables for listener
   `0`; do not replace history queries, graph loading or candidate retrieval.
   Block persistence, AI calls and cache writes. Disable optional refinement by
   returning its input `tracks`; leave deterministic validation active.
3. Warm `crate.genre_taxonomy.get_genre_catalog()` with normal revision checks.
   Call `crate.music_paths.build_music_path_plan(origin_type, origin_value,
dest_type, dest_value, waypoints=[], step_count=count, user_id=0,
selection_seed="musical-rotation-controlled",
now=datetime(2026, 10, 28, 12, tzinfo=timezone.utc), previous_tracks=None)`.
   `count` is 20 or 100. Preserve each helper's normal session lifecycle rather
   than substituting a shared benchmark transaction.
4. For each case/count, take one complete preliminary probe. If it exceeds its
   budget, profile and inspect SQL plans before running a distribution. Otherwise
   make 25 serial calls, with a fresh `time.perf_counter()` immediately before
   and after each `build_music_path_plan` call. No other local benchmark or
   export runs concurrently on the database host.
5. Count SQLAlchemy `before_cursor_execute` statements starting with `SELECT`
   or `WITH` while the timer is active. `SET`, transaction control, and Redis
   commands are excluded from this SELECT count. Save each duration and count
   immediately. Compare every full result to its probe, then compute the
   median, nearest-rank p95 and maximum without dropping slow samples.
6. For exact old/new parity, use one `REPEATABLE READ, READ ONLY` snapshot per
   comparison and identical inputs. Compare complete ordered rows and plan
   payloads, independently of the latency runs with normal scopes.

`public_tracks_sha256` hashes the ordered list of objects with keys `artist`,
`title`, `album`, `path_genre`, and `progress`, including null values. Encode
`json.dumps(tracks, ensure_ascii=False, sort_keys=True, separators=(',', ':'))`
as UTF-8, then apply SHA-256. Other `result_sha256` and
`ordered_rows_sha256` fields are opaque equality evidence for complete internal
plans/SQL rows; their private inputs are intentionally omitted and those hashes
cannot be reconstructed from the public track projection.

## Indexed acoustic planning

Verification in progress on an isolated, disposable catalog replica. No index,
migration, application deployment or user data has been changed in production.

## Scoped verification

The new candidate-query suite has nine passing cases. It covers exact legacy
row/order parity, input deduplication and ordering, per-genre/per-performer caps,
alias weights, compilation performers, duplicated ID/UUID statistics, likes,
case variants, playability and caller-owned sessions. The 116 affected consumer
checks pass; scoped Ruff and Pyright checks pass. Independent specification and
quality reviews approve the batch implementation.

The prior [catalog validation checkpoint](music-paths-validation-review.md)
retains the musical lists and historical unindexed probes. This checkpoint
supersedes its scene latency gate, not the pending musical listening review or
HTTP measurements. PR3 has not been published, merged or deployed.
