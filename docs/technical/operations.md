---
title: Operations
summary: Runtime ownership, observability and recovery checks for a running Crate instance.
section: operations
audience: [operator]
status: canonical
order: 120
verified: 2026-10-21
sources:
  [
    docker-compose.yaml,
    docker-compose.home.yaml,
    scripts/deploy-remote.sh,
    app/crate/projector.py,
    deploy/hermes/config.json,
    deploy/hermes/runtime.py,
    deploy/hermes/context_server.py,
    deploy/hermes/activate_context.py,
    scripts/hermes_context.py,
    app/crate/api/smart_mix_admin.py,
    app/tests/test_hermes_context.py,
    app/tests/fixtures/hermes_context_acceptance.json,
  ]
---

# Operations

The optional [independent deterministic operator](./crate-operator.md) documents
standalone incident persistence, job watches, delivery retries and the external
watchdog. Its opt-in deployment and native callback integration remain separate
from the read-only pilot.

## Runtime responsibilities

| Component     | Operational responsibility                                                |
| ------------- | ------------------------------------------------------------------------- |
| API           | authenticated control/write requests; music mount is read-only            |
| Readplane     | snapshot-backed selected reads, SSE relay and stream proxy paths          |
| Workers       | task processing and every music filesystem mutation                       |
| Projector     | Redis Stream domain events to snapshot/read models                        |
| PostgreSQL    | authoritative persistent data                                             |
| Cache Redis   | cache and short-lived data under volatile eviction                        |
| Durable Redis | Dramatiq/broker, streams, leases and other state that must not be evicted |

Redis is not merely disposable cache. A durable Redis outage can stop task
processing, projection and coordination even when PostgreSQL remains healthy.
Never run an eviction/flush operation as a routine cache clear against the
durable instance.

## Health checks

Use compose status and targeted logs first:

```bash
docker compose ps
docker compose logs --tail=100 crate-api crate-readplane crate-projector
docker compose logs --tail=100 crate-worker crate-maintenance-worker \
  crate-analysis-worker crate-playback-worker
```

Then verify:

1. API health/authenticated read requests.
2. Readplane readiness and its fallback behavior for the affected route.
3. Projector event lag and snapshot freshness.
4. Worker queues, failed tasks, leases and available disk.
5. Admin SSE/task views after cache or service recovery.

The exact service names differ by deployment profile; use `docker compose
config --services` rather than copying project-hosted names into a home stack.

## Incident boundaries

- **API healthy, readplane unhealthy:** identify whether the route has FastAPI
  fallback before changing proxy rules. Do not claim all interactive/SSE paths
  are interchangeable.
- **Workers stalled:** inspect durable Redis, task leases and resource governor
  decisions before scaling consumers.
- **Projection stale:** inspect the Redis Stream, projector logs and snapshot
  timestamps; rebuilding a snapshot is safer than serving a guessed state.
- **Storage pressure:** pause acquisition/import work before deleting media or
  staging data. Worker-owned staging cleanup must preserve active leases.
- **Federation fault:** revoke/suspend the peer path first, then collect the
  peer, grant, stream and import evidence described in the federation runbook.

## Backups and restore drills

Backups are profile-specific. The project-hosted base compose has a PostgreSQL
backup sidecar; the home profile does not. In either case, maintain an
independent, tested recovery path for PostgreSQL, deployment configuration and
any irreplaceable media metadata.

Before restoring PostgreSQL, quiesce every writer: API, all Dramatiq worker
families, projector and media worker. Restore only after recording the current
state, then restart in controlled order and verify migrations, cache/eventing,
projector catch-up, queues, SSE and federation state. The detailed procedure is
in [Backup and recovery](ops-runbook.md).

## Hermes operator (phase one)

The optional `hermes` profile adds `crate-hermes-agent` to the Crate Compose project.
It uses the upstream Hermes v0.22.2 image pinned by digest, its own ChatGPT subscription
session (`openai-codex`, `gpt-6-luna`) and a dedicated Telegram bot. This phase provides
on-demand diagnosis and read access; autonomous alert schedules and mutations are not enabled.
The agent has no Docker socket, SSH keys, music mount or access to another Hermes home.

All instance state lives under `${DATA_DIR}/hermes-agent/`:

| Path                                        | Purpose                                                       |
| ------------------------------------------- | ------------------------------------------------------------- |
| `home/`                                     | Independent OAuth session, conversations and memory           |
| `secrets/telegram-token`                    | New BotFather token, mode 600                                 |
| `secrets/mcp-token`                         | Dedicated expiring Crate service credential, mode 600         |
| `secrets/allowed-users`                     | Explicit private Telegram user IDs, comma-separated, mode 600 |
| `secrets/managed.env`                       | Generated private environment for supervised gateway children |
| `runtime/<revision>/` and `runtime/current` | Immutable operator assets and selected revision               |
| `context/releases/` and `context/active`    | Immutable context bundles and atomic active link              |
| `context/deployment.json`                   | Release and deployment-state marker used to detect drift      |

Provision a separate service integration using the [MCP connection guide](crate-mcp.md),
with only `library.health.read`, `ops.status.read`, `ops.jobs.read`, `ops.logs.read`,
`ops.audit.read`, `ops.schedules.read` and `ops.runtime.read`. These grants expose twelve
read tools. The runtime rejects discovery containing any tool without a read-only annotation.
Terminal, file, code execution, connection management, delegation, cron and messaging tools
are excluded. Telegram permits only the configured private users/chats, with bot senders denied.

Before first start, install the files from `deploy/hermes/` into a new immutable runtime
directory and atomically select it with `runtime/current`. Create the dedicated secret files
without logging their values. Generate the supervisor environment on the host:

```bash
umask 077
python3 - "$DATA_DIR/hermes-agent" <<'PYTHON'
import sys
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root / "runtime/current"))
from runtime import managed_environment
(root / "secrets/managed.env").write_text(managed_environment(root / "secrets"))
PYTHON
```

Keep the private directory mode 700 and its files readable by the configured `PUID`/`PGID`.
Authorize ChatGPT inside this agent's own `home/`; do not share or copy rotating OAuth refresh
tokens from a personal assistant. Build the first context from the deployed release's full
Git SHA and immutable release manifest using `scripts/hermes_context.py`, then validate and
activate its archive with `deploy/hermes/activate_context.py`. Start only the new service:

```bash
docker compose -f docker-compose.yaml -f docker-compose.project.yaml \
  --profile hermes up -d --no-deps crate-hermes-agent
```

For bootstrapping against a release whose Compose predates this service, an operator can
install its declaration in `.deploy/hermes.compose.yaml`; the deployment helper includes
that overlay when present. Keep it consistent with the selected runtime's mounts and policy.
Updating operator assets requires a new immutable runtime directory, switching `current` and
recreating only `crate-hermes-agent`. Deploying Crate does not overwrite its live runtime.

`SOUL.md` defines the Spanish operator identity, evidence rules and read-only boundaries;
`CONTEXT.md` supplies the knowledge map. The context MCP exposes `get_release_context`,
`search_crate_context` and `read_crate_context`. The indexed corpus includes canonical docs,
scoped architecture instructions, backend, database and workers, Go/Rust services, frontend
clients, desktop, Cast, public site, documentation renderer and deployment scripts. Reads
are paginated, bounded and checked against their recorded hashes. Secrets, instance data,
untracked files and music are excluded; source text never grants execution authority.

Normal image-first deployment exports context from the exact release commit and activates it
only after verification. It records deployment/rollback transitions so Hermes reports stale
context during a transition or after version drift. Release SHA and reused image `source_sha`
remain distinct. When deploying from an older checkout without these hooks, synchronize context
explicitly or use an updated deployment checkout; the old checkout cannot maintain the marker.

Validate the actual Luna tool calls, Telegram polling and private-user policy after setup.
A running gateway alone does not prove MCP access or model authentication. Also confirm that
any personal Hermes container retains its original ID, start time and restart count.

### Maintaining the technical context

A context bundle can contain source code while its overview or runbook remains behind the
implementation. Review documentation coverage when a feature, contract or operating procedure
changes. Compare the target release's sources and tests with each canonical page's `sources`
and `verified` metadata, then update the owning page and its links in the same change. Keep
coverage gaps and completion status in the development PR; this guide owns the maintenance
procedure. Inclusion in the corpus does not by itself prove documentation completeness.

Smart Mix has an [operational reference](smart-mix-operations.md), a
[unified design](smart-mix-design.md) and a [continuation plan](smart-mix-implementation-plan.md).
Use the operational reference for current behavior and diagnosis; review all three against
the target implementation when the feature changes.
The review must cover profile/analyzer/planner versions and provenance, cue-beat eligibility
and fallbacks, source invalidation and cache generations, backfill lifecycle, consumer/platform
support and physical acceptance gates. Keep implemented behavior, deployment flags and future
work explicit. For every diagnosis, identify the read evidence available through today's MCP
and record any missing observation. An HTTP GET is not sufficient evidence of a pure read:
`app/crate/api/smart_mix_admin.py` can enqueue coverage refresh from its status route.

After updating a page, validate `docs/manifest.json`, its source links and the release bundle:

```bash
npm run check:docs --prefix app/docs
```

Use `search_crate_context` and `read_crate_context` to check that Hermes can retrieve the
explanation. Acceptance questions should cover the feature's data flow, job/status semantics,
version invalidation, fallback behavior and a case where current evidence is unavailable.
Answers must identify source paths and the context release SHA, and use current MCP evidence
for live claims. Refreshing documentation does not grant access to additional endpoints or tools.

Publish the revised documentation with its release, then activate that release's context after
deployment verification. Do not patch an older immutable bundle with newer branch or `main`
content; source SHA, image provenance and documentation must remain traceable together.

### Isolated retrieval acceptance

Verified on 2026-10-21. The committed Spanish question corpus at
`app/tests/fixtures/hermes_context_acceptance.json` names the required canonical owner,
lexical follow-up queries, evidence fragments and the unavailable-evidence expectation for
Crates, shared shows/plans, stats/projector/fallback, workers and Smart Mix. Run it with the
context suite from `app/`:

```bash
../.venv/bin/python -m pytest tests/test_hermes_context.py -q
```

The fixture commits the current canonical pages to a disposable Git repository, exports
that exact revision with `scripts/hermes_context.py` and calls the actual
`ContextStore.summary/search/read` interface. It checks bounded paginated retrieval,
page hashes, release versus reused image provenance, dirty-checkout exclusion, missing
unindexed observations and deployment drift. Existing context tests cover activation,
rollback markers, integrity failures, path boundaries and the SDK transport. No production,
Telegram or model service is involved. Existing manifest entries and explicit Markdown
loaders continue to publish the owning pages; no proposal becomes canonical by inclusion
in a context fixture.

This is retrieval acceptance, not an LLM answer evaluation. `ContextStore.search` matches
literal terms on one line or a path; a Spanish question can require a follow-up query with
an exact source symbol/heading. The final rollout check must ask these questions through
the real operator model, confirm its source paths and release SHA, and verify that it
states unavailable/stale evidence instead of claiming live health or effects. That check
requires the real conversational transport and remains deferred from local acceptance.
