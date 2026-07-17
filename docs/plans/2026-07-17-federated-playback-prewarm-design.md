# Federated Playback Prewarm Design

Date: 2026-07-17

Status: approved for implementation

## Summary

Crate already selects a concrete delivery policy in Listen, prepares a small
window of local queue tracks, gives an active transcode interactive priority,
and falls back to the original source while a variant is still being built.
What is missing is the equivalent preparation at the owner of a remote track.

This design adds a bounded, signed node-to-node preparation request. When a
user starts playback or advances the queue, their home node asks the owner of
at most the next two remote tracks to prepare the selected concrete delivery
variant. The request is advisory: it never creates a stream ticket, returns a
stream URL, or delays playback. A later normal playback request remains the
only operation that issues a reusable stream session and transfers bytes.

The normal web `pause -> play` path remains buffer-preserving. Gapless5 stops
loaded sources without unloading them and resumes the same source. Player
reconstruction is retained only for an invalid audio context or a known stale
native output. This iteration makes those guarantees explicit in regression
tests rather than adding a second browser media cache.

## Goals

- Make the next remote tracks more likely to have a `balanced` or `data_saver`
  variant ready before the user reaches them.
- Preserve immediate playback: preparation always runs out of band and an
  unavailable or slow peer cannot delay the current track.
- Reuse the existing federation signature, user assertion, grant, entity
  allowlist, URL policy, transcode cache and resource-governor primitives.
- Bound owner-side CPU, disk and queue pressure per peer and globally.
- Preserve singleton behaviour: a node without peers follows the existing
  local preparation path and makes no federation request.
- Codify that ordinary web pause/resume does not rebuild the queue or fetch a
  new source.

## Non-goals

- No transparent media replication or persistent remote-media cache on the
  consuming node.
- No full-library or catalogue-wide transcoding.
- No browser-to-peer request, peer credential, stream URL, ticket, filesystem
  path or raw user identity exposed to Listen.
- No stream session, byte-quota reservation or daily-stream-byte charge during
  preparation.
- No new standalone/federated mode switch. Limits are operational safeguards,
  not a product feature gate.

## Decisions

| Area | Decision |
| --- | --- |
| Queue horizon | At most the next two remote tracks after the current cursor. |
| Delivery policy | Listen resolves `auto` locally and sends only `balanced` or `data_saver`; `original` is a no-op. |
| Transport | Listen calls its own authenticated `/api/playback/prepare`; that API relays remote work through the existing signed federation client. |
| Owner authorization | Valid node signature, signed user assertion with purpose `stream.prepare`, existing `federation.stream.play` grant, matching delivery grant and entity allowlist. |
| Owner response | Per requested entity: `ready`, `preparing`, `unavailable` or `rate_limited`; no URL, ticket, source path, task ID or cache key. |
| Per-peer work limit | Four live preparation reservations per peer. |
| Node-wide work limit | Twenty live preparation reservations per owner node. |
| Priority | Active playback variants keep priority `0`; lookahead/prewarm remains lower priority and resource-governed. |
| Fallback | Normal playback serves the ready variant when present, otherwise the existing original-source fallback. |
| Observability | Aggregate counters by origin and policy only; never user IDs, global IDs, entity IDs, paths, URLs or tokens. |

## Architecture

```mermaid
sequenceDiagram
    participant L as Listen
    participant C as consuming Crate node
    participant O as owner Crate node
    participant W as owner playback worker

    L->>C: POST /api/playback/prepare (queue references, concrete policy)
    C->>C: resolve local versus remote ownership
    C->>O: signed POST /api/federation/v1/playback/prepare + user assertion
    O->>O: verify node, assertion, grant, entity policy and bounded reservation
    O->>W: enqueue/dedupe low-priority variant preparation
    O-->>C: ready | preparing | unavailable | rate_limited
    C-->>L: local preparation result; never a peer URL

    L->>C: normal playback resolution later
    C->>O: signed stream-ticket request
    O-->>C: reusable stream session
    C-->>L: local proxy URL; ready variant or original fallback
```

The owner owns every mutable resource: transcode-cache metadata and files,
worker queueing, disk headroom and peer reservations. The consumer only makes
an authenticated request based on the queue it is already allowed to play.

## Protocol and authorization

Add `POST /api/federation/v1/playback/prepare`. Its request body is bounded to
two owner-local entity UIDs and one concrete policy:

```json
{
  "requesting_node_uid": "<signed peer node UUID>",
  "delivery_policy": "balanced",
  "remote_entity_uids": ["<owner track entity UUID>"]
}
```

The raw body is covered by the existing Ed25519 request signature and nonce
replay guard. The `X-Crate-User-Assertion` is verified with audience equal to
the owner node and purpose `stream.prepare`; it requires the same user
capability as a playback ticket. The owner uses the existing authorization
decision to enforce the peer grant, delivery policy and track allowlist.

An invalid signature, missing/invalid assertion, or absent grant is an HTTP
authorization failure. A well-authenticated request for an unavailable or
not-allowed entity returns `unavailable` as an item result, so the endpoint
does not become a catalogue oracle. The endpoint must not call
`create_ticket`, persist a stream session, or return any stream material.

## Bounded work and lifecycle

Preparation first resolves an existing variant. `ready` is returned without
using a reservation. For work that may enqueue a variant, the owner uses a
Redis Lua reservation across a peer ZSET and a global ZSET. Both prune expired
entries and are checked atomically; the request is accepted only when the peer
has fewer than four reservations and the node fewer than twenty. Reservation
identity is the deduplicated variant cache key, has a bounded TTL aligned with
the transcode task timeout, and is released early when the task reaches a
terminal state where practical. Expiry is a safe fallback after worker loss.

The existing cache-key task dedupe remains authoritative: identical requests
share one variant build and do not enqueue duplicate work. The active stream
path retains priority `0`; a preparation is `lookahead` priority and therefore
cannot starve interactive playback. Existing disk headroom and resource
governor decisions continue to apply. A rate-limited or resource-governed
request is best effort and does not retry synchronously from the browser.

## Client behaviour

`preparePlaybackDelivery` continues to prepare the current local window. It
additionally selects no more than two remote tracks after the cursor and sends
only global track references to the local API. The local API resolves the
owner-side entity UID from the global catalogue and relays the signed request.
Listen never receives the owner entity UID, peer URL, internal response body or
task state. Queue changes simply replace the bounded set; abandoned low
priority work can finish harmlessly and be reused by a later play.

## Pause/resume invariant

On web, `pause()` delegates to Gapless5 `pause()`, which calls
`stopAllTracks()` without `unload()` or position reset. The loaded HTML audio
element or decoded WebAudio buffer remains available; `play()` resumes the
current source. The tests must prove that this path does not call `loadQueue`,
`removeAllTracks`, or fire a new `onloadstart` for an unchanged current URL.

Tauri and Android can explicitly rebuild after a closed/stale native audio
context, auth recovery or native watchdog event. Those paths are not described
as buffer reuse; they must reconstruct once, retain queue/index/position, and
emit recovery QoE rather than masquerading as an ordinary pause/resume.

## Metrics, rollout and rollback

Record aggregate metrics:

- `federation.playback.prepare.requested`
- `federation.playback.prepare.ready`
- `federation.playback.prepare.preparing`
- `federation.playback.prepare.unavailable`
- `federation.playback.prepare.rate_limited`
- `federation.playback.prepare.ready_before_play`
- `federation.playback.prepare.fallback_original`

Permitted labels are owner/consumer perspective (`local` or `remote`) and
requested/effective delivery policy. Metric events must not carry catalogue or
user identity.

Roll out with defaults of four per peer and twenty per node, first against the
two-node development harness, then a controlled peer canary. Rollback is
immediate and local to the owner: deny `stream.prepare` requests or set the
operational reservation limit to zero while normal stream tickets remain
unaffected. No cache deletion, migration rollback or client redeploy is needed.

## Acceptance criteria

- A remote queue prepares no more than two future remote tracks.
- A valid peer can prepare an allowed, transcoded owner track; the normal
  subsequent playback receives the ready variant when the worker has completed.
- A slow, denied, rate-limited or unavailable preparation never delays or
  breaks current playback; normal playback falls back to original exactly as it
  does today.
- Four live requests from one peer and twenty across peers are allowed; the
  next unique request is denied deterministically without queueing work.
- Replay, wrong node UID, wrong assertion purpose, missing delivery grant and
  entity-policy denial are rejected.
- A singleton node does not emit a federation preparation request.
- Normal web pause/play retains the same queue and source without a new load;
  native recovery rebuilds only under its explicit recovery conditions.
