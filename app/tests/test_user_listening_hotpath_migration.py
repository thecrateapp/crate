from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    ROOT / "app/crate/db/migrations/versions/080_user_listening_hotpath_indexes.py"
)


def test_user_listening_hotpath_migration_adds_metadata_fallback_index():
    migration = MIGRATION.read_text()

    assert 'revision = "080"' in migration
    assert 'down_revision = "079"' in migration
    assert "idx_global_tracks_lower_artist_title_album" in migration
    assert "LOWER(artist_name)" in migration
    assert "LOWER(canonical_title)" in migration
    assert "LOWER(COALESCE(album_name, ''))" in migration
    assert (
        "DROP INDEX IF EXISTS idx_global_tracks_lower_artist_title_album" in migration
    )
