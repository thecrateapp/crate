---
title: Monitoring
summary: What Admin and Grafana show, how to reach Grafana, and how the independent monitoring project is deployed, adopted and rolled back.
section: operations
audience: [operator]
status: canonical
order: 122
verified: 2026-11-02
sources:
  [
    deploy/observability/README.md,
    deploy/observability/compose.standalone.yaml,
    deploy/observability/compose.observability.yaml,
    deploy/observability/prometheus.yml,
    deploy/observability/recording-rules.yml,
    deploy/observability/compose.app-metrics.yaml,
    deploy/observability/compose.projector-prometheus.yaml,
    deploy/observability/compose.traefik-metrics.yaml,
    deploy/observability/grafana/dashboards/app-overview.json,
    deploy/observability/grafana/dashboards/infra-runtime.json,
    deploy/observability/grafana/dashboards/infra-data.json,
    scripts/observability-deploy.sh,
    scripts/observability-deploy-remote.sh,
    scripts/observability_release.py,
    scripts/deploy-remote.sh,
    scripts/deploy.sh,
    app/ui/src/pages/SystemHealth.tsx,
    app/crate/observability/metric_catalog_data.py,
    app/crate/observability/summary.py,
    app/crate/agent_observability.py,
    deploy/operator/prometheus.py,
    deploy/operator/supervisor.py,
    deploy/operator/config.operator.example.json,
    deploy/observability/compose.supervisor-prometheus.yaml,
    Makefile,
  ]
---

# Monitoring

Crate watches itself in two places. Admin shows how the application behaves,
from metrics the application records itself. Grafana shows the same application
metrics over a longer window, next to the infrastructure underneath them, from an
optional Prometheus stack that runs as its own Compose project,
`crate-observability`, next to the application project.
[Observability](observability.md) explains what each surface shows, and the
[metrics reference](metrics-reference.md) lists every metric.

## What you see where

| Question                                         | Where                         | Source and window                                          |
| ------------------------------------------------ | ----------------------------- | ---------------------------------------------------------- |
| Are API routes fast? Which fail?                 | Admin, System Health          | Application metrics, 15 minutes to 7 days                  |
| Is playback starting and streaming smoothly?     | Admin, System Health          | Stream, transcode and playback start/stall metrics         |
| Are workers keeping up? Is storage filling?      | Admin, System Health          | Queue, resource governor, storage and media worker metrics |
| Which containers run, and are they healthy?      | Admin, Stack                  | Docker inventory, Prometheus for CPU and memory            |
| What did the host, a container or PostgreSQL do? | Grafana, Crate infrastructure | Prometheus, 90 days or 10 GB                               |
| How did the application behave last month?       | Grafana, Crate application    | Application metrics in Prometheus, 90 days or 10 GB        |
| Is a library item broken?                        | Admin, Library Health         | Health checks and repairs, not metrics                     |

System Health marks each figure as live, persisted, partial or stale, and never
shows a missing value as zero.

Grafana provisions six dashboards in the **Crate infrastructure** folder. Two
cover the infrastructure:

- **Host and containers:** scrape success and sample age, host CPU, memory,
  filesystem and load, CPU, memory, network and block IO per container, and
  Prometheus series.
- **PostgreSQL and Redis:** reachability, PostgreSQL connections by state, locks,
  transaction rate, mean time of the top 20 statements and block reads; Redis
  memory, connections, command rate, evictions and rejected connections.

Four cover the application, from the exported metrics and the recording rules
(see [Application metrics](#application-metrics)):

- **Overview:** collectors up, API requests, error ratio, p95 latency and sample,
  requests by client, stream p95 latency and concurrent streams.
- **Playback:** startup p95, starts observed, stalls per start, stall p95, stalls
  and recoveries, transcodes and their failure ratio, stream requests.
- **Workers and projector:** queue depth, running tasks, task and queue wait p95,
  task failure ratio, tasks by outcome, resource deferrals, collection from the
  projector and workers, media packages.
- **Telemetry health:** collectors up, scrape age, samples per scrape, sample
  limit, scrape duration and rule evaluation.

A target `up` means the scrape worked; `pg_up` and `redis_up` say whether the
exporter reached its database. Neither proves that a listener can play music.

## Reaching Grafana

Grafana listens only on the server's loopback (`127.0.0.1:3001` by default) and
is never routed through Traefik. From the repository, open a tunnel and the
browser in one step (Ctrl-C closes the tunnel; `GRAFANA_LOCAL_PORT` changes the
local port):

```bash
make observability-grafana
```

or open the tunnel by hand:

```bash
ssh -N -L 3001:127.0.0.1:3001 crate@<server>
```

Then open `http://localhost:3001`, sign in as `admin` with the password from the
`grafana-admin-password` secret file and open the **Crate infrastructure**
folder. On a home installation, the installer showed that password when it
generated it; it is also in `<monitoring data>/secrets/grafana-admin-password`,
readable only by root.

## Home installations

The `crate` installer offers monitoring as an optional step on Linux. It starts
unchecked; the step lists the cost (8 containers capped at 944 MiB of memory and
1 CPU, up to 10 GB of history, keep 20 GB free) and asks for the data folder
(`<data folder>/observability` by default), the Grafana port (3001) and the
Grafana password (left empty, one is generated and shown once at the end). On
macOS, with rootless Docker, an unsupported storage driver or Compose v1 the step
says why it is not available. Grafana listens only on that machine.

From the command line, on an installation that already runs:

```bash
crate observability enable --dir ~/crate    # asks first; Crate restarts once
crate observability status --dir ~/crate
crate observability disable --dir ~/crate   # stops monitoring; data stays
```

Unattended installs use `crate install --yes --observability=on|off|keep`
(default `keep`, or `CRATE_OBSERVABILITY`), with `CRATE_OBSERVABILITY_DIR`,
`CRATE_GRAFANA_PORT` and `CRATE_GRAFANA_PASSWORD`; the password is read only
from the environment.

Enabling runs these steps in order: it writes `monitoring.env` in the install
folder (no secrets), makes sure the database runs, prepares the data folders,
the secret files and a read-only `crate_observer` database account in a
throwaway `crate-api` container, starts the `crate-observability` project, then
adds the network variables and the application overlays to `.env` and restarts
Crate on them. The database account's password is stored as a SCRAM verifier,
never in clear text. Disabling removes the overlays, restarts Crate and stops
the eight monitoring services; it keeps the data, secrets, networks and the
database account.

Running `crate install` again with monitoring on updates it: Grafana's data is
copied to `<monitoring data>/backups/` before a new Grafana image migrates it,
and Prometheus, Grafana or the socket proxy restart when their configuration
changed. An older installer leaves monitoring files written by a newer one
untouched. `crate doctor` lists monitoring as optional: a stopped service, a
silent Grafana or a missing monitoring network are warnings, and Crate starts
without an overlay whose network is gone.

## Deploying monitoring

Monitoring has its own releases, independent of application deploys. Provision
the environment file, secrets, data directories and tooling virtualenv as the
monitoring README (`deploy/observability/README.md`) describes, then deploy a
revision that is on `main`:

```bash
make observability-deploy VERSION=<full-main-sha>
make observability-deploy-status
make observability-deploy-rollback CONFIRM=rollback-observability
```

The server keeps monitoring under `/home/crate/crate-observability`, separate
from the application checkout. A deploy refuses when the running configuration
was edited by hand, restarts only the services whose configuration or image
changed and records the release only after every container runs, every active
Prometheus target is up and Grafana answers. Otherwise it reinstalls the
previous release and fails. Before a Prometheus or Grafana image change it
copies that service's data and restores the copy if the new version does not
verify. Nothing removes monitoring data.

## Adopting the old overlay

Installations that run the eight monitoring services inside the application
project move them with an adoption, in a planned window:

```bash
make observability-adoption-inventory VERSION=<full-main-sha>
make observability-adopt VERSION=<full-main-sha> CONFIRM=adopt-legacy-monitoring
```

The inventory is read-only. Adoption refuses if the old Prometheus or Grafana
data lives anywhere other than the configured data directory, prepares the new
project while the old one still runs, then stops only the old monitoring
containers, keeps a recovery copy and starts `crate-observability` on the same
data. History, dashboards and the `crate-prometheus` datasource carry over; the
monitoring gap lasts a few minutes. A failed adoption restarts the old
containers on their original data. `make observability-revert-adoption` returns
to them until `make observability-retire-legacy` removes the stopped containers.

## Application metrics

With monitoring running, three overlays connect the application to it. Each joins
a network the monitoring project creates, so each is applied only while that
network exists, and `make deploy` ships them and keeps them in the application's
Compose files:

| Overlay                             | Joins              | What it enables                                    |
| ----------------------------------- | ------------------ | -------------------------------------------------- |
| `compose.app-metrics.yaml`          | `app-metrics`      | Application containers expose metrics on port 9200 |
| `compose.projector-prometheus.yaml` | `prometheus-query` | Stack map CPU and memory readings                  |
| `compose.traefik-metrics.yaml`      | `traefik-metrics`  | Requests through Edge on the Stack map             |

With the independent monitoring project, set the network names in the
application `.env`:

```dotenv
OBS_APP_METRICS_NETWORK=crate-observability_app-metrics
OBS_PROMETHEUS_QUERY_NETWORK=crate-observability_prometheus-query
OBS_TRAEFIK_METRICS_NETWORK=crate-observability_traefik-metrics
```

Traefik's metrics also need the internal `metrics` entrypoint in `traefik.yml`,
described in the monitoring README. Deploy monitoring first, so the networks
exist, and the application second. A monitoring deploy verifies only its own
scrape jobs, so an application container that restarts does not roll monitoring
back.

New dashboards and rules run in shadow for 7 to 14 days before any alert reads
them: compare the panels with System Health for the same windows and record
Prometheus CPU, memory, disk growth and series per job. The monitoring README
lists what to measure.

## One deploy at a time

Application deploys, Operator deploys and monitoring deploys share a lease in
the application checkout's `.deploy` directory. The deploy that holds it is the
only one that can change the host; the others refuse and change nothing. An
interrupted deploy can leave the lease behind; release it with
`make deploy-unlock DEPLOY_ID=<owner>` (another owner's lease also needs
`CONFIRM=break-host-lock`).

## Alerts and the observability summary

The Crate Operator supervisor sends alerts to Telegram. Besides the rules it reads
from the Crate MCP, it can read a fixed allowlist of Prometheus recording rules
directly, so an alert still fires when the API or PostgreSQL is down. Each read
has a 2 second timeout and a 64 KB answer limit, takes its freshness from the
recorded sample, and needs a minimum sample before a ratio counts. An empty,
ambiguous, rejected or under-sampled answer is unavailable: it never opens or
resolves an incident on its own.

The rules are grouped as observability (Prometheus up, app scrapes, sample
limit), queues (depth, wait, failure ratio), availability (API errors and
latency, stream latency) and playback (stalls per startup, startup time,
transcode failures). They ship with `"enabled": false` in
`deploy/operator/config.operator.example.json` and are enabled one by one after
the shadow period. The supervisor reaches Prometheus through
`compose.supervisor-prometheus.yaml`, which application deploys keep while the
Operator runs and the `prometheus-query` network exists; set `prometheus_url` in
the supervisor config.

An opt-in maintenance task, `compute_observability_summary`, stores one
presentation summary in `ops_runtime`: playback quality over 15 minutes, product
KPIs for 7 and 30 days, and the state of both deployments from the cached Stack
inventory. Its schedule interval is 0 until an administrator sets one. The Crate
MCP serves it read-only through `get_playback_quality`, `get_product_kpis`
(`window_days` 7 or 30, segments under three listeners suppressed) and
`get_stack_status`; Crate Agent and Crate Operator use the same tools. Nothing in
the summary feeds alerts, a summary older than 15 minutes reads as stale, and a
missing summary or section is unavailable, never zero.

## Limitations

- Prometheus sends no alerts itself and there is no external probe yet; the
  Crate Operator supervisor is the alerting path, and its Prometheus rules are
  disabled until enabled after the shadow period.
- The monitoring release SHA is not reported by containers, so
  `get_stack_status` shows the deployment and its health but not the release.
- Radio, Music Paths and early-skip metrics stay in the PostgreSQL history;
  they are not exported to Prometheus.
- Metrics from a Docker Desktop or OrbStack virtual machine describe the VM, not
  the host.
- Each Compose project creates its own networks. On a daemon with many networks
  the default address pools can run out; the adoption inventory reports the
  count.
- Operator hosts follow the shared lease only after their `deploy-remote.sh` and
  engine are reprovisioned.
