# Observability C4 — alert acceptance

Status: rules implemented and disabled. Nothing here has been enabled in production,
and no alert has been delivered from these rules yet. This record is the checklist
for enabling them, one rule at a time, after the PR3B shadow period.

## Decisions

- Alerts go to Telegram through the Crate Operator supervisor, using its existing
  delivery, acknowledgement, silence and cooldown.
- External probes are postponed. No rule depends on one.
- Every new rule ships with `"enabled": false` in
  `deploy/operator/config.operator.example.json` and is enabled individually after
  7 to 14 days of shadow data and a review of its thresholds.
- The opt-in observability summary is presentation only. It never feeds a rule
  except through the explicit MCP rules `monitoring-status` and `summary-stalls`,
  which are also disabled.

## Rules

| Group         | Rule (subsystem/id)                | Source                                   | Trigger / clear   |
| ------------- | ---------------------------------- | ---------------------------------------- | ----------------- |
| Observability | `observability/prometheus`         | `prometheus-up` (availability)           | unreachable       |
| Observability | `observability/app-scrape-down`    | `min(crate:scrape_up:by_service)`        | ≤ 0 / ≥ 1         |
| Observability | `observability/app-scrape-age`     | `max(crate:scrape_age_seconds:…)`        | ≥ 120 s / ≤ 60 s  |
| Observability | `observability/app-sample-limit`   | `max(crate:scrape_sample_limit_hit:…)`   | ≥ 1 / 0           |
| Observability | `observability/monitoring-status`  | MCP `get_stack_status` monitoring status | not `running`     |
| Queues        | `queues/queue-depth`               | `max(crate:worker_queue_depth:last2m)`   | ≥ 500 / ≤ 200     |
| Queues        | `queues/queue-wait-p95`            | queue wait p95, ≥ 20 tasks               | ≥ 600 s / ≤ 300 s |
| Queues        | `queues/task-failure-ratio`        | task failure ratio, ≥ 20 tasks           | ≥ 0.2 / ≤ 0.1     |
| Availability  | `availability/api-error-ratio`     | API 5xx ratio, ≥ 50 requests             | ≥ 0.05 / ≤ 0.02   |
| Availability  | `availability/api-latency-p95`     | API latency p95, ≥ 50 requests           | ≥ 2 s / ≤ 1 s     |
| Availability  | `availability/stream-latency-p95`  | stream latency p95                       | ≥ 3 s / ≤ 1.5 s   |
| Playback      | `playback/stalls-per-startup`      | stalls per startup, ≥ 20 startups        | ≥ 0.3 / ≤ 0.15    |
| Playback      | `playback/startup-p95`             | startup p95, ≥ 20 startups               | ≥ 5 s / ≤ 3 s     |
| Playback      | `playback/transcode-failure-ratio` | transcode failure ratio, ≥ 10 transcodes | ≥ 0.2 / ≤ 0.1     |
| Playback      | `playback/summary-stalls`          | MCP `get_playback_quality`               | ≥ 0.3 / ≤ 0.15    |

Projector lag has no recording rule yet; the existing `projector/worker-evidence`
rule keeps covering it. Start failures from playback intents and results wait for
PR1B (#336) and its recording rules. Radio, Music Paths and early-skip degradation
wait for PR2A.

## Proven by tests

`app/tests/test_operator_prometheus.py`:

- Freshness is the recorded sample's timestamp, not the query time.
- Empty, ambiguous, non-finite, rejected and under-sampled answers are unavailable.
- Prometheus down, an old answer, an unavailable ratio and a repeated sample never
  resolve an open incident; fresh samples below the clear threshold do.
- Unknown queries and extra arguments are rejected before any request.
- Enabled Prometheus rules require `prometheus_url`; disabled rules only validate.
- Every Prometheus and summary rule in the example ships disabled.

## C4 acceptance, per rule, before enabling

1. Shadow data covers at least 7 days, including a weekend and a deploy.
2. The rule's query returns one series with a fresh sample in production.
3. One induced failure opens exactly one incident, and one recovery resolves it,
   delivered to the test Telegram channel, not to users.
4. A Prometheus restart and a monitoring deploy during the window neither open nor
   resolve the incident.
5. Observed noise over the shadow window is reviewed and the thresholds are
   approved by Diego.
6. Rollback is setting `"enabled": false` again: incidents and history are kept.

## Pending

- Enabling any rule (after shadow and approval).
- Operator actions for monitoring deploys (`observability-deploy`,
  `observability-rollback`, `status`) through the reviewed host contract.
- External probes.
