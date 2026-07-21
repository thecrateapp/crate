---
title: Federation operations
summary: Contain peer incidents, diagnose synchronization and prove a federation release locally.
section: federation
audience: [operator]
status: canonical
order: 240
verified: 2026-07-21
sources:
  [app/crate/api/admin_federation.py, app/crate/federation/health.py, Makefile]
---

# Federation operations

Never put private keys, readplane service tokens, signed assertions, remote
stream tickets or complete peer URLs in a ticket or metric label.

## Baseline

Before a peer mutation, check the Admin federation health/status surfaces,
local descriptor/key state, global-catalog serving mode, readplane readiness,
projector lag, durable Redis and worker capacity. Take a PostgreSQL backup when
the operation can require repair.

Reproduce behavior in the isolated harness:

```bash
make federation-dev-up
make federation-dev-smoke
make federation-dev-e2e
```

Use targeted targets for global catalog, playback preparation, imports,
singleton and zero-downtime behavior. Stop with `make federation-dev-down`;
reset only when fixture volumes may be destroyed.

## Containment first

For suspicious pairing, unexpected access, grant breach or relay misuse: disable
the peer or revoke/downgrade the typed grant before attempting repair. Confirm
that policy revision changed and new requests are denied. Preserve remote rows
as unavailable/provenanced data where required; do not truncate global catalog
tables as an incident response.

For signing-key loss or compromise, stop signing-dependent federation work,
restore the identity recovery set or use explicit administrator-mediated
re-pairing. Do not let bootstrap silently create a replacement identity over
existing state.

## Diagnose by capability

| Symptom                      | Evidence                                                                         | Safe recovery                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Pending/denied pairing       | descriptor identity, version/capabilities, approval and URL-policy result        | reject unexpected offers; correct configuration; create a new controlled pairing |
| Catalog stale/expired cursor | checkpoint, page digest, peer health, serving mode, projector state              | reset only that source checkpoint and perform documented reconciliation          |
| Relay error                  | opaque ticket state, grant revision, Range request, owner denial, readplane logs | contain peer/grant first; do not expose a peer URL to a client                   |
| Import stuck                 | worker task, reservation/lease, manifest digest, staging cleanup                 | reconcile expired lease; resume only the unchanged request                       |

## Release evidence

A federation release needs a recorded result for the relevant tests, security
review, backup/restore readiness, capacity/SLO gate and rollback plan. The
authoritative checklist is [Production acceptance](federation-production-acceptance.md).
