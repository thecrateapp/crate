---
title: Agents and MCP
summary: How remote agents use Crate's shared plans, permissions and workers for diagnostics and curation.
section: architecture
audience: [developer, operator]
status: canonical
order: 100
verified: 2026-10-21
sources:
  - app/crate/mcp/server.py
  - app/crate/mcp/tools.py
  - app/crate/mcp/contract.py
  - app/crate/agent_observability.py
  - app/crate/db/queries/agent_observability.py
  - app/tests/test_agent_observability_db.py
  - app/tests/test_mcp_observability.py
  - app/crate/agent_access.py
  - app/crate/agent_operations.py
  - app/crate/agent_editorial.py
  - app/crate/agent_shows.py
  - app/crate/mcp/show_schemas.py
  - app/crate/db/repositories/agent_operation_jobs.py
  - app/crate/db/repositories/agent_plans.py
  - app/crate/db/repositories/show_identities.py
  - app/crate/db/repositories/show_import_selection.py
  - app/crate/show_extraction.py
  - app/ui/src/pages/agents/AgentPlanDetail.tsx
  - .agents/skills/crate-editorial-playlists/SKILL.md
  - app/tests/test_show_import_plans.py
  - app/tests/test_show_import_api.py
  - app/tests/test_agent_plan_approvals.py
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

Crate's own language model actions use [AI agents configuration](ai-agents.md),
with independent connections, immutable native model profiles and action bindings.
An external MCP client's model and reasoning are configured in that client; Crate
controls the integration's grants and domain effects.

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
**Admin → Agents → Connections**. The server supports authorization code with
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
   plan/version in **Admin → Agents → Approvals**. The agent has no approval tool.
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
default. The current implementation requires migrations through 129. Follow
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
| Human approval and policy/version binding             | `app/crate/db/repositories/agent_plans.py`, `app/ui/src/pages/agents/AgentPlanDetail.tsx`    |
| Domain adapters                                       | `app/crate/agent_health.py`, `agent_editorial.py`, `agent_shows.py` and maintenance adapters |
| Shared show identity and durable provenance           | `app/crate/db/repositories/show_identities.py`, `show_import_selection.py`                   |
| Reproducible acceptance and exported contract         | `scripts/evaluate-crate-mcp.py`, `app/crate/mcp/contract.py`                                 |

For the surrounding runtime read [Workers and tasks](03-worker-tasks-and-background-services.md),
[Auth and sessions](07-auth-users-social-and-sessions.md) and
[Frontend architecture](08-frontends-admin-and-listen.md).

## Exact structured show review and publication

Verified against implementation and tests on 2026-10-21. Admin manual/structured import
and remote `preview_shows_import` / `apply_shows_import` reuse the shared immutable
operation engine. A selection contains 1–50 explicit candidate rows, each with an
`item_id`; the input schema also bounds payload bytes. A tour exceeding a selection must
be tracked as several reviewed batches. The server does not infer unselected dates,
perform OCR through MCP, buy tickets or send show notifications as a side effect.

Preparation records each row's full candidate, before state, expected canonical show ID
and revision, source provenance and per-row issues. Invalid or ambiguous drafts remain
reviewable but `executable=false`; neither an approval nor a successful extraction makes
them executable. Review the complete plan, not its task summary: exact lineup, date,
place, session/time, field corrections, unresolved identities, source versions and public
impact. Unknown time/coordinates remain unknown. An empty search is not proof that a show
does not exist. Private extraction drafts are bound to their owning human editor; corrected
fields cannot replace the original evidence.

`agent_plans.py` binds an approval to plan ID/version, content hash, authorization context,
policy revision and expiry, and reserves it for one admitted job. Approval is required
when current policy demands it; consolidation always requires human approval. Admin's
human cookie/origin/capability checks and MCP's integration/delegation checks feed the same
plan engine. The agent cannot approve its own plan or expand authority through a document.

At apply, one transaction locks authority, task and canonical identities, validates the
exact stored execution and expected revisions, applies the selected rows, invalidates
views and stores the durable result. Conflicting revisions or write failures roll back
the selected batch; per-item `BATCH_NOT_APPLIED` is not partial publication. A concurrently
created identical show can resolve to the same identity; different fields require review.
Shows and durable completion commit together, so replay after outer-worker interruption
recovers the result without another write. Success can report `verification=passed` with
`projection=pending`: database publication does not establish that every consumer already
shows the new event. A changed proposal needs a fresh preview; a lost response uses the
same key/payload or durable job inspection.

Regression evidence: `app/tests/test_show_import_plans.py` covers changed-show atomicity,
concurrent identity, durable completion replay, fifty-date batching and mandatory
consolidation approval; `app/tests/test_show_import_api.py` covers human capability/origin
and fresh correction preview; `app/tests/test_agent_plan_approvals.py` covers exact approval
binding. Current instance show/job state requires authorized MCP evidence. If the pilot's
read grants lack that surface, report it unavailable instead of invoking an import or
assuming publication from these source contracts.

## Bounded observation coverage (contract 1.2 candidate)

Contract 1.2.0 adds four read tools with the existing envelope schema `1`.
`get_instance_inventory`, `get_observability_summary` and `get_pipeline_status` require
`ops.status.read`; `get_smart_mix_status` requires `library.health.read`. Actions remain
explicit opt-in. Listing or discovering a tool grants no authority.

Every source envelope declares `source`, `observed_at`, `availability`, `reason`,
`freshness` (age, fresh threshold and expiry), `version` and `coverage`. Source envelopes
are under `data.sources`; summary pipelines are under `data.subsystems[NAME].sources`.
`queried_at` is read time, not the time a producer last measured its subsystem. Task rows
retain their own creation/update/heartbeat timestamps. No tool invokes an HTTP handler,
rebuilds a snapshot, refreshes coverage, probes Docker/Redis or enqueues domain work.
The usual bounded MCP admission and diagnostic audit still apply.

| Surface / subsystem                              | Persisted source and implementation                                                                                                                                      | Coverage                                              | Explicitly missing evidence                                                                                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instance inventory                               | `agent_observability.read_observation_evidence`: `alembic_version`; fixed service allowlist from stored `ui_snapshots` `ops:stack/global`; current MCP contract constant | Partial                                               | Release/context manifests are not mounted in the API; image IDs and source commits are unknown. A stored image reference or container state is not current functional health. Use the separate `get_release_context` for release versus reused image source provenance. |
| Worker and import                                | Stored `ops_runtime_state.worker_live` counters and `imports_pending.count`, produced by worker/import queue updates                                                     | Partial                                               | Live worker/dependency probes, complete pipeline progress and fresh storage validation                                                                                                                                                                                  |
| Analysis / Bliss                                 | Worker-produced `ops_runtime_state.analysis_status` counters; the two pipelines remain distinct                                                                          | Partial                                               | Live daemon probes, exact complete backlog from counters, Smart Mix profile coverage                                                                                                                                                                                    |
| Enrichment / playback / federation / acquisition | At most 20 matching newest task rows created in the last 24 hours (21st row is a truncation sentinel); task categories come from `task_registry`                         | Partial                                               | Complete backlog, older long-running tasks, provider connectivity, end-to-end playback/federation success                                                                                                                                                               |
| Projector                                        | Stored `ops/dashboard.eventing.outbox` allowlisted counters with snapshot build time/version/source sequence                                                             | Partial                                               | Live relay/Redis probes, complete consumer lag, per-event delivery; producer `unavailable` survives and is never a healthy zero                                                                                                                                         |
| Smart Mix coverage / campaign                    | Stored `smart_mix:coverage` and `smart_mix:backfill_campaign` with independent DB timestamps and stored versions                                                         | Implemented stored read, partial operational coverage | No coverage recompute, campaign control or proof of DSP completion from enqueue. Missing coverage is null, not an empty zero-count default.                                                                                                                             |
| Smart Mix exact profiles                         | One UUID-batched lookup of `track_mix_profiles` and `track_processing_state` for at most 50 unique exact track UUIDs                                                     | Implemented bounded read, partial library coverage    | No library scan, new acoustic validation, candidate ranking, transition plan or physical/platform acceptance                                                                                                                                                            |
| Provider / storage / streaming / Redis health    | No functional probe is called by these tools                                                                                                                             | Unavailable                                           | Current functional health; HTTP 200 or a running process cannot establish it                                                                                                                                                                                            |
| Operational event cursor                         | No global UI-event journal is synthesized                                                                                                                                | Unavailable in these tools                            | A supervisor supplies its own durable operational event cursor                                                                                                                                                                                                          |

`get_pipeline_status.pipeline` is the closed enum `import`, `enrichment`, `analysis`,
`bliss`, `playback`, `projector`, `federation`, `acquisition`. The returned exact task type
list defines the sample; it is not a claim to cover every domain effect or daemon.
Empty samples do not mean zero backlog. `complete` is false. Projector is an event
consumer rather than a task category, so its task type sample is empty.

Runtime and pipeline evidence is fresh for 180 seconds, stack evidence for 30 seconds;
older evidence is stale until 86,400 seconds, then unavailable. Invalidated snapshots
remain stale. Missing/future timestamps are unavailable. Current profile versions and
freshness are independent: `profile_status=current` means stored analyzer/schema versions
match this API, while its source envelope can still be stale or expired. Stored outdated
coverage and campaign targets remain visible with an explicit stale version reason.
These constants define evidence freshness, not subsystem health or a universal alert SLA.

SQL uses a five-second statement timeout and one rollback-only read scope, fixed persisted
keys, and `ANY` for exact track UUIDs. Selected JSON records over 32,768 bytes are reported
unavailable; unrelated worker task payloads are excluded before applying that bound.
Only allowlisted fields leave the service; nested evidence is capped at depth five,
20 entries and 512 characters per string with credential/location redaction. Sanitized
source data over 12,000 bytes is explicitly unavailable. Smart Mix limits the whole response
to a 55,000-byte budget before the transport cap: `truncated`, `returned_count` and
`data.omitted_track_uids` identify exact track results to request again in smaller batches. Inventory
keeps validated image references separate, considers at most 32 stored containers and
reports truncation. The inventory's `redis-durable` key maps explicitly to the actual
Docker container name `crate-redis-durable`, recorded as `container_name` in its envelope.
Unknown/missing service images remain explicit; no Docker socket,
shell, arbitrary SQL, filesystem or new HTTP observer is exposed.

See [Smart Mix operation](smart-mix-operations.md) for profile/campaign interpretation.
Unit, PostgreSQL read-only and actual SDK authorization/no-refresh tests are in
`test_agent_observability.py`, `test_agent_observability_db.py`, and
`test_mcp_observability.py`. Local tests do not establish real-host rollout acceptance.

The assembled summary also has a 55,000-byte UTF-8 budget. If needed, it omits the largest
source data blocks while retaining source names, timestamps, freshness and versions. Those
source envelopes become explicitly unavailable and truncated; top-level `truncated` and
`data.omitted_source_data` list their paths. Unaffected sources remain readable. Worker,
analysis and import counters must be nonnegative integers within signed 64-bit bounds;
worker engine must be a string of at most 128 characters. Invalid fields are omitted and
reported in `invalid_fields`, never turned into healthy zero counters.

## Native Telegram human confirmation

The opt-in managed operator can request exact native bot review using
`request_plan_confirmation`; its model cannot submit a human decision. The
existing plan engine admits an explicitly approved operation with its stable key
on the human button, without another Admin review or model invocation. Current
approval policy and worker authority remain server-enforced, including denial of
legacy direct-command bypasses. See [Native Telegram plan confirmation](hermes-plan-confirmation.md)
for binding, page review, replay/expiry, operator profile and reconciliation.

The [integrated Hermes operator candidate](hermes-operator-release.md) binds
server-configured operator principals to fresh release/context/per-image evidence
at direct MCP, native approval, admission and worker effect boundaries. It packages
independent recovery/monitoring, native incident decisions and automatic job watches;
production activation remains separately reviewed.
