---
title: "Giving the Cast receiver the queue"
description: "A Cast receiver needed to keep playing after the phone left. Crate handed it a real queue and separated queue edits, playback state and media access."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 22
related: [keeping-the-music-playing-on-android, taking-playback-over-from-navidrome, a-desktop-app-has-a-life-outside-its-window]
tags: [How to dismantle Spotify, Cast, playback, history]
sources:
  - app/shared/cast/src/protocol.ts
  - app/cast-receiver/src/caf-adapter.ts
  - app/cast-receiver/src/receiver-session-runtime.ts
  - app/cast-receiver/src/receiver-client.ts
  - app/listen/src/lib/cast-sender.ts
  - app/listen/src/lib/cast-session-client.ts
  - app/crate/api/cast.py
  - app/crate/db/repositories/cast_sessions.py
  - app/tests/test_cast_sessions.py
  - app/tests/test_cast_session_api.py
  - docs/technical/ios-release-and-cast.md
---

_Part 22. Receiver-owned Cast sessions, September 2026._

Sending one track to a Cast device made that device play the track. It did not give the device
Listen's queue. Our earlier web sender loaded one media request at a time, leaving the application
responsible for deciding what came next. That arrangement depended on a sender that might close its
tab, lose its connection or go to sleep.

We needed the receiver to hold the loaded queue and advance through it. A returning sender should
discover what was playing there, including its current position, instead of restoring the track and
time it remembered from before it disconnected. The change involved the Cast load request, a server
session, and a clear division between queue edits and playback state.
[The queue-authority change](https://github.com/thecrateapp/crate/commit/75cf968fd7bfcf22d7e4dc01535f0f9752acb6d6).

## Cast already had a queue; we had to use it

Google's Web Receiver SDK supports a default queue through `QueueData` and `QueueManager`, and a
custom queue implementation through `QueueBase`. It can load a playlist and handle navigation on
the receiving device. We did not need to invent another mechanism that asked the phone to start the
next item every time the current one ended.
[Google Cast queueing](https://developers.google.com/cast/docs/web_receiver/queueing).

Crate added its own Web Receiver application around the Cast Application Framework, or CAF. The
application displayed Crate's player and tracked its session, while CAF handled media playback and
its queue. Being a custom receiver did not mean replacing CAF's player or implementing our own
audio decoder.
[Crate's CAF adapter](https://github.com/thecrateapp/crate/blob/75cf968fd7bfcf22d7e4dc01535f0f9752acb6d6/app/cast-receiver/src/caf-adapter.ts),
[Google's custom receiver model](https://developers.google.com/cast/docs/web_receiver/core_features).

The sender created a Crate playback session from the selected queue, then built a Cast `QueueItem`
for each item. It included metadata, playable resource URLs, the session bootstrap URL and a stable
Crate item ID. The initial item also carried the current playback position:

```typescript source="app/listen/src/lib/cast-sender-media.ts#L204-L216" commit="75cf968fd7bfcf22d7e4dc01535f0f9752acb6d6" "itemId"
    mediaInfo.customData = {
      crateCast: {
        ...crateCast,
        bootstrapUrl: session.bootstrap_url,
        itemId: item.item_id,
      },
    };
    const queueItem = new chromeCast.media.QueueItem(mediaInfo);
    queueItem.autoplay = true;
    if (index === session.queue.current_index) {
      queueItem.startTime = Math.max(0, session.queue.current_time);
    }
    return queueItem;
```

The sender loaded those items together, with the queue's start index and repeat mode. Once loaded,
CAF could move between them without another per-track load from the phone. Our receiver learned
which Crate item CAF was playing by reading its `customData`, rather than treating CAF's internal
numeric queue ID as the library track identity.
[Initial queue construction](https://github.com/thecrateapp/crate/blob/75cf968fd7bfcf22d7e4dc01535f0f9752acb6d6/app/listen/src/lib/cast-sender-media.ts#L174-L230),
[current-item mapping](https://github.com/thecrateapp/crate/blob/75cf968fd7bfcf22d7e4dc01535f0f9752acb6d6/app/cast-receiver/src/caf-adapter.ts).

An item ID identifies an occurrence in a queue, not just a song. A listener can add the same song
twice. The session client assigns distinct occurrence IDs and preserves existing IDs when building
an edited queue. Otherwise removing the second occurrence or following the currently playing one
after a reorder would be ambiguous.
[Stable queue-item identities](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/cast-session-client.ts).

## Edit the queue without overwriting the receiver cursor

The sender still needed to add, remove and reorder songs. The receiver needed to report which one
was playing and how far it had progressed. Giving both sides one version number would make a
routine position update conflict with a queue edit, or let a stale queue edit overwrite fresh
playback progress.

The shared protocol therefore carried two counters:

```typescript source="app/shared/cast/src/protocol.ts#L55-L63" commit="75cf968fd7bfcf22d7e4dc01535f0f9752acb6d6" "stateSeq"
export interface CastQueueSnapshot {
  queueRevision: number;
  stateSeq: number;
  currentIndex: number;
  currentTime: number;
  repeatMode: CastRepeatMode;
  shuffle: boolean;
  items: CastQueueItem[];
}
```

`queueRevision` orders changes to the queue. `stateSeq` orders receiver playback updates. A shared
package defined the messages and validated incoming data so the sender and receiver did not develop
slightly different copies of the contract.
[Versioned Cast protocol](https://github.com/thecrateapp/crate/blob/75cf968fd7bfcf22d7e4dc01535f0f9752acb6d6/app/shared/cast/src/protocol.ts).

For a queue update, the authenticated sender supplied its expected revision and a mutation ID. The
database locked the session row, checked for a previously applied mutation and then checked the
revision:

```python source="app/crate/db/repositories/cast_sessions.py#L353-L356" commit="75cf968fd7bfcf22d7e4dc01535f0f9752acb6d6" "mutation_status"
        if duplicate:
            return {**current, "mutation_status": "duplicate"}
        if current and current["revision"] != expected_revision:
            return {**current, "mutation_status": "conflict"}
```

The mutation ID lets a sender repeat a request whose response was lost without applying it twice.
The revision check makes a stale edit return a conflict snapshot. When the current item remains in
the new queue, the database finds it by stable item ID and updates its index. Moving a song earlier
in the list should not change which occurrence the receiver is playing.
[Queue mutation transaction](https://github.com/thecrateapp/crate/blob/75cf968fd7bfcf22d7e4dc01535f0f9752acb6d6/app/crate/db/repositories/cast_sessions.py).

The sender's queue-update schema deliberately excludes `current_index` and `current_time`. A request
that adds those fields is rejected. Playback state arrives through the receiver endpoint with its
own monotonically increasing sequence; an older update cannot rewind the stored cursor.
[Sender cursor rejection test](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_cast_session_api.py#L391-L403),
[receiver sequence test](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_cast_sessions.py#L269-L295).

![The sender edits the queue through an authenticated API and synchronizes it with CAF. The receiver owns playback progress and reads only session-scoped media. A disconnected sender can return and adopt the receiver snapshot; it does not replace the cursor.](/blog/giving-the-cast-receiver-the-queue/queue-ownership.svg)

### The receiver reported progress without the phone

The receiver's runtime listened to CAF events for the current item, playback state and time. It
published progress to the server and sent status messages to connected senders. The initial runtime
serialized state writes and advanced `stateSeq` before publishing:

```typescript source="app/cast-receiver/src/receiver-session-runtime.ts#L328-L345" commit="75cf968fd7bfcf22d7e4dc01535f0f9752acb6d6" "stateWrites"
  function flushState(): Promise<void> {
    if (!active) return Promise.resolve();
    const snapshot = store.getSnapshot();
    const progress = store.progress.getSnapshot();
    const nextStateSeq = snapshot.stateSeq + 1;
    const update = {
      stateSeq: nextStateSeq,
      currentIndex: snapshot.currentIndex,
      currentTime: progress.currentTime,
    };
    const bootstrapUrl = active.bootstrapUrl;
    store.dispatch({ type: "state-seq", stateSeq: nextStateSeq });
    sendStatus();
    stateWrites = stateWrites
      .catch(() => undefined)
      .then(() => publishState(bootstrapUrl, update));
    return stateWrites;
  }
```

A periodic checkpoint and item changes triggered those writes. They gave a reconnecting sender a
receiver-derived cursor, although the persisted position could lag between updates or after a
failed request. The server was storing reported progress, not predicting the exact sample coming
out of the receiver at every instant.

Refreshing queue metadata also had to preserve playback. When the runtime saw a newer queue
revision with the same current item, it retained the position already observed from CAF. It did
not reload the current song just because a later item had been added. Reconnection similarly
adopted the receiver's state rather than automatically starting a remembered local track.
[Receiver queue refresh](https://github.com/thecrateapp/crate/blob/75cf968fd7bfcf22d7e4dc01535f0f9752acb6d6/app/cast-receiver/src/receiver-session-runtime.ts),
[receiver runtime tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/cast-receiver/src/receiver-session-runtime.test.ts).

The receiver also accumulated listening checkpoints. It compared wall-clock movement with media
position movement rather than counting an arbitrary seek as time listened. This kept listening
history from depending entirely on a sender that might no longer be present.
[Receiver listening checkpoints](https://github.com/thecrateapp/crate/blob/75cf968fd7bfcf22d7e4dc01535f0f9752acb6d6/app/cast-receiver/src/receiver-session-runtime.ts#L135-L183).

## A lease for the receiver's loaded queue

A receiver makes its own HTTP requests. It does not share the phone's cookie jar, and handing it the
user's bearer or refresh token would give it much more authority than playing the selected queue
requires.

Crate created a random playback lease and stored only its hash in the database. The lease identified
a session with an owner, queue, expiry and receiver capabilities. Its bootstrap and item URLs let
the receiver fetch metadata, artwork and audio for that captured queue. A request for an item outside
the session was rejected. The bootstrap URL was still a credential and had to stay out of logs;
being narrower than an account token did not make it public data.
[Session creation and lease lookup](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/db/repositories/cast_sessions.py),
[queue-scoped media and artwork tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_cast_session_api.py).

The receiver client uses `credentials: "omit"` for these requests. Access comes from the scoped URL,
and the API supplies receiver-compatible CORS and byte-range handling. Format support also matters:
when a source format is unsuitable for the receiver, the server can prepare a compatible delivery
variant and return a retryable preparation response while that work finishes.
[Receiver HTTP client](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/cast-receiver/src/receiver-client.ts),
[Cast media endpoints](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/api/cast.py).

Session activity extends the idle window, but it does not create an unlimited lease. The session policy
uses a thirty-minute idle timeout and an eight-hour absolute lifetime. Receiver requests
can keep an active lease from becoming idle; they cannot push its absolute expiry forward. This
path does not renew the user's login token on the receiver. An expired or revoked grant stops
authorizing further requests, even if the receiver still remembers the queue.
[Lease expiry and activity rules](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/crate/db/repositories/cast_sessions.py),
[expiry tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_cast_sessions.py).

Session tests cover queue conflicts, duplicate mutations, stale state updates, scoped media access
and reconnection.
[Session repository tests](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/tests/test_cast_sessions.py).

## Disconnect, reconnect, then Stop Cast

Disconnect releases the sender's connection and clears its local Cast state. It ends the sender
session with `stopCasting: false`, leaving playback on the receiver. Stop Cast asks the receiver to
stop, revokes the server lease and ends the Cast session. The implementation can report that playback
stopped but revocation failed, rather than hiding the distinction between those operations.
[Disconnect and stop implementation](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/cast-sender.ts).

The first receiver-owned loading path landed in the custom web sender. The native bridges acquired
the same queue and protocol semantics as they were integrated. The current iOS bridge preserves
Crate item IDs in media `customData` and restores session metadata from the current queue item on
reconnection. An iOS build without the Google Cast SDK hides the control; a build that links the SDK
still needs a physical iPhone and receiver to validate discovery and playback.
[Initial custom web queue load](https://github.com/thecrateapp/crate/blob/75cf968fd7bfcf22d7e4dc01535f0f9752acb6d6/app/listen/src/lib/cast-sender.ts#L1044-L1082),
[iOS Cast integration](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/ios-release-and-cast.md).

Custom Cast also depends on matching receiver application IDs in the sender, API and registered
receiver deployment. The custom flag controls that route; disabling it retains the Default Media
Receiver fallback. The queue guarantees described here belong to the Crate custom receiver path,
not to any device that merely exposes a Cast button.
[Custom receiver selection](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/lib/cast-sender.ts),
[release configuration checks](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/testing/cast-release-checklist.md).

Later continuation work added another failure case: an append can reach CAF while its acknowledgement
is lost. Retrying blindly can add the batch twice. The current sender requires a receiver snapshot
before retrying an uncertain append, and late acknowledgements cannot commit a newer operation.
That extends the same ownership rule to long queues: the sender must reconcile with what the
receiver actually accepted.
[Cast continuation and lost-acknowledgement handling](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/technical/playback-continuation.md).

The sender that started this chapter could fall asleep and take the queue with it. Now the receiver
holds the queue, and a sender that returns, or retries an append whose acknowledgement went missing,
has to ask the receiver what it actually accepted. Whether that holds on real receiver firmware,
through sender sleep, format changes and rejoining, including with the native sender builds, is
still for the physical release checks to show.
[Physical Cast release checks](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/docs/testing/cast-release-checklist.md).
