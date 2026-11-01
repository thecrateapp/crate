# Optional infrastructure observability

PR0 provides infrastructure metrics in shadow: Prometheus, Grafana, node-exporter,
PostgreSQL exporter, separate cache/durable Redis exporters and cAdvisor. It adds
no application instrumentation, notification routes or dependencies to Crate.
It does not repair the existing internal metrics; that is PR1A.

Monitoring has its own Compose project, `crate-observability`, and can be updated
independently from application containers. `compose.standalone.yaml` reuses the
reviewed service definitions without loading application Compose or its `.env`.
The old `compose.observability.yaml` remains available as migration input and for
the existing collector integration harness. Home's installer integration belongs to
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

Grafana receives 384 MiB and Prometheus 256 MiB within that same aggregate budget.
The cAdvisor job admits Crate-prefixed services and the exact companion service
names `nginx`, `traefik` and `slskd`; other service names are not retained.

## Provision storage and secrets

Defaults (override with exported environment values before calling Make):

| Variable                | Default                                | Purpose                                                      |
| ----------------------- | -------------------------------------- | ------------------------------------------------------------ |
| `OBS_DATA_DIR`          | `/var/lib/crate-observability`         | Persistent Prometheus and Grafana directories                |
| `OBS_SECRETS_DIR`       | `/var/lib/crate-observability/secrets` | File secrets, outside Git                                    |
| `OBS_DOCKER_ROOT`       | `/var/lib/docker`                      | Actual Docker data-root, from `docker info`                  |
| `OBS_CONTAINERD`        | `0`                                    | Set `1` only for Docker's `overlayfs` image store            |
| `OBS_CONTAINERD_SOCKET` | `/run/containerd/containerd.sock`      | Actual containerd address from `docker info`, adapter only   |
| `OBS_GRAFANA_PORT`      | `3001`                                 | Loopback-only Grafana port                                   |
| `OBS_APP_NETWORK`       | `crate`                                | Existing external application network for PG/Redis exporters |
| `OBS_ENV_FILE`          | `/dev/null`                            | Explicit monitoring settings; never the application `.env`   |
| `CRATE_POSTGRES_DB`     | `crate` for config parsing only        | Actual observed database; must be explicitly set for startup |

Defaults are available for configuration inspection. **Startup requires explicit
`OBS_DATA_DIR`, `OBS_SECRETS_DIR`, `OBS_APP_NETWORK` and `CRATE_POSTGRES_DB`**,
exported or supplied through a dedicated non-secret monitoring file. For example:

```dotenv
# /etc/crate-observability/monitoring.env — use the installation's actual values
OBS_DATA_DIR=/var/lib/crate-observability
OBS_SECRETS_DIR=/var/lib/crate-observability/secrets
OBS_APP_NETWORK=crate
CRATE_POSTGRES_DB=crate
```

Do not point `OBS_ENV_FILE` at the application `.env`; startup rejects that path.
The preflight asks Compose to resolve only the dedicated environment, keeps its
output private and checks prepared storage. Existing Prometheus and Grafana
directories must be non-empty. A newly provisioned, deliberately empty
installation requires `OBS_INITIALIZE_EMPTY=1`; do not use it to bypass migration
checks. The deployment account needs directory inspection access; an unreadable
directory fails closed. File secrets remain private.

`OBS_COMPOSE_FILES` is retired; commands reject it instead of silently selecting
an application project. Both project and home installations use standalone Compose.
Set `OBS_APP_NETWORK` to the installation's existing network when it differs from
`crate`. This network is external: monitoring never creates or removes it.
Only PG/Redis exporters join it. Monitoring has its own internal
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
make observability-up OBS_ENV_FILE=/etc/crate-observability/monitoring.env
# For a genuinely new installation with prepared empty directories only:
# make observability-up OBS_ENV_FILE=/etc/crate-observability/monitoring.env OBS_INITIALIZE_EMPTY=1
make observability-status
```

For Docker's containerd image store, first verify the driver and socket address:

```bash
docker info --format '{{.Driver}} {{.Containerd.Address}}'
export OBS_CONTAINERD=1
# Export OBS_CONTAINERD_SOCKET if its address differs from the default.
make observability-config
make observability-pull
make observability-up
```

Keep `OBS_CONTAINERD=1` for subsequent status/stop/up commands on that installation.
The adapter does not change Docker's configuration or migrate its image store.

These targets act on the local Docker context; they never SSH. `up` selects only
the monitoring services with `--no-deps`, so it does not start or recreate Crate.
Check the Docker context before using them. Commands explicitly select the
monitoring project and ignore the application's `.env`; export monitoring settings
or supply a dedicated `OBS_ENV_FILE`. On home with a custom existing network:

```bash
make observability-config OBS_APP_NETWORK=my-existing-crate-network
```

### Existing installations: migrate before standalone startup

Changing a Compose project creates different containers. Do not start standalone
monitoring while the previous Prometheus or Grafana is writing to the same data.
`observability-up` checks running service/project labels and refuses startup if
Prometheus or Grafana belongs to another project, or if that check fails. This is
a singleton installation guard, not support for multiple monitoring installations
on one host. Stop only the reviewed legacy monitoring instances during the planned
migration; application, PostgreSQL and Redis remain running. Preserve data,
secrets, permissions and Grafana datasource UID. A monitoring gap is expected.

Before stopping the old instances, manually copy the four required non-secret
settings into the dedicated file, using the real database and the old data and
secret paths. The application `.env` is never imported implicitly. Run
`make observability-start-preflight OBS_ENV_FILE=/etc/crate-observability/monitoring.env`
and verify those paths against the old container mounts. A missing explicit
database or a new empty data directory now blocks startup rather than silently
using the default database or starting a fresh monitoring history.

Remote deployment (below) never migrates an existing installation by itself:
the first deployment requires an explicit confirmation and refuses to start while
Prometheus or Grafana from another project is running. Until the Stack inventory
update is deployed, Admin's existing view still lists only its application
project. Monitoring remains inspectable with its scoped commands and Grafana.

The checkout's application deploy/rollback and the updated home installer no
longer use generic `--remove-orphans`.
This protects legacy monitoring and other project members during transition.
Retiring an obsolete application service now requires an explicit reviewed action;
it is not an automatic side effect of updating unrelated services. This does not
patch a previously provisioned Operator helper or an already released installer.
Reprovision the approved `scripts/deploy-remote.sh` on the Operator host and
upgrade the installer before relying on that protection. The same applies to
the host mutation lease described under remote deployment.

### Review and retire obsolete application containers

The checkout provides a separate local tool; deployments never call it
automatically. Run it against the exact Compose files used by the installation,
while no deployment holds the host mutation lease:

```bash
python3 scripts/application_orphans.py --project-directory /home/crate/crate \
  --compose-file docker-compose.yaml --compose-file docker-compose.project.yaml audit
```

Include the active Operator overlay with another `--compose-file` when present.
Review the service/image/full container IDs and `configuration_sha256` in the JSON report. To retire only
specific reviewed obsolete containers, repeat the same configuration arguments:

```bash
python3 scripts/application_orphans.py --project-directory /home/crate/crate \
  --compose-file docker-compose.yaml --compose-file docker-compose.project.yaml \
  retire <full-64-character-container-id> --confirm-retirement \
  --expected-config-sha256 <configuration_sha256-from-the-reviewed-audit>
```

The tool requires the reviewed configuration digest and rechecks current
configuration and labels before removal. It resolves all Compose profiles, so
an inactive declared service is not mistaken for an orphan. Foreign or
unmanaged containers, one-off containers, declared services, the eight legacy
monitoring services, Agent, Operator and its relay cannot be retired through
this tool. Inventory failures abort. Removal targets immutable full IDs and does
not delete volumes or bind-mounted data. This is explicit service retirement,
not a replacement for deployment locking or a data-retention policy.

### Immutable configuration artifact

Build from a real committed revision after the standalone files are committed:

```bash
make observability-bundle VERSION=<full-commit-sha>
make observability-bundle-verify VERSION=<full-commit-sha>
```

`OBS_BUNDLE` overrides the output/archive path; `OBS_PYTHON` selects Python 3.13
(default `python3`) with `requirements-tooling.txt` installed. Use a dedicated
tooling environment when the host interpreter is not prepared; no application
container is needed. PyYAML is already a Crate dependency and is used here to
validate actual YAML image fields, including quoted keys, aliases and overrides.
The archive, hash and Git operations use the standard library/Git.
The builder reads only the ten allowlisted monitoring files
from the requested Git commit with replacement refs disabled, so dirty working-tree
changes and local `git replace` substitutions are excluded. It
records file hashes, pinned image references and the revision in `manifest.json`.
The Make verifier requires `VERSION` and compares it to the manifest revision;
the Python CLI exposes the same check as `verify <archive> --expected-sha <sha>`.
This compares a declaration to the caller's expected revision. It does not prove
that the contents came from Git or authenticate a re-created bundle; remote
deployment adds the main-branch requirement.
The archive excludes app Compose, `.env`, secrets and data. Verification bounds
both compressed and complete decompressed size, checks physical headers (including
GNU/PAX metadata), exact regular-file members, normalized owner/mode/time/order
and hashes, and never extracts into the filesystem. Corrupt deflate is rejected
through the same normal CLI error contract.

These local artifact commands do not deploy. Verification establishes integrity
and the declared format; it is not a deployment authorization or a signature.

### Remote deployment and rollback

```bash
make observability-deploy VERSION=<full-main-sha>
make observability-deploy-status
make observability-deploy-rollback CONFIRM=rollback-observability
```

The workstation refuses a revision that is not on `origin/main` (fetch first),
builds and verifies the bundle from that commit and uploads it with the release
tooling from the same commit. On the server everything lives under
`/home/crate/crate-observability`, separate from the application checkout:

| Path              | Contents                                                             |
| ----------------- | -------------------------------------------------------------------- |
| `releases/<sha>/` | Verified, extracted releases; never overwritten                      |
| `live/`           | Compose project directory; files replaced in place, manifest last    |
| `state/`          | `current`, `previous`, `current.backup` and an append-only `history` |
| `tooling/<sha>/`  | Release, preflight and remote scripts from that commit               |
| `tooling/venv/`   | Prepared Python with `requirements-tooling.txt`, provisioned once    |
| `backups/<id>/`   | State copies taken before a Prometheus or Grafana image change       |

The server needs `/etc/crate-observability/monitoring.env` and the tooling
virtualenv before the first deployment:

```bash
python3 -m venv /home/crate/crate-observability/tooling/venv
/home/crate/crate-observability/tooling/venv/bin/pip install -r requirements-tooling.txt
```

A deployment takes the host mutation lock, verifies the bundle against the
requested revision, refuses if `live/` no longer matches the recorded release,
runs the storage preflight and pulls only missing pinned images. Only then does
it change anything: `up -d --no-deps` recreates services whose image or Compose
definition changed, and services whose mounted file changed are restarted
(`prometheus.yml` restarts Prometheus, a proxy configuration restarts the proxy,
Grafana provisioning restarts Grafana; dashboards reload within 30 seconds
without a restart). Nothing runs `down` or removes data.

The release is recorded only after every monitoring container runs (and is
healthy where it has a healthcheck), every active Prometheus target is up and
Grafana answers `/api/health`, within `OBS_VERIFY_SECONDS` (180 by default).
Otherwise the previous release is reinstalled, restarted and verified, and the
command still fails. A failed first deployment stops the monitoring services.

When a release changes the Prometheus or Grafana image, the deployment checks
free space, stops only that service, copies its data directory with the current
image to `backups/<id>/` and then starts the new image. If verification fails,
that copy is restored before the previous release starts. The copy is kept and
recorded in `state/current.backup`; remove old copies by hand once the new
version has proven itself. A manual rollback refuses to run an older Prometheus
or Grafana image on migrated state: restore the recorded copy explicitly instead.

The first deployment on a host without monitoring requires
`CONFIRM=first-deploy` (and `OBS_INITIALIZE_EMPTY=1` only for a new,
deliberately empty installation). A host that already runs the old overlay is
adopted instead.

#### Adopting the old monitoring overlay

The old overlay runs the eight monitoring services inside the application
project. Adoption moves them to `crate-observability` on the same data, with a
monitoring gap of a few minutes and no change to application containers.

1. Prepare `/etc/crate-observability/monitoring.env` and the tooling virtualenv
   (above), then take a read-only inventory:

   ```bash
   make observability-adoption-inventory VERSION=<full-main-sha>
   ```

   The report (also saved under `adoption/`) lists each legacy container with
   its project, image and mounts, and every application container with its ID,
   start time and restart count. Check that `OBS_DATA_DIR` and
   `OBS_SECRETS_DIR` match the legacy mounts.

2. In a planned window, adopt:

   ```bash
   make observability-adopt VERSION=<full-main-sha> CONFIRM=adopt-legacy-monitoring
   ```

   Before changing anything the command refuses if the legacy Prometheus or
   Grafana data is mounted from somewhere other than `OBS_DATA_DIR` (that would
   start a new history), runs the storage preflight, pulls missing images and
   checks space for a recovery copy. It then stops only the eight legacy
   containers, copies both data directories to `backups/<id>/`, starts
   `crate-observability` on the same directories and verifies it like a deploy.
   If verification fails, the copy is restored and the legacy containers start
   again. It finally compares the application containers with the inventory
   taken before the stop.

3. Confirm history before the gap in Prometheus, the **Crate infrastructure**
   dashboards and the `crate-prometheus` datasource in Grafana. Record the gap
   (start and end are in the command output).

4. The legacy containers stay stopped, not removed. Until they are retired,
   return to them with:

   ```bash
   make observability-revert-adoption CONFIRM=revert-adoption
   ```

   which stops `crate-observability`, starts the legacy containers on the same
   data and keeps the adopted state aside for inspection.

5. Once the adopted monitoring has run cleanly (a few days), remove the stopped
   legacy containers. Data, secrets and volumes are kept:

   ```bash
   make observability-retire-legacy CONFIRM=retire-legacy-monitoring
   ```

   Then point the projector and Traefik overlays at the standalone networks
   (`OBS_PROMETHEUS_QUERY_NETWORK=crate-observability_prometheus-query`,
   `OBS_TRAEFIK_METRICS_NETWORK=crate-observability_traefik-metrics`).

#### Host mutation lease

Application deploys, Operator deploys and monitoring deploys share one lock in
`/home/crate/crate/.deploy`: `host-mutation.lock` (an `flock` held while a step
changes the host) and `host-mutation.lease` (the owner of a multi-step deploy).
`make deploy` takes the lease before its first change and releases it on exit,
including after a failure; every changing step of `deploy-remote.sh` refuses
while another owner holds it. A monitoring deploy runs as one step under the lock
and refuses while an application deploy owns the lease. If a process died and
left a lease behind, release it with `make deploy-unlock DEPLOY_ID=<owner>`;
another owner's lease needs `CONFIRM=break-host-lock`. Operator hosts must be
reprovisioned with the updated `deploy-remote.sh` and engine before Operator
deploys take part.

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

Two Docker storage backends are supported explicitly: classic **overlay2** with
`OBS_CONTAINERD=0`, and the containerd image store (**overlayfs**) with
`OBS_CONTAINERD=1`. `observability-up` refuses a mismatch or any other driver
before starting services. Record the actual driver/address in C0.
The containerd socket's canonical host path must be under `/run`, where cAdvisor's
host rootfs is masked. Make resolves symlinks and refuses paths outside that tree;
do not bypass this guard with a direct Compose invocation. Alternate socket
locations require a collector/mount review before activation.
Set this variable in the exported environment or as a Make argument. Make exports
its default too, so the path checked by the guard is the same one Compose mounts;
a divergent `.env` value cannot silently override it.

The optional `compose.containerd.yaml` reuses the same proxy, image and resource
limits. Only that proxy mounts the host containerd socket, with automatic path
creation disabled. `runtime-proxy.haproxy.cfg` permits exactly the gRPC
`containerd.services.containers.v1.Containers/Get` RPC through HTTP/2 POST and
exactly one `containerd-namespace: moby` header. Other namespaces, duplicate
namespace headers, task/list/version RPCs and mutations are denied. Docker's
GET filter is unchanged. Neither socket being mounted `:ro` grants read-only API
semantics; the protocol filter provides that restriction.

cAdvisor receives only a read-only volume containing the proxy's Unix listener,
never the raw containerd socket. The same filtered endpoint listens internally
on port 2376 for validation; neither endpoint is published by the overlay. Make
waits for the proxy to become healthy before starting cAdvisor, whose containerd
client initializes once. After a failed startup, repair the proxy and recreate
cAdvisor rather than accepting `up=1` without container metrics. No privileged
mode or Docker daemon changes are required.

## Validation and C0 evidence

```bash
cd app
../.venv/bin/python -m pytest --noconftest tests/test_observability_compose.py tests/test_observability_containerd.py -q
```

CI also runs the pinned image's `promtool check config` without network access.
The tests resolve project/home and operator combinations with synthetic values;
they do not start Crate or connect to production.

The dedicated Linux CI job additionally runs an opt-in runtime test with a random
Compose project, disposable PostgreSQL/Redis and dummy credentials. It verifies
real dependency metrics and provisioned dashboards, then removes only its own
resources. A Linux matrix exercises both `overlay2` and `overlayfs` on separate,
disposable GitHub-hosted runners; it does not configure Docker on any Crate
installation. With overlayfs it also verifies a real metadata Get through the
proxy and HTTP 403 for other RPCs/namespaces, including duplicate headers. The
container metric must identify the fixture's Redis container, not just any host
container. The normal backend suite skips these tests. To run against a local
Unix-socket Docker context (install `h2==4.3.0` for Linux overlayfs):

```bash
OBSERVABILITY_RUNTIME_TEST=1 .venv/bin/python -m pytest --noconftest app/tests/test_observability_runtime.py -q
```

On macOS, the runtime test verifies Prometheus, Grafana and database exporters;
host/cgroup coverage is checked only on the Linux runner.

C0 remains pending until the actual shadow deployment is reviewed. Record SHA,
versions, Linux architecture, storage location, target health, series count,
CPU/RSS/IO/throttling/OOMs, scrape time and growth; inventory active DSNs/rules
without values. Exercise the agreed 20–30-minute user flow and distinguish unknown
coverage. Diego deferred the independent probe host decision on 2026-10-31;
record it as pending, not as an installed external probe. This overlay cannot establish
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
