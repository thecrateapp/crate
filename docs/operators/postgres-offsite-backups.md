# Off-site PostgreSQL backups

`crate-postgres-backup` keeps its dumps on the same server as the database (on
production, the `crate_crate_postgres_backups` volume on `/var`). They cover a
bad migration or a mistaken delete, not the loss of the host. The opt-in
`crate-backup-offsite` service copies them to two restic repositories off the
server:

- **Cloudflare R2** through restic's S3 backend;
- **Google Drive** through restic's `rclone:` backend, with rclone's Drive
  backend at scope `drive.file`, so rclone only sees files it created.

Both repositories use the same restic password. restic encrypts everything on
the client; R2 and Google only hold ciphertext.

## What it does

The service (`deploy/backup-offsite/`, image built on the host from pinned
restic and rclone releases) mounts the dumps read-only and wakes up every hour:

| When                         | What                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------- |
| A new ISO week's dump exists | Copy `weekly/crate-latest.sql.gz` to each repository, tag `weekly`               |
| A new month's dump exists    | Copy `monthly/crate-latest.sql.gz`, tag `monthly`, then `restic check` and drill |
| After every copy             | `restic forget --keep-weekly 4 --keep-monthly 6 --prune`                         |
| A copy, check or drill fails | The repository's state is not advanced, so the next hourly pass retries          |

Each snapshot holds one file, `/crate.sql.gz`, with the dump's own time and a
`dump:<file name>` tag. When fewer than 6 months exist, restic's monthly
policy also keeps the oldest snapshot.

**Restore drill.** It restores the newest snapshot into a temporary directory
in the container, runs `gzip -t`, starts a throwaway PostgreSQL 15 + pgvector
cluster in that directory, replays the dump's schema with the data (`COPY`
blocks) stripped, and compares the table count with the dump. The service is
on its own network and cannot reach `crate-postgres`.

**Health.** The container is unhealthy when the last pass failed or the loop
stopped; Grafana's container panels and `docker ps` show it.

## Set up

### Cloudflare R2

1. Create a bucket (for example `crate-backups`) in the Cloudflare dashboard.
2. Create an R2 API token with **Object Read & Write** limited to that bucket.
   Note the access key ID and secret, and the account ID.
3. Optionally add a lifecycle rule that deletes objects after a year as a guard
   against a runaway job; restic's own retention is the primary policy.

### Google Drive

rclone needs an OAuth token for scope `drive.file`. Prefer your own OAuth
client: rclone's shared one is rate-limited.

1. In Google Cloud Console, create a project, enable the Google Drive API and
   create an OAuth client of type **Desktop app**. On the consent screen, add
   the `drive.file` scope and **publish the app** (in Testing mode refresh
   tokens expire after 7 days; `drive.file` needs no Google verification).
2. On a machine with a browser:

   ```bash
   rclone authorize "drive" --drive-scope drive.file \
     --drive-client-id <client-id> --drive-client-secret <client-secret>
   ```

   It prints a token JSON. That token is the credential.

### Configure the server

Add to the production `.env` (mode `0600`). Never commit these values.

```bash
RESTIC_PASSWORD=<long random string; also store it in a password manager>
CRATE_OFFSITE_R2_ACCOUNT_ID=<account id>
CRATE_OFFSITE_R2_BUCKET=crate-backups
CRATE_OFFSITE_R2_ACCESS_KEY_ID=<key id>
CRATE_OFFSITE_R2_SECRET_ACCESS_KEY=<secret>
RCLONE_CONFIG_GDRIVE_TYPE=drive
RCLONE_CONFIG_GDRIVE_CLIENT_ID=<client id>
RCLONE_CONFIG_GDRIVE_CLIENT_SECRET=<client secret>
RCLONE_CONFIG_GDRIVE_TOKEN='<token JSON from rclone authorize>'
```

Optional: `CRATE_OFFSITE_R2_PATH` (a prefix inside the bucket),
`CRATE_OFFSITE_GDRIVE_PATH` (default `crate-backups`) and
`RCLONE_CONFIG_GDRIVE_ROOT_FOLDER_ID`. A repository is used only when its keys
are set, so either destination can run alone. Without the password the copies
cannot be read: losing it loses every off-site backup.

Build and start the service (the deploy ships its build context but does not
start it):

```bash
docker compose -f docker-compose.yaml -f docker-compose.project.yaml \
  --profile offsite-backup build crate-backup-offsite
docker compose -f docker-compose.yaml -f docker-compose.project.yaml \
  --profile offsite-backup up -d crate-backup-offsite
docker logs -f crate-backup-offsite
```

The first pass initialises both repositories, copies the current weekly and
monthly dumps and runs the drill. Self-hosted installs leave the profile off
and never build the image.

### Run things by hand

```bash
docker exec crate-backup-offsite crate-offsite snapshots   # repo, id, time, tags, bytes
docker exec crate-backup-offsite crate-offsite backup weekly
docker exec crate-backup-offsite crate-offsite check
docker exec crate-backup-offsite crate-offsite drill
```

## Rotate credentials

- **R2 token:** create a new token for the bucket, replace the two
  `CRATE_OFFSITE_R2_*_KEY*` values, `--profile offsite-backup up -d
crate-backup-offsite`, check `crate-offsite snapshots`, then delete the old
  token in Cloudflare.
- **Drive token:** run `rclone authorize` again, replace
  `RCLONE_CONFIG_GDRIVE_TOKEN`, recreate the service, and revoke the old grant
  at <https://myaccount.google.com/permissions> if it was compromised.
- **restic password:** in each repository add a key with the new password and
  remove the old key, then change `RESTIC_PASSWORD` and recreate the service:

  ```bash
  for repo in r2 gdrive; do
    docker exec -it crate-backup-offsite crate-offsite restic "$repo" key add
    docker exec crate-backup-offsite crate-offsite restic "$repo" key list
  done
  # after RESTIC_PASSWORD holds the new password and the service is recreated:
  docker exec crate-backup-offsite crate-offsite restic r2 key remove <old id>
  docker exec crate-backup-offsite crate-offsite restic gdrive key remove <old id>
  ```

  Update the password manager entry before removing the old key.

## Restore

From any machine with restic and rclone, or from the image itself
(`docker run --rm -it --entrypoint bash crate-backup-offsite:local`). Never
restore into the production database without the stop-the-writers procedure in
`docs/technical/ops-runbook.md`.

### From Cloudflare R2

```bash
export RESTIC_PASSWORD='<from the password manager>'
export AWS_ACCESS_KEY_ID='<R2 key id>' AWS_SECRET_ACCESS_KEY='<R2 secret>'
export AWS_DEFAULT_REGION=auto
REPO="s3:https://<account id>.r2.cloudflarestorage.com/crate-backups"
restic -r "$REPO" snapshots                        # pick an id, or use latest
restic -r "$REPO" dump latest /crate.sql.gz > crate.sql.gz
gzip -t crate.sql.gz
```

### From Google Drive

```bash
export RESTIC_PASSWORD='<from the password manager>'
export RCLONE_CONFIG_GDRIVE_TYPE=drive RCLONE_CONFIG_GDRIVE_SCOPE=drive.file
export RCLONE_CONFIG_GDRIVE_CLIENT_ID='<client id>'
export RCLONE_CONFIG_GDRIVE_CLIENT_SECRET='<client secret>'
export RCLONE_CONFIG_GDRIVE_TOKEN='<token JSON>'
REPO="rclone:gdrive:crate-backups"
restic -r "$REPO" snapshots
restic -r "$REPO" dump latest /crate.sql.gz > crate.sql.gz
gzip -t crate.sql.gz
```

The Drive token only reaches files rclone created with that OAuth client, so
keep the client ID and secret with the token.

### Load the dump

The file is the same gzip-compressed plain SQL dump `crate-postgres-backup`
writes. Follow the restore procedure in `docs/technical/ops-runbook.md`: stop
the writers, create an empty database, load it with
`gunzip -c crate.sql.gz | psql -v ON_ERROR_STOP=1 ...` (rehearse into
`crate_restore` first), start the stack and verify. The deployment `.env` is not
in these repositories; keep its secrets in the password manager as well.

## Test

`deploy/backup-offsite/test.sh` runs inside the image against local restic
repositories, a MinIO standing in for R2 and an rclone `local` remote standing
in for Drive: copy, idempotent passes, retention, check, byte-identical
restore, drills that reject corrupt dumps, a failing repository that does not
block the other, and no secret in the output. CI runs it in
`.github/workflows/test-backup-offsite.yml`.
