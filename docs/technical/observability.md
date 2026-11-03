---
title: Observability
summary: What Crate observes about itself, where each reading appears (System Health, the Stack map, Product, Grafana, alerts and MCP), how readings are collected and what they never contain.
section: operations
audience: [operator, developer]
status: canonical
order: 121
verified: 2026-11-03
sources:
  [
    app/crate/metrics.py,
    app/crate/observability/metric_catalog_data.py,
    app/crate/observability/live_activity.py,
    app/crate/observability/prometheus_adapter.py,
    app/crate/observability/prometheus.py,
    app/crate/observability/playback_qoe.py,
    app/crate/observability/recommendations.py,
    app/crate/observability/summary.py,
    app/crate/api/admin_metrics.py,
    app/crate/api/playback_telemetry.py,
    app/crate/recommendation_policy.py,
    app/crate/stack_inventory.py,
    app/listen/src/lib/playback-qoe-store.ts,
    app/ui/src/components/admin/StackMap.tsx,
    app/ui/src/components/admin/stack-map-topology.ts,
    app/ui/src/components/system-health/PlaybackHealth.tsx,
    deploy/observability/recording-rules.yml,
    deploy/observability/compose.app-metrics.yaml,
    deploy/operator/prometheus.py,
    deploy/operator/config.operator.example.json,
  ]
---

# Observability

Crate records how it behaves while it runs and shows those readings in Admin. With
the optional monitoring stack it also exports them to Prometheus, where Grafana
draws them next to the host, the containers and the databases, and where Crate
Operator can alert on them. This page explains what is observed and where you see
it. [Monitoring](monitoring.md) covers deploying the monitoring stack, and the
[metrics reference](metrics-reference.md) lists every metric.

## Where to look

| Question                                                   | Where                      | Needs monitoring |
| ---------------------------------------------------------- | -------------------------- | ---------------- |
| Are API routes fast? Are streams and workers keeping up?   | Admin, System Health       | No               |
| Is playback starting and staying smooth for listeners?     | Admin, System Health       | No               |
| What runs where, and what is it doing right now?           | Admin, Stack               | Partly           |
| How many people listen, and how does the library grow?     | Admin, Product             | No               |
| What did the host, a container or a database do last week? | Grafana                    | Yes              |
| How did the application behave over the last 90 days?      | Grafana                    | Yes              |
| Should someone be woken up?                                | Crate Operator in Telegram | Yes              |
| What does an agent see?                                    | Crate MCP                  | No               |

## How readings are collected

The API, the workers, the projector and the media worker record each observation
with a metric name from a fixed catalogue. Every label accepts a known set of
values; anything else is stored as `other`, so a reading can never carry a free
string such as a file path or a track title. Observations are aggregated per
minute in Redis and written to PostgreSQL, where they are kept for eight days.
When Redis restarts, evicts data or loses a buffer, the gap is recorded next to
the data.

Admin reads that history. Each figure says whether it is available, partial
(collection recorded a gap inside the window), stale (the collector has not
checked in for more than ten minutes), empty (the source reported and nothing
happened) or unavailable (the source did not report). A missing value is shown as
missing, never as zero: System Health leaves a gap in the chart.

With monitoring enabled, every application container also exposes its readings on
an internal port, `9200`, that is never published on the host. Prometheus scrapes
them over the `app-metrics` network, which only Prometheus and those services join.

## System Health

System Health is the application's own view: API latency, volume, errors and slow
requests per route; streaming responses and transcodes; Home compute time; queue
depth, wait and task duration; resource governor deferrals; storage use. It reads
the PostgreSQL history for windows from 15 minutes to 7 days and needs no
monitoring stack.

### Playback health

Listen reports playback quality to `POST /api/playback/qoe`:

- **Intents:** one per play request.
- **Results:** started, cancelled (for example, the browser refused autoplay) or
  failed, with a cause: network, decode, unavailable, timeout or other.
- **Active time:** how long playback actually ran.
- **Startup, stalls and recoveries:** time to first audio, buffering and retries.

System Health turns the last 15 minutes into start success, the share of
playback time spent stalled, mean startup time and failed starts. Below 20 play attempts it hides
the ratios and says the sample is too small. It names caveats instead of hiding
them: older clients that only send the earlier format, events lost on the device,
events accepted while Redis could not deduplicate them, and rate-limited events.

Telemetry has its own safeguards. Listen keeps at most 96 events in memory for up
to 10 minutes, sends them in batches of 12 and paces itself with a token bucket.
A failed send is retried with the same event IDs, and the server drops an event
it already accepted in the last 24 hours. The server allows 120 events a minute
per client session and 600 per user, so two devices of one listener do not
throttle each other. Logging out or switching server clears the buffer, and
nothing is written to disk.

### Recommendation signals

Radio and Music Paths record what they produced without changing what they
choose:

- **Radio batches:** whether a batch was generated, replayed or recovered, how
  full it was, how long it took, how many tracks had similarity vectors and which
  relaxation step supplied each track.
- **Music Paths plans:** complete, partial, empty or unresolved, with fill,
  planning time and warning codes.
- **Queue continuation:** when the queue runs out during radio or Infinite,
  Listen reports whether more tracks arrived, the source was exhausted or the
  listener stopped, and how long they waited.
- **Early skips:** an hourly task measures how often radio and path tracks are
  skipped in their first 30 seconds over the last 24 hours, per surface and rules
  revision. No reading is published when there were no plays.

These metrics stay in the PostgreSQL history; they are not exported to
Prometheus.

## The Stack map

Admin's Stack page draws the server as a map: the host, the application
deployment and the monitoring deployment, with every container in its tier and
the connections between them. The inventory comes from Docker through the API's
read-only socket access, and the host takes its name from the Docker daemon
unless `CRATE_HOST_NAME` is set. A container Crate has no description for still
appears, under its Compose service name and image.

While the page is open, the projector samples live readings off the request
path and streams them to the map:

- **Requests per minute** per client: Listen on web, Android, iOS and desktop,
  Admin and Subsonic.
- **Tasks per queue** and projected domain events.
- **Devices listening now.**
- **CPU and memory** per service and for the host, read from Prometheus every 30
  seconds. These need the monitoring stack and the projector's Prometheus overlay.
- **Requests through Edge** per application router, from Traefik's metrics
  entrypoint.

The readings carry counts only, never identities, and the sampler stops when
nobody has the page open. A service without a reading shows nothing rather than
zero. The map has a 2D view and an optional 3D view that draws each deployment as
a dome; 3D needs WebGL2 and at least 880 pixels of width, falls back to 2D
otherwise, and drops camera moves and particles when reduced motion is on.

## Product KPIs

Admin's Product page shows daily figures for the whole instance: accounts and
listeners, plays and listening time, library growth, acquisition outcomes,
engagement, federation and streaming. A maintenance task computes them every hour
into a daily table; the page never scans raw history. Breakdown segments backed by
fewer than three listeners are hidden. [Product KPIs](product-kpis.md) defines
every figure.

## Prometheus and Grafana

The monitoring stack, `crate-observability`, runs Prometheus, Grafana and
exporters for the host, containers, PostgreSQL and Redis. With application
metrics enabled it also scrapes 78 application metric families and evaluates 29
recording rules: request, stream, playback, worker and telemetry rates and
percentiles, each with the sample it came from. No rule turns missing data into
zero.

Grafana provisions six dashboards in the **Crate infrastructure** folder: host and
containers, PostgreSQL and Redis, and for the application an overview, playback,
workers and projector, and telemetry health, which shows whether collection
itself is working. Grafana only listens on the server's loopback;
`make observability-grafana` opens an SSH tunnel and the browser.

On a home installation the `crate` installer offers the stack as an optional,
unchecked step on Linux, and `crate observability enable|disable|status` turns it
on and off later; [Monitoring](monitoring.md#home-installations) lists the steps.

## Alerts

Crate Operator's supervisor sends alerts to Telegram. Besides the checks it runs
through the Crate MCP, it can read a fixed list of Prometheus recording rules
directly, so an alert still fires when the API or PostgreSQL is down. Each read has
a 2 second timeout and a 64 KB limit, takes its freshness from the recorded
sample and needs a minimum sample before a ratio counts. An empty or stale answer
never opens or resolves an incident.

Rules cover monitoring health, queues and the projector, availability and
playback. They ship disabled. Monitoring first runs a shadow period of 7 to 14
days without alerts; after it, each rule is enabled on its own once its noise and
threshold have been reviewed.

## Agents

The Crate MCP serves observability read-only through `get_playback_quality`,
`get_product_kpis` and `get_stack_status`, and Crate Agent and Crate Operator use
the same tools. They read a summary stored by an opt-in maintenance task; a
summary older than 15 minutes reads as stale, and a missing section is
unavailable, never zero.

## What is never collected

- Playback telemetry carries no track, album or artist identifiers, no file paths
  and no credentials. The server rejects a payload that tries to send them.
- Labels are bounded, so free text never becomes part of a metric.
- Live Stack readings are counts. Devices listening now is a number, not a list
  of people.
- Product KPI segments with fewer than three listeners are hidden.
- A missing reading stays missing. Nothing on these surfaces fills a gap with
  zero.
