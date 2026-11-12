"""The last snapshot listing of each backup destination (admin backups, BK4).

The API cannot run restic, so the worker stores what it saw: every connection
test, copy and verification replaces `snapshots_json` (newest first, at most 500
entries of id, time, host, tags and paths) and sets `snapshots_listed_at`. A failed
check keeps the last listing. Admin's snapshots tab reads it.
"""


def create_backup_destination_snapshots_v165_schema(cur) -> None:
    cur.execute("""
        ALTER TABLE backup_destinations
            ADD COLUMN IF NOT EXISTS snapshots_json JSONB NOT NULL DEFAULT '[]'::jsonb
                CHECK (jsonb_typeof(snapshots_json) = 'array'),
            ADD COLUMN IF NOT EXISTS snapshots_listed_at TIMESTAMPTZ
    """)


def drop_backup_destination_snapshots_v165_schema(cur) -> None:
    cur.execute(
        "ALTER TABLE backup_destinations DROP COLUMN IF EXISTS snapshots_listed_at, "
        "DROP COLUMN IF EXISTS snapshots_json"
    )


__all__ = [
    "create_backup_destination_snapshots_v165_schema",
    "drop_backup_destination_snapshots_v165_schema",
]
