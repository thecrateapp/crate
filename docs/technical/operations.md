---
title: Operations
summary: Runtime ownership, observability and recovery checks for a running Crate instance.
section: operations
audience: [operator]
status: canonical
order: 120
verified: 2026-07-21
sources:
  [
    docker-compose.yaml,
    docker-compose.home.yaml,
    scripts/deploy-remote.sh,
    app/crate/projector.py,
  ]
---

# Operations

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
