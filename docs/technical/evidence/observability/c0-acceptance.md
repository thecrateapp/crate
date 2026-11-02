# C0 acceptance and initial objectives — 2026-10-31

Diego approved C0 and authorized PR1A, delegating selection of the initial
objectives. The evidence record from PR #313 is integrated in main at
`6b1803c4506312b6550fb548cce8ffb333443e20`. Production remains on application
release `6681be8…` and deployment helper `75b4424…`; PR1A development does not
change that installation.

## Initial objectives

| Indicator               | Initial objective                                                              | Basis and interpretation                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Interactive API         | p95 below 250 ms                                                               | Selected interactive routes; exclude long streams, SSE and heavy generation.                                    |
| Radio next              | p95 below 500 ms                                                               | Previous measured p95 was 358 ms. This gives about 40% initial headroom; 250 ms remains an optimization target. |
| Music Paths             | p95 below 2 s for 20 steps and 6 s for 100                                     | Separate route type, mode and completeness; failures remain in coverage.                                        |
| Local playback startup  | More than 99% started; p95 below 2 s                                           | Separate runtime/engine and cold/warm. Voluntary cancellation is a distinct outcome.                            |
| Playback stalls         | Less than 0.5% of observed active time                                         | Exclude deliberate pause, seek and intentional offline; include episodes without recovery.                      |
| Infinite continuation   | Zero starvation caused by missing/coordinated refill when catalog is available | User intent remains visible when source construction is unsupported; separate network and coordination causes.  |
| Recommendation feedback | Early skip before 30 s; compare supported rule revisions                       | Use significant started observations and sufficient coverage; no ranking change is introduced by observability. |
| Pipelines               | Per-queue/stage age and progress budgets                                       | Derive from task policy and measured backlog in the domain phase; do not impose one universal timeout.          |
| Collection              | Explicit unavailable/stale/partial states and losses                           | Zero observations are not proof of successful collection.                                                       |

These are initial objectives, not achieved SLOs or notification activation.
Rate-based notifications require at least 20 eligible attempts in 15 minutes.
Availability failures and prolonged starvation have separate rules. Native and
federated coverage is calibrated in its implementation phase. Existing maximum
latency settings retain their own semantics; they are not percentile thresholds.

The approved overlay budget stays at 944 MiB / 1 CPU, with Grafana 384 MiB and
Prometheus 256 MiB. The independent external probe host remains explicitly deferred.
The retention incident and unrecovered pre-C0 configuration snapshot remain in
the rollout evidence. The verified current configuration checkpoint is outside
application mounts and automatic cleanup. No restore drill is claimed.

## PR1A checkpoints

1. Identity and absolute minute snapshots: canonical dimensions, replay and
   concurrent flushers, stale revisions, source-reset gaps, migration/ORM contract.
2. Producer/consumer integration: namespace v2, bounded collection-health counters,
   truthful maximum latency, explicit availability/cutover and legacy separation.
3. Retention and read cost: incremental eight-day cleanup and indexed window reads,
   including the Admin read budget. Closing validation runs once when stable.

Development uses scoped tests only. C0 is accepted; C1 remains dependent on PR1A
and the later continuous QoE work in PR1B.
