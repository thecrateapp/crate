"""Self-service account data export and deletion.

`user_data_exports` tracks one export request per row. A worker task builds
the archive into the download cache under the row id and marks the row
`ready` with an `expires_at`; the cleanup task expires rows past that time and
removes their files. The row never stores the archive itself.

`sessions.authenticated_at` records when the user last proved their identity
on that session (a login, OAuth callback or native exchange). Refreshing an
access token keeps it unchanged, so account deletion for accounts without a
password can require a recent sign-in on the same session.
"""

ACCOUNT_DATA_STATEMENTS = (
    "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS authenticated_at TIMESTAMPTZ",
    "UPDATE sessions SET authenticated_at = created_at WHERE authenticated_at IS NULL",
    """
    CREATE TABLE IF NOT EXISTS user_data_exports (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'ready', 'failed', 'expired')),
        task_id TEXT,
        filename TEXT,
        bytes BIGINT,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_user_data_exports_user_created
        ON user_data_exports (user_id, created_at DESC)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_user_data_exports_ready_expiry
        ON user_data_exports (expires_at)
        WHERE status = 'ready'
    """,
)


def create_account_data_v168_schema(cur) -> None:
    for statement in ACCOUNT_DATA_STATEMENTS:
        cur.execute(statement)


def drop_account_data_v168_schema(cur) -> None:
    cur.execute("DROP TABLE IF EXISTS user_data_exports")
    cur.execute("ALTER TABLE sessions DROP COLUMN IF EXISTS authenticated_at")


__all__ = [
    "ACCOUNT_DATA_STATEMENTS",
    "create_account_data_v168_schema",
    "drop_account_data_v168_schema",
]
