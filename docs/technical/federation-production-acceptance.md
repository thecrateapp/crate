---
title: Federation production acceptance
summary: Mandatory gates before a federation feature is exposed beyond a controlled two-node environment.
section: federation
audience: [developer, operator]
status: canonical
order: 290
verified: 2026-07-21
sources: [Makefile, scripts/federation-dev-e2e.py, app/tests/test_federation_*]
---

# Federation production acceptance

Federation is accepted per release and capability, not by the existence of a
descriptor or a successful local demo. A feature is not ready for untrusted
internet peering until all relevant gates below have current evidence.

## Mandatory gates

1. **Singleton parity:** no approved peer preserves local catalog, playback,
   auth and failure behavior.
2. **Trust boundary:** pairing proofs, self-peer rejection, descriptor/key
   change handling, grant evaluation, revocation and URL/DNS/TLS/redirect
   policy have focused tests and manual review evidence.
3. **Identity recovery:** private-key backup/restore and rotation/compromise
   behavior are tested without silently replacing node identity.
4. **Catalog correctness:** snapshot/delta/reconciliation are idempotent;
   deletion, source provenance, taxonomy digest and global serving modes have
   two-node coverage.
5. **Playback safety:** the browser sees no peer URL/ticket; owner quota,
   policy revision/revocation, Range behavior, proxy timeout and fallback paths
   are exercised under interruption.
6. **Import containment:** request approval, manifest/hash/path validation,
   peer/global/disk reservation, worker-only publication and terminal cleanup
   are demonstrated on two nodes.
7. **Capacity and SLOs:** representative catalog and stream fixtures meet the
   agreed throughput/freshness/error budget and emit bounded observability.
8. **Operations:** an operator can disable a peer/grant, restore keys and
   database state, reconcile a source and roll forward safely after a failed
   release.

## Required local evidence

```bash
make federation-dev-up
make federation-dev-smoke
make federation-dev-e2e
make federation-dev-global-catalog-e2e
make federation-dev-playback-prepare-e2e
make federation-dev-import-e2e
make federation-dev-singleton-e2e
make federation-dev-zero-downtime-e2e
make federation-dev-down
```

Run only the targets relevant to the release, but do not waive a required gate
without recording the risk owner, containment and expiry. A passing harness is
necessary but not sufficient: deployment configuration, secret ownership,
public routing and rollback/migration constraints must match the tested model.
