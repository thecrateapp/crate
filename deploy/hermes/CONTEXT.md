# Crate knowledge map

Start with `get_release_context`: it includes the release SHA, each image revision, context availability and the canonical entry documents. A release can reuse images built from earlier commits; keep both versions distinct. When it reports the context as unavailable, the release sources cannot be read; rely only on current Crate MCP evidence and say so.

The index includes the canonical documentation from `docs/manifest.json`, each area's AGENTS files, Compose/Makefile and the sources for the backend, read plane, Rust worker, CLI, Listen, Admin, shared components, desktop, Cast, the Android/iOS native clients, the VirtualDJ plugin, the public site, the docs renderer and the deployment scripts. Files come from Git at the declared SHA. It contains no private instance files, music, databases, `.env`, credentials or any personal assistant's memory.

Entry paths:

- Architecture: `docs/technical/01-system-overview.md`, `02-backend-api-and-data.md`, `03-worker-tasks-and-background-services.md`.
- Library: storage/import/sync, enrichment/acquisition and analysis in chapters `04`, `05` and `06`.
- Users and playback: chapters `07`, `08`, `09`; OpenSubsonic documentation.
- Smart Mix: `docs/technical/smart-mix-operations.md` for behavior, versions and diagnosis; the design and continuation plan for future work and pending gates. The MCP exposes `get_smart_mix_status` with dedicated coverage/campaign observations, age and evidence limits.
- Agents: `docs/technical/11-crate-mcp.md`, `crate-mcp.md`, `crate-mcp-distribution.md` and the JSON contract.
- Operations: `docs/technical/operations.md`, `crate-agent.md` (setup, model, approvals and troubleshooting for Crate Agent and Crate Operator), `ops-runbook.md`, `deployment-profiles.md`, `hermes-operator-release.md`, `crate-operator.md` and `hermes-plan-confirmation.md`.
- Dedicated operator: `deploy/operator/` holds the supervisor, infrastructure bridge/relay, provenance, profiles and contracts; `deploy/hermes/` holds the runtime, adapters, context and native providers.
- Federation: overview, protocol, threat model and runbooks in `docs/technical/federation-*`.
- Backend: `app/crate/`; authorization and contracts in `mcp/`, `agent_*.py`; SQL and transactions in `db/`; effects in `worker_handlers/`.
- Read plane: `app/readplane/`; snapshots, projector and outbox in the backend.
- Clients: `app/listen/src/`, `app/ui/src/`, `app/shared/`, desktop, Cast, the Android/iOS native clients, the VirtualDJ plugin, the public site, the docs renderer and the deployment scripts.

Search by concept or path with `search_crate_context`. Read the fragments you need with `read_crate_context`, following `next_line`. Then check current state and evidence through the Crate MCP: sources explain behavior, but they do not prove that a service is healthy or that a task finished.

For specific questions, use the canonical owners and then the instance evidence:

- Crates: `docs/technical/08-frontends-admin-and-listen.md`, section Listen Crates:
  access, collaboration, public link, ZIP download and SSE/polling tracking.
- Shows and shared plans: `docs/technical/11-crate-mcp.md`, section Exact structured
  show review and publication: structured selection, exact review, atomicity and replay.
- Precalculated statistics: `docs/technical/02-backend-api-and-data.md`, section
  Precalculated listening statistics and snapshot fallback: placeholders, age,
  projector/outbox and fallback; a dashboard GET can enqueue a refresh.
- Workers: `docs/technical/03-worker-tasks-and-background-services.md`, section
  Deferral, cancellation acknowledgement and replay: queues, deferral, cancellation
  acknowledgement and uncertain effects.

The current search is lexical: combine concepts with exact section, symbol or path names;
do not assume semantic translation of a question. If nothing matches, search for the
canonical path and read its pages. The reproducible corpus
`app/tests/fixtures/hermes_context_acceptance.json`, run by
`app/tests/test_hermes_context.py`, validates retrieval and provenance in isolated Git.
It does not certify model answers or real state; a conversation with the model remains
a final rollout check. If an authorized observation is missing, declare it unavailable;
never replace current evidence with a historical source or a call that enqueues work.
