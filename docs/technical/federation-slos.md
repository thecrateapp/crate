---
title: Federation SLOs and observability
summary: Measure catalog, authorization, relay and import behavior without leaking peer or user secrets.
section: federation
audience: [operator]
status: canonical
order: 250
verified: 2026-07-21
sources: [app/crate/federation/health.py, app/readplane, app/tests/load]
---

# Federation SLOs and observability

Federation metrics are diagnostic aids, not authorization. Keep dimensions
bounded: operation, result class, capability, serving mode and peer hash/ID
only where the deployment policy permits it. Never label metrics with full URL,
assertion, ticket, email, raw local user ID or key material.

## Signals to monitor

| Capability         | Primary signals                                                           | Failure interpretation                                           |
| ------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Descriptor/pairing | verification result, pending age, compatibility rejection                 | operator/trust configuration, not a blind retry                  |
| Catalog            | checkpoint age, page latency, reconciliation duration, serving mode       | stale source, expired cursor or projector/read-model fault       |
| Search             | complete/partial result, attempted/completed peers, bounded failure class | degraded remote availability, not proof that local search failed |
| Relay              | ticket denial/revocation, first-byte and Range result, bytes/quota        | policy, readplane, owner or network path fault                   |
| Import             | queue age, lease/reservation, transferred/declared bytes, cleanup result  | worker, capacity or manifest failure                             |

Local catalog availability must remain observable while a source is warming or
degraded. A release needs an explicit catalog serving-mode contract and a
defined fallback behavior, not a generic 500 metric.

## Alerting and response

Alert on persistent catalog checkpoint staleness, a rising authorization or URL
policy denial rate, relay errors above the accepted budget, reservation leaks,
failed staging cleanup and unexpected peer/key state changes. Use bounded
reason codes to route the incident to trust, catalog, readplane or worker
owners. Contain a peer/grant before collecting expensive diagnostics.

The numerical thresholds are release and capacity-fixture dependent. Set them
from an accepted benchmark and document the representative node/catalog shape;
do not copy an arbitrary lab latency into a public SLO. See
[Federation capacity](federation-capacity.md) and
[Production acceptance](federation-production-acceptance.md).
