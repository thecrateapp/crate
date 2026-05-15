# Crate Operations Runbook

## PostgreSQL Backup & Restore

Crate runs an automated backup sidecar (`crate-postgres-backup`) using `prodrigestivill/postgres-backup-local`.

### Backup Configuration

- **Schedule**: Daily (`@daily`)
- **Retention**: 7 daily backups + 4 weekly backups
- **Storage**: `${DATA_DIR}/backups/postgres` on the host
- **Format**: `pg_dump` custom format (`.sql.gz` or `.dump` depending on image version)

### Listing Available Backups

```bash
ssh crate@95.216.3.27
ls -la /home/crate/crate/data/backups/postgres/
```

### Restore Procedure

> ⚠️ **Warning**: Restoring a backup overwrites the current database state. Coordinate downtime if the service is active.

1. **Stop services that write to the database**:

   ```bash
   docker compose stop crate-api crate-worker crate-projector crate-maintenance-worker crate-analysis-worker crate-playback-worker crate-readplane
   ```

2. **Identify the backup file to restore**:

   ```bash
   ls /home/crate/crate/data/backups/postgres/
   # Files are named with timestamps, e.g., daily/<DB>-<TIMESTAMP>.sql.gz
   ```

3. **Restore into `crate-postgres`**:

   ```bash
   # Example: restore the latest daily backup
   BACKUP_FILE=$(ls -t /home/crate/crate/data/backups/postgres/daily/*.sql.gz | head -n 1)

   docker compose exec -T crate-postgres psql -U ${CRATE_POSTGRES_USER} -d ${CRATE_POSTGRES_DB} \
     -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

   gunzip -c "$BACKUP_FILE" | docker compose exec -T crate-postgres psql -U ${CRATE_POSTGRES_USER} -d ${CRATE_POSTGRES_DB}
   ```

   For custom-format dumps (`.dump`), use `pg_restore` instead:

   ```bash
   docker compose exec -T crate-postgres pg_restore \
     -U ${CRATE_POSTGRES_USER} -d ${CRATE_POSTGRES_DB} --clean --if-exists \
     < "$BACKUP_FILE"
   ```

4. **Restart services**:

   ```bash
   docker compose up -d
   ```

5. **Verify**:
   ```bash
   docker compose ps
   docker compose logs crate-api --tail 50
   ```

### Manual On-Demand Backup

```bash
docker compose exec crate-postgres-backup /backup.sh
```

## Redis Auth Rotation

If `REDIS_PASSWORD` must be rotated:

1. Update `.env` with the new password.
2. Update `REDIS_URL` in any external integrations not managed by Docker Compose.
3. Run `docker compose up -d` to recreate containers with the new env vars.
4. Redis data is ephemeral (cache + broker); queued Dramatiq messages will be lost. Schedule rotation during low-activity windows.
