"""Add generic recommendation feedback and exposure tables.

Revision ID: 047
Revises: 046
"""

from typing import Sequence, Union

from alembic import op


revision: str = "047"
down_revision: Union[str, None] = "046"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_recommendation_feedback (
            id BIGSERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            surface TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_key TEXT NOT NULL,
            action TEXT NOT NULL,
            strength DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            reason TEXT,
            metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(user_id, surface, entity_type, entity_key, action)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_recommendation_feedback_lookup
        ON user_recommendation_feedback(user_id, surface, entity_type, entity_key)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_recommendation_feedback_active
        ON user_recommendation_feedback(user_id, surface, entity_type, entity_key, action, expires_at)
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_recommendation_exposures (
            id BIGSERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            surface TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_key TEXT NOT NULL,
            shown_on DATE NOT NULL,
            shown_count INTEGER NOT NULL DEFAULT 1,
            acted_at TIMESTAMPTZ,
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(user_id, surface, entity_type, entity_key, shown_on)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_recommendation_exposures_lookup
        ON user_recommendation_exposures(user_id, surface, entity_type, entity_key, shown_on DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_user_recommendation_exposures_expiry
        ON user_recommendation_exposures(expires_at)
        WHERE expires_at IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_user_recommendation_exposures_expiry")
    op.execute("DROP INDEX IF EXISTS idx_user_recommendation_exposures_lookup")
    op.execute("DROP TABLE IF EXISTS user_recommendation_exposures")
    op.execute("DROP INDEX IF EXISTS idx_user_recommendation_feedback_active")
    op.execute("DROP INDEX IF EXISTS idx_user_recommendation_feedback_lookup")
    op.execute("DROP TABLE IF EXISTS user_recommendation_feedback")
