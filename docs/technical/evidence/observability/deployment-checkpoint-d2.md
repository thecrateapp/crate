# Deployment checkpoints D2 and adoption: remote monitoring releases

2026-11-01. Branch `codex/observability-deployments`, worktree
`/Users/diego/Code/crate-observability-deployments`. Nothing was pushed, no
production host was contacted and no production state changed.

Diego chose a host lock shared by application, Operator and monitoring deploys,
and an automatic state copy before a Prometheus or Grafana image change.

## Host mutation lease

Application deploys run `deploy-remote.sh` once per step over separate SSH
sessions, so a lock held by one process could not stop another deploy from
landing between steps. `host-lock` writes `owner` and `since` to
`<server>/.deploy/host-mutation.lease`; every changing step (`backup`,
`recovery-snapshot`, `config`, `pull`, `up`, `agent-context`, `rollback`,
`state-rollback`, `cleanup`) holds an `flock` on `host-mutation.lock` while it
runs and refuses another owner's lease. Read-only steps stay free.

`make deploy`, recovery snapshots and both application rollbacks take the lease
after the remote script is uploaded and release it on exit, including after a
failure. The Operator deploy takes and releases it around its sequence and keeps
its own error if the release fails. A stale lease needs
`make deploy-unlock DEPLOY_ID=<owner>`; another owner's lease also needs
`CONFIRM=break-host-lock`. The monitoring script carries byte-identical lock
functions, enforced by a test. Operator hosts take part only after the updated
`deploy-remote.sh` and engine are reprovisioned.

## Remote deployment

`make observability-deploy VERSION=<sha>` refuses a revision that is not on
`origin/main`, builds and verifies the bundle from that commit and uploads it
with the release, preflight and remote scripts of the same commit. Server state
lives in `/home/crate/crate-observability`: verified `releases/<sha>/`, a stable
`live/` project directory, `state/` (`current`, `previous`, `current.backup`,
append-only `history`), per-commit `tooling/` and `backups/`.

A deploy verifies the extracted release against the requested revision and
refuses when `live/` no longer matches the recorded release. Preflight, the
containerd socket check and pulls of missing pinned images happen before any
change. `up -d --no-deps` recreates only services whose image or definition
changed; mounted-file changes restart only their service. Nothing runs `down`
or deletes data.

A release is recorded only after every container runs (healthy where a
healthcheck exists), every active Prometheus target is up and Grafana answers
`/api/health`. Otherwise the previous release is reinstalled and verified and the
command fails. A Prometheus or Grafana image change checks free space, stops only
that service and copies its data with the current image first; a failed upgrade
restores that copy. A copy counts only once it completed and matched the file
count, so a partial copy is never restored over good data. Manual rollback
refuses to run an older Prometheus or Grafana image on migrated state.

The release builder now writes the canonical gzip header itself. It relied on
`gzip.compress`, whose OS byte is `0xff` on Python 3.13 and `0x03` on 3.12, so a
3.12 host rejected the bundle it had just built. The rehearsal found this.

## Adoption of the old overlay

`make observability-adoption-inventory` reports legacy containers (project,
image, mounts), application containers (ID, start time, restart count) and the
number of Docker networks, without changing anything.

`make observability-adopt CONFIRM=adopt-legacy-monitoring` refuses when the
legacy Prometheus or Grafana data is mounted from anywhere other than
`OBS_DATA_DIR`. Before the gap it runs the preflight, pulls images, checks space
for the recovery copy and creates the new project's networks and containers
without starting them; a failure there leaves the legacy monitoring running.
Only then does it stop the eight legacy containers, copy both data directories,
start `crate-observability` on the same data and verify it. A failed adoption
restores the copy and starts the legacy containers again. The command compares
application containers before and after. `revert-adoption` returns to the legacy
containers; `retire-legacy` removes them only when they are stopped, keeping
data and volumes.

The network check exists because a rehearsal on a daemon with exhausted address
pools failed while creating the new networks after the legacy stop. Recovery
worked, but the failure belonged before the gap.

## Checks

- Release tool: 70 cases, including extract, installed-tree verification,
  service planning and the gzip header without `gzip.compress`.
- Lease: 5 cases (owners, confirmation, `flock` contention, dispatcher guards,
  local release on failure) plus the shared implementation test.
- Remote deploy and adoption with fake SSH/SCP/Docker: 17 cases (first deploy,
  config change, failed verification, stateful upgrade with failure, manual
  rollback, lease and drift, non-main revision, legacy writers, redeploy, status,
  inventory, data-directory mismatch, adoption, failed adoption, network creation
  failure, revert and retire), green with bash 3.2 and 5.
- Operator, deploy release and Sentry contracts: 152 cases with bash 5.
- Runtime rehearsal (`OBSERVABILITY_RUNTIME_TEST=1`) with real images: first
  deploy, configuration change restarting only Prometheus, a release with an
  unreachable target rolled back automatically, and a manual rollback, on a clean
  Docker-in-Docker daemon (5 m 52 s) and on OrbStack (5 m 14 s). Sentinel and
  workstation application containers kept their IDs, start times and restart
  counts.
- Adoption rehearsal with real images on a clean Docker-in-Docker daemon (both
  runtime tests together, 8 m 4 s): the old overlay ran in its own project with
  an application sentinel, Prometheus history and a Grafana folder. After
  adoption Prometheus answered queries for a time before the gap, the folder and
  the `crate-prometheus` datasource were still there, the legacy containers were
  stopped and the sentinel was unchanged. Revert restarted the legacy
  containers on the same data; a second adoption and `retire-legacy` removed
  them and kept the Grafana state.
- CI: the fake-based tests run in the light deploy-tooling workflow; the runtime
  rehearsal runs in the observability matrix on overlay2 and overlayfs.

Not exercised: real playback during an adoption, and an application deploy
running concurrently with a monitoring deploy on real Docker (the lease tests
cover the interleaving). Both belong in the production adoption window.

## Production steps awaiting approval

1. Merge and deploy the application release that carries the lease.
2. Reprovision the Operator `deploy-remote.sh` and engine.
3. Prepare `/etc/crate-observability/monitoring.env` and the tooling virtualenv,
   run the inventory and review it.
4. Adopt in a planned window; retire the legacy containers after a few days.
