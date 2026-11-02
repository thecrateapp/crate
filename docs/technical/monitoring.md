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
from metrics the application records itself. Grafana shows the infrastructure
underneath it, from an optional Prometheus stack that runs as its own Compose
project, `crate-observability`, next to the application project.

## What you see where

| Question                                         | Where                         | Source and window                                          |
| ------------------------------------------------ | ----------------------------- | ---------------------------------------------------------- |
| Are API routes fast? Which fail?                 | Admin, System Health          | Application metrics, 15 minutes to 7 days                  |
| Is playback starting and streaming smoothly?     | Admin, System Health          | Stream, transcode and playback start/stall metrics         |
| Are workers keeping up? Is storage filling?      | Admin, System Health          | Queue, resource governor, storage and media worker metrics |
| Which containers run, and are they healthy?      | Admin, Stack                  | Docker inventory                                           |
| What did the host, a container or PostgreSQL do? | Grafana, Crate infrastructure | Prometheus, 90 days or 10 GB                               |
| Is a library item broken?                        | Admin, Library Health         | Health checks and repairs, not metrics                     |

System Health marks each figure as live, persisted, partial or stale, and never
shows a missing value as zero. Application metrics (API, streams, transcoding,
playback quality, workers) are not exported to Prometheus yet, so Grafana does
not show them.

Grafana has two provisioned dashboards:

- **Host and containers:** scrape success and sample age, host CPU, memory,
  filesystem and load, CPU, memory, network and block IO per container, and
  Prometheus series.
- **PostgreSQL and Redis:** reachability, PostgreSQL connections by state, locks,
  transaction rate, mean time of the top 20 statements and block reads; Redis
  memory, connections, command rate, evictions and rejected connections.

A target `up` means the scrape worked; `pg_up` and `redis_up` say whether the
exporter reached its database. Neither proves that a listener can play music.

## Reaching Grafana

Grafana listens only on the server's loopback (`127.0.0.1:3001` by default) and
is never routed through Traefik. Open a tunnel and browse locally:

```bash
ssh -N -L 3001:127.0.0.1:3001 crate@<server>
```

Then open `http://127.0.0.1:3001`, sign in as `admin` with the password from the
`grafana-admin-password` secret file and open the **Crate infrastructure**
folder.

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
- Application metrics are not in Prometheus, so Grafana has no API, playback or
  worker dashboards.
- Metrics from a Docker Desktop or OrbStack virtual machine describe the VM, not
  the host.
- Each Compose project creates its own networks. On a daemon with many networks
  the default address pools can run out; the adoption inventory reports the
  count.
- Operator hosts follow the shared lease only after their `deploy-remote.sh` and
  engine are reprovisioned.
