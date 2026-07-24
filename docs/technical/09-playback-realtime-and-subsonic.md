---
title: Playback, realtime and Subsonic
summary: Playback surfaces, resilience gates, realtime and compatibility contracts.
section: architecture
audience: [developer, operator]
status: canonical
order: 98
verified: 2026-07-21
sources:
  [app/listen, app/readplane, app/crate/api, app/crate/federation, Makefile]
---

# Playback, Realtime, and Subsonic

## Listen playback architecture

Playback is a defining subsystem of `app/listen`, not a peripheral utility.

The central public coordinator is still
`app/listen/src/contexts/PlayerContext.tsx`, but it is no longer the only place
where player logic lives.

The player is built around these ideas:

- one queue model owned by React
- one real audio engine
- explicit playback persistence
- explicit interruption/recovery logic
- rich play-event telemetry rather than the old lightweight history writes

## Audio engine

The active engine wrapper is `app/listen/src/lib/gapless-player.ts`, wrapping
the vendored Gapless-5 fork in `app/listen/src/lib/gapless5/`.

Responsibilities include:

- initialize the engine once
- manage queue loading and current-track handoff
- configure crossfade
- expose time/duration/buffering state
- expose analyser/output-chain hooks for visualizer and EQ
- support fade helpers and engine sync with React state

## Playback prepare and transcoding

Playback preparation is not executed by the general worker in production.
`crate-playback-worker` owns the `playback` queue and runs with separate native
thread/ffmpeg limits so stream preparation cannot starve the normal task pool.

Key knobs:

- `STREAM_TRANSCODE_MAX_CONCURRENT` controls
  `CRATE_STREAM_TRANSCODE_MAX_CONCURRENT` inside the playback worker.
- `PLAYBACK_NATIVE_THREADS` caps BLAS/Numba/Torch-style native thread pools.
- `PLAYBACK_FFMPEG_THREADS` caps ffmpeg worker threads.

The API still serves the HTTP playback/stream contract, but expensive
preparation/transcode work is admitted through that dedicated queue.

## PlayerContext today

`PlayerContext.tsx` still exports the public player contract used by the rest of
Listen, but much of the implementation has moved into focused hooks.

Important internal concerns now include:

- runtime state
- engine callbacks
- engine/React synchronization
- queue mutation and navigation
- persistence/restore
- playback intelligence
- auth/user-change synchronization
- soft interruption recovery
- play-event tracking

That means the architectural direction is now “provider as orchestrator” rather
than “one file owns every playback branch directly”.

## Playback persistence and recovery

Listen persists enough state to continue a session after reload:

- queue
- current index
- current time
- playing flag
- shuffle/repeat state
- unshuffled baseline queue

It also distinguishes:

- explicit user pause
- soft interruption due to buffering/network/server conditions

The recovery logic probes and resumes instead of hard-resetting playback where
possible.

## Equalizer and visualizer

Listen still ships:

- a 10-band equalizer
- adaptive/genre-aware EQ behavior
- a visualizer fed from the engine's analyser node

Those features sit on top of the same engine/runtime split rather than being
page-local UI tricks.

## Listening telemetry

The most important current change is telemetry.

### Canonical write path

Listen now records playback through:

- `POST /api/me/play-events`

The client emits:

- timing window (`started_at`, `ended_at`)
- `played_seconds`
- completion/skip semantics
- playback source metadata
- device/app metadata
- optional `client_event_id` for idempotent retry

`use-play-event-tracker.ts` owns session rotation and event emission, while
`play-event-queue.ts` persists failed writes locally and retries them with
backoff.

### Canonical backend truth

On the server:

- `user_play_events` is the source of truth
- `client_event_id` is unique per user when present
- stats recompute is queued asynchronously
- scrobbling is queued asynchronously after commit
- domain events such as `user.play_event.recorded` and
  `user.listening_aggregates.updated` drive snapshot warming

The old `/api/me/history` path is now deprecated compatibility only.

## Playback resilience release gates

A remote reusable playback session must authorize the initial request and
later Range/seek recovery until expiry. Revocation, changed grant revision,
user mismatch or an invalid range denies the next request. The browser never
receives a peer URL, ticket, local path or cache key.

Queue start resolves only the active track. At most two remote tracks may be
included in preparation; active playback always outranks lookahead and
warmup. Owner preparation is bounded to four reservations per peer and twenty
reservations per owner. A denial or rate limit leaves normal ticketed playback
available through its original-source fallback.

Release telemetry is aggregate only. It must not contain raw URLs, tokens,
track IDs, titles, paths, peer URLs, IP addresses or network measurements.
Run the unrestricted, **5 Mbps / 150 ms**, and loss/reconnect profiles while
recording only fixture, cache state and timing evidence.

Warmup is disabled by default. An operator enables it with
`CRATE_PLAYBACK_WARMUP_ENABLED=true` only after confirming disk, CPU and
iowait headroom. Keep interactive transcoding ahead of warmup; disabling
warmup is the first containment action for worker pressure.

## Playback SLOs and rollback

| Signal                  | Objective                                     | Alert window           |
| ----------------------- | --------------------------------------------- | ---------------------- |
| startup p95             | local and remote first play at or below 2 s   | 15 minutes             |
| stall ratio             | below 2% of playback starts                   | 15 minutes and 6 hours |
| range retry             | remote authorization succeeds at 99.5%        | 15 minutes             |
| transcode queue wait    | interactive work starts within 30 seconds     | 15 minutes             |
| fallback-original ratio | below 10% after a warm cache                  | 15 minutes             |
| prepare saturation      | below 5% unavailable or rate-limited requests | 15 minutes             |

Track `federation.playback.prepare.requested`, `.ready`, `.preparing`,
`.unavailable`, `.rate_limited`, `ready_before_play` and
`fallback_original` only as bounded aggregate counters. A regression rolls
back by hiding Auto, disabling warmup or setting the affected owner's
preparation ceiling to zero; it does not reintroduce one-shot tickets or
delete cache during an incident. See the [playback preparation incident
runbook](federation-operations-runbook.md#playback-preparation-incident).

## Realtime surfaces

Crate uses several realtime mechanisms:

### Classic SSE feeds

- `/api/events`
- `/api/events/task/{task_id}`

### Replayable invalidation feed

- `/api/cache/events`

This feed supports `Last-Event-ID` replay and is used by authenticated clients
to invalidate local caches. Live updates arrive through Redis pub/sub and the
replay window comes from the bounded Redis invalidation log.

When `crate-readplane` is enabled, Listen can consume selected replay/SSE read
surfaces from the Go read plane, reducing persistent connection pressure on the
FastAPI process while preserving FastAPI fallback.

### Snapshot-driven feeds

- `/api/me/home/discovery-stream`
- admin snapshot/event streams

These exist because complex UI surfaces are now built on warmed snapshots/read
models rather than ad hoc polling everywhere.

## Subsonic compatibility

`app/crate/api/subsonic.py` exposes the parallel Open Subsonic-compatible API
under `/rest`.

This lets Crate serve external clients while still keeping Listen's richer
native API and playback model.
