# Observability C0 — infrastructure shadow baseline

Status: infrastructure shadow active; C0 acceptance remains pending review and remaining coverage checks. The authenticated web journey is now recorded in [functional-review.md](functional-review.md).
This record must not be read as a completed C0 acceptance or an application SLO.

## Approved decisions

- Diego authorized continuation with shadow integration after PR0 review.
- Production uses Docker overlayfs/containerd. Adapt and validate it before
  activation; do not switch Docker's storage backend or grant cAdvisor raw sockets.
- The host for an independent external probe remains pending by explicit decision.
- Existing internal metrics, Sentry and operator stay in place. No Grafana alerts.

## Preflight — 2026-10-31 UTC

| Item                       | Observation                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Application release marker | 7460a43ebf953a1fed5ac20ec812908b2763398a                                                               |
| Host source checkout       | d440f6427646c94bcbf12788c9f4cf8c553e0b4e; not the deployed release identifier                          |
| Runtime                    | Linux amd64, Docker29.4.3, overlayfs, cgroupv2, 8CPUs                                                  |
| Docker/containerd          | data-root /var/lib/docker; canonical containerd /run/containerd/containerd.sock, namespace moby        |
| Disk                       | /var ~100.61GiB available of151.85GiB; root ~12.69GiB of48.88GiB; measurements are point-in-time       |
| Memory/load                | ~54.23GiB available of62.59GiB; load about2.3                                                          |
| Existing services          | Core containers healthy; operator healthy, supervisor running; current merged Compose parses quietly   |
| DB prerequisite            | pg_stat_statements installed; crate_observer absent before provisioning                                |
| Intended limits            | Eight services, aggregate944 MiB/1CPU; Prometheus90days or10GB, whichever condition removes data first |

The overlay was staged from merged source 248636d511d7356b732b908bc07ba0b50fdb9b97 (PR #309), without changing the live application checkout, Docker daemon or existing Compose files. A versioned paths overlay resolves monitoring configuration to that source. All 26 previous application container IDs and start times were unchanged after activation. Overlay source and running application release are separate identifiers. File secrets stay outside Git; do not
publish resolved Compose output, password values or personal library payloads.

## Source verification and limits

Backend DSN presence was verified without values for Python runtime families,
readplane and media-worker; configured tracing sample rate0.1. Backend
SENTRY_RELEASE is stale (crate-8ba478acaf4d001ffd32f8629decb4fe9cd86757), unlike
the current application release marker. Do not repair it by redeploying Crate as
part of this infrastructure overlay. Built frontend DSNs and actual per-runtime
Sentry ingestion/symbolication remain unverified; missing runtime environment
variables are not proof that build-time DSNs are absent.

The supervisor status API returned state=ok and monitoring_state=ok, heartbeat age 11.31 s, 13 valid sources, 9 declared coverage gaps, and zero pending/failed/dead-letter deliveries. Thirteen configured rules were inventoried (worker evidence, pending backlog, release evidence, health score, failed-task and release digests). Those observations do not prove notification delivery or an external watchdog. No diagnostic notification was sent. Built Listen/Admin/Docs/Cast bundles contain DSN-shaped literals (presence heuristic, without values); actual event ingestion/symbolication remains unverified.

See [coverage-matrix.md](coverage-matrix.md) for code sources, consumers and known gaps; see
[event-dictionary.md](event-dictionary.md) for the proposed application contracts to review before PR1A.

## Infrastructure validation

- Final-head Linux matrix passed for overlay2 and overlayfs: 65 configuration checks
  per runner; 16 runtime checks on overlayfs and 4 on overlay2. Runtime checks include
  real container metrics, filtered metadata Get and 11 rejected HTTP/2 cases.
  [Run41192009582](https://github.com/thecrateapp/crate/actions/runs/41192009582).
- Closing backend validation passed all eight shards, quality/security and combined
  coverage. [Run41192050270](https://github.com/thecrateapp/crate/actions/runs/41192050270).
  Local scoped checks: 68 passed, 13 opt-in skips; macOS smoke 4 passed / 12 Linux skips.
- Production: six targets up in all six one-minute samples, pg_up=1,
  both redis_up=1, and genuine API/container memory series. Observer has
  connection limit 4, pg_monitor, 5 s statement / 1 s lock timeout, no super/createdb/
  createrole/replication privileges and no INSERT/UPDATE/DELETE on library_tracks.
- Secret directory 0700 root-owned; file mode 0400, Grafana UID 472, exporter UID 65534.
  Prometheus/Grafana data are under /var/lib/crate-observability, not root/home.

## Short measured window

UTC 10:32:24–10:37:24 on 2026-10-31: six samples spanning 300 seconds of normal
host activity. This is an initial infrastructure sample, **not** the agreed
20–30 minute authenticated user flow or a load test.

| Signal                           | Observation                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Overlay working-set memory       | 239.1–343.1 MiB; mean 320.0 MiB, against 944 MiB admission limit                                                   |
| Overlay CPU, 2-minute rate       | Peak observed 0.0894 cores in a complete 8/8 sample; three of six captures have partial service coverage           |
| Monitoring restarts / OOM killed | 0 / false throughout the sampled window                                                                            |
| TSDB head series                 | 6,245–6,267                                                                                                        |
| Prometheus store                 | 324–724KiB during a fresh TSDB bootstrap; no retention forecast                                                    |
| Host /var free                   | Minimum98.38 GiB; storage headroom is not an end-to-end backup claim                                               |
| Maximum scrape duration          | Prometheus 0.010 s; node 0.190 s; cAdvisor 0.175 s; PostgreSQL 0.165 s; cache Redis 1.777 s; durable Redis 0.753 s |
| Maximum observed sample age      | PostgreSQL 39.1 s; other targets 24.2 s or less, consistent with 60 s / 30 s collection                            |
| Available filesystem IO series   | 3/8 services: mean read/write 0.206/0.563 MB/s; startup peaks 0.785/2.929 MB/s; five services unknown              |

CPU quotas did throttle work: available-series sums of cgroup throttled time were
0.250–0.452 seconds/second. CPU and throttling coverage is 8/7/8/7/7/8 services:
Grafana is absent in sample 2 and cAdvisor in 4/5. Missing rates are unknown, not
zero; these partial sums and their mean are not full-overlay totals. The 0.0894-core
peak comes from a complete 8/8 sample. This is not a host CPU utilization percentage or an
application SLO failure. No scrapes failed in the samples, but the full user-flow
window must assess latency before relaxing or tightening budgets. Working-set
memory is not exact process RSS. IO series cover only three services; missing five are unknown, not zero. Filesystem counter sums may count device layers;
they are not an isolated physical-disk benchmark or causal overhead comparison.

Raw records: [baseline-samples.jsonl](baseline-samples.jsonl), range-query
[IO/freshness evidence](baseline-io-freshness.json), and
[computed summary](baseline-summary.json). No credentials or music payloads.

Grafana reached 237.5 MiB of its 256 MiB individual limit (92.8%), despite the
aggregate overlay using only343 MiB of944 MiB. This is a budget-review item before
C0 sign-off: exercise dashboard queries during the functional flow and, if needed,
rebalance the existing aggregate allocation toward Grafana. No limit was changed
or application redeployed during this baseline.

## Container coverage gap

The current cAdvisor job keeps only service labels matching crate-.+.
It exports 30 service groups: 22 existing Crate services plus the eight monitoring
services. Four running companion services — nginx, slskd, tidarr and traefik —
are excluded by that relabel policy. This is **30/34 coverage**, not a containerd
registration failure. Record this gap in C0 and add their finite service names
in a follow-up before claiming complete container coverage. Do not widen socket
permissions, enable arbitrary labels or interpret up=1 as complete coverage.

## Operational control

The live checkout was intentionally not updated by this overlay-only activation.
The staged source uses the current three existing Compose files/project crate,
plus versioned observability/containerd/path overlays. Reproducibility metadata
and the exact command prefix are in activation.json beside the staged source.

Status (stop uses the same command with final argument `stop`):

```bash
ssh crate@95.216.3.27 'python3 /home/crate/crate/.deploy/observability/248636d511d7356b732b908bc07ba0b50fdb9b97/control.py status'
```

The control script permits only status/stop, explicitly selecting the eight monitoring
services. It never runs down or deletes data. The Grafana password remains in its
private mounted secret; it is not stored in this evidence or application.env.
Grafana is reachable only at server 127.0.0.1:3001 through an SSH tunnel.

## Acceptance still pending

- Review the individual Grafana memory headroom, finite companion-container allowlist and IO coverage before treating infrastructure coverage as complete. The later functional window has complete8/8 CPU/throttle coverage with the existing5-minute dashboard query; the exploratory2-minute calculation remains partial.

- Authenticated web journey completed on2026-10-31,12:10–12:36 CET; see [functional-review.md](functional-review.md) for the published/pre-release contrast, network recovery, measured budget and remaining limitations.
- Per-runtime Sentry ingestion/symbolication and supervisor delivery verification.
- Diego's review of baseline, cost, dictionary and the remaining coverage gaps.

The independent external-probe host is deferred by Diego. Shadow infrastructure is active; C0 is not signed off and PR1A has not started.
