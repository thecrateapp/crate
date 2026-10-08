"""Add generated Cast spectrum artefacts.

Revision ID: 096
Revises: 095
"""

from alembic import op


revision = "096"
down_revision = "095"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE cast_spectrum_artifacts (
            track_id INTEGER PRIMARY KEY
                REFERENCES library_tracks(id) ON DELETE CASCADE,
            source_fingerprint TEXT NOT NULL,
            format_version SMALLINT NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'pending',
            generation_token UUID,
            artifact_path TEXT,
            artifact_etag TEXT,
            sample_interval_ms INTEGER,
            band_count SMALLINT,
            frame_count INTEGER,
            duration_ms INTEGER,
            byte_size INTEGER,
            failure_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            claimed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_cast_spectrum_fingerprint
                CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
            CONSTRAINT ck_cast_spectrum_version
                CHECK (format_version = 1),
            CONSTRAINT ck_cast_spectrum_status
                CHECK (status IN ('pending', 'generating', 'ready', 'failed')),
            CONSTRAINT ck_cast_spectrum_generation_claim
                CHECK (
                    (status = 'generating' AND generation_token IS NOT NULL AND claimed_at IS NOT NULL)
                    OR
                    (status <> 'generating' AND generation_token IS NULL AND claimed_at IS NULL)
                ),
            CONSTRAINT ck_cast_spectrum_ready_metadata
                CHECK (
                    status <> 'ready'
                    OR (
                        artifact_path IS NOT NULL
                        AND artifact_etag IS NOT NULL
                        AND sample_interval_ms = 100
                        AND band_count = 24
                        AND frame_count >= 0
                        AND duration_ms >= 0
                        AND byte_size > 0
                    )
                ),
            CONSTRAINT ck_cast_spectrum_failure_count
                CHECK (failure_count >= 0),
            CONSTRAINT ck_cast_spectrum_path_length
                CHECK (artifact_path IS NULL OR length(artifact_path) <= 512),
            CONSTRAINT ck_cast_spectrum_error_length
                CHECK (last_error IS NULL OR length(last_error) <= 1000)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX idx_cast_spectrum_artifacts_status_updated
        ON cast_spectrum_artifacts(status, updated_at)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_cast_spectrum_artifacts_status_updated")
    op.execute("DROP TABLE IF EXISTS cast_spectrum_artifacts")
