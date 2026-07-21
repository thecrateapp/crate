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

## SLOs, alerts and cardinality

| Signal                   | Objective                                                  | Alert window           | Runbook          |
| ------------------------ | ---------------------------------------------------------- | ---------------------- | ---------------- |
| Local catalog search     | p95 at or below 300 ms at the 100K-track reference profile | per release            | capacity gate    |
| Federated metadata reads | 99.5% success, excluding peer-caused 4xx                   | 15 minutes and 6 hours | peer containment |
| Search fanout            | p95 at or below 2 seconds with partial results             | 15 minutes             | peer containment |
| Remote stream TTFB       | p95 at or below 1.5 seconds between reference nodes        | 15 minutes             | stream incident  |
| Catalog sync lag         | healthy below 5 minutes                                    | 15 minutes             | catalog recovery |

Metric labels have bounded cardinality: an approved peer UID only where policy
permits it, plus enumerated operation and reason-code values. URLs, tokens,
key material, user identifiers, assertions, paths and free-form upstream
errors are prohibited.

## Catalog serving modes

Canonical search emits `catalog.search.serving_mode` and returns the same
value in `X-Crate-Catalog-Mode`:

- `local-fallback`: first reconciliation is incomplete and reads use local
  `library_*` models.
- `global-ready`: the current global catalog is complete.
- `global-refreshing`: reconciliation runs while the last complete global
  catalog remains readable.
- `global-degraded`: reconciliation failed while the last complete global
  catalog remains readable.

The mode is context, not an outage by itself. Alert on errors or latency, not
on `local-fallback` or `global-refreshing` alone.

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

## Native local media dependency

Local native delivery is governed by the gates in
`local-media-delivery-slos.md`. Remote federation streaming remains on the
existing ticketed proxy and is never replaced by filesystem delivery. A local
native miss must fall back to FastAPI and must not change peer quotas, provenance
or ticket validation.
