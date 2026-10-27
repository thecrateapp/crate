---
title: Upgrade from 2.7 to 3.0
summary: Upgrade a self-hosted Crate 2.7.x instance to 3.0.0, with the installer or the image-first deploy, and move the agent pilots.
section: operations
audience: [operator]
status: canonical
order: 115
verified: 2026-10-27
sources:
  - docs/releases/v3.0.0.md
  - install.sh
  - app/installer/cmd/crate/main.go
  - docker-compose.yaml
  - docker-compose.home.yaml
  - deploy/operator/compose.operator.yaml
  - .env.example
  - Makefile
  - scripts/deploy.sh
  - scripts/deploy-remote.sh
  - app/crate/api/__init__.py
  - app/crate/db/jobs/instance_listening_rollups.py
  - app/crate/db/migrations/versions/135_instance_listening_rollups.py
  - app/crate/db/migrations/versions/136_genre_taxonomy_facets.py
  - app/crate/db/migrations/versions/137_scrobble_provider_results.py
  - app/crate/db/migrations/versions/138_remove_legacy_telegram_settings.py
---

# Upgrade from 2.7 to 3.0

This guide takes a self-hosted instance on any 2.7.x release to 3.0.0. The
[release notes](https://github.com/thecrateapp/crate/blob/v3.0.0/docs/releases/v3.0.0.md)
list what changes. Read the whole guide before you start: 3.0 migrates the database,
removes the built-in Telegram bot and renames the agent pilot.

Pick the section that matches how the instance was installed
([Deployment profiles](deployment-profiles.md)):

- **Home install**: a folder written by the 2.7 `install.sh` (default `~/crate`), with
  `docker-compose.yaml` and `.env` and no repository checkout. Upgrade it with the
  `crate` installer.
- **Repository checkout**: a clone of this repository deployed with `make deploy`
  (image-first, from the signed release manifest). Upgrade it with `make deploy`.

The installer manages home installs only. It does not convert a checkout into a home
install: the two profiles use different compose files and media variables.

## Before you start

1. **Back up PostgreSQL and `.env`.** A downgrade after the 3.0 migrations means restoring
   this backup. On either profile, with `CRATE_POSTGRES_USER` and `CRATE_POSTGRES_DB` set to
   the values in `.env`:

   ```bash
   cp .env .env.pre-v3
   docker exec crate-postgres pg_dump -U "$CRATE_POSTGRES_USER" -d "$CRATE_POSTGRES_DB" \
     --format=custom --no-owner --no-acl > crate-pre-v3.dump
   docker exec -i crate-postgres pg_restore --list < crate-pre-v3.dump > /dev/null
   ```

   On a home install, also keep the compose file and the exact images you run. 2.7 images
   carry no version tag, and the installer rewrites `docker-compose.yaml`:

   ```bash
   cp docker-compose.yaml docker-compose.pre-v3.yaml
   docker compose images -q | sort -u \
     | xargs docker image inspect --format '{{index .RepoDigests 0}}' > images-pre-v3.txt
   ```

   On a checkout, `make deploy-recovery-snapshot` also captures durable Redis, the
   configuration and the running images; see [Deploy a checkout](#deploy-a-checkout).
   [Backup and recovery](ops-runbook.md) covers restore.

2. **Record the migration revision.** 2.7.0 is at `117`, 2.7.1 at `118`, 2.7.2 and 2.7.3 at
   `131`, 2.7.4 at `134`. 3.0.0 ends at `138`.

   ```bash
   docker exec crate-postgres psql -U "$CRATE_POSTGRES_USER" -d "$CRATE_POSTGRES_DB" -Atc \
     "SELECT version_num FROM alembic_version"
   ```

3. **Look for the agent pilots.** Only checkouts on 2.7.4 can run them:

   ```bash
   docker ps -a --format '{{.Names}}' | grep -E '^crate-(hermes-agent|hermes-operator)$'
   ls .deploy/hermes.compose.yaml
   systemctl status crate-provenance.service
   ```

   If any of these exist, follow [Move the agent pilots](#move-the-agent-pilots) as part of
   the upgrade.

4. **Check whether the built-in Telegram bot is in use.** Migration 138 deletes its settings
   (`telegram_enabled`, `telegram_bot_token`, `telegram_chat_id`) and its stored token, and
   nothing in 3.0 sends those messages. To keep Telegram, plan to set up Crate Agent or Crate
   Operator with a new bot after the upgrade ([Crate Agent and Crate Operator](crate-agent.md)),
   and revoke the old token in BotFather.

## Upgrade a home install

Do not upgrade with `docker compose pull`. 2.7 installs set `CRATE_IMAGE_TAG=latest`, which
would run the new images with the 2.7 compose file. Run the 3.0 installer on the existing
folder instead; it writes the 3.0 compose file and pins the images:

```bash
curl -fsSL https://cratemusic.app/install.sh | bash -s -- --dir ~/crate
```

`install.sh` downloads the `crate` binary of the latest release, checks its checksum, keeps it
in `~/.local/bin` and runs `crate install`. To pin this release, set
`CRATE_INSTALLER_VERSION=v3.0.0` for `bash`. The installer:

- prefills every answer from the existing `.env`, keeps every secret and any line you added
  by hand, and adds the settings that are new in 3.0;
- rewrites `docker-compose.yaml`, `config.yaml` and the Traefik files of its release;
- moves `CRATE_IMAGE_TAG` from `latest` (or an older release) to `v3.0.0`, and keeps any
  other value, such as a commit SHA;
- starts the stack and waits until the API answers.

Then:

```bash
crate doctor               # machine, Docker, services, API and every configured key
crate configure            # integrations, including Crate Agent
```

`TZ` is already in a home install's `.env`; the installer keeps it. Details are in
[Quickstart](00-quickstart.md), and [Install with an AI agent](00a-install-with-ai.md) shows
how to run the same upgrade through `crate mcp`.

## Upgrade a checkout

### Update `.env`

Compare `.env` with `.env.example` of the release:

| Variable                                                                         | Action                                                                                                                                                            |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`                                         | Delete. Crate no longer reads them.                                                                                                                               |
| `LISTEN_APPEARANCE_SETTINGS_ENABLED`                                             | Delete. The themes it gated are retired, and the Listen build no longer takes it. Remove it from GitHub Actions variables if you build your own images.           |
| `TIDARR_PASSWORD`, `NATIVE_OAUTH_LEGACY_REDIRECT_ENABLED`                        | Delete. Nothing read them.                                                                                                                                        |
| `CRATE_HERMES_MCP_URL`, `CRATE_HERMES_MCP_HOST`                                  | Rename to `CRATE_AGENT_MCP_URL` and `CRATE_AGENT_MCP_HOST`.                                                                                                       |
| `CRATE_HERMES_IMAGE`                                                             | Delete. It pointed at the upstream engine image. Leave `CRATE_AGENT_IMAGE` empty to use `ghcr.io/thecrateapp/crate-agent` of the release.                         |
| `TZ`                                                                             | Set it explicitly, for example `TZ=Europe/Madrid`. With `TZ` unset, the agent containers now default to `UTC` instead of `Europe/Madrid`.                         |
| `CRATE_AGENT_PROVIDER`, `CRATE_AGENT_MODEL`, `CRATE_AGENT_BASE_URL`              | Optional. Model for Crate Agent and Crate Operator; `make agent-init` and `make agent-model` set them.                                                            |
| `CRATE_MCP_ENABLED`, `CRATE_MCP_ACTIONS_ENABLED`, `CRATE_MCP_ALLOWED_HOSTS`      | Optional, default `false`/empty. Crate Agent needs `CRATE_MCP_ENABLED=true` and its MCP host allowed; Crate Operator also needs `CRATE_MCP_ACTIONS_ENABLED=true`. |
| `CRATE_OPERATOR_ROOT`, `CRATE_OPERATOR_PRINCIPAL_IDS`, `CRATE_AGENT_INSTANCE_ID` | Crate Operator only; `make agent-init AGENT_PROFILE=operator` sets them.                                                                                          |

On a checkout, `make deploy` copies the `.env` of the server, not your local one: edit it on
the server.

### Deploy a checkout

Deploy the commit that `v3.0.0` points at. `VERSION` must be a full SHA reachable from
`origin/main`, and `DEPLOY_ID` names the recovery set:

```bash
git fetch origin --tags
VERSION="$(git rev-parse 'v3.0.0^{commit}')"
make deploy-preflight VERSION="$VERSION"
make deploy-recovery-snapshot DEPLOY_ID=v3.0.0-upgrade
make deploy VERSION="$VERSION" DEPLOY_ID=v3.0.0-upgrade
```

`deploy-recovery-snapshot` stops the API, workers and projector, dumps PostgreSQL and durable
Redis, and leaves them stopped for the deploy. `make deploy` reuses that recovery set, verifies
every image digest of the release manifest, recreates the changed services and runs the health
checks. Migrations run when `crate-api` starts. Without a recovery snapshot, `make deploy` still
takes its own rollback snapshot, but that one is not a database restore point.

### Move the agent pilots

Skip this section if step 3 of [Before you start](#before-you-start) found nothing.

**Crate Agent (`crate-hermes-agent`).** The compose service no longer exists, so stop the
container directly and move its state (use the `DATA_DIR` value from `.env`):

```bash
docker rm -f crate-hermes-agent
mv "${DATA_DIR}/hermes-agent" "${DATA_DIR}/crate-agent"
make agent-up
```

Run the first two commands before the deploy and `make agent-up` after it. On the project
server, add `AGENT_COMPOSE_FILES=docker-compose.yaml:docker-compose.project.yaml`. The secret
file names are unchanged and the ChatGPT login in `home/` is kept. `runtime/` and
`secrets/managed.env` are no longer used and can be deleted.

**Crate Operator (`crate-hermes-operator`).** Before the deploy:

1. Stop the 2.7.4 operator: `docker rm -f crate-hermes-operator`.
2. Stop the host provenance unit. Provenance now runs as the `crate-provenance` and
   `crate-provenance-docker` containers:

   ```bash
   sudo systemctl disable --now crate-provenance.service
   ```

   Then delete its unit file where you installed it.

3. Move `.deploy/hermes.compose.yaml` out of `.deploy/`. 3.0 does not read it, and its services
   are the 2.7 ones. If you keep a root-owned, host-approved overlay, install the release's
   `deploy/operator/compose.operator.yaml` as `.deploy/crate-operator.compose.yaml`; otherwise
   the deploy uses `deploy/operator/compose.operator.yaml` while `crate-operator` runs.
4. The operator state stays where it is. In 2.7.4 an unset `CRATE_OPERATOR_ROOT` meant
   `/opt/crate-operator`; in 3.0 it means `${DATA_DIR}/crate-operator`. If you relied on the old
   default, set `CRATE_OPERATOR_ROOT=/opt/crate-operator` in `.env`.

After the deploy, run the operator setup. It keeps existing keys and asks before it overwrites
a shared one:

```bash
make agent-init AGENT_PROFILE=operator \
  AGENT_COMPOSE_FILES=docker-compose.yaml:docker-compose.project.yaml
make agent-status AGENT_PROFILE=operator \
  AGENT_COMPOSE_FILES=docker-compose.yaml:docker-compose.project.yaml
```

From then on, `make deploy` keeps the overlay and recreates the operator services on each
release while `crate-operator` runs. [Crate Operator candidate and rollout](hermes-operator-release.md)
covers the root-provisioned layout.

## After the upgrade

Run these checks on either profile.

1. **Services are healthy.**

   ```bash
   docker compose ps
   docker compose logs --tail=100 crate-api crate-readplane crate-projector
   ```

   On a checkout, add `-f docker-compose.yaml -f docker-compose.project.yaml`.

2. **Migrations reached 138.** The revision query from step 2 of
   [Before you start](#before-you-start) prints `138`.

3. **The concurrent indexes of migration 135 are valid.** Migration 135 builds
   `idx_user_track_daily_day` and `idx_user_entity_firsts_key` with
   `CREATE INDEX CONCURRENTLY`. An interrupted build leaves an invalid index that later runs
   skip. This query must return no rows:

   ```bash
   docker exec crate-postgres psql -U "$CRATE_POSTGRES_USER" -d "$CRATE_POSTGRES_DB" -Atc \
     "SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid"
   ```

   Rebuild any index it lists with `REINDEX INDEX CONCURRENTLY <name>`. Alembic does not
   rerun an applied revision. Without a valid `idx_user_track_daily_day`, stats range requests
   scan the whole table.

4. **The instance rollups backfill is queued once.** When listening history exists but the new
   rollups miss its earliest day, `crate-api` queues `backfill_instance_listening_rollups` on
   startup and logs `Queued instance listening rollup backfill`. It runs on the maintenance
   pool. Follow it in Admin or with:

   ```bash
   docker exec crate-postgres psql -U "$CRATE_POSTGRES_USER" -d "$CRATE_POSTGRES_DB" -Atc \
     "SELECT id, status, created_at FROM tasks
      WHERE type = 'backfill_instance_listening_rollups' ORDER BY created_at DESC LIMIT 5"
   ```

   Until it completes, Crate Pulse ranges can be incomplete.

5. **Stats snapshots warm up.** Stats dashboards now use `v3` snapshot keys, so every dashboard
   starts cold. `crate-api` queues the missing user dashboards on startup and workers prewarm
   them. A dashboard opened before its snapshot exists returns `pending: true`, and Listen
   polls for about a minute. To see progress:

   ```bash
   docker exec crate-postgres psql -U "$CRATE_POSTGRES_USER" -d "$CRATE_POSTGRES_DB" -Atc \
     "SELECT scope, count(*), max(built_at) FROM ui_snapshots
      WHERE subject_key LIKE 'v3:%' GROUP BY scope"
   ```

6. **Clients work.** Sign in to Admin and Listen. iOS needs 16.4 or later; iOS 15 devices stay
   on the last 2.x build.

[Operations](operations.md) lists the remaining runtime checks: projector catch-up, worker
queues and SSE.

## Roll back

The 3.0 migrations change the schema, and none of them is undone on startup of an older image.
Once `crate-api` 3.0 has started, rolling back means restoring the database:

- **Checkout:** restore the recovery set taken before the deploy. This restores PostgreSQL,
  durable Redis, configuration and images:

  ```bash
  make deploy-rollback DEPLOY_ID=v3.0.0-upgrade CONFIRM=restore-production
  ```

  `make deploy-image-rollback` swaps only images. Use it only when the deploy failed before
  `crate-api` 3.0 started.

- **Home install:** restore `.env.pre-v3` as `.env` and `docker-compose.pre-v3.yaml` as
  `docker-compose.yaml`. Pin each Crate service to the reference recorded in
  `images-pre-v3.txt` through its image variable in `.env` (`CRATE_API_IMAGE`,
  `CRATE_WORKER_IMAGE`, `CRATE_READPLANE_IMAGE` and the others the compose file names). Then
  restore `crate-pre-v3.dump` with every writer stopped, as described in
  [Backup and recovery](ops-runbook.md).

A rollback does not bring back the built-in Telegram bot settings: migration 138 deleted them,
and only the database backup holds them.
