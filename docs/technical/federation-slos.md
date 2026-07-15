# Federation SLOs and alerts

These objectives apply to the node-first federation protocol. A singleton node is a valid healthy deployment; the absence of peers is not an incident.

## Service-level objectives

| Signal                   | Objective                                                 | Measurement window |
| ------------------------ | --------------------------------------------------------- | ------------------ |
| Singleton catalog reads  | Match the local baseline availability                     | rolling 30 days    |
| Federated metadata reads | 99.5% success, excluding peer-caused 4xx                  | rolling 30 days    |
| Search fanout            | p95 at or below 2 seconds with partial results            | rolling 24 hours   |
| Remote stream TTFB       | p95 at or below 1.5 seconds between reference nodes       | rolling 24 hours   |
| Catalog sync lag         | healthy below 5 minutes                                   | per peer           |
| Security contracts       | zero quota, SSRF, grant, replay, or signature bypasses    | every release      |
| Import cleanup           | 100% of failures release reservations and temporary files | rolling 24 hours   |

Metric labels have bounded cardinality: known peer UUID and an enumerated reason code only. URLs, tokens, key material, user identifiers, subject assertions, paths, and free-form upstream errors are prohibited.

## Alerts

| Alert                      | Alert window           | Threshold                                         | Runbook                                                                                    |
| -------------------------- | ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Metadata error budget burn | 15 minutes and 6 hours | 14x / 2x burn rate                                | [Peer degradation](federation-operations-runbook.md#peer-outage)                           |
| Search fanout latency      | 15 minutes             | p95 above 2 seconds for 3 windows                 | [Peer degradation](federation-operations-runbook.md#peer-outage)                           |
| Remote stream TTFB         | 15 minutes             | p95 above 1.5 seconds for 3 windows               | [Streaming recovery](federation-operations-runbook.md#stream-incident)                     |
| Sync lag                   | 15 minutes             | any approved healthy peer above 5 minutes         | [Catalog recovery](federation-operations-runbook.md#cursor-expired-corrupt-or-stuck-sync)  |
| Signature or replay flood  | 5 minutes              | score at or above 80                              | [Federation security](federation-operations-runbook.md#signature-replay-or-abuse-incident) |
| Import cleanup failure     | 10 minutes             | any unreleased reservation after terminal failure | [Import recovery](federation-operations-runbook.md#stuck-or-failed-import)                 |

Alerts aggregate over a window rather than paging for a single peer request. Temporary risk actions always expire and are reversible from Admin; disabling a peer remains a manual operator decision.
