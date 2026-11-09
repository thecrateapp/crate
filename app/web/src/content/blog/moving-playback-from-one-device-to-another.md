---
title: "Moving playback from one device to another"
description: "Crate Connect grew from saved queues and remote commands into a handoff protocol. The difficult part was deciding when the new player could take over."
date: 2026-11-10
visuals: [connect]
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 17
related: [taking-playback-over-from-navidrome, building-a-route-through-the-music-collection]
tags: [How to dismantle Spotify, playback, distributed systems, Redis, history]
sources:
  - app/crate/api/connect.py
  - app/crate/api/connect_ws.py
  - app/crate/db/repositories/connect.py
  - app/crate/db/repositories/connect_state.py
  - app/crate/db/repositories/connect_ws_hub.py
  - app/listen/src/contexts/use-player-connect-v2-sync.ts
  - app/listen/src/hooks/crate-connect-ws-message-handler.ts
  - app/tests/test_connect_commands.py
  - app/tests/test_connect_ws_v2.py
---

_Part 17. Connecting separate Listen players in May and June 2026._

Consider moving a listening session from a phone to a desktop. The phone is playing; the desktop
still has to load the queue and prepare its player. If we pause the phone as soon as the server
accepts the request, the listener gets silence while the desktop catches up. If we let both play
until every message has arrived, we can get an overlap instead.

The phone and desktop in this example come from Connect's first backend transfer test. Receiving
a queue, owning the session and producing audio happen at different points.
[Ownership before and after acknowledgement](https://github.com/thecrateapp/crate/blob/f61a5b11367c1ee79433e97ba4f6063919b623c5/app/tests/test_connect_commands.py#L8-L104).

Before Connect, Listen could play the same library on either device, but opening the desktop did
not move the phone's session there. Each player had its own queue. Sending `play(track_id)` would
start the right song from the beginning and lose what came next. We needed to carry the queue order,
current position and playback modes, then decide when the phone could stop.

The first version waited for the destination to report playback. The second prepared the destination
without autoplay, changed the active player and then tried to resume it. That changed the failure
we had to handle after a transfer.
[Connect v1](https://github.com/thecrateapp/crate/commit/f61a5b11367c1ee79433e97ba4f6063919b623c5),
[the v2 handoff](https://github.com/thecrateapp/crate/commit/bef0448db7221c09374bae160df313c113092631).

## Keep the phone active while the desktop loads

Connect v1 registered devices under the signed-in user, including whether they could play and
receive commands. Its transfer request checked both devices, loaded the phone's saved state and
created a `transfer_in` command for the desktop. The phone remained the active device while that
command was pending.
[Creating the transfer](https://github.com/thecrateapp/crate/blob/f61a5b11367c1ee79433e97ba4f6063919b623c5/app/crate/db/repositories/connect.py#L735-L806).

The saved state contained compact track references, queue index and revision, position in
milliseconds, repeat and shuffle settings, the original unshuffled queue and the source of playback.
The receiving player rebuilt its queue from those references and passed the index and position to
its own audio engine. Audio still came from Crate's streaming path; the phone did not send decoded
audio to the desktop. A saved queue could also be restored without starting it. Transfer needed the
additional exchange that changed which player owned the session.
[Playback-state representation](https://github.com/thecrateapp/crate/blob/f61a5b11367c1ee79433e97ba4f6063919b623c5/app/listen/src/lib/remote-playback-state.ts),
[applying the transferred queue](https://github.com/thecrateapp/crate/blob/bef0448db7221c09374bae160df313c113092631/app/listen/src/contexts/PlayerContext.tsx#L1348-L1402).

The request went into a PostgreSQL outbox inside the transaction, before publication. The desktop
could receive commands through server-sent events or polling, and the command reader checked the
durable outbox before the live transport. If process-local publication was lost, the transfer
request was still there to read. Command IDs and deduplication prevented a repeated remote command
from advancing the session twice. Tests exercise both the lost publication and duplicate-command
cases.
[Outbox persistence and reads](https://github.com/thecrateapp/crate/blob/f61a5b11367c1ee79433e97ba4f6063919b623c5/app/crate/db/repositories/connect.py#L480-L571),
[lost-publication and duplicate-command tests](https://github.com/thecrateapp/crate/blob/f61a5b11367c1ee79433e97ba4f6063919b623c5/app/tests/test_connect_commands.py#L222-L343).

Receiving the command was not enough to release the phone. For a transfer requesting playback, the
desktop client waited until its local player reported playing without buffering. If it had not
reached that state within fifteen seconds, it returned an error. Unmounting with a pending transfer
also sent an error acknowledgement. A transfer into a paused state could acknowledge immediately
after applying the queue.
[Receiver acknowledgement](https://github.com/thecrateapp/crate/blob/f61a5b11367c1ee79433e97ba4f6063919b623c5/app/listen/src/contexts/use-crate-connect-commands.ts#L173-L267).

An unsuccessful acknowledgement kept ownership on the source:

```python source="app/crate/db/repositories/connect.py#L842-L854" commit="f61a5b11367c1ee79433e97ba4f6063919b623c5" "active_device_id=source_device_id"
    if status != "success":
        source_playback_session_id = str(
            source_state.get("playback_session_id") or uuid.uuid4()
        )
        _upsert_active_session(
            user_id,
            playback_session_id=source_playback_session_id,
            active_device_id=source_device_id,
            status=str(source_state.get("status") or "playing"),
            state_revision=str(command["command_id"]),
            session=session,
        )
        return None
```

A successful acknowledgement moved the active session to the desktop. If the phone could still
receive commands, the backend created `transfer_out` for it. If that capability check failed,
ownership had already moved, but no stop command was created. The normal path is what the backend
test checks: before acknowledgement, the phone is still active and has no outgoing command;
afterwards, the desktop owns the session and the phone has `transfer_out` waiting for it.
[Committing the acknowledged transfer](https://github.com/thecrateapp/crate/blob/f61a5b11367c1ee79433e97ba4f6063919b623c5/app/crate/db/repositories/connect.py#L856-L901).

The desktop could already be playing while the stop command travelled back to the phone. That left
room for overlap. The local playing and buffering flags were useful acknowledgements, but they
were not a measurement of sound reaching either device's speakers.

Spotify's current public transfer API exposes a smaller interface: select one device, then request
playback or preserve the existing playing state. It warns that execution order is not guaranteed
when combined with other Player API endpoints. That is a useful comparison for the caller's
contract; it does not tell us how Spotify coordinates its players internally. Crate needed a
protocol on both sides of the request.
[Spotify's Transfer Playback API](https://developer.spotify.com/documentation/web-api/reference/transfer-a-users-playback).

## Prepare a particular player, then commit the transfer

The desktop introduced another ambiguity: it could have two Listen tabs open. A persistent device
ID identified the browser profile or installation, while both tabs had their own audio engine.
Addressing a device was not precise enough to identify the player taking over.

Connect v2 added a playback-instance ID generated when the client hook mounted. The device ID
continued to identify the installation; the instance ID named one connected player. An active
session could now select one tab without treating every player on that device as its owner.
[Device identity](https://github.com/thecrateapp/crate/blob/bef0448db7221c09374bae160df313c113092631/app/listen/src/lib/listen-device.ts),
[instance creation and connection lifecycle](https://github.com/thecrateapp/crate/blob/bef0448db7221c09374bae160df313c113092631/app/listen/src/hooks/use-crate-connect-ws.ts).

Before joining, the client made an authenticated HTTP request for a short-lived WebSocket ticket
scoped to the user and device. Its socket handshake had to present the same device ID, then supplied
the instance ID and capabilities. The connection hub could address one instance or broadcast state
to all of that user's players. Redis Pub/Sub carried those messages between API processes, and
Redis presence records let one process discover a player connected to another.
[Ticket and handshake](https://github.com/thecrateapp/crate/blob/bef0448db7221c09374bae160df313c113092631/app/crate/api/connect_ws.py#L74-L170),
[connection hub](https://github.com/thecrateapp/crate/blob/bef0448db7221c09374bae160df313c113092631/app/crate/db/repositories/connect_ws_hub.py).

With both players connected, the v2 transfer request named the desktop instance. The server checked
that it was connected, rejected a second pending transfer and stored a transfer ID, source, target
and ten-second deadline. It left the phone active and sent `transfer_incoming` to the desktop with
the current player state.

A handoff is really three steps: the desktop loads the queue, the server makes the desktop the
owner, and the desktop starts playing. The figure below shows them in that order. Select v1 to see
the first version, where the desktop was already playing before the phone was told to stop.

<div data-blog-visual="connect"></div>

The desktop rebuilt its queue with autoplay disabled. Its callback returned success when it had
applied a non-empty queue to the local engine; it did not wait for decoded audio to reach the
speakers. The socket replied with `transfer_ready` or `transfer_cancel`. Ready meant the queue had
been applied, while the phone still owned playback.
[What the target accepted](https://github.com/thecrateapp/crate/blob/bef0448db7221c09374bae160df313c113092631/app/listen/src/contexts/PlayerContext.tsx#L1411-L1422).

The server only accepted readiness for the pending transfer from its designated target:

```python source="app/crate/api/connect_ws.py#L390-L398" commit="bef0448db7221c09374bae160df313c113092631" "transfer_target_instance_id" "transfer_id"
    state = await _require_state(user_id)
    transfer_id = str(message.payload.get("transfer_id") or "")
    if (
        state.get("transfer_state") != "pending"
        or state.get("transfer_id") != transfer_id
    ):
        raise ValueError("No matching pending transfer")
    if state.get("transfer_target_instance_id") != instance_id:
        raise ValueError("Only the transfer target can complete this transfer")
```

After those checks and a successful versioned state update, the server assigned ownership to the
desktop instance and cleared the pending fields. It sent `transfer_committed` to the desktop, then
`became_inactive` to the phone. Listen handled the first by resuming the target and the second by
pausing the source. These messages ran on separate machines; they did not schedule both audio
engines for one instant.
[Transfer state machine](https://github.com/thecrateapp/crate/blob/bef0448db7221c09374bae160df313c113092631/app/crate/api/connect_ws.py#L338-L528),
[client callbacks](https://github.com/thecrateapp/crate/blob/bef0448db7221c09374bae160df313c113092631/app/listen/src/contexts/PlayerContext.tsx#L1478-L1491).

![A source player remains active while the server prepares a transfer. The target applies the saved queue without autoplay, replies ready with the incoming version, and becomes active only after the server commits. Commit and inactive notifications then trigger resume and pause on separate audio engines. Cancellation or timeout keeps ownership on the source.](/blog/moving-playback-from-one-device-to-another/transfer-authority.svg)

[Open the transfer diagram at full size](/blog/moving-playback-from-one-device-to-another/transfer-authority.svg).

If the desktop rejected the incoming state, an accepted cancellation cleared the pending transfer
without assigning it ownership. The server also started a timeout task that slept for ten seconds,
then cleared the transfer if that transfer ID was still pending. The deadline was recorded in
state, but the ready handler did not compare it with the clock. The timeout task, rather than a
strict deadline check on every ready message, performed that cleanup.

### The phone can advance the version while the desktop prepares

Leaving the phone active meant it could still report position or status during preparation. Volume
updates were allowed too. Remote transport commands were rejected while a transfer was pending,
so another controller could not send a seek or pause through that route halfway through the handoff.
[Pending-state rules](https://github.com/thecrateapp/crate/blob/bef0448db7221c09374bae160df313c113092631/app/crate/api/connect_ws.py#L519-L537).

Those permitted updates could still change the state against which the desktop was preparing.
The shared `PlayerState` held the active instance, queue and playback fields, with a version that
increased on each accepted update. A client could provide the version it expected to modify. The repository
rejected an outdated expectation instead of applying the update over newer state.

The readiness reply used the incoming transfer's version, not an older version the desktop happened
to hold before receiving it. The regression test sends an incoming state at version 8 and checks
that the reply carries 8. That fixes one source of stale readiness. It does not freeze the source
player while the desktop is working.
[Readiness-version regression](https://github.com/thecrateapp/crate/blob/bef0448db7221c09374bae160df313c113092631/app/listen/src/hooks/use-crate-connect-ws.test.tsx#L332-L365).

For example, if the phone's position update advances the shared version before that reply arrives,
the desktop's expected version no longer matches. The server rejects the ready update as stale;
it has not learned that the desktop failed to load or play audio.

Redis's optimistic transaction protects the interval between reading and writing the shared state:

```python source="app/crate/db/repositories/connect_state.py#L238-L255" commit="bef0448db7221c09374bae160df313c113092631" "expected_version" "pipe.watch(key)"
    with redis_client.pipeline() as pipe:
        while True:
            try:
                pipe.watch(key)
                current = _loads(pipe.get(key)) or base_state or {}
                if (
                    expected_version is not None
                    and int(current.get("version") or 0) != expected_version
                ):
                    pipe.unwatch()
                    raise ConnectStaleState("PlayerState version is stale")
                next_state = _merge_state(current, updates)
                pipe.multi()
                pipe.setex(key, PLAYER_STATE_TTL_SECONDS, _json(next_state))
                pipe.execute()
                return next_state
            except WatchError:
                continue
```

There are two different conflicts here. If another writer changes the watched Redis key before
`EXEC`, Redis aborts the transaction and the loop reads again. If the stored player version no
longer matches the client's `expected_version`, the repository raises `ConnectStaleState`. Retrying
a Redis transaction cannot make that old client expectation current.
[Redis optimistic locking](https://redis.io/docs/latest/develop/using-commands/transactions/#optimistic-locking-using-check-and-set).

Accepted updates incremented the version and were broadcast back to the sender as well as the other
players. Without that echo, the sender would base its next versioned update on the value it had just
replaced. Tests cover version increments, rejection of a stale version and the sender receiving the
new value. Some claim and remote-control messages deliberately supplied `null`, so they did not
require a match with an expected version. Accepted state updates still incremented the stored
version; omitting the expectation only skipped that comparison.
[Version handling and echo tests](https://github.com/thecrateapp/crate/blob/bef0448db7221c09374bae160df313c113092631/app/tests/test_connect_ws_v2.py#L139-L306).

## The desktop owns playback but has not started

After commit, the phone receives its pause instruction and the desktop calls resume. A browser can
still reject programmatic playback without the required user interaction. Receiving a WebSocket
message does not count as that interaction. Both media elements and Web Audio can be subject to
autoplay restrictions.
[Browser autoplay restrictions](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay).

This was the tradeoff introduced by preparing the v2 target without autoplay. We could accept its
queue before it played, but we then needed to detect a committed transfer that made no progress.
Listen scheduled a guard after the resume attempt. After 2.5 seconds, it checked whether the player
reported playing and its position had advanced by more than a quarter of a second:

```typescript source="app/listen/src/contexts/PlayerContext.tsx#L418-L426" commit="bef0448db7221c09374bae160df313c113092631" "advancedEnough" "requireUserGestureToResume"
  const scheduleConnectTransferPlaybackGuard = useCallback(() => {
    clearConnectTransferPlaybackGuard();
    const startedAtSeconds = currentTimeRef.current;
    connectTransferPlaybackGuardRef.current = window.setTimeout(() => {
      connectTransferPlaybackGuardRef.current = null;
      const advancedEnough = currentTimeRef.current > startedAtSeconds + 0.25;
      if (isPlayingRef.current && advancedEnough) return;
      requireUserGestureToResume();
    }, 2500);
```

If either condition failed, Listen asked for a user gesture to resume. Ownership stayed on the
desktop. The guard did not reclaim the session for the phone or undo the transfer. A target that
could not prepare its queue and a target that owned the session but could not start required
different recovery actions.

The phone could now act as a controller. A seek or pause request went to the active instance, which
executed it through its local engine and reported the resulting state. Queue and position updates
were restricted to that instance; volume had a separate exception in the state-update handler.
[Remote commands and state ownership](https://github.com/thecrateapp/crate/blob/bef0448db7221c09374bae160df313c113092631/app/crate/api/connect_ws.py#L275-L335).

Its progress bar also needed to move between messages. The active instance published periodic
snapshots. The remote player bar projected forward from `position_ms` and `position_updated_at`,
using an estimate of the server's clock offset. It stopped extrapolating a paused state and clamped
the result to the known duration.
[Remote progress projection](https://github.com/thecrateapp/crate/blob/bef0448db7221c09374bae160df313c113092631/app/listen/src/components/player/PlayerBar.tsx#L297-L320).

That was a display calculation. It did not compensate for output latency or correct drift between
audio clocks. The desktop loaded the supplied position, then the two machines handled their resume
and pause messages separately. Neither the version tests nor the transfer acknowledgement test
measured the audible gap between physical devices. Connect moved a listening session and its
control authority; synchronized group listening would need additional work at the audio layer.

## What survives losing the connection

The shared state also needed somewhere to live after a socket closed. Redis held the current
versioned state, with PostgreSQL flushes on pause, stop and transfer commit. When the cache was
absent, the repository could load the last persisted session. Those writes did not journal every
message or save the pending-transfer fields. Restoring an older snapshot could also restore an
older version; the version increment alone did not guarantee monotonicity across that recovery.

The repository had a process-local fallback when Redis was unavailable. Separate API processes
would not share that in-memory state or the Redis fan-out. A player reachable through one process
could therefore no longer rely on the same distributed coordinator as a player connected to
another. The timeout task was also local to the process that started it.
[State storage and fallback](https://github.com/thecrateapp/crate/blob/bef0448db7221c09374bae160df313c113092631/app/crate/db/repositories/connect_state.py#L70-L139),
[persistence after updates](https://github.com/thecrateapp/crate/blob/bef0448db7221c09374bae160df313c113092631/app/crate/api/connect_ws.py#L275-L298).

Connect remains explicitly gated in the client. The build flag must be enabled, then the user's
preference enables the feature; that preference starts disabled. Enabled clients use v2. The v1
implementation remains in the code, but a failed WebSocket connection does not automatically switch
the player to the older protocol.
[Release feature gate](https://github.com/thecrateapp/crate/commit/e6596a6668843e38feb611c6a1322f2578b568f1),
[current transport selection](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/contexts/use-player-connect-state.ts#L67-L71).

The desktop no longer needs to start a separate queue when the listener moves over from the phone.
It can take the existing session, and the phone can control the new owner. If the desktop still
needs a click to start audio, Listen keeps that recovery on the device that now owns playback.
