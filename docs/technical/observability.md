---
title: Observability
summary: What Crate observes about itself, where each reading appears (System Health, the Stack map, Product, Grafana, alerts and MCP), how readings are collected and what they never contain.
section: operations
audience: [operator, developer]
status: canonical
order: 121
verified: 2026-11-04
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
    app/crate/error_inbox/priority.py,
    app/crate/error_inbox/digest.py,
    app/crate/error_inbox/sentry_client.py,
    app/crate/worker_handlers/error_inbox.py,
    app/ui/src/pages/Errors.tsx,
    app/ui/src/pages/ErrorDetail.tsx,
    app/ui/src/components/errors/ConnectionPanel.tsx,
    app/ui/src/components/system-health/ErrorsTile.tsx,
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

| Question                                                   | Where                      | Needs monitoring  |
| ---------------------------------------------------------- | -------------------------- | ----------------- |
| Are API routes fast? Are streams and workers keeping up?   | Admin, System Health       | No                |
| Is playback starting and staying smooth for listeners?     | Admin, System Health       | No                |
| What runs where, and what is it doing right now?           | Admin, Stack               | Partly            |
| Which errors happened, and which matter most?              | Admin, Errors              | No (needs Sentry) |
| How many people listen, and how does the library grow?     | Admin, Product             | No                |
| What did the host, a container or a database do last week? | Grafana                    | Yes               |
| How did the application behave over the last 90 days?      | Grafana                    | Yes               |
| Should someone be woken up?                                | Crate Operator in Telegram | Yes               |
| What does an agent see?                                    | Crate MCP                  | No                |

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

## Errors

### What Sentry does in Crate

Every runtime reports its errors to Sentry, one project per runtime, so a failure
stays attributable to the process that raised it:

| Runtime                         | Sentry project        | Configuration                                                |
| ------------------------------- | --------------------- | ------------------------------------------------------------ |
| FastAPI                         | `crate-api`           | `SENTRY_API_DSN` in `.env`                                   |
| Python workers and projector    | `crate-workers`       | `SENTRY_WORKERS_DSN` plus a per-process `SENTRY_SERVICE` tag |
| Go readplane                    | `crate-readplane`     | `SENTRY_READPLANE_DSN` in `.env`                             |
| Rust media worker               | `crate-media-worker`  | `SENTRY_MEDIA_WORKER_DSN` in `.env`                          |
| Admin                           | `crate-admin`         | `SENTRY_ADMIN_DSN` GitHub Actions Variable                   |
| Listen web, Capacitor and Tauri | `crate-listen`        | `SENTRY_LISTEN_DSN` GitHub Actions Variable                  |
| Cast receiver                   | `crate-cast-receiver` | `SENTRY_CAST_RECEIVER_DSN` GitHub Actions Variable           |
| Documentation site              | `crate-docs`          | `SENTRY_DOCS_DSN` GitHub Actions Variable                    |

- The SDKs keep default PII collection off and redact credentials, cookies, query
  strings and user contact fields before an event leaves the process.
- Handled API 5xx responses, terminal task failures, projector failures and
  media-worker job failures are captured explicitly, because they do not
  necessarily raise an uncaught exception.
- Every deployable build reports the Git SHA as `SENTRY_RELEASE`. Trusted CI
  builds upload source maps and native symbols with the `SENTRY_AUTH_TOKEN`
  Actions secret; that token never reaches a runtime image.
- Local frontend builds send nothing unless `VITE_SENTRY_DSN` is exported.

[Development setup](00b-development-setup.md#sentry-observability) covers the DSNs
and the build-time upload in detail.

### The inbox

Admin's **Errors** page (`/errors`, in the System section between Logs and Stack)
shows Sentry issues without opening Sentry. It reads only PostgreSQL: no Admin
request calls Sentry, so a slow or unavailable Sentry never slows the page down.

- **Order.** Each issue gets a deterministic Crate score from its level, its
  state (new, regressed, escalating), the service, users and events in the last
  24 hours and Sentry's own priority. Issues scoring 70 or more form the
  **critical lane**, listed first. The score never depends on a model being
  configured.
- **Duplicates.** Issues with the same exception type and innermost application
  frame share a group key and collapse into one row with their combined counts;
  the row expands to the individual issues.
- **Filters.** Lane, status, service, classification and release, kept in the page
  address so a filtered view can be shared.
- **Detail.** Each issue shows its counts, first and last seen, releases, the
  exception chain, the application frames with the source lines Sentry stored for
  the failing release (innermost first, the failing line marked), allowlisted
  tags and recent breadcrumbs.
- **Actions.** _Resolve in next release_, _Ignore until escalating_ and _Reopen_
  change the issue in Sentry first and then in Crate. Each runs as a worker task;
  the buttons wait until it finishes. _Open in Sentry_ links to the issue.
- **System Health** shows a tile with open, critical, new and regressed issues in
  the last 24 hours and the top three of the critical lane. It comes in the
  existing dashboard response; when the summary cannot be built the tile says it
  is unavailable rather than showing zeros.

The page says plainly when error tracking is not configured, when the first sync
has not run yet, when Sentry rejected the token and when Sentry could not be
reached. In the last case it keeps showing the issues of the last good sync.

### The sync

A worker task, `sync_error_issues`, reads Sentry every 5 minutes. The scheduler
creates it only when error tracking is configured, so an installation without
Sentry runs nothing.

- It lists unresolved issues of the **error** category only, 100 per page and at
  most 5 pages per pass. A truncated pass is recorded and the page says so.
- It downloads the latest event of at most 25 issues per pass, highest score
  first, and keeps a sanitized **digest** of it, never the raw event.
- Issues still open in Crate that no longer appear in the listing are checked one
  by one, at most 50 per pass, so issues resolved or ignored in Sentry close in
  Crate too.
- Resolved and ignored issues are forgotten 30 days after they close.
- The result of each pass (status, error code, counts, truncation) is stored in
  the runtime state the page and the tile read.

The digest is what the issue detail shows. It keeps up to 3 chained exceptions,
the last 20 application frames with the source lines Sentry already sends (no
local variables), the tags `service`, `environment`, `release`, `runtime`,
`transaction`, `route`, `task_type`, `browser.name`, `os.name` and
`device.family`, and the last 10 breadcrumbs with their message cut to 160
characters. Paths under `/music/` become `/music/<path>`, query strings are
removed, and e-mail and IP addresses are stripped. It stays under 24 KB:
breadcrumbs go first, then source lines.

### Permissions

| Capability           | Grants                                                               |
| -------------------- | -------------------------------------------------------------------- |
| `ops.errors.view`    | The Errors page, the issue detail and the Errors entry in navigation |
| `ops.errors.manage`  | Resolve, Ignore and Reopen                                           |
| `ops.runtime.manage` | The Sentry connection panel: settings, token and the connection test |

System Health stays open to `ops.health.view`; its tile links to the inbox only
for people who can open it.

### Connecting Sentry

The connection panel at the bottom of the Errors page asks for:

- **Base URL**: `https://sentry.io` by default; `us.sentry.io`, `de.sentry.io` or a
  self-hosted HTTPS address also work.
- **Organization**: the organization slug.
- **Projects** and **environments**: comma-separated; empty means every project
  the token can see and every environment.
- **Token**: from a Sentry internal integration with `org:read`, `project:read`
  and `event:read`. Add `event:write` to resolve and ignore from Crate; without
  it the inbox works read-only and hides the status actions. The token is stored
  encrypted, is never shown again and is only replaced when a new one is typed.

_Test connection_ enqueues a worker task that checks the token's scopes and
records whether Crate can read and write; the panel shows the result and when it
was checked.

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
