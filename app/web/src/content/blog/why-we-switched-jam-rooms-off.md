---
title: "Why we switched Jam Rooms off"
description: "A room could agree on the queue and still restart the song or play nothing. Jam Rooms exposed the gap between synchronizing state and synchronizing audio."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 20
related: [moving-playback-from-one-device-to-another, taking-playback-over-from-navidrome, keeping-the-music-playing-on-android]
tags: [How to dismantle Spotify, playback, realtime, reliability, history]
sources:
  - docs/technical/jam-rooms-status.md
  - app/listen/src/app-shell/feature-flags.ts
  - app/listen/src/app-shell/route-table.tsx
  - app/listen/src/hooks/use-jam-websocket.ts
  - app/listen/src/contexts/use-jam-queue-session.ts
  - app/crate/api/jam.py
  - app/tests/test_jam_sync.py
---

_Part 20. Shared listening, playback races and the decision to hide Jam Rooms, August 2026._

A room could show the right song, the right queue and a playing indicator while producing no audio.
Sometimes an interaction restarted the first second of the track. Sometimes the music played but
the spectrum stayed empty. Those are particularly bad failures for a feature whose whole purpose
is to let people listen together.

Jam Rooms already had much of what a shared listening session needed: a host, members, a room
queue, votes, genre filters, presence, automatic selection and coordinated playback. We had also
added tests for several of the races we found. In August, we hid the feature from Listen anyway.
The remaining failures crossed too many boundaries to treat a passing local test as a reason to
leave the entry point available.

This chapter follows one of those boundaries: how a room snapshot and a live clock reached the
same player, and why applying both could make the result worse. The before and after is a feature
we could enter, followed by a disabled feature with a clearer set of requirements for coming back.
[The Jam Rooms status and reactivation criteria](https://github.com/thecrateapp/crate/blob/cc6ba118e414a0898931bd28d0c7389bed7bbd65/docs/technical/jam-rooms-status.md)

## A room takes over an existing player

Listen already owned a local queue. It knew the current track, shuffle and repeat settings, the
position and the source of the music. Joining a room meant lending that player to another queue
without losing what the listener had been doing before.

We captured the local queue on entry and locked local queue editing while the room was in charge.
Leaving restored the captured state. The room's queue was authoritative; the queue in
`PlayerContext` was its local projection. If a member could independently shuffle, remove or insert
tracks through ordinary player controls, the room and that member would stop describing the same
session. [Queue capture, ownership and restoration](https://github.com/thecrateapp/crate/blob/cc6ba118e414a0898931bd28d0c7389bed7bbd65/app/listen/src/contexts/PlayerContext.tsx#L1785-L1854)

That gives us two distinct responsibilities. The room owns the order and transport decisions.
Each device still has to load media, decode it and produce sound. A room message can request a
position. It cannot make an unfinished media load complete, resume a suspended audio context or
prove that the speakers are producing the expected samples.

It helps to compare this with a system built around distributing one audio stream. Snapcast's
server sends encoded, timestamped audio chunks; clients buffer them and schedule output against
the server's clock. Its clients also correct timing deviations. Jam instead coordinated separate
players loading tracks from Crate. We were sending room state and playback instructions, not a
common stream of timestamped PCM chunks. That left more of the startup and correction problem
inside each player. [Snapcast's architecture](https://github.com/snapcast/snapcast#how-does-it-work).

## Two messages, one startup race

On connection, the backend sent a `state_sync` message containing the room: members, queue, events
and the persisted current-track payload. It then sent `sync_clock`, with a position projected from
the live playback clock. A heartbeat continued to report that clock while the room was playing.
[Room snapshot, clock and heartbeat](https://github.com/thecrateapp/crate/blob/cc6ba118e414a0898931bd28d0c7389bed7bbd65/app/crate/api/jam.py#L957-L998)

The two messages answered different questions. The snapshot told a joining client what belonged
to the room. The clock told it where playback should be now. The persisted position in the room
snapshot could be older than the live clock.

Starting an asynchronous media load from the snapshot created a race:

1. `state_sync` started loading the room queue at the stored position.
2. `sync_clock` arrived and sought the player to the newer position.
3. The earlier load completed and installed its stale position over the correction.

WebSocket message ordering did not prevent this. The messages arrived in order; the asynchronous
work they started completed later. A seek could also reach the old engine before the new track had
finished loading.

![The startup race lets a snapshot-triggered load overwrite a newer clock position. The revised flow stores the room queue, waits for the clock, and then applies both to the player.](/blog/why-we-switched-jam-rooms-off/room-clock-race.svg)

[Open the startup diagram at full size](/blog/why-we-switched-jam-rooms-off/room-clock-race.svg).

We changed the initial flow to retain the room queue and wait for its clock when a current track
existed. The first clock message then supplied the track, position and playing state for
`syncJamQueue()`. Empty rooms still handed an empty authoritative queue to the player, so joining
one entered Jam mode rather than leaving the previous local queue in charge. [Applying the first authoritative clock](https://github.com/thecrateapp/crate/blob/cc6ba118e414a0898931bd28d0c7389bed7bbd65/app/listen/src/hooks/use-jam-websocket.ts#L392-L479)

There was a second mistake in this boundary. Pausing ordinary local playback while joining a room
made sense. Doing the same thing when the player was already playing that room interrupted the
very playback we were trying to synchronize. The guard distinguished a `Jam:` queue source:

```typescript source="app/listen/src/hooks/use-jam-websocket.ts#L458-L467" commit="cc6ba118e414a0898931bd28d0c7389bed7bbd65" "isJamPlaybackSource"
            awaitingInitialClockRef.current = roomHasCurrentTrack;
            if (roomHasCurrentTrack) {
              if (
                playerActionsRef.current.isPlaying &&
                !isJamPlaybackSource(playerActionsRef.current.playSource)
              ) {
                playerActionsRef.current.pause();
              }
              return;
            }
```

The guard was deliberately narrow. It protected an already-owned Jam session; it did not remove
the need to stop unrelated local playback on entry. A hook test constructed a playing `Jam: Test`
source, delivered `state_sync` and asserted that `pause()` was never called. [The repeated state-sync regression test](https://github.com/thecrateapp/crate/blob/cc6ba118e414a0898931bd28d0c7389bed7bbd65/app/listen/src/hooks/use-jam-websocket.test.tsx#L487-L548)

## A position needs a timestamp

A position sent over the network ages before it arrives. If the server says 20 seconds and the
message spends time in transit, seeking to exactly 20 seconds puts the receiver behind the
server's intended position.

The server included the timestamp used to calculate the position in the same payload:

```python source="app/crate/api/jam.py#L286-L302" commit="cc6ba118e414a0898931bd28d0c7389bed7bbd65" "server_time_ms"
def _build_sync_clock_payload(
    clock: dict, *, now_ms: float | None = None, force_sync: bool = False
) -> dict:
    """Build a sync message with the timestamp used for its position."""
    server_time_ms = (
        now_ms if now_ms is not None else datetime.now(timezone.utc).timestamp() * 1000
    )
    payload = {
        "type": "sync_clock",
        "track": clock.get("track"),
        "position_ms": _clock_position_at(clock, server_time_ms),
        "playing": clock.get("playing"),
        "server_time_ms": server_time_ms,
    }
    if force_sync:
        payload["force_sync"] = True
    return payload
```

The client estimated its offset from the server using ping/pong messages. It took the midpoint of
the client send and receive times, compared that with the server timestamp and smoothed later
samples. It rejected negative round trips and samples longer than five seconds. [Clock offset estimation](https://github.com/thecrateapp/crate/blob/cc6ba118e414a0898931bd28d0c7389bed7bbd65/app/listen/src/hooks/use-jam-websocket.ts#L362-L379)

Using that estimate, a playing clock advanced by the elapsed time between the timestamp and local
receipt. A paused clock retained its position. The projection clamped negative elapsed time to
zero:

```typescript source="app/listen/src/hooks/use-jam-websocket.ts#L58-L73" commit="cc6ba118e414a0898931bd28d0c7389bed7bbd65" "Math.max"
export function projectJamClockPosition({
  positionMs,
  serverTimeMs,
  clientNowMs,
  clockOffsetMs,
  playing,
}: {
  positionMs: number;
  serverTimeMs?: number;
  clientNowMs: number;
  clockOffsetMs: number;
  playing: boolean;
}) {
  if (!playing || typeof serverTimeMs !== "number") return positionMs;
  return positionMs + Math.max(0, clientNowMs + clockOffsetMs - serverTimeMs);
}
```

The midpoint estimate assumes that the round trip is reasonably balanced. It does not measure
one-way network delay. More importantly, the resulting number is a target media position, not a
measurement of audible output. Decoder buffers, device latency and the audio context still sit
between a position update and a sound.

The browser itself distinguishes those clocks. `AudioContext.getOutputTimestamp()` relates a
frame being rendered by the output device to the context and performance time coordinates. The
Jam calculation above used message timestamps and player position; it did not establish that
output-level relationship across devices.
[The browser's output timestamp contract](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp).

That distinction matters when testing. Two state objects can agree to the millisecond while two
speakers still produce an audible echo.

## Correct drift without restarting the song

Once a track was running, seeking on every small discrepancy could be more disruptive than the
discrepancy itself. A position read from the media element can lag behind a previous correction.
Treating it as a fresh error at every heartbeat risks a repeated-seek loop.

For the same track, the client calculated signed drift. Small corrections used a bounded playback
rate adjustment when the player was already running. The rate stayed between 0.95 and 1.05:

```typescript source="app/listen/src/hooks/use-jam-websocket.ts#L179-L198" commit="cc6ba118e414a0898931bd28d0c7389bed7bbd65" "setPlaybackRate"
        if (
          setPlaybackRate &&
          playing &&
          localIsPlaying &&
          drift >= 35 &&
          !hardCorrection
        ) {
          // Close normal clock drift without repeatedly seeking the media
          // element. A short, bounded rate adjustment avoids the audible
          // restart/echo caused by hard-seeking on every room interaction.
          const correction = Math.max(
            0.95,
            Math.min(1.05, 1 + signedDriftSeconds * 0.2),
          );
          setPlaybackRate(correction);
          jamRateCorrectionRef.current = correction !== 1;
        } else if (setPlaybackRate && jamRateCorrectionRef.current) {
          setPlaybackRate(1);
          jamRateCorrectionRef.current = false;
        }
```

At a target 120 milliseconds ahead of the local position, this formula requested a rate of 1.024.
The regression test checked that value and also checked that the client did not call play, resume
or seek. It tested a particular decision at the player boundary, without rendering any audio.
[Small-drift correction test](https://github.com/thecrateapp/crate/blob/cc6ba118e414a0898931bd28d0c7389bed7bbd65/app/listen/src/hooks/use-jam-websocket.test.tsx#L784-L839)

Larger discrepancies used a hard seek. The ordinary threshold was 180 milliseconds, with a
1.5-second cooldown to avoid repeatedly seeking against a stale position report. An explicit
forced sync used a tighter five-millisecond tolerance and could bypass that cooldown. These were
the implementation's correction settings, not a demonstrated guarantee of perceptually aligned
playback. [Correction thresholds and cooldown](https://github.com/thecrateapp/crate/blob/cc6ba118e414a0898931bd28d0c7389bed7bbd65/app/listen/src/hooks/use-jam-websocket.ts#L75-L77); [hard-seek decision](https://github.com/thecrateapp/crate/blob/cc6ba118e414a0898931bd28d0c7389bed7bbd65/app/listen/src/hooks/use-jam-websocket.ts#L156-L178).

Loading a different track needed another guard. The initial clock and a subsequent heartbeat could
arrive while the first queue load was still pending. The client remembered the pending track's
identity and suppressed another request for the same identity within 2.5 seconds. Otherwise a
perfectly valid heartbeat could restart a track that had not finished starting. [Pending track suppression](https://github.com/thecrateapp/crate/blob/cc6ba118e414a0898931bd28d0c7389bed7bbd65/app/listen/src/hooks/use-jam-websocket.ts#L211-L227)

These changes addressed specific failures. They also show why a room is more than a queue plus a
WebSocket. A message handler needs to know whether it is updating queue metadata, selecting a new
track, correcting the current track or repeating information already in flight. Sending all four
through a full player reload is an easy way to turn a vote or a reconnect into an audible restart.

## What the fixes still did not establish

By the time we disabled Jam, tests covered waiting for the first clock, avoiding the extra pause,
small-drift correction, pending-track suppression and stale room events. That was useful coverage.
It did not resolve the full interaction between room state, `PlayerContext`, media loading and the
audio graph. [Jam WebSocket regression cases](https://github.com/thecrateapp/crate/blob/cc6ba118e414a0898931bd28d0c7389bed7bbd65/app/listen/src/hooks/use-jam-websocket.test.tsx)

The remaining problems were concrete. Startup could still leave the interface playing without
sound, keep the spinner active or lose the analyser connection. Room interactions could rehydrate
the engine and restart playback. Analyser attachment needed to work on the first track and through
next/previous transitions. Presence needed a multiuser reconnect and cleanup matrix. Auto DJ still
needed work on refill, duplicates, artist diversity and continuity. [The Jam Rooms status and reactivation criteria](https://github.com/thecrateapp/crate/blob/cc6ba118e414a0898931bd28d0c7389bed7bbd65/docs/technical/jam-rooms-status.md)

A mocked `seek()` call cannot tell us whether two devices sound synchronized. A mocked queue
loader cannot prove that entering and leaving a room preserves an actual decoding session. The
missing acceptance work had to exercise multiple sessions and real playback, including the
failures caused by ordinary interaction while music was running.

There was useful engine work to keep. Promoting normal desktop playback from HTML5 to Web Audio
improved the normal playback path and spectrum attachment. The Jam-specific pause guard protected
that work without pretending the whole shared-listening feature was ready.

## What changed for listeners

We put the Listen entry points behind a release gate:

```typescript source="app/listen/src/app-shell/feature-flags.ts#L1-L2" commit="cc6ba118e414a0898931bd28d0c7389bed7bbd65" "false"
/** Temporary release gates for Listen-only features. */
export const JAM_ROOMS_ENABLED = false;
```

The menu, People and Settings stopped exposing Jam. The room and invite routes redirected to Home.
We retained the backend and protocol contracts for further work, so this was a client product gate,
not a claim that every Jam API had been removed or disabled. [Gated Listen routes](https://github.com/thecrateapp/crate/blob/cc6ba118e414a0898931bd28d0c7389bed7bbd65/app/listen/src/app-shell/route-table.tsx#L140-L157)

Before that change, a listener could enter a feature whose UI implied a dependable shared session
while its playback could stall or restart. Afterwards, Listen no longer offered that path. We
kept the implementation, regression tests and a written set of reactivation criteria.

Those criteria require deterministic lifecycle tests, consistent room and player queues, clean
presence after disconnects, and at least two sessions playing without perceptible echo or restarts
during interaction. They also require analyser attachment through track transitions and desktop
and mobile smoke tests. Removing the flag is a separate, explicit step after that work.

The [gate remains off in the current code](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/listen/src/app-shell/feature-flags.ts#L1-L2). Jam Rooms belongs in Crate's history because it changed
what we needed to prove about playback. It does not belong in the list of finished listening
features yet.
