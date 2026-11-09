---
title: "Giving the library a radio of its own"
description: "Artist Radio began with an average audio vector. We added several kinds of seed, listening history and queue refill to turn it into a listening session."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 8
related: [taking-playback-over-from-navidrome, smart-mix-planned-on-the-server, filesystem-to-indexed-catalogue]
tags: [How to dismantle Spotify, radio, recommendations, playback, history]
sources:
  - app/crate/radio_engine.py
  - app/crate/queue_engine.py
  - app/crate/db/radio.py
  - app/listen/src/lib/radio.ts
---

_Part 8. Turning local recommendations into a listening session, March–April 2026._

Our first Artist Radio could return nothing for an artist whose albums played perfectly well. The
query only loaded tracks with a Bliss audio vector. If analysis had not reached those files yet,
there was nothing to use as a seed.

When vectors were available, we averaged the artist's tracks into one vector, found nearby tracks
from other artists and mixed them with songs from the selected artist. That gave us a queue from
music already in the library. It also compressed every album, recording style and change of pace
in an artist's catalogue into one average.

We needed radio to work from the music someone was listening to: a particular song, an album or a
playlist, as well as an artist. It needed to keep some connection to that choice while finding
something else to play. Building it meant changing both the recommendation code and the player.
A ranked list alone had no memory of why it had been requested or what to do when it ran out.

This work overlapped with [taking playback over from Navidrome](/blog/taking-playback-over-from-navidrome).
The early radio payloads still carried Navidrome IDs alongside Crate track IDs and local paths.
Radio was already our responsibility while playback was still using both systems.

## From an empty seed to several points of comparison

For an artist with unanalysed tracks, we already had another source of candidates: related
artists from enrichment. Those names still had to resolve to recordings we could play. Audio
similarity could help choose those recordings once their vectors were available.

Last.fm's current `artist.getSimilar` API accepts an artist name or MusicBrainz ID and returns
artists with a match value between zero and one. That can describe a useful relationship even when
an artist has records that sound quite different from one another. Crate still has to match those
names to its catalogue and choose tracks it has available.
[Last.fm artist similarity API](https://www.last.fm/api/show/artist.getSimilar).

Bliss works with the files themselves. Its current 0.13 documentation describes analysing songs
into arrays of audio features, then comparing them with a distance function. Its simplest playlist
example orders songs by distance from a seed. It can operate on a local collection without needing
other people's listening histories.
[Bliss audio analysis and playlist examples](https://docs.rs/bliss-audio/0.13.0/bliss_audio/).

In March, Crate already used Bliss features and stored related artists from enrichment. The first radio used only the audio vectors. The related-artist data was available
elsewhere in the application, but it did not influence the queue.
[Our initial radio and similarity design review](https://github.com/thecrateapp/crate/blob/d5fdcfe5962b0e8d6b9840889698a0ae425c84e9/docs/plans/2026-03-28-similarity-analysis.md#L28-L75).

The immediate constraint was the local library. A plausible recommendation for a recording we did
not have could not become the next track. We generated candidates from catalogue rows and used
external relationships to help choose among them.

### One average was too little context

The first version, added in March, selected all analysed tracks belonging to the seed artist and
calculated their mean vector with NumPy. PostgreSQL then compared every eligible track from other
artists against that centroid:

```python source="app/musicdock/bliss.py#L132-L145" commit="603d203ae36f6e1f9afee9ffc9584ce8c3f7bd8f" "distance"
        # Find closest tracks from OTHER artists
        cur.execute("""
            SELECT path, title, artist, album, duration,
                   SQRT(
                       (SELECT SUM(POW(a - b, 2))
                        FROM UNNEST(bliss_vector, %s::float8[]) AS t(a, b))
                   ) AS distance
            FROM library_tracks t
            JOIN library_albums a ON t.album_id = a.id
            WHERE bliss_vector IS NOT NULL AND a.artist != %s
            ORDER BY distance ASC
            LIMIT %s
        """, (centroid, artist_name, limit))
        similar_tracks = [dict(r) for r in cur.fetchall()]
```

`UNNEST` paired each component of a stored vector with the corresponding component of the centroid.
The query squared the differences, summed them and took the square root. The tracks with the
smallest Euclidean distance came first. Analysis had already happened; starting radio read vectors
from PostgreSQL rather than decoding the music again.

This was a full scan of the eligible vectors. There was no vector index in this query, and its
ranking knew nothing about a listener's recent plays. It also had a musical limitation that a faster
query would not address. If an artist had a quiet record and a much heavier one, their mean could
sit between the two. A candidate close to that mean did not have to resemble any particular song
we had selected.

The queue reserved a source-track quota using a default `mix_ratio` of `0.4`, sampled the artist's
tracks and inserted one at every third position while recommendations remained. That quota and
insertion cadence were separate rules, so forty percent was not a guaranteed final composition.
A small pool could also produce fewer tracks than requested.
[Initial selection and interleaving](https://github.com/thecrateapp/crate/blob/603d203ae36f6e1f9afee9ffc9584ce8c3f7bd8f/app/musicdock/bliss.py#L147-L176).

We replaced the single average with several real seed tracks. In the unified artist radio added
at the start of April, we sampled up to five tracks with vectors, falling back to other tracks by
the artist when necessary. Candidates received the best score they achieved against those seeds.
An artist's different records could now provide several points of comparison.
[Artist seed selection](https://github.com/thecrateapp/crate/blob/d5fdcfe5962b0e8d6b9840889698a0ae425c84e9/app/crate/bliss.py#L230-L264).

The score combined audio and catalogue information:

| Signal | Initial April weight | What it contributed |
| --- | ---: | --- |
| Bliss cosine similarity | 0.30 | Similarity between the candidate and one seed's audio vector |
| Related artist | 0.20 | A bonus for an artist in the stored similarity relationships |
| Tempo proximity | 0.15 | A contribution that decreased as the BPM difference grew |
| Genre overlap | 0.15 | Jaccard overlap between the available genre sets |
| Key compatibility | 0.10 | Same or nearby positions on the Camelot wheel |
| Energy proximity | 0.10 | Closeness between the available energy values |

These were hand-written ranking weights. A score was not a probability that someone would like the
song. Missing tempo or energy contributed nothing for that signal; missing key information received
a neutral compatibility value. Tracks with incomplete analysis therefore did not compete under
exactly the same evidence as fully analysed tracks.
[The initial combined scorer](https://github.com/thecrateapp/crate/blob/d5fdcfe5962b0e8d6b9840889698a0ae425c84e9/app/crate/bliss.py#L29-L104).

We also changed where candidates came from. The artist path included tracks by known similar
artists and a sample from the wider analysed library. That made enrichment useful to listening
without limiting every recommendation to an external artist list. The first implementation still
required vectors on those candidates. Accepting an unanalysed seed was only part of removing the
dependency on analysis coverage.
[Candidate selection](https://github.com/thecrateapp/crate/blob/d5fdcfe5962b0e8d6b9840889698a0ae425c84e9/app/crate/bliss.py#L266-L303).

## Give the player one radio contract

Artist radio had started as a special endpoint. We added a radio API that returned two things:
`session`, describing the context, and `tracks`, containing the playable queue. A track radio could
identify its seed with a Crate `track_id`; an album or playlist used its catalogue ID. The response
kept that context available to the player after the user left the page where radio had started.

Listen mapped each response into its normal `Track` objects and a `PlaySource` with `type: "radio"`.
The radio source carried a seed type and identifier. Track payloads kept `libraryTrackId` separate
from the path and the optional Navidrome ID, so requesting recommendations did not require treating
another server's playback ID as a Crate catalogue ID.
[Listen's first shared radio adapter](https://github.com/thecrateapp/crate/blob/d5fdcfe5962b0e8d6b9840889698a0ae425c84e9/app/listen/src/lib/radio.ts#L29-L96).

The queue was temporary. Starting radio from a playlist did not insert recommended songs into the
saved playlist. This mattered because the same player would also use suggestions to continue an
album or playlist after its original tracks. The saved selection and the listening session needed
to remain separate.
[Radio and playlist design](https://github.com/thecrateapp/crate/blob/47baf6dc8a0c2f5cfdc08941e21e3db699384d67/docs/plans/2026-03-31-radio-and-playlist-intelligence-design.md#L30-L48).

The API regression tests checked the response contract for all four seeds, including the session
metadata and track identities. They replaced the recommendation generators with fixtures, so they
could catch a broken handoff to the player without establishing that a real queue sounded good.
[Initial radio contract tests](https://github.com/thecrateapp/crate/blob/47baf6dc8a0c2f5cfdc08941e21e3db699384d67/app/tests/test_radio_contracts.py).

![In March, an artist centroid produced a single batch. By early April, artist, track, album and playlist contexts fed recommendations, personal scoring and a diverse queue; Listen retained the seed to request more tracks.](/blog/giving-the-library-a-radio/radio-session.svg)

[Open the radio diagram at full size](/blog/giving-the-library-a-radio/radio-session.svg).

Albums and playlists needed more than one song to describe their contents. The first album radio
used up to four seed paths, preferring analysed tracks; playlist radio used up to five. Each seed
produced recommendations, which we merged by track path. A candidate found near several seeds
accumulated their scores:

```python source="app/crate/bliss.py#L506-L524" commit="47baf6dc8a0c2f5cfdc08941e21e3db699384d67" "_aggregate_score"
def _aggregate_similar_candidates(seed_paths: list[str], *, per_seed_limit: int = 40) -> list[dict]:
    aggregated: dict[str, dict] = {}
    for seed_path in seed_paths:
        for index, track in enumerate(get_similar_from_db(seed_path, limit=per_seed_limit)):
            track_path = track.get("track_path")
            if not track_path:
                continue
            entry = aggregated.setdefault(track_path, {**track, "_aggregate_score": 0.0, "_hits": 0})
            score = float(track.get("score") or 0.0)
            # Small position bias so earlier matches win ties more often.
            entry["_aggregate_score"] += score + max(0.0, (per_seed_limit - index) / (per_seed_limit * 100))
            entry["_hits"] += 1

    ranked = sorted(
        aggregated.values(),
        key=lambda item: (item["_aggregate_score"], item["_hits"]),
        reverse=True,
    )
    return ranked
```

The small position bonus broke some ties in favour of earlier recommendations. `_hits` provided
another tie-breaker. A track near several songs from the source could rank above a track that
matched only one.

That also made seed selection consequential. The first version took seeds from the beginning of
the source. By the April personalization update, a shared selector shuffled the pool, tried to
cover different albums and era buckets, then filled the remaining slots with other tracks. That
was a heuristic for representing a varied catalogue, not a clustering algorithm.
[Initial album and playlist seeds](https://github.com/thecrateapp/crate/blob/47baf6dc8a0c2f5cfdc08941e21e3db699384d67/app/crate/bliss.py#L566-L637),
[later seed selection](https://github.com/thecrateapp/crate/blob/f5d51444e4ac2207c3c3d024a540d8f08acd19a0/app/crate/bliss.py#L351-L410).

The fallback could now use the catalogue without a seed vector. When no seed had a Bliss vector, the recommendation path
could use related artists and other available evidence, including tempo, energy, key and ratings.
It still needed suitable catalogue rows, but missing Bliss analysis no longer forced an empty
result by itself.
[Recommendation fallback](https://github.com/thecrateapp/crate/blob/f5d51444e4ac2207c3c3d024a540d8f08acd19a0/app/crate/bliss.py#L767-L907).

## Choose what comes next, not just what scores highest

Several tracks from the same album can all score well. Taking the highest scores in order can
therefore produce a long run of one artist or repeat versions of the same title close together.
We added a placement check that looked at the queue already built: consecutive artist count,
recent albums and recent normalized titles.

The April implementation tried candidates in ranked order until it found one that fit:

```python source="app/crate/bliss.py#L467-L485" commit="f5d51444e4ac2207c3c3d024a540d8f08acd19a0" "_can_place_track"
    while pending:
        placed = False
        for index, track in enumerate(pending):
            if _can_place_track(
                result,
                track,
                max_consecutive_artist=max_consecutive_artist,
                album_cooldown=album_cooldown,
                title_cooldown=title_cooldown,
            ):
                result.append(track)
                pending.pop(index)
                placed = True
                forced = 0
                break
        if placed:
            continue

        result.append(pending.pop(0))
```

The defaults checked two consecutive tracks by an artist, the previous two positions for the same
artist-and-album pair, and the previous five for the same artist and normalized title. When none
of the remaining candidates fit, the last line shown above placed the first one anyway. These
were preferences the generator could relax when the library was sparse.
[Placement rules and fallback](https://github.com/thecrateapp/crate/blob/f5d51444e4ac2207c3c3d024a540d8f08acd19a0/app/crate/bliss.py#L413-L491).

That distinction is audible. With a varied candidate pool, a lower-ranked song can separate two
songs from one album. With only a few suitable tracks, the generator may accept a repetition so it
can continue assembling the queue. It did not manufacture variety that the collection could not
supply. At this stage, path deduplication and title cooldowns also fell short of a canonical identity
for every edition of a recording.

### Let the listener affect the ranking

The next change used the listener's own data. We built a profile for the candidate pool from liked
tracks, the previous fourteen days of track play events and thirty-day artist and album aggregates.
The queries fetched evidence for the candidate IDs and artists rather than loading the user's
entire listening history into the scorer.
[Profile queries](https://github.com/thecrateapp/crate/blob/f5d51444e4ac2207c3c3d024a540d8f08acd19a0/app/crate/bliss.py#L563-L670).

The adjustments were deliberately visible in code. A like added `0.12`. Recent plays and skips
subtracted bounded amounts:

```python source="app/crate/bliss.py#L673-L695" commit="f5d51444e4ac2207c3c3d024a540d8f08acd19a0" "adjusted"
def _apply_user_profile_score(track: dict, score: float, user_profile: dict | None) -> float:
    if not user_profile:
        return score

    adjusted = score
    track_id = track.get("track_id")
    if track_id is not None and track_id in user_profile.get("liked_track_ids", set()):
        adjusted += 0.12

    rating = track.get("rating")
    try:
        rating_value = float(rating or 0.0)
    except (TypeError, ValueError):
        rating_value = 0.0
    if rating_value > 0:
        adjusted += 0.04 * min(rating_value, 5.0) / 5.0

    recent = user_profile.get("recent_track_events", {}).get(track_id)
    if recent:
        play_count = int(recent.get("play_count") or 0)
        skip_count = int(recent.get("skip_count") or 0)
        adjusted -= min(0.22, 0.06 * play_count)
        adjusted -= min(0.12, 0.05 * skip_count)
```

A liked song could still be moved down after several recent plays. Artist completion rates added
a small preference, while frequent artist and album plays reduced their scores. The result was a
ranking adjustment; the code did not permanently ban a favourite because the listener had heard
it recently.

This was also where an apparently harmless refactor could change the recommendation twice. Both
the candidate generator and the outer radio builder could see the same user profile. Applying it
at both layers would double every boost and penalty. The artist and album builders explicitly
left the adjustment to the recommendation path.
[Artist builder](https://github.com/thecrateapp/crate/blob/f5d51444e4ac2207c3c3d024a540d8f08acd19a0/app/crate/bliss.py#L1094-L1103),
[album builder](https://github.com/thecrateapp/crate/blob/f5d51444e4ac2207c3c3d024a540d8f08acd19a0/app/crate/bliss.py#L1551-L1559).

Personalization also changed caching. An artist ID and limit were no longer enough to identify a
response: two users could receive different rankings. The API cache key included the effective
user ID, seed and requested size. Responses had a five-minute TTL, which avoided regenerating the
same batch on every identical request but also meant an immediate repeat could reuse it.
[Personalized radio cache](https://github.com/thecrateapp/crate/blob/f5d51444e4ac2207c3c3d024a540d8f08acd19a0/app/crate/api/radio.py#L58-L87).

## The next batch still belongs to this station

Once Listen retained the seed, it could ask for another batch before the queue ended. The early
refill implementation watched the number of upcoming tracks. With three or fewer remaining, it
requested thirty more using the same radio context.

A slow response could arrive after the user had started something else. The player used an abort
controller and a request signature, checked that the current source still matched, then filtered
the returned tracks against the queue and recently played tracks before appending them. A stale
request could not simply append its old radio results to the new session.
[Early refill checks](https://github.com/thecrateapp/crate/blob/f5d51444e4ac2207c3c3d024a540d8f08acd19a0/app/listen/src/contexts/use-playback-intelligence.ts#L116-L171).

The server still received a request for recommendations from the same seed. It did not receive
the client's whole queue in that call. If a repeated or cached batch contained nothing the client
could accept, filtering it would leave the queue unchanged. A refill error was logged, and the
existing queue kept its tracks. Starting a station did not guarantee that the library could keep
supplying fresh music indefinitely.
[Continuation requests](https://github.com/thecrateapp/crate/blob/f5d51444e4ac2207c3c3d024a540d8f08acd19a0/app/listen/src/lib/radio.ts#L192-L229).
