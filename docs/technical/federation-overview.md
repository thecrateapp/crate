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
