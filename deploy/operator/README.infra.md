# Private infrastructure bridge

This is a separate host process and authority from Crate's API, database, operator
supervisor and domain approval provider. It is disabled until explicitly provisioned.
Nothing here installs a service, modifies the default read-only Hermes profile,
contacts Telegram, approves releases or starts production jobs automatically.

## Host provisioning

Install the Python package (`deploy/operator`, `scripts/release_manifest.py`) under
`/opt/crate-infra`, owned by root with no group/other write permission. Copy the
example policy to `/etc/crate-infra/policy.json`. Provision four **different** secrets
of 32–256 bytes, private mode 0600: read, prepare, apply, and native callback HMAC.
Infrastructure credentials must also differ from domain and supervisor credentials.
The bridge validates paths, ownership of every ancestor, secret permissions,
allowlisted services, human operation capabilities and a pinned extension-compatible
`pgvector/pgvector:pg15@sha256:...` (or versioned `0.x.y-pg15`) image. Vanilla
PostgreSQL images are rejected: Crate requires vector, pg_trgm and pgcrypto.
The example intentionally has an invalid placeholder image digest and `enabled:false`.

Provision root-owned state/backups/release directories and a root-owned host checkout
at the configured `server_path`. The checked-in unit uses `/opt/crate-host`; it is
not directly compatible with a user-writable `/home/crate` checkout. All executable
host scripts and live deployment configuration must be root-controlled. The fixed
closure in `infra_deploy.py` validates the actual `deploy/hermes/activate_context.py`,
`deploy-remote.sh`, both live Compose files, `.env`, optional active Hermes overlay,
active/candidate release files, optional federation config, staging/backup directories,
per-operation backup descendants and the configured context marker destination.
Present consumed files and their ancestors must be root-owned, non-writable by group
or others, regular and not symlinks; dangling symlinks are also rejected. Optional
absence is explicit. The host `.env` must be UTF-8 without NUL bytes. `DATA_DIR`
uses the shell's LF-delimited, last-matching-key and surrounding-quote semantics;
ASCII control characters (including a retained CR from CRLF) are rejected before
startup/effects, so validation cannot select a normalized alternative destination.
Install this revision of `deploy-remote.sh`: helper calls use
`python3 -I`, preventing local-module/cwd/user-site shadow imports. The helper's fixed
stdlib imports are checked; new local/import dependencies require a code review and
closed enumeration update. The unit
writes only its runtime/state/host directories, has no public listener, and runs as
root because Docker host authority is privileged. Install the unit only after
reviewing these explicit limits. The `crate-infra-relay` group permits the separate
relay to connect to the Unix socket; it must not permit writes to policy or code.

Start explicitly with:

```sh
python3 -m deploy.operator.infra_server --config /etc/crate-infra/policy.json --execute
```

Without `--execute`, even inspection cannot invoke real Docker. Production restore
is not implemented: only `crate-infra-disposable` is an accepted restore target.
State is a dedicated durable single-writer store. Do not share the supervisor's
state directory. A second process with the same store fails its host writer lock.

## Operations and fixed contracts

- `restart`: target is one exact allowlisted Compose service in project `crate`.
  Default examples permit only API/readplane. Data stores and personal/dedicated
  Hermes are outside the closed application allowlist. The plan binds container ID,
  image ID, start time and current health. Immediately before mutation these must
  match. The command is `docker restart --time 30 <captured-container-id>`; success
  requires same container/image, changed start time and actual Docker health, with
  a bounded 60-second health wait. Preparation and the final pre-effect check reject missing healthchecks with
  `health_coverage_missing` and exact service names, before mutation. Provision
  meaningful healthchecks before enabling their operations; unhealthy/timeout
  after execution still yields indeterminate.
- `backup`: target `postgresql`, version null. Online `pg_dump --format=custom
  --no-owner --no-acl` from the captured `crate-postgres` container ID. Local PostgreSQL
  socket authentication must be provisioned; passwords are never request arguments.
  **Coverage is PostgreSQL only. Redis, audio, artwork, configuration and image
  rollback are excluded.** These exclusions appear in the exact human-reviewed
  plan, manifest and outcome. It is not a coordinated database/Redis snapshot.
  A failed dump or restore never produces a sealed successful backup.
- `restore`: target `crate-infra-disposable`, version the exact SHA256 of a sealed
  backup manifest. Verify manifest identity and dump checksum, then actually restore
  into a fresh pgvector-compatible PostgreSQL 15 container with no network, no persistent volume, read-only
  rootfs and bounded tmpfs/resources. `pg_restore --exit-on-error` must succeed and a
  live catalog query must find public tables, vector, pg_trgm and pgcrypto. Extension
  versions are recorded; pg_stat_statements is also recorded when present and its
  preload library matches Compose. Evidence comes from the restored
  instance. An existing target is never deleted to make room. Cleanup removes only
  the container successfully created by this job. Nothing restores production.
- `deploy`: target `crate`, exact lowercase 40-hex release SHA. Requires explicit
  allowlisting of the entire closed application fleet, and a host-approved directory
  `<approved_releases>/<sha>/` with `release-manifest.json`, `release.env`,
  `docker-compose.yaml`, `docker-compose.project.yaml`, plus `approved.json` containing
  the filename→SHA256 mapping of those four assets. The native review binds those
  hashes, full immutable manifest, current fleet fingerprints and local deploy-script
  hash. Before effects, the candidate is resolved with fixed `docker compose config
  --format json` arguments and exact approved image variables; every application
  service must have an explicit non-disabled candidate Compose healthcheck. Thus a
  candidate that removes checks is rejected even when current containers are healthy.
  `release.env` must exactly match `render_release_env`; the repository's
  `validate_manifest` validates every immutable image. Root approval is provisioning,
  not a model tool. Plan review cannot approve arbitrary new asset files.

The plan also binds non-secret SHA256 digests of **all fixed effective host inputs**,
including `.env`, active overlay, executed helpers, current and staged release files,
and the fully resolved candidate Compose configuration. Candidate resolution uses the
host project directory, the same active overlay and exact intended release variables;
resolved secret values never leave the process. Optional files appearing/disappearing
invalidate approval. Host inputs are rechecked before effects and between stages.
The exact final host-input digest map is reviewed too. The bridge predicts the existing
script's environment setter byte-for-byte; staging/configuration may make only those
specific approved transitions. It never accepts the newly observed state as a baseline.
Generated rollback copies and changed-image/service lists are checked against expected
content derived from the plan before pull/up/rollback consumes them. Unexpected drift
stops execution. Rollback runs only when inputs remain trusted and are original or an
exact known intermediate transition; altered helpers/overlays/selection files suppress
rollback and leave the operation indeterminate for host inspection.

Deploy runs the installed local `scripts/deploy-remote.sh` with fixed steps:
`release-preflight`, `backup`, stage exact approved files, `preflight`, `config`,
`pull`, `up`, `verify`. Failures during staging/configuration/start/verification invoke
its `rollback` and remain indeterminate. These are local host commands, never the
laptop SSH orchestrator `make deploy`. Rollback preserves the existing script's
image/config contract; it does not promise reversal of database migrations. No
cleanup/prune or production state-rollback is exposed. Public HTTP checks are off;
local host verification and stronger image/health checks are required. Native context
activation/provenance publication is the separate packaging layer's responsibility.

Each deployed container must match its expected image ID; each exact image reference
must occur in Docker `RepoDigests`, and the OCI revision label must equal that
**entry's** `source_sha`. Reused images with an older source SHA are valid. The worker
entry also covers `crate-fast-worker`, in addition to its manifest aliases
`crate-worker`, `crate-projector`, `crate-maintenance-worker`. Every allowed deployed
service requires meaningful Docker health. Missing check coverage rejects
preparation/pre-effect before mutation; failing health after effect is indeterminate.
Current source Compose config explicitly checks API, readplane and cast receiver.
Checks are still needed for worker, fast-worker, projector, maintenance-worker,
analysis-worker, playback-worker, media-worker, UI, Listen, site and docs. Task 7
owns a meaningful operator overlay; the bridge does not silently add generic
process-running checks or API-dependent recovery checks.

The subprocess runner uses fixed argv and `shell=False`, a sanitized environment,
process-group timeout/termination, bounded captured output, and an 8 GiB dump cap.
Child output/errors are never returned or audited. The disposable restore has an
8 GiB data tmpfs, 10 GiB memory limit, 2 CPUs and 128 PID limit; larger backups need
separate reviewed provisioning/code changes. Raw Docker inspect environment/config
is never exposed to the model.

## Native and model interfaces for packaging

Host listener: Unix HTTP `/run/crate-infra/bridge.sock`, mode 0660. No TCP port.
All requests are POST, bounded to 16 KiB, fixed Content-Length, no chunked bodies;
eight concurrent connections maximum. Routes:

| Route | Authority | Body |
|---|---|---|
| `/v1/read` | dedicated read bearer | exactly one of `service` or `plan_id` |
| `/v1/prepare` | dedicated prepare bearer | `operation,target,version?,human_id` |
| `/v1/apply` | dedicated apply bearer | `plan_id,plan_hash` |
| `/v1/reconcile` | read bearer | `plan_id` |
| `/v1/native/events` | separate native HMAC only | native event schema |

`prepare` persists the immutable document/hash and begins paginated native delivery.
The current locally provisioned numeric human must have that operation capability.
`apply` returns idempotent admission only after independent native approval. Approval
itself durably accepts the exact operation; a host worker executes it without needing
another model turn. Model bearer credentials cannot approve. Key/config/engine
changes invalidate pending plans. Current policy is rechecked at native decision,
admission, immediately before effect, and between fixed deploy stages.

`infra_inspect` returns `instance,observed_at,source=host_docker,coverage=exact_service`,
plus `service,container,image,started_at,fingerprint,healthy,healthcheck_configured,
image_provenance`. HTTP 409 preparation responses expose only the safe structured
`health_coverage_missing` error with exact `services`; the MCP adapter preserves
that evidence as an error tool result.
`image_provenance` has `repo_digests`, actual OCI `source_sha` or null, and
`availability=available|incomplete`. Source labels/refs come from the exact Docker
image ID. These fields permit separate bounded freshness/provenance publication;
there is no timestamp fabricated from API availability or deployment time.

Packaging must provide **a separate limited relay**, bound only to the private
Compose network at `http://crate-infra-relay:8788`, forwarding only the five listed
paths to this one Unix socket, with method/body/timeout/concurrency bounds. The relay
must not accept caller-selected destinations or redirects, own host execution/native
HMAC keys, mount Docker's socket, or depend on API/DB. Only that relay mounts the
bridge Unix socket. Hermes uses the private relay URL; host loopback is not reachable
from an ordinary container. Task 7 owns relay/Compose installation and cold-start tests.

Native module `deploy/hermes/plugins/crate_confirmation/infra.py` exports
`InfraProvider()`, with namespace `ct:i:`, pattern
`^ct:i:[a-f0-9]{32}:(next|approve|reject)$`, and independent fixed relay transport.
Register it with `NativePresenter(ctx, providers)` independently of domain provider
construction/availability. It reads only:

- `/run/crate-hermes-infra-native/callback-key`
- `/run/crate-hermes-infra-native/identity.json` containing
  `{"instance_id":"...","allowed_users":[123]}`.

It uses the same `pending`, `delivered`, `callback`, `outcome_delivered` shapes and
Spanish `Siguiente`, `Aprobar`, `Rechazar` buttons as the domain provider. Full exact
JSON is ASCII-escaped losslessly and split into bounded pages. The final approval
requires every page receipt and exact final message ID/private human. HMAC-SHA256
signs `POST\n/v1/native/events\n<unix timestamp>\n<32-hex nonce>\n<exact JSON bytes>`.
The window is 60 seconds; transport nonces and human update/query identities persist.
Bearer headers on native requests are forbidden. Native HMAC is distinct from domain
and supervisor authority. Delivery retries are bounded to 20 per page/outcome, spaced
10 seconds, with stable confirmation IDs. Exhaustion retains inspectable state.

Model adapter: `python -m deploy.operator.infra_mcp`, newline stdio MCP protocol
2025-03-26, tools `infra_inspect`, `infra_prepare`, `infra_apply`, `infra_reconcile`.
It reads scoped bearer files `read-token`, `prepare-token`, `apply-token` under
`/run/crate-infra-client`; it has no native signing key, Docker/SSH/host credentials,
command tool, approval tool or arbitrary destination. All tokens stay inside the
adapter transport and never enter tool results. Install only in an explicit operator
profile. The default read-only profile remains unchanged.

## Crash handling and local evidence

The store fsyncs accepted→effect_started→outcome separately. A crash after
`effect_started` becomes `indeterminate` on restart and never replays automatically.
Reconciliation only observes postconditions; it never executes the effect again.
Any unresolved indeterminate plan quarantines further host effects, including other
accepted plans, until observation proves the outcome. This also prevents a restarted
bridge from overlapping a possibly orphaned host command. Unresolvable uncertainty
requires host-operator maintenance; model/native tools cannot dismiss it.
A crash before the effect boundary may safely continue only after fresh authority,
expiry, cooldown and host precondition checks. All infrastructure effects share one
host worker lock and durable cooldown. A crash during restore may leave its uniquely
reserved fixed disposable target: inspect and remove it manually before a new plan;
no automatic deletion/reuse occurs. Uncertain backup with no recorded digest stays
indeterminate; operators may inspect its sealed directory manually.

Plan capacity is 500 and native human receipt capacity 100000; unresolved entries are
never discarded. Full storage denies new work. Audit events are bounded to the shared
2000-event journal; retain exports separately for longer history. Never hand-edit
active state. No production, real Telegram or model-provider acceptance is claimed.

Run isolated tests with the repo's available Python environment:

```sh
python -m pytest app/tests/test_infra_bridge.py app/tests/test_infra_deploy.py -q
CRATE_INFRA_DISPOSABLE_TEST=1 python -m pytest app/tests/test_infra_bridge.py app/tests/test_infra_deploy.py -q
```

The explicit disposable case requires local Docker and the pinned pgvector PG15
image in the test. It creates a new source fixture and the reserved disposable restore
target, uses network none, restores real vector(20) data with HNSW/trigram indexes and four
extensions twice, rejects a corrupt dump and cleans
up its containers. It never executes a production deployment or touches an existing
application container. Full deployment acceptance remains separately provisioned.
