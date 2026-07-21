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

## Catalog warming or reconciliation failure

Canonical reads must not return `catalog_warming`. During a first
reconciliation, local reads remain available from `library_*`; later refreshes
and failures serve the last complete global catalog.

1. Inspect the serving mode, reconciliation state, last completed run and last
   error in Admin.
2. Request `/api/catalog/search?q=high&limit=5` and inspect
   `X-Crate-Catalog-Mode`. `local-fallback`, `global-refreshing` and
   `global-degraded` must still return `200`.
3. If local fallback is slow, run `make dev-catalog-search-capacity-test` only
   against its isolated `crate_test` database.
4. Repair the bounded source failure and queue one supported reconciliation;
   do not truncate catalog or user-library tables as an incident shortcut.

## Playback preparation incident

Check `federation.playback.prepare.requested`, result counters,
`ready_before_play`, `fallback_original`, active preparation work and
interactive queue wait. They are aggregate-only metrics: never add a user,
entity, cache key, path, URL, ticket or assertion as a label.

Inspect the TTL-backed reservation keys
`federation:playback-prepare:peer:{peer_node_uid}` and
`federation:playback-prepare:global`; do not populate or prolong them by hand.
For preparation saturation or resource pressure, set the affected owner's
preparation ceilings to zero. New preparation fails harmlessly while normal stream tickets remain available. Restore the conservative limits only after the
fallback-original ratio and interactive queue wait recover for one alert window.

## Release evidence

A federation release needs a recorded result for the relevant tests, security
review, backup/restore readiness, capacity/SLO gate and rollback plan. The
authoritative checklist is [Production acceptance](federation-production-acceptance.md).
