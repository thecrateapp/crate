# Music Paths: latency closure checkpoint

> Historical capture: this report describes its recorded source snapshot before the reviewed fixes. Its measurements, warnings and approval notes do not validate the current implementation. See the [evidence index](README.md) and [current behavior](../../music-paths.md).

Captured on 2026-10-29 from the recorded source snapshots. The scene and indexed
acoustic runs met their budgets for those historical implementations.
These are distinct environments; local acoustic measurements are not production
or HTTP percentiles. Scene sources are frozen at `0c947f84`; final acoustic
sources at `586b855e`.

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

The captured candidate retrieval requested all scene pools in one SQL statement per helper
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
  catalog, with PostgreSQL 15.18 and pgvector 0.8.5. Exact source inventory counts are omitted from this historical record.
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
  or discarded slow samples. Historical percentile summaries and source hashes are in the
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

## Indexed acoustic planning on the local catalog replica

| Case                                                        | Requested / returned | Samples |     p50 |     p95 | Maximum | SELECTs |
| ----------------------------------------------------------- | -------------------: | ------: | ------: | ------: | ------: | ------: |
| Concubine → To Our Friends in the Great White North         |              20 / 20 |      25 | 0.125 s | 0.163 s | 0.194 s |      29 |
| Concubine → To Our Friends in the Great White North         |            100 / 100 |      25 | 0.306 s | 0.472 s | 0.520 s |     109 |
| Jane Doe → We Are the Romans, via The Dillinger Escape Plan |              20 / 20 |      25 | 0.126 s | 0.152 s | 0.152 s |      31 |
| Jane Doe → We Are the Romans, via The Dillinger Escape Plan |            100 / 100 |      25 | 0.307 s | 0.368 s | 0.390 s |     111 |

The track endpoints are Converge and Botch recordings; the second case uses
their albums and an artist waypoint. All 100 samples preserve the endpoints
and requested counts, with consistent generation reports and no duplicate track
IDs or recognized canonical song families. Three track-100 samples contain one
punctuation-only Melvins title without a canonical family key; its family
uniqueness cannot be certified by this normalizer. Both 20-song cases have no
warnings. Two of 25 track-100 samples and
five of 25 album-100 samples have quality warnings while still generating 100
tracks: `is_partial` also reflects quality warnings, not only a missing count.
The final warning details and musical lists remain listening-review evidence,
not approval of every transition or proof that title normalization recognizes
every equivalent edition.

### What the index verification found

1. Revision 139 restores the expected HNSW cosine index. On this replica it
   builds in 14.211 s, occupies 50,167,808 bytes, and is both valid and ready.
   Real candidate SQL, including album/performer joins and exclusions, uses the
   cosine index. Six sampled exact/ANN comparisons with 2/51/99 exclusions share
   89 of 90 top-15 neighbors. This sampled recall is not a universal guarantee.
2. The first indexed distribution still fails track-20: p95 2.139 s, maximum
   4.416 s. Six endpoint lookups account for 84–95% of the observed time because
   column-to-text comparisons scan the track heap. Commit `a09f45f3` makes these
   references indexable without accepting new spellings. A/B comparisons retain
   identical complete plans in nine controls, including all five previously
   warning-bearing controls, using the same index and repeatable snapshot.
3. After removing those scans, the first album-20 probe takes 4.759 s. Its two
   anchors traverse about 21,000 tracks each and return only 10/11 candidates
   where the albums have 12/21 eligible tracks. Commit `586b855e` resolves the
   album scope through native ID/UUID indexes and searches its tracks by
   `album_id`, ordering by the same distance. Real ID/UUID and embedding/array
   queries, at limits 1 and 240, use those indexes without planner overrides
   and recover the complete pools. Candidate recovery can change a flexible
   anchor relative to the truncated ANN pool.

The earlier diagnostic outcomes remain summarized in the acoustic artifact; bulky embedded histories are omitted. Final measurements
follow these code changes; none of the failed or slow samples is relabeled or
silently discarded. Per-case percentile summaries are retained, with four separate warmup
calls (0.188/0.329/0.170/0.334 s). No further code changes occurred during the
final run.

### Replica, methodology and limits

The historical read-only logical export retained musical metadata, real
embeddings, taxonomy/artist graphs and mapping multiplicity. It contained no
audio or user history, likes, statistics or private settings. Anonymous paths
preserved byte lengths and playability structure. Exact catalog inventories,
source hardware, physical-layout measurements and production planner settings
are omitted.

The local replica used PostgreSQL 15.18 and pgvector 0.8.5. It was a fresh
anonymized logical restore with independently calibrated heap extents, not a
physical backup. Live tuple placement, index packing, sampled statistics,
contention and transport differ, so its local in-process percentiles cannot be
extrapolated to production or HTTP latency.

The clock surrounds `build_music_path_plan` with normal helper scopes. A single
warmup precedes each case/count, followed by 25 serial samples using
`crate-pr3-acoustic-seed-00` through `crate-pr3-acoustic-seed-24`; none is
excluded. No exports, DDL, tests or diagnostic probes run concurrently with
the distributions. Percentiles use the same nearest-rank method as scenes.
HTTP, authentication, response serialization, source loading, setup and optional
AI/provider work are outside this measurement. Warmups do not constitute a
controlled cold-cache or startup benchmark.

The final runner's post-run audit initially tries to inspect an acoustic-unused
scene module and raises `KeyError` after the planning calls. All 100 durations
and results were already saved incrementally; there are no planning errors.
The audit distinguishes the 22 source files checked at startup from modules
actually imported, verifies the participating sources, and retains this
incident without changing or repeating timing samples.

Historical percentile summaries, environments, source fingerprints, query plans, recall,
failure history and warnings are in the
[acoustic evidence](music-paths-acoustic-index-evaluation.json). No index,
migration, application deployment or user data has been changed in production.

## Scoped verification

The new candidate-query suite has nine passing cases. It compares batched and
single-genre calls of the new helper for row/order consistency, alongside input
deduplication and ordering, per-genre/per-performer caps,
alias weights, compilation performers, duplicated ID/UUID statistics, likes,
case variants, playability and caller-owned sessions. The 116 affected consumer
checks pass; scoped Ruff and Pyright checks pass. Independent specification and
quality reviews approve the batch implementation. Exact legacy row/order parity
is established by the separate read-only A/B evaluation described above.

The native track-reference cut adds 11 regressions and passes 21 affected
consumer checks. The album-anchor cut adds 10 regressions and passes 16 affected
consumer checks. Both pass scoped Ruff/Pyright and separate specification and
quality reviews. Album tests preserve their assertions across the corrected
representative fixture: the same 2,000 neighbors distributed among 100 albums,
with no planner hints, fail all six index checks against the old helper and pass
with the new scope.

The prior [catalog validation checkpoint](music-paths-validation-review.md)
retains the historical musical lists and unindexed probes. This checkpoint
recorded the historical scene and indexed-acoustic planning results. Those results do not close the new review benchmark.
Musical listening approval, production measurements after index installation,
HTTP measurements and the once-only final Linux CI remain separate checks.
Only scoped tests ran during the captured cut. This report does not establish current publication, CI, merge or deployment status.
