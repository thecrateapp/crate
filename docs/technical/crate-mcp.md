---
title: Crate MCP diagnostics
summary: Connect remote agents to bounded, authenticated library and operations diagnostics.
section: operations
audience: [operator, developer]
status: canonical
order: 170
verified: 2026-10-16
sources:
  [
    app/crate/mcp/server.py,
    app/crate/mcp/auth.py,
    app/crate/mcp/tools.py,
    app/crate/mcp/schemas.py,
    app/crate/agent_credentials_cli.py,
    app/crate/agent_diagnostics.py,
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

# Crate MCP diagnostics

Crate exposes an optional MCP endpoint for remote agents to inspect the local library,
persisted worker status, job history and bounded logs. This delivery covers phases 0 and 1:
connection, dedicated credentials and six read tools. Maintenance actions, OAuth onboarding,
integration management in Admin and editorial playlist creation remain outside this delivery.

## Connection and deployment

The endpoint is `https://api.<your-domain>/mcp`, hosted inside `crate-api`. Use that exact path,
without a trailing slash or a legacy `/sse` suffix. The official Python SDK is pinned to
`mcp==2.3.0`. Transport is stateless Streamable HTTP with JSON responses; clients must support
configuring an `Authorization: Bearer <token>` header. There is no OAuth discovery or consent
flow in this phase, and an OAuth-only agent host cannot connect using this private pilot.

`CRATE_MCP_ENABLED=false` is the default in the development, project and home Compose files.
Enabling it applies to both the API endpoint and the projector's background health snapshot
producer. Existing migrations must be applied before issuing credentials. Keeping the flag
disabled leaves the endpoint unavailable and does not start its health snapshot producer.

| Setting                             | Default                                                        | Purpose                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `CRATE_MCP_ENABLED`                 | `false`                                                        | Enable the endpoint and background health projection.                                                                         |
| `CRATE_MCP_ALLOWED_HOSTS`           | Empty: derive `localhost:*`, `127.0.0.1:*` and `api.${DOMAIN}` | Comma-separated Host allowlist. Set the actual API hostname when it differs from the derived name.                            |
| `CRATE_MCP_ALLOWED_ORIGINS`         | Empty                                                          | Comma-separated exact origins permitted when an Origin header is present. Server-to-server clients normally omit this header. |
| `CRATE_MCP_OPS_FRESH_SECONDS`       | `60`                                                           | Snapshot freshness window.                                                                                                    |
| `CRATE_MCP_OPS_STALE_SECONDS`       | `300`                                                          | Maximum historical snapshot age used in an answer.                                                                            |
| `CRATE_MCP_HEARTBEAT_FRESH_SECONDS` | `60`                                                           | Freshness window for persisted worker and analysis evidence.                                                                  |
| `CRATE_MCP_HEALTH_FRESH_SECONDS`    | `86400`                                                        | Freshness window for persisted library check observations.                                                                    |
| `CRATE_MCP_HEALTH_STALE_SECONDS`    | `604800`                                                       | Maximum historical check age used in a current evaluation.                                                                    |

All three Compose profiles pass these settings into the API. The projector receives the enable
flag. An empty Host setting selects the derived allowlist; it does not allow every host.
Allowlisting an Origin does not provide OAuth or automatically configure browser CORS.

Terminate TLS at the existing API reverse proxy, preserve the Host and Authorization headers,
and route `/mcp` directly to `crate-api`. Do not put a cache or a human-login forward-auth
middleware on this path. Do not inject `Remote-User`, `Remote-Role` or other `Remote-*` headers:
mixed machine and human authentication is rejected. The existing project and home API routes
already point to the API without the Admin forward-auth middleware.

For local development, `http://127.0.0.1:8585/mcp` is suitable for an SDK test client. A successful
local SDK exchange establishes transport compatibility, not certification of a particular
remote agent host, public TLS proxy or production deployment. Record those checks separately.

## Provision an integration

Credentials belong to independent machine principals, not human users or roles. Each credential
has an expiry and can be revoked. Tokens contain 256 random bits with the `crate_mcp_` prefix;
PostgreSQL stores only a SHA-256 digest. Grants are a nonempty subset of:

- `library.health.read`
- `ops.status.read`
- `ops.jobs.read`
- `ops.logs.read`

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

The MCP endpoint accepts only its dedicated Bearer credential. Human JWTs, cookies, query tokens,
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

`read_diagnostics` timestamps must include a timezone. Its default log window is the previous
hour; a requested window may span at most 24 hours and cannot be in the future. These are existing
database logs, not arbitrary files, Docker logs or remote service requests.

Issue risk and repair metadata are explanatory only. `can_execute_for_this_principal` is always
false. No tool runs health checks, retries or cancels jobs, repairs tags, changes schedules,
deletes files or publishes playlists.

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
