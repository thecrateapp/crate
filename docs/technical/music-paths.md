# Music Paths recommendation checkpoints

Music Paths are finite journeys between track, album, artist or genre endpoints.
Creating or regenerating a path computes a new selection; reading or replaying a
saved path uses its persisted tracks.

## Checkpoint 3.1: endpoint musical context

The acoustic builder resolves both endpoints in one batched catalog query.
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

## Remaining checkpoints

- 3.2: actual previous-track transition context, reserved endpoints, song-family
  deduplication, bounded candidate expansion and ordered waypoint guidance.
- 3.3: seven-day novelty on create/regenerate; stable saved-path reads/replay.
- 3.4: shared deterministic validation and safe optional AI refinements, with
  additive warnings for partial paths.
- 3.5: explicit finite `path` playback source and warning presentation in Listen.

PR3 is stacked on PR2 (#301). Evaluate representative journeys and review partial
path warnings before publication; merge and deployment are separate steps.
