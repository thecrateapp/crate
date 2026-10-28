---
title: Operations
summary: Runtime ownership, observability and recovery checks for a running Crate instance.
section: operations
audience: [operator]
status: canonical
order: 120
verified: 2026-10-26
sources:
  [
    docker-compose.yaml,
    docker-compose.home.yaml,
    scripts/deploy-remote.sh,
    app/crate/projector.py,
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
from the read-only Crate Agent.

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

## Crate Agent and Crate Operator

Crate Agent is an optional read-only Telegram assistant over the Crate MCP; Crate Operator
adds changes that a bound human approves with Telegram buttons. Both run from the
`crate-agent` image on the stack host, with their own bot, model login, memory and expiring
MCP credential, and without a shell, the Docker socket or the music mount. They replace the
removed built-in Telegram bot. Set them up with `make agent-init` (add
`AGENT_PROFILE=operator` for Crate Operator) and check them with `make agent-status` and
`make agent-smoke`.

[Crate Agent and Crate Operator over Telegram](crate-agent.md) is the operating guide:
requirements, bot creation, model providers, credentials, approvals, provenance,
supervisor alerts, release context, upgrades and troubleshooting.

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

Use `search_crate_context` and `read_crate_context` to check that Crate Agent can retrieve the
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

For the opt-in Crate Operator, use the [candidate and consolidated rollout
contract](hermes-operator-release.md): root-owned host assets, independent native
recovery, health coverage, exact release context, provenance gates and rollback.
Crate Agent, the read-only profile, remains the default.
