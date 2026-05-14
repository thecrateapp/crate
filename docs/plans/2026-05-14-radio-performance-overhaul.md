# Radio Performance Overhaul

**Date:** 2026-05-14
**Status:** Hotfix and Phase 1-4 complete; structural Phase 5 planned
**Scope:** Shaped radio (V2) and legacy radio (V1) — latency reduction, cold-start elimination, query consolidation

## Problem

Before the hotfix, radio `POST /api/radio/start` could remain pending for **20+ seconds** in production. The observed production hang was inside shaped-radio batch generation: candidate scoring repeatedly entered runtime taxonomy revision checks and related-genre expansion.

The hotfix keeps the endpoint behavior intact but removes the worst hot-path work. A production diagnostic script equivalent to the patched artist-seed path generated 20 tracks in **2.018s** after the changes. The current worktree now also implements the query consolidation, session reuse, pool, pgvector, feedback sampling, and graph warm-up phases. The production API endpoint still needs a rebuilt/redeployed `crate-api` image before these changes apply to live traffic.

## Hotfix Completed — 2026-05-14

Implemented in the current worktree:

- Added a radio-specific candidate selector that caches artist affinity and genre overlap per artist within a batch.
- Reduced radio candidate prefetch from an effective 240-360 range to an effective 60 for the default 20-track batch, with a hard cap of 120.
- Reduced generation attempts from 4x batch size to 2x batch size.
- Added a radio genre-overlap scorer that uses static taxonomy ancestor expansion only, avoiding Redis-backed runtime taxonomy checks and related-genre graph expansion in the radio hot path.
- Added a 30s throttle for shared taxonomy revision checks for non-radio runtime-taxonomy callers.
- Added regression tests proving the radio scorer does not call runtime taxonomy or related expansion, and proving runtime taxonomy revision checks are throttled.

Still not covered by the current worktree:

- Structural Phase 5 ideas: Redis-backed artist graphs, DB-side full hybrid scoring, and background radio pre-generation.
- Live prod verification after rebuilding/redeploying `crate-api`.

## Root Causes

### 1. N+1 Queries in Home-Playlist Seed Resolution (10-15s)

`get_home_playlist_seed_context` (`radio_seed_queries.py:142`) fetches a playlist then calls `get_track_seed_context` once per track — up to 40 individual DB roundtrips. Each roundtrip opens a new `read_scope()`, acquires a connection, plans the query (5-way OR + CASE ORDER), and returns.

```
get_home_playlist_seed_context(user_id, playlist_id):
    playlist = get_home_playlist(...)           # roundtrip 1
    for track in playlist["tracks"]:            # up to 40 iterations
        resolved = get_track_seed_context(...)   # roundtrip 2-41
```

### 2. Discovery Seed Resolution Is Sequential (1-3s)

`resolve_discovery_seed` (`radio_engine.py:166`) tries 4 data sources one after another: liked tracks → followed artists → saved albums → recent plays → random library. Each is a separate DB roundtrip. If the user has connected data (e.g., follows but no likes), 2-3 queries fire before a seed is found.

### 3. Graph Loading on Cold Start (2-5s)

`_load_radio_graphs` (`paths_artist_graph_queries.py:84`) loads 3 complete tables into Python dicts:

- `artist_similarities` — all pairwise scores
- `artist_genres JOIN genres` — all genre assignments with weights
- `library_artists` with `jsonb_array_elements(members_json)` — unpacks JSON arrays for every artist

Cached for 1 hour (`_GRAPH_CACHE_TTL_SECONDS = 3600`). On cache expiry or process restart, the radio hot path pays this cost synchronously.

### 4. One `read_scope()` Per Query (0.5-1.5s cumulative)

Every query function opens its own SQLAlchemy `Session` via `read_scope()`. A typical `start_radio()` call opens 5-10 sessions sequentially. Each `Session` creation has overhead (connection checkout, `SET` commands, etc.). The API pool is only 4 connections (`pool_size=4`), so under concurrent radio starts, queries queue waiting for connections.

```python
# Each of these calls opens a new read_scope() internally:
count_user_radio_signals(user_id)       # session 1
get_recent_liked_seed_rows(user_id)     # session 2
load_feedback_history(user_id)          # session 3
get_track_seed_context(value)           # session 4
find_candidate_rows(...)                # session 5
```

There is no session-passing mechanism — every function hardcodes its own `read_scope()`.

### 5. pgvector ANN with Large Exclude Clause (0.1-1s)

`find_candidate_rows` (`paths_bliss_candidate_queries.py:149`) builds an exclude clause with up to 200 IDs:

```sql
AND t.id != ALL(:exclude)   -- array of up to 200 integers
```

PostgreSQL may abandon the IVFFlat index and fall back to a sequential filter-then-scan when the exclude list is large. If the ANN returns no rows (e.g., `bliss_embedding IS NULL` for many tracks), the fallback `array_distance_sql()` does a full-table Euclidean distance sort over 48K rows.

### 6. Feedback History Loads All Rows, Discards in Python (0.2-0.5s)

`load_feedback_history` (`radio_user_queries.py:126`) loads ALL radio feedback from the last 90 days, then does probabilistic sampling in Python:

```python
if age > 30 and rng.random() > 0.25: continue
if age > 7 and rng.random() > 0.5: continue
```

For an active user with hundreds of feedback rows, this loads far more data than needed.

### 7. Candidate Scoring Repeats Work per Attempt (multi-second under production data)

Before the hotfix, `_generate_batch` called `_select_best_candidate_from_rows` up to 80 times. Each attempt rescored a large prefetched candidate pool against a new drifted target. Artist affinity and genre overlap were recomputed for the same candidate artists across attempts.

After the hotfix, the default 20-track batch prefetches 60 candidates, tries at most 40 attempts, and reuses batch-local affinity/genre scores.

### 8. Runtime Taxonomy and Related-Genre Expansion in Radio Hot Path (>20s hang risk)

`_get_runtime_taxonomy_graph` (`genre_taxonomy.py`) queries Redis for a shared revision key, then may rebuild the genre graph from static definitions. During radio candidate scoring, genre overlap called runtime taxonomy and related-genre expansion repeatedly. Production tracing showed `redis.get` for the taxonomy revision key inside this loop while `/api/radio/start` stayed pending.

After the hotfix, radio uses `make_radio_genre_overlap_scorer()` with static taxonomy ancestors only. Runtime taxonomy still has a 30s shared-revision throttle for the remaining non-radio callers.

---

## Severity Ranking

| # | Bottleneck | Worst-case latency | Affected code paths | Status |
|---|-----------|-------------------|---------------------|--------|
| 1 | Runtime taxonomy + related expansion during candidate scoring | >20s / pending | `_generate_batch`, genre overlap | Hotfix complete |
| 2 | Candidate rescoring volume | Multi-second under production data | `_generate_batch` | Hotfix complete |
| 3 | N+1 home-playlist seed | 10-15s | `get_home_playlist_seed_context` | Completed |
| 4 | Cold graph loading | 2-5s | `_load_radio_graphs` | Completed |
| 5 | Sequential discovery seed | 1-3s | `resolve_discovery_seed` | Completed |
| 6 | Session-per-query | 0.5-1.5s | All query modules | Completed |
| 7 | pgvector exclude + fallback | 0.1-1s | `find_candidate_rows` | Completed |
| 8 | Feedback history waste | 0.2-0.5s | `load_feedback_history` | Completed |

---

## Action Plan

### Phase 1 — Query Consolidation (Day 1-2)

Eliminate N+1 patterns and sequential queries. Target: **-12-17s** (remaining bottlenecks #3, #4, #5).

#### 1.1 Batch home-playlist seed into a single query

**File:** `app/crate/db/queries/radio_seed_queries.py`
**Target:** Replace N+1 roundtrips with 1 query
**Status:** Completed 2026-05-14

**Current:**
```python
for track in playlist["tracks"]:
    resolved = get_track_seed_context(track_ref)  # 1 DB query per track
```

**Plan:** Collect all track references into a list, then query them all at once:

```sql
SELECT id AS track_id, bliss_vector, title, artist
FROM library_tracks
WHERE bliss_vector IS NOT NULL
  AND (
    CAST(id AS text) = ANY(:track_refs)
    OR entity_uid::text = ANY(:track_refs)
    OR storage_id::text = ANY(:track_refs)
    OR path = ANY(:track_refs)
  )
```

Deduplicate by picking the best match per track_ref with `unnest(:track_refs) WITH ORDINALITY` and `ROW_NUMBER()`, preserving playlist order before computing the centroid. Result: **41 roundtrips → 2** (1 for playlist, 1 for batch resolve).

#### 1.2 Unify discovery seed resolution into one query

**File:** `app/crate/radio_engine.py`, function `resolve_discovery_seed`
**Target:** Replace 4 sequential queries with 1 prioritised UNION
**Status:** Completed 2026-05-14

**Plan:** Combine all 4 sources into a single CTE-based query that returns the best available seed. Each source is limited inside its own CTE before the final `UNION ALL`, avoiding PostgreSQL's invalid `ORDER BY/LIMIT` placement before a union.

```sql
WITH candidates AS (
    SELECT 1 AS priority, t.id, t.artist, t.bliss_vector
    FROM user_liked_tracks lt
    JOIN library_tracks t ON t.id = lt.track_id
    WHERE lt.user_id = :uid AND t.bliss_vector IS NOT NULL
    ORDER BY lt.created_at DESC LIMIT 10

    UNION ALL

    SELECT 2 AS priority, t.id, t.artist, t.bliss_vector
    FROM user_follows af
    JOIN library_albums a ON LOWER(a.artist) = LOWER(af.artist_name)
    JOIN library_tracks t ON t.album_id = a.id
    WHERE af.user_id = :uid AND t.bliss_vector IS NOT NULL
    LIMIT 30

    UNION ALL

    SELECT 3 AS priority, t.id, t.artist, t.bliss_vector
    FROM user_saved_albums sa
    JOIN library_tracks t ON t.album_id = sa.album_id
    WHERE sa.user_id = :uid AND t.bliss_vector IS NOT NULL
    LIMIT 30

    UNION ALL

    SELECT 4 AS priority, t.id, t.artist, t.bliss_vector
    FROM user_play_events pe
    LEFT JOIN library_tracks t ON t.id = pe.track_id
        OR (pe.track_id IS NULL AND pe.track_entity_uid IS NOT NULL
            AND t.entity_uid = pe.track_entity_uid)
    WHERE pe.user_id = :uid AND t.bliss_vector IS NOT NULL
    ORDER BY pe.ended_at DESC LIMIT 20
)
SELECT * FROM candidates
ORDER BY priority
```

In Python, partition by priority, take the first group with ≥ minimum vectors per source. **Result: 4 roundtrips → 1**.

#### 1.3 Pre-warm graphs at process startup

**File:** `app/crate/radio_engine.py`, function `_load_radio_graphs`
**Target:** Move cold-start cost out of the request path
**Status:** Completed 2026-05-14

**Plan:** Call `_load_radio_graphs()` during API and worker startup (in `api/__init__.py`, `worker.py`, and legacy `orchestrator.py`). The API also runs a 5-minute background refresh that clears and reloads the graph cache.

```python
# In api/__init__.py or orchestator.py startup:
from crate.radio_engine import _load_radio_graphs

def _warm_radio_graphs():
    _load_radio_graphs()
    log.info("Radio graphs warmed")

# Call synchronously at startup, then schedule periodic refresh
_warm_radio_graphs()
```

**Result: 0s cold-start penalty for hot path.**

---

### Phase 2 — Session Reuse & Pool Efficiency (Day 3)

Eliminate redundant connection acquisition. Target: **-0.5-1s** (remaining bottleneck #6).

#### 2.1 Add optional `session` parameter to radio query functions

**Files:** `radio_library_queries.py`, `radio_user_queries.py`, `radio_seed_queries.py`
**Target:** Allow `start_radio` to open one `read_scope()` and pass it down
**Status:** Completed 2026-05-14

**Plan:** Add a `session=None` keyword to every radio query function, using the existing `optional_scope()` pattern from `tx.py`:

```python
# Before
def get_track_bliss_vector(track_id: int) -> list[float] | None:
    with read_scope() as session:
        row = session.execute(...)
    return ...

# After
def get_track_bliss_vector(track_id: int, *, session=None) -> list[float] | None:
    with optional_scope(session) as s:
        row = s.execute(...)
    return ...
```

Then in `start_radio()`:

```python
def start_radio(user_id, mode, seed_type, seed_value):
    with read_scope() as s:
        resolved_seed = _resolve_seed(user_id, seed_type, seed_value, session=s)
        hist_liked, hist_disliked = load_feedback_history(user_id, session=s)
        ...
        tracks = _generate_batch(session_dict, db_session=s)
```

This requires threading `session=` through all intermediate functions.

#### 2.2 Increase API pool size for radio

**File:** `app/crate/db/engine.py`
**Target:** Prevent connection starvation under concurrent radio starts
**Status:** Completed 2026-05-14

**Plan:** Bump the API connection pool from `pool_size=4, max_overflow=2` to `pool_size=8, max_overflow=4`, or make it configurable via env vars for the radio path specifically. The radio engine also opens its own Redis connection — ensure the Redis connection pool is similarly sized.

---

### Phase 3 — Query Optimization (Day 4)

Optimize the queries that remain. Target: **-0.5-1.5s** (remaining bottlenecks #7, #8).

#### 3.1 Tighten pgvector ANN exclude

**File:** `app/crate/radio_engine.py`, constant `_DB_EXCLUDE_ID_LIMIT`
**Target:** Reduce exclude array size to keep the IVFFlat index usable
**Status:** Completed 2026-05-14

**Plan:** Reduce from 200 to 50. Duplicate prevention is already handled by `used_titles` and `recent_artists` — the DB-level exclude only needs to catch the most recent tracks to avoid immediate repetition.

**Alternative:** Use `t.id NOT IN (SELECT UNNEST(:exclude))` with a smaller array, or push the exclude into a `NOT EXISTS` subquery on the radio feedback table for disliked tracks only.

#### 3.2 Ensure IVFFlat probes are tuned
**Status:** Completed 2026-05-14

Verify that `ivfflat.probes` is set appropriately (check PostgreSQL config). Default is 1, which may miss candidates. For 48K tracks with 20-dimensional vectors, `ivfflat.probes = 10` provides good recall without significant latency overhead.

```sql
-- Check current setting
SHOW ivfflat.probes;

-- Set at session level in read_scope or globally
SET ivfflat.probes = 10;
```

Add this to `read_scope()` or to the `find_candidate_rows` function via `session.execute(text("SET LOCAL ivfflat.probes = 10"))`.

#### 3.3 Push feedback sampling to SQL

**File:** `app/crate/db/queries/radio_user_queries.py`, function `load_feedback_history`
**Target:** Load only the data we'll use
**Status:** Completed 2026-05-14

**Plan:** Use PostgreSQL `TABLESAMPLE BERNOULLI` or `ORDER BY random()` with a limit instead of loading all rows:

```sql
SELECT action, bliss_vector
FROM radio_feedback
WHERE user_id = :uid
  AND bliss_vector IS NOT NULL
  AND created_at > now() - INTERVAL '90 days'
ORDER BY random()
LIMIT 50
```

The Python age-based sampling (`age > 30 → 25% keep`, `age > 7 → 50% keep`) is replaced by SQL sampling with separate like/dislike quotas, so negative feedback is not lost when likes dominate the history.

---

### Phase 4 — Algorithm Tuning (Day 5)

Reduce Python-side work in the hot path. The hotfix addressed the two highest-severity bottlenecks (#1 and #2); the remaining item here is an optional vector-distance micro-optimization.

#### 4.1 Cache target norm in `_vector_distance`

**File:** `app/crate/db/paths_candidates.py`, function `_vector_distance`
**Target:** Avoid recomputing `right_norm` (unchanged per call to `_select_radio_candidate_from_rows`)
**Status:** Completed 2026-05-14

**Plan:** Precompute `right_norm` once per call and pass it in. The target vector changes per attempt (due to drift), but the norm of the drifted vector is already computed inside `_vector_distance` — the real optimization is computing `target_norm` once per call to `_select_radio_candidate_from_rows` and avoiding the per-candidate recomputation.

```python
def _vector_distance_fast(vector, target, target_norm):
    """Precomputed target_norm avoids sqrt per candidate."""
    dot = sum(float(vector[i]) * float(target[i]) for i in range(len(target)))
    left_norm = sum(v * v for v in vector) ** 0.5
    if left_norm <= 0 or target_norm <= 0:
        return 1.0
    return max(0.0, min(2.0, 1.0 - (dot / (left_norm * target_norm))))
```

#### 4.2 Cache affinity and genre overlap per artist within batch

**Status:** Completed in hotfix (`radio_engine.py`)

The `_select_radio_candidate_from_rows` function already caches `artist_affinity` by `(artist_key, context_artists)` tuple and `genre_overlap` by `artist_key` within the batch generation loop. This prevents recomputing affinity for the same artist across multiple attempts.

#### 4.3 Reduce `_RADIO_PREFETCH_LIMIT`

**Status:** Completed in hotfix (`radio_engine.py`)

The prefetch path previously allowed hundreds of candidates per batch. The hotfix sets `_RADIO_PREFETCH_LIMIT = 120`, `_RADIO_PREFETCH_MULTIPLIER = 3`, and `_MAX_GENERATION_ATTEMPT_MULTIPLIER = 2`. For the default 20-track batch this means 60 prefetched candidates and at most 40 selection attempts.

#### 4.4 Remove related-genre expansion from radio scorer

**Status:** Completed in hotfix (`paths_similarity.py`)

`make_radio_genre_overlap_scorer` uses `_expand_genre_weight_items_for_radio` which skips `get_related_genre_terms()` — only expands taxonomic ancestors. This avoids the expansive related-term graph walk during the hot path.

#### 4.5 Throttle runtime taxonomy shared-revision checks

**Status:** Completed in hotfix (`genre_taxonomy.py`)

`_get_runtime_taxonomy_graph()` now reuses the in-process runtime graph for 30s before asking Redis for the shared revision key again. This is no longer on the radio hot path, but it prevents the same failure mode from affecting remaining runtime-taxonomy callers.

---

### Phase 5 — Structural Improvements (Day 6-7)

Changes that require more design but yield compounding benefits.

#### 5.1 Move artist graphs to Redis

**Target:** Eliminate 3 PostgreSQL queries every hour, reduce Python memory usage

**Plan:** Instead of loading `artist_similarities`, `artist_genres`, and `artist_members` into Python dicts, store precomputed lookup structures in Redis:

```
artist:sim:{artist_name_lower}  → JSON {similar_artist: score, ...}
artist:genres:{artist_name_lower} → JSON {genre_slug: weight, ...}
artist:members:{artist_name_lower} → SET of shared-band-artist names
```

The `crate-projector` service, which already consumes domain events and warms snapshots, can update these Redis keys whenever relevant tables change. The radio engine reads from Redis with a local in-memory TTL cache (e.g., 60s) for the hot path.

#### 5.2 Push candidate scoring to PostgreSQL

**Target:** Offload hybrid scoring from Python to database

**Plan:** Rewrite `_select_radio_candidate_from_rows` as a single PostgreSQL query that computes the weighted hybrid score:

```sql
SELECT t.*,
       (t.bliss_embedding <=> :target) AS bliss_dist,
       COALESCE(ast.score, 0) AS artist_affinity_score,
       -- genre overlap via CTE
       ...
FROM library_tracks t
JOIN library_albums a ON a.id = t.album_id
LEFT JOIN artist_similarities ast ON LOWER(ast.artist_name) = LOWER(a.artist)
  AND LOWER(ast.similar_name) = ANY(:target_artists)
WHERE t.bliss_embedding IS NOT NULL
  AND t.id != ALL(:exclude)
ORDER BY
  (0.34 * (bliss_dist / max_dist))
  + (0.22 * (1 - artist_affinity_score))
  + ...
LIMIT 1
```

This eliminates Python-side vector math entirely, leverages PostgreSQL's parallel query execution, and reduces data transfer (only the winning candidate is returned, not 180 rows).

#### 5.3 Background radio pre-generation for active users

**Target:** Perceived latency → 0 for users on the home page

**Plan:** When a user loads `/api/me/home/discovery`, the home builder can also trigger an async radio pre-generation task. The task starts a radio session in the background, caches the first batch in Redis keyed to the user, and when the user clicks "Start Radio", the pre-generated session is returned instantly.

```python
# In home builder or dedicated endpoint
if has_enough_data(user_id):
    background_radio_warmup.send(user_id)
```

The frontend can poll `/api/radio/can-discover` on home page load and pre-fetch the first batch before the user even clicks.

---

## Hotfix Changes (Current Worktree)

The branch `feat/tauri-desktop-app` contains these radio optimizations:

| Change | File | Status |
|--------|------|--------|
| `_select_radio_candidate_from_rows` with affinity/genre caching | `radio_engine.py` | Completed 2026-05-14 |
| `make_radio_genre_overlap_scorer` (static ancestor-only expansion) | `paths_similarity.py` | Completed 2026-05-14 |
| `_get_runtime_taxonomy_graph` 30s throttle | `genre_taxonomy.py` | Completed 2026-05-14 |
| Prefetch effective 60 for default batch, attempt multiplier 4→2 | `radio_engine.py` | Completed 2026-05-14 |
| Session passing (`session=` parameter) | radio/path query modules | Completed 2026-05-14 |
| N+1 home-playlist batch query | `radio_seed_queries.py` | Completed 2026-05-14 |
| Unified discovery seed query | `radio_user_queries.py`, `radio_engine.py` | Completed 2026-05-14 |
| Graph pre-warming and API refresh | `api/__init__.py`, `worker.py`, `orchestrator.py` | Completed 2026-05-14 |
| pgvector probe tuning and smaller DB exclude | `paths_bliss_candidate_queries.py`, `radio_engine.py` | Completed 2026-05-14 |
| SQL feedback sampling with like/dislike quotas | `radio_user_queries.py` | Completed 2026-05-14 |

---

## Success Criteria

### Hotfix

- Artist-seeded `POST /api/radio/start` completes in **2-3 seconds** on a warm production process.
- The radio scorer does not call Redis-backed runtime taxonomy or related-genre expansion.
- Existing shaped-radio and legacy radio contract tests pass.

### Full Overhaul

- `POST /api/radio/start` completes in under **2 seconds** for all seed types
- `POST /api/radio/next` completes in under **500ms**
- Cold start (first radio after process restart) under **3 seconds**
- No sequential N+1 DB queries in any radio code path
- All DB queries in a single `start_radio` call share one `read_scope()` session

## Verification

- [x] `test_shaped_radio_engine.py` + `test_radio_contracts.py` — 19 passed inside the API container
- [x] SQL temp-table validation for discovery CTE, feedback sampling, and home-playlist batch order
- [x] Manual production diagnostic equivalent to artist-seeded `start_radio` — 20 tracks in 2.018s
- [ ] Rebuild/redeploy `crate-api` and verify the live `/api/radio/start` endpoint
- [ ] Manual: start radio from home-playlist → under 2s
- [ ] Manual: start discovery radio with no likes → under 2s
- [ ] Manual: start radio immediately after API restart → under 3s
- [ ] `EXPLAIN ANALYZE` on `find_candidate_rows` confirms IVFFlat index usage
- [ ] Connection pool metrics show no saturation under 10 concurrent radio starts
