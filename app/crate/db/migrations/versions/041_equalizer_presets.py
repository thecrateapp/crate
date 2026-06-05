"""Add equalizer presets.

Revision ID: 041
Revises: 040
"""

from typing import Sequence, Union

from alembic import op


revision: str = "041"
down_revision: Union[str, None] = "040"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS equalizer_presets (
            id BIGSERIAL PRIMARY KEY,
            scope TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_entity_uid UUID NOT NULL,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            gains DOUBLE PRECISION[] NOT NULL,
            label TEXT NOT NULL DEFAULT '',
            reasoning TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT 'manual',
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK (scope IN ('user', 'instance')),
            CHECK (target_type IN ('track', 'album')),
            CHECK (
                (scope = 'user' AND user_id IS NOT NULL)
                OR (scope = 'instance' AND user_id IS NULL)
            )
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_equalizer_presets_user_target
        ON equalizer_presets(scope, target_type, target_entity_uid, user_id)
        WHERE scope = 'user'
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_equalizer_presets_instance_target
        ON equalizer_presets(scope, target_type, target_entity_uid)
        WHERE scope = 'instance'
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_equalizer_presets_target
        ON equalizer_presets(target_type, target_entity_uid)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_equalizer_presets_user
        ON equalizer_presets(user_id, updated_at DESC)
        WHERE user_id IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_equalizer_presets_user")
    op.execute("DROP INDEX IF EXISTS idx_equalizer_presets_target")
    op.execute("DROP INDEX IF EXISTS idx_equalizer_presets_instance_target")
    op.execute("DROP INDEX IF EXISTS idx_equalizer_presets_user_target")
    op.execute("DROP TABLE IF EXISTS equalizer_presets")
