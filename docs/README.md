---
title: Documentation contract
summary: Canonical reading paths and the source-of-truth policy for Crate documentation.
section: reference
audience: [developer, operator]
status: canonical
order: 0
verified: 2026-07-21
sources:
  [
    Makefile,
    docker-compose.dev.yaml,
    docker-compose.home.yaml,
    docker-compose.yaml,
  ]
---

# Crate technical documentation

Crate is a self-hosted music platform with a Python/FastAPI write plane, a Go
read plane, background workers, PostgreSQL and two Redis roles. This directory
is the source of truth for the hosted documentation site and for repository
readers.

## Choose a path

- **Run Crate at home:** start with [Quickstart](technical/00-quickstart.md),
  then [Deployment profiles](technical/deployment-profiles.md) and
  [Operations](technical/operations.md).
- **Contribute to Crate:** read [Development setup](technical/00b-development-setup.md),
  [Developer guide](technical/developer-guide.md) and
  [System overview](technical/01-system-overview.md).
- **Work on federation:** read [Federation overview](technical/federation-overview.md)
  before the protocol, security and operations references.
- **Operate the project-hosted stack:** use the image-first deployment section
  in [Deployment profiles](technical/deployment-profiles.md). It is a project
  operator workflow, not the generic self-hosting path.

## Canonical map

| Area               | Canonical documents                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start              | [Quickstart](technical/00-quickstart.md), [Development setup](technical/00b-development-setup.md)                                                                                                                                                                                                                                                                                            |
| Architecture       | [System overview](technical/01-system-overview.md), [Backend and data](technical/02-backend-api-and-data.md), [Workers](technical/03-worker-tasks-and-background-services.md), [Developer guide](technical/developer-guide.md)                                                                                                                                                               |
| Product subsystems | [Storage/imports](technical/04-library-storage-sync-and-imports.md), [Enrichment](technical/05-enrichment-acquisition-and-integrations.md), [Analysis](technical/06-audio-analysis-similarity-and-discovery.md), [Auth](technical/07-auth-users-social-and-sessions.md), [Frontends](technical/08-frontends-admin-and-listen.md), [Playback](technical/09-playback-realtime-and-subsonic.md) |
| Deploy and operate | [Deployment profiles](technical/deployment-profiles.md), [Operations](technical/operations.md), [Backup and recovery](technical/ops-runbook.md)                                                                                                                                                                                                                                              |
| Federation         | [Overview](technical/federation-overview.md), [Protocol](technical/federation-protocol.md), [Security](technical/federation-threat-model.md), [Operations](technical/federation-operations-runbook.md), [Acceptance](technical/federation-production-acceptance.md)                                                                                                                          |
| Reference          | [Architecture summary](architecture.md), [API](api.md), [Audio analysis](audio-analysis.md), [Enrichment notes](enrichment.md)                                                                                                                                                                                                                                                               |

## Documentation contract

The application code and runtime configuration are authoritative. In
particular, verify deployment instructions against `Makefile`, compose files,
`install.sh` and `scripts/deploy*.sh`; verify HTTP contracts against the
OpenAPI served by the API. A canonical page declares the source files and its
last verification date in its frontmatter.

When a change affects a public command, compose profile, environment variable,
service boundary, migration/rollback behaviour or federation contract, update
the relevant canonical document in the same change. Add an automated check when
the statement can be derived from source.

Only the canonical documents declared in `docs/manifest.json` are versioned.
Local plans, roadmaps, archives and audits are ignored and must not be linked
from the repository or treated as a current runbook.
