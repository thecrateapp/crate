---
title: "Making listening history belong to Crate"
description: "Crate needed its own record of listening: events it could deduplicate, statistics it could rebuild, and scrobbles that could fail independently."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 25
related: [reads-from-snapshots, making-crate-usable-from-someone-elses-music-player]
tags: [How to dismantle Spotify, listening history, PostgreSQL, scrobbling, history]
sources:
  - docs/technical/listening-stats-projections.md
  - app/crate/db/repositories/user_library_playback_writes.py
  - app/crate/db/jobs/user_listening_projections.py
  - app/crate/scrobble.py
  - app/tests/test_user_listening_projections.py
  - app/tests/test_scrobble_lastfm.py
---

_Part 25. Building a listening record, April–October 2026._

After we deployed v2.6.0, four dashboard refreshes could start a user's first statistics build at
once. They all tried to insert the same initial rows into `user_track_daily` and collided on its
primary key. The refresh already used `FOR UPDATE` on the projection-state row. On the first build,
that row did not exist, so there was nothing to lock.
[First-build collision and fix](https://github.com/thecrateapp/crate/commit/8e516f8dd65182bee8290a21e3664dfceb806bc4).

We needed the builders to wait for one another before inspecting that state. A transaction-scoped
advisory lock gave them something to acquire even for a user with no projection rows:

```python source="app/crate/db/jobs/user_listening_projections.py#L499-L503" commit="8e516f8dd65182bee8290a21e3664dfceb806bc4"
def _lock_user_projections(session, user_id: int) -> None:
    session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:lock_key, 0))"),
        {"lock_key": f"user-listening-projections:{user_id}"},
    )
```

Both full and incremental builds acquire this lock, keyed by user. PostgreSQL releases it with the
transaction. The regression test starts four workers together, waits for each to finish and compares
the resulting tables with a full rebuild. The first worker can create the projection state while
the others wait, instead of all four trying to initialize it.

The repair depended on keeping listening events separate from the statistics made from them.
`user_track_daily` could be reconstructed. The underlying listening record had to survive retries,
changes of timezone and external services refusing a scrobble. We had started building that record
in April, before it became the input to October's projections.

## Keep the event before deciding what it counts as

Crate's earlier `play_history` stored a user, track reference, display metadata and timestamp. That
was enough for a recently played list. It could not tell us how much of the song had played,
whether it was skipped or which listening context had selected it.

The rich event writer stored start and end timestamps, played seconds, track duration, completion
ratio, completion and skip flags, listening context and device information. It kept title, artist
and album alongside the library reference, so a history row could still be read after its file left
the library.
[Initial event writer](https://github.com/thecrateapp/crate/blob/1bbd51b9cbdff1614a0516516404d0b364779e37/app/crate/db/user_library.py).

We initially kept the older history path alongside the new writer. The later April cutover moved
the history query to `user_play_events`, removed the old statistics fallback and added a
client-generated event ID. Adding the table alone had not moved every reader and writer onto it.
[History cutover](https://github.com/thecrateapp/crate/commit/f8a84194627ef7c29d8612f25f81789c0495263c).

That ID is what lets a client retry after losing the response. Resending the same listen should
resolve to the stored event ID, not create another one. The migration added a user-scoped unique
index:

```python source="app/crate/db/migrations/versions/014_user_play_event_idempotency.py#L25-L31" commit="f8a84194627ef7c29d8612f25f81789c0495263c" "client_event_id"
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_user_play_events_user_client_event
        ON user_play_events(user_id, client_event_id)
        WHERE client_event_id IS NOT NULL
        """
    )
```

The writer first looks for the ID and returns that event's database ID when it finds one. Two requests
can still pass that lookup together, so the unique index supplies the database boundary. This
insert path does not guarantee a friendly success response to both racing requests. It also cannot
deduplicate an event whose ID is missing. The client has to retain the original ID and resend it.

Keeping the event queued matters just as much. A later October client fix held queued play events
until the server acknowledged storage. A uniqueness constraint cannot recover something the client
has already discarded.
[Client queue acknowledgement fix](https://github.com/thecrateapp/crate/commit/aae6a0ac290925520311b66cef6a346743fb414a).

Once stored, one event can contribute to different measures. Accepted event count, completed plays
and skips remain separate. Listening minutes come from `played_seconds`. The dashboard names these
semantics with `metrics_version: "listening-v1"`; an accepted event does not mean the song reached
its end.

An external scrobble has another definition. Last.fm's Scrobbling 2.0 rules require a track longer
than 30 seconds and listening for at least half its duration or four minutes, whichever comes first.
Its Now Playing notification does not update charts. ListenBrainz also documents a
half-track-or-four-minute submission threshold.
[Last.fm scrobbling rules](https://www.last.fm/api/scrobbling),
[ListenBrainz submission API](https://listenbrainz.readthedocs.io/en/latest/users/api/core.html#post--1-submit-listens).

We added direct integrations with both services in April, but Crate still needed to retain short
skips, reported listening time and the context behind a recommendation. If we kept only accepted
scrobbles, the provider's counting rules would decide which local events survived. Keeping only
counters would lose a different kind of information: a play count or artist total cannot reconstruct
the events needed to repair a grouping rule later.

`user_play_events` remained the durable input. Counters and external submissions used those
events, leaving the original timestamps, flags and listening context available for another calculation.

## An event at 05:30 UTC can belong to yesterday

The timezone regression test sets the account to `America/Los_Angeles` and records an event ending
at `2026-04-02T05:30:00+00:00`. Its hourly row belongs to April 1, hour 22. Grouping by the UTC date
would put that same listen on April 2, changing the daily chart and potentially the user's streak.
[Projection tests](https://github.com/thecrateapp/crate/blob/8e516f8dd65182bee8290a21e3664dfceb806bc4/app/tests/test_user_listening_projections.py).

Crate stores an IANA timezone on the user and converts the event's `ended_at` into that zone.
Accounts without a zone use UTC. Date bounds are constructed locally and then converted to UTC
for event selection. A local day across a daylight-saving change need not contain 24 hours, so
adding a fixed number of UTC hours is not a substitute for constructing those bounds.

The event goes entirely into the local day in which it ended, including its played seconds. We do
not split a play across midnight. That simplifies the projection and gives it a consistent rule,
but a long listen crossing midnight contributes all of its time to the later day.

The chosen day becomes durable work in the same transaction as the event insert:

```python source="app/crate/db/repositories/user_library_playback_writes.py#L282-L290" commit="cbfd4403722dd97a4a80ca60960193708637ffb8" "mark_listening_day_dirty"
        if row is None:
            raise RuntimeError("Play event insert did not return an id")
        event_id = row["id"]
        mark_listening_day_dirty(session, user_id, ended_at)

        emit_user_domain_event(
            session,
            event_type="user.play_event.recorded",
            user_id=user_id,
```

If the transaction rolls back, neither the event nor its dirty-day marker survives. If it commits,
the worker can find that day even after the request has finished. The marker's key is `(user_id, day)`,
so many events on one day do not need many independent rebuilds of the same day.

![A play event and its dirty local day commit together. A worker rebuilds daily projections and dashboard snapshots, while a separate scrobble path sends eligible events to linked providers.](/blog/making-listening-history-belong-to-crate/listening-record.svg)

During a refresh, the worker acquires the user lock, then drains the markers with
`DELETE ... RETURNING` inside its transaction. It rebuilds the selected days' track, daily and hourly
projections from raw events. It also updates first-listen dates, sessions and period statistics.
If the transaction fails, its partial projection writes roll back and the consumed markers return
with them. Deleting a marker is not an irreversible acknowledgement before the work is done.

A changed day can remove an entity as well as add one. The refresh keeps the keys from both before
and after the daily rebuild, so it can correct first-listen records even for an entity that no
longer appears in that day:

```python source="app/crate/db/jobs/user_listening_projections.py#L501-L513" commit="cbfd4403722dd97a4a80ca60960193708637ffb8"
    if days:
        before = _touched_keys(session, user_id, days)
        _rebuild_days(session, user_id, tz, days)
        after = _touched_keys(session, user_id, days)
        keys = {
            entity: sorted(set(before[entity]) | set(after[entity]))
            for entity in before
        }
        _rebuild_firsts(session, user_id, keys)
        start, end = _day_bounds(days, tz)
        _rebuild_sessions(session, user_id, start, end)
    _rebuild_window_stats(session, user_id, tz)
    _save_state(session, user_id, tz, rebuilt=False)
```

Sessions use a 30-minute gap rule. They are derived groups of events, not a measure of when someone
stopped paying attention. Rebuilding them still reads raw events in the affected range; period
tables are rebuilt from daily projections. Incremental refresh therefore avoids reconstructing
every daily row from the whole raw history, but does not make all remaining work constant.

Changing the account's timezone can move events between days. The projection state records the
zone used to build it, and a mismatch triggers a full rebuild. The tests check the Los Angeles
assignment above, local dates around both Madrid daylight-saving changes, a changed timezone and
incremental rows matching a full recomputation. The concurrent-first-build test uses that same full
rebuild as its reference result.

The lock fixes builders colliding with one another. It does not schedule a refresh. A later October
change added a sweep of dirty listening days so a missed refresh did not wait for the next play to
arrive. Durable markers provide work to recover; something still has to look for them.
[Dirty-day sweep](https://github.com/thecrateapp/crate/commit/fcb7c1483cf1bfa27c88908e5cee8c3720c72870).

The dashboard reads a worker-built snapshot of these projections and can temporarily lag behind
the latest event. The lightweight today counter updates after commit and falls back to a stored
daily row. A fresh headline and an older dashboard snapshot can therefore coexist. Neither HTTP
path needs to rebuild the user's whole history to answer.
[Listening projections and dashboard contract](https://github.com/thecrateapp/crate/blob/f3842fb448b3a764f236a524ba839b106eb56c8b/docs/technical/listening-stats-projections.md).

## Last.fm can answer with an accepted count of zero

Scrobbling is dispatched after the local transaction finishes. A provider timeout cannot roll back
the listening event or its dirty-day marker. The original integration dispatched completed plays;
later October work changed eligibility to use the listening threshold and stored explicit outcomes
from each provider.
[Eligibility and dispatch correction](https://github.com/thecrateapp/crate/commit/2cf1dc5f145f65e3d624e653a1f8d4ddbfc8d1ac).

Being eligible to send an event still did not mean it had been accepted. Last.fm's accepted count
can arrive as a string. Treating `"0"` as a truthy Python value reported acceptance when the provider
had accepted nothing. The corrected code parses the count and distinguishes accepted, ignored,
retryable and failed responses.

Those outcomes are stored per provider. An ordinary retry can then resend the unfinished submission
without sending the event again to another provider that has already returned a terminal result.
The local event remains available regardless of which account is linked or what the provider
answers.

There is still an uncertain interval after sending. A provider can accept the request and the
worker can lose its response before storing the result. Persisting outcomes reduces ordinary
resends; it cannot make delivery exactly once across that network exchange.

A corrected timezone or a failed projection build can now be repaired from the events Crate kept.
An ignored scrobble need not remove listening time from the local chart. The limit is the event
itself: if playback tracking reports the wrong seconds or loses a listen before it is stored,
rebuilding the tables will reproduce that missing or incorrect input.
