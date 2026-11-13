---
title: Managed backups
summary: Set up the backups Admin manages, choose providers, keep the recovery kit, follow alerts and metrics, restore from the command line and move from the off-site sidecars.
section: operations
audience: [operator]
status: canonical
order: 131
verified: 2026-11-13
sources:
  [
    app/crate/backups/cli.py,
    app/crate/backups/importer.py,
    app/crate/backups/providers.py,
    app/crate/backups/policies.py,
    app/crate/backups/kit.py,
    app/crate/backups/alerts.py,
    app/crate/backups/metrics.py,
    app/crate/worker_handlers/backups.py,
    scripts/deploy-remote.sh,
    docker-compose.yaml,
  ]
---

# Managed backups

Admin's **Backups** page (System, `/backups`) manages the database backups: where
they go (destinations), when and how long (policies), the runs, verification,
restore drills and the recovery kit. The work runs in the workers; Admin and the API
never run `pg_dump`, restic or rclone. How the engine dumps, copies, prunes,
verifies and drills is in [Backup and recovery](ops-runbook.md#backup-policies-and-off-site-copies).

What it backs up is the PostgreSQL database. Music files, the deployment `.env` and
its secrets need their own copies.

## Set up

1. **Settings** on `crate-worker` and `crate-maintenance-worker`:
   - `CRATE_LOCAL_BACKUPS_ENABLED`: on by default; `docker-compose.yaml` sets it
     `false` while `crate-postgres-backup` makes the dumps.
   - `CRATE_BACKUP_DIR`: the backup directory. Empty keeps
     `${DATA_DIR}/crate/backups`; `/backups` is `POSTGRES_BACKUP_DIR` mounted into
     both workers (on production, the `crate_postgres_backups` volume). The engine
     writes `dumps/` and `drills/` there and never creates a configured directory
     that is not mounted.
   - `CRATE_CREDENTIAL_KEY`: encrypts every destination secret and repository
     password. It must be the same on the API and every worker. Without it the
     secrets cannot be read: keep it in the password manager, and keep the
     recovery kit, which does not depend on it.
2. **Disk.** The backup directory holds the local dumps (3 days, 4 weeks and 3
   months by default) and, during a drill, one more copy. The PostgreSQL volume
   needs room for one restored copy of the database while a drill runs.
3. **Destinations.** Add one from Destinations with its provider form and test
   it. A destination stays disabled until its first test passes.
4. **Policies.** A schedule (daily at a time, every N hours, or manual), which
   tiers (daily, weekly, monthly) each destination receives, the retention
   counts, the compression, and the verification and drill cadence.
5. **Recovery kit.** Download it, open it once to check it, store it away from the
   server and confirm "I stored it". Admin warns until every destination is
   covered.

## Providers

| Kind      | Repository                        | What Admin asks for                                                                                                                                                        |
| --------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local`   | A folder of the backup directory  | The folder. An external disk is mounted inside the backup directory.                                                                                                       |
| `s3`      | `s3:<endpoint>/<bucket>/<prefix>` | Endpoint, bucket, access key ID and secret. Cloudflare R2: `https://<account id>.r2.cloudflarestorage.com`, region `auto`, a token with Object Read & Write on the bucket. |
| `b2`      | `b2:<bucket>:<prefix>`            | Application key ID and key, restricted to the bucket.                                                                                                                      |
| `sftp`    | `sftp:<user>@<host>:<path>`       | Host, port, user and folder. Crate generates the SSH key; install its public key on the server. The host key is pinned on the first test.                                  |
| `gdrive`  | `rclone:` with rclone's Drive     | **Connect Google Drive**, with scope `drive.file`: Crate sees only the files it creates.                                                                                   |
| `dropbox` | `rclone:` with rclone's Dropbox   | **Connect Dropbox**.                                                                                                                                                       |

Pruning deletes old data, so every destination needs delete rights; the test writes,
reads and deletes a probe file to prove it.

**Google Drive** needs the install's own OAuth client (decision D4): a Google Cloud
"Web application" client with the Drive API enabled, the consent screen
**In production** (in testing mode refresh tokens expire after 7 days) and these
redirect URIs:

- `https://admin.<DOMAIN>/api/admin/backups/oauth/callback`, for **Connect** in Admin;
- `http://127.0.0.1:53682/`, for the paste path: `rclone authorize drive "<blob>"`,
  where the blob is the base64url of
  `{"client_id":"…","client_secret":"…","scope":"drive.file"}`. Do not use the
  two-argument form, which asks for the full `drive` scope.

Put the client ID and secret on the destination, or install-wide in
`CRATE_BACKUP_GDRIVE_CLIENT_ID` and `CRATE_BACKUP_GDRIVE_CLIENT_SECRET`
(`CRATE_BACKUP_DROPBOX_*` for Dropbox). A token can only be refreshed with the
client that minted it.

## Recovery kit

The kit is the way back when the server and its `CRATE_CREDENTIAL_KEY` are gone.
It is one file, `crate-recovery-kit-<YYYYMMDD>.md.age`, encrypted with the
passphrase you type when you download it (12 characters or more; Crate never stores
it). Downloading it needs your current password again, and every download is
audited.

Inside: every destination's location and repository password, the SFTP private key,
the restore steps and the fingerprint of `CRATE_CREDENTIAL_KEY` (not the key, and
not the other provider credentials: keep those in the password manager). Open it
with any age implementation:

```bash
age -d -o kit.md crate-recovery-kit-20261113.md.age
```

A destination added, imported or re-keyed after the last confirmed kit is not
covered until you download and confirm a new one.

## Restore from the command line

Admin never restores over the production database. To restore:

1. Get the repository location and password from the kit, and the provider
   credentials from the password manager. Any machine with restic 0.19 (and rclone
   for Drive and Dropbox) works, or the worker image itself.
2. Find the snapshot and fetch the dump:

   ```bash
   export RESTIC_PASSWORD='<from the kit>'
   # Cloudflare R2 or another S3 service:
   export AWS_ACCESS_KEY_ID='<key id>' AWS_SECRET_ACCESS_KEY='<secret>'
   REPO="s3:https://<account id>.r2.cloudflarestorage.com/<bucket>"
   # Google Drive: RCLONE_CONFIG_GDRIVE_TYPE=drive, _SCOPE=drive.file,
   # _CLIENT_ID, _CLIENT_SECRET and _TOKEN, then REPO="rclone:gdrive:<folder>"
   restic -r "$REPO" snapshots --host crate
   restic -r "$REPO" dump <snapshot id> /crate.dump > crate.dump
   pg_restore --list crate.dump > /dev/null
   ```

   A local dump is already a file: `dumps/crate-<stamp>.dump` in the backup
   directory, with its `.sha256` next to it (`sha256sum -c`).

3. Rehearse into a scratch database first:

   ```bash
   docker compose exec -T crate-postgres \
     createdb -U "$POSTGRES_SUPERUSER_USER" -O "$CRATE_POSTGRES_USER" crate_restore
   docker compose exec -T crate-postgres pg_restore -U "$CRATE_POSTGRES_USER" \
     -d crate_restore --no-owner --no-privileges --exit-on-error < crate.dump
   ```

4. Restore production with the stop-the-writers procedure in
   [Backup and recovery](ops-runbook.md#restore-procedure), then verify.

Snapshots made by the old `crate-backup-offsite` sidecar hold `/crate.sql.gz`, a
gzip-compressed plain SQL dump: `restic dump <id> /crate.sql.gz | gunzip | psql`
into an empty database, as `docs/operators/postgres-offsite-backups.md` describes.

## Alerts

The `backup_alerts` task runs every 5 minutes while backups are in use (the engine
on, a destination, or an alert still open). It raises an alert for:

- a destination failing its test, a copy or a check;
- a copy late: no good copy within 1.5 times the shortest interval of the
  destination's tiers (a weekly-only destination after 10.5 days);
- a failed verification or restore drill;
- a failed dump or local retention.

Each condition, a kind on one destination, keeps one open alert until it clears; it
keeps its id while it holds, and one that comes back is a new alert. The Backups
page shows the open ones, and the sidebar counts failing destinations.

Crate Operator pushes them. The Crate MCP serves the open alerts in
`get_observability_summary` as `sources.backup_alerts`, and the supervisor's
`backups/backup-alerts` digest sends each new one once, grouped by kind, at most one
message per kind every 30 minutes (see [Crate Operator](crate-operator.md)). The
source exists only while backups are in use (it is dropped a day after the last
run with no alert open), so the example configs ship the rule disabled. Once
backups run, enable it in `supervisor-config.json` (a setup rerun keeps your own
rules, so an existing install adds it by hand), check the config with
`python -m deploy.operator.server --config <path> --check` and restart the
supervisor:

```json
{
  "id": "backup-alerts",
  "subsystem": "backups",
  "tool": "get_observability_summary",
  "source_path": ["data", "sources", "backup_alerts"],
  "enabled": true,
  "kind": "digest",
  "field": ["rows"],
  "group_field": ["kind"],
  "row_fields": ["id", "kind", "level", "destination", "opened_at"],
  "fresh_seconds": 900,
  "cooldown_seconds": 1800
}
```

The task runs on the maintenance queue, so a long copy delays it until the copy
ends.

## Metrics

The same task records three gauges, exported to Prometheus when application metrics
are on:

| Metric                                        | Labels                | Meaning                                          |
| --------------------------------------------- | --------------------- | ------------------------------------------------ |
| `crate_backup_last_success_timestamp_seconds` | `destination`, `kind` | When the last good run of that kind finished     |
| `crate_backup_run_duration_seconds`           | `destination`, `kind` | How long that run took                           |
| `crate_backup_bytes`                          | `destination`         | Repository size, or the latest local dump's size |

`destination` is the provider kind (`s3`, `gdrive`...) or `dumps` for the local
dumps, never a destination's name; `kind` is `dump`, `local_retention`, `offsite`,
`verify` or `restore_drill`. Several destinations of one kind report the oldest
success, the longest run and the summed size. Grafana's **Workers and projector**
dashboard shows Backup age, Backup size and Backup run duration from the recording
rules in [Metrics reference](metrics-reference.md).

## Before upgrades

A manual policy marked "run before upgrades" is the deploy's safety copy.
`make deploy` runs it in the running `crate-maintenance-worker` after the release
preflight and before anything changes, and waits for the dump and every copy:

- it is skipped while that worker is not running or the engine is off in it, and
  does nothing without such a policy;
- a failed copy (exit 1) or a timeout (exit 2) stops the deploy with production
  untouched;
- `DEPLOY_BACKUP_TIMEOUT` bounds the wait (3 hours by default) and
  `DEPLOY_SKIP_BACKUP_BEFORE_UPGRADE=1` skips it for one deploy.

`make backup-before-upgrade` runs the same command by hand.

## Import an existing repository

Admin never takes a repository password: Crate generates one per destination. To
keep an existing restic repository, its history and its password, import it from
the maintenance worker:

```bash
docker exec -i crate-maintenance-worker python -m crate.backups.cli \
  import-destination --kind s3 --name "Cloudflare R2" \
  --endpoint https://<account id>.r2.cloudflarestorage.com --bucket <bucket> \
  --region auto --secrets-from stdin < secrets.json
```

- **Secrets** never go on the command line. They come from the environment
  (`--secrets-from env`, the default) or stdin (`--secrets-from stdin`: a JSON
  object, or `KEY=VALUE` lines as `env` prints them), under their own names
  (`repository_password`, `access_key_id`, `secret_access_key`, `key_id`,
  `application_key`, `client_secret`, `token`), as `CRATE_IMPORT_<NAME>`, or under
  the sidecar's names (`RESTIC_PASSWORD`, `CRATE_OFFSITE_R2_ACCESS_KEY_ID`,
  `CRATE_OFFSITE_R2_SECRET_ACCESS_KEY`, `RCLONE_CONFIG_GDRIVE_CLIENT_SECRET`,
  `RCLONE_CONFIG_GDRIVE_TOKEN`).
- `--from-sidecar` also reads the location the sidecar uses
  (`CRATE_OFFSITE_R2_ACCOUNT_ID`, `_BUCKET`, `_PATH`; `CRATE_OFFSITE_GDRIVE_PATH`,
  `RCLONE_CONFIG_GDRIVE_CLIENT_ID`, `_ROOT_FOLDER_ID`). Options on the command line
  win.
- It opens the repository (`restic cat config`), lists and sizes it before storing
  anything, and never initialises one. Then it stores the secrets encrypted, caches
  the listing for the snapshots tab, and queues a connection test (`--no-test`
  skips it).
- A destination with the same name or repository is not overwritten unless
  `--replace`; importing the same settings twice changes nothing.
- Exit codes: 0 imported or already imported, 1 the repository cannot be opened,
  2 invalid settings or missing secrets, 3 a destination already has this name or
  repository.
- Kinds: `s3`, `b2`, `gdrive`, `dropbox` and `local`. SFTP keys are generated by
  Crate, so an SFTP repository is added from Admin.

**Retention of the old snapshots (decision D6).** The engine prunes with
`restic forget --host crate --group-by host`. The sidecar's snapshots (host `crate`,
path `/crate.sql.gz`) are in the same group as the engine's (`/crate.dump`), so the
engine prunes them together: the old history thins out to the policy's counts. The
sidecar prunes with `--group-by host,paths` and never touches the engine's
snapshots. Restore drills use only `/crate.dump` snapshots.

## Move from the off-site sidecars

Production first ran `crate-postgres-backup` (daily `pg_dump`) and
`crate-backup-offsite` (restic to R2 and Google Drive). The move keeps both
repositories and runs the engine beside the sidecars for one weekly cycle:

1. Mount and point the backup directory: `CRATE_BACKUP_DIR=/backups`, then recreate
   `crate-worker`, `crate-fast-worker` and `crate-maintenance-worker`. Check the
   directory is writable from the maintenance worker.
2. Import both repositories from the sidecar's own environment, so no secret is
   typed or stored in a shell:

   ```bash
   docker exec crate-backup-offsite env | docker exec -i crate-maintenance-worker \
     python -m crate.backups.cli import-destination --kind s3 \
     --name "Cloudflare R2" --from-sidecar --secrets-from stdin
   docker exec crate-backup-offsite env | docker exec -i crate-maintenance-worker \
     python -m crate.backups.cli import-destination --kind gdrive \
     --name "Google Drive" --from-sidecar --secrets-from stdin
   ```

   Drive keeps the sidecar's OAuth client, because its token can only be refreshed
   with it. If that client is a "Desktop app", the import and the copies work, but
   **Connect** in Admin needs a Web client and a new token.

3. Download and confirm a new recovery kit.
4. Turn the engine on (`CRATE_LOCAL_BACKUPS_ENABLED=true`) and recreate the workers.
5. Create the policy that matches the sidecars, for example **Nightly**, daily at
   03:30 (away from the sidecar's pass after midnight): R2 daily, weekly and
   monthly, Drive weekly and monthly, keeping 7 daily, 4 weekly and 6 monthly
   copies. Set the local counts to 3, 4 and 3.
6. Run it in parallel for a week. Compare the snapshots of both writers on each
   destination, the sizes, one verification and one restore drill. Both write to
   the same repositories, so a copy can meet the other writer's lock once in a
   while; the next night retries it.
7. **Gate BG2.** Retire the sidecars: stop and remove `crate-backup-offsite`
   (profile `offsite-backup`) and `crate-postgres-backup`, then drop them from the
   compose files. Keep the `crate_postgres_backups` volume (it now holds the
   engine's dumps) and delete the sidecar's `daily/`, `weekly/`, `monthly/` and
   `last/` folders once they are no longer needed. Keep the restic password in the
   password manager: the repositories still use it.
