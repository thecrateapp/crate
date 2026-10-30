# Music Paths

Music Paths are finite journeys between track, album, artist or genre endpoints.
Creation and regeneration compute a selection; reading or replaying a saved path
uses its persisted tracks and order.

## Endpoint context and coherence

The acoustic planner resolves endpoints and waypoints in one batched catalog
query. It uses the actual performer on compilations and retains weighted genre
evidence from track tags, albums and artists. Explicit genre endpoints have
weight 1.0. The most specific valid layer supplies effective context: track,
then album, then artist. Missing, negative or non-finite evidence cannot suppress
a valid fallback. Taxonomy aliases and compound genre tags use the radio rules.

The builder reserves endpoints before intermediate selections. Explicit track
choices stay fixed; flexible anchors may use another eligible recording to
avoid duplicate endpoints. Waypoints guide ordered segments rather than
requiring a recording by the named artist. Sparse catalogs return available
tracks without inventing intermediate songs.

Transitions compare audio signals with the previous actual track and retain
endpoint genre context. Scene routing charges for cultural links that skip
multiple hierarchy levels. The reviewed punk/electronic bridge uses punk,
punk-rock and new-wave rather than treating a direct Japanoise shortcut as an
equally cheap transition. Explicit noise endpoints remain supported.

## Freshness and artist identity

Generation reads significant listening history once for the preceding seven
days. A completed play is significant; otherwise the threshold is the lesser
of 30 seconds or half the known duration, with 30 seconds for unknown duration.
Generating recommendations never writes listening history. Regeneration also
supplies the previous path's song families and track IDs as soft exclusions.

Fresh alternatives must retain comparable musical quality. The shared freshness
policy uses a 0.05 score band and falls back to recently heard songs when no
comparable fresh choice exists. Explicit track endpoints remain fixed. Reading
or replaying a saved path does not rotate it or read history.

Seeded scene selection builds its bounded variety pool, then removes songs from
the recent-history or previous-path sets before applying seeded jitter. It uses
`fresh or pool`, so jitter cannot reintroduce a fatigued song while a fresh one
remains in that pool. Fixed seeds support repeatable comparisons; normal
creation and regeneration obtain new selection seeds.

Endpoint exclusions, per-artist limits and validation share a primary-artist
key. It trims and lowercases performer names and strips trailing `feat.`, `ft.`
or `featuring` credits, including bracketed variants. `X feat. Y` therefore
counts towards X. An unrelated compilation performer retains its own identity;
`album_artist` is a fallback when the performer name is absent.

Candidate queries keep the credited performer in `artist` and the album owner
in `album_artist`. They join performers and album owners by their exact names.
If the performer row is missing, identity and metadata come from the album
owner. If it exists, its metadata wins even when a field is NULL; fields are not
individually filled from a different artist. This avoids duplicate rows from
case aliases while retaining valid foreign-key ownership joins.

## Query and index behavior

Scene pools for all requested genres use one SQL statement per helper call.
Per-genre limits, per-performer ranking, membership, user statistics and likes
retain their own scopes. Artist genres are aggregated only for the distinct
effective artists in the limited candidate pool, including the 24 artist
anchors. Relation counts fold name case before joining. Acoustic planning reuses
one read transaction and passes its session through graph, context and candidate
helpers.

Track references compare typed ID/UUID columns with canonical parameters.
Leading zeros, whitespace and alternate UUID spellings do not become aliases.
Album anchors restrict by album ID before distance ordering, preserving the
complete eligible pool. Acoustic batch expansion stays bounded and retains
family exclusions and the consecutive-artist guard in its fallback.

Revision 139 restores the HNSW cosine index declared by revision 027. It uses
`CREATE INDEX CONCURRENTLY`, preserves a healthy existing index and rebuilds an
invalid or unfinished one. The migration sets `maintenance_work_mem = '256MB'`
and `max_parallel_maintenance_workers = 0` in its autocommit block before the
build. Serial construction avoids parallel shared-memory pressure. Its
downgrade preserves the index originally owned by revision 027.

The API runs migrations on startup. If the index is missing, its first startup
after deployment performs this build and verifies that it is valid and ready.
A fresh build of the reviewed migration on a local representative catalog of
approximately 138K tracks took 20.325 seconds with two CPUs and 2 GiB RAM. The
resulting 47.84 MiB index was valid and ready. This supplies an approximately
20-second local orientation, not a production startup promise; deployment
resources and contention can change the duration.

Acoustic queries set transaction-local HNSW search/iterative-scan options for
the requested batch and restore the caller's settings. HNSW is approximate and
can change flexible candidate pools relative to a full scan. Generic and radio
query defaults remain separate.

## Completeness, warnings and availability

Responses include `is_partial`, `generated_step_count` and structured `warnings`.
`is_partial` reflects structural completeness: requested count, required
endpoints, ordered waypoint resolution and availability at generation. A path
with all requested tracks is not partial merely because it has a quality
warning.

Duplicate songs, repeated artists, artist-cap violations and invalid progress
remain quality warnings. The planner and validator share a limit of two
consecutive tracks by the same primary artist; `repeated_artist` starts at the
third. Listen displays quality concerns as soft text independently of the
partial-path badge. Static warning content is not a live status announcement.

Revision 140 persists generation metadata without changing requested step counts
or saved order. Legacy list and detail reads use consistent structural/count
rules when that metadata is absent. Current track availability is returned as
`playable`; a later withdrawal does not rewrite the saved generation report.
Unavailable tracks remain visible in the saved sequence and cannot start
playback. Their cover-step labels announce why they are unavailable.

Regeneration updates tracks, resolved guides and generation metadata in the
same owner-scoped write, then returns the ordinary saved-path representation,
including current `playable` fields. Unresolved waypoint references remain
internal regeneration context. GET and replay do not replan.

Optional AI refinement must pass deterministic eligibility, anchor, family,
neighbor, artist-limit and novelty checks. A proposal needs a strict musical
improvement without worsening transitions; errors or obsolete context retain
the deterministic result.

## Finite playback and remote targets

Listen uses `type: "path"` with the path ID, name and route link. Headers, covers
and rows share one queue conversion: preserve saved order, skip unavailable
tracks and map clicked steps to playable indices. Existing playback resumes
only when both path and track identity match. Cover progress uses that same
path-identity condition. Empty playable queues disable playback.

Local queue persistence and play events retain path attribution without a
playlist context. A path has no continuation descriptor even when Infinite
Playback or shuffle is enabled. Explicit repeat controls keep their behavior.

`compactPlaySource` intentionally degrades a path to a generic `queue` with its
name for both peer playback and Crate Connect. The compact protocol carries no
path ID, route link or radio metadata, so remote consumers cannot infer local
path attribution. This is the existing compatibility behavior, not a new
path-capability negotiation. Cast queue/track payloads and native transition
enums remain unchanged.

## Evidence and remaining checks

[Historical evidence](evidence/music-paths/README.md) contains the earlier
musical lists, diagnostics, source hashes and captured percentile summaries.
These captures predate the reviewed freshness, completeness, identity and query
work fixes. Their historical `is_partial` values, warning semantics, source
fingerprints and approval notes describe those snapshots, not the current code.
Single probes remain single probes; local planning percentiles do not establish
production or HTTP percentiles.

The [reviewed-stack measurements](evidence/recommendations-review/README.md) use
the approximately 138K-track local replica and synthetic listening history.
They report 25 samples per case, p50/p95/max, query work and HTTP boundaries.
All measured latency budgets pass; native continuation uses four data reads plus
one transaction-local setting, which is five total SQL round trips. The sparse
100-step Punk → Electronic case remains partial at 97 tracks.

Production migration duration and index installation, physical listening/remote
playback QA and final Linux CI remain separate checks. Local measurements do not
establish production percentiles or replace those checks.

## Principal artist identity

Path adjacency limits and SQL candidate quotas use the same principal-artist rule:
trim whitespace, remove an explicit trailing `feat`, `ft` or `featuring` credit
(including parenthesized/bracketed credits), then lowercase the remaining name.
The feature-credit pattern is shared between Python and PostgreSQL. Lowercase
preserves distinct names such as `Straße` and `Strasse`.

The principal artist is the credited name when it is a library artist, so band and
duo names with `&`, `x`, `with` or commas (`Florence + the Machine`, `Crosby,
Stills, Nash & Young`) stay whole. A credit that is not a library artist, such as
`Flying Lotus, Thom Yorke`, an alias like `Captain Murphy`, or `Erik Urano, Flat
Erik, …`, belongs to the album owner. Without that rule, guest credits counted as
new artists and one artist could fill a dozen consecutive steps. Saved entries
without the catalog field use the album artist only when it is one of the credited
names. Track display credits remain intact.

Scene paths take at most two tracks from one album and never two in a row. When a
scene runs out of eligible artists, the slot first relaxes the repeat and album
limits, then borrows from the previous scene in the route, so the path keeps its
requested length without repeating the destination artist.

Scene transitions use the Smart Mix transition fit between consecutive tracks when
both have a current profile (see [playback continuation](playback-continuation.md)),
and the coarse energy, tempo and key signals otherwise.

Candidate statistics select one record per track ID or entity UID. An exact
track-ID match takes precedence over a UID fallback; duplicate projections do
not multiply candidates or add their listening counts together. Ties within
one identity prefer the latest listen, then the stable entity key.
