"""Backup destinations: where the backups engine sends its copies (admin backups, BK2).

One row per restic repository: a folder of the backup volume (`local`), an
S3-compatible bucket (`s3`: Cloudflare R2, Wasabi, MinIO, Hetzner), Backblaze B2
(`b2`), an SSH server (`sftp`), Google Drive (`gdrive`) or Dropbox (`dropbox`).

- `config_json` holds only what is safe to show: bucket, endpoint, region, path,
  host, user, an OAuth client ID, the SSH public key and host key.
- Secrets live in `credential_secrets` (`crate.credentials`), encrypted with
  `CRATE_CREDENTIAL_KEY`: `secret_ref` points at the provider credentials (access
  keys, SSH private key, OAuth client secret and token), `repo_password_ref` at the
  restic repository password Crate generates for each destination.
- `status` is what the last connection test found; `snapshot_count` and
  `repository_bytes` what the last good one or the last copy saw.
- `recovery_kit_*` record when the kit with this destination's password was last
  downloaded and when the operator confirmed it is stored off the server.
"""

V163_KINDS = "'local', 's3', 'b2', 'sftp', 'gdrive', 'dropbox'"
V163_STATUSES = "'untested', 'ok', 'failing', 'unavailable'"


def create_backup_destinations_v163_schema(cur) -> None:
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS backup_destinations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            kind TEXT NOT NULL CHECK (kind IN ({V163_KINDS})),
            name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
            config_json JSONB NOT NULL DEFAULT '{{}}'::jsonb
                CHECK (jsonb_typeof(config_json) = 'object'),
            secret_ref TEXT REFERENCES credential_secrets(secret_ref)
                ON DELETE RESTRICT,
            repo_password_ref TEXT NOT NULL REFERENCES credential_secrets(secret_ref)
                ON DELETE RESTRICT,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            status TEXT NOT NULL DEFAULT 'untested'
                CHECK (status IN ({V163_STATUSES})),
            last_checked_at TIMESTAMPTZ,
            last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 2000),
            repository_initialized_at TIMESTAMPTZ,
            snapshot_count INTEGER CHECK (snapshot_count IS NULL OR snapshot_count >= 0),
            repository_bytes BIGINT
                CHECK (repository_bytes IS NULL OR repository_bytes >= 0),
            recovery_kit_downloaded_at TIMESTAMPTZ,
            recovery_kit_confirmed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    cur.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_backup_destinations_name
        ON backup_destinations (lower(name))
    """)


def drop_backup_destinations_v163_schema(cur) -> None:
    cur.execute("DROP TABLE IF EXISTS backup_destinations")


__all__ = [
    "V163_KINDS",
    "V163_STATUSES",
    "create_backup_destinations_v163_schema",
    "drop_backup_destinations_v163_schema",
]
