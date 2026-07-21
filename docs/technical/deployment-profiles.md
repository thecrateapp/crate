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
`origin/main`, verifies GHCR manifests for every required image, copies only
the compose/Traefik deployment payload, creates a remote rollback snapshot,
pulls images and starts the compose stack with `--no-build`.

The remote profile combines `docker-compose.yaml` and
`docker-compose.project.yaml`; it includes API, readplane, worker families,
projector, media worker, Admin, Listen, Site, Docs, PostgreSQL, cache Redis,
durable Redis and Traefik.

Migration safety changes rollback semantics: after the updated stack has been
started, automatic rollback is intentionally disabled because the database may
already have advanced. Treat a failed post-start verification as a forward-fix
or restore decision, not as permission to retag older images blindly.

`make deploy-build` and `make deploy-sync` are exceptional/manual workflows.
Do not replace the image-first flow with a repository-wide `rsync --delete`:
the server owns media and data outside the checkout.

## Preflight and post-deploy

Before any non-development deployment:

1. Back up PostgreSQL and the deployment `.env`.
2. Check `docker compose config -q` with the exact compose/profile files.
3. Confirm music mount ownership, free disk, required secrets and image tags.
4. Record the previous image tag and migration state.

After startup, check container health, API status, readplane readiness,
projector progress, worker queues and an authenticated Admin/Listen request.
For federation-enabled changes also run the relevant harness acceptance gate;
see [Federation production acceptance](federation-production-acceptance.md).
