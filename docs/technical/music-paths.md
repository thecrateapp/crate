# Music Paths recommendation checkpoints

Music Paths are finite journeys between track, album, artist or genre endpoints.
Creating or regenerating a path computes a new selection; reading or replaying a
saved path uses its persisted tracks.

## Checkpoint 3.1: endpoint musical context

The acoustic planner resolves both endpoints and resolved waypoints in one batched catalog query.
Artist affinity receives real artist names, including individual performers on
compilations, rather than presentation labels such as `Title — Artist`.

Each endpoint retains weighted genre evidence and its provenance:

| Source                  | Weight                        | Provenance                 |
| ----------------------- | ----------------------------- | -------------------------- |
| Explicit genre endpoint | 1.0                           | Explicit selection         |
| Track genre tag         | 1.0 per canonical genre       | File tag                   |
| Album genres            | Stored `album_genres.weight`  | Stored provider            |
| Artist genres           | Stored `artist_genres.weight` | Stored provider and artist |

The most specific available layer supplies the effective genre context: track,
then album, then artist. Other evidence remains available for diagnostics. Zero,
negative and non-finite weights do not suppress a valid fallback. Commas and
semicolons split compound tags, using the same taxonomy aliases as genre radios.
Unknown metadata stays empty.

The path scorer compares candidate genres with those endpoint contexts without
overwriting the shared artist genre map. Radio scoring remains unchanged.
Local IDs, entity UUIDs and artist name/slug aliases resolve consistently. The
query can reuse the caller's session and does not perform a lookup per endpoint.

Validation includes real PostgreSQL fixtures, contradictory track/artist tags,
compilations, missing data, aliases, invalid weights and one-query batch behavior.
The acoustic builder regression verifies that specific track genres influence
selection while the global artist metadata remains intact.

A read-only measurement against the production catalog resolved 20 endpoints in
one SELECT: 12.513 ms p95 over 25 samples, with a warm taxonomy cache. EXPLAIN
reported no sequential scan of `library_tracks` or `library_albums`; only the
small genre tables were scanned. This measures context resolution, not complete
path generation or HTTP latency.

## Checkpoint 3.2: acoustic journeys

The builder reserves the endpoints before choosing intermediate tracks. Explicit
track choices take priority; flexible artist/album/genre anchors can use another
eligible song if their first choice duplicates the opposite endpoint. Family
filtering fetches a bounded batch of up to 240 anchors, rather than querying each
variant separately. Artist and genre membership accepts the album artist or
performer; returned identity always describes the actual performer.

Each transition scores BPM, key, energy and era against the last actual track.
The candidate search starts at 15 rows and can expand twice, capped at 240 rows
per query, while retaining the current vector target and hard family exclusions.
Artist repetition remains a preference that can relax when alternatives run out.

Waypoints guide ordered segments, without requiring a visit to a particular
recording. Uniform progress along those segments respects the requested number
of steps even when there are more guides than intermediate slots. A sparse
catalog keeps the available endpoints without inventing intermediate songs.
Conflicting explicit endpoints can still produce a partial journey; checkpoint
3.4 adds its warning contract.

Acoustic candidate queries opt into performer identity. The generic query default
and both seeded-radio query implementations retain their previous behavior.

## Checkpoint 3.3: seven-day novelty

Creating or regenerating a journey reads significant listening history once for
the preceding seven days. Generation itself never writes listening history.
Regeneration also treats the previous path's song families and track IDs as a
soft preference to avoid, including older paths whose artist metadata differs
from the current performer metadata.

Fresh alternatives must be within 0.05 of the best musical quality score. User
affinity does not hide otherwise comparable alternatives after a song has been
heard, but strong affinity remains effective without listening fatigue. Explicit
track endpoints remain fixed. When the catalog has no comparable fresh choice,
the planner can reuse a recently heard song instead of breaking the journey.

Both scene and acoustic planning receive the same history and selection seed.
An internal fixed seed supports reproducible evaluation; each normal generation
gets a new seed. Reading or replaying a saved path does not read history, rotate
tracks or reorder the saved sequence.

Scene candidate reads aggregate performer genres once rather than once per
track. Relation counts group normalized artist names before joining, preventing
case variants from duplicating candidates. Musical scoring caches belong to one
generation and reuse only candidate signals and fixed context. Previous-track
transitions, destination progress and repeat penalties retain their dynamic
inputs. Exact score, path-order and concurrent-generation checks cover this
optimization; radio selection keeps its existing query defaults and weights.

### Cosine index repair

Revision 027 already specifies an HNSW cosine index for track embeddings. A
read-only production investigation found that index missing, causing nearest
queries to scan the catalog. Revision 139 restores the original index
concurrently, preserves an existing healthy index, and rebuilds an invalid or
not-ready index left by an interrupted attempt. It verifies validity before
completing. Its downgrade preserves the index owned by revision 027.

Acoustic candidate queries and flexible anchors configure `hnsw.ef_search` for
their requested batch and enable transaction-local `hnsw.iterative_scan =
strict_order`. This prevents a 60/240-row expansion from stopping at the default
40-neighbor search window, including when exclusions and playability filters
discard nearby rows. Explicit track anchors and generic/radio query defaults
remain unchanged. See the [pgvector filtering and iterative scan
documentation](https://github.com/pgvector/pgvector#iterative-index-scans).
Shared sessions regain their previous HNSW settings after each helper call;
errors do not commit or roll back the caller's transaction. Iterative scans
require pgvector 0.8 or later (observed production: 0.8.5; test fixture: 0.8.6).

HNSW is approximate: restoring it can change nearest-neighbor pools compared with
a full scan. The local representative-vector checks verify expansion capacity
and sampled recall, rather than guaranteeing identical neighbors for every
possible vector. Full acoustic path latency still needs validation with the
index available in the deployment environment; the representative local
full-planning verification is recorded below.

The migration has only been exercised in disposable test databases. No production
index or application deployment has been changed during these checkpoints.

### Indexable endpoint references and scoped album anchors

Track labels, vectors and anchors compare native ID/UUID columns with typed
parameters. The former column-to-text comparisons caused six full track scans
per track-to-track journey, accounting for 84–95% of its observed planning time.
The parser preserves the former exact textual matching: canonical signed IDs
within BIGINT range and canonical lowercase UUIDs. Leading zeros, whitespace,
alternate UUID spellings and oversized values do not become new aliases.

Album anchors resolve their native album ID/UUID in a subquery and restrict
tracks by the existing `album_id` index before ordering by the existing
distance. This avoids a global HNSW traversal for a tiny explicit album scope.
On the representative replica, the former plan visited about 21,000 tracks and
returned only 10/11 of the 12/21 eligible album tracks; native scoping recovers
the complete pools. The same scope applies to embedding and array fallback,
with the same caps, eligibility, exclusions, history and anchor selection.
Recovered candidates can change a flexible anchor relative to the truncated
ANN pool. No new index or planner override is required by these query changes.

### Historical performance checkpoint (before scene batching)

The production catalog measurement used a neutral synthetic listener, disabled
AI, read-only connections and a repeatable snapshot. Timings include in-process
planning and normal taxonomy revision checks, with a warm taxonomy cache; they
exclude HTTP transport and Redis overhead. No user events or saved paths were
written. The catalog supplied 137,698 playable embeddings.

| Journey            | Requested / returned | Samples |     p50 |     p95 | Maximum |
| ------------------ | -------------------: | ------: | ------: | ------: | ------: |
| Citizen → Converge |              20 / 20 |      25 | 1.535 s | 1.667 s | 1.703 s |
| Citizen → Converge |            100 / 100 |      25 | 4.412 s | 4.800 s | 6.275 s |
| Punk → Electronic  |              20 / 20 |       1 |       — |       — | 2.078 s |
| Punk → Electronic  |             100 / 97 |      25 | 4.022 s | 4.367 s | 4.382 s |

Both endpoints remained present and there were no duplicate song families.
The 20-step genre case exceeds the two-second target in its first sample, so
it has no accepted p95. A single diagnostic profile attributes most of its time
to candidate SQL and musical graph loading. The shorter 97-track result needs
checkpoint 3.4's partial-path warning rather than being presented as complete.

A local test at this historical checkpoint used the anonymous real-vector corpus
to verify query-plan improvement and filtered expansion capacity. That index
microbenchmark did not establish full acoustic-path latency. Subsequent complete
planning measurements are recorded below; end-to-end HTTP remains a release
check. The historical measurements and environments are in
[`music-paths-evaluation.json`](../../app/tests/fixtures/recommendations/music-paths-evaluation.json).

The historical [checkpoint 3.3 comparison](../../app/tests/fixtures/recommendations/music-paths-review.md)
retains the controlled A/B/C/D evidence, including the rejected punk-to-Japanoise
shortcut. Its revised replacement is documented below.

### Scene latency checkpoint

Candidate pools for all requested genres now use one SQL statement per
`list_scene_path_candidates` invocation. Per-genre limits, performer ranking,
membership and join cardinality retain their previous behavior. A production
read-only comparison verifies 5,326 complete rows in the same order and identical
whole plans for Citizen → Converge and both punk/electronic directions at 20
and 100 requested songs. Musical weights, history and radio behavior do not
change.

Serial measurements with the actual helper scopes meet both planning budgets:

| Journey            | Requested / returned | Samples |     p95 |
| ------------------ | -------------------: | ------: | ------: |
| Citizen → Converge |              20 / 20 |      25 | 1.447 s |
| Punk → Electronic  |              20 / 20 |      25 | 1.554 s |
| Electronic → Punk  |              20 / 20 |      25 | 1.607 s |
| Citizen → Converge |            100 / 100 |      25 | 4.179 s |
| Punk → Electronic  |             100 / 97 |      25 | 3.604 s |

These are in-process, warm-taxonomy measurements with synchronous Redis reads
included, a neutral synthetic listener and real empty history queries. They
exclude initial warmup, HTTP, authentication and response serialization/transport.
The forward 97-track result remains unchanged and reports `insufficient_tracks`.
See the [latency checkpoint](../../app/tests/fixtures/recommendations/music-paths-latency-review.md)
for full distributions, source hashes, parity checks, reproduction and limits.

### Indexed acoustic latency checkpoint

The complete planner also passes on a disposable full-catalog replica with
revision 139 and the indexable endpoint/album queries. All cases use 25 serial
samples with different fixed seeds, real helper scopes and empty synthetic
history, without AI.

| Journey                                                     | Requested / returned |     p95 |
| ----------------------------------------------------------- | -------------------: | ------: |
| Concubine → To Our Friends in the Great White North         |              20 / 20 | 0.163 s |
| Concubine → To Our Friends in the Great White North         |            100 / 100 | 0.472 s |
| Jane Doe → We Are the Romans, via The Dillinger Escape Plan |              20 / 20 | 0.152 s |
| Jane Doe → We Are the Romans, via The Dillinger Escape Plan |            100 / 100 | 0.368 s |

All samples retain endpoints and requested counts, with no duplicate track IDs
or recognized canonical song families. Three track-100 samples include one
punctuation-only title without a canonical family key, limiting that check.
No 20-song case has warnings. Some 100-song cases retain quality
warnings despite generating all 100 songs; the persisted report distinguishes
the actual count and includes the warning codes.

The replica contains the real catalog/embeddings, graphs, mapping cardinality
and original indexes, with anonymized paths and empty user tables. PostgreSQL
15.18, pgvector 0.8.5, locale and planner settings match the source inventory;
heap page extents are calibrated independently of timings. It is a fresh
logical restore on Apple M5/arm64 rather than the production Intel/x86_64 host,
so these are local in-process percentiles, not production or HTTP percentiles.

The [latency checkpoint](../../app/tests/fixtures/recommendations/music-paths-latency-review.md)
records distributions, warmups, failed intermediate attempts, recall, query
plans, source audit and musical review limits. The acoustic gate is verified
against a representative indexed catalog; production index installation and
HTTP timing remain deployment/release checks.

## Revised bridge checkpoint

The former punk → Japanoise → industrial shortcut treated historical influence
as an equally cheap link between broad scenes. Routing now charges for a
cultural link that skips more than one hierarchy level, using minimum distance
to a hierarchy root. Parent/child links retain their existing cost. Depths use
one breadth-first pass; cycles and dangling metadata cannot invent a route.
Direct bridges must exist in the catalog, and optional long-path expansions
apply the same continuity criterion before selecting their extras.

The observed route is now punk → punk-rock → new-wave → electronic, with the
reverse route also valid. A 100-track reverse journey no longer reintroduces
Japanoise in its optional expansion. Explicit noise endpoints and cultural
links without alternatives remain supported. No taxonomy or radio weights
change. Route guides interpolate to exactly the requested slot budget, retaining
endpoints when there is room for both; unavailable candidates can still shorten
the result.

The [revised listening checkpoint](../../app/tests/fixtures/recommendations/music-paths-bridge-review.md)
contains both 20-track lists and the unchanged Citizen reference. These are
single probes: 2.979/2.605 s for the genre routes and 4.710 s for the 100-track
reverse journey. They establish neither a p95 nor musical approval. The
Propagandhi → New Order boundary remains highlighted for listening review.

## Checkpoint 3.4: validation and persisted generation reports

Generation validates endpoint identities, ordered waypoint resolution, available
tracks, song families, progress and the requested count. Flexible acoustic
anchors use the actual reserved IDs; canonical genre references are retained
from routing, so aliases do not require another taxonomy lookup. Waypoints remain
ordered guides rather than mandatory visits to a recording.

The additive response fields are `is_partial`, `generated_step_count` and
`warnings` (structured codes with relevant positions/counts). Revision 140 stores
these generation results in `music_paths.generation_metadata` without changing
HTTP statuses, the requested `step_count`, or saved track IDs/order. Legacy paths
receive a cheap structural/count report.

Requested waypoint references are preserved internally as type/value pairs,
including unresolved guides. Regeneration retries them and updates tracks,
reports and resolved guides in the same owner-scoped write. The internal
regeneration descriptor is absent from public responses. Ordinary GET/replay
does not replan or read listening history.

Saved reads calculate current `playable` in the existing track JSON query using
the library playability rules. Missing or withdrawn tracks remain in the saved
sequence with `playable: false`. This current availability does not rewrite the
persisted generation report.

Optional AI proposals, including cached proposals, reuse deterministic
eligibility checks: blocked versions, genre membership, duplicate families,
anchors, neighbors and the scene artist cap. The latter is not imposed on the
acoustic builder's softer repetition policy. A substitution cannot worsen audio
or cultural connections to either neighbor or the destination and requires a
strict musical improvement. The same novelty tiers as checkpoint 3.3 prevent
small gains from undoing listening-history rotation. Existing musical graphs
remain ephemeral validation context; they add no queries or persisted payload.
Errors, obsolete context and proposals without an improvement retain the
deterministic result.

## Checkpoint 3.5: finite playback and visible warnings

Listen identifies these queues with `type: "path"`, their path ID, name and
canonical route link. List playback, detail headers, covers and track rows use
one queue conversion. It preserves the saved order while skipping currently
unavailable tracks, maps a clicked step to the playable index, and starts at the
first available track from the header. A single-track partial path keeps the
same source. A row resumes existing playback only when both the track and path
identity match; an album or another path cannot retain its old continuation.

The local playback source survives queue persistence and produces path play-event
attribution with no playlist context. Path sources have no continuation
descriptor even when Infinite Playback or shuffle is enabled. Existing explicit
repeat controls retain their behavior. Connect peers receive a generic queue
name without a path ID or radio metadata; the Cast track/queue protocol and
native transition enums are unchanged. The queue's path link opens its own
detail page.

Listen uses existing warning badges and status text to distinguish an incomplete
generation from later track unavailability. Rows and cover steps indicate
unavailability and cannot start that step; cover-strip keyboard focus remains
usable. Empty playable queues disable playback. The messages are translated in
all seven catalogs.

## Final checkpoint and remaining gates

The [catalog validation checkpoint](../../app/tests/fixtures/recommendations/music-paths-validation-review.md)
records five read-only probes with the final validator. Genre-20 journeys are
complete in both directions. A 100-track forward request returns 97 tracks with
`is_partial: true` and `insufficient_tracks`. Track and album journeys with a
waypoint preserve their anchors and report complete results. All have unique
song families; the requested waypoint resolves without requiring a played
recording by that artist.

Those historical validation probes are individual planning samples, not p95
acceptance. The subsequent scene latency checkpoint above closes the former
genre-20 gate without changing its musical lists. Acoustic probes take 8–9 s
while the expected cosine index remains absent in production. No index,
migration, cache entry, play event or saved path was written by that evaluation.
The representative indexed-acoustic checkpoint above closes that local planning
gate. Production timings after index installation and end-to-end HTTP remain
deployment/release checks.

PR3 is stacked on PR2 (#301). Review the revised musical lists and partial-path
presentation before publication. Full Linux CI runs once at the stable phase
end; merge and deployment remain separate steps.
