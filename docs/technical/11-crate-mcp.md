---
title: Agents and MCP
summary: How remote agents use Crate's shared plans, permissions and workers for diagnostics and curation.
section: architecture
audience: [developer, operator]
status: canonical
order: 100
verified: 2026-10-18
sources:
  - app/crate/mcp/server.py
  - app/crate/mcp/tools.py
  - app/crate/mcp/contract.py
  - app/crate/agent_access.py
  - app/crate/agent_operations.py
  - app/crate/agent_editorial.py
  - app/crate/agent_shows.py
  - app/crate/db/repositories/agent_operation_jobs.py
  - app/crate/db/repositories/agent_plans.py
  - app/crate/db/repositories/show_identities.py
  - app/crate/show_extraction.py
  - app/ui/src/pages/AgentPlanReview.tsx
  - .agents/skills/crate-editorial-playlists/SKILL.md
---

# Agents and MCP

Crate exposes a finite Model Context Protocol (MCP) interface for remote agents
to inspect instance health, prepare library maintenance and curate system
playlists or shows. Each action uses the same persisted plans, authorization,
jobs and domain repositories as Admin. The agent chooses among catalogued
operations; Crate controls their permissions, targets and effects.

This chapter explains the architecture and normal workflows. Use
[connection and operations](crate-mcp.md) for configuration, OAuth, scopes and
the detailed domain contracts. Use [contract and acceptance](crate-mcp-distribution.md)
for the exported tool schemas, client example, evaluation and rollout gates.
Those pages also retain the implementation's dated validation records.

## Where MCP runs

The Streamable HTTP endpoint is `/mcp` inside `crate-api`. There is no separate
MCP container. The API authenticates the integration, validates closed tool
inputs and serves bounded evidence or admits a durable job. Library writes
remain in workers; the API's `/music` mount stays read-only.

```text
Remote agent
  | HTTPS /mcp + OAuth access token or dedicated service credential
crate-api: authentication -> tool catalog -> permission/target checks
  | reads                       | durable preparation/application
Persisted evidence              Shared plan + approval + job engine
  ^                               | after-commit dispatch
  |                             Crate workers -> domain repositories / files
  |                               | committed domain events
Projector + snapshots <-----------+
  |
Admin / Listen reads and invalidation
```

Diagnostics use persisted snapshots and observations. Missing or stale evidence
is reported with source age and availability; a read does not start a scan or
rebuild a snapshot. An explicit check runs in a worker. SQL and transaction
ownership stay under `app/crate/db/`, including checks that keep a planned
artist identity stable while observations are persisted.

## Identity and authority

| Identity                   | Used for                                           | Authority                                                                                                      |
| -------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Service integration        | Unattended agent access                            | Dedicated expiring Bearer credential, integration grants and target restrictions.                              |
| Delegated OAuth connection | An agent acting for a Crate user                   | Accepted scopes intersect the enabled client/integration, current authorization and current user capabilities. |
| Crate cookie session       | Human consent, management and plan review in Admin | Current human capabilities, session and Origin checks; it does not authenticate MCP calls.                     |

Register OAuth clients with exact redirect URIs and a scope ceiling in
**Admin → Agent integrations**. The server supports authorization code with
PKCE S256 and rotating refresh tokens. Dynamic Client Registration is not
enabled. Service credentials are separate from Listen passwords and appear
only when created or rotated. See the operational guide for provisioning and
the exact discovery endpoints.

Discovery grants no authority. Every call and each worker effect rechecks the
current policy. Revoking a credential, delegated authorization or required
capability stops new effects from pending work. Previously applied effects
remain recorded; revocation does not roll them back. Accepted jobs survive
ordinary delegated access-token expiry while their authorization stays valid.

## From intention to verified result

1. Call `get_operation_catalog` and inspect the current grants, operation
   readiness, limits and target-specific requirements. A registered tool can
   still be disabled, denied or unavailable.
2. Resolve real local identities and inspect current evidence. Narrow the
   selection explicitly; an empty selection never means the entire library.
3. Prepare the operation with its `preview_*`, `plan_*` or editorial preparation
   tool. Preparation can itself return a job. Poll `get_job` with backoff, using
   `ops.jobs.read`, until its private plan is available.
4. Read the complete plan through `get_plan` or `editorial_plan_get`, following
   every cursor. Check identities, ordered selection, effects, source versions,
   risks, exclusions and expiry. A task summary is not the plan.
5. If human approval is required, an authorized reviewer approves that exact
   plan/version in **Admin → Agent plans**. The agent has no approval tool.
   Approval cannot supply a missing grant.
6. Apply the exact plan ID and version with a stable idempotency key. After a
   lost response, replay the same key and payload to recover the accepted job.
   A changed proposal requires a new plan/key, not an uncertain second write.
7. Inspect execution, verification and effective publication/adoption
   separately. A completed enqueue does not prove DSP completion; a persisted
   runtime policy does not prove that its consumers adopted it.

Source revisions, plan content and authority are rechecked before effects.
If they changed, retain the proposal, refresh evidence and prepare a new plan.
Full private results remain available only to their authorized owner/reviewer;
MCP responses and shared task summaries are bounded.

## Operation families

The [versioned JSON contract](crate-mcp-v1.json) is the complete list of tool
names, input schemas and base grants. The live catalog adds effective variant
and target restrictions. Representative entry points are:

| Family                           | Entry points                                                                                                                          | Result                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Diagnostics                      | `get_instance_status`, `list_library_issues`, `inspect_artist`, `read_diagnostics`                                                    | Persisted, bounded evidence; no implicit scan.                                                                  |
| Checks and repairs               | `run_health_check`, `run_quality_check`, `preview_repairs`, `apply_repairs`                                                           | Worker observations or an exact supported repair selection.                                                     |
| Metadata and library maintenance | `preview_metadata_update`, `plan_enrichment`, `plan_analysis`, `plan_library_sync`, `plan_metadata_export`, `plan_metadata_rehydrate` | Plans preserving current locks, fingerprints and portability policy, followed by their matching apply/run tool. |
| Instance operations              | `preview_job_retry`, `preview_job_cancel`, `list_schedules`, `get_runtime_policy`                                                     | Catalogued job controls and revisioned schedule/runtime changes.                                                |
| Editorial playlists              | `editorial_options`, `editorial_candidates_search`, `editorial_plan_prepare`                                                          | Private system-playlist proposals with an exact selection or supported smart rules.                             |
| Shows                            | `search_shows`, `preview_shows_import`, `apply_shows_import`                                                                          | Canonical show lookup and reviewed structured publication/consolidation.                                        |

There is no generic task dispatch, arbitrary SQL, shell execution or free-form
settings tool. Repair support is declared per check/variant. A manual variant
cannot silently become an automatic repair or partially execute an otherwise
unsupported selection.

## Editorial playlists

The editorial tools use Admin's existing system playlists, blueprints, rules,
manual entries and persistent exclusions. Choose `static` for an exact
sequence or `smart` for a regenerable rule-based selection. Preparation does
not publish a playlist.

Review every proposed track in order, its local/global identity and manual
lock, metadata, rules, exclusions and future refresh policy. Admin displays
this full content and disables approval when it is incomplete or inconsistent.
Revision/generation changes conflict rather than discarding another editor's
work. Visibility is an explicit reviewed change; preparation does not create
an anonymous public link.

The optional `crate-editorial-playlists` skill supplies musical judgment and
coordination. It can help turn a brief into candidates and an ordered proposal;
permissions, exact selection, approval and writes remain server guarantees.
Install the versioned skill bundle in the client as described in the
distribution guide. Connecting to MCP does not install it automatically.

## Shows and tours

Admin's **Add show** flow supports manual entry, pasted text, public URLs and
private image uploads. Local Tesseract OCR needs no model or provider key.
Vision, text-model and OCR-to-text-model modes are explicit choices using the
configured provider. An unreadable URL requires text or a screenshot; its URL
alone is never evidence that a model viewed an image.

OCR preserves per-image/text-block provenance. A model that sees several
sources uses a server-owned composite manifest. Correcting a draft cannot
replace its original source evidence; compact references/hashes remain with
the published show after private source expiry. Recognized text and drafts
remain incomplete proposals until an editor checks the source and all tour
dates. Local parsing proposes full ISO dates; uncertain dates and other fields
need correction. A failed model call does not trigger a second paid call.

MCP accepts structured candidates from the remote agent; it does not invoke
server OCR/LLM. For a tour, prepare explicit selections within the returned
row/byte limits, review each date/session and apply exact versions. Track
unselected dates rather than treating a bounded page as the complete tour.

All writers share canonical identity and dedupe with provider syncs. Matching
includes the full lineup even when sources choose different headliners.
Ambiguous overlap requires review; different dates, places and known sessions
remain separate. Provider aliases retain identity across rescheduling, and
manual corrections survive later sync. Consolidation is a separate exact,
high-risk plan with mandatory human approval.

## Recovery and operational boundaries

| Situation                            | Response                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Missing grant or revoked connection  | Inspect current integration/delegation policy; retries cannot add authority.                                    |
| Stale source, plan or cursor         | Read fresh evidence and prepare/review a new exact plan.                                                        |
| Lost acceptance/application response | Replay the original key/payload or inspect the durable job.                                                     |
| Rate/resource limit                  | Respect retry evidence, reduce concurrency and narrow the selection.                                            |
| Cancellation requested               | Wait for the worker's actual acknowledgement; inspect partial effects. Finalizing work can reject cancellation. |
| Uncertain or interrupted effects     | Reconcile the private result before another plan. Do not assume rollback.                                       |

For remote connections use the exact HTTPS API `/mcp` path, without a trailing
slash or `/sse`. MCP, actions and OAuth have separate flags, all disabled by
default. The current implementation requires migrations through 119. Follow
the connection guide for issuer, TLS proxy, Host/Origin allowlists and worker
configuration; this chapter does not activate them.

Local SDK/Authlib and deterministic provider evaluations are recorded in the
acceptance guide. They do not certify a particular hosted agent, real-model
quality or the production TLS proxy. Those client/environment checks and the
rollout budget remain explicit release gates.

## Implementation map

| Responsibility                                        | Source                                                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Transport, authentication and finite tool schemas     | `app/crate/mcp/`                                                                             |
| Scope/capability intersection                         | `app/crate/agent_access.py`                                                                  |
| Common plan/job admission, execution and verification | `app/crate/agent_operations.py`, `app/crate/db/repositories/agent_operation_jobs.py`         |
| Human approval and policy/version binding             | `app/crate/db/repositories/agent_plans.py`, `app/ui/src/pages/AgentPlanReview.tsx`           |
| Domain adapters                                       | `app/crate/agent_health.py`, `agent_editorial.py`, `agent_shows.py` and maintenance adapters |
| Shared show identity and durable provenance           | `app/crate/db/repositories/show_identities.py`, `show_import_selection.py`                   |
| Reproducible acceptance and exported contract         | `scripts/evaluate-crate-mcp.py`, `app/crate/mcp/contract.py`                                 |

For the surrounding runtime read [Workers and tasks](03-worker-tasks-and-background-services.md),
[Auth and sessions](07-auth-users-social-and-sessions.md) and
[Frontend architecture](08-frontends-admin-and-listen.md).
