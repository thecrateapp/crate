# Suggested Tracks Relevance Plan

> **Estado (2026-11-18):** Pendiente; nada implementado. Verificado contra main: `get_similar_from_db` (app/crate/bliss.py) sigue ordenando por score y cortando top-N sin dedupe, diversidad ni tope por artista, y `/api/similar-tracks` no pasa `user_id` al scorer.

## Context

The `Suggested` tab in the `ExtendedPlayer` is currently seeded from the
currently playing track, but it does **not** use the actual track-radio
queue generator.

Current flow:

- `app/listen/src/components/player/extended/SuggestedTab.tsx` calls
  `GET /api/similar-tracks?...`
- `app/crate/api/browse_media.py` resolves the path and calls
  `crate.bliss.get_similar_from_db(...)`
- `app/crate/bliss.py` retrieves the top 200 nearest neighbors by bliss
  distance, re-scores them in Python, sorts by score, and returns the top N

That architecture is serviceable, but the current implementation is too
loose for a visible recommendation list:

- it allows too many tracks from the seed artist
- it does not dedupe the final list
- it uses artist-level genre tags, which are too coarse for album/track-level
  similarity
- it gives too much room to broad artist-similarity metadata
- the no-bliss fallback is too permissive for a "Suggested" UX
- it does not apply diversity before returning results
- `/api/similar-tracks` does not currently pass `user_id` into the scorer,
  even though the ranking code can use user-profile data

This is why cases like:

- `Slift` seed track -> too many `Slift` tracks
- `Slift` seed track -> `Barricada` / `Sham 69` appearing as "similar"
- same track appearing twice in the same list

are all plausible under the current logic.

---

## Goal

Make `Suggested` in the `ExtendedPlayer` a **high-precision recommendation
surface**:

- strongly related in sound and scene
- genre-aware using the existing taxonomy
- deduped
- artist-diverse
- willing to return fewer results instead of low-quality filler

`Track radio` should remain a broader, more exploratory mode. `Suggested`
and `Track radio` should no longer share the exact same relevance policy.

---

## Non-goals

- No rewrite of the entire radio system
- No ORM / schema refactor
- No broad frontend redesign
- No attempt to infer genre from LLMs or external APIs in the hot path
- No promise of perfect musicological similarity for every track in the
  library

---

## Current behavior that must change

### 1. `Suggested` is top-N by score, with no final diversity pass

`get_similar_from_db()` in `app/crate/bliss.py`:

- gets top 200 by bliss distance
- scores each candidate via `_score_candidate(...)`
- sorts descending
- slices `[:limit]`

It does **not** call `_diversify_tracks(...)` before returning.

### 2. Same-artist bias is structurally allowed

The current score includes:

- bliss similarity
- BPM proximity
- key compatibility
- energy proximity
- year proximity
- genre overlap
- artist-similarity bonus

There is no hard cap or meaningful penalty for repeatedly surfacing the seed
artist inside `Suggested`.

### 3. Genre signal is too coarse

The current implementation mostly uses artist-level genres:

- `_get_artist_genre_ids(...)`
- `_get_artist_genre_map(...)`

For recommendation precision, this is too broad. It does not capture:

- album-era shifts
- side projects
- narrow subgenre identity
- "this artist is tagged rock, but *this album* is heavy psych / space rock"

### 4. Taxonomy exists, but recommendations are not really using it

The project already has:

- `genre_taxonomy_nodes`
- `genre_taxonomy_aliases`
- `genre_taxonomy_edges`
- `get_related_genre_terms(...)`
- `resolve_genre_slug(...)`
- relation types: `parent`, `related`, `influenced_by`, `fusion_of`

But `Suggested` is not yet using that taxonomy as a weighted affinity model.

### 5. No-bliss fallback is too permissive for a visible recommendation list

If the seed lacks `bliss_vector`, the code falls back to
`_recommend_without_bliss(...)`.

That fallback is acceptable for a broad radio bootstrap, but too permissive
for a UI tab that claims "Suggested" based on the current song.

### 6. Duplicate protection is missing

There is no final dedupe by:

- `track_id`
- `track_path`
- logical duplicate key such as `(artist, normalized_title)`

The DB protects `library_tracks.path` with a unique constraint, but the
recommendation layer still needs logical dedupe because multiple versions,
multiple rips, or multiple records can still collapse into "the same song"
from a user point of view.

### 7. API contract is slightly inconsistent

The recommendation payload uses `track_path`, while `SuggestedTab.tsx`
currently expects `path` in its local interface. That should be normalized.

---

## Product principles

1. Precision beats fill rate.
2. For `Suggested`, fewer good tracks are better than 15 weak ones.
3. "Influenced by" is not the same as "sounds similar now".
4. Sharing only a broad top-level genre like `rock` should not be enough.
5. `Suggested` should feel like "same sonic neighborhood", not "same
   cultural universe".
6. `Track radio` may be broader than `Suggested`, but it must still dedupe.

---

## Target architecture

`Suggested` should become a four-stage pipeline:

1. Candidate retrieval
2. Hard filtering / gating
3. Relevance scoring
4. Deduplication + diversification

That differs from the current "retrieve, score, sort, slice" pipeline.

---

## Target algorithm

## 1. Candidate retrieval

For a seed track:

1. Load the seed row with:
   - bliss vector
   - audio features
   - artist id
   - album id
   - album/year
2. Load the seed genre profile using:
   - `album_genres` first
   - `artist_genres` second
3. Retrieve candidate pools:
   - `bliss_pool`: top 250 nearest by bliss distance when the seed has a
     vector
   - `genre_pool`: tracks from strongly related genres in the taxonomy,
     limited per artist
   - optional `similar_artist_pool`: only artists with strong in-library
     similarity, limited per artist and used as recall, not ranking driver
4. Union the pools and dedupe them before scoring

### Retrieval rules

- Exclude seed track path immediately
- Exclude exact duplicate path immediately
- Limit `genre_pool` to artists whose genre affinity to the seed is above a
  threshold
- Limit `similar_artist_pool` aggressively; it is a backfill source, not the
  main source

---

## 2. Genre profile and taxonomy affinity

This is the key change.

Instead of treating genres as flat strings, build a weighted seed genre
profile.

### New helper(s)

Add a new weighted taxonomy helper in `app/crate/genre_taxonomy.py`:

```python
def get_related_genre_scores(
    value: str,
    *,
    max_depth: int = 2,
) -> dict[str, float]:
    ...
```

Return a map of normalized genre terms -> affinity score.

Example intent:

- exact canonical slug / alias: `1.00`
- direct child / direct parent: `0.90`
- direct `related`: `0.75`
- direct `fusion_of`: `0.60`
- direct `influenced_by`: `0.30`
- second-hop relations: decayed from the above
- top-level-only matches: near zero

### Important implementation detail

The DB already stores edge `weight`, but the runtime taxonomy cache in
`genre_taxonomy.py` currently ignores that field when building the in-memory
graph. Extend the runtime graph to optionally carry edge weights so the
affinity model can use:

- curated defaults from code
- overridden weights from DB when present

### Specificity boost

Use taxonomy depth to reward specific shared scenes:

- `heavy psych`
- `space rock`
- `krautrock`
- `psychedelic rock`

should outrank a generic common ancestor like `rock`.

That means:

- exact or near-exact subgenre matches get boosted
- generic umbrella matches get heavily discounted

### Seed genre profile

Create a seed profile from:

- `album_genres` with higher weight
- `artist_genres` with lower weight

Suggested weighting:

- album genre exact tag contribution: `1.0`
- artist genre exact tag contribution: `0.6`

Then expand each through the taxonomy via `get_related_genre_scores(...)`,
taking the max score per related term.

---

## 3. Hard gating before final scoring

Do not let every candidate reach the final ranking.

For `Suggested`, a candidate should only survive if at least one of the
following is true:

- strong bliss similarity
- strong genre affinity
- medium bliss similarity plus medium audio proximity
- medium genre affinity plus medium audio proximity

### Proposed gates

- keep if `bliss_cosine >= 0.92`
- keep if `genre_affinity >= 0.72`
- keep if `bliss_cosine >= 0.86` and `audio_proximity >= 0.60`
- keep if `genre_affinity >= 0.55` and `audio_proximity >= 0.60`

Otherwise, drop the candidate.

### Broad-genre rejection rule

If the best shared affinity is only through a top-level umbrella such as
`rock`, `metal`, or `electronic`, reject the candidate unless bliss
similarity is very high.

This rule is the main defense against:

- `Slift` -> generic rock / punk leakage
- artist-similarity rows that are culturally adjacent but sonically wrong

---

## 4. Relevance score for `Suggested`

After gating, score the survivors with a stricter mix than the current one.

### Proposed scoring components

- bliss similarity: `0.40`
- genre affinity: `0.28`
- audio proximity bundle: `0.17`
- year proximity: `0.05`
- artist-similarity bonus: `0.05`
- user-profile adjustment: `0.05`

Where:

- `audio proximity bundle` is the blend of BPM, key compatibility, and energy
- `artist-similarity bonus` is only allowed when `genre_affinity >= 0.40`
- user-profile adjustments must stay bounded and never rescue a poor match

### Proposed penalties

- low-signal / intro / interlude / alt-version penalty: keep existing logic
- same artist as seed: strong penalty or cap
- same album as seed: additional penalty

### Same-artist policy for `Suggested`

For `Suggested`, do **not** allow unconstrained same-artist tracks.

Recommended policy:

- default cap: maximum `1` seed-artist track in the first 10 results
- maximum `2` seed-artist tracks in the full list of 15
- if enough non-seed matches exist, prefer zero seed-artist tracks

This gives users "related" tracks instead of "more tracks by the same band".

---

## 5. Deduplication and diversity

This must happen after scoring and before the final slice.

### Deduplication keys

Deduplicate in this order:

1. exact `track_id`
2. exact `track_path`
3. logical duplicate key:
   - normalized artist
   - normalized title

Optionally add a soft duplicate rule for:

- same artist
- same normalized title
- duration difference under a small threshold

so that two rips or two copies of the same song do not both surface.

### Diversity rules

Apply a stricter diversity pass for `Suggested` than for radio:

- max 1 per artist in the first 8
- max 2 per artist in the full 15
- max 1 per album in the first 10
- no identical normalized title within the full list

The current `_diversify_tracks(...)` helper can be reused, but it likely
needs parameterization beyond `max_consecutive_artist`.

---

## 6. Fallback behavior with missing bliss

Do not use the current broad no-bliss fallback unchanged for `Suggested`.

### New `Suggested` fallback policy

If the seed has no bliss vector:

1. try a genre-first candidate pool using:
   - album genres
   - artist genres
   - taxonomy expansion
2. require stronger genre affinity than normal
3. use audio features only as a secondary tie-breaker
4. if the result set is still poor, return fewer tracks
5. if the result set is empty, return empty

### Explicit rule

For `Suggested`, "no good matches found" is acceptable.

It is better than fabricating weak cross-scene matches.

---

## Separation from track radio

Keep `Track radio` broader and more exploratory.

Recommended split:

- `get_similar_from_db(...)` becomes the strict `Suggested` engine
- `generate_track_radio(...)` remains its own queue builder
- do not let radio backfill rules leak into `Suggested`

If shared helpers are needed, share only:

- candidate loading
- taxonomy affinity helpers
- dedupe helpers
- audio proximity helpers

Do not share the final policy unchanged.

---

## File-level implementation plan

## Phase 0 — Contract and regression tests

### Files

- `app/tests/test_suggested_tracks.py` (new)
- optionally extend `app/tests/test_radio_contracts.py`

### Deliverables

1. Add tests for exact duplicate suppression
2. Add tests for logical duplicate suppression
3. Add tests for same-artist cap
4. Add tests for no-bliss fallback returning few/zero results instead of
   noisy filler
5. Add tests for taxonomy-aware ranking, including a psych/space-rock style
   case that should not admit broad punk matches
6. Add a payload-contract test ensuring `Suggested` returns the path field(s)
   expected by the frontend

### Acceptance criteria

- A candidate with same `track_path` never appears twice
- A candidate with same `(artist, normalized_title)` never appears twice
- First 10 results do not collapse into one artist

---

## Phase 1 — Hotfix precision issues in current pipeline

### Files

- `app/crate/api/browse_media.py`
- `app/crate/bliss.py`
- `app/listen/src/components/player/extended/SuggestedTab.tsx`

### Changes

1. Pass `effective_user_id` from `/api/similar-tracks` into
   `get_similar_from_db(...)`
2. Normalize the response contract so the frontend and backend agree on
   `track_path` vs `path`
3. Add final dedupe in `get_similar_from_db(...)`
4. Apply final diversity in `get_similar_from_db(...)`
5. Add a same-artist cap for `Suggested`
6. Keep the existing scorer for now, but stop obviously bad repetitions

### Why first

This phase should remove:

- repeated tracks
- most repeated seed-artist flooding
- some of the most obvious low-quality clustering

without waiting for the taxonomy work.

---

## Phase 2 — Add weighted taxonomy affinity

### Files

- `app/crate/genre_taxonomy.py`
- `app/crate/bliss.py`

### Changes

1. Add weighted runtime edge support
2. Add `get_related_genre_scores(...)`
3. Add helper(s) in `bliss.py`:
   - `_get_album_genre_map(...)`
   - `_build_seed_genre_profile(...)`
   - `_candidate_genre_profile(...)`
   - `_genre_affinity_score(...)`
   - `_shared_top_level_only(...)`

### Important note

This phase should prefer:

- album genres over artist genres
- taxonomy-based affinity over flat tag intersection

It should not throw away the existing genre tables; it should use them
properly.

---

## Phase 3 — Rebuild candidate gating and scoring for `Suggested`

### Files

- `app/crate/bliss.py`

### Changes

1. Split candidate retrieval from final scoring
2. Add hard gating rules
3. Reweight the score for `Suggested`
4. Demote artist-similarity bonus to a secondary signal
5. Add explicit broad-genre rejection
6. Make `Suggested` return fewer results if quality thresholds are not met

### Optional API shape

If keeping one backend function becomes awkward, add a dedicated mode flag:

```python
get_similar_from_db(track_path, limit=15, user_id=user_id, mode="suggested")
```

or a dedicated strict wrapper:

```python
get_suggested_tracks(track_path, limit=15, user_id=user_id)
```

The latter is probably cleaner.

---

## Phase 4 — Tighten no-bliss fallback

### Files

- `app/crate/bliss.py`

### Changes

1. Split the current `_recommend_without_bliss(...)` into:
   - broad fallback for radio
   - strict fallback for `Suggested`
2. For `Suggested`, rely on:
   - taxonomy affinity
   - album/artist genres
   - audio proximity
3. If confidence is low, return fewer rows

### Acceptance criteria

- No-bliss seeds do not cause cross-scene garbage results
- Empty list is acceptable when data is insufficient

---

## Phase 5 — Tune with real library examples

### Deliverables

Create a manual tuning matrix using real seeds from the library:

- `Slift`
- a heavy psych / space rock seed
- a hardcore / post-hardcore seed
- an electronic seed
- a jazz or ambient seed
- a seed with no bliss vector

For each seed:

- record top 15 old results
- record top 15 new results
- note false positives
- adjust weights only after reviewing multiple seeds

### Rule

Do not tune on one artist only. The change must generalize.

---

## Proposed helper structure

In `app/crate/bliss.py`:

```python
def get_suggested_tracks(track_path: str, limit: int = 15, *, user_id: int | None = None) -> list[dict]:
    ...

def _load_seed_track(...):
    ...

def _get_album_genre_map(...):
    ...

def _build_seed_genre_profile(...):
    ...

def _genre_affinity_score(...):
    ...

def _audio_proximity_score(...):
    ...

def _dedupe_ranked_tracks(...):
    ...

def _diversify_suggested_tracks(...):
    ...
```

In `app/crate/genre_taxonomy.py`:

```python
def get_related_genre_scores(value: str, *, max_depth: int = 2) -> dict[str, float]:
    ...
```

This is preferable to continuing to overload `get_similar_from_db(...)`
with more and more policy.

---

## Frontend notes

`SuggestedTab.tsx` should remain thin.

Frontend changes should be minimal:

- align the TypeScript interface with the backend payload
- use the canonical path/storage id returned by the API
- keep the UI happy with fewer than 15 results
- optionally improve empty state text:
  - `No close matches found`
  - not `No similar tracks found`

The frontend should not implement dedupe or ranking logic.

---

## Performance contract

This change must remain cheap enough for realtime player UI usage.

### Constraints

- one request on track change
- target response should stay comfortably interactive
- avoid taxonomy graph recomputation per candidate

### Practical guidance

- cache runtime taxonomy in memory
- load album/artist genre maps in batches
- cap candidate pools before Python scoring
- dedupe before expensive secondary work when possible

### Success metric

The stricter algorithm should not noticeably delay the `Suggested` tab
opening compared with the current endpoint.

---

## Acceptance criteria for merge

1. Exact duplicate tracks never appear twice in one `Suggested` list
2. Logical duplicates of the same song do not appear twice
3. Seed artist does not dominate the list
4. Broad-genre leakage is significantly reduced
5. `Suggested` can return fewer than 15 items when confidence is low
6. `Track radio` still works and remains broader than `Suggested`
7. The frontend/backend payload contract is explicit and consistent
8. Tests cover:
   - duplicates
   - artist caps
   - taxonomy relevance
   - no-bliss fallback

---

## Decision record

### Decision 1

`Suggested` is a precision surface, not a fill-rate surface.

### Decision 2

Genre taxonomy must be a first-class relevance signal, not a tiny score
bonus.

### Decision 3

Album genres matter more than artist genres for track-level similarity.

### Decision 4

Artist-similarity metadata is recall/backfill, not a dominant ranking signal.

### Decision 5

Returning fewer high-confidence tracks is correct behavior.
