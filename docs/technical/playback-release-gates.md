# Playback resilience release gates

This document is the deployment contract for Listen playback. It applies to a
single-node instance and to federation: a local global-catalog track must not
regress merely because it has a global identifier.

## Required invariants

- A remote **reusable playback session** serves the initial request, a later
  Range request, a seek/recovery Range and pause/resume until its fixed expiry.
  Revocation, expiry, a changed grant revision, user mismatch or an invalid
  range denies the next request.
- Starting a queue resolves only its active track before loading the engine.
  Exactly one eligible next global track may be resolved after active playback
  begins; results from an old queue or active index are discarded.
- A local track with a global UID remains eligible for `balanced` and
  `data_saver` preparation. Interactive preparation has priority over lookahead
  and warmup work.
- Manual pause/resume retains the queue and source. It neither reloads the
  queue nor performs a fresh catalog resolution when the current source is
  still usable.
- A source that has just changed may not inherit a decoded/full-buffer marker
  from a previous source. Stall recovery uses actual buffered-ahead media and
  is capped before requesting a user gesture.
- `auto` resolves to a concrete policy before an API request. It changes only
  future tracks and never overrides an explicit `original`, `balanced` or
  `data_saver` selection.

## Measurement and privacy

Release measurements record `first_play_ms`, stall count/duration, recovery
count, requested/effective policy and local/remote/imported origin. Telemetry
contains no raw URLs, tokens, track IDs, global IDs, titles, paths, peer URLs,
IP addresses, RTT or downlink values. The client batches at most 24 events per
playback session and the server applies a short-lived per-user rate limit.

The required harness profiles are unrestricted, **5 Mbps / 150 ms**, and a
temporary loss/reconnect drill. Record source format, cache state and
first-byte timing as artifacts; do not commit live URLs or credentials.

## Controlled warmup

Warmup is disabled by default. An operator must set
`CRATE_PLAYBACK_WARMUP_ENABLED=true` and use
`POST /api/admin/playback-delivery/warmup` with bounded track, byte and time
budgets. It selects recently played local tracks only, queues lookahead-priority
work, stops on cancellation and respects the resource governor.

Keep `CRATE_STREAM_TRANSCODE_MAX_CONCURRENT=1` for the first rollout. Before
enabling warmup confirm free disk headroom (default 20 GiB, configurable by
`CRATE_PLAYBACK_WARMUP_MIN_FREE_GB`), then observe CPU, iowait and active
streams. To contain pressure, disable warmup; existing cached variants are
safe and do not need deletion during an incident.

## Deployment and rollback

1. Back up PostgreSQL and deploy API, readplane and playback worker support for
   reusable sessions before the Listen client.
2. Smoke-test two valid ranges and a revoked grant against a real peer.
3. Roll out queue-start and buffer fixes, then observe one release window.
4. Expose Auto as an opt-in preference only after playback SLOs are healthy.
5. Enable bounded warmup only after the host has sustained disk and CPU
   headroom.

Rollback is scoped: hide Auto for a client-policy regression; disable warmup
for worker pressure; revoke the affected peer stream grant for remote-range
failures. Do not reintroduce one-shot tickets, delete cache during an incident,
or turn a local single-node failure into a federation-wide outage.
