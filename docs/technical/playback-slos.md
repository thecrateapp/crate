# Playback SLOs and recovery runbook

The following targets are operational thresholds for client QoE and federated
streaming. They are intentionally aggregate-only: dashboard labels are origin,
requested policy and effective policy; no catalog identity is an observability
dimension.

## Service-level objectives

| Signal                  | Objective                                             | Alert window           |
| ----------------------- | ----------------------------------------------------- | ---------------------- |
| startup p95             | local and remote first play at or below 2 seconds     | 15 minutes             |
| stall ratio             | below 2% of playback starts                           | 15 minutes and 6 hours |
| stall duration          | p95 below 5 seconds                                   | 15 minutes             |
| range retry             | remote recovery Range authorizations succeed at 99.5% | 15 minutes             |
| transcode queue wait    | interactive variant work starts within 30 seconds     | 15 minutes             |
| fallback-original ratio | below 10% for non-original requests after warm cache  | 15 minutes             |

The client reports bounded startup, stall and recovery events. The API stores
only minute aggregates (`playback.startup.ms`, `playback.stall.count`,
`playback.stall.ms`, `playback.recovery.count`); it does not retain a
per-track QoE history.

## Alert response

### Startup or stall regression

Check the policy/origin aggregate, current stream cache status and resource
governor. Confirm whether the issue occurs for local playback before changing
client adaptation. Immediate containment is to hide Auto while preserving
manual policies. If local direct streams are also slow, inspect host I/O and
the playback-worker queue before federation.

### Range retry failure

Verify a first Range and a second Range against the affected peer, then inspect
the session expiry, grant revision and authorization denial reason. Revoke or
disable only the affected peer stream grant using the
[federation stream incident runbook](federation-operations-runbook.md#stream-incident).
Do not reintroduce one-shot tickets as a workaround.

### Transcode starvation or fallback-original rise

Inspect `prepare_stream_variant` queue depth, active transcode slots and
resource governor decisions. Pause warmup first; keep interactive priority at
zero and do not increase concurrency without a measured CPU/iowait margin.
See the [release gates](playback-release-gates.md#controlled-warmup) for the
operator controls.

### Elevated remote TTFB

Compare the owner API, consuming readplane and peer network path with the
[federated streaming benchmark](federation-streaming-benchmark.md#reproduction).
Contain an affected peer rather than weakening all federation authorization or
changing global client thresholds.

## Rollback

Client-policy rollback hides Auto; manual concrete policies remain available.
Worker-pressure rollback disables `CRATE_PLAYBACK_WARMUP_ENABLED`; cached files
remain harmless. A remote authorization rollback revokes the affected peer
grant and directs users to local/imported availability. These actions preserve
single-node playback and never require deleting user library data.
