---
title: Federation overview
summary: The node-first catalog, trust and media-delivery model, with explicit safety and rollout boundaries.
section: federation
audience: [developer, operator]
status: canonical
order: 200
verified: 2026-07-21
sources:
  [
    app/crate/federation,
    app/crate/api/federation.py,
    app/readplane/internal/routes,
    Makefile,
  ]
---

# Federation overview

Federation lets independent Crate nodes discover approved catalog sources and
relay authorized remote playback without exposing a peer URL or ticket to a
browser. It is **not** a second deployment mode, an anonymous public network or
a filesystem replication protocol. With no approved peers, a node serves the
same local/global catalog contracts in singleton mode.

## Safety status

The local one-node and two-node harnesses are the acceptance environment for
federation work. Internet-facing peering must remain disabled or manually
contained until the production-acceptance gate is satisfied for the release.
In particular, do not interpret descriptor discovery, a catalog row or a
directory entry as approval to serve data. Operators must review the current
security, pairing, URL-policy, key-rotation and Range/proxy checks before
enabling a real peer.

## Architecture

```text
owner node                         consumer node
----------                         -------------
signed descriptor  <-------------> descriptor validation / pending peer
typed grant        <-------------> owner-authoritative authorization
catalog manifest/delta ----------> durable source rows -> global catalog
remote stream ticket <------------- local opaque relay ticket
owner media  <-------------------- Go readplane / Traefik -> local client
```

### Identity and trust

Each node has a stable node identifier and Ed25519 identity material. A signed
`NodeDescriptorV1` advertises the node, key set, versions and capabilities.
Descriptors and every embedded endpoint are untrusted network input; validation
must apply the current HTTPS/DNS/redirect/address policy before any connection.

Pairing creates a _pending_ relationship. Approval and typed grants are separate
operator decisions. The serving owner is authoritative for a request: it
evaluates the requester, pseudonymous subject assertion, capability,
constraints, policy revision and quota. A grant preset is a convenience
template, never an authorization decision by itself.

Read [Protocol](federation-protocol.md), [Key management](federation-key-management.md)
and [Threat model](federation-threat-model.md) before changing this boundary.

### Catalog and global identity

Approved sources publish signed catalog snapshots and, where supported, durable
incremental updates. The consumer checkpoints only persisted work; replays and
tombstones must be idempotent. Remote tracks retain source provenance and do
not become local filesystem ownership merely because they appear in a global
artist/album/track identity.

The global catalog prefers a local playable source, then a healthy permitted
remote source. Readplane exposes explicit serving modes so a warm/reconcile
operation does not turn ordinary local catalog reads into an opaque failure.
Capacity, fallback and reconciliation details are in
[Federation capacity](federation-capacity.md) and
[Production acceptance](federation-production-acceptance.md).

### Per-peer summaries and search routing

A federated search should ask only the peers that can answer it. Each owner
publishes one compact Bloom-filter summary per catalog scope (the digest of the
`catalog.search` policy), so a peer receives only a summary of what it may see.
A worker rebuilds summaries every five minutes; a request never builds one. The
summary travels with the delta feed as a descriptor and is fetched, conditionally,
from `GET /api/federation/v1/catalog/summary` (capability `catalog.summary`).
It holds hashed word tokens, their prefixes and hashed artist keys, never names
or query text.

The receiver stores the latest summary per peer and uses it in the fan-out
decision. A peer whose filter cannot contain the query's words is skipped
(`no_summary_match`). A peer that holds more albums for an artist than the local
catalog is asked even when local results are plentiful (`peer_has_more`). A
peer without a fresh summary (none stored, refused, or not confirmed for
1800 s), or a summary store that fails, is always asked. A query that matches
only the middle of a word is not routed by summaries. The precise guarantee and
its known gaps are in the [Protocol](federation-protocol.md).

Peers paired before FED2 keep the `capabilities_json` stored at pairing, which
does not list `catalog.summary`, so the 900 s summary poll skips them until they
are re-paired or their capabilities are refreshed. The delta path still keeps
their summaries current: every delta page announces the summary etag and the
receiver fetches it when it changes. See the
[Protocol](federation-protocol.md) for the `crate.federation.summary/1`
contract and [Federation capacity](federation-capacity.md) for its measured
size.

### Playback and import

Remote playback uses short-lived owner tickets plus an opaque local relay
ticket. Browser clients receive only the local URL. The Go readplane/Traefik
path validates the request and relays a narrow set of Range-related headers;
the owner remains responsible for grant/revocation/quota enforcement.

Remote import is a different, explicit operation. It uses a signed manifest,
reservation/limit checks and a worker-owned staging/publish flow. API processes
do not write `/music`; an import does not imply automatic replication. See
[Federated imports](federation-imports.md) and
[Streaming and playback](federation-streaming-benchmark.md).

## Operate and test

```bash
make federation-dev-up
make federation-dev-smoke
make federation-dev-e2e
make federation-dev-global-catalog-e2e
make federation-dev-playback-prepare-e2e
make federation-dev-import-e2e
make federation-dev-down
```

Use the scoped acceptance target for the capability changed. Before a release,
work through [Federation operations](federation-operations-runbook.md),
[SLOs](federation-slos.md), [Upgrade and rollback](federation-upgrade-and-rollback.md)
and [Production acceptance](federation-production-acceptance.md).
