"""Add versioned Smart Mix analysis profiles."""

from alembic import op
import sqlalchemy as sa


revision = "082"
down_revision = "081"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not sa.inspect(op.get_bind()).has_table("track_mix_profiles"):
        op.create_table(
            "track_mix_profiles",
            sa.Column(
                "track_id",
                sa.BIGINT(),
                sa.ForeignKey("library_tracks.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("profile_version", sa.Integer(), nullable=False),
            sa.Column("profile_revision", sa.Text(), nullable=False),
            sa.Column("analyzer", sa.Text(), nullable=False),
            sa.Column("analyzer_version", sa.Text(), nullable=False),
            sa.Column("source_revision", sa.Text(), nullable=False),
            sa.Column("quality", sa.Text(), nullable=False),
            sa.Column("bpm", sa.Float(), nullable=True),
            sa.Column("bpm_confidence", sa.Float(), nullable=True),
            sa.Column("tempo_stability", sa.Float(), nullable=True),
            sa.Column("beat_anchor_ms", sa.BIGINT(), nullable=True),
            sa.Column("downbeat_anchor_ms", sa.BIGINT(), nullable=True),
            sa.Column("time_signature", sa.SmallInteger(), nullable=True),
            sa.Column("beat_grid_format", sa.Text(), nullable=True),
            sa.Column("beat_grid_data", sa.LargeBinary(), nullable=True),
            sa.Column("audio_key", sa.Text(), nullable=True),
            sa.Column("audio_scale", sa.Text(), nullable=True),
            sa.Column("key_camelot", sa.Text(), nullable=True),
            sa.Column("key_confidence", sa.Float(), nullable=True),
            sa.Column("intro_cue_ms", sa.BIGINT(), nullable=True),
            sa.Column("outro_cue_ms", sa.BIGINT(), nullable=True),
            sa.Column("intro_lufs", sa.Float(), nullable=True),
            sa.Column("outro_lufs", sa.Float(), nullable=True),
            sa.Column("true_peak_dbfs", sa.Float(), nullable=True),
            sa.Column("intro_energy", sa.Float(), nullable=True),
            sa.Column("outro_energy", sa.Float(), nullable=True),
            sa.Column("intro_spectral_density", sa.Float(), nullable=True),
            sa.Column("outro_spectral_density", sa.Float(), nullable=True),
            sa.Column("global_energy", sa.Float(), nullable=True),
            sa.Column("danceability", sa.Float(), nullable=True),
            sa.Column("valence", sa.Float(), nullable=True),
            sa.Column("bliss_vector_revision", sa.Text(), nullable=True),
            sa.Column("analyzed_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
            sa.CheckConstraint(
                "quality IN ('full', 'partial', 'legacy', 'unavailable')",
                name="ck_track_mix_profiles_quality",
            ),
            sa.CheckConstraint(
                "profile_version > 0",
                name="ck_track_mix_profiles_profile_version",
            ),
            sa.CheckConstraint(
                "bpm_confidence IS NULL OR bpm_confidence BETWEEN 0 AND 1",
                name="ck_track_mix_profiles_bpm_confidence",
            ),
            sa.CheckConstraint(
                "tempo_stability IS NULL OR tempo_stability BETWEEN 0 AND 1",
                name="ck_track_mix_profiles_tempo_stability",
            ),
            sa.CheckConstraint(
                "key_confidence IS NULL OR key_confidence BETWEEN 0 AND 1",
                name="ck_track_mix_profiles_key_confidence",
            ),
            sa.CheckConstraint(
                "beat_anchor_ms IS NULL OR beat_anchor_ms >= 0",
                name="ck_track_mix_profiles_beat_anchor",
            ),
            sa.CheckConstraint(
                "downbeat_anchor_ms IS NULL OR downbeat_anchor_ms >= 0",
                name="ck_track_mix_profiles_downbeat_anchor",
            ),
            sa.CheckConstraint(
                "intro_cue_ms IS NULL OR intro_cue_ms >= 0",
                name="ck_track_mix_profiles_intro_cue",
            ),
            sa.CheckConstraint(
                "outro_cue_ms IS NULL OR outro_cue_ms >= 0",
                name="ck_track_mix_profiles_outro_cue",
            ),
            sa.CheckConstraint(
                "(beat_grid_format IS NULL) = (beat_grid_data IS NULL)",
                name="ck_track_mix_profiles_beat_grid_pair",
            ),
        )

    for statement in (
        """
        CREATE INDEX IF NOT EXISTS idx_track_mix_profiles_quality
        ON track_mix_profiles(quality)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_track_mix_profiles_profile_revision
        ON track_mix_profiles(profile_revision)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_track_mix_profiles_analyzer_version
        ON track_mix_profiles(analyzer_version)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_track_mix_profiles_updated_at
        ON track_mix_profiles(updated_at DESC)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_track_mix_profiles_source_revision
        ON track_mix_profiles(source_revision)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_track_mix_profiles_pending
        ON track_mix_profiles(updated_at DESC)
        WHERE quality <> 'full'
        """,
    ):
        op.execute(statement)


def downgrade() -> None:
    op.drop_table("track_mix_profiles")
