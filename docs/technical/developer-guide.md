---
title: Developer guide
summary: Service boundaries, repository map and contribution rules for Crate.
section: developer
audience: [developer]
status: canonical
order: 40
verified: 2026-07-21
sources: [AGENTS.md, Makefile, app/crate, app/readplane]
---

# Developer guide

## System boundary

Crate has two runtime planes:

- **Write/control plane:** FastAPI, PostgreSQL-backed task creation and worker
  processes. API mounts `/music` read-only.
- **Read plane:** the Go readplane serves selected snapshot-backed routes,
  streaming proxy traffic and SSE relay paths, with FastAPI fallback where the
  route contract permits it.

All music filesystem writes — tags, move/delete, acquisition publication and
federated import publication — belong in a worker. An API endpoint may request
a task, but it must not acquire a writable music mount to perform the work.

## Repository map

| Path                         | Responsibility                                              |
| ---------------------------- | ----------------------------------------------------------- |
| `app/crate/api/`             | FastAPI routers and Pydantic API schemas                    |
| `app/crate/db/`              | SQLAlchemy ORM/Core queries, repositories, jobs and Alembic |
| `app/crate/worker_handlers/` | Worker task implementations                                 |
| `app/crate/actors.py`        | Dramatiq actor/queue registration                           |
| `app/crate/projector.py`     | Redis Stream domain events to warmed snapshots              |
| `app/readplane/`             | Go JWT/read/snapshot/SSE/streaming service                  |
| `app/media-worker/`          | Rust download and media package worker                      |
| `app/shared/ui/`             | shared design system used by Admin and Listen               |
| `app/shared/web/`            | frontend API client, hooks and utilities                    |
| `app/ui/`, `app/listen/`     | separate Admin and consumer applications                    |
| `docs/technical/`            | canonical technical documentation                           |

## Data and background work

Use the concrete database modules rather than the `crate.db` compatibility
facade for new code. Use `transaction_scope()` for mutations and `read_scope()`
for query-only work. Simple CRUD belongs in ORM/repositories; complex reads and
worker claims use Core/text query modules.

Tasks have a PostgreSQL record and a Dramatiq message. Queue ownership is
intentional: normal/fast, maintenance, analysis and playback workers have
different resource profiles. `orchestrator.py` is legacy; add new background
work through Dramatiq actors and handlers instead.

The projector consumes domain events to maintain `ui_snapshots` and other read
models. When a write changes a readplane or SSE surface, include the event,
projection and freshness/invalidation path in the change review.

## Frontend rules

Admin uses cookie sessions and Listen supports browser OAuth/persisted sessions
plus native bearer-token flows. Use `@crate/ui` only for components shared by
both apps; application-specific components stay in their application. Prefer
the shared `useApi`, `api`, `encPath` and design tokens over duplicate helpers.

For new charts use Nivo. For new realtime work, identify whether the source is
classic SSE, snapshot-driven SSE or a readplane route before adding a polling
loop.

## Contribution checklist

1. Start the appropriate stack and reproduce the behavior with a focused test.
2. Preserve API read-only and worker-write mount asymmetry.
3. Add a test for every changed public behavior: pytest, table-driven Go, or
   Vitest/Testing Library as appropriate.
4. Run the narrow check first, then the relevant `make dev-test-*` suite.
5. Update the canonical document when a runtime contract changes.

For database migrations, deploy sequencing or readplane changes, read
[Deployment profiles](deployment-profiles.md) and [Operations](operations.md)
as well as the subsystem documentation.
