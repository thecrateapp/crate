---
title: Federated imports
summary: Explicit, worker-owned publication of approved remote media into a local library.
section: federation
audience: [developer, operator]
status: canonical
order: 230
verified: 2026-07-21
sources:
  [
    app/crate/federation/imports.py,
    app/crate/worker_handlers,
    docker-compose.yaml,
  ]
---

# Federated imports

Federated import is the explicit transition from a remote catalog source to a
locally owned library item. Catalog synchronization, browsing, playback,
favorites and playlists do not copy audio. An operator approval and compatible
grant are required before a remote manifest is accepted.

## Lifecycle

1. The consumer validates local policy and asks the owner for an authorized,
   bounded manifest.
2. The consumer validates identity, grant, manifest identity, paths, declared
   sizes and hashes, then reserves peer/global/disk capacity.
3. A worker downloads only through the approved transport into a request-scoped
   staging directory.
4. The worker enforces byte/file limits, verifies hashes and publishes through
   the normal library import/sync path.
5. Completion records local ownership and remote provenance; terminal failure,
   cancellation or lease expiry releases reservations and cleans only that
   request's staging tree.

API containers mount `/music` read-only. They must never publish, rename, tag
or delete media for a federation import.

## Idempotency and containment

The request identifier and manifest digest are the restart boundary. Reuse
staged content only when peer identity, manifest, path, size and digest all
match. A changed manifest creates a new request; manual copying into `/music`
does not repair it.

Treat unsafe/redirected URL, path escape, symlink or special file, limit breach,
digest mismatch, revoked grant and insufficient disk headroom as terminal
security failures. They are not blind retry candidates. Cleanup must never
remove existing library media.

## Operations and test

Inspect the request state, reservation, manifest digest, worker task, bounded
error code and cleanup state in Admin/worker logs. For recovery, reconcile
expired leases before retrying and never bypass the worker. The real two-node
acceptance path is:

```bash
make federation-dev-up
make federation-dev-import-e2e
make federation-dev-down
```

Do not document import as generally available to untrusted peers until the
release satisfies [Production acceptance](federation-production-acceptance.md).
