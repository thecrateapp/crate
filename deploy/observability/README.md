# Optional infrastructure observability

PR0 provides infrastructure metrics in shadow: Prometheus, Grafana, node-exporter,
PostgreSQL exporter, separate cache/durable Redis exporters and cAdvisor. It adds
no application instrumentation, notification routes or dependencies to Crate.
It does not repair the existing internal metrics; that is PR1A.

This is a manually configured overlay. Home's installer integration belongs to
the later adoption program. Sentry, Admin and the existing operator retain their
current responsibilities. Do not enable Grafana notifications for this stage.

## Before activation

Use Linux with Docker Compose and cgroups accessible to the host collectors.
Docker Desktop can test parsing, endpoints and dashboards, but its VM metrics are
not measurements of the macOS host or production. Production activation and C0
baseline collection are separate, explicitly reviewed steps.

Images are pinned to upstream multi-platform index digests, verified for
`linux/amd64` and `linux/arm64` on 2026-10-31. Check flags and platforms again when
upgrading: change the tag and digest together, run the configuration tests and
exercise collectors before rollout. A mutable tag alone is not a pin.

The eight services have aggregate limits of **944 MiB / 1 CPU**. Treat these as
admission limits, not measured consumption. Validate OOMs, throttling, scrape
duration, series and disk growth during C0. Prometheus keeps **up to 90 days or
10 GB**, whichever retention condition removes data first; WAL/head data and
compaction require additional disk headroom. Reserve at least 20 GiB on `/var`,
not the root filesystem, and monitor actual filesystem space.

## Provision storage and secrets

Defaults (override with exported environment values before calling Make):

| Variable            | Default                                           | Purpose                                                  |
| ------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| `OBS_DATA_DIR`      | `/var/lib/crate-observability`                    | Persistent Prometheus and Grafana directories            |
| `OBS_SECRETS_DIR`   | `/var/lib/crate-observability/secrets`            | File secrets, outside Git                                |
| `OBS_DOCKER_ROOT`   | `/var/lib/docker`                                 | Actual Docker data-root, from `docker info`              |
| `OBS_GRAFANA_PORT`  | `3001`                                            | Loopback-only Grafana port                               |
| `OBS_COMPOSE_FILES` | `docker-compose.yaml docker-compose.project.yaml` | Base files; include the operator overlay if already used |

For home, pass `OBS_COMPOSE_FILES=docker-compose.home.yaml`. Keep the same Compose
project name and network as the existing installation. The overlay reuses the
`crate` network only for PG/Redis exporters and adds an internal monitoring
network. Only Grafana also joins a separate bridge so Docker can publish its
loopback port; Prometheus/exporters do not join that access network. No Crate
service waits for a monitoring service.

Create directories with ownership for the non-root image users:

```bash
sudo install -d -m 0750 -o 65534 -g 65534 /var/lib/crate-observability/prometheus
sudo install -d -m 0750 -o 472 -g 472 /var/lib/crate-observability/grafana
sudo install -d -m 0700 /var/lib/crate-observability/secrets
```

Adapt paths when overriding the defaults. The secrets directory is host-root
private. File-backed Compose secrets preserve host ownership; declaring `uid`
in Compose does not fix unreadable bind-mounted files.

Provision PostgreSQL's monitoring account as a database administrator, using the
actual database name in place of `crate` if different:

```sql
CREATE ROLE crate_observer LOGIN CONNECTION LIMIT 4;
GRANT pg_monitor TO crate_observer;
GRANT CONNECT ON DATABASE crate TO crate_observer;
ALTER ROLE crate_observer SET statement_timeout = '5s';
ALTER ROLE crate_observer SET lock_timeout = '1s';
```

Set its password through interactive `psql` with `\password crate_observer`.
Do not put a cleartext password in SQL files, command-line arguments or shell
history. This account must not be a superuser or have library/table write grants.
`pg_stat_statements` must already be installed in the target database; existing
Crate initialization provides it where permissions allow. Query text is disabled;
only up to 20 statement IDs/timings are exported every 60 seconds. Per-table and
index collectors are disabled to bound work/cardinality. This observes database
connections, not the SQLAlchemy pool inside each application process.

Create these files using a secure editor/password manager. None are examples to
commit with live values:

| File                           | Format                               | Owner / mode          |
| ------------------------------ | ------------------------------------ | --------------------- |
| `grafana-admin-password`       | One strong password                  | `472:472`, `0400`     |
| `postgres-exporter-password`   | The password set with `\password`    | `65534:65534`, `0400` |
| `redis-cache-passwords.json`   | JSON below with the cache password   | `65534:65534`, `0400` |
| `redis-durable-passwords.json` | JSON below with the durable password | `65534:65534`, `0400` |

```json
{ "redis://crate-redis:6379": "<cache-password>" }
```

```json
{ "redis://crate-redis-durable:6379": "<durable-password>" }
```

Use each installation's actual password, even when both Redis roles currently
share one. Exporters have separate files and targets. No key scans, custom Lua or
key-value exports are enabled. Redis credentials are file-mounted rather than
embedded in command lines, URLs or environment variables. They retain the Redis
account's privileges; use a dedicated compatible read-only Redis ACL account
when available rather than assuming the default password is read-only.

Never print resolved Compose configuration, dump `.env`, or include secrets in
screenshots/logs. The validation target uses `config --quiet`.

## Review and explicitly activate

From the repository root:

```bash
make observability-config
make observability-pull
# Only after provisioning and approval to activate this installation:
make observability-up
make observability-status
```

These targets act on the local Docker context; they never SSH. `up` selects only
the monitoring services with `--no-deps`, so it does not start or recreate Crate.
Check the Docker context and base Compose project before using them. On home:

```bash
make observability-config OBS_COMPOSE_FILES=docker-compose.home.yaml
```

For a remote installation, tunnel Grafana instead of exposing it publicly:

```bash
ssh -N -L 3001:127.0.0.1:3001 crate@your-server
```

Open `http://127.0.0.1:3001`, log in as `admin` with the provisioned file password,
and open **Crate infrastructure**. No other exporter or Prometheus port is
published. All services explicitly disable Traefik discovery. The immutable
datasource UID is `crate-prometheus`; dashboards are provisioned from Git.

The dashboard's target `up` means a scrape succeeded; `pg_up`/`redis_up` show
whether the exporter reached its dependency. Neither proves that a user can
play music. A missing series is shown as no data, not zero incidents. Sample age
is separate from the last browser refresh; PG collectors run every 60 seconds.

## Host collectors and access

Node-exporter reads the host filesystem/proc/sys as UID 65534 with no capabilities.
Host network-interface counters are not enabled: a container's `/proc/net` can
reflect its own network namespace even with host proc mounted. Container network
metrics come from cAdvisor; host network coverage needs a separately reviewed
host exporter setup rather than publishing node-exporter on the host network.
cAdvisor reads cgroups and the configured Docker data-root, with 30-second
housekeeping and only CPU/memory/IO/network collection. Only the Compose service
label is admitted; the Prometheus job keeps Crate services. Host run sockets are
masked under cAdvisor's rootfs mount.

cAdvisor accesses Docker through a separate internal HAProxy endpoint. Its exact
GET allowlist is in `docker-proxy.haproxy.cfg`: discovery, daemon metadata,
container/image inspection and events. It denies mutation methods, exec, archive,
logs and unrestricted API paths. The proxy is the only monitoring service with a
Docker socket mount; `:ro` itself is not an API authorization boundary. The
monitoring network, filesystem mounts and inspection metadata remain privileged
operator access and must not be exposed publicly.

On cgroup/permission/API incompatibility, report missing container coverage and
inspect errors. Do not enable `privileged`, expose the Docker socket or remove
the proxy allowlist to obtain a green dashboard. Rootless Docker and alternative
container runtimes require a separate collector review.

The current cAdvisor integration targets Docker's classic **overlay2** storage
driver. Check `docker info --format '{{.Driver}}'` before activation and record it
in C0; `observability-up` refuses other drivers before starting services. Docker's
containerd image store (`overlayfs`) also needs a containerd client
path that this restricted integration does not grant. Do not claim container
coverage or activate this collector on that driver without a separate reviewed
setup; do not grant the containerd socket or privileged mode as a workaround.

## Validation and C0 evidence

```bash
cd app
../.venv/bin/python -m pytest --noconftest tests/test_observability_compose.py -q
```

CI also runs the pinned image's `promtool check config` without network access.
The tests resolve project/home and operator combinations with synthetic values;
they do not start Crate or connect to production.

The dedicated Linux CI job additionally runs an opt-in runtime test with a random
Compose project, disposable PostgreSQL/Redis and dummy credentials. It verifies
real dependency metrics and provisioned dashboards, then removes only its own
resources. Before starting containers it selects the reviewed classic overlay2
backend on its disposable GitHub-hosted runner; this does not configure Docker
on any Crate installation. The normal backend suite skips this test. To run it against a local
Unix-socket Docker context:

```bash
OBSERVABILITY_RUNTIME_TEST=1 .venv/bin/python -m pytest --noconftest app/tests/test_observability_runtime.py -q
```

On macOS, the runtime test verifies Prometheus, Grafana and database exporters;
host/cgroup coverage is checked only on the Linux runner.

C0 remains pending until the actual shadow deployment is reviewed. Record SHA,
versions, Linux architecture, storage location, target health, series count,
CPU/RSS/IO/throttling/OOMs, scrape time and growth; inventory active DSNs/rules
without values. Exercise the agreed 20–30-minute user flow, distinguish unknown
coverage, and decide the independent probe host. This overlay cannot establish
an application SLO, repaired metric history or physical audio QA.

## Stop and rollback

```bash
make observability-stop
```

Stops only the eight monitoring services and preserves all volumes, file secrets
and Crate services. Do not run a merged `docker compose down`, remove volumes or
drop the observer account as routine rollback. Stopping the overlay leaves the
existing internal observability/Sentry/operator behavior intact. Removal of
stored monitoring data or observer grants is a separate reviewed operation.
