---
title: "When a familiar radio became too familiar"
description: "Radio needed to remember listening without mistaking a delivered queue for a played one. We added song families, bounded rotation and separate session memory."
date: 2026-11-10
visuals: [radio-rotation]
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 31
related: [teaching-crate-to-listen, building-a-route-through-the-music-collection, smart-mix-planned-on-the-server]
tags: [How to dismantle Spotify, recommendations, radio, PostgreSQL, history]
sources:
  - app/crate/radio_engine.py
  - app/crate/recommendation_policy.py
  - app/crate/track_versions.py
  - app/crate/db/queries/recommendation_history.py
  - app/crate/radio_continuation.py
  - app/tests/test_radio_session_rotation.py
  - app/tests/test_radio_delivery_memory.py
  - app/tests/test_radio_final_rotation.py
  - docs/technical/evidence/radio/rotation-review.md
---

_Part 31. Giving radio a memory of listening in October 2026._

Start a radio from Citizen, listen to twenty songs, then start it again the next day. In our
comparison, the old algorithm returned the same twenty songs in the same order. The recommendations
had not become less relevant to Citizen. They had become less useful to someone who had just heard them.
[The repeated-session comparison](https://github.com/thecrateapp/crate/blob/ed4ab8d694c7362958146fdf0b131036faa15d9a/docs/technical/evidence/radio/rotation-review.md).

Crate already had audio similarity, artist relationships, genre context and feedback. Those signals
helped choose music around a seed. They did not give the next session a useful memory of the previous
one. Adding more randomness would change the order, but it would also make it harder to explain why a
weaker candidate displaced a good one.

We added rotation around the existing ranking. That exposed another problem: a queue contains music
that may never be played. Once a recommendation service remembers things, it has to be precise about
what happened.

## Keep the musical neighbourhood

A radio needs more than a list of individually plausible tracks. Repeatedly choosing the closest
candidate can produce an uninteresting sequence. Google's [recommendation-system guide](https://developers.google.com/machine-learning/recommendation/dnn/re-ranking)
describes a separate reranking stage for constraints such as diversity and freshness. That is a useful
comparison for this change: preserve the relevance calculation, then give the selection stage more
information about the session and listener.

We could exclude every recently heard song. In a small collection, or around a seed with few nearby
artists, that eventually leaves unrelated music or an empty queue. We could also add a fixed recency
penalty to every score. That makes the result depend on how the penalty compares with several other
scoring terms, even when the best candidate is already fresh.

The rule we implemented was narrower. If the best candidate had been heard recently, prefer an unheard
candidate within **0.05 of its musical score**. Otherwise keep the good recent candidate available.
The threshold is an allowance in Crate's ranking function, not a calibrated percentage of musical
similarity. The seed, drift behaviour and musical weights stayed in place.
[Rotation with a quality allowance](https://github.com/thecrateapp/crate/commit/e57a633f11120eb2c5e8ea8d8bd9487fa554d25a).

There is a second constraint before ranking: the pool has to contain alternatives. If SQL retrieves
the same small set of recently played songs, a perfect reranker still has little to choose from.
When significant history exists, seeded radio expands its candidate limit to 420 and asks for more
tracks per artist. A second bounded retrieval can exclude cooled or rejected candidates when the
first pool cannot fill the batch. This changes how much of the existing musical neighbourhood we
inspect; it does not require a catalogue-wide query for each selection.
[Candidate retrieval](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/radio_engine.py#L1322-L1407).

## What counts as having heard a song

Last.fm distinguishes a Now Playing update from a scrobble. Its scrobbling rule requires a track
longer than thirty seconds and playback of half its duration or four minutes, whichever comes first.
The distinction is useful here, although Crate's recommendation policy uses a different threshold.
[Last.fm's scrobbling protocol](https://www.last.fm/api/scrobbling).

For rotation, a completed play counts. Otherwise an event counts once playback reaches thirty
seconds or half the track's duration, whichever is shorter. Unknown or invalid duration falls back
to thirty seconds. We use a seven-day window.

```python source="app/crate/recommendation_policy.py#L13-L31" commit="f200469d27b922a03829bee1b4ea24b05ced56a2" "was_completed"
def significant_play_threshold(duration: float | None) -> float:
    if duration is None or not isfinite(duration) or duration <= 0:
        return SIGNIFICANT_PLAY_SECONDS
    return min(SIGNIFICANT_PLAY_SECONDS, SIGNIFICANT_PLAY_RATIO * duration)


def is_significant_play(
    played_seconds: float | None,
    duration: float | None = None,
    *,
    was_completed: bool = False,
) -> bool:
    if was_completed:
        return True
    return (
        played_seconds is not None
        and isfinite(played_seconds)
        and played_seconds >= significant_play_threshold(duration)
    )
```

A five-second skip of an ordinary song does not enter that history. A forty-second track heard for
twenty seconds does. The policy tests each event independently: two brief attempts are not added
together to invent one substantial listen. A later brief attempt also cannot hide an earlier
qualifying play. Those cases are covered by the [history tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_recommendation_history.py#L149-L255).

The history query reads `user_play_events` directly, with the listener and time window in the SQL
filter. It does not wait for a listening-statistics projection. Local IDs, entity UUIDs and global
catalogue IDs are resolved in batches, with event metadata as a fallback. The query returns recent
song identities, their latest significant play and counts.
[The batched query](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/db/queries/recommendation_history.py#L17-L120).

A track ID alone would make this policy easy to evade accidentally. The same recording can appear
on the original album, a deluxe edition and a compilation. Another version might be tagged as live
or remastered. Our shared song identity normalizes the artist and title and removes recognized
trailing version markers. Radio therefore cools a song family, rather than only one database row.
[Song identity](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/track_versions.py#L101-L128).

This is a metadata policy. It does not prove that two recordings sound alike. Grouping a live version
with its studio counterpart is useful for avoiding immediate repetition, but can be too coarse for
a listener who wants to explore different performances. Misspelled artists and unusual titles can
also split or merge families incorrectly. Sharing one implementation at least keeps the queue and
history from disagreeing about the same tags.

## A delivered song needs a different memory

Consider a different sequence. Radio delivers a song. The listener skips after five seconds. The
client later asks for another batch with an empty buffer.

The play is too short for significant history, and the buffer no longer contains the song. Without
another memory, the same high-scoring candidate can win immediately. Calling that five-second event
a significant listen would prevent the repeat, but it would also distort future sessions.

We added a per-session delivery ledger containing the latest 500 canonical song identities. Delivering
a song updates this ledger even if playback never starts. It does not write a listening event.
[Delivery memory](https://github.com/thecrateapp/crate/commit/595691d0a1c07eaff08a96549ffbed7dbf6c0689).

![Radio keeps the active queue, session deliveries and significant listening history separate. Only actual qualifying playback enters the seven-day history.](/blog/when-a-familiar-radio-became-too-familiar/three-memories.svg)

The figure below replays four refills through the corrected selector. The candidates are synthetic
rows from the regression tests, not Citizen's pool, and lower scores are better. The three lanes
underneath are Radio's memories: the buffer, the session ledger and the listening history. After a
five-second skip, only the session ledger remembers the song. After a thirty-second play, the
history marks the whole song family as recently heard, and an unheard candidate within 0.05 of the
best score replaces it. The last two refills show the fallbacks: a recently heard song stays when no
unheard candidate is close enough, and a delivered song comes back when nothing undelivered is left.

<div data-blog-visual="radio-rotation"></div>

The first attempt combined delivered songs with listening history before selection. That reused the
quality allowance in a place where it did the wrong thing. A just-delivered track with a score of
0.10 could beat an undelivered track at 0.40, because the latter sat outside the 0.05 allowance. A
listener could skip and promptly receive the same song again.

We separated the inputs. The delivery check first looks for the best candidate absent from both the
session ledger and recent listening. It can move beyond the recency allowance because the session
has already offered the current winner. The following check applies the 0.05 allowance to actual
recent listening.
[The correction](https://github.com/thecrateapp/crate/commit/924b7fb6d08e0a9a80a8241ed41786aa7a770824).

```python source="app/crate/radio_engine.py#L1698-L1724" commit="924b7fb6d08e0a9a80a8241ed41786aa7a770824" "delivered_song_keys" "_RADIO_RECENCY_QUALITY_BAND"
    if best and delivered_song_keys and canonical_key(best) in delivered_song_keys:
        truly_fresh = [
            item
            for item in ranked
            if canonical_key(item[0]) not in delivered_song_keys
            and canonical_key(item[0]) not in (rotation_history or {})
        ]
        if truly_fresh:
            best, best_score, distance = min(truly_fresh, key=lambda item: item[1])
            best["distance"] = distance

    if best and rotation_history and canonical_key(best) in rotation_history:
        fresh = [
            (candidate, distance)
            for candidate, score, distance in ranked
            if score <= best_score + _RADIO_RECENCY_QUALITY_BAND
            and canonical_key(candidate) not in (delivered_song_keys or set())
            and (
                candidate_signals[candidate["id"]]["canonical_key"]
                if candidate_signals is not None
                else canonical_key(candidate)
            )
            not in rotation_history
        ]
        if fresh:
            best, distance = (rng or random).choice(fresh)
            best["distance"] = distance
```

Here lower scores are better. The first branch chooses the best truly fresh candidate from the ranked
pool. The second chooses among comparable unheard candidates when a recent listen would otherwise
win. If no usable alternative remains, a delivered song can return. Delivery memory is a cooldown;
permanently excluding everything ever sent would eventually exhaust a finite collection.

The regression tests make this distinction concrete. They give the delivered song a score of 0.10
and the fresh song 0.40, then assert that the fresh song wins the next refill. A separate case removes
the alternatives and checks that the radio can recover the delivered song. Another verifies that
only significant listening expands the SQL pool; merely delivering a batch must not manufacture a
week of listening history.
[Selection and exhaustion tests](https://github.com/thecrateapp/crate/blob/924b7fb6d08e0a9a80a8241ed41786aa7a770824/app/tests/test_radio_final_rotation.py#L25-L114).

## Bounded memory has to forget the right entries

Keeping the last 500 identities sounds straightforward. The delivery ledger uses insertion order:
remove an existing key, append it again, then retain the newest entries.

```python source="app/crate/radio_engine.py#L1163-L1172" commit="924b7fb6d08e0a9a80a8241ed41786aa7a770824"
def _record_delivered_songs(session: dict, tracks: list[dict]) -> None:
    delivered = dict.fromkeys(_delivered_song_keys(session))
    for track in tracks:
        key = canonical_key(track)
        if key is not None:
            delivered.pop(key, None)
            delivered[key] = None
    session["delivered_song_keys"] = [
        list(key) for key in list(delivered)[-_DELIVERED_SONG_LIMIT:]
    ]
```

Related title and song-key memories initially applied the same numeric bound to a set and a sorted
list. That removed arbitrary titles and alphabetically early keys, rather than the oldest deliveries.
A recent song could lose its cooldown while an older one remained. We changed those memories to
preserve delivery order before trimming them.
[Oldest-first eviction](https://github.com/thecrateapp/crate/commit/021704af956c26c8457045d00753c7d6bb849246).

Delivery also has to mean what the client actually receives. Native continuation can filter tracks
whose entity UUIDs are already known to the player. Recording a larger unfiltered batch would cool
songs that were never returned. The correction passes that exclusion into generation and records
the resulting delivery. Repeating an indexed batch returns the saved batch without advancing the
ledger again. These are small consistency rules with an audible consequence: a retry should not
silently consume the next set of recommendations.
[Filtered delivery test](https://github.com/thecrateapp/crate/blob/924b7fb6d08e0a9a80a8241ed41786aa7a770824/app/tests/test_radio_final_rotation.py#L154-L210),
[batch replay test](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_radio_delivery_memory.py#L175-L193).

## What changed in the comparison

We compared independent twenty-song sessions for two seeds against the production catalogue in a
read-only process. The listener was synthetic, with neutral preferences. Before session B, the
harness supplied completed listens for every song in A; before C, it supplied completed listens for
both previous sessions. Generating the lists wrote no application play events.

| Seed and comparison | Old algorithm: shared songs | Rotation: shared songs |
| --- | ---: | ---: |
| Citizen, A → B | 20 of 20 | 1 of 20 |
| Citizen, A → C | 20 of 20 | 0 of 20 |
| Citizen, B → C | 20 of 20 | 4 of 20 |
| Converge's “Concubine”, A → B | 17 of 20 | 1 of 20 |
| Converge's “Concubine”, B → C | 19 of 20 | 5 of 20 |

The new comparisons had no songs in the same position. Some songs returned in C because the quality
fallback allowed them. The artist-genre overlap proxy stayed in the same broad range, but that proxy
cannot tell us whether a transition feels right or a session is enjoyable. The evidence includes the
actual lists for listening review, and records approval of those lists. It is not a broad user study.
[Protocol, lists and review](https://github.com/thecrateapp/crate/blob/ed4ab8d694c7362958146fdf0b131036faa15d9a/docs/technical/evidence/radio/rotation-review.md).

The extra history work also needed a budget. On the production host, with a warm musical-graph cache
and 25 measured samples per seed, buffer lookup plus generation had p95 times of about 210 ms for
Citizen and 196 ms for Concubine, using three data SELECTs including the buffer lookup. These figures
exclude end-to-end HTTP and Redis latency. They show the cost of those two generation cases, not an
endpoint latency guarantee.
[Measurement conditions](https://github.com/thecrateapp/crate/blob/ed4ab8d694c7362958146fdf0b131036faa15d9a/docs/technical/evidence/radio/rotation-review.md#L87-L99).

Before this work, the same good seed could produce the same good list indefinitely. Afterwards,
qualifying listens influenced later sessions, deliveries influenced subsequent refills, and alternate
editions shared a cooldown. The implementation retains a rotation flag, enabled by default in the
November code, and tests the disabled path against the original ranking.
[Configuration](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/config.py#L49-L50),
[compatibility test](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_radio_session_rotation.py#L58-L70).

The remaining limitation is also clearer. Radio can inspect more of the collection and avoid recent
choices, but it still needs a musically useful pool. When that pool is small, repeating a suitable
song can be the right fallback. The change gives that repetition a reason beyond forgetting what
happened yesterday.
