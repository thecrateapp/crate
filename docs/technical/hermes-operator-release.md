---
title: Crate Operator candidate and rollout
summary: Complete opt-in operator architecture, authority and coverage matrix, root provisioning, disposable acceptance and rollback.
section: operations
audience: [operator, developer]
keywords: [hermes, operator, provenance, approval, recovery, rollout]
status: canonical
order: 127
verified: 2026-10-26
sources:
  - deploy/operator/compose.operator.yaml
  - deploy/operator/provision.py
  - deploy/operator/provenance.py
  - deploy/operator/infra_deploy.py
  - deploy/operator/infra_executor.py
  - deploy/operator/README.infra.md
  - deploy/operator/crate-infra.service
  - deploy/operator/config.operator.example.json
  - deploy/operator/watchdog.example.json
  - deploy/hermes/runtime.py
  - deploy/hermes/domain_mcp.py
  - deploy/hermes/plugins/crate_confirmation/__init__.py
  - deploy/hermes/plugins/crate_confirmation/supervisor.py
  - app/crate/operator_provenance.py
  - app/crate/role_readiness.py
  - app/crate/broker.py
  - app/crate/projector.py
  - app/crate/projector_daemon.py
  - scripts/operator_candidate.py
  - scripts/agent_setup.py
  - scripts/deploy-remote.sh
  - scripts/operator_gateway_smoke.py
  - scripts/operator_gateway_probe.py
  - app/tests/test_operator_confirmation_status.py
  - scripts/hermes_context.py
  - app/tests/test_operator_domain_integration.py
  - app/tests/test_operator_integration.py
  - app/tests/test_operator_packaging.py
---

# Crate Operator candidate and rollout

The integrated candidate completes the opt-in Crate Operator path in source; it runs
Nous Research's Hermes Agent under the hood. Crate Agent (`agent` profile) remains
the read-only default. A new instance can start Crate Operator with only
`docker-compose.yaml` and `make agent-init AGENT_PROFILE=operator` (see
[Crate Agent and Crate Operator over Telegram](crate-agent.md)); everything below adds the provenance, bridge and
supervisor authority. No production permission, installation,
deployment, Telegram bot ownership or personal assistant state changes as part of
building or testing this candidate. Final whole-branch review and a separately
approved consolidated rollout remain required.

## Coverage and authority

| Component                  | Implemented authority and evidence                                                                                                                                             | Operational limit                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery and observations | Bounded inventory, status, pipeline and dedicated Smart Mix coverage/campaign observations                                                                                     | Persisted observations retain timestamps and gaps; source context does not prove health                                                                                    |
| Domain operations          | Existing plans, current grants/roles, exact native human review, idempotent admission, worker checkpoints, cancellation and durable outcomes                                   | Tidal single-album or up-to-50-album batch plans share one exact Telegram approval; Soulseek transfer and publication remain separate; partial effects need reconciliation |
| Independent supervisor     | Durable incidents/outbox, bounded watches, deterministic rules, signed fixed delivery                                                                                          | Separate single-writer state; source gaps and transport ambiguity remain explicit                                                                                          |
| Native domain review       | Every exact page, private numeric human, current role/binding, version and one-use receipts                                                                                    | At most 20 delivery attempts per page/outcome; expiry requires a new reviewed plan                                                                                         |
| Native incident decisions  | `/crate_ack` and `/crate_silence`, own HMAC and current local operator map                                                                                                     | Reason and TTL required; silence suppresses notifications without erasing monitoring/history                                                                               |
| Infrastructure             | Independent root Unix bridge, fixed relay, exact plans, own native key/human map, restart/backup/deploy/disposable restore                                                     | No model shell, Docker socket, paths or commands; production restore is denied                                                                                             |
| Release provenance         | `crate-provenance` container: actual running images through a list/inspect-only Docker filter, official GHCR digests or exact release entries, context hash, deployment marker | Unverified, stale, deploying and rollback evidence closes mutations; reads remain available; local builds stay read-only                                                   |
| Offline acceptance         | Real PostgreSQL, MCP SDK transports, actual pinned gateway, fake loopback Bot API, native recovery and reconnect                                                               | Synthetic host restart and Bot API; no real Telegram, provider inference or physical production acceptance                                                                 |

The server identifies operator principals from administrator-controlled
`CRATE_OPERATOR_PRINCIPAL_IDS`, a comma-separated list of exact principal UUIDs.
It is set on API and applicable workers by the operator overlay. The caller cannot
remove it from an RPC. `get_confirmation_policy` reports whether this server binding
is required; the managed adapter rejects a write profile without it. Calls made
directly with that credential encounter the same server checks. Non-operator legacy
integrations keep their existing behavior. A persisted bound plan stays protected
even if its principal later leaves the configured list; newly adding a principal
also closes its old unbound plans. Bound operator plans require approval even if
an administrator mistakenly clears the ordinary approval flag; legacy unplanned
health/retry/cancel calls cannot bypass that requirement. Directed photo repairs
retain their existing plan shape and bind provenance in immutable execution JSON.

Preparation captures the stable identity into the existing durable job payload;
plan publication includes it in the exact document/execution hash. Native
presentation, human approval, admission, job load, effect start and every existing
worker authority checkpoint validate a fresh observation matching that identity.
The identity includes instance, release SHA, context manifest SHA256 and actual
per-service image IDs/digest references/source SHAs. Observation time is checked
for freshness (90 seconds) but is not part of identity. A fresh timestamp for the
same identity does not invalidate pending plans. A deployment marker is checked
directly on each boundary, so a previous fresh observation cannot authorize work
during deployment. Drift after an effect produces a durable partial outcome and
never an automatic replay.

## Independent startup and completion flow

`crate-operator`, `crate-infra-relay` and `crate-operator-supervisor` have no
API/DB startup dependency. Operator runtime selects its mode before reading domain
context. Its fixed stdio catalog can initialize offline; each mutation rechecks
live discovery, current approval policy and server authority. Failed API/context
reads do not remove independent native providers. When the API returns, the same
adapter and gateway can use current domain reads and mutation preparation without
a restart. No cached grant authorizes an effect. The Crate Agent startup policy
is unchanged. Standard MCP `_meta` is discarded before domain dispatch; it supplies
no authority. Expected API/policy unavailability returns a normal MCP availability
report with an unverified outcome, preserving the healthy local connection. It is
never evidence that a failed forwarded mutation did not execute; inspect its
existing plan/job before retrying.

After native approval admits a domain job, the persisted native outcome registers
`/v1/watch-job` using the separate supervisor read/watch bearer before acknowledging
outcome delivery. Failed registration leaves the outcome pending for bounded
native retries. No Admin per-plan step, second human command or model turn starts
monitoring. The independent supervisor sends terminal/cancellation and subsequent
verification/projection changes through its durable signed delivery route. A task
completion, applied effect, verification, and projection remain separate fields.
The same durable confirmation row stores a native enrollment receipt only after
the supervisor returns the exact job and a bounded expiry. Enrollment confirms
registration, not current polling, transport delivery or effect verification.
`get_confirmation_status(confirmation_id)` reads the exact admitted result,
delivery state/attempts (maximum 20), and enrollment state. It requires the
originating principal/credential, unchanged authorization context, current binding,
instance and grants; it remains usable during provenance drift or disabled writes.
It neither approves nor changes state and exposes no arbitrary query.

A full watch queue (30) or network failure retries through that existing native
outbox, surviving presenter restarts without replaying admission. On the final
attempt the presenter explicitly reports unavailable monitoring in the same
Telegram outcome. If that delivery also fails, the read contract reports exhausted
delivery; there is no unbounded retry. Missing receipts are unverified, failed or
expired enrollment is unavailable. Message delivery alone never confirms a watch.

For incident decisions, the private authenticated human sends:

```text
/crate_ack <incident-key> <revision> <ttl-seconds> <explicit reason>
/crate_silence <incident-key> <revision> <ttl-seconds> <explicit reason>
```

TTL is 1–86400 seconds. The native plugin signs a receipt with its own supervisor
key and Telegram update identity. `/v1/native/decision` accepts only this signature,
never a bearer; it checks current local allowlist, exact revision, 120-second
issuance, reason, TTL and durable replay nonce. The service reloads its local map
for each decision; changing the signing key closes decisions until restart.
Domain and infrastructure keys do not confer this authority.

## Root-managed provisioning for one future rollout

`deploy/operator/provision.py` is an executable **offline scaffold**, invoked only
by a human administrator from a root-owned extracted, reviewed candidate:

```bash
python3 -m deploy.operator.provision --reviewed-source /opt/reviewed-crate-candidate --install-scaffold
```

It refuses existing `/opt/crate-host` or `/opt/crate-operator` roots. It installs
reviewed helper/config assets, empty context/public directories and separate state
and secret directories. It invokes no Docker, systemd, network, deployment or
credential generation. It copies no personal state and leaves `.env` absent, so
execution remains unavailable until explicit administrator configuration. Test this
first in a disposable host. Existing roots require reviewed maintenance rather
than rerunning the scaffold or weakening ownership checks.

One consolidated rollout must provision:

1. A root-controlled `/opt/crate-host` tree and exact effective `.env` containing
   `CRATE_OPERATOR_ROOT=/opt/crate-operator`, instance/principal IDs, immutable image
   references, explicit `CRATE_MCP_ACTIONS_ENABLED=true`, and the actual
   administrator-chosen library/cache/config mounts.
   Preserve the live `/home/crate/crate` checkout and data. The new tree must use the
   same explicitly reviewed Compose project/service identities during the eventual
   coordinated switch; do not start two fleets against the library.
2. Root-owned assets under `/opt/crate-operator/assets`, context under
   `/opt/crate-operator/context`, and the reviewed overlay installed at
   `/opt/crate-host/.deploy/crate-operator.compose.yaml`. Only the dedicated gateway home and
   supervisor state are owned by their runtime UID. `HOME`, `XDG_STATE_HOME` and
   working directory are inside the dedicated gateway home. Explicit child MCP
   environment carries the internal URL and required Crate Host header. Public
   context directories are 0755 and exported content/markers are 0644 at each atomic
   replacement, including activation under the bridge’s private 0077 umask. Secret directories use distinct
   files with permissions granting only their actual consumers access.
3. Domain write credential with mandatory approval and current least-privilege
   grants, separate read-only supervisor credential, current Crate human binding,
   domain HMAC, independent infra read/prepare/apply tokens and native HMAC, supervisor
   read/watch bearer and incident HMAC, and delivery HMAC. Never reuse secrets.
   Native identity files use the same fixed instance and reviewed numeric users.
   Model adapters have no native signing keys in arguments/environment/results.
   `make agent-init AGENT_PROFILE=operator` with `CRATE_OPERATOR_ROOT` pointing at this
   root provisions everything in this item and item 4 except the infra tokens and keys
   (the approval-required credential, the supervisor credential, the binding, every
   domain/supervisor/delivery key, both identity files and the supervisor config); see
   [Crate Agent and Crate Operator over Telegram](crate-agent.md). Run it as root so the
   files are owned by `PUID`, and review the result like any other root-provisioned input.
4. Supervisor config from `config.operator.example.json`; set its fixed `mcp_host`
   to the API’s exact allowed public authority (`api.${DOMAIN}` unless
   `CRATE_MCP_ALLOWED_HOSTS` names another; `api.example.com` in the example), even while `mcp_url` uses the private `http://crate-api:8585/mcp` route. Match any
   custom `CRATE_MCP_ALLOWED_HOSTS` without wildcard expansion. Dedicated gateway
   `secrets/delivery/{secret,destination}` for the fixed private allowlisted
   `deliver_only` route; distinct supervisor state, infra state/backups and external
   watchdog state. No service gets the Docker socket except the separately
   root-authorized host executor, which uses the local CLI, and the
   `crate-provenance-docker` filter, which forwards only container listing and image
   inspection ([Release provenance publisher](#release-provenance-publisher)). Only the
   relay mounts `/run/crate-infra`; the gateway receives only its fixed private HTTP
   route.
5. Root `/etc/crate-infra/policy.json`, separate 0600 host secrets, pinned compatible
   pgvector PG15 image, allowlisted services/humans, and host-approved release assets.
   Install the reviewed `crate-infra.service` only at the final authorized activation;
   release provenance needs no host unit. `${CRATE_OPERATOR_ROOT}/provenance` must be
   owned by `PUID` like the gateway home and supervisor state. Bridge execution needs `enabled:true` and
   `--execute`. Provision meaningful current/candidate healthchecks before enabling
   restart/deploy authority.
6. An external watchdog on another host using `watchdog.example.json`, its own
   state/token/destination, and private authenticated connectivity. Its `.invalid`
   sample addresses are deliberately unusable until configured. Route its private
   gateway probe to the pinned webhook adapter’s `:8644/health`, and supervisor
   status to `:8791/v1/status`; the sample adds no public ingress. Telegram control is
   Crate Operator: the legacy built-in bot was removed (migration 138 deletes its
   stored settings and plaintext token), and the supervisor is the only push channel
   to the Crate Operator chat. `--no-telegram` is accepted as a no-op for one release.

The normal deployment entry point remains `scripts/deploy.sh` / `make deploy` for
the existing managed checkout. It must not silently gain root write authority or
move that checkout. It ships `deploy/operator/compose.operator.yaml` with the compose
files; while `crate-operator` runs, every remote stage adds that overlay (or the
host-approved `.deploy/crate-operator.compose.yaml` when present) so API and workers
keep the operator identity, and the final stage recreates the running operator,
supervisor and relay on the release's `crate-agent` image. The opt-in bridge reuses the reviewed local
`scripts/deploy-remote.sh` stages inside the separately provisioned root tree.
Administrator release approval supplies exact hashes; a model cannot approve new
assets. Future normal release automation must explicitly hand approved artifacts
to this root boundary. Root maintenance must be serialized with infrastructure
operations; validation does not make concurrent root edits atomic.

## Release provenance publisher

The publisher is a container service of the `crate-operator` profile, so a new
instance gets working provenance from its first `make agent-up AGENT_PROFILE=operator`,
with no systemd unit or host root process. It replaces the former root
`crate-provenance.service`.

| Service                   | Runs as                                                                                   | Access                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crate-provenance-docker` | HAProxy, pinned by digest; uid 0 only to open the socket, no capabilities, read-only root | Host Docker socket (`CRATE_DOCKER_SOCKET`, default `/var/run/docker.sock`); internal `crate-provenance` network; no published port                    |
| `crate-provenance`        | `crate-agent` image as `PUID:PGID`, no capabilities, read-only root                       | `GET /containers/json` and `GET /images/sha256:<id>/json` through the filter; `context/` read-only; writes `provenance/`; outbound HTTPS to `ghcr.io` |

The filter denies every other method and path with 403, including container inspect
(which would expose environment secrets), logs, archive, exec, export and image export.
The publisher finds its own container by hostname, takes its Compose project from the
labels, and observes only running containers of that project every 30 seconds.

Evidence (`provenance/target.json`, `observation.json`, mounted read-only at
`/run/crate-provenance-evidence`) keeps the identity format: instance, release SHA,
context manifest SHA256 and, per service, the digest reference, OCI source SHA and image
ID. Deployment and context markers written by `scripts/deploy-remote.sh` stay in
`context/public` (mounted at `/run/crate-provenance`) and are read directly on every
boundary; when they exist they take precedence, so `deploying` and `rollback` close
mutations without waiting for an observation.

- **Release mode** (a deployment marker exists): the marker must be verified, the active
  context must describe the same manifest, and every manifest service, including
  `crate-fast-worker`, must run that entry's exact digest reference and `source_sha`.
  The publisher's own image must match the manifest's `agent` entry when present.
- **Image mode** (no deployment marker, the new-instance case): `crate-api` and the
  four executing workers must run; every running fleet image and the publisher's own
  `crate-agent` image need a `RepoDigests` entry in their expected
  `ghcr.io/thecrateapp/<repository>` and an OCI revision label, and the registry must
  confirm that digest exists in that repository (anonymous `HEAD` on the manifest,
  positive results cached per digest). The release SHA is the publisher image's
  revision, and the context hash is that of the release context baked into it, which
  must name the same revision. The publisher also writes its own verified
  `deployment.json`/`context.json` to the evidence directory; they are ignored as soon
  as a deployment marker appears.

The registry proof is what keeps local builds closed: Docker's containerd image store
records a local manifest digest for locally built images, which does not exist in the
official repository. Observation drift (a recreated service, a new pull) changes the
identity and invalidates pending plans; freshness stays 90 seconds over a 30-second
cycle, as before. Residual limits: an executing process does not inspect its own image,
so a container recreated between two observations is caught at the next one (at most
30 seconds); the publisher depends on `ghcr.io` for digests it has not proven yet; and
the host's own root can forge any of this, as it could the former root unit.

## Version transition, health and rollback

The approved operator release contains `release-manifest.json`, exact `release.env`,
both Compose files and `agent-context.tar.gz`, with hashes in `approved.json`.
The context archive must describe that exact release and the expected per-image
manifest entries; it is validated before effects. The host plan seals all consumed
helpers, `.env`, overlay, existing/candidate files and expected staging transitions.
Context destinations use the exact LF/quote parser semantics of the shell; CR/NUL,
unsafe ancestors and relative operator roots fail closed. Legacy deployments retain
`DATA_DIR/crate-agent/context` when no operator root is configured.
The gateway, supervisor, relay and provenance publisher run from the release's
`crate-agent` image (`CRATE_AGENT_IMAGE`, an optional manifest entry outside the
provenance-bound fleet); root-provisioned assets remain the source for the host bridge
unit.
Instances running locally built images never obtain verified provenance, so their
mutations stay closed and Crate Operator behaves as read-only.

Deploy stages mark `deploying`, verify real health/images, then activate the approved
context. The public gate stays closed until the active link and its exact hash have
changed; the operator always consumes the reviewed archive, even for a cached SHA. The publisher observes every actual image against that entry's digest
and `source_sha`; incremental releases may legitimately reuse older image sources.
It writes only bounded identity files for API/workers, without environment,
private labels, home or credentials. Failed publication writes unverified evidence.
Rollback markers immediately close domain mutations; cached previous context may
be reactivated only after explicit verification of the selected previous release.
Image/config rollback does not reverse database migrations. The bridge retains
uncertainty/quarantine when it cannot prove a safe outcome.

| Health contract                           | What it proves                                                                                                        | What it does not prove                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| API/readplane                             | Existing local status/health routes                                                                                   | Public DNS/TLS/client operation                                                                      |
| Worker/fast/maintenance/analysis/playback | Fresh own process consumer iterations for each normal and delayed queue, current Redis ping and bounded DB round trip | Every task, DSP quality or end-to-end completion; prolonged consumer backpressure can fail readiness |
| Projector                                 | Fresh completed actual relay/projection iteration, no relay/projection failures, current broker/DB                    | Every downstream rendered view or public client                                                      |
| Media worker                              | Actual `/healthz` response                                                                                            | A real complete ZIP/download                                                                         |
| UI/Listen/site/docs/Cast                  | Local HTTP serving checks                                                                                             | Browser UX, playback or network reachability                                                         |
| Gateway                                   | Fresh running state and connected Telegram plus webhook adapters                                                      | Successful provider inference or actual destination delivery on every request                        |

Running alone is insufficient. Missing checks are refused before restart/deploy;
unhealthy, delayed-ready and timed-out postconditions use bounded verification and
retain uncertain outcomes. Publisher availability is not a functional health claim.
PostgreSQL backup/restore coverage is **PostgreSQL only**, with actual disposable
restore verification including vector/pg_trgm/pgcrypto. Redis, audio, artwork,
configuration, image rollback and production restoration are excluded.

## Reproducible candidate and acceptance

Package only a final committed SHA:

```bash
python3 scripts/operator_candidate.py --revision <full-committed-sha> --destination /tmp/crate-operator-candidate
```

`candidate.json` records source/context hashes and explicitly says source candidate
only. It contains no invented built-image proof. CI must later supply the immutable
release manifest, and the exact-SHA exporter must produce the deployment context
using that manifest before host approval. No candidate command activates anything.
The exporter indexes `deploy/hermes` and `deploy/operator` source/contracts as well
as canonical docs and the other platform sources.

Run focused suites in `app/tests/test_operator_*`, the native/runtime/context,
infra/release suites and existing MCP/plans/tasks/security/DB boundaries. Real
PostgreSQL cases use isolated `pg_db`; use the project's MCP SDK environment for
transport tests. Root ownership tests run only in a disposable root container.
The gateway harness runs the exact pinned image with `--network none`, loopback
host aliases and a read-only candidate mount:

```bash
docker run --rm --network none \
  --add-host crate-infra-relay:127.0.0.1 --add-host crate-api:127.0.0.1 \
  --add-host crate-operator-supervisor:127.0.0.1 \
  -v "$PWD:/workspace:ro" --entrypoint /opt/hermes/.venv/bin/python \
  nousresearch/hermes-agent:v0.22.2@sha256:36099926da316742423544e055d4734777105ffe6341873af5459b957d0c2919 \
  /workspace/scripts/operator_gateway_smoke.py
```

The harness uses the public pinned Telegram `base_url` support, synthetic secrets,
real native plugin lifecycle, signed direct delivery, API-off cold start, a native
approved synthetic restart and calls through the gateway’s already discovered
registry/standard dispatcher and its own persistent MCP child after API recovery.
The acceptance-only native plugin neither discovers/registers tools nor creates
a client. Six API-off calls exceed the pinned client’s breaker threshold, then
reads and mutation preparation recover without a reset/restart. Revoking current
server policy blocks preparation while reads continue; handler and adapter PID
remain the same. It asserts actual UID10000 and dedicated HOME/cwd/XDG paths,
no personal OAuth and no model input. The fake recovered API proves reconnection; separate real-PostgreSQL
SDK/native/worker tests prove domain authority and effects. Neither substitutes
for real target acceptance.

Final activation still needs reviewed immutable CI images, host ownership/paths,
role health under actual load, real bot ownership/identity, signed destination
reachability, backup capacity, external watchdog failure/recovery, public client
checks and a model conversation using the released context. No live-target claim
is made by the local candidate.

## Delayed effect authority and migration 134

Operator-created one-off schedule/retry tasks, sync artwork and analysis/Bliss
generations retain the exact admitted parent job, plan version and human decision.
A completed enqueue parent stays readable for this proof; it is never reopened or
replayed. Current credentials, grants, account/binding authority, approval expiry
and fresh stable release/context identity are checked again before child work and
publication. Nested copying/scanning checks also reread provenance. Refreshed
observation timestamps for the same stable identity remain valid.

Migration 134 adds nullable `track_processing_state.operator_authority`. Operator
generations retain their approved physical source and generation; a denied
generation is durably failed, and ordinary resets preserve that proof and cannot
launder it into ordinary pending work. A fresh separately approved analysis plan
can replace it. The analysis worker receives the same opt-in identity environment
and public provenance mount as the other executing workers. Queued artwork binds
the reviewed local cover or embedded source and digest, never a newly selected
provider/source at execution. Owned acquisition transfer/publication jobs support
reviewed cancellation only; legacy Soulseek retries remain unavailable and a
stopped transfer can still continue remotely.

Existing independent Admin/scheduler/nonoperator pipelines remain supported. Future
recurrences of an approved persistent schedule are platform policy. Routine
projector/read-plane/dirty-index consistency from committed facts is platform
authority. These boundaries do not exempt operator-created processing generations
or one-off child tasks.

Upgrade the database and executing workers together before enabling the operator.
Drain or reconcile any preupgrade operator work first: raw tasks without retained
parent proof are rejected, and old processing generations have no reconstructable
parent lineage.
Rollback must first stop/drain or reconcile operator-bound queued work; retaining
migration 134 is safe for older source, but older workers cannot enforce its proof.
Do not run them against retained operator work. Dropping the column discards its
lineage and requires a separately reviewed rollback after that work is resolved.

Supervisor event, incident and delivery reads expose bounded cursor/offset pages;
retention gaps remain explicit. Infra outcomes direct follow-up to `infra_inspect`
and `infra_reconcile`; domain outcomes retain their exact confirmation/watch status.
Invalid local MCP request shapes are protocol errors. Current-authority outages or
lost forwarded responses remain ordinary unavailable/unverified observations so
the pinned gateway can recover without replaying uncertain mutations.
