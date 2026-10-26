"""Private, expiring image staging and a closed extraction command."""

PREVIOUS_OPERATIONS = "'run_health_check','apply_repairs','retry_job','prepare_operation','apply_operation'"


def create_show_extraction_v119_schema(cur):
    for table in ("agent_jobs", "agent_requests"):
        cur.execute(
            f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {table}_operation_check"
        )
        cur.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT {table}_operation_check CHECK(operation IN ({PREVIOUS_OPERATIONS},'extract_shows'))"
        )
    cur.execute("""CREATE TABLE IF NOT EXISTS show_image_uploads (
        id UUID PRIMARY KEY, actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content BYTEA NOT NULL CHECK(octet_length(content)<=8388608), media_type TEXT NOT NULL,
        sha256 TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '24 hours')""")
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_show_image_uploads_actor ON show_image_uploads(actor_user_id,expires_at)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_show_extraction_drafts_actor ON show_extraction_drafts(actor_user_id,expires_at)"
    )


__all__ = ["create_show_extraction_v119_schema"]
