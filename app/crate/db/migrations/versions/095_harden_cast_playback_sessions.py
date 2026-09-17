"""Harden Cast session authority and idempotency.

Revision ID: 095
Revises: 094
"""

from alembic import op


revision = "095"
down_revision = "094"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE cast_playback_sessions "
        "ADD COLUMN state_seq BIGINT NOT NULL DEFAULT 0"
    )
    op.execute("ALTER TABLE cast_playback_sessions DROP COLUMN last_mutation_id")
    op.execute(
        """
        ALTER TABLE cast_playback_sessions
        ADD CONSTRAINT ck_cast_playback_sessions_state_seq
            CHECK (state_seq >= 0),
        ADD CONSTRAINT ck_cast_playback_sessions_protocol_version
            CHECK (protocol_version = 1),
        ADD CONSTRAINT ck_cast_playback_sessions_capabilities_object
            CHECK (jsonb_typeof(capabilities_json) = 'object'),
        ADD CONSTRAINT ck_cast_playback_sessions_appearance_object
            CHECK (jsonb_typeof(appearance_json) = 'object'),
        ADD CONSTRAINT ck_cast_playback_sessions_queue_array
            CHECK (
                jsonb_typeof(queue_json) = 'array'
                AND jsonb_array_length(queue_json) <= 1000
            ),
        ADD CONSTRAINT ck_cast_playback_sessions_target_length
            CHECK (target_device_id IS NULL OR length(target_device_id) <= 160)
        """
    )
    op.execute(
        """
        CREATE TABLE cast_playback_session_mutations (
            session_id UUID NOT NULL
                REFERENCES cast_playback_sessions(session_id) ON DELETE CASCADE,
            mutation_id TEXT NOT NULL,
            applied_revision BIGINT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (session_id, mutation_id),
            CONSTRAINT ck_cast_playback_session_mutation_id_length
                CHECK (length(mutation_id) BETWEEN 1 AND 160),
            CONSTRAINT ck_cast_playback_session_mutation_revision
                CHECK (applied_revision >= 0)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_cast_playback_session_mutations_created
        ON cast_playback_session_mutations(created_at)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_cast_playback_session_mutations_created")
    op.execute("DROP TABLE IF EXISTS cast_playback_session_mutations")
    op.execute(
        """
        ALTER TABLE cast_playback_sessions
        DROP CONSTRAINT IF EXISTS ck_cast_playback_sessions_target_length,
        DROP CONSTRAINT IF EXISTS ck_cast_playback_sessions_queue_array,
        DROP CONSTRAINT IF EXISTS ck_cast_playback_sessions_appearance_object,
        DROP CONSTRAINT IF EXISTS ck_cast_playback_sessions_capabilities_object,
        DROP CONSTRAINT IF EXISTS ck_cast_playback_sessions_protocol_version,
        DROP CONSTRAINT IF EXISTS ck_cast_playback_sessions_state_seq,
        DROP COLUMN IF EXISTS state_seq,
        ADD COLUMN last_mutation_id TEXT
        """
    )
