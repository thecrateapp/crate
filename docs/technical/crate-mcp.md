---
title: Crate MCP
summary: Connect remote agents with OAuth, scoped maintenance and exact human plan review.
section: operations
audience: [operator, developer]
status: canonical
order: 170
verified: 2026-10-19
sources:
  [
    app/crate/agent_operations.py,
    app/crate/agent_editorial.py,
    app/crate/agent_shows.py,
    app/crate/mcp/show_schemas.py,
    app/crate/api/show_imports.py,
    app/crate/show_extraction.py,
    app/crate/show_ocr.py,
    app/crate/db/repositories/show_identities.py,
    app/crate/db/repositories/show_import_selection.py,
    app/crate/mcp/editorial_schemas.py,
    app/crate/db/repositories/editorial_plans.py,
    app/crate/db/schema_sections/editorial_v116.py,
    .agents/skills/crate-editorial-playlists/SKILL.md,
    app/crate/agent_instance_operations.py,
    app/crate/agent_runtime.py,
    app/crate/runtime_policy_contract.py,
    app/crate/db/repositories/task_control.py,
    app/crate/db/repositories/agent_task_control.py,
    app/crate/db/repositories/runtime_policy.py,
    app/crate/mcp/server.py,
    app/crate/mcp/contract.py,
    app/crate/mcp/telemetry.py,
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
    app/crate/agent_discovery.py,
    app/crate/agent_operation_catalog.py,
    app/crate/agent_library_operations.py,
    app/crate/agent_metadata.py,
    app/crate/agent_enrichment.py,
    app/crate/agent_analysis.py,
    app/crate/agent_sync.py,
    app/crate/agent_portability.py,
    app/crate/admin_repairs.py,
    app/crate/db/repositories/agent_operation_jobs.py,
    app/crate/db/migrations/versions/114_agent_library_operations.py,
    app/crate/agent_quality.py,
    app/crate/repair_selection.py,
    app/crate/quality.py,
    app/crate/quality_task_policy.py,
    app/crate/portable_metadata.py,
    app/crate/worker_handlers/quality.py,
    app/crate/db/analytics_quality_surface.py,
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

Crate exposes an optional MCP endpoint for remote agents to inspect the instance, maintain the
local library and curate system playlists and shows. OAuth/service credentials, integration
management and exact human approval share one persisted plan/job engine. The catalog includes
selected checks, quality, repairs, metadata, enrichment, analysis, indexed-album sync, metadata
portability, instance job controls, schedules and revisioned runtime policy. Editorial plans
preserve system-playlist rules/overrides; show imports share identity and dedupe with Admin and
provider syncs. Admin also offers manual, local OCR and explicitly selected model assistance;
MCP submits structured show candidates without invoking server extraction.

Start with [Agents and MCP](11-crate-mcp.md) for architecture and normal workflows. This page is
the detailed connection/operations reference; its dated sections retain implementation evidence.
The [distribution contract and acceptance guide](crate-mcp-distribution.md) covers tool schemas,
client examples and rollout gates. Deployment and action flags remain disabled by default.

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
Apply migrations through 119 before using the current catalog. Migration 114 extends the existing
plan/job tables and adds private artifacts and DSP generation/claim provenance; it does not create
a second agent execution engine.

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

| Tool                    | Required grant                                                                                | Inputs and result                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_instance_status`   | `ops.status.read`                                                                             | No arguments. Returns cached library totals and persisted worker/analysis evidence, each with its own source timestamps.                                                                                                   |
| `list_library_issues`   | `library.health.read`                                                                         | Optional `check_type`, `severity`, `artist_uid`, `limit`, `cursor`. Returns a bounded materialized sample of local issues and last check observations.                                                                     |
| `inspect_artist`        | `library.health.read`                                                                         | Exactly one of `artist_uid` or `name`; optional `limit`. Returns identity resolution, persisted checks and issues. Ambiguous names require the agent to choose a UID explicitly.                                           |
| `list_jobs`             | `ops.jobs.read`                                                                               | Optional `states`, allowlisted `types`, `limit`, `cursor`. Returns sanitized task history.                                                                                                                                 |
| `get_job`               | `ops.jobs.read`                                                                               | `job_id`. Returns the safe fields of one task without raw parameters or results.                                                                                                                                           |
| `read_diagnostics`      | `ops.logs.read` for `worker_logs`; `ops.status.read` for `worker_status` or `analysis_status` | Required `source`; optional `limit`. `worker_logs` also accepts `task_id`, `since` and `until`.                                                                                                                            |
| `get_operation_catalog` | Any granted scope                                                                             | No arguments. Returns contract version, schema fingerprints, enabled/denied/disabled/unavailable status, worker readiness evidence, limits and support for all 17 repair checks. Discovery grants no additional authority. |
| `get_plan`              | The stored plan's operation grant                                                             | One `plan_id`. Reads a plan belonging to this principal and exact delegated authorization context, including accepted scopes. Current credentials and grants are rechecked.                                                |
| `get_library_quality`   | `library.health.read`                                                                         | Optional enumerated `category`, `limit` (1–100) and version-bound `cursor`. Reads worker-produced quality evidence and snapshot age/invalidation metadata. No scan or refresh.                                             |

## Original directed actions (phase 2 compatibility)

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
| `cancel_job`       | `ops.jobs.cancel_pending`                 | Own pending maintenance job only. Cancellation and the worker's claim have one winner. Repeating cancellation returns the existing result; running or finished jobs return `STATE_CONFLICT`.                                |

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

### Published phases 2–3 and subsequent CI review

Commit [`08bff534`](https://github.com/thecrateapp/crate/commit/08bff534ee24921f32e21b57067c248170b71e8b)
publishes phases 2–3 and the preceding review corrections in
[PR #292](https://github.com/thecrateapp/crate/pull/292). Its
[backend/security workflow](https://github.com/thecrateapp/crate/actions/runs/38876810318)
passed all eight shards, coverage, quality and the changed-Python security scan. The
[frontend workflow](https://github.com/thecrateapp/crate/actions/runs/38876810334)
passed tests and appearance checks; React Doctor and the OpenSubsonic smoke check also passed.

The updated persistent review was checked again after that push. Follow-up commit
[`f2f2d2f5`](https://github.com/thecrateapp/crate/commit/f2f2d2f5beaf69cad39a23fc966d7412c205953c)
is also published in PR #292 and covers these supported findings:

- Redact structured credential values by normalized dictionary key, including nested access/refresh
  tokens, client secrets and authorization headers. Keep nonsecret credential IDs and accepted scopes.
- Return a typed `RESPONSE_TOO_LARGE` for a first evidence item exceeding the 40 KiB page budget.
  Do not return an empty page with the same next cursor, or bypass the response budget.
- Normalize issue artist UUIDs before reading the snapshot; reject malformed identities before DB access.
- Reject nonstring OAuth access tokens before parsing and escape opaque consent/nonce values in
  both human forms. They are generated by Crate; escaping also keeps their HTML-data contract explicit.
- Return an already terminal job's durable result after plan retention, rechecking live authority and
  the exact stored authorization context. Pending/running jobs still require the current plan and
  policy. Worker redelivery of a persisted result does not load a potentially purged plan first.
- Remove the stray bootstrap import separator.

The proposed authorization-ID-only comparison was not adopted: canonical JSON preserves the full
context, and accepted-scope changes must not weaken plan ownership or replay isolation. Missing
accepted scopes are not converted into broader fallback authority. The proposed generic OAuth error
replacement and extra Admin UUID checks were not needed: caught diagnostic errors carry deliberate
public messages, and the HTTP boundary already types the Admin cursor/identifiers as UUIDs. React
Doctor's array-lookup warning concerns at most eight scope checkboxes; it has no material cost here.
The missing-security-evidence bot comment still conflicts with the successful scanner job.

Before publishing phase 4, the latest [persistent review on `f2f2d2f5`](https://github.com/thecrateapp/crate/pull/292#issuecomment-6209653602)
was checked again. Task IDs are `TEXT` in both `tasks` and `agent_jobs`, and Crate creates short
non-UUID task IDs; requiring `_uuid(job_id)` would reject valid retry/cancel requests. Authorization
keeps its transaction-local five-second statement and two-second lock limits deliberately. They
bound individual SQL statements/lock waits, not elapsed filesystem/provider work. Generic phase 4
execution records failed or uncertain effects separately, including terminal timeout/zombie cases
where the actor never returned. The legacy directed-photo recovery limitation remains explicit.

## Phase 4 foundation checkpoint — 2026-10-16 (historical)

This is a local review checkpoint within phase 4, not completion of its gate. It adds no broad MCP
write wrapper and requires no migration after 113. The complete feature plan retains metadata,
enrichment, analysis, sync, portability and editorial work.

The operation catalog distinguishes actual MCP support from legacy automatic repair labels.
All 17 checks have an explicit readiness/reason. `has_photo_desync` retains its directed, versioned
execution contract. Other checks remain unavailable through MCP while their merge choices, cascade
deletes, file manifests, provider artifacts, preconditions and postconditions are made exact.

Admin's selected-repair contract now resolves persisted open issue IDs rather than trusting supplied
issue details. Execution requires the complete plan version plus unique selected item IDs. Risk and
batch restrictions apply only to the selection. The worker reloads canonical sources and validates
the full version before marking or applying selected items; an explicit empty issue list performs
no action. The artist dialog sends the full source set with selected IDs, so choosing a subset does
not change the reviewed version. Unsupported artist-scoped health checks fail before persisting or
resolving issues. Legacy internal explicitly global repairs remain separate calls.

`GET /api/quality` now reads persisted evidence only. Its default response returns summary counts
and empty evidence arrays; use `category=corrupt|low_bitrate|lossy_with_lossless|mixed_format_albums`,
`limit` and `cursor` for a bounded page. This changes the former synchronous full-report contract;
no current Admin caller was found. A missing or invalidated report is unavailable, expired evidence
is historical, and cursors cannot silently cross versions.

An authorized human can explicitly request `POST /api/quality/refresh` with `{"scope":"global"}`
and capability `library.repair.run`. The request queues a deduplicated `quality_check` on the
maintenance queue with a 1,800-second limit, zero automatic retries and resource-governor deferral.
The response is `{task_id, deduplicated}`; an existing job gives `task_id: null` and
`deduplicated: true`. No quality scan runs inside the request. The MCP `run_quality_check` action
is still pending the common global-operation approval contract.

Quality results report their method and coverage. Unreadable metadata or suspicious duration is
not confirmed corrupt audio. Low bitrate is a threshold heuristic, and matching normalized album
names does not establish identical editions or masters. Lossless ALAC is recognized. Scans inspect
supported nested album layouts, reject unsafe paths and cooperate with cancellation.

Publication uses a snapshot version/invalidation compare-and-set. Crate-managed mutation task
claims and lifecycle transitions invalidate in the same transaction; durable library/artist/album
cache invalidations also participate. Active mutators prevent scanning/publishing a fresh report or
serving it as current. Invalidation versions increase monotonically, including within one transaction.
This describes evidence observed by Crate, not an atomic snapshot of arbitrary external filesystem
changes. Untracked external changes require the watcher or an explicit refresh; `built_at` remains
the observation time.

Portable metadata validates roots and relative references, including symlink ancestors, regular-file
checks, sidecar schema, finite values and a 16 MiB/10,000-track bound. Exports reject existing
destinations and preserve their bytes. Metadata-only export continues to require explicit
`include_audio=False` at the operation boundary. These shared safeguards do not create an MCP
portability contract: server presets, exact rehydrate conflicts/field locks, authorized artifacts and
partial-effect handling remain pending. Existing legacy handlers are not exposed as MCP shortcuts.

Remaining phase 4 work: common plans for the additional operations and mandatory risk/global
approvals; exact contracts for other enabled repair variants; metadata patches with provenance and
locks; scoped provider/facet enrichment; DSP generation/result attribution; honest sync scope; and
authorized export/rehydrate artifacts. The phase 4 gate remains open until those contracts and their
tests are complete.

Checkpoint validation: the integrated backend selection passed **859 tests** against real
PostgreSQL, covering MCP transport/OAuth, replay, selected repairs, quality, portability, runtime,
cache invalidation, database boundaries and OpenAPI/security. The final multidisc correction then
passed **109 quality/snapshot tests**, including an independent **14-case scanner** run. Admin
passed **267 tests in 71 files**, ESLint and the production build. Changed Python files passed
Ruff/format and Pyright; the medium/high Bandit scan reported zero findings or errors across
33 production files. Documentation passed seven tests, integrity checks for 42 canonical documents
and its build. Deployment flags remain disabled.

Independent specification and final security/quality reviews approved this checkpoint with no
outstanding P1/P2 findings. The final reviewer independently ran 119 quality/portability/read tests.
This approval applies to the foundation checkpoint; the complete phase 4 gate is still pending.

## Phase 4 library maintenance — 2026-10-16

All additional writes follow `prepare → get_job → get_plan → human approval when required →
apply → get_job`. Preparation itself is a maintenance worker job: metadata reads, hashes and
scans do not execute in an MCP HTTP request. Reuse the preparation idempotency key while waiting;
use a separate stable key for application. `run_health_check` and `run_quality_check` use the same
name for both stages: preparation supplies explicit scope/checks; application supplies only
`plan_id`, `plan_version` and `idempotency_key`.

Every complete public plan must fit **40,000 serialized bytes** and **500 declared targets**;
over-budget plans fail as a whole, without truncating the reviewed change list. Operation limits
below are additional ceilings, not a guarantee that their maximum combination fits the review
budget. Plans retain private execution manifests separately from their exact public document.
`get_plan` preserves complete metadata values, including URLs and explicit nulls; it never returns
private provider credentials or execution paths. Sanitized job/log diagnostics remain bounded.

Generic operation replays return a compact result with execution/verification status and an owned
plan/result reference. MCP `get_plan` keeps the complete approved diff and exposes result outcomes
through bounded, version-bound pages using `limit`/`cursor`. Outcome records identify the affected
entity, provider/facet and verification without repeating large before/after values. Full results
remain in the private plan/job stores and authorized Admin review; evidence hashes and result paths
identify those values. A large biography or setlist response must not make the plan or its replay
unreadable. Analysis generation details remain available through paginated `get_analysis_status`.
Follow `next_cursor` with the same plan ID to inspect all outcome records; restart when evidence
changes. Outcome counts include provider/facet and verification records, rather than representing
a count of unique library entities. `content_hash` continues to identify the complete approved
diff; `result_hash` identifies the full private result.

| Operation and tools                                              | Grant                                                                  | Contract and limits                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selected health: `run_health_check`                              | `library.health.run`                                                   | Explicit artist UID or global scope and 1–17 unique selected checks. Only four scanners support artist scope; the catalog lists them. Failed scanners preserve older open issues and do not claim successful coverage.                                                                                                                                                                                        |
| Quality: `get_library_quality`, `run_quality_check`              | `library.health.read`, `library.quality.run`                           | Snapshot-only reads; explicit globally approved refresh in a worker. Metadata/filename heuristics are not acoustic identity or proof of corrupt audio.                                                                                                                                                                                                                                                        |
| Repairs: `preview_repairs`, `apply_repairs`                      | `library.repair.run`                                                   | 1–20 unique canonical open issue IDs, exact source/target manifests, conditional automatic variants and explicit manual reasons. Directed photo compatibility retains its narrower `library.repair.photo_flag` grant.                                                                                                                                                                                         |
| Metadata: `preview_metadata_update`, `apply_metadata_update`     | `library.metadata.write`                                               | One artist/album/track UID and a closed field patch. Album tag edits affect up to 100 declared indexed tracks. File fingerprints, DB CAS, provenance, manual field locks and post-read verification.                                                                                                                                                                                                          |
| Enrichment: `plan_enrichment`, `run_enrichment`                  | `library.enrichment.run`                                               | 1–20 artist UIDs; enumerated Last.fm, Spotify, MusicBrainz, Discogs and Setlist providers; nine enumerated facets; `missing` or `refresh`. Up to 100 logical provider fetches; providers can use several bounded HTTP calls. Protected manual data survives refresh. Provider failures/no data are reported per item. No implicit photos, reset, discography or top-track requests.                           |
| Analysis: `plan_analysis`, `run_analysis`, `get_analysis_status` | `library.analysis.run`; status additionally uses `library.health.read` | 1–200 unique track UIDs and `analysis`/`bliss` pipelines. Planning declares audio-read bytes and pending/refresh effects. Requeue is not DSP completion. Status can follow exact owned-plan generations and reports implementation/backend/source evidence or unknown.                                                                                                                                        |
| Sync: `plan_library_sync`, `run_library_sync`                    | `library.sync.run`                                                     | Album/artist UID or explicitly limited global set, at most 100 indexed albums. No silent truncation or discovery of new album directories. Frozen scanner payloads preserve entity UIDs and field locks; exact removals, artist summary updates and optional artwork-materialization jobs are declared.                                                                                                       |
| Export: `plan_metadata_export`, `run_metadata_export`            | `library.metadata.export`                                              | 1–20 album UIDs, at most 100 tracks per album, configured destination preset. Isolated metadata JSON sidecars and a private ZIP artifact, with no audio or artwork export. Both total uncompressed metadata and the archive are bounded to 16 MiB. No overwrite.                                                                                                                                              |
| Import: `plan_metadata_rehydrate`, `run_metadata_rehydrate`      | `library.metadata.rehydrate`                                           | Exact local album/track UIDs from a configured source preset. `fill_missing` or `replace_unlocked`; field-level before/after/conflicts, source SHA-256 and DB CAS. Imports enumerated album/track metadata only, preserving manual locks and recording `portable_import` provenance. Audio tags, computed DSP/bliss results, filesystem paths, artist identities and infrastructure backups are not imported. |

High-risk/destructive and global plans **always** require an independent human approval, even when
an integration policy allows bounded actions without approval. Current credentials, delegated grant,
actor capabilities, accepted scopes, policy revision, immutable plan version and reserved approval
are checked again before effects. Human review requires `agents.plans.review`/`agents.plans.approve`
and the operation's domain capability. A metadata reviewer does not need the repair capability.
The Admin reviewer displays complete targets, values, effects, sources and conflicts; incomplete,
manual-only or expired plans cannot be approved for execution.

Admission reserves overlapping entity/artist keys, with global operations conflicting with all
library effects. Each integration has at most one active maintenance job. A durable effect marker
prevents a second delivery from repeating a potentially started filesystem/provider operation.
If a timeout or lost worker heartbeat terminates the runtime before its result was recorded,
`get_plan`, the Admin plan list, `get_job` and idempotent application replay derive explicit
partial/manual reconciliation evidence from the durable effect marker and terminal task status.
This requires no second delivery or writes during a read. The runtime task remains failed; the
plan reports uncertain effects. A failure before that marker reports no started effects instead.
Recorded results take precedence. Prepare a new plan from current state instead of assuming
rollback or repeating effects. Pending cancellation is supported. Cooperative
checkpoints do not imply the broader running-cancellation and retry controls planned for phase 5.

DSP stores generation, claim token and actual pipeline signature. Result commits compare the
claimed generation/token and source identity; a reset or replaced source fences old deliveries.
Signatures record implementation/runtime/backend/model/binary evidence where available. A legacy
result without that evidence remains unknown. `get_analysis_status(plan_id=...)` follows only that
plan's generations, including after an interrupted response; changed generations are superseded,
missing tracks are terminal not-found, and source/signature mismatch is verification failure.
It reports recorded computation evidence, not a new live filesystem scan during HTTP.

The 2026-10-17 concurrency-test follow-up observes the actual worker backend PID in
`pg_stat_activity`: its processing-row `FOR UPDATE` must be waiting for the reset transaction,
identified by `pg_blocking_pids`, before that transaction commits. Separate read scopes avoid
stale statistics snapshots. A delayed nonlocking worker fails both analysis/bliss variants;
elapsed time alone cannot satisfy the assertion. All 63 focused cases in
`test_agent_analysis_sync.py` passed with real PostgreSQL and no skips; targeted Ruff and
Pyright passed. This follow-up changes test synchronization only.

The next coverage follow-up parametrizes exact analysis operations for both analysis and bliss.
Refresh of a completed result supersedes the old reference, rejects the old claim and remains
unverified until the new generation completes; prior values remain cached. Artist sync tests cover
two indexed albums, stable order/identity, exclusions, conflicts in either position and rollback
inside a failing album while preserving an earlier album's commit. Atomicity is per album;
multi-album results can be partial. All 79 focused cases in `test_agent_analysis_sync.py` passed
with real PostgreSQL and no skips, alongside targeted Ruff and Pyright. New fixtures use synthetic
audio and frozen scanner payloads rather than running DSP. No runtime behavior changed.

CI exposed an existing cross-file fixture consumer that omitted the new pipeline argument.
The fixture retains its `analysis` default, and the planned-but-not-submitted regression now covers
that legacy call and explicit bliss. The focused run including both fixture-consumer files passed
98 PostgreSQL-backed cases without skips; targeted Ruff and Pyright passed after this correction.

The metadata conflict regression now covers track, album and artist with a real concurrent update
to each entity's table. A stale version must return `SOURCE_CHANGED` before invoking the file
callback or recording an applied-edit audit entry. All three entities' complete metadata state,
including field locks and manual genres, and the audio bytes must remain as they were after the
concurrent update. This also exercises the database-only artist branch. All 42 focused cases in
`test_agent_metadata.py` passed with real PostgreSQL and no skips; targeted Ruff and Pyright passed.
No runtime behavior changed or full local suite was rerun for this follow-up.

The next test-review follow-up checks that accepted batch completion clears `claim_token` and
records `done`. Reset lock observation no longer matches SQL text: backend PID, active state,
lock wait and `pg_blocking_pids` identify the waiting transaction. Authority/revocation and
effect/finalization tests use the supported caller-owned `session=` transaction contract, record
the real backend PIDs and require an observed blocker before releasing the effect. Deadlines
only bound failures; elapsed time cannot prove exclusion. All 116 focused PostgreSQL cases in
`test_agent_analysis_sync.py` and `test_agent_library_operations.py` passed without skips, with
targeted Ruff and Pyright passing. Disposable negative controls failed as expected for a retained
batch token and four delayed workers without locks (two authority cases and analysis/bliss reset).
The two reset variants also passed with lowercase, multiline, aliased SQL and `FOR NO KEY UPDATE`.
This follow-up changes tests and documentation only; no full local suite was rerun.

The subsequent persistent review prompted diagnostic hardening. Structured credential keys are
matched by normalized suffix, including prefixed API keys and auth tokens inside nested objects;
noncredential counters such as `token_count` remain visible. Database evidence queries retain
their closed projections. Metric truncation now measures omitted samples, including the byte
budget, rather than missing minute buckets. Audit cursors validate their frozen window and
timestamp/SERIAL-ID pair before database access, returning `INVALID_ARGUMENT` for malformed
values. Of 31 added cases, 25 failed before these fixes. The focused diagnostics/instance-operations
selection passed 171 cases without skips, including real PostgreSQL audit pagination; structured
credential fixtures use simulated payloads. Targeted Ruff and Pyright passed. No full local suite
was rerun for these corrections.

The following hardening implements the remaining redaction and internal-limit recommendations.
All five diagnostic operations with a `limit` parameter reject nonintegers, booleans and values
outside 1–100 before any evidence read, independently of MCP validation and the retained SQL caps.
Credential markers match normalized key substrings, including compounds and plurals; only known
counter keys containing nonnegative integers are preserved. Text assignments use the same
classification and consume complete JSON values/collections. If a structured credential is
malformed or exceeds parser nesting limits, the remaining text is conservatively omitted when
its boundary cannot be trusted. The initial regression selection failed 88 cases before the fix.
The focused diagnostics, instance-operations and diagnostic-query selection then passed 285 cases
without skips, including real PostgreSQL integrations, valid page boundaries and counter types.
Redaction fixtures use simulated payloads; targeted Ruff and Pyright passed. No full local suite
was rerun for this follow-up.

CI then exposed a delegated-plan consumer whose public `authorization_id` was overredacted.
The regression was reproduced before allowing only valid UUIDs for that metadata key and object
containers for `authorization_context`; nested secrets and invalid metadata values remain redacted.
Unquoted sensitive assignments now consume the rest of their line, including numeric, boolean or
null-looking prefixes, so passphrase suffixes cannot escape sanitization. Other lines remain
available. Artist inspection also rejects nontext identities, including falsy values, with
`INVALID_ARGUMENT` before database access. All 14 added regressions failed before the fixes.
The four diagnostic/operations/discovery files passed 345 cases and the three approval/Admin/quality
consumer files passed 93, without skips, with sequential PostgreSQL-backed integration runs;
targeted Ruff and Pyright passed. The existing first-item `RESPONSE_TOO_LARGE` contract at 40,000
bytes remains explicit; evidence rows are not silently skipped. No full local suite was rerun.

The next review extended unquoted credentials to multiline YAML/PEM. When a sensitive assignment
has no trustworthy structural terminator, sanitization now discards the entire remaining text,
rather than just its line; well-formed quoted and JSON values retain their boundaries. Job filters
must be bounded string lists, and diagnostic sources/metric series must be strings before sorting
or set membership. The initial regression selection failed 20 cases before these fixes. Text over
8,192 characters is replaced with `[redacted-oversized-text]` before regex/JSON processing, avoiding
both unbounded sanitization work and disclosure through a clipped credential prefix; ASCII/Unicode
cases failed before this change. The final 2,048-byte output cap remains. All seven related files
passed 468 focused cases without skips, with real PostgreSQL integrations; targeted Ruff and
Pyright passed. Conservative text omission affects sanitized evidence only, preserving stored data
and the engine's complete private plan documents. No full local suite was rerun.

Counter exceptions in text additionally require a trustworthy terminator: a multiline continuation
cannot inherit the integer exemption. Assignment redaction runs before header masking, preserving
the sensitive label long enough to consume YAML blocks under Authorization/Cookie/Set-Cookie.
Six added/strengthened controls failed before these fixes. The final seven-file focused selection
passed 471 cases without skips; targeted Ruff and Pyright passed.

### Repair review false-positive evidence (2026-10-17)

The persistent review of `91722b295273232df901a1ebd6bf83fd6b1df69c` (20 successful CI
checks) reported an empty-list `IndexError` and swallowed repair authorization denials. Six
focused PostgreSQL cases in `app/tests/test_agent_repairs.py` exercise the production paths:

- `test_missing_or_closed_canonical_issue_is_rejected` covers both a deleted issue and a fixed
  issue. The real compiler reaches its fallback query; `get_open_repair_issues` raises `ValueError`
  for an incomplete selection before any indexing. It never returns an empty list for these IDs.
- `test_invalid_canonical_issue_preparation_records_source_conflict` removes/closes the issue
  after job admission. The real worker persists `conflict` / `SOURCE_CONFLICT`, with verification
  `not_required`, no published plan and no track deletion.
- `test_real_repair_authority_denial_inside_effect_boundary_propagates` revokes an actual
  credential or removes `library.repair.run` after the adapter's preliminary authorization, just
  before `authorize(effect)` inside its `try`. The worker's production authorizer and repository
  raise `DiagnosticError(FORBIDDEN)`, which propagates through the adapter. The durable result and
  finish audit record `failed` / `FORBIDDEN`, with verification `not_required`. The effect callback
  is not invoked; the photo bytes, database flag and open issue remain unchanged, and no
  `planned_library_repair` audit is written. This path does not raise `PermissionError`.

Two disposable, in-memory mutation controls demonstrated sensitivity without changing production
files: returning an empty list instead of the query's `ValueError` failed all four selection/worker
cases (including the two expected `IndexError`s); adding `DiagnosticError` to the adapter's effect
exception handler failed both revocation cases because the denial no longer propagated.

Validation: `test_agent_repairs.py`, `test_agent_library_operations.py` and
`test_repair_selection_contract.py` passed **124 cases without skips**, using Python 3.13 and real
PostgreSQL. Targeted Ruff/Pyright passed. Dispatch and cancellation polling are isolated test
doubles; authority checks, revocation, grants, compilation, result persistence and audit use the
real implementations. No runtime change or full local suite was needed. CI and persistent review
must be checked against the newly published exact HEAD.

### Five confirmed final-review corrections (2026-10-18)

The final review against `main` identified five P2 defects on `36d7aa30`, whose 20 CI checks
were successful. Each defect was reproduced before its correction:

1. **Editorial approval content.** `AgentPlanReview` consumes the compiler's actual top-level
   `selection`, metadata, rules, exclusions, source revision, generation epoch and provenance.
   Review displays every track in order with local/global identity, title, artist, album,
   duration, selection source and manual lock. Missing/inconsistent content, including duplicate
   local track identities, disables approval. Policy-only visibility/refresh changes with an
   empty selection and intentionally empty static playlists remain valid. The displayed data
   supplements the server's existing exact-plan/version approval and authorization checks.
2. **Artist health identity.** The worker revalidates the planned artist under `FOR SHARE`
   before entering the legacy name-based scanner, holding the UID/name/folder/photo state
   through observation and issue persistence. A rename/replacement between the preliminary
   read and the effect is rejected; a concurrent database rename waits until observations are
   persisted against the original UID. This protects database identity, not a filesystem-wide
   snapshot; repair effects retain their separate fresh-evidence and CAS checks.
3. **Inverted show headliners.** Simple and batch matching inspect the normalized primary
   artist plus lineup. All performers share ordered artist/date advisory locks, so two writers
   selecting opposite headliners cannot create independent rows for the same complete lineup
   and location/session. Partial overlap with a different primary artist requires review.
   Distinct dates, sessions and locations remain separate; explicit aliases keep their existing
   correction/reschedule semantics. The batch compiler also rejects repeated selections within
   one plan. Existing duplicate database rows are not automatically consolidated.
4. **Partial bulk cancellation.** `/api/worker/cancel-all` records individual outcomes and
   continues after `STATE_CONFLICT`, `NOT_FOUND` or `LIMIT_EXCEEDED`. Terminal races count as
   skipped; only accepted cancellation requests count in the compatible `cancelled` field.
   `skipped` and `items` are additive response fields. Admin communicates partial results and
   does not claim that a running worker has acknowledged stopping. The existing bounded task
   listing remains unchanged.
5. **Durable source attribution.** Local parsing operates on each consumed text/OCR block,
   preserving its own upload or URL reference. A model that sees multiple blocks/images uses a
   server-generated `source-set:sha256:` reference, backed by a compact manifest with original
   references, hashes, modality and confirmed-read state. Unread URLs/images cannot be claimed
   as evidence. Draft validation restores the original candidate's reference/evidence and
   trusted manifest instead of accepting replacements from the editor. The manifest persists
   inside `show_sources.evidence.candidate` after private draft expiry; raw source text is not
   duplicated into each candidate. The draft/UI candidate contract remains closed. The global
   60,000-character/200-candidate limits, one model call, model-selection check and cancellation
   checkpoints remain in force.

Independent SPEC and QUALITY reviews checked the five corrections. QUALITY found an additional
provenance edge case: successful vision with `candidates=[]` left its manual fallback without a
source reference. One-image and two-image worker→draft→manual correction→preview/apply tests
failed before the minimal fix. They now retain the image references and hashes durably, while
failed vision remains unconfirmed and existing per-block OCR/text references remain intact.
Final independent reviews have no outstanding P1/P2 findings. The published correction commit
`da275ce455de2a17b9980857d2967f0d1a5c35e7` passed all 20 CI checks. Its completed persistent
review reported only a P3 in the older relation-write/consolidation test. That test now observes
the consolidation backend blocked by the relation writer's PID before releasing it, then verifies
the actual outcome. All three attendance/reminder/removal variants passed with real PostgreSQL;
an in-memory control removing the shared redirect lock failed all three at the lock assertion.
No runtime change was needed for that follow-up.

Focused validation used Python 3.13 and real PostgreSQL, with executions sharing the test
database run sequentially:

```sh
cd app
../.venv/bin/python -m pytest tests/test_tasks_api.py tests/test_agent_health_operations.py tests/test_show_identity.py tests/test_show_import_plans.py tests/test_show_extraction.py tests/test_task_cooperative_cancellation.py tests/test_mcp_shows.py tests/test_show_import_api.py tests/test_show_extraction_jobs.py tests/test_show_extraction_sources.py tests/test_show_llm_budget.py -q
../.venv/bin/python -m pytest tests/test_show_extraction.py -q
```

The eleven-file run passed **246 cases**. The extraction file passed **22 cases** after adding
the five vision edge-case controls: **251 distinct backend cases** passed overall. Both runs
omitted only the opt-in real-model smoke; no PostgreSQL cases were skipped. In this Linux
checkout the commands ran in the disposable `crate-show-ocr-test:20261016-make` image with the
repository dependencies, Docker socket/Testcontainers and Tesseract, since the host virtualenv's
interpreter path was unavailable. The provenance regressions use simulated OCR/model responses
and actual draft, plan, worker and database persistence; they do not assess a live model's
extraction quality. Existing local OCR controls also execute Tesseract.

Admin's two changed test files passed **59 cases** (51 plan-review, 8 tasks). Admin typecheck,
directed ESLint, Ruff check/format and directed Pyright passed. React Doctor 0.9.18 found no issues
in the three changed production Admin files after using selection identity/position as row keys.
Concurrency regressions require
the expected PostgreSQL backend PID in `pg_blocking_pids` before releasing the held transaction;
elapsed time alone cannot prove serialization. A disposable in-memory control removing the health
guard's `FOR SHARE` failed the lock-observation test because the rename completed without waiting.
No production file was mutated for that control. No full local suite was rerun, migrations were
not changed and no deployment or flags were activated. CI and persistent review must be read
against the exact newly published HEAD.

### Six confirmed follow-up corrections (2026-10-18)

The next final review identified six P2 defects on `f1a777a0`, whose exact-HEAD CI had
20 successful checks. Focused regression selections reproduced **51 expected failures** before
their respective fixes, with positive controls distinguishing each defect from setup failures:

1. **Legacy job cancellation.** `cancel_job` now compares the complete accepted authorization
   context, restricts the legacy endpoint to directed health checks and pilot repairs, and
   reauthorizes the original required grants before effects or idempotent replay. A refreshed
   OAuth token with reduced scopes cannot cancel a job accepted under its wider context, even
   with the same authorization ID. An unchanged refreshed context remains valid. PostgreSQL
   tests cover both service credentials and actual Authlib refreshes, grant removal and replay,
   non-pilot operations, ownership and the existing cancellation/claim race.
2. **Physical DSP source at persistence.** Successful analysis/bliss writes recheck the daemon's
   captured device, inode, size and nanosecond timestamps after acquiring the processing and
   track row locks. Replaced, missing or symlinked sources terminalize the still-owned claim as
   `failed` / `SOURCE_CHANGED`, clear its token and write neither stale output nor its signature.
   Single/batch storage and completion helpers share the fence. A changed batch member does
   not prevent valid neighbors from completing. Failure/release cleanup still works after a
   source disappears, and internal compatibility writes without a physical-source snapshot
   retain their previous generation/token/path contract. This is a fresh observation under
   database locks, not an atomic filesystem/database snapshot against uncoordinated writers.
3. **Editorial refresh policy result.** The repository returns `is_active` from the playlist
   snapshot it locked. The adapter can therefore report an already committed policy change as
   `completed`, without a post-commit `KeyError` or false reconciliation requirement. Worker
   regressions cover enabling/disabling refresh for active/inactive playlists, exact approval,
   preserved selection, history, Listen URL, private result and idempotent replay. Concurrent
   edits still conflict.
4. **Spotify URL enrichment.** The URL facet accepts the normalized result actually returned
   by `spotify.search_artist`, including existing cached entries without `url`. When an explicit
   valid URL is absent, a valid 22-character base62 artist ID yields the canonical Spotify artist
   URL. Invalid IDs produce no invented URL. Tests use the real search wrapper, compiler,
   adapter and PostgreSQL persistence, isolating only cache, HTTP and rate limiting; unselected
   identity, popularity, tags, genres, locks and setlists remain unchanged.
5. **Lineup text search.** Canonical show search includes each lineup performer in its escaped
   `ILIKE` filter. Tests verify literal `%`, `_` and `!`, plus date, archive and consolidation
   restrictions.
6. **Lineup artist/following reads.** Artist upcoming, feed and following-upcoming queries compare
   primary and lineup names using case-insensitive, whitespace-normalized exact equality. Tests
   import a real manual lineup and find its differently cased/spaced support act through all
   three readers. Similar longer names, past and merged shows remain excluded; each reader
   retains its existing cancellation policy. No alternative event model or matching rule is added.

The DSP concurrency regression holds a real track row lock, observes the storage backend PID
waiting on that writer via `pg_stat_activity` / `pg_blocking_pids`, replaces the audio at the same
path and commits its metadata update before allowing persistence to continue. A control changes
only database metadata and accepts the unchanged audio. Timeouts only bound test failure; they
never count as evidence of exclusion. DSP tests use temporary synthetic audio and explicit result
payloads, not a live DSP computation. Spotify HTTP responses are simulated, not production-provider
validation. No migration, merge, deployment or feature activation is part of this correction.

Independent SPEC and QUALITY reviews found no outstanding P1/P2 in these corrections. QUALITY
also identified outer tabs/newlines in legacy performer rows: SQL now collapses whitespace before
trimming, matching the request-side normalization. Six additional PostgreSQL cases failed before
that adjustment, covering primary/lineup names through all three readers.

Focused validation with Python 3.13 and real PostgreSQL passed **481 distinct cases without
skips** in sequential runs:

```sh
cd app
../.venv/bin/python -m pytest tests/test_analysis_source_fence.py tests/test_agent_job_controls.py tests/test_show_lineup_reads.py tests/test_mcp_editorial.py tests/test_editorial_plans.py tests/test_agent_enrichment.py tests/test_agent_analysis_sync.py tests/test_agent_oauth_jobs.py tests/test_mcp_phase4_review_regressions.py tests/test_agent_sync_identity_regressions.py -q
../.venv/bin/python -m pytest tests/test_shows_queries.py tests/test_show_identity.py tests/test_shows_shared.py tests/test_home_upcoming.py tests/test_mcp_shows.py tests/test_analysis_daemon.py tests/test_db_access_boundaries.py tests/test_runtime_boundaries.py -q
../.venv/bin/python -m pytest tests/test_show_lineup_reads.py -q
```

The initial runs passed 266 and 209 cases respectively; the lineup file then passed all 21,
including the six added legacy-whitespace controls. All used the same disposable Linux image
described above. Directed Ruff check/format and Pyright passed for all fourteen changed Python files;
documentation integrity passed for 44 canonical documents. No full local suite was rerun.
CI and persistent review must be checked against this correction's newly published exact HEAD.

The first correction commit, `3f619f21`, completed persistent review with **no major issues**.
Its CI exposed an older generic-apply cancellation test still using the legacy pilot endpoint;
the neighboring focused selection exposed the same assumption for preparation. Both failures
were reproduced locally. Those tests now use the real `job_cancel` preparation, exact human
approval and control worker, while explicitly requiring legacy rejection. They verify that a
cancelled preparation cannot claim/compile or create a metadata plan, and that a cancelled apply
has a cancelled visible plan and cannot repeat effects. No runtime authorization was relaxed.
The follow-up selection below passed **162 cases without skips** with real PostgreSQL; its
counts overlap the earlier 481 and must not be summed. Directed Ruff/Pyright passed. CI and
persistent review are checked again on the follow-up commit:

```sh
../.venv/bin/python -m pytest tests/test_agent_library_operations.py tests/test_mcp_operations.py tests/test_agent_job_controls.py -q
```

### Five confirmed identity and concurrency corrections (2026-10-18)

The final review of `a83ed3ac` found five P2 defects despite its 20 successful CI checks and
completed persistent review with no major issues. Each correction has permanent focused
regressions reproduced against the broken implementation before applying the fix:

1. **DSP and library writer lock order.** Processing lifecycle operations now lock local tracks
   in ID order before their processing rows. Sync removal, which locks tracks before cascading
   into processing state, can complete while an analysis/bliss result, refresh, legacy requeue,
   reset, release or failure waits. A removed refresh target returns `SOURCE_CHANGED` rather
   than raising during the locked reread. Claims skip tracks held by library writers. Twelve
   PostgreSQL cases reproduced actual deadlocks, and two more reproduced blocked claims.
   Independent review of the first fix identified a stale-statement claim race: three further
   cases reproduced token replacement and a stale bliss/analysis exclusion. Claim selection
   now only locks tracks; a second statement rechecks pending state and the analysis exclusion
   with a fresh snapshot before assigning tokens. Both statements share one transaction and
   retain the generation, token, path and physical-source fences.
2. **Editorial global/local identity.** Persistent exclusions and manual/locked entries match
   their generated counterparts when a global track acquires a local source. Both editorial
   plans and the existing Admin regeneration repository use the same identity comparison:
   global UID, local UID, storage identity, local ID, then path. The first identity known by both
   rows decides the match; disagreement on a stronger identity never falls back to a reused
   path. Edit/refine also reject excluding a protected global entry through its equivalent
   local UID. Thirteen regressions failed before correction; eleven positive controls cover
   remote-only entries, distinct global identities and replacement tracks at an old path.
   Worker tests verify exact approval, persisted selection, overrides, positions and replay.
3. **OAuth data versus credential carriers.** `client_id`, `state` and preference cookies may
   contain `crate_mcp_` without being treated as machine credentials. Both human resolution and
   middleware inspect actual credential carriers: all Authorization headers, every `token`
   and `media_ticket` query value, and each supported authentication cookie before duplicate
   names collapse. Machine credentials in those carriers still prevent human fallback. Five
   OAuth/resolver regressions and sixteen duplicate-carrier cases failed before correction;
   ordinary consent and existing isolation controls remain covered.
4. **Provider match after a manual show correction.** A semantic match is rechecked after
   acquiring the selected show's write lock. If a manual correction changed its identity while
   the provider waited, the provider receives a conflict before linking its source or evidence.
   Exact provider aliases and explicitly selected IDs retain their rescheduling contract.
   A concurrent PostgreSQL regression reproduces the stale match, with a fresh-match control.
5. **Show artist UID reads.** Canonical UID filtering, unambiguous primary-artist references,
   single/batch identity matching and invalidation now collapse whitespace before trimming and
   compare names case-insensitively. This includes lineup performers and legacy outer tabs or
   newlines. Distinct longer names, visibility/date restrictions and ambiguous normalized
   library names remain explicit controls; ambiguity never invents a primary artist UID.
   Sixteen regressions reproduced missing matches/invalidations and an ambiguous UID.

Concurrency tests observe the expected PostgreSQL backend PID and `pg_blocking_pids` before
releasing the writer or advisory gate. Timeouts only bound failures. The claim gate fixes an
old statement snapshot before a second real claim commits; it does not replace the claim SQL
or its row locks. DSP payloads and scanner metadata are synthetic, while source files,
transactions, cascades and persistence are real. Provider scheduling is controlled locally;
these cases do not contact live providers or assess DSP/model quality. OAuth consent uses the
actual AuthMiddleware, router, registered client and database session.

Focused Python 3.13/PostgreSQL validation passed **683 distinct cases without skips** in these
two sequential selections (368 and 315 cases respectively):

```sh
cd app
../.venv/bin/python -m pytest tests/test_mcp_auth.py tests/test_mcp_oauth_integration.py tests/test_mcp_oauth.py tests/test_mcp_oauth_concurrency.py tests/test_editorial_plans.py tests/test_mcp_editorial.py tests/test_playlist_track_overrides.py tests/test_show_identity.py tests/test_show_lineup_reads.py tests/test_show_import_plans.py tests/test_shows_queries.py tests/test_shows_shared.py tests/test_mcp_shows.py tests/test_show_import_api.py -q
../.venv/bin/python -m pytest tests/test_analysis_writer_serialization.py tests/test_agent_analysis_sync.py tests/test_analysis_source_fence.py tests/test_analysis_daemon.py tests/test_agent_sync_identity_regressions.py tests/test_mcp_phase4_review_regressions.py tests/test_agent_repairs.py tests/test_db_access_boundaries.py tests/test_runtime_boundaries.py -q
```

They ran in the disposable Linux image described above with repository dependencies and real
PostgreSQL/Testcontainers. Independent SPEC and QUALITY reviews, including a second look at the
claim fix, found no remaining P1/P2. Directed Ruff check/format and Pyright passed for all twenty
changed Python files. No full local suite, migration rewrite, deployment or flag activation is
part of this correction. CI and persistent review must be checked against its newly published
exact HEAD.

### Three confirmed worker and show corrections (2026-10-18)

A further review of `745f96f0` found three P2 defects, despite its 20 successful CI checks.
Permanent focused regressions reproduced **14 expected failures** before their respective fixes:

1. **Disable gates on derived worker jobs.** Raw catalog jobs created by an approved
   `schedule_run` or `job_retry` retain their authorization and now also require both
   `CRATE_MCP_ENABLED` and `CRATE_MCP_ACTIONS_ENABLED` at worker admission and cooperative
   checkpoints. Disabling either flag prevents new cache/snapshot publication. Revocation and
   required grants are still checked; an authority failure during requested cancellation never
   becomes a successful cancellation acknowledgment. Ordinary Admin/scheduler tasks continue
   independently of MCP flags. Six regressions failed before this change. Sixteen cases cover
   approved parent plans, durable replay, raw child tasks, both flags, revocation, requested
   cancellation and non-agent origins, with actual actors, handlers and PostgreSQL persistence.
2. **Exact lineup after a creation preview.** If a provider creates the same show between
   preparation and application, an explicitly selected lineup must still match the complete
   normalized performer set, including both primary artists. A subset must not authorize
   deleting an additional performer that was absent from the reviewed `before`. A mismatch
   conflicts and rolls back the complete selection, including any earlier row in the batch.
   Equivalent case/whitespace, repeated names and inverted primary artists still deduplicate;
   omitting lineup preserves the provider's lineup. Explicitly removing an existing performer
   remains possible with its reviewed revision. Five regressions failed before correction.
   Twelve cases verify full saved rows, aliases, provenance, attendance/reminders, unselected
   fields, invalidation, revision conflicts and durable replay without further effects.
3. **First bliss centroid versus metadata/sync.** Metadata edits and strict album sync retain
   their parent-first artist lock using `FOR NO KEY UPDATE`. This excludes other parent updates
   and protects identity while allowing the FK `KEY SHARE` needed by a bliss writer inserting
   the first artist centroid. Track and album locks remain unchanged; vector, processing state,
   signature and centroid still commit in one transaction. Three PostgreSQL regressions
   reproduced actual deadlocks for track metadata, album metadata and strict sync. Nine cases
   cover first/existing centroids and prove that a concurrent parent folder update must wait
   until each library writer commits. Metadata can legitimately report `SOURCE_CHANGED` after
   waiting for the vector write; strict sync excludes DSP fields from its source version.

Concurrency cases require the expected backend PID in `pg_blocking_pids` before releasing the
writer. Timeouts only bound failures. They use real temporary FLAC files and explicit DSP vectors;
no live DSP computation or external provider is exercised. Analytics replaces only its expensive
computation and forces cache persistence through PostgreSQL; quality computes and publishes its
real metadata-only snapshot. Broker dispatch and progress delivery are simulated. Parent-lock
coordination here concerns planned metadata and strict sync; legacy scanner transactions are
not a globally serialized filesystem/database snapshot.

Focused validation passed **561 distinct cases without skips** in two sequential PostgreSQL
selections (252 and 309 cases):

```sh
cd app
../.venv/bin/python -m pytest tests/test_bliss_writer_serialization.py tests/test_mcp_operations.py tests/test_task_control_actor.py tests/test_task_cooperative_cancellation.py tests/test_show_import_plans.py tests/test_show_identity.py -q
../.venv/bin/python -m pytest tests/test_agent_metadata.py tests/test_agent_analysis_sync.py tests/test_analysis_writer_serialization.py tests/test_analysis_source_fence.py tests/test_agent_sync_identity_regressions.py tests/test_agent_oauth_jobs.py tests/test_agent_job_controls.py tests/test_db_access_boundaries.py tests/test_runtime_boundaries.py -q
```

Both used Python 3.13 and repository dependencies in the same disposable Linux image with
PostgreSQL/Testcontainers described above. Directed Ruff check/format and Pyright passed for
all seven changed Python files. No full local suite, migration, deployment or flag activation
is part of this correction. Independent SPEC and QUALITY reviews found no remaining P1/P2
in these changes. CI and persistent review must be checked against the newly published exact HEAD.

### Test review follow-up (2026-10-18)

Persistent review of `45e67b33` identified four P3 test issues. This follow-up changes test
coordination and assertions without changing production behavior:

- The analysis/bliss reset race waits for either the worker's backend PID or its completion;
  an exception before reaching the fence propagates directly. The configurable harness timeout
  is `CRATE_TEST_CONCURRENCY_TIMEOUT` seconds (default 60, minimum 1), with a PostgreSQL local
  lock timeout of half that duration (default 30). Startup, lock observation and completion use
  the harness bound. Success still requires the expected PID waiting on the reset transaction
  in `pg_blocking_pids`; elapsed time never proves exclusion.
- The daemon test retains the full clock API in a local copy and replaces only its sleep
  function. Other threads and PostgreSQL keep the real process-wide clock.
- The authorization exception crosses `transaction_scope` before `pytest.raises` catches it,
  allowing rollback. Both human-operation and remote-credential denials must be `FORBIDDEN`.
- Exact plan approval uses `tests/agent_plan_support.py`; its six consumers no longer import
  the decision helper from another test module.

Two additional test suggestions were applied: the quarantine symlink now points to a directory
provably outside the library, and the raw-task regression observes `FORBIDDEN` from the real guard
invoked by the actor. The latter separately recognizes the existing `NOT_FOUND` propagated by
the generic actor's agent-job failure bridge for raw tasks without an `agent_jobs` row, and still
requires a persisted failed task, unchanged effects and no cancellation acknowledgment.
The proposed permissive failure stub was not adopted: the real `_mark_failed` accepts only two
positional arguments and keyword-only `claim`. The concurrency barrier is already the worker's
first instruction with a bounded wait; aborting it after failure would not address the suggested
pre-barrier failure path.

Focused validation passed **313 distinct cases without skips**, including all six approval-helper
consumers and the affected analysis, show-import and quarantine cases:

```sh
cd app
../.venv/bin/python -m pytest tests/test_agent_analysis_sync.py tests/test_show_import_plans.py tests/test_agent_repairs.py::test_repair_quarantine_never_follows_a_symlink_in_its_destination tests/test_mcp_operations.py tests/test_agent_plan_approvals.py tests/test_mcp_editorial.py tests/test_mcp_phase4_review_regressions.py tests/test_agent_library_operations.py -q
```

Python 3.13 and repository dependencies ran in the disposable Linux image with real PostgreSQL
through Testcontainers, sequentially. Directed Ruff check/format and Pyright passed for the nine
changed Python files. Documentation integrity passed for 44 canonical documents; independent
review found no P1/P2/P3 in this test-only cut. These tests use deterministic daemon/DSP/provider inputs and simulated
broker dispatch; no live model or provider was exercised. No full local suite, production code,
migration or flag was changed. CI and persistent review must be checked on the published exact HEAD.

### Five permission and integration corrections (2026-10-19)

The final review of `11bf314e`, despite its 20 successful CI checks, reproduced five P2 defects.
Permanent regressions produced **30 expected failures** before correction: 12 for repairs/member
enrichment, 11 for OAuth and analysis authority, and seven across the two Admin components.

1. **Analysis retains its existing human capability.** `library.analysis.run` requires
   `library.analysis.manage` for delegated consent, token resolution, worker reauthorization and
   human plan review. `library.metadata.write` alone is insufficient. The regressions use real
   persisted roles, a stale admin JWT, an editor denial, a librarian success and an admin-to-editor
   downgrade at both token and worker boundaries. The generated 1.1.0 catalog changes only this
   capability mapping; tools, grants and schemas remain the same.
2. **MusicBrainz members retain the shared object schema.** Scoped enrichment stores bounded
   `name`, `type`, `begin`, `end` and `attributes` objects instead of strings. Missing optional
   fields stay absent; empty strings and `end: null` remain distinct. Limits are 100 members,
   200 characters per string and 50 attributes per relation. Malformed members produce a partial
   result without replacing persisted metadata. Actual provider-cache adapters, PostgreSQL,
   audit and both shared graph readers verify the result; populated or manually locked fields
   retain their policy protection. No live MusicBrainz call is part of this evidence.
3. **Repairs and bliss use compatible artist locks.** Both the initial repair lock and its locked
   source reload use `FOR NO KEY UPDATE` for artists. Album and track locks remain `FOR UPDATE`.
   A destructive artist deletion promotes its artist lock to `FOR UPDATE` after descendant locks
   and before source CAS/filesystem effects, preventing new FK dependencies during deletion.
   Real PostgreSQL races cover first/existing centroids, artist/album/track identity changes,
   and opposite FK behavior after the locked reload for ordinary versus artist-delete repairs.
   Expected blockers are observed by backend PID. Vector, processing state, signature and
   centroid still commit atomically; timeouts only bound failures.
4. **External human login resumes MCP consent.** Google/Apple login may return only to the exact
   `/oauth/authorize` or `/oauth/connections` path on the configured valid issuer. Authorization
   requires OAuth enabled; connection management remains available when disabled. Local HTTP
   requires the existing explicit development opt-in. The provider callback origin and general
   frontend-origin allowlist remain unchanged. OAuth state and the final query survive byte for
   byte, including PKCE and client state; `access_expires_at` is not appended to MCP destinations.
   Callback tests use signed state and JWT expiry with isolated provider/session I/O. Negative
   cases cover cross-origin, userinfo, port, scheme, subpath, traversal, fragments, controls and
   invalid issuer configuration.
5. **Year rules and metadata-only edits agree.** Admin preserves year inputs and range endpoints
   as text and canonicalizes legacy numeric years for previews or changed rules. Other numeric
   fields remain numeric. Metadata-only saves omit unchanged rules, preserving legacy definitions
   without regeneration. Outbound rule edits retain noneditable options such as per-artist limits
   and deduplication. The server's strict four-digit year contract is unchanged. Component tests
   cover the emitted requests; actual API/PostgreSQL controls save legacy metadata without
   resubmitting rules and execute canonical year/range previews against real library rows.

Focused validation passed **331 distinct backend cases without skips** and **61 Admin component
cases**. Python 3.13 and repository dependencies used the disposable Linux image and sequential
PostgreSQL/Testcontainers runs. The selections were:

```sh
cd app
../.venv/bin/python -m pytest tests/test_mcp_analysis_authority.py tests/test_mcp_login_return.py tests/test_agent_repairs_bliss_serialization.py tests/test_agent_enrichment.py tests/test_playlist_editor_years.py -q
../.venv/bin/python -m pytest tests/test_agent_repairs.py tests/test_bliss_writer_serialization.py tests/test_agent_oauth_jobs.py tests/test_mcp_oauth_integration.py tests/test_agent_plan_approvals.py tests/test_mcp_distribution.py tests/test_playlist_rule_contract.py -q
../.venv/bin/python -m pytest tests/test_agent_repairs_bliss_serialization.py::test_non_delete_repair_allows_first_centroid_foreign_key_after_locked_reload tests/test_auth.py -k 'oauth or redirect or non_delete_repair' -q
```

These runs passed 116, 171 and 44 cases respectively; the last adds one serialization control
and 43 existing auth cases. The first command preceded that additional serialization test.
From the repository root, `npm run --workspace=app/ui test -- src/pages/PlaylistEditor.test.tsx src/pages/AgentPlanReview.test.tsx`
passed all 61 selected cases. Directed Ruff check/format, Pyright, ESLint, Prettier and Admin
typecheck passed. Documentation integrity passed for 44 canonical documents. Independent SPEC
and QUALITY reviews found no remaining P1/P2 in this correction. No full local suite, migration,
production provider/model call, deployment or
flag activation was performed. CI and persistent review must be checked on the published exact HEAD.

### Repair readiness and effects

`get_operation_catalog` publishes the contract of every check, conditional variant, preconditions,
effects, limits, cancellation/retry policy, reversibility and verification.

| Checks                                                                                                              | Automatic variant                                                                      | Risk/effects                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `has_photo_desync`                                                                                                  | Exact UID, fresh filesystem evidence and DB CAS                                        | Recomputes a database flag; no image writes.                                                                                         |
| `fk_orphan_albums`, `fk_orphan_tracks`                                                                              | Frozen orphan membership; unique canonical reassignment or exact deletion              | Destructive deletion can remove declared dependent relationships; mandatory human approval.                                          |
| `stale_artists`, `stale_albums`, `stale_tracks`, `zombie_artists`                                                   | Current absence/empty-membership evidence plus complete bounded DB/dependent manifests | Destructive database cleanup; no undeclared filesystem cleanup.                                                                      |
| `tag_mismatch`                                                                                                      | Reread approved file tags and CAS of exact indexed track metadata                      | Declared DB changes and protected manual choices; no implicit artist resync.                                                         |
| `duplicate_albums`                                                                                                  | Indexed stable-UID copies with a frozen keep/drop choice                               | Reversible DB quarantine; audio is preserved. Legacy folder-merging variants remain manual.                                          |
| `duplicate_tracks`, `shadow_quality_tracks`                                                                         | Verified indexed copies, frozen keep/drop choices and file fingerprints                | Exact audio quarantine and DB/reference effects; no irreversible audio unlink. Partial moves are reported.                           |
| `duplicate_folders`, `canonical_mismatch`, `artist_layout_fix`, `unindexed_files`, `folder_naming`, `missing_cover` | Manual/diagnostic contracts                                                            | Collision/identity/layout decisions or staged, verified artwork are required. No automatic MCP wrapper around legacy broad handlers. |

A selection containing any manual variant cannot partially execute its other items: prepare a new
exact automatic selection. Whole-library repair is not inferred from an empty selection. Admin's
versioned selected-repair path uses the same compiled domain contract and worker effects as MCP.
Admin prepares the selection asynchronously and keeps its compiled manifest in a private,
actor-owned, expiring store; shared task/SSE results contain only a minimal summary. Applying
requires the preparation ID, complete version and exact selected IDs, with current authority
checked again in the worker. Metadata tag writes refresh affected album and canonical artist
size totals in their transaction, excluding quarantined albums from the artist total.
Internal explicitly global legacy jobs retain their separate existing policy and are not exposed
as generic MCP dispatch.

### Metadata presets and authorized artifacts

Configure server-owned presets in `app/config.yaml`; the default is an empty map. Create the root
directories with permissions for the maintenance worker. API and worker need the same shared path
for artifact downloads; `/data` is already shared by the standard Compose services.

```yaml
agent_metadata_presets:
  editorial_export:
    root: /data/agent-metadata/exports
    export: true
    rehydrate: false
  reviewed_import:
    root: /data/agent-metadata/imports
    export: false
    rehydrate: true
```

Preset IDs, purposes and configured/unavailable evidence are discoverable by appropriately granted
integrations; paths remain server-side and filesystem readiness is checked in the worker. Export
roots must be separate from `/music`. An export creates an isolated UUID directory with
`<album_uid>/.crate/album.json` files and `metadata.zip`. A source preset points at the root containing
those album UID directories; it may reference a reviewed prior export directory. The import plan
resolves conflicts before applying; full DB restore and importing computed analysis are separate
operations, not implied by rehydration.

The result contains an opaque `artifact_id`, SHA-256, byte size, filename, expiry and
`download_path=/mcp/artifacts/<uuid>`. Download requires the same exact principal/authorization
context and a current `library.metadata.export` grant, plus the dedicated unmixed Bearer credential.
The route shares MCP Host/Origin allowlisting, rejects human cookies/query/Remote-User fallbacks,
checks completion/expiry and verifies a bounded regular file's digest. An artifact expires after
24 hours. Expiry revokes access; it is not automatic disk cleanup, so operators must apply their
existing storage retention policy to export directories.

### Phase 4 validation

Phase 4 tasks 4.1–4.3 are implemented and locally validated against PostgreSQL, real filesystem
fixtures and SDK HTTP. Independent specification and final quality/security reviews approved the
completed changes with no outstanding P1/P2 findings. Deployment remains disabled;
validation does not claim a live public-proxy rollout or external-provider production exercise.

Closing regressions were run as focused selections: **84 shared engine/diagnostic tests**, including
timeout and lost-heartbeat outcomes; **103 migration/access/workflow tests**; **68 sync and legacy
write tests** plus the final rollback race; **40 metadata tests** with real FLAC tag growth; and
**217 selected-repair/Admin tests**. A separate four-case migration selection verified rollback,
preservation of legacy jobs and repeated upgrade after the final SQL cleanup. Counts overlap and
must not be added together. Admin's changed reviewer, repair dialog and task-wait flows passed
**37 tests**. Ruff, Pyright, changed Admin ESLint/type checks, Admin/docs builds and documentation
integrity checks passed. A medium/high-confidence Bandit scan found no reportable issues.

Ten focused transport regressions cover a complete 35 KB biography diff after execution, a real
adapter result with more than 400 KB of setlists, stable application replay and all **1,020 outcome
records** across bounded pages. Full plan/job/audit evidence remains unchanged. Five additional
owned-plan/authority SDK callers passed after the contract change. Database/runtime boundaries
passed **96 tests**. Complete suites are reserved for the end of development, as requested.

The synthetic load fixture uses **900 artists, 4,800 albums, 48,000 tracks and 96,000 pipeline
rows**, real PostgreSQL/Redis and the official MCP SDK over local TCP. Its twelve samples per read
recorded p95 **30.1 ms** for quality, **133.9 ms** for analysis status and **69.5 ms** for an exact
plan. These are local measurements, not latency assertions or a production SLO. Pagination returned
all **400 analysis states in 20 pages**, with a largest structured page of **40,738 bytes** and
version-bound cursor invalidation. Two concurrent worker preparations were durable and replayed
without duplicate dispatch. Instrumentation observed **zero HTTP library aggregates and zero
HTTP compiler/filesystem/DSP calls**.

Evidence: [measurement JSON](../testing/measurements/crate-mcp-phase4-library-load-2026-10-16.json).
Reproduce the focused benchmark from `app/` with
`../.venv/bin/python -m pytest tests/test_mcp_library_performance.py -q`.

## Phase 5 instance operations — 2026-10-16

Phase 5 adds 12 tools (40 total) and eight explicitly provisioned grants (24 total).
Migrations through **115** are required. Both MCP flags still default to false; no deployment
or production activation is included.

| Tools                                               | Required grant                         | Contract                                                                                                               |
| --------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `read_audit`                                        | `ops.audit.read`                       | Sanitized, bounded, cursor-paginated audit evidence; at most 24 hours. No arbitrary details or credentials.            |
| `list_schedules`                                    | `ops.schedules.read`                   | Pure reads of 16 known schedules, revision, last enqueue and last success, with operation-specific readiness.          |
| `get_runtime_policy`                                | `ops.runtime.read`                     | Configured policy, consumer observations and effective revision are distinct.                                          |
| `preview_job_retry` / `apply_job_retry`             | `ops.jobs.retry` plus original grants  | Exact source, reviewed task variant, three-retry lineage budget, one active retry, no parameter cloning.               |
| `preview_job_cancel` / `apply_job_cancel`           | `ops.jobs.cancel` plus original grants | Cooperative cancellation of reviewed pending/running/delegated work; never finalizing work.                            |
| `run_schedule`                                      | `ops.schedules.run`                    | Prepare an exact plan, then apply its approved ID/version. Governor, enabled state, windows and dedup remain in force. |
| `preview_schedule_update` / `apply_schedule_update` | `ops.schedules.write`                  | Known schedule, interval 0–2,678,400 seconds and expected revision. No arbitrary cron/settings.                        |
| `preview_runtime_update` / `apply_runtime_update`   | `ops.runtime.write`                    | Closed typed policy, expected revision, coherent limits and IANA time zones. Human approval is mandatory.              |

Job control defaults to the same integration and exact delegated authorization context.
Controlling reviewed Admin/scheduler work additionally requires explicit `scope=instance` and
`ops.jobs.manage_instance`. That grant does not allow access to another integration's jobs or
replace the original operation grants. Historical tasks with unknown provenance are not attributed
speculatively to Admin or the scheduler.

The reviewed retry variants are `compute_analytics` with no parameters and `quality_check` with
exactly `scope=global`. The server reconstructs those inputs. Directed phase-2 health retry and
pending cancellation remain supported by the original `retry_job` / `cancel_job` tools. Repairs,
delegated children and work with uncertain cancellation effects require reconciliation or a new
domain plan. The expanded cancellation catalog also includes directed health checks, popularity
work and shared agent maintenance. The initially runnable MCP schedule is `compute_analytics`;
other schedule entries explicitly report their missing reviewed execution contract. Their typed
intervals remain manageable.

A running cancellation persists `cancellation_requested_at` while the task remains running.
Workers check the signal and current retained authority, preserve partial effects and acknowledge
only when execution returns. Delegated requests propagate to children; parents wait for running
children, skip finalizers and acknowledge from the leaves upward. Pending descendants never start.
Completion races preserve the terminal winner. Exceptions, timeouts and lost heartbeats after a
request produce failed work requiring reconciliation, without claiming a confirmed stop or retrying
automatically. `get_job` exposes bounded provenance, retry ancestry, children, requests/acks and a
closed partial-effects projection; full agent execution evidence stays in the owned plan/result.

Cancellation preparation/application uses the closed `agent_control` task on the fast queue
(60-second timeout, no automatic retry). One global control command can run independently of normal
work admission limits, so a full work limit cannot prevent a cancellation request. The handler
accepts only `job_cancel`; it cannot run a library operation through that reserved slot. Normal
agent work retains the existing per-integration active-job budget, with a separate bounded
cancellation command. Library target reservations do not block unrelated runtime/control targets.

Runtime limits apply to **new task starts** across the actual Dramatiq pools. They do not resize
OS processes or kill running work. The claim transaction checks the exact revision/hash used by
resource admission; a policy change defers the claim. Each consumer records the policy actually
used. `effective_revision` stays null until all required current consumer observations match;
idle pools can legitimately leave adoption pending. Reading a policy or sending a heartbeat never
acknowledges it. Missing listener evidence blocks downloads when its corresponding limit is enabled.

Admin schedules, worker limits and download settings use the same repositories, CAS and validation.
Legacy interval maps remain accepted. Worker `slots` / `max_workers` now describe real concurrency
admission; pool caps are clamped when lowering the total. Unsupported `min_slots>1` returns 422
because Dramatiq provides no minimum-process autoscaling control. Admin shows configured concurrency
separately from observed process capacity and displays cancellation requests without premature success.
`read_diagnostics(source=metric_series)` exposes seven enumerated persisted series, at most 100 minute
buckets and 100 returned samples. Missing samples are unavailable evidence, never zero/healthy data.

Rollback 115 fences pending/active phase-5 agent work before dropping retained authorization fields,
disables integrations whose grants are no longer supported and preserves the shipped phase-4 data.
Stop workers before schema downgrade and reconcile any effects of previously active work.

### Phase 5 validation

Independent specification and quality/security reviews passed after regression fixes for task
lifecycle races, replay after source changes, agent-worker cancellation acknowledgements, the exact
quality retry variant and unavailable download telemetry. Focused PostgreSQL-backed tests and official
MCP SDK calls exercise original/instance authority, revoked scopes, closed inputs, human approval,
concurrent claims/retries, cancellation effects/children, CAS, pure reads and real policy adoption.

Reproduce relevant selections from the repository root (sequentially when using a shared test database):

```bash
cd app
../.venv/bin/python -m pytest tests/test_task_cooperative_cancellation.py tests/test_task_control_actor.py tests/test_mcp_operations.py -q
../.venv/bin/python -m pytest tests/test_agent_runtime_policy.py tests/test_agent_runtime_admin_api.py -q
../.venv/bin/python -m pytest tests/test_scheduler.py tests/test_resource_governor.py tests/test_global_catalog_scheduler.py -q
../.venv/bin/python -m pytest tests/test_agent_instance_migration.py tests/test_agent_library_migration.py tests/test_agent_access_migration.py -q
../.venv/bin/python -m pytest tests/test_task_runtime_contract.py tests/test_task_queue_routing.py tests/test_tasks_api.py -q
```

Admin's changed Tasks/permission-label contracts, API/schema/runtime boundaries, Ruff, Pyright,
changed-file ESLint/type checks and the medium/high-confidence Bandit gate are part of this cut's
verification. Complete suites remain reserved for the end of feature development, as requested.
The previous phase-4 commit `7af26ed5` completed all CI jobs; its persistent review has no security
finding and only a conditional import-order suggestion already covered by green Ruff/CI checks.
The new commit's CI and persistent review must be checked before beginning the next phase.

Validation selections at this cut: **274 distinct phase-5 cases**, **73 transport/discovery/recording
contracts**, **20 migration/rollback and schedule compatibility cases**, **77 legacy task/runtime
and routing cases** (two additive-response fixtures were updated and rechecked), **135 API/schema
and DB-boundary cases**, **8 task-surface/hash cases** and **9 Admin UI cases**. The shared engine
selection also preserves phase-2/4 workflows. These sets overlap; do not add their counts. Pyright
reported zero errors; the local environment retained a pre-existing `requests` source-resolution
warning in Admin metrics. The OpenAPI selection also emits existing duplicate Operation ID warnings.
No complete backend/frontend suite was run for this cut.

## Phase 6 editorial playlists — 2026-10-16

Phase 6 uses Admin's `playlists`, `playlist_tracks`, `playlist_track_exclusions`, smart-rule
engine and blueprints. Migration 116 adds four grants (`editorial.read`, `editorial.prepare`,
`editorial.write`, `editorial.publish`), a playlist revision and generation epoch, plus private
revision-bound Admin refinement proposals. No separate playlist draft table is created. New system
playlists become visible only in the atomic apply transaction. An agent's system playlist remains
managed through the existing curator capability; delegated creation records the human manager and
all agent commands retain integration identity in the shared audit/job ledger.

The MCP catalog adds `editorial_playlists_list`, `editorial_playlist_get`, `editorial_options`,
`editorial_candidates_search`, `editorial_plan_prepare`, `editorial_plan_get`,
`editorial_plan_validate`, `editorial_plan_apply` and `editorial_publication_set`. Preparation is a
worker job in the shared plan/approval engine. The plan stores the full ordered selection and
metadata privately; MCP pages at most 50 selection rows. The review document includes the
description, generation mode, scope, visibility, before/after discovery and refresh policy,
existing/new exclusions and full ordered rows. `editorial_playlist_get(section=history)` combines
bounded generation history with applied editorial audit events. A configured Listen origin yields
`listen_url` on active playlists using `/curation/playlist/{id}`; inactive playlists and instances
without a valid origin return `null`. New static choices require real local
track UIDs. Smart rules use enumerated fields, operators and sorts, a 100-track plan cap, real
`least_played` ordering over the `all_time` listening projection, and the existing diversity,
variant and override logic. Preparation never starts generation or sends a notification.

Creation/duplication goes through `editorial_publication_set`; edits/refinement/regeneration and
the separate future refresh policy go through `editorial_plan_apply`. Every mutation of an
existing system playlist requires `editorial.write` **and** `editorial.publish`; a pure visibility
change requires `editorial.publish`. The calling principal also retains the grant used to prepare
its owned plan. High-risk/public editorial plans require exact human approval. Worker apply checks
the current credential/delegation, plan version, approval, playlist revision/epoch, row and
exclusion snapshot, and each selected library track fingerprint inside the write transaction. It
preserves manual/locked rows and row IDs, carries persistent exclusions across duplicates, and
persists the approved smart selection without drawing it again. A new smart playlist starts with
`auto_refresh_enabled=false`; converting static to smart also clears any latent refresh flag.
Enabling later refresh requires another approved plan. Local tracks with a global catalog mapping
retain local identity through regeneration; if the local row disappears and a remote source remains,
protected rows and editorial plans fall back to the verified global identity. New exclusions retain
both local and global identities and are fingerprinted before apply.

Admin refinement is a heuristic proposal stored server-side with actor, expiry, revision and
exclusion fingerprint. The client submits proposal/action IDs, never mutable positions or deletion
payloads. Empty selection removes zero rows. The UI labels it as editorial refinement and does
not require LLM availability. Admin's `/generate` returns `task_id`, `generation_status` and a
deduplication flag in its declared response model. The generation worker captures a revision/epoch
token at enqueue and again at start, and refuses to overwrite a playlist changed before or during
evaluation. Scheduler and Admin share deduplicated admission. A later automatic refresh
can use the existing operator notification path; the separate refresh-policy plan declares this
future effect. Publication itself sends no notification.

The versioned skill is at `.agents/skills/crate-editorial-playlists/`. MCP does not install it.
Copy that directory into a compatible client's skills directory to enable editorial guidance;
the server contracts and grants work without the skill. The skill directs the client to review
every plan page, explain sparse or conflicting library evidence, request human approval only when
the server requires it, and verify the final playlist. It does not grant access or choose an
unreviewed track on behalf of the server.

Cover artwork is outside the editorial MCP input contract: the current private plan store has no
bounded cover-asset staging surface. Curators can use the existing Admin cover flow; MCP does not
claim that a requested cover is part of the approved plan or gate publication on its upload.

### Phase 5 CI follow-up and phase 6 validation

The exact phase-5 commit `1a81543e29e0f2f633012ddb3f05ebe90795e694` had a failed backend
shard 8/8; the other seven backend shards were cancelled and coverage skipped. Security scan,
quality, React Doctor, OpenSubsonic smoke and the persistent review job completed. The persistent
review was updated to that exact commit and raised only a conditional import-order concern;
Ruff on that file passed. The failed shard exposed a real missing-task cancellation bug plus
outdated phase-5 grant expectations and fake-task fixtures. The missing task now returns false
instead of an acknowledged cancellation; eight focused CI cases passed on Python 3.13 with real
PostgreSQL. Later CI exposed additional acquisition and artwork tests that used synthetic task
IDs without isolating the cancellation lookup. Their fixtures now stub that boundary; the two
selected files passed 93 cases. This does not establish a complete backend-suite pass.
Another shard exposed a revoked agent command whose actor precheck raised before persisting the
private failure result. The actor now records that failure without running the handler; 14 focused
actor cases and the Admin cancellation contract passed with PostgreSQL.
The next backend shard exposed a system-playlist batching fixture that omitted the new
`editorial_revision` and `generation_epoch` fields. Both fixture rows now match the ORM output;
the exact batching case passed. The persistent review at that commit also identified a test
patch of the process-global `time.sleep`; the daemon test now replaces only the daemon's `time`
reference, and all four parameterized cases passed. CI is being rerun for this correction.
The following shard exposed an intermittent disconnect assertion in the existing federated
streaming test: Starlette's threadpool adapter did not deterministically close the underlying
sync generator when its async iterator was closed after a chunk. The remote stream now wraps
that adapter with an async generator that explicitly closes the sync body; the selected
streaming file passed 12 cases. This is outside editorial logic but closes the upstream
context/client promptly on disconnect.
The next backend run found a completeness chunk test with a synthetic task ID and no `tasks`
table in its minimal fixture. Its cancellation lookup is now stubbed at the worker boundary;
the selected completeness file passed 10 cases.
The subsequent shard found a genuine Admin repair claim race. The preparation query locked
the task row while joining the JSON payload in the same statement, so a waiting delivery
could read the payload from an older PostgreSQL snapshot and start the same effect. Claim and
finish now lock the task in a separate statement before reading the payload. The 31-case
repair-preparation file passed with PostgreSQL, and its concurrent-delivery test now starts
both attempts behind a barrier.
The next shard exposed two stale test assertions: the shared lazy handler group now also
catalogs `agent_control`, and instance status contains a `readiness` map alongside the three
availability-bearing evidence sources. Both tests now assert those contracts explicitly.

The phase-6 focused selection passed **37 PostgreSQL-backed cases** across the editorial plan,
MCP, migration, rule, refinement and override files. These cover migration/bootstrap, exact creation,
smart freezing, locks, exclusions, duplicate state, CAS against concurrent edits/generation,
grant/approval enforcement, replay, refinement proposals, Admin generation deduplication and
`least_played` ordering. The official Python MCP SDK exercised a remote-style ASGI session for
create, review pagination, human approval, publication, edit, replay and stale-plan detection.
An additional 12-case boundary selection passed, including the ORM migration-head check.
Selected PlaylistEditor Vitest cases, UI typecheck, Ruff and the skill format validator passed.
An independent skill evaluation used six simulated briefs: static theme, smart rules, locked-row
edit, sparse search, concurrent edit and prepare-only. It found no remaining workflow gap after
the skill was updated to replay the same preparation key when `ops.jobs.read` is absent. Independent
SPEC and QUALITY second reviews found no P1/P2 remaining. These were focused checks, not complete
suites. The local setup used Python 3.13 in a container and Testcontainers PostgreSQL; PostgreSQL
cases were not skipped.

Limits: a single editorial plan supports at most 100 tracks and must fit the shared 40 KiB plan
document budget. Candidate availability is based on indexed local library identity; it does not
prove that the audio file remains present until a playback attempt. No production flags were
enabled and no external client or provider was validated in production. The six skill briefs used
fixtures rather than a connected production agent. Cover upload remains an Admin operation.

## Phase 8 — canonical shows and private extraction (Linux implementation)

Phase 8 extends the existing `shows` table and the shared operation engine. Admin and MCP
prepare/apply `shows_import`; provider syncs use the same identity repository. Migrations
117–119 are additive to the published 109–116 history. No library entity is created for an
external artist and no `/music` write is performed by an API request.

### Identity, authority and exact effects

A show represents one performance/date/venue/session with a primary artist and full lineup.
Provider aliases are unique `(provider,event_id)` pairs. Strong semantic matches keep the ID;
fuzzy/ambiguous matches block publication until an editor selects an existing ID/revision or
changes/excludes the row. Known different sessions stay separate during matching. Artist
UIDs/names are resolved in a batch. Unknown times and coordinates remain null; doors and IANA
timezone are independent fields, with no automatic timezone inferred for Spain.

Field provenance includes actor/source/evidence and extractor/model when supplied by an owned
extraction draft. Manual corrections, including removal of a wrong support act, survive provider
sync. Provider aliases preserve identity on cancellation/rescheduling; expired shows are archived,
and a provider reschedule can make the same ID upcoming again. Shared readers omit private field
evidence, include lineup artists and omit consolidated rows. Unknown coordinates stay visible in
lists and are excluded by distance filters; no distance is invented.

Human Admin plans have an internal user-owned principal/proof that cannot be issued or managed
as a remote credential. Cookie session and origin are checked in the API. Workers check current
user status/capabilities at each stage/effect. Admin works with MCP disabled; remote actions retain
the existing MCP gates and service/delegated authorization. Internal human contexts cannot run
non-show operations. Review/approval uses the existing Agent Plans page and exact hashes.

Selected writes, revision rechecks, private per-item results and common job completion commit
in one transaction. A conflict rolls back the selection; an unexpected write failure reports every
selected item as failed without exposing DB parameters. Same actor/key/payload replays the same
job/result after restart; another payload conflicts. Competing writers recheck identity and add
source evidence. Explicit consolidation is a high-risk plan with mandatory human approval and
exact revisions: it transfers attendance/reminders/aliases, retains archived source rows and
flattens old ID redirects. It never runs as an automatic backfill.

Redirect resolution and attendance/reminder mutations hold a shared transaction advisory lock;
consolidation takes its exclusive counterpart before show row locks. A concurrent relation write
therefore finishes before transfer or resolves the committed canonical ID. Archived legacy
`external_id` values remain intact; aliases resolve provider syncs without attempting to reuse an
occupied unique legacy ID on the canonical row. A selected batch cannot contain two corrections
of the same physical show or two references to the same provider event.

Structured imports can provide paired `source_provider` / `source_event_id` references for
Ticketmaster, Setlist.fm or Last.fm. Matching, sorted transaction locks and alias persistence use
those references in both preview and apply. Setlist.fm/Last.fm bare and provider-prefixed IDs
resolve the existing identity, including legacy bare aliases; inconsistent legacy aliases require
explicit reconciliation. The reference never impersonates a provider: field provenance retains
the actual manual/MCP editor, and the exact plan shows any existing target and revision.

Outbox invalidations cover shows, upcoming, home and affected library artists. The relay dispatches
committed show invalidations to live caches; the projector refreshes snapshots. No HTTP handler
rebuilds a snapshot. A batch emits one set of invalidations. Finite `shows.import.*` counters contain
only candidate/outcome counts, without actors, source text, URLs or arbitrary metric labels.

### Admin and worker extraction

`Add show` in Shows and Upcoming opens the same capability-gated editor. Manual entry has no
LLM dependency. Assisted import accepts uploaded/pasted static images, pasted text or one public
URL. Every candidate is editable in the review table; shared tour corrections affect only selected
rows. Excluded dates remain pending. Changing any selected content invalidates the preview.
Results retain canonical links and saved-row locks; a network-uncertain request retries its exact
key. Owned private drafts can be resumed, including pending/failed jobs and staged image references.
A stop request is distinct from the worker's actual acknowledgement.

The bounded selection of up to three images uploads concurrently, preserving source order and
settling every upload before unlocking a failed attempt. Image rows retain their identity when
another row is removed. Closing a plan review/apply wait preserves its accepted job and exact
payload/key for recovery; it does not cancel the server job.

A confirmed terminal preparation failure unlocks the retained draft with a new preparation key;
an uncertain acceptance retries its original key/job. Changing consolidation IDs, the canonical
choice or the duplicate selection invalidates the previous plan. Shared artist edits clear stale
library UIDs; optional field clears on an explicitly selected existing show are sent as nulls.
Restoring a draft uses a pure state updater, preserving pending corrections and canonical saved
rows under StrictMode. Attendance/reminder operations on a missing show return false without
writing, preserving idempotent removal rather than turning a missing ID into an exception.

Extraction is a closed `extract_shows` command using the existing acceptance ledger, agent jobs,
`tasks`, Dramatiq actor, maintenance pool and resource governor. There is no second job engine.
Full sources/results remain in owned private stores; shared task results and show-domain audits
contain only bounded outcome evidence. Images live as private PostgreSQL blobs outside `/music`,
with opaque actor-owned references and expiry. Old raw extraction evidence is denied immediately
at expiry and pruned by bounded staging/service cleanup; accepted-request identity is retained.

| Limit             | Implemented bound                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Attachments       | 3 static PNG/JPEG/WebP, 8 MiB each, 20 MP each                                                                                          |
| Private staging   | 24 MiB per editor, 24-hour source TTL; identical active bytes reuse their reference                                                     |
| Vision canvas     | One bounded composite, at most 20 MP                                                                                                    |
| OCR               | Tesseract 5, `eng+spa`, PSM 6, one CPU thread; 30 s / 25 CPU s / 512 MiB per child                                                      |
| Extraction task   | Maintenance pool, 180 s, no automatic retry; ten accepted jobs/editor/15 minutes                                                        |
| Model call        | Explicit vision, text, or OCR→text; one call, 90 s vision / 45 s text request timeout, 16K output tokens, no provider fallback          |
| Public URL fetch  | Shared pinned resolver in an isolated worker child, 45 s wall deadline / 256 MiB; DNS/response stalls are killed before acknowledgement |
| Draft             | 200 candidate proposals, 60K text; truncation/coverage reported                                                                         |
| Exact publication | 50 selected shows, complete plan limited to 40K bytes                                                                                   |

Local OCR never reads/calls an LLM or needs a key/network. It preserves recognized text and proposes
only full ISO dates deterministically; artist/venue/city and uncertain dates require correction.
Coverage stays incomplete until a human compares the source; neither an OCR score nor a model's
claim certifies concert correctness or that every tour date was interpreted. Split selections persist
outcomes by item in the private draft without losing unselected dates. Model failure preserves
recognized text for manual correction and does not make another paid call.

The `shows-extraction-v2` model prompt reads a four-digit tour year from the same poster's
heading and applies it to that tour's `DD.MM` rows, retaining the heading and row as evidence.
Missing, illegible or conflicting years stay unknown; an unrelated source, URL slug or current
date supplies no year. A festival range without an explicit performance day remains one
undated candidate with its printed range and a warning. These are extraction instructions;
the existing exact-date schema and human review still govern publication.
Gemini 3 poster extraction explicitly requests per-image `MEDIA_RESOLUTION_ULTRA_HIGH` in
the same model call: its image token budget is roughly twice the default. This closed internal
option preserves the 20 MP canvas, 16K output and single-call limits. Other image consumers,
Gemini 2.5 and non-Gemini providers retain their default detail. See the provider's
[media resolution contract](https://ai.google.dev/gemini-api/docs/generate-content/media-resolution?authuser=01&hl=en).

Configuration, connectivity and model vision support are exposed separately to curators by the
narrow show API. Worker readiness is checked explicitly without a billable model request. A key
alone is not a connectivity/vision probe. Model and endpoint configuration are bound to the
configuration fingerprint reviewed by the user; changes before acceptance/execution stop the
call, preserving the draft. The selected Ollama endpoint is frozen for the actual call. Ollama uses model capabilities; an unavailable registry
leaves other vision support unknown. Manual/OCR paths remain usable independently.

URL evidence uses the existing pinned-public-address resolver/fetcher from artist bio research,
with validated redirects, byte/time bounds and no cookies/private login. Actual fetched text is
used. Login, blocked, unreadable or unsupported content produces a screenshot/text fallback;
a URL string is never represented as an image the model viewed.

### MCP contract 1.1.0

The distributable catalog now contains **52 tools and 30 scopes**. Additive show tools:

- `search_shows`: bounded canonical/lineup lookup, `curation.shows.read` → human `library.view`.
- `preview_shows_import`: structured candidates or an explicit consolidation, `curation.shows.write`.
- `apply_shows_import`: only exact plan ID/version/key, the same write grant and current approval.

Grant `ops.jobs.read` to clients that monitor preparation/application with `get_job`. Use owned
`get_plan` for the complete approved diff and paginated canonical outcomes. Server OCR/LLM is
never invoked by MCP; the remote agent performs extraction itself and submits structured evidence.
The skill continues to provide editorial judgement; server grants, exact selection and approvals
remain authoritative.

Example: a remote client reads a tour flyer, sends N structured candidates (split into selections
of at most 50 and within the plan byte budget), monitors the preparation job, reviews every row via
`get_plan`, then applies its exact version. Replaying the apply key returns the same job and IDs.
An 18:00 and a 21:00 session create distinct shows; a third candidate with unknown time returns
both as a conflict. The client must resolve/exclude it before a new executable plan is prepared.

### Evidence and limitations of this cut

Focused real-PostgreSQL tests cover both provider/manual orders, concurrent writers/integrations,
restart replay, rollback, current ownership/role checks, private evidence, source TTL, cancellation
acknowledgement, split tours, attendance/reminders and exact approval. SDK transport exercises the
new tool workflow; Admin tests cover manual/assisted review, pending rows, canonical links, uncertain
retry, both entry pages and the shared operational approval page. The final suite/review gate is
recorded in the plan when it has actually run.

The 2026-10-17 React review follow-up passed 64 focused Admin tests across seven files and 24
real-PostgreSQL cancellation/authority cases without skips. React Doctor 0.9.18 reported zero
errors and zero warnings across the six affected components/pages; targeted ESLint, Admin
typecheck and Ruff also passed. The `is_cancelled` docstring now states its existing fail-closed
contract: revoked authority and database errors propagate without acknowledging cancellation.

The fresh final SPEC/QUALITY review reported six P2 findings; each was reproduced before its fix
with PostgreSQL/Vitest. The final local backend gate ran all 6405 collected cases (the same two
historical stats-file exclusions as CI): 6390 passed, two failed because the disposable image lacked
`make`, and 13 skipped. After adding `make`, all 49 release-command dry-run cases passed. Eight
pgvector skips were recovered with a migrated disposable base before collection: all 66 bliss-query
cases passed without skips. Thus 6400 distinct backend cases were validated across the gate and
these environment recoveries; the five remaining skips are two legacy missing-route guards and
the opt-in federation harness, live model and stats benchmark. The single local full invocation
did not have a green exit; the exact pushed-head CI is the final standard-runner gate.

Complete Admin tests passed 316 cases; Listen passed 2834 with four existing skips; docs passed
eight plus integrity/build. Full Pyright, Ruff check/format and Admin typecheck/lint/build passed.
The original 115 grant DDL remains frozen; its test now checks the literal phase-five grant set.
CI explicitly installs Tesseract eng/spa. See the plan for commands, review fixes and exclusions.

At the initial 2026-10-16 phase-eight gate, no real-browser/mobile visual audit, live paid model
call, production-copy migration timing, production capacity run, public proxy or new
commercial-client certification was performed.
Local fixtures, deterministic providers and prior phase-seven client evidence do not establish
those properties. The default OCR/manual paths remain independent of a model or network.

The [CPU OCR evaluation](crate-show-ocr-evaluation.json) compares PSM 3/6/11 on five original CC0
synthetic sources, including artistic/illegible text. Tesseract **5.5.0** recovered all three clean tour
dates in about 0.16 s with about 53 MiB RSS; artistic/illegible samples recovered no full-year dates.
These fixtures do not establish accuracy on real private flyers. The worker image installs Debian
`tesseract-ocr`, `tesseract-ocr-eng`, `tesseract-ocr-spa`; no installation occurs in a request and no
Python OCR wrapper, paid OCR service or GPU is needed. See the official [quality guidance](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html),
[CLI reference](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html) and
[Apache 2.0 engine source/license](https://github.com/tesseract-ocr/tesseract).

The [PostgreSQL batch measurement](crate-show-import-load.json) observed 71 fixed reads for both
one and 50 selected dates (excluding advisory coordination), about 0.035/0.083 s, and three global
invalidation events for the batch. This is isolated test evidence, not a production latency claim.

Default tests use simulated providers. A real configured model smoke is opt-in only, against the
synthetic tour fixture and a disposable test DB: `cd app` followed by `CRATE_TEST_SHOW_LLM_SMOKE=1 ../.venv/bin/python -m pytest tests/test_show_extraction.py::test_configured_show_vision_smoke_opt_in -q`. Supply a test provider
configuration/credentials explicitly. This smoke was not run at that initial phase-eight gate,
which also performed no production migration, merge, deployment, real paid model request or
flag activation. The later real-model lab acceptance is recorded separately below.

### Real poster and DICE acceptance — 2026-10-19

An isolated loopback-only Linux lab subsequently exercised the actual HTTP acceptance ledger,
Dramatiq maintenance worker, PostgreSQL, Redis and **Gemini 3.8 Flash**, using the supplied
Viva Belgrado poster and a separate public DICE link. No source answers or manual year/date
corrections were supplied to the model. This focused follow-up does not rerun the full suites
or certify arbitrary posters, production capacity, public TLS or other models.

The original vision request hit its 45 s read timeout. A 90 s diagnostic completed in 63.1 s
but left all dates unknown. The revised shared-year prompt with default image detail completed
in 57.87 s but misread the stylized year as 2021. Changing only per-image detail to ultra high
returned all ten exact 2027 dates in 66.02 s. That diagnostic motivated the explicit Gemini 3
detail option; it was then verified through new persisted jobs with the integrated worker:

| Input and mode                                                                                     | Observed result                                                                                                                                                                            | End-to-end time |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| Viva Belgrado poster, vision                                                                       | Ten exact dates/cities/venues, 2027-01-22 through 2027-05-15; no show/doors times invented. Eleventh candidate retains `03-05.06`, Barcelona, Primavera Sound, with null date and warning. | 71.37 s         |
| Same poster, local OCR → model                                                                     | Eleven proposals; OCR loses the heading year, so dates remain null with an explicit warning. No image is secretly sent in text mode.                                                       | 22.98 s         |
| [DICE short link](https://link.dice.fm/ZcaQVxQ0f7b?sharer_id=6037d4b3814cdd00019b99ca), text model | Separate Coilguns event, 2027-03-14, Wurlitzer Ballroom, Madrid; doors 21:00 from the fetched page. Never attached to Viva Belgrado.                                                       | 8.43 s          |

The ten exact tour rows were compared to a manual transcription of the original attachment,
including Moon, El Tren and Apolo 1. Only rows with known dates were selected for local plan
review; the festival remains pending. Preparation exercises the shared plan engine and MCP
approval requirement without applying or publishing the real shows. Full private drafts and
the user image remain in the ignored lab directory, outside the repository artifacts.

Focused validation passed **94 distinct cases** with Python 3.13 and real PostgreSQL through
Testcontainers, sequentially. One separate opt-in paid-model smoke was skipped; no PostgreSQL
case was skipped. The real jobs above supply the live-provider evidence. HTTP doubles cover
65 s vision success, a 95 s timeout, the unchanged text deadline, one request/no fallback,
private failure handling, exact detail payload, unsupported detail/model rejection and
unchanged provider defaults. They validate the transport contract, not model accuracy or
elapsed wall time. Independent review found no P1/P2/P3; targeted Ruff/Pyright passed.

```sh
cd app
../.venv/bin/python -m pytest tests/test_show_llm_budget.py tests/test_show_extraction.py tests/test_show_extraction_jobs.py tests/test_show_extraction_sources.py tests/test_llm_provider.py tests/test_artist_hero_candidates.py -q
../.venv/bin/python -m pytest tests/test_show_import_plans.py tests/test_mcp_shows.py -q
```

The lab uses explicit local-only opt-ins; production configuration, provider selection and flags
were not changed. This cut performs no merge or deployment. CI and persistent review remain
separate gates on the exact published PR head.

### AI configuration integration follow-up — 2026-10-19

[AI agents configuration](ai-agents.md) now documents Crate's independent action
bindings, immutable profiles, native controls, encrypted credentials and usage.
External MCP clients retain their own model configuration; the new human AI
capabilities do not expand integration grants or bypass show approval.

The latest isolated lab run at `ff000a2333ac635d13494a47d5f838f26bca4574` returned
2021 instead of 2027 for poster vision (77.1 s, eleven candidates; festival date
null). This fails the year acceptance criterion. The earlier ten-date success
above remains the result of that earlier run. OCR→text preserved uncertainty when
the year was absent (eleven null dates, 33.17 s). The separate DICE source returned
Coilguns on 2027-03-14 at Wurlitzer Ballroom, Madrid, doors 21:00 (12.36 s).

A deterministic comparison found identical old/integrated legacy request bodies
for the same image, prompt, `ultra_high`, 90 second vision deadline and 16000 token
output bound. No causal implementation regression was identified. The provider's
incorrect year remains a quality limitation requiring manual review. No heuristic
year correction, paid retry, automatic fallback or real show application followed.

One separate explicit new native profile probe succeeded with Gemini 3.8 Flash,
`low` reasoning, a 45 second timeout and 4096/2048 input/output limits: 3.523 s,
53 input/5 output/58 total tokens, reservation 6144 settled to 58. Thought, cache
and cost remained unknown. The lab still had migration disabled and zero bindings.
This establishes that profile's synthetic API/worker/runtime path, not broad
provider accuracy. Its encryption key was generated for the isolated lab;
production credentials were not copied into the vault.

Functional browser checks at `3eded83eafbdc6d088b70bbabd7fd2d2e6171dda` exercised
four accessible named panels, four validated Gemini models, native 3.8 levels,
read-only inherited connections, eight related-engine rows with honest unknown
readiness, and activity with unknown cost. The user subsequently rejected the
usability and visual consistency of AI Agents, Agent Integrations and Agent Plans.
Their redesign, final browser acceptance, whole-branch review and exact-HEAD CI
remain pending; functional checks do not close those gates.

Focused deterministic HTTP/PostgreSQL integration tests additionally cover all
three assisted show modes with human attribution, native Gemini/DeepSeek/Ollama
routing, replay, stale-batch rollback, actor/key revocation and quota rejection.
Sources and reasoning remain outside public invocation metadata. Full private lab
evidence stays outside repository artifacts; this dated record preserves the
actual outcomes and limitations without publishing private sources.

The historical real show invocations above have null human attribution. A narrow
follow-up now forwards the actor from the validated private principal to the
runtime. Real-PostgreSQL deterministic tests verify all three HTTP-accepted show
modes and the persisted invocation actor; the historical audit rows were not
rewritten and no further paid call was needed. The Task 6 focused gate passed
21 backend/Compose cases without skips, plus eight documentation smoke cases;
document integrity checked 45 canonical documents and the docs build passed.
