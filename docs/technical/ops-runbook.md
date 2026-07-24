---
title: Backup and recovery
summary: Quiesce, back up, restore and verify a Crate deployment without corrupting runtime state.
section: operations
audience: [operator]
status: canonical
order: 130
verified: 2026-07-21
sources:
  [docker-compose.yaml, docker-compose.home.yaml, scripts/deploy-remote.sh]
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
