---
title: Crate MCP
summary: Connect remote agents with OAuth, scoped maintenance and exact human plan review.
section: operations
audience: [operator, developer]
status: canonical
order: 170
verified: 2026-10-16
sources:
  [
    app/crate/mcp/server.py,
    app/crate/mcp/auth.py,
    app/crate/mcp/oauth.py,
    app/crate/mcp/oauth_config.py,
    app/crate/api/mcp_oauth.py,
    app/crate/api/agent_integrations.py,
    app/crate/api/agent_plans.py,
    app/crate/db/repositories/mcp_oauth.py,
    app/crate/db/repositories/agent_plans.py,
    app/crate/db/repositories/agent_integrations.py,
    app/crate/db/repositories/agent_human_sessions.py,
    app/ui/src/pages/AgentIntegrations.tsx,
    app/ui/src/pages/AgentPlanReview.tsx,
    app/crate/mcp/tools.py,
    app/crate/mcp/schemas.py,
    app/crate/agent_credentials_cli.py,
    app/crate/agent_diagnostics.py,
    app/crate/agent_maintenance.py,
    app/crate/artist_photo.py,
    app/crate/db/repositories/agent_requests.py,
    app/crate/db/repositories/agent_repair_plans.py,
    app/crate/db/repositories/agent_credentials.py,
    app/crate/db/queries/agent_library.py,
    app/crate/db/queries/agent_operations.py,
    app/crate/projector_daemon.py,
    app/crate/db/jobs/agent_diagnostic_snapshots.py,
    docker-compose.dev.yaml,
    docker-compose.yaml,
    docker-compose.home.yaml,
  ]
---

# Crate MCP

Crate exposes an optional MCP endpoint for remote agents to inspect the local library,
persisted worker status, job history and bounded logs. Phases 0–3 provide six read tools,
five independently enabled maintenance tools, OAuth connections, integration management in Admin
and exact human approval when policy requires it. The first repair only updates one artist's
`has_photo` database flag. Broader maintenance and editorial playlists remain later phases.

## Connection and deployment

The endpoint is `https://api.<your-domain>/mcp`, hosted inside `crate-api`. Use that exact path,
without a trailing slash or a legacy `/sse` suffix. The official Python SDK is pinned to
`mcp==2.3.0`. Transport is stateless Streamable HTTP with JSON responses. Connect through OAuth
or explicitly provision a service integration with its dedicated Bearer credential. Human session
cookies identify the person during consent and Admin review; they never authenticate MCP calls.

`CRATE_MCP_ENABLED=false` is the default in the development, project and home Compose files.
Enabling it applies to both the API endpoint and the projector's background health snapshot
producer. Existing migrations must be applied before issuing credentials. Keeping the flag
disabled leaves the endpoint unavailable and does not start its health snapshot producer.
Actions additionally require `CRATE_MCP_ACTIONS_ENABLED=true` in the API and maintenance worker.
Both flags default to false; granting an action scope alone does not enable actions.
Apply migrations through 113 before using OAuth, integration management or plan approvals.

| Setting                             | Default                                                        | Purpose                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `CRATE_MCP_ENABLED`                 | `false`                                                        | Enable the endpoint and background health projection.                                                                         |
| `CRATE_MCP_ACTIONS_ENABLED`         | `false`                                                        | Enable the bounded action catalog and execution by workers.                                                                   |
| `CRATE_MCP_OAUTH_ENABLED`           | `false`                                                        | Enable delegated OAuth access in the API and workers.                                                                         |
| `CRATE_MCP_OAUTH_ISSUER`            | Empty                                                          | Explicit canonical HTTPS API origin, without path/query. It also defines the `/mcp` resource audience.                        |
| `CRATE_MCP_OAUTH_ALLOW_LOCALHOST`   | `false`                                                        | Explicit development opt-in for an HTTP loopback issuer; keep false for remote deployments.                                   |
| `CRATE_MCP_ADMIN_ORIGINS`           | Derived Admin/API origins                                      | Additional comma-separated exact origins for human consent and Admin mutations. Distinct from machine Origin allowlisting.    |
| `CRATE_MCP_ALLOWED_HOSTS`           | Empty: derive `localhost:*`, `127.0.0.1:*` and `api.${DOMAIN}` | Comma-separated Host allowlist. Set the actual API hostname when it differs from the derived name.                            |
| `CRATE_MCP_ALLOWED_ORIGINS`         | Empty                                                          | Comma-separated exact origins permitted when an Origin header is present. Server-to-server clients normally omit this header. |
| `CRATE_MCP_OPS_FRESH_SECONDS`       | `60`                                                           | Snapshot freshness window.                                                                                                    |
| `CRATE_MCP_OPS_STALE_SECONDS`       | `300`                                                          | Maximum historical snapshot age used in an answer.                                                                            |
| `CRATE_MCP_HEARTBEAT_FRESH_SECONDS` | `60`                                                           | Freshness window for persisted worker and analysis evidence.                                                                  |
| `CRATE_MCP_HEALTH_FRESH_SECONDS`    | `86400`                                                        | Freshness window for persisted library check observations.                                                                    |
| `CRATE_MCP_HEALTH_STALE_SECONDS`    | `604800`                                                       | Maximum historical check age used in a current evaluation.                                                                    |

All three Compose profiles pass these settings into the API. The projector receives the enable
flag. Workers receive the same OAuth enable/issuer settings to revalidate delegated jobs before effects. An empty Host setting selects the derived allowlist; it does not allow every host.
Allowlisting an Origin does not provide OAuth or automatically configure browser CORS.

Terminate TLS at the existing API reverse proxy, preserve the Host and Authorization headers,
and route `/mcp` directly to `crate-api`. Do not put a cache or a human-login forward-auth
middleware on this path. Do not inject `Remote-User`, `Remote-Role` or other `Remote-*` headers:
mixed machine and human authentication is rejected. The existing project and home API routes
already point to the API without the Admin forward-auth middleware.

For local development, `http://127.0.0.1:8585/mcp` is suitable for an SDK test client. A successful
local SDK exchange establishes transport compatibility, not certification of a particular
remote agent host, public TLS proxy or production deployment. Record those checks separately.

## OAuth connections and Admin

Set the same `CRATE_MCP_OAUTH_ISSUER=https://api.<your-domain>` in API and maintenance workers,
then explicitly enable OAuth and MCP. Keep actions disabled until their separate rollout is authorized.
Forward `/mcp`, `/oauth/*` and both well-known metadata paths to the API over HTTPS, preserving
Authorization and Host. Discovery is public; tokens and consent responses are not cacheable.
The issuer is configured, never inferred from untrusted forwarded headers.

| Endpoint                                    | Purpose                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/.well-known/oauth-protected-resource/mcp` | MCP protected-resource discovery, resource and allowed scopes.                             |
| `/.well-known/oauth-authorization-server`   | Authorization server discovery and supported grants/PKCE.                                  |
| `/oauth/authorize`, `/oauth/consent`        | Crate login, consent showing actual permitted scopes, one-time session-bound confirmation. |
| `/oauth/token`                              | Authorization-code exchange and rotating refresh tokens.                                   |
| `/oauth/revoke`                             | Revoke the delegated authorization, including pending jobs' authority.                     |
| `/oauth/connections`                        | Human owners inspect and revoke their own connections without global Admin permissions.    |

Register public clients in **Admin → Agent integrations** before connecting. Supply the exact
client ID, callback URIs and scope ceiling. A URL client ID explicitly opts into Client ID Metadata
Documents: its public HTTPS document must match the registration. Fetches pin validated public IPs,
retain TLS hostname verification, reject redirects/internal destinations and cap time and body size.
Dynamic Client Registration is not enabled; clients requiring it need a separate compatibility decision.

The authorization server uses **Authlib 1.9.1** grant validation, PKCE S256, exact redirect/resource
validation, one-use codes and opaque access/refresh tokens stored as digests. Access tokens expire;
refresh tokens rotate, and reuse revokes their family. Exchanges and reuse detection share a
stable authorization lock before locking individual codes/tokens, so a concurrent rotation cannot
leave a newly inserted descendant active. A fresh consent creates a new authorization
ID; old revoked grants and their queued jobs do not regain authority. The MCP SDK resource verifier
rechecks the persisted grant and current user permissions on every request.

Effective permissions intersect issued/accepted scopes, current OAuth authorization, enabled client,
integration grants, current delegating user capabilities and the operation's target restrictions.
Two people using the same client have separate principals. An already accepted job survives normal
access-token expiry but cannot apply new effects after grant revocation, account disablement,
capability downgrade, issuer change or OAuth disablement.

Admin lists service integrations separately from connected accounts. It manages scope ceilings,
enablement and exact-plan review policy, registers/disables clients, rotates/revokes service tokens
and disconnects delegated grants. Service tokens appear once on creation/rotation, in component
state only; close the dialog after storing the token. Listings and activity omit digests and secrets.
Policies use revision checks: a concurrent edit returns conflict and preserves the unsaved proposal
until the operator reloads the current policy.

Human management requires a fresh, active Crate cookie session and the relevant capability:
`agents.integrations.manage`, `agents.activity.view`, `agents.plans.review` or `agents.plans.approve`.
Granting a scope also requires its existing domain capability. Unsafe requests require an explicitly
configured Origin; Bearer credentials, human JWT headers and `Remote-*` shortcuts are rejected.
These additive capabilities are available to instance admins; other role presets keep their current access.

Activity pages expose only allowlisted bounded evidence and link to persisted plans/jobs. Accepted,
executed and verified remain separate outcomes. The activity query uses the principal/time/ID index;
access-history summaries return at most 20 entries with explicit truncation and active access first.

## Exact human plan review

The existing photo repair plan is the single persisted source for both agent preview and Admin
review. Its full document contains the exact artist and field change, source observation/version,
impact, risk, expiry, reversibility and authorization context. The current operation has one target;
there is no hidden sample or implicit approval of further artists.

An integration can require human review. Preview then returns `awaiting_approval`; an authorized
human reviews all changes at **Admin → Agent plans** and approves or rejects. Approval binds the
principal, authorization context, plan version, canonical content hash and policy revision. It does
not grant missing scopes, and MCP exposes no approval tool. Incomplete, expired or changed plans
must be prepared/reviewed again. A policy change invalidates existing plans even when a previously
approved change would remain small.

Acceptance reserves the approval once in the same transaction as the job. Replay returns that
job; a different request cannot consume the approval again. The worker checks current authority,
approval and sources before applying the flag and records verification independently. Human
reviewer deletion preserves the decision with an empty live user reference; the audit retains the
original actor ID.

## Provision an integration

Credentials belong to independent machine principals, not human users or roles. Each credential
has an expiry and can be revoked. Tokens contain 256 random bits with the `crate_mcp_` prefix;
PostgreSQL stores only a SHA-256 digest. Grants are a nonempty subset of:

- `library.health.read`
- `ops.status.read`
- `ops.jobs.read`
- `ops.logs.read`
- `library.health.run`
- `library.repair.photo_flag`
- `ops.jobs.retry`
- `ops.jobs.cancel_pending`

Read credentials retain their existing four scopes. Action grants must be provisioned explicitly;
there is no automatic escalation or inheritance from an Admin role.

An instance owner provisions credentials through the CLI in the API runtime. For example, in
the development profile:

```bash
docker compose -f docker-compose.dev.yaml exec api \
  python -m crate.agent_credentials_cli create \
  --name "Remote library inspector" \
  --grant library.health.read \
  --grant ops.status.read \
  --grant ops.jobs.read \
  --expires-in-days 30
```

Grant `ops.logs.read` separately when the integration needs logs. Creation prints JSON containing
`principal_id`, `credential_id`, `name`, `grants`, `expires_at` and the token. Save the token in the
agent host's secret store; Crate cannot display it again. Omitted expiry defaults to 90 days;
the CLI accepts 1–365 days. The project and home profiles use service `crate-api` instead of `api`.

```bash
docker compose -f docker-compose.dev.yaml exec api \
  python -m crate.agent_credentials_cli list

docker compose -f docker-compose.dev.yaml exec api \
  python -m crate.agent_credentials_cli rotate CREDENTIAL_ID --expires-in-days 30

docker compose -f docker-compose.dev.yaml exec api \
  python -m crate.agent_credentials_cli revoke CREDENTIAL_ID
```

Replace `CREDENTIAL_ID` with the ID returned by creation or listing. Listing includes status and
expiry metadata, never the token or its digest. Rotation preserves the principal and grants,
atomically revokes the old credential and prints the new token once. Update the agent host after
rotation. Revocation takes effect on the next request; an existing connection carries no authority
of its own. A disabled principal cannot authenticate or rotate credentials.

The MCP endpoint accepts only dedicated service or delegated OAuth Bearer credentials. Human JWTs, cookies, query tokens,
duplicate Authorization headers and mixed authentication are rejected. Machine credentials do
not authenticate Admin, Listen, media, OpenSubsonic or federation routes. Provisioning is not an
MCP tool. Credential lifecycle changes and diagnostic access are audited using machine IDs;
the audit does not fabricate a human `user_id` or persist supplied tokens.

## Diagnostic tools

Tool discovery is filtered by grants. Every call also checks its required grant independently.
Input schemas reject unknown arguments; filters are limited to the supported fields and enums.

| Tool                  | Required grant                                                                                | Inputs and result                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_instance_status` | `ops.status.read`                                                                             | No arguments. Returns cached library totals and persisted worker/analysis evidence, each with its own source timestamps.                                                         |
| `list_library_issues` | `library.health.read`                                                                         | Optional `check_type`, `severity`, `artist_uid`, `limit`, `cursor`. Returns a bounded materialized sample of local issues and last check observations.                           |
| `inspect_artist`      | `library.health.read`                                                                         | Exactly one of `artist_uid` or `name`; optional `limit`. Returns identity resolution, persisted checks and issues. Ambiguous names require the agent to choose a UID explicitly. |
| `list_jobs`           | `ops.jobs.read`                                                                               | Optional `states`, allowlisted `types`, `limit`, `cursor`. Returns sanitized task history.                                                                                       |
| `get_job`             | `ops.jobs.read`                                                                               | `job_id`. Returns the safe fields of one task without raw parameters or results.                                                                                                 |
| `read_diagnostics`    | `ops.logs.read` for `worker_logs`; `ops.status.read` for `worker_status` or `analysis_status` | Required `source`; optional `limit`. `worker_logs` also accepts `task_id`, `since` and `until`.                                                                                  |

## Bounded actions (phase 2)

The action catalog is hidden and direct calls are denied while the action flag is disabled.
All inputs are closed schemas. An integration can have one active maintenance job. Concurrent
work on the same artist is serialized; another integration receives `TARGET_BUSY` without
learning the other integration's job ID.

| Tool               | Grant                                     | Contract                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run_health_check` | `library.health.run`                      | One `artist_uid`, `check_type=has_photo_desync`, `idempotency_key`. The worker observes only that artist and persists run-linked evidence; it does not repair or refresh global check timestamps.                           |
| `preview_repairs`  | `library.repair.photo_flag`               | One `issue_id` from this integration's recent directed check. Persists an immutable single-change plan and returns `plan_id`, `plan_version`, `before`, `after` and expiry. No filesystem access or enqueue in the request. |
| `apply_repairs`    | `library.repair.photo_flag`               | Exact `plan_id`, `plan_version`, `idempotency_key`. The worker reobserves the filesystem, checks identity and preconditions, updates one database flag and observes again. It never downloads or writes an image.           |
| `retry_job`        | `ops.jobs.retry` and `library.health.run` | Own failed directed health check only, with server-recovered parameters and `idempotency_key`. Maximum three retry jobs per original check. Permanent authorization/identity failures and repairs cannot be retried.        |
| `cancel_job`       | `ops.jobs.cancel_pending`                 | Own pending directed check or photo repair only. Cancellation and the worker's claim have one winner. Repeating cancellation returns the existing result; running or finished jobs return `STATE_CONFLICT`.                 |

Use `get_job` with `ops.jobs.read` to follow acceptance, execution, verification and projection.
After the directed check finishes, its job exposes the `issue_id` needed by `preview_repairs`.
`EVIDENCE_STALE` requires a new directed check, never an implicit full scan. Evidence and plans
are valid for at most 15 minutes. A different principal cannot apply the plan. Any changed
photo fingerprint, artist identity or incompatible database state yields a conflict.

`can_execute_for_this_principal` describes the enabled grant for this check; it does not waive
the fresh-evidence and exact-plan requirements. There is no `confirm=true` parameter: the
explicit photo-flag grant is the authorization for this bounded action.

Acceptance, the task row, idempotency mapping and audit record commit together; broker dispatch
runs only after commit. Crate's existing stale-pending recovery handles lost dispatches.
The same principal, operation and key returns the same job after completion. Reusing a key for
a different payload returns `IDEMPOTENCY_CONFLICT`. Keys contain 1–128 ASCII letters, digits,
dots, underscores, colons or hyphens and start with a letter or digit.

Request mappings survive runtime task cleanup. A purged result returns `RESULT_EXPIRED` and
does not execute again. If an HTTP response is lost or returns `ACTION_STATUS_UNKNOWN`, replay
the original key or inspect the known job; creating a new key represents a new intention.

Workers recheck the stored credential's revocation, principal status and current grants before
effects. Normal credential expiration after acceptance does not cancel a job; revocation or
rotation of that credential blocks pending effects. Disabling the MCP/action flags also blocks
new worker effects. Effects already committed are preserved and reported.

The database change, plan result, audit and invalidation events share a transaction. Filesystem
observation is not atomic with that transaction: post-check results therefore distinguish
`verified`, `pending` and `conflict`. An applied change with incomplete verification is never
reported as a rollback. Projection is recorded as `pending` at the change and is eventually
refreshed by the projector; it is not a live assertion that all read models have caught up.
If a worker dies after committing the flag but before verification, the persisted result retains
the applied effect and pending verification. Redelivery to the operation can verify without
reapplying; automatic recovery after the actor has become terminal is not guaranteed. A new
directed check can establish current coherence without repeating the consumed repair plan.

The Admin photo fixer shares UID-based observation and compare-and-set. Historical issues
without an artist UID require a new check. This path revalidates only affected artists; other
repair types and the generic Admin batch-selection contract remain unchanged.

## Diagnostic evidence semantics

`read_diagnostics` timestamps must include a timezone. Its default log window is the previous
hour; a requested window may span at most 24 hours and cannot be in the future. These are existing
database logs, not arbitrary files, Docker logs or remote service requests.

The six diagnostic tools do not run checks or enqueue changes. Issue risk is explanatory;
`can_execute_for_this_principal` is false unless the photo-flag action is enabled and explicitly
granted. No tool in this delivery repairs tags, changes schedules, deletes files or publishes
playlists.

## Reading evidence correctly

Responses use `structuredContent` with `schema_version`, `availability`, `source`, `observed_at`,
`reason`, `data`, `returned_count`, `truncated` and `next_cursor` as applicable. Snapshot-backed
answers also retain `built_at`, `version`, `source_seq` and invalidation metadata. Missing data is
`unavailable`; historical observations are `stale`. Neither means a healthy current system.

A snapshot build timestamp is not the timestamp of the underlying check or heartbeat. Library
checks are fresh for 24 hours and historical for up to seven days by default. Worker and analysis
status is fresh for 60 seconds; older evidence does not establish that a process is alive. Current
worker payloads include optimistic dependency booleans, so the MCP view excludes those booleans
instead of presenting them as probes. Logs and a recently completed task also do not prove liveness.

`list_library_issues` reads a background-produced sample capped at 1,000 issues. It reports partial
coverage explicitly. An empty page, or the absence of a next cursor, does not establish that the
entire library is clean. Only known totals are returned. A library cursor is tied to the snapshot
version and filters; `CURSOR_STALE` means the snapshot changed and pagination must restart.
`inspect_artist` uses bounded database reads and can inspect artists outside the materialized sample.

`pending` jobs may be waiting for a resource governor or a permitted download window. `completed`
may mean work was skipped or a downstream analysis phase remains pending. Agents must inspect the
returned evidence rather than automatically diagnosing a stuck worker or treating completion as
proof of a completed library repair.

Reading cold or invalidated snapshots never rebuilds them, enqueues work, scans `/music`, calls
external providers or updates diagnostic source state. The projector refreshes the canonical health
snapshot (`ops:health` / `agent:diagnostics:v1`) in the background every 60 seconds. This dedicated
sample excludes Admin payload details and caps text before persistence, preserving the last result if
the refresh fails. API reads only append their access audit. Jobs and logs use bounded indexed
reads, without request-time aggregates over `library_tracks`.

Logs, artist names and issue descriptions are untrusted source data. They are subject to an output
field allowlist, redaction and size limits, but must never be interpreted as agent instructions.

## Limits and error handling

| Boundary                     | Limit                                                                |
| ---------------------------- | -------------------------------------------------------------------- |
| Result page                  | Default 20; maximum 100 entries.                                     |
| Log entry                    | At most 2 KiB of UTF-8 text.                                         |
| Log query window             | At most 24 hours.                                                    |
| HTTP request / tool response | At most 64 KiB; structured tool payload is bounded below that limit. |
| Concurrent tool operations   | 2 per principal; 8 globally.                                         |
| Read rate                    | 60 calls per principal in a rolling minute.                          |

Rate and concurrency admission is shared through Redis across API processes. If admission storage
is unavailable, calls fail closed. Active leases renew while an operation runs; a lost lease rejects
the result. A local capacity limit also bounds execution to eight threads. Saturation produces `RATE_LIMITED` with a retry delay; agents
must respect it rather than loop immediately. Redis admission does not cache authorization.

Other structured errors include `FORBIDDEN`, `INVALID_ARGUMENT`, `CURSOR_STALE`,
`SOURCE_UNAVAILABLE` and `RESPONSE_TOO_LARGE`. Narrow filters or reduce `limit` for oversized
responses. Missing or old snapshots can be represented as an unavailable evidence envelope rather
than a successful empty inventory. The server does not paginate, retry or poll on the agent's
behalf. Each subsequent page or retry is a new, bounded, authorized call.

To withdraw access, revoke the integration credential. To disable the feature, set
`CRATE_MCP_ENABLED=false` and recreate the API and projector through the normal deployment flow.
Credential records remain available for auditing; no library state is changed by disabling MCP.

## Validation record — 2026-10-16

The implementation was checked with Python 3.13.11 and the official MCP SDK 2.3.0.
The SDK client completed initialize, discovery, calls and shutdown over a real local TCP
connection, negotiating protocol 2026-07-28. Full FastAPI lifespan and disabled-mode tests
also passed.

Codex CLI 0.160.0 completed two ephemeral agent sessions against a loopback fixture server.
The full diagnostic principal discovered and used all six tools (eight calls); the
library-only principal discovered and used exactly its two library tools (two calls).
The agent identified failed-job evidence, stale worker evidence, absent health observations
and an artist issue without repair authority. It ignored an instruction embedded in a log.
Eight deterministic trace checks passed, including no other tools or shell commands. Run
`../.venv/bin/python -m tests.manual.mcp_agent_eval` from `app/` to reproduce this optional
host evaluation; it consumes model usage and requires an authenticated Codex CLI.
Credential lookup, quota storage and audit storage are simulated in this host fixture;
separate integration tests exercise real PostgreSQL and Redis.

A local warm sequential benchmark compared direct diagnostic reads with the complete MCP
path (real credential lookup, Redis admission and audit inserts), using one artist,
1,000 issues, 2,000 jobs and 5,000 log entries, with 20 samples per tool:

| Tool                | Direct p95 |   MCP p95 |
| ------------------- | ---------: | --------: |
| get_instance_status |   1.089 ms |  6.548 ms |
| list_library_issues |   4.735 ms |  8.867 ms |
| inspect_artist      |   3.244 ms |  7.700 ms |
| list_jobs           |   1.354 ms |  6.709 ms |
| get_job             |   0.997 ms |  5.056 ms |
| read_diagnostics    |   2.419 ms | 10.777 ms |

The largest result was 11,039 bytes. Assertions enforce at most one diagnostic SELECT
(two including authentication), a five-second diagnostic statement timeout, no queries to
`library_tracks`, no functional writes and responses below 64 KiB. Run
`pytest tests/test_agent_diagnostic_performance.py -q` to repeat the comparison. Timings
are observations rather than brittle CI assertions; the initial local comparison target was
p95 below 500 ms. This small dataset does not establish production-scale or concurrent-load
performance. Public TLS/proxy acceptance remains a deployment check before enabling the pilot.

## Phase 2 validation — 2026-10-16

The final combined backend suite passed all 866 cases. Coverage includes real PostgreSQL transactions,
concurrent acceptance and cancellation, migration 111 downgrade/reupgrade, credential revocation,
expired/stale plans, audit rollback, retained idempotency after task cleanup and Admin photo repair.
The seven documentation tests, documentation build/integrity and all three Compose configurations
also pass. Independent specification and code-quality reviews found no outstanding blockers.

`tests/test_agent_actions_workflow.py` runs the official SDK over a real loopback HTTP server,
with real PostgreSQL/Redis and temporary artist directories. Both complete check→preview→apply→verify
and changed-photo conflict scenarios pass. `tests/test_agent_actor_contract.py` exercises the actual
actor: revocation and stale plans remain failed, success is verified, and redelivery does not
overwrite the persisted outcome. No production library or external provider is used.

Reproduce the phase-specific checks from `app/`:

```bash
../.venv/bin/python -m pytest tests/test_agent_request_idempotency.py \
  tests/test_agent_repair_plans.py tests/test_agent_job_controls.py \
  tests/test_agent_commands_migration.py tests/test_agent_maintenance.py \
  tests/test_artist_photo.py tests/test_mcp_actions.py \
  tests/test_agent_actions_workflow.py tests/test_agent_actor_contract.py -q
```

Both enable flags remain false by default. This validation does not activate the endpoint,
certify public TLS/proxy behavior or claim automatic recovery of terminal jobs whose post-effect
verification is still pending.

## Phase 3 validation — 2026-10-16

The final combined regression run passed **649 backend tests**. Admin passed **263 tests in 70
files**, lint, typecheck and production build. Pyright 1.1.411, Ruff 0.15.22 and Bandit's CI-equivalent
medium-severity/high-confidence scan passed; the scan covered all 42 changed backend Python files.
The documentation passed seven tests, integrity checks for 42 canonical documents and its build.

Real TCP interoperability tests identify **MCP Python SDK 2.3.0** and **Authlib 1.9.1** as the two
clients. The second is a test client combining `AsyncOAuth2Client` with MCP JSON-RPC requests,
rather than a certification of a desktop agent host. Both complete discovery, Crate cookie login/consent, MCP initialization and reads, rotating
refresh and revocation using PostgreSQL and Redis. The SDK client also uses explicitly registered
Client ID Metadata Documents. An ordinary user without Admin access can sign in, consent to their
actual permissions and revoke only their own connections, including while OAuth is disabled.
These tests do not establish Codex CLI OAuth compatibility or public TLS/proxy acceptance.

Delegated-job regressions traverse actual grants, persisted job/plan context, worker identity
reconstruction and the real photo-repair handler. Normal access-token expiry permits an accepted
job to complete. Grant revocation and capability downgrade, both before loading and immediately
before writing, deny the effect. Service jobs retain their existing behavior.

Independent specification and security/quality reviews completed with no outstanding P1/P2 findings.
The reviews reproduced three concurrency bugs against real PostgreSQL before their fixes:

- Reusing a consumed refresh or authorization code while its descendant rotates could leave the
  new descendant active. A stable authorization lock now serializes generation and family revocation;
  both forward and reverse transaction orderings are covered.
- Editing a person's own integration policy could deadlock with its worker. Shared user locks keep
  downgrade/disable protection while remaining compatible with the human session guard.
- Grant revocation could deadlock with a worker holding its synthetic credential. Delegated
  validation now locks the grant before principal/credential rows, including direct human plan
  approval, matching revocation and token exchange order.

Admin tests cover fresh cookie sessions, scope/domain permissions, one-time secret presentation,
secret-free bounded activity, client registration/scope changes, exact approval hashes, expiry,
policy conflicts, single reservation and concurrent decisions. UI tests cover complete diffs,
review reset across plans/versions, conflict reload with the proposal retained and token cleanup
on dialog dismissal. Schema tests cover bootstrap and ordered downgrade/reupgrade through 113,
including retained credentials and reviewer deletion. OpenAPI exposes these human routes in the
Admin variant with cookie-only security. All three Compose profiles retain disabled flags and
pass matching issuer/OAuth settings to the API and action workers.

Reproduce the phase-specific checks from `app/`:

```bash
../.venv/bin/python -m pytest tests/test_mcp_oauth.py \
  tests/test_mcp_oauth_integration.py tests/test_mcp_oauth_migration.py \
  tests/test_mcp_oauth_concurrency.py tests/test_agent_oauth_jobs.py \
  tests/test_mcp_compose_contract.py tests/test_agent_admin.py \
  tests/test_agent_plan_approvals.py tests/test_agent_admin_migration.py -q
```

The endpoint, actions and OAuth remain independently disabled by default. No production library,
external provider, deployment or activation was used for these tests.

## CI review of PR #292 — 2026-10-16

Reviewed the [persistent suggestions](https://github.com/thecrateapp/crate/pull/292#issuecomment-6209726555)
against commit `01fcd117` and the current implementation before any subsequent commit or push.
The [quality job](https://github.com/thecrateapp/crate/actions/runs/38861845970/job/116845676220)
reported four optional-value Pyright errors in diagnostic snapshot/window handling. Explicit guards
now narrow those values before access or arithmetic; Pyright 1.1.411 reports no errors in that module.

- Normalize legacy naive ISO evidence timestamps to UTC, matching existing naive datetime behavior.
  The public MCP log schema still requires explicit timezone information.
- Project uncommon database scalar values through bounded redaction and convert nonfinite numbers
  to null, preserving valid JSON. Unknown diagnostic sources fail before accessing the database.
- Keep optional output fields optional. JSON Schema defaults do not make those fields required;
  `exclude_unset=True` is valid and preserves explicitly returned null evidence.
- Keep keyset decoding and validation at the application boundary before the repository call.
  A malformed cursor is rejected before SQL; it is never passed as a raw string to the query helper.
- Keep admission fail-closed after lease loss. A completed action with an uncertain response uses
  `ACTION_STATUS_UNKNOWN` and the original idempotency key; weakening the lease to a warning would
  change the enforced concurrency contract.
- `httpx2` is the actual client dependency of the pinned MCP SDK, not a mistaken alias. All eight
  [backend test shards](https://github.com/thecrateapp/crate/actions/runs/38861845970) passed on CI.

The automatic missing-security-evidence comment is contradicted by the successful
[Bandit security scan and uploaded report](https://github.com/thecrateapp/crate/actions/runs/38861845970/job/116845675825).
The bot also reports missing Checks write permission; granting that GitHub App permission is an
installation-owner operation and is independent of the code corrections. New regression tests in
`test_agent_review_regressions.py` reproduced 12 failing cases before the fixes and pass afterward.
