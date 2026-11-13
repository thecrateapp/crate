"""Backup runs: every job of the backups engine, whatever it did (admin backups, BK1).

BK1 writes `dump` (a `pg_dump -Fc` of the Crate database into the local backup
directory) and `local_retention` (grandfather-father-son pruning of those dumps).
The other kinds are reserved for BK3 (`offsite`, `verify`, `restore_drill`), which
adds `policy_id` and `destination_id` together with their tables.

- `path` is relative to the backup directory; `checksum` is the dump's SHA-256.
- `error` holds a short message Crate writes, never the command line or its
  environment (the database password travels in the environment).
- `details` keeps what the job decided, for example the dumps retention kept and
  deleted.
- A run left `running` by a killed worker is closed as `failed` by the next run of
  the same kind, which holds the backup lock.
"""

V162_KINDS = "'dump', 'local_retention', 'offsite', 'verify', 'restore_drill'"
V162_STATUSES = "'running', 'succeeded', 'failed'"


def create_backup_runs_v162_schema(cur) -> None:
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS backup_runs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            kind TEXT NOT NULL CHECK (kind IN ({V162_KINDS})),
            status TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ({V162_STATUSES})),
            task_id TEXT CHECK (task_id IS NULL OR length(task_id) <= 128),
            started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            finished_at TIMESTAMPTZ,
            path TEXT CHECK (path IS NULL OR length(path) <= 1024),
            bytes BIGINT CHECK (bytes IS NULL OR bytes >= 0),
            checksum TEXT CHECK (checksum IS NULL OR checksum ~ '^[0-9a-f]{{64}}$'),
            snapshot_id TEXT CHECK (snapshot_id IS NULL OR length(snapshot_id) <= 128),
            error TEXT CHECK (error IS NULL OR length(error) <= 2000),
            details JSONB NOT NULL DEFAULT '{{}}'::jsonb,
            CHECK ((status = 'running') = (finished_at IS NULL))
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_backup_runs_kind_started
        ON backup_runs (kind, started_at DESC)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_backup_runs_running
        ON backup_runs (kind)
        WHERE status = 'running'
    """)


def drop_backup_runs_v162_schema(cur) -> None:
    cur.execute("DROP TABLE IF EXISTS backup_runs")


__all__ = [
    "V162_KINDS",
    "V162_STATUSES",
    "create_backup_runs_v162_schema",
    "drop_backup_runs_v162_schema",
]
