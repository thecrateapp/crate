---
title: Development, deployment and operations model
summary: The shared runtime model behind local development, self-hosting and project deployment.
section: operations
audience: [developer, operator]
status: canonical
order: 100
verified: 2026-07-21
sources:
  [
    Makefile,
    docker-compose.dev.yaml,
    docker-compose.readplane.dev.yaml,
    docker-compose.yaml,
  ]
---

# Development, deployment and operations model

Crate deliberately uses different compositions for development, home hosting
and the project-hosted environment. The invariant across them is service
ownership: API is read-only for music, workers own filesystem mutations,
PostgreSQL is authoritative, and readplane/projector maintain the fast read
model.

## Local stack

`make dev` includes `docker-compose.readplane.dev.yaml`; readplane is not an
optional afterthought in the supported development path. It starts the backend
containers and Vite apps on Admin 5173, Listen 5174, Docs 5175 and Site 5176.
Readplane is exposed on 8686.

## Production topology

The project-hosted compose layers run API, readplane, projector, worker
families, media worker, Admin, Listen, Site, Docs, PostgreSQL, cache Redis,
durable Redis and Traefik. The home profile is a separate installer-owned
compose installation and must be operated with its own variables and backup
strategy.

## Startup and data safety

API/worker startup serializes Alembic migration work with advisory locking.
New database work must use Alembic migrations. PostgreSQL and durable Redis
survive a normal restart; cache Redis has volatile eviction. Do not treat a
compose restart as an atomic rollback after schema migration.

Use these detailed pages for instructions rather than duplicating them here:

- [Development setup](00b-development-setup.md)
- [Deployment profiles](deployment-profiles.md)
- [Operations](operations.md)
- [Backup and recovery](ops-runbook.md)
