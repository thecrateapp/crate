# Crate federation protocol v1

Crate is always a federated node. With no approved peers, the global catalog contains only the local source and all user-facing contracts remain identical to a one-node network. Federation adds approved sources; it does not introduce a standalone mode or a second API.

## Versioning and discovery

`GET /.well-known/crate-node` returns a signed `NodeDescriptorV1`. A descriptor contains the stable node UUID, API URL, supported protocol and signature versions, active and retiring public keys, implemented capabilities, signed taxonomy release, issue/expiry timestamps, digest, and signature.

Protocol negotiation selects the highest common entry in `federation_protocol_versions`. v1 peers reject unknown major versions with `incompatible_version`; optional fields may be added compatibly. A node must not infer support from its software version: it uses the signed capability list.

Descriptor URLs are untrusted input. Production accepts HTTPS only, performs fresh DNS resolution, rejects private/link-local/loopback/reserved addresses, pins the selected address for the connection, preserves the validated hostname for Host and TLS SNI, rejects redirects, and applies the same-origin rule to every embedded URL.

## Identity, signatures, and replay protection

Every node has one stable `node_uid` and one or more Ed25519 keys. Private keys are local control-plane material; only public keys appear in descriptors. Node requests use `crate-ed25519-v1` and sign the canonical sequence:

1. signature profile marker;
2. uppercase method;
3. path and query;
4. validated Host;
5. content type;
6. node and key IDs;
7. millisecond timestamp;
8. 128-bit nonce;
9. SHA-256 body digest;
10. signed-header registry.

The receiver verifies body digest, key lifecycle, timestamp window, signature, and nonce uniqueness before authorization. A repeated nonce is denied even when the signature is valid. Clock skew outside the documented window is a terminal request error, not a retry hint.

User-scoped operations carry a separate short-lived assertion signed by the requesting node. It binds issuer node, audience node, pseudonymous subject, purpose, capabilities, issued/expiry times, and JTI. Raw local user identifiers or email addresses never cross the node boundary.

## Pairing and trust

Pairing is bilateral and proves key possession:

1. an administrator starts an offer for a validated descriptor URL;
2. the receiver stores the request as pending and returns a signed acceptance challenge;
3. an administrator on each side approves the peer;
4. each side verifies descriptor, challenge, signature, and remote node identity;
5. the peer becomes `approved` with the least-privilege discovery preset.

Discovery, signed directories, or a valid descriptor may create a candidate, never an approved peer. Self-pairing, descriptor node changes, silent API URL changes, and key changes without the rotation protocol fail closed. Rejecting or disabling a peer revokes its grants, active local tickets, and future source selection.

## Grants and authorization

The node serving a resource is authoritative. It evaluates the signed requester, remote subject, requested operation, grant revision, capability, entity constraints, delivery policy, and quota. Presets are only templates; the persisted typed grant is the decision input.

Grant changes increment a policy revision. Tickets and long-running work capture that revision and are rejected or reconciled after a downgrade. Authorization denials are audited with bounded reason codes and no PII.

## Catalog synchronization

`GET /api/federation/v1/catalog/manifest` returns a bounded, signed snapshot page plus revision and cursor data. `GET /api/federation/v1/catalog/delta` returns ordered upsert/tombstone events after a durable cursor.

The consumer persists each page before advancing its checkpoint. Restarting repeats at most the last uncommitted page; idempotent upserts and tombstones make replay safe. A cursor older than retention returns the typed expired-cursor response and requires a full snapshot. Full sync and delta convergence must produce the same source rows and global catalog.

Remote rows retain source provenance and never become local library ownership. Canonical matching creates stable global artist/album/track UUIDs. Source selection prefers local, then healthy allowed remote sources; changing source never changes the public human route (`/artists/high-vis`, `/artists/high-vis/albums/guided-tour`).

## Global taxonomy

The global genre taxonomy is a signed, versioned release with digest and key ID. Catalog genre memberships reference canonical taxonomy nodes and retain source provenance. A consumer verifies release signature and digest before activating it. Local aliases and overlays may enrich presentation but cannot mutate the signed global release or silently remap a remote membership.

## Streaming

The consumer first requests a short-lived remote ticket using a signed user assertion. The owner validates the grant, delivery policy, concurrent-stream quota, byte reservation, subject isolation, and playback-session binding. The remote ticket is never returned to a browser.

The consumer creates an opaque local relay ticket. In production, Traefik sends that local URL to the Go readplane. FastAPI atomically binds it to the authenticated local user and returns 15-second signed request material; Go validates path, audience, pinned IP, Host/SNI, TTL, and header allowlists and relays with a fixed 64 KiB buffer. The owner still enforces the authoritative ticket, quota, revision, Range policy, and revocation.

Safe request headers are `Range`, `If-Range`, and `Accept`. Safe response headers are content type/length/range, ETag, last-modified, and cache control. Cookies, authorization, local paths, bearer tokens, raw remote URLs, and hop-by-hop headers never cross the proxy boundary.

### Bounded playback preparation

`POST /api/federation/v1/playback/prepare` is an advisory, signed owner request
for one or two owner-local track entity UIDs. It requires the same stream
grants and entity allowlist as a transcoded stream, plus a user assertion with
purpose `stream.prepare`. It does not create a ticket, playback session, stream
URL, byte reservation, or media transfer.

The owner reports only `ready`, `preparing`, `unavailable`, or `rate_limited`.
Ready variants consume no reservation. New speculative work has four live reservations per peer and twenty per owner, atomically tracked in Redis by
variant cache key. Active playback remains higher priority and serves the
original source when the prepared variant is not ready. Owners may lower
`CRATE_FEDERATION_PLAYBACK_PREPARE_MAX_PER_PEER` or
`CRATE_FEDERATION_PLAYBACK_PREPARE_MAX_GLOBAL` to `0` for immediate local
containment; normal stream tickets remain available.

## Imports

Import is an explicit, administrator-governed transition from a remote source to local ownership. A signed manifest describes album/track identities, relative paths, byte sizes, and SHA-256 hashes. The consumer validates grant and approval, reserves peer/global/disk capacity atomically, downloads only through pinned signed transport into a request-specific staging directory, verifies every hash and aggregate limit, and asks a worker to publish files.

API processes never write `/music`. Worker publication is idempotent and records provenance. Failure, cancellation, expiry, or digest mismatch releases reservations and cleans staging within the configured TTL; existing library files are never deleted automatically.

## User data and compatibility

Follows, saved albums, likes, playlist entries, history, play counts, and personalization use canonical global IDs while dual-reading legacy local references during upgrade. Remote-only references remain visible when a peer is unavailable. Remote scrobbling is an explicit per-user opt-in; local history is always recorded with content origin and source node provenance.

Open Subsonic keeps numeric legacy IDs for local content and typed opaque IDs for canonical global content. All Subsonic streams remain server-side proxied; clients never receive peer URLs or tickets.

## Errors and retry policy

Stable protocol errors include self-peer, replay, clock skew, unknown key, invalid descriptor, incompatible version, grant denied, unsafe URL, redirect denied, stream revoked, and invalid/expired cursor. Authentication and policy errors are not retried automatically. Network/5xx failures use bounded exponential backoff with jitter. Search may return explicitly partial results; sync, import, and pairing never report partial work as complete.

Federated search responses include a top-level `federation` object with
`complete`, attempted/completed peer counts, and bounded failed/timeout peer UID
lists. Incomplete responses preserve local and materialized results but are not
cached as complete answers.

Every mutable administrative operation and security denial emits a bounded audit event. Full URLs, assertions, service tokens, signatures, key material, and PII are excluded from metrics and logs.
