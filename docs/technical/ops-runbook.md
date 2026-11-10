---
title: Backup and recovery
summary: Quiesce, back up, restore and verify a Crate deployment without corrupting runtime state.
section: operations
audience: [operator]
status: canonical
order: 130
verified: 2026-11-10
sources:
  [
    docker-compose.yaml,
    docker-compose.home.yaml,
    .env.example,
    scripts/deploy-remote.sh,
  ]
---

# Backup and recovery

## Scope

The project-hosted base compose includes `crate-postgres-backup`; the home
compose does not. This runbook gives the recovery invariant for both profiles:
back up PostgreSQL and deployment configuration, quiesce every writer before a
restore, then prove the read/worker/event paths are healthy.

Media files are not reconstructed by a PostgreSQL restore. Back up irreplaceable
music separately and preserve the deployment `.env`, especially encryption,
JWT, Redis and readplane secrets.

## Back up

For the project-hosted profile, inspect and trigger the configured sidecar:

```bash
docker compose ps crate-postgres-backup
docker compose exec crate-postgres-backup /backup.sh
```

The sidecar writes one gzip-compressed plain SQL dump a day and hard-links it
into `daily/`, `weekly/` and `monthly/`, so a dump shared by several sets is
stored once. `last/` keeps the dumps of the past 24 hours and every set has a
`crate-latest.sql.gz` symlink. Its settings come from `.env`:

| Variable                      | Default                        | Meaning                                                   |
| ----------------------------- | ------------------------------ | --------------------------------------------------------- |
| `POSTGRES_BACKUP_DIR`         | `${DATA_DIR}/backups/postgres` | Host path, or the compose volume `crate_postgres_backups` |
| `POSTGRES_BACKUP_KEEP_DAYS`   | `3`                            | Daily dumps kept                                          |
| `POSTGRES_BACKUP_KEEP_WEEKS`  | `4`                            | Weekly dumps kept                                         |
| `POSTGRES_BACKUP_KEEP_MONTHS` | `3`                            | Monthly dumps kept                                        |
| `POSTGRES_BACKUP_EXTRA_OPTS`  | `-Z6`                          | Extra `pg_dump` options; `-Z` is the gzip level           |

Retention is age-based (`find -mtime`): a set keeps dumps younger than N days,
N weeks plus a day, or N months of 31 days plus a day, so the monthly set can
hold one more file than the count while the oldest ages out.

Keep dumps off the root filesystem when it is small: the named volume
`crate_postgres_backups` lives in Docker's data root (on production, `/var`).
Never point `POSTGRES_BACKUP_DIR` below `MUSIC_DIR`: dumps contain credentials
and the library is shared with other services such as slskd.

To move existing dumps from the host path into the volume, create the volume
through compose, copy with hard links preserved, verify, and only then remove
the old directory:

```bash
POSTGRES_BACKUP_DIR=crate_postgres_backups \
  docker compose run --rm --no-deps --entrypoint true crate-postgres-backup
docker run --rm -v "$PWD/data/backups/postgres:/old:ro" \
  -v crate_crate_postgres_backups:/new debian:bookworm-slim \
  sh -ec 'cp -a /old/. /new/ && chown -R 1000:1000 /new'
# compare file counts, sizes and `gzip -t /new/last/crate-latest.sql.gz`
```

Then set `POSTGRES_BACKUP_DIR=crate_postgres_backups` in `.env` and recreate
the sidecar with `docker compose up -d --no-deps crate-postgres-backup`. The
volume name carries the compose project prefix (`crate_` on production); use
the `PUID`/`PGID` of the deployment in `chown`.

These dumps live on the same server as the database. To survive the loss of
the host, the opt-in `crate-backup-offsite` service (compose profile
`offsite-backup`) copies the weekly and monthly dumps with restic to Cloudflare
R2 and Google Drive, prunes them, and runs a monthly check and restore drill.
Setup, credential rotation and restores from each destination are in
`docs/operators/postgres-offsite-backups.md`.

For home hosting, use a host-managed `pg_dump` schedule or an equivalent backup
service. Record the exact database credentials and test restoring a copy on a
separate volume. Never assume a named volume snapshot is a tested database
backup.

## Restore procedure

1. Announce downtime and record the current image tag, migration revision and
   backup chosen.
2. Stop every service that can write or coordinate writes. In the project
   profile this includes API, all worker families, projector and media worker:

   ```bash
   docker compose stop crate-api crate-worker crate-maintenance-worker \
     crate-analysis-worker crate-playback-worker crate-projector \
     crate-media-worker
   ```

   Stop the readplane too when the goal is a fully consistent user-visible
   recovery. Use `docker compose config --services` to adapt names for home.

3. Restore the selected PostgreSQL dump using the dump format it was created
   with. Prefer an isolated restore rehearsal. For a custom dump:

   ```bash
   docker compose exec -T crate-postgres pg_restore \
     -U "$CRATE_POSTGRES_USER" -d "$CRATE_POSTGRES_DB" \
     --clean --if-exists < backup.dump
   ```

   The sidecar's dumps are gzip-compressed plain SQL. Check the file, then
   load it into an empty database (rehearse into a scratch name such as
   `crate_restore` first):

   ```bash
   docker compose exec -T crate-postgres-backup \
     gzip -t /backups/daily/crate-YYYYMMDD.sql.gz
   docker compose exec -T crate-postgres \
     createdb -U "$POSTGRES_SUPERUSER_USER" -O "$CRATE_POSTGRES_USER" crate_restore
   docker compose exec -T crate-postgres-backup \
     cat /backups/daily/crate-YYYYMMDD.sql.gz | gunzip \
     | docker compose exec -T crate-postgres psql -v ON_ERROR_STOP=1 \
       -U "$CRATE_POSTGRES_USER" -d crate_restore
   ```

4. Start the stack with `docker compose up -d`. Let Alembic finish before
   treating API startup as healthy. Do not flush durable Redis as part of a
   database restore: it contains broker/stream/lease state that needs an
   explicit recovery decision.

5. Verify in this order:

   ```bash
   docker compose ps
   docker compose logs --tail=100 crate-api crate-readplane crate-projector
   docker compose logs --tail=100 crate-worker crate-maintenance-worker \
     crate-analysis-worker crate-playback-worker
   ```

   Then confirm API status, authenticated Admin and Listen reads, snapshot
   freshness, projector catch-up, worker queue progress and SSE reconnection.
   If federation is enabled, also inspect peer/grant state and verify no import
   or stream operation resumed with stale authorization.

## Redis credential rotation

`REDIS_PASSWORD` is shared by the cache and durable Redis services. Rotation
recreates services and interrupts broker/stream users; schedule it as a
maintenance event. Update `.env`, recreate the profile's services, then verify
API/readplane/projector/workers before accepting traffic. Do not describe the
result as a harmless cache clear.
