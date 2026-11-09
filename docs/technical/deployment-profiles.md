---
title: Deployment profiles
summary: Choose and operate the correct Crate deployment model without mixing their commands.
section: operations
audience: [operator, developer]
status: canonical
order: 110
verified: 2026-07-21
sources:
  [
    Makefile,
    install.sh,
    docker-compose.home.yaml,
    docker-compose.yaml,
    docker-compose.project.yaml,
    scripts/deploy.sh,
    scripts/deploy-remote.sh,
    scripts/worker_queue_contract.py,
  ]
---

# Deployment profiles

Crate has three supported operational profiles. They share application images,
but not their filesystems, secrets, compose overlays or upgrade command.

| Profile           | Use it for                    | Entry point                               | Do not use it for         |
| ----------------- | ----------------------------- | ----------------------------------------- | ------------------------- |
| Local development | feature work and tests        | `make dev`                                | persistent hosting        |
| Home self-hosted  | a single independent instance | `install.sh` + `docker-compose.home.yaml` | project production deploy |
| Project hosted    | the maintained project server | `make deploy`                             | generic self-hosting      |

## Local development

`make dev` combines the dev compose and readplane overlay, then runs Vite
servers. It uses fixtures and development credentials. Start/stop it with
`make dev` and `make dev-down`; reset only when it is safe to discard local
volumes with `make dev-reset`.

## Home self-hosted

The installer writes a small compose installation to `CRATE_INSTALL_DIR` and
starts pre-built images. Its media variable is `MUSIC_DIR`, unlike the base
production stack's `MEDIA_DIR/music` convention. It creates a cache Redis and
a durable AOF Redis, both protected by the same generated `REDIS_PASSWORD`.

Required secret state in its `.env`:

| Variable                        | Why it must persist                                  |
| ------------------------------- | ---------------------------------------------------- |
| `JWT_SECRET`                    | user sessions and signed application state           |
| `REDIS_PASSWORD`                | cache Redis, broker and durable Redis authentication |
| `CRATE_READPLANE_SERVICE_TOKEN` | API/readplane service authentication                 |
| PostgreSQL passwords            | database startup and application access              |

The home profile does not include the project stack's PostgreSQL backup sidecar.
Create and test a host-managed PostgreSQL backup procedure before depending on
it with irreplaceable media or user data.

## Project-hosted image-first deployment

`make deploy` delegates to `scripts/deploy.sh`. By default it resolves
`origin/main`, downloads its complete signed release manifest, verifies every
immutable GHCR digest and copies only the compose/Traefik deployment payload.
The remote deploy snapshots the previous release, pulls only changed images
and recreates only services whose digest or Compose configuration changed.
Images not rebuilt for a commit remain pinned to their last promoted digest.

Website-only releases select `crate-site`. Editing the engineering blog's planning
documents under `docs/technical/engineering-blog*.md` also selects `crate-docs`.
Neither rebuilds the agent image. Its baked context remains a versioned source
snapshot at the image's `source_sha`; configured host contexts are exported and
activated for the exact new release independently of the image.

The image detector compares the jobs in `build-images.yml`: changing only
`build-site` rebuilds only the site. Changes to shared workflow settings, change
detection, promotion, the reusable `build-image.yml` or shared actions still
rebuild every image. Missing/unreadable workflow history or an unavailable release
baseline also falls back to a complete build. Manual image selections remain
available through `workflow_dispatch`.

For a site/docs-only deployment with an unchanged agent digest, the deploy leaves
the running gateway, supervisor and provenance containers alone. In particular,
the new global release SHA must not recreate them merely through a Compose
environment change. Image updates and broader application/configuration releases
continue through the normal agent refresh path.

The remote profile combines `docker-compose.yaml` and
`docker-compose.project.yaml`; it includes API, readplane, worker families,
projector, media worker, Admin, Listen, Site, Docs, PostgreSQL, cache Redis,
durable Redis and Traefik.

Migration safety changes rollback semantics: after the updated stack has been
started, automatic rollback is intentionally disabled because the database may
already have advanced. Treat a failed post-start verification as a forward-fix
or restore decision, not as permission to retag older images blindly.
For a release that did not advance state, use
`make deploy-image-rollback DEPLOY_ID=<id> CONFIRM=rollback-images` to restore
only the application services changed by that deployment. The destructive
`make deploy-rollback ... CONFIRM=restore-production` command remains the
database and durable-Redis recovery path.

`make deploy-build` and `make deploy-sync` are exceptional/manual workflows.
Do not replace the image-first flow with a repository-wide `rsync --delete`:
the server owns media and data outside the checkout.

## Preflight and post-deploy

Before any non-development deployment:

1. Back up PostgreSQL and the deployment `.env`.
2. Check `docker compose config -q` with the exact compose/profile files.
3. Check that the AI queues have a consumer (below).
4. Confirm music mount ownership, free disk, required secrets and release digests.
5. Record the previous release manifest and migration state.

After startup, check container health, API status, readplane readiness,
projector progress, worker queues and an authenticated Admin/Listen request.

### AI queue consumers

Every call to an AI provider runs as a task on the `ai` or `ai_bulk` queue (see
[Where model calls run](ai-agents.md#where-model-calls-run)). A task sent to a
queue that no worker consumes stays pending for good, which would silently stop
every proposal, draft and extraction. Only `crate-worker` consumes these queues:
its command is `worker --queues default,fast,ai,ai_bulk` in
`docker-compose.yaml` (`default,ai,ai_bulk` in the home profile), and it starts
one Dramatiq pool for the general queues and one per AI lane. An overlay that
replaces that command must keep both lanes.

`make deploy-preflight VERSION=<sha>` and `make deploy` check this twice. The
local preflight renders the candidate Compose files
(`docker compose config --format json`) and pipes the result into
`scripts/worker_queue_contract.py`; `DEPLOY_SKIP_LOCAL_COMPOSE_CHECK=1` skips
this local step together with the local `config -q`. The remote release
preflight renders the candidate with the production environment and runs the
same script, staged next to the candidate files. The script reads
`--queues X` and `--queues=X` in list or string commands, ignores services that
start no container by default (`scale: 0`, `deploy.replicas: 0` or an opt-in
profile), and exits non-zero when `ai` or `ai_bulk` has no consumer. On success
it prints the consumer of each lane, for example
`Queue ai consumed by crate-worker`.

After the deploy, the Admin Tasks page lists `ai` and `ai_bulk` with their
running and pending tasks and the age of their oldest pending task. The
operator overlay's worker readiness requires the same queues
(`CRATE_READINESS_QUEUES=default,fast,ai,ai_bulk`). `crate-worker` has
`stop_grace_period: 2m`, so recreating it during a deploy waits up to two
minutes for in-flight AI calls to finish. Thread counts and memory are sized in
[Smart Mix operations](smart-mix-operations.md#ai-worker-lanes-and-sizing).
For federation-enabled changes also run the relevant harness acceptance gate;
see [Federation production acceptance](federation-production-acceptance.md).
