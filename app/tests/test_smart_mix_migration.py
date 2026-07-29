from __future__ import annotations

from pathlib import Path

from sqlalchemy import text

from crate.db.tx import read_scope

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    ROOT
    / "app"
    / "crate"
    / "db"
    / "migrations"
    / "versions"
    / "082_smart_mix_profiles.py"
)


def test_migration_contract_is_isolated_from_library_tracks() -> None:
    source = MIGRATION.read_text()

    assert 'revision = "082"' in source
    assert 'down_revision = "081"' in source
    assert 'has_table("track_mix_profiles")' in source
    assert "CREATE INDEX IF NOT EXISTS" in source
    assert '"track_mix_profiles"' in source
    for column in (
        "track_id",
        "profile_version",
        "profile_revision",
        "analyzer",
        "analyzer_version",
        "source_revision",
        "quality",
        "beat_grid_format",
        "beat_grid_data",
        "key_camelot",
        "analyzed_at",
        "updated_at",
    ):
        assert f'"{column}"' in source
    assert 'op.add_column("library_tracks"' not in source
    assert 'op.drop_table("track_mix_profiles")' in source


def test_bootstrap_table_has_constraints_and_coverage_indexes(pg_db) -> None:
    del pg_db

    with read_scope() as session:
        columns = {
            row[0]
            for row in session.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = current_schema()
                      AND table_name = 'track_mix_profiles'
                    """
                )
            )
        }
        indexes = {
            row[0]
            for row in session.execute(
                text(
                    """
                    SELECT indexname
                    FROM pg_indexes
                    WHERE schemaname = current_schema()
                      AND tablename = 'track_mix_profiles'
                    """
                )
            )
        }
        constraints = "\n".join(
            row[0]
            for row in session.execute(
                text(
                    """
                    SELECT pg_get_constraintdef(oid)
                    FROM pg_constraint
                    WHERE conrelid = 'track_mix_profiles'::regclass
                    """
                )
            )
        )

    assert {
        "track_id",
        "quality",
        "beat_grid_data",
        "profile_revision",
        "source_revision",
    } <= columns
    assert {
        "idx_track_mix_profiles_quality",
        "idx_track_mix_profiles_profile_revision",
        "idx_track_mix_profiles_analyzer_version",
        "idx_track_mix_profiles_updated_at",
        "idx_track_mix_profiles_source_revision",
        "idx_track_mix_profiles_pending",
    } <= indexes
    assert "quality" in constraints
    assert "bpm_confidence" in constraints
    assert "key_confidence" in constraints
