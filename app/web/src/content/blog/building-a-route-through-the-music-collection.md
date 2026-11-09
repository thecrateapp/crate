---
title: "Building a route through the music collection"
description: "A musical route needs more than nearby tracks. We built Music Paths around destinations, then fixed the anchors, artist credits and incomplete journeys."
date: 2026-11-10
visuals: [music-paths]
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 11
related: [teaching-crate-to-listen, reads-from-snapshots]
tags: [How to dismantle Spotify, recommendations, PostgreSQL, music paths, history]
sources:
  - docs/technical/music-paths.md
  - app/crate/music_paths.py
  - app/crate/db/paths_path_builder.py
  - app/crate/db/paths_scene.py
  - app/crate/recommendation_policy.py
  - app/crate/music_path_validation.py
  - app/listen/src/pages/path-playback.ts
  - docs/technical/evidence/recommendations-review/README.md
---

_Part 11. Building Music Paths in April, then repairing its routes through October 2026._

A Music Path from The Clash to Erik Urano played twelve Flying Lotus tracks in a row. The route
also included four Berri Txarrak tracks and seven songs from one Erik Urano album. We had artist
limits, but the planner treated different guest credits as different artists. The same performer
could occupy much of the journey while appearing to satisfy the rules.
[The credit-identity failure and fix](https://github.com/thecrateapp/crate/commit/54572a51cc931c24e29beb957d025b41c1baae2b).

That failure came months after the first version. In April, Music Paths started with a question
our radio did not answer: how do you get from one part of a collection to another in a fixed number
of tracks? A radio station can keep finding good next songs around its seed. A path also has a
destination, and each choice spends one of the remaining steps available to reach it.

We began by drawing a line through the library's audio features. Over time, making the result worth
playing required more of the catalogue: which artist actually performed a track, how genres were
related, which recordings had already been used and which endpoint choices had to stay fixed.
The player also needed to respect the result. Reaching the destination should finish the journey.

## Draw a line, then find the recordings near it

The [audio-analysis work](/blog/teaching-crate-to-listen) had given Crate a Bliss vector for analysed
tracks. We used those vectors to represent endpoints. A track supplied its own vector. An album
supplied the mean of its analysed tracks. The first artist resolver averaged up to twenty analysed
tracks, ordered by play count; the genre resolver averaged up to thirty selected through artist
genre membership.
[Initial endpoint resolution](https://github.com/thecrateapp/crate/blob/06af0101d0c5daf0e4fd7d86a0a1a1268c8aed7f/app/crate/db/paths.py#L38-L94).

This made all four endpoint types usable by the same interpolation function:

```python source="app/crate/db/paths.py#L25-L27" commit="06af0101d0c5daf0e4fd7d86a0a1a1268c8aed7f" "a[d] + (b[d] - a[d]) * t"
def _lerp(a: list[float], b: list[float], t: float) -> list[float]:
    """Linear interpolation between two vectors. t=0 → a, t=1 → b."""
    return [a[d] + (b[d] - a[d]) * t for d in range(len(a))]
```

For each step, the planner calculated a target vector along the line and asked PostgreSQL for the
nearest unused track. Waypoints divided the line into ordered segments. The result included each
selected track's identity, position, progress and distance, and creation saved that sequence with
the route's endpoints and requested length.
[First planner](https://github.com/thecrateapp/crate/blob/06af0101d0c5daf0e4fd7d86a0a1a1268c8aed7f/app/crate/db/paths.py#L134-L215),
[saving the selection](https://github.com/thecrateapp/crate/blob/06af0101d0c5daf0e4fd7d86a0a1a1268c8aed7f/app/crate/db/paths.py#L221-L278).

Nearest-neighbour search was a useful component, but it answered only a local question. Bliss's
playlist tools can rank songs near a group of seeds or choose the next song by distance from the
previous one. Neither operation, on its own, reserves a destination or distributes a fixed number
of selections between waypoints. Those were constraints we had to add around retrieval.
[Bliss playlist operations](https://docs.rs/bliss-audio/latest/bliss_audio/playlist/index.html).

The geometry also had limits. An artist centroid was an average of available recordings, not a
representative song or a complete description of that artist. A target halfway between two
centroids could land in an empty part of our library. The nearest available recording could be a
large jump from the one we had just selected.

We changed the search target to combine the next interpolated point with the previous track's
actual vector. The early hybrid planner moved 55% of the way from that actual vector towards the
guide. It then scored a candidate pool using acoustic distance, artist affinity and genre overlap,
while excluding repeated songs and limiting artist repetition. Shared band members became another
input to artist affinity.
[Hybrid search and scoring](https://github.com/thecrateapp/crate/blob/6d09420aa1b160fd7a5cd594739f8e271c73b5c1/app/crate/db/paths.py#L315-L345),
[candidate scoring](https://github.com/thecrateapp/crate/blob/6d09420aa1b160fd7a5cd594739f8e271c73b5c1/app/crate/db/paths.py#L464-L503),
[shared-member signal](https://github.com/thecrateapp/crate/commit/18e7a0c5f7b96bad99f7578258df67c331136b07).

Each selected track therefore affected the next search. The planner was still making a sequence
of local choices; it did not search every possible playlist for a global optimum. That kept the
work bounded, at the cost of decisions that could constrain the rest of the route.

## Reserve the destination before filling the middle

The first version searched the whole library even at the endpoints. A track near an artist's
centroid might belong to someone else. We added scoped anchor selection in April: the first track
had to belong to the origin, and the last to the destination. An explicit track endpoint named the
exact recording to use.
[Initial anchor selection](https://github.com/thecrateapp/crate/commit/c75afc9bb6acff8370a12937902c9cd0f54439d5).

Selecting the destination last still left a problem. An intermediate step could consume its track,
or a live version of the same song, before the planner reached the end. A destination album with
few eligible recordings was particularly exposed. The request had an endpoint, but our selection
order had spent it.

The figure below runs the revised builder on three small test catalogues, one per lane: one where
the route completes, one where the destination's live version is among the candidates, and one with
nothing eligible for the middle. In each lane the builder reserves the destination first and then
fills the middle steps in order. The pool at the top right shows which rows are still usable. Dots
stand for requested steps, not distances between tracks, so an empty step stays visible instead of
making the route look shorter.

<div data-blog-visual="music-paths"></div>

We changed the builder to resolve both anchors first. It added the destination's track ID, title
key and song family to the used sets before searching for any intermediate tracks:

```python source="app/crate/db/paths_path_builder.py#L142-L158" commit="f602d82dd3253380234b68aadc5948b303b6803f" "used_ids.add" "used_song_keys.add"
    first, last = _resolve_path_anchors(
        origin_type, origin_value, origin_vec, dest_type, dest_value, dest_vec
    )
    if first:
        path_tracks.append(make_entry(first, 0, 0.0))
        last_actual_vec = (
            list(first["bliss_vector"]) if first.get("bliss_vector") else origin_vec
        )
    else:
        last_actual_vec = origin_vec

    if last:
        used_ids.add(last["id"])
        used_titles.add(f"{last['artist']}::{last['title']}".lower())
        song_key = track_song_identity(last)
        if song_key is not None:
            used_song_keys.add(song_key)
```

The two endpoint types can have different flexibility. If the destination is an explicit track
and the origin is an album, we resolve the fixed track first and choose a different eligible song
for the album. If both endpoints are flexible, the resolver can try another pairing. It does not
silently substitute a different recording for an explicit track request.
[Anchor pairing](https://github.com/thecrateapp/crate/blob/f602d82dd3253380234b68aadc5948b303b6803f/app/crate/db/paths_path_builder.py#L18-L52).

We also changed how steps were allocated across waypoint segments. The first allocation used
integer division and a minimum number of steps per segment, which became awkward when a short
route had many guides. The revised builder places each intermediate step by its overall progress
through the segment chain. Waypoints guide the route in order; they do not require a recording
by every named waypoint artist.
[Progress through the segment chain](https://github.com/thecrateapp/crate/blob/f602d82dd3253380234b68aadc5948b303b6803f/app/crate/db/paths_path_builder.py#L160-L195).

![The origin and destination are resolved first. The destination recording and its song family are reserved before intermediate candidates are selected. A waypoint changes the guide through vector space without requiring an exact track at that point.](/blog/building-a-route-through-the-music-collection/reserving-the-destination.svg)

[Open the anchor diagram at full size](/blog/building-a-route-through-the-music-collection/reserving-the-destination.svg).

The regression cases covered the consequences directly: a middle step offering a live version of
an anchor, flexible endpoints competing for the same song family, a short route with many waypoints
and a sparse catalogue with no eligible middle tracks. In the sparse case, the builder keeps the
endpoints it can resolve and returns fewer tracks.
[Anchor and waypoint regressions](https://github.com/thecrateapp/crate/blob/f602d82dd3253380234b68aadc5948b303b6803f/app/tests/test_music_paths_fallback.py).

## A route through genres needs a different map

Acoustic interpolation could guide a route between recordings. For broader artist and genre
journeys, we also built a scene planner that routes through the genre taxonomy, then selects
recordings for those stages. The acoustic planner remained available; one representation did not
cover every kind of journey.

A weighted graph is a familiar way to express this problem. NetworkX's Dijkstra interface, for
example, finds a route by adding the edge weights between nodes. It can minimise the supplied
costs, but those costs have to represent the kind of route the application wants. Our scene planner
uses its own priority-queue search over genre relationships.
[Weighted shortest paths in NetworkX](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.shortest_paths.weighted.dijkstra_path.html),
[Crate's scene-route search](https://github.com/thecrateapp/crate/blob/e5dc24b6998ce463f8d6e5a609ecd1a2dd97e24a/app/crate/db/paths_scene.py#L425-L483).

With the original costs, a punk-to-electronic route found a shortcut through Japanoise, including
an Undertones-to-Merzbow jump. The relationship existed in
the taxonomy, but treating a broad scene and a much more specific offshoot as an equally cheap
connection produced a poor bridge for this request.

We added a cost for cultural links that jump multiple levels of specificity. Parent and child
edges kept their own costs; influence, fusion and related edges included the extra penalty. The
revised route went through punk, punk-rock and new-wave before electronic. Explicit noise
endpoints stayed valid: the change adjusted how the planner crossed the graph, rather than removing
an artist or genre from the catalogue.
[Edge costs](https://github.com/thecrateapp/crate/blob/e5dc24b6998ce463f8d6e5a609ecd1a2dd97e24a/app/crate/db/paths_scene.py#L409-L422),
[captured bridge comparison](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/evidence/music-paths/music-paths-bridge-review.md).

The revised list still needed listening review. Its stage boundary included Propagandhi followed
by New Order; a more plausible genre route did not settle whether that particular pair worked.
The graph chose the genre stages; we still had to select recordings that worked between them.

## When guest credits defeated the artist limits

The Clash-to-Erik Urano failure exposed a different assumption. A credit such as `Owner, Guest`
was kept as a complete artist name. Another guest produced another string, so a per-artist quota
could see different artists even when the tracks belonged to the same principal performer.

Splitting every credit at commas or ampersands would have broken real band names. The query already
had a better piece of context: if the credited name was a library artist, it used that artist;
otherwise it resolved the album owner. We preserved that value as `principal_artist`, used it in
SQL quotas and made the Python selector prefer it:

```python source="app/crate/recommendation_policy.py#L26-L37" commit="54572a51cc931c24e29beb957d025b41c1baae2b" "principal_artist" "_FEATURED_ARTIST_RE.sub"
def path_artist_key(row: dict) -> str:
    """Lowercase the principal artist, stripping explicit featured-artist credits.

    Rows from the catalog carry ``principal_artist``: the credited name when it is a
    library artist, otherwise the album owner. Other rows fall back to the album
    artist only when it is one of the credited names, so a band named "X & Y" stays
    whole while "Owner, Guest" collapses onto its owner.
    """
    name = str(row.get("principal_artist") or _credited_principal(row)).strip(
        PATH_ARTIST_TRIM_CHARS
    )
    return _FEATURED_ARTIST_RE.sub("", name).strip(PATH_ARTIST_TRIM_CHARS).lower()
```

For rows without that catalogue field, the fallback uses the album artist only when it is one of
the credited names. Explicit trailing `feat.`, `ft.` and `featuring` credits can be removed for
counting. Display credits stay intact. The identity used to enforce diversity does not need to
replace the text shown beside a song.

Album concentration needed a rule too. The scene planner added a limit of two tracks per album
and avoided adjacent tracks from the same album. When a scene exhausted its eligible artists, it
could relax those limits and then borrow candidates from the previous scene. These were preferences
with a defined fallback, not a guarantee that any library could supply a perfectly diverse route.
[Principal-artist and album-selection changes](https://github.com/thecrateapp/crate/commit/54572a51cc931c24e29beb957d025b41c1baae2b).

Recent listening added another constraint. Generation reads significant listens from the previous
seven days; regeneration also treats the previous path's track IDs and song families as soft
exclusions. In acoustic selection, a fresh candidate has to fall within a 0.05 score band of the
preferred choice. Scene selection removes recent songs from its bounded variety pool before
applying seeded variation, and falls back to that pool when no fresh choice remains. Explicit
track endpoints stay fixed.
[Freshness rules](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/music-paths.md#freshness-and-artist-identity).

Generating a path does not record those songs as listened to. Opening a saved path does not run
the freshness policy again. Otherwise, reviewing the result would change the history used to
generate the next one, and replaying a route could silently select different music.

## Complete, good and playable are different results

An early validator marked a path partial whenever it had any warning. That conflated two problems:
failing to build the requested route and building a route with a quality concern. We separated
the structural failures from warnings such as repeated artists:

```python source="app/crate/music_path_validation.py#L153-L169" commit="54572a51cc931c24e29beb957d025b41c1baae2b" "is_partial" "generated_step_count"
    return {
        "is_partial": any(
            warning["code"]
            in {
                "insufficient_tracks",
                "excess_tracks",
                "missing_origin",
                "missing_destination",
                "unavailable_track",
                "unresolved_waypoint",
                "invalid_waypoint_order",
            }
            for warning in warnings
        ),
        "generated_step_count": len(tracks),
        "warnings": warnings,
    }
```

A route can now contain the requested number of tracks and both endpoints while still carrying
an artist-repeat warning. Conversely, a hundred-step request that returns ninety-seven tracks is
partial even if the tracks themselves are sensible. We persist the generation report alongside
the selected order, so list and detail views describe the same result.
[Persisted tracks and generation metadata](https://github.com/thecrateapp/crate/blob/54572a51cc931c24e29beb957d025b41c1baae2b/app/crate/db/repositories/paths.py#L78-L109).

Availability can change after generation. Saved steps remain visible when their audio is no longer
playable; a live `playable` field tells Listen which ones can start playback. That does not rewrite
the historical generation report. The queue conversion skips unavailable steps while preserving
the saved order and maps the clicked step to its index in the remaining playable queue.
[Saved-path playback conversion](https://github.com/thecrateapp/crate/blob/54572a51cc931c24e29beb957d025b41c1baae2b/app/listen/src/pages/path-playback.ts#L6-L39).

We gave that queue a `path` source with the route's ID and link. It has no radio continuation
descriptor, so Infinite Playback cannot append more recommendations after the destination.
Explicit repeat controls retain their behaviour. Remote handoffs through Connect or peer playback
use the existing compact queue representation and lose the local path attribution; they do not
carry a full path protocol.
[Finite playback and remote-target contract](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/music-paths.md#finite-playback-and-remote-targets).

![Generation saves an ordered sequence and a report about completeness. Reading adds current availability without selecting new songs. Local playback uses the available saved steps in order and has no radio continuation after the destination.](/blog/building-a-route-through-the-music-collection/saved-route-playback.svg)

## Checking the route as well as the query

The route constraints affected database work as well as selection. We batched endpoint context and candidate
reads, reused a read transaction for acoustic planning and repaired the missing cosine HNSW index.
Approximate retrieval can change which candidates are returned; pgvector documents that adding an
approximate index trades recall for speed. We therefore had to check the resulting journeys as
well as the query timings.
[Query and index changes](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/music-paths.md#query-and-index-behavior),
[pgvector's exact and approximate search](https://github.com/pgvector/pgvector#indexing).

The reviewed performance run used a local replica of roughly 138,000 tracks with synthetic listening
history, twenty-five measured samples per case and AI disabled. Its hundred-step punk-to-electronic
case consistently returned ninety-seven tracks with `insufficient_tracks`. The report kept that
failure visible rather than counting only routes that reached the requested length. The timings
covered planning on that replica, not production HTTP latency or a listening verdict.
[Reviewed-stack measurements](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/evidence/recommendations-review/README.md).

Current Music Paths can also apply an optional model refinement, but proposed substitutions must
pass the deterministic eligibility, anchor and diversity checks. An ordinary read still returns
the saved selection; changing it belongs to generation or a separate validated refinement. The
route does not depend on a model to find its endpoints or admit that it is incomplete.
[Refinement constraints and saved reads](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/music-paths.md#completeness-warnings-and-availability).

The saved selection lets us inspect a repeated artist or an awkward jump without generating a
different route. A complete result with no warnings can still sound wrong. We have to listen, then
inspect the candidates and scores behind the passage that failed.
