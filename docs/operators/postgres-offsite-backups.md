# Off-site PostgreSQL backups (proposal)

Status: proposal, not implemented. The operator picks the destination first.

`crate-postgres-backup` keeps its dumps on the same server as the database (on
production, the `crate_crate_postgres_backups` volume on `/var`). They protect
against a bad migration or a mistaken delete, not against losing the host,
its disks or the account. A weekly copy off the server closes that gap.

## What to copy

Once a week, after the nightly dump (for example Monday 03:00), copy
`weekly/crate-latest.sql.gz` (the newest weekly dump, about 1.5 GB at `-Z6`)
together with a copy of the production `.env`, whose encryption, JWT, Redis and
readplane secrets a restore needs. Keep 4 to 8 weeks at the destination. The
dump and the `.env` both hold credentials, so the copy must be encrypted at rest
or kept on a disk only the operator controls.

The job runs on the host as `crate` from a systemd timer (or cron) and reads the
volume through a throwaway container, so it needs no change to the stack:

```bash
docker run --rm -v crate_crate_postgres_backups:/backups:ro alpine \
  cat /backups/weekly/crate-latest.sql.gz > "$STAGING/crate-$(date +%G%V).sql.gz"
gzip -t "$STAGING/crate-$(date +%G%V).sql.gz"
```

`$STAGING` sits on `/var`, not on `/`, and is removed after the upload.

## Option A: Home server over SSH and rsync

- **Destination:** a machine at home with a disk for backups, reachable over SSH
  (directly, or through WireGuard or Tailscale when it sits behind NAT).
- **Credentials:** an SSH key pair for `crate` on production; the public key goes
  in the Home user's `authorized_keys` restricted with
  `command="rrsync -wo /srv/backups/crate",restrict`, so the key can only write
  into that folder. The Home host key goes in production's `known_hosts`.
- **Copy:** `rsync -t --partial <file> home:/` (paths are relative to the
  `rrsync` root); the key cannot run anything else. Retention runs on the
  Home side (`find -mtime +56 -delete` in its own timer), so production never
  holds a key that can delete off-site copies.
- **Encryption:** the Home disk should be encrypted (LUKS). Optionally encrypt
  the file before upload with `age` and keep the private key off the server.
- **Cost:** none beyond the disk; depends on home uptime and upstream bandwidth
  (1.5 GB a week).

## Option B: object storage with restic

- **Destination:** an S3-compatible bucket (Hetzner Object Storage in the same
  provider but another location, Backblaze B2, or similar).
- **Credentials:** an access key limited to that bucket, and a restic repository
  password. Both live in a root-only file on production (for example
  `/etc/crate-backup/restic.env`, mode `0600`) and the restic password also
  goes in Diego's password manager: without it the repository cannot be read.
  If the provider supports it, use object lock or a write-only key so a
  compromised server cannot delete history.
- **Copy:** `restic backup --stdin --stdin-filename crate.sql.gz` fed from the
  volume, plus the `.env`; then `restic forget --keep-weekly 8 --prune` (from a
  separate machine when the server key is write-only).
- **Encryption:** restic encrypts client-side; the provider sees only ciphertext.
  Deduplication saves little on gzip dumps, so plan for about 1.5 GB per week
  kept.
- **Cost:** a few euros a month for about 12 GB.

## Restore from the off-site copy

1. Fetch the dump: `rsync home:/crate-YYYYWW.sql.gz .` (option A), or
   `restic restore latest --target ./restore` (option B). Fetch the `.env` too.
2. Check it: `gzip -t crate-YYYYWW.sql.gz`.
3. Follow the restore procedure in `docs/technical/ops-runbook.md`: stop the
   writers, load the dump into an empty database (rehearse into
   `crate_restore` first), start the stack and verify.
4. Rehearse this once after the job is set up, and then every quarter, into a
   scratch database or a spare machine.

## Decisions needed before implementing

- Destination: Home over SSH (A) or object storage (B), and which provider.
- For A: the Home host, how production reaches it, and the target folder.
- For B: the bucket, region, and whether object lock or a write-only key is used.
- Who keeps the restic password or `age` key outside the server.
- How many weeks to keep off-site, and where job failures are reported
  (Sentry cron monitor, email or the existing Grafana).
