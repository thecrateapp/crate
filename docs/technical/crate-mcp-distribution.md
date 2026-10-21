---
title: Crate MCP distribution and acceptance
summary: Versioned contracts, reproducible evaluation and staged rollout evidence.
section: operations
audience: [operator, developer]
status: canonical
order: 171
verified: 2026-10-21
sources:
  - app/crate/mcp/contract.py
  - app/crate/mcp/telemetry.py
  - app/crate/mcp/limits.py
  - app/crate/mcp/tools.py
  - app/tests/test_mcp_distribution.py
  - app/tests/test_mcp_restart.py
  - app/tests/test_mcp_distribution_load.py
  - scripts/evaluate-crate-mcp.py
---

# Crate MCP distribution and acceptance

This guide describes distribution of the current MCP contract and its acceptance/rollout gates.
The dated phase-7 measurements below retain their original scope; manual/assisted shows and the
final feature validation are recorded in the [connection guide](crate-mcp.md). Production rollout
and real target-client/proxy acceptance remain separate gates. No flags were enabled outside
disposable tests. Start with [Agents and MCP](11-crate-mcp.md) for the architecture; the connection
guide covers provisioning, OAuth endpoints and exact Admin review.

## Versioned distribution

The Crate tool contract is **1.2.0** (unreleased additive candidate), independent of the MCP wire protocol and migration version.
The server reports this version; `get_operation_catalog` returns SDK/protocol versions, schema
fingerprints, grants, limits and readiness. The output envelope remains `schema_version="1"`.
The [distributable JSON contract](crate-mcp-v1.json) contains all **71 tools**, all **32 scopes**
and human capability ceilings, closed input schemas and the output schema, without instance
configuration or credentials. Regenerate from `app/` using repository dependencies:

```bash
../.venv/bin/python -m crate.mcp.contract > ../docs/technical/crate-mcp-v1.json
```

Changes within major version 1 are additive: existing accepted inputs/effects retain their
meaning, new inputs are optional and output additions preserve existing semantics. Removing or
renaming fields, narrowing accepted inputs or changing effects/error meanings requires a new
major contract and migration guidance. Input-schema SHA-256 identifies a definition and grants
no authority. There are no scheduled deprecations. Original directed `retry_job` and `cancel_job`
remain compatibility variants with their narrower semantics.

The SDK is pinned to `mcp==2.3.0` and owns protocol negotiation. Acceptance covers modern
`2026-07-28`, the `2025-11-25` initialize handshake and rejection of an unknown protocol header.
Other revisions listed by the SDK have not each been exercised with an independent client.
An SDK upgrade requires regenerated distribution and protocol/OAuth acceptance.

`tools/list` shows registered tools visible to current grants and the action flag, rather than
promising execution readiness. The operation catalog distinguishes `enabled`, `denied`,
`disabled` and `unavailable`. Actions cannot be enabled there without fresh persisted worker
evidence and worker handler registrations. This is not a live probe: exact authority, targets,
approval, provider/filesystem dependencies and runtime admission are rechecked in the worker.
Discovery can be followed by a target-specific conflict.

## Remote connection and skill

Use the exact HTTPS API `/mcp` endpoint, without a trailing slash or `/sse`. Apply migrations
through **129** and configure the canonical issuer, TLS proxy and explicit Host/Origin allowlists
as described in the connection guide. Do not send human cookies or forward-auth headers to MCP.

For human-delegated access, register the client's exact ID and redirect URIs in Admin. Discover
`/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`, consent
with the current Crate login, and use PKCE S256 plus the exact resource audience. The client stores
and rotates refresh tokens securely. Dynamic Client Registration is unavailable. For unattended
access, provision a dedicated expiring service integration with only the required scopes and
store its Bearer credential in the remote host's secret store.

The tested service-token SDK transport can read the catalog as follows:

```python
import asyncio
import os
import httpx2
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

async def main():
    async with (
        httpx2.AsyncClient(headers={
            "Authorization": "Bearer " + os.environ["CRATE_MCP_TOKEN"]
        }) as http,
        streamable_http_client(os.environ["CRATE_MCP_URL"], http_client=http) as streams,
        ClientSession(streams[0], streams[1]) as client,
    ):
        await client.initialize()
        result = await client.call_tool("get_operation_catalog", {})
        assert not result.is_error
        # Inspect structured_content without printing tokens or private results.

asyncio.run(main())
```

The MCP Python SDK and Authlib public OAuth client completed independent local TCP evaluations
with real PostgreSQL/Redis. This does not certify Codex, Claude, another hosted agent or the public
production TLS proxy. Record actual target client/version, redirect/consent, refresh/revoke and
reconnect results before rollout. The editorial skill lives in
`.agents/skills/crate-editorial-playlists/`; copy that directory to a compatible client's skills
directory when desired. The server never installs it. Client guidance grants no permissions;
exact selection, approval and writes remain server-side. Cover upload still uses Admin.

## Long jobs, approval and cancellation

Preparation returns a durable job ID. Poll bounded `get_job` evidence with backoff, then review
every page of the immutable plan, including identities, changes, risk and future refresh policy.
When required, a currently authorized human approves that exact plan/version in Admin. An agent
cannot approve itself; approval cannot add a missing integration grant. Reconnect/restart keeps
accepted identity. Reuse the **same idempotency key** after a lost response; changed content needs
a fresh plan. Acceptance, completion, verification and projection/adoption remain separate facts.

Analysis requeue does not prove DSP completion; runtime persistence does not prove adoption.
Uncertain effects require reconciliation and a fresh plan. Full results remain in authorized
private plan/Admin surfaces; shared task summaries and MCP result pages are bounded.
Cancellation is a request until the worker acknowledges an actual stop. Partial effects remain
visible and are not rolled back. Finalizing work cannot be cancelled. The older `cancel_job`
handles only pending directed work; consult catalog/job evidence for the actual variant.

| Error / outcome                                                  | Client response                                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| HTTP `UNAUTHORIZED`, `AUTH_UNAVAILABLE`                          | Reauthenticate or back off after auth-storage failure; never substitute a human cookie.   |
| `FORBIDDEN`                                                      | Check current scopes, delegation and human capability; retry adds no authority.           |
| `INVALID_ARGUMENT`, `EMPTY_SELECTION`                            | Correct closed-schema arguments and explicit selection.                                   |
| `NOT_FOUND`, `ARTIST_NOT_FOUND`, `RESULT_EXPIRED`                | Resolve current identity or prepare fresh evidence.                                       |
| `APPROVAL_REQUIRED`                                              | Review the exact plan in Admin.                                                           |
| `PLAN_STALE`, `SOURCE_CHANGED`, `EVIDENCE_STALE`, `CURSOR_STALE` | Refresh evidence/pagination and review a newly prepared plan.                             |
| `IDEMPOTENCY_CONFLICT`, `STATE_CONFLICT`, `TARGET_BUSY`          | Inspect the accepted job/plan and current target before another operation.                |
| `RATE_LIMITED`, `LIMIT_EXCEEDED`                                 | Respect `retry_after`, narrow work and reduce concurrency.                                |
| `SERVICE_UNAVAILABLE`, `SOURCE_UNAVAILABLE`                      | Back off; missing evidence is not health or an empty source.                              |
| `RESPONSE_TOO_LARGE`                                             | Narrow filters/page size; applicable plans are never silently truncated.                  |
| `NOT_EXECUTABLE`, `NOT_RETRIABLE`, `CANCELLED`                   | Follow the explicit manual/terminal contract.                                             |
| `ACTION_STATUS_UNKNOWN`                                          | Replay the same key or inspect the job; never repeat an uncertain effect under a new key. |
| Job `EXECUTION_INTERRUPTED`, `RECONCILIATION_REQUIRED`           | Inspect durable partial effects, reconcile and prepare a new plan.                        |

## Reproduce the finite acceptance matrix

Use Python 3.13 and repository dependencies with dedicated local PostgreSQL or Testcontainers
(PostgreSQL 15/pgvector and Redis 7). Docker access is required. The runner rejects any skipped
case, so missing PostgreSQL cannot count as success. No production credentials are used.

```bash
.venv/bin/python scripts/evaluate-crate-mcp.py --group all --list
.venv/bin/python scripts/evaluate-crate-mcp.py --group contract
.venv/bin/python scripts/evaluate-crate-mcp.py --group workflows
.venv/bin/python scripts/evaluate-crate-mcp.py --group load
```

Run PostgreSQL groups sequentially. `all` runs this finite matrix, not complete backend/frontend
suites. Reports/JUnit/logs go to ignored `.artifacts/mcp-phase7/`; `--output-dir` chooses another
report directory. The load measurement file uses the standard artifact directory.

| Group     | Behaviors                                                                                                                                                                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| contract  | Version/readiness, closed metrics, local saturation, real Redis limits, protocol negotiation/rejection, reconnect and a fresh-process recovery after acceptance but before dispatch.                                                                                                                  |
| workflows | Diagnosis and temporary-filesystem repair, high-risk/global human approval, actual metadata tags/locks, simulated provider failure, DSP generations, indexed sync, export/rehydrate, scheduler recovery, runtime CAS/adoption, editorial create/edit, two OAuth clients with refresh/revoke over TCP. |
| load      | Paired foreground API/service-worker work at equal dataset/concurrency, with added MCP traffic in the mixed arm.                                                                                                                                                                                      |

The contract group passed **40 cases**, the workflows group **14 cases**, and the paired load
group **one case**, all without skips. A fresh Python process recovered the
original committed pending task; a newly constructed MCP endpoint replayed the original ID before
and after worker completion. This does not emulate PostgreSQL loss or a broker/Docker crash during
a filesystem effect; uncertain-effect reconciliation remains manual.

### Validation record — 2026-10-16

The existing 48K-track response-budget regression also passed. Documentation integrity (43
canonical documents), six selected portal smoke cases, the docs build, Ruff and targeted Pyright
passed. No complete local backend or frontend suites were run.

Independent SPEC/QUALITY review found one P2: cancelled and partial worker results incremented
the completed counter. Focused RED→GREEN regressions now distinguish those states, preserve
verification failure and classify unknown outcomes as unavailable. The minor artifact-drift
finding was also addressed: the published JSON must match the complete export, including output
schema, scope/capability mapping and SDK metadata. Remaining external gates are described below;
current CI and persistent review belong to the exact commit shown in PR #292.

CI also exposed an older maintenance-discovery assertion that treated an enabled action flag
as worker readiness. The regression was reproduced locally and expanded to cover both worker
availability states with both flag states; the two affected discovery files passed 135 selected
cases. The four-state case is included in the finite contract runner.

## Load evidence and proposed rollout budget

The [paired measurement](crate-mcp-phase7-load.json) uses 900 artists, 4,800 albums, 48,000 tracks
and 96,000 pipeline rows. Both arms have foreground HTTP concurrency 2 (48 reads) and worker
concurrency 1 (12 DB-only artist metadata operations); mixed adds two MCP clients (48 calls).
Connections/caches are warmed, and arm order reverses on the second cycle. No operation failed.

| Component                 | Baseline p95 / p99 | With MCP p95 / p99 |
| ------------------------- | ------------------ | ------------------ |
| Foreground HTTP           | 60.041 / 60.517 ms | 63.943 / 68.015 ms |
| Worker metadata adapter   | 25.905 / 25.905 ms | 27.370 / 27.370 ms |
| Foreground SQL statements | 12.308 / 13.431 ms | 12.442 / 14.672 ms |
| Worker SQL statements     | 1.286 / 2.087 ms   | 1.512 / 2.723 ms   |

MCP p95/p99 was 72.998/78.975 ms, with 2,344-byte results. Common-process CPU was 0.343 seconds
in baseline arms and 0.757 in mixed arms; peak RSS was 256,340 KiB. Foreground SQL stayed at 96
statements per arm; worker SQL stayed at 240. This exercises the common quality-read service via
a test-only HTTP route and the real worker metadata adapter. It does not measure complete
authenticated Admin, login, audio streaming, providers or separate production containers. With
48/12 samples, p99 is effectively a maximum. CPU/RSS includes the harness and clients.

Proposed pre-rollout budget: at agreed target concurrency, no more than 20% p95/p99 foreground or
worker latency increase, no foreground SQL-count increase, diagnostic MCP p95 below 250 ms and
zero saturation-induced failures of normal routes. These are candidate thresholds: an operator
must agree a machine/dataset/client-specific budget and measure login, streaming and Admin under
sustained load before rollout. This local evidence does not establish a production SLO.

Automatic boundaries: 64 KiB request body, 60 KiB structured tool payload, 2 calls per principal /
8 globally, 60 admitted calls per principal per rolling minute, eight local executions with
immediate `RATE_LIMITED` on excess, bounded worker admission and target/plan byte caps. Discovery
is finite (56 schemas in the 1.2 candidate); the structured tool-result byte cap does not describe `tools/list`.
Redis admission fails closed. Disconnect does not authorize repeating an accepted action.

## Metrics and staged withdrawal

Bounded asynchronous recording stores per-tool latency/result bytes and aggregate
`mcp.tool.latency_ms` / `mcp.tool.response_bytes`. Counters distinguish denials, rate limits,
conflicts, replay/dedup and worker verification failure. Worker cancellations and partial
execution have separate `mcp.job.cancelled` / `mcp.job.partial` counters; unknown outcomes never
count as completed. Failed verification takes precedence when effects require reconciliation.
Auth uses `mcp.auth.denied` /
`mcp.auth.unavailable`; worker outcomes use `mcp.job.*`. Names never contain identities, tokens,
URLs, arguments or result values. Existing Redis retention and bounded queue apply. Missing
samples can mean dropped telemetry/storage failure, not zero events. Minute summaries expose
counts/sums/min/max; p95/p99 above comes from the evaluation recorder, not invented percentiles.

`read_diagnostics(source="metric_series")` exposes only enumerated aggregate MCP/worker series
with `ops.status.read` and a 1–100 minute window. Per-tool metrics use the existing privileged
Admin metrics surface. A telemetry failure must not change an accepted operation.

Roll out by capability after the separate operator gate: diagnostics, first directed action,
permissions/Admin/OAuth, then individual maintenance/editorial domains. Record scopes, readiness,
client versions, normal-route baseline, conflicts/denials/verification failures and agreed budget
for each stage. Endpoint/OAuth/action flags remain false by default. Removing a grant blocks new
calls and pending workers reauthorize. For urgent withdrawal revoke credentials/delegations or
disable actions in API and workers through normal deployment; inspect in-flight jobs for applied
effects and real acknowledgment. Disabling MCP does not roll back library state or prove work stopped.

The reviewed [acquisition and schedule contract](crate-mcp-acquisition.md) describes the two-approval Soulseek transfer/publication flow and provider/version boundaries.
