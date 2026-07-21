---
title: Federation protocol
summary: Signed node identity, typed authorization, catalog synchronization and opaque relay contracts.
section: federation
audience: [developer]
status: canonical
order: 210
verified: 2026-07-21
sources:
  [
    app/crate/api/federation.py,
    app/crate/federation/identity.py,
    app/crate/federation/pairing.py,
    app/crate/federation/authorization.py,
  ]
---

# Federation protocol

The v1 protocol is node-first. It adds approved remote sources to the same
catalog and playback contracts used in singleton mode; it never gives a client
direct peer credentials or authority over another node.

## Descriptor and request signatures

`/.well-known/crate-node` publishes a signed `NodeDescriptorV1` with node ID,
API origin, protocol/capability versions, public keys and descriptor lifetime.
Node-to-node requests use an Ed25519 signature profile over the method, path,
validated host, content metadata, node/key identifiers, timestamp, nonce and
body digest. Receivers validate signature, key lifecycle, freshness, replay and
request body before evaluating authorization.

Treat descriptors, API origins, stream URLs and directory data as hostile input.
Connection policy must be centralized: scheme, hostname DNS resolution,
redirects, resolved address class, Host/SNI and embedded endpoint origin all
need the same check. Do not weaken it for a test harness; the harness uses an
explicit development private-network allowance.

## Pairing and grants

Pairing stores a candidate/pending relationship and signed envelopes. It is not
equivalent to a production trust decision. An administrator must independently
verify remote identity and approve a peer, then create the smallest typed grant
needed for the use case.

The owner evaluates persisted grants by remote principal/subject selector,
capability, constraints and policy revision. Presets such as discovery/catalog
are templates used to seed a grant, not a substitute for this evaluation. Grant
downgrade, peer disablement or revocation must stop future authorization and
trigger ticket/reconciliation handling; consumers preserve provenance rather
than silently converting remote rows into local data.

## Catalog synchronization

Catalog sync transfers signed, bounded manifest pages and checkpoints persisted
pages before advancing. A retry must be replay-safe; tombstones and upserts are
idempotent. A missing/expired cursor requires a documented full reconciliation,
not a table truncation. The global catalog keeps source provenance and resolves
stable global identities separately from local library ownership.

Catalog read responses surface an explicit serving mode. Local fallback,
global-ready, refreshing and degraded behavior are an API contract; callers
must not invent a `catalog_warming` failure state.

## Playback relay

The consumer asks the owner for a short-lived, subject-bound remote stream
authorization and exposes a separate opaque local relay ticket. The browser
uses the local path only. Traefik routes eligible stream paths to Go readplane;
the relay forwards only allowed Range/cache validators and selected response
metadata. It never forwards cookies, browser authorization, peer URLs or owner
tickets.

The owner remains authoritative for quota, byte reservation, entity constraints,
policy revision and revocation. Playback preparation is advisory and must not
reserve a stream or transfer media.

## Compatibility and errors

Protocol version and advertised capability negotiate the allowed contract; a
software version string is not a capability. Authentication, replay, unsafe
URL, grant and cursor failures are terminal unless the API explicitly documents
a recovery action. Network failures use bounded backoff and incomplete search
must be reported as partial rather than cached as complete.

See [Federation overview](federation-overview.md) for the model and
[Production acceptance](federation-production-acceptance.md) for the conditions
under which a network-facing deployment may rely on it.
