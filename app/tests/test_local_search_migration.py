from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "app/crate/db/migrations/versions/071_local_search_indexes.py"
SCHEMA_SECTION = ROOT / "app/crate/db/schema_sections/library_catalog.py"


def test_local_search_migration_adds_missing_trigram_indexes_concurrently():
    source = MIGRATION.read_text(encoding="utf-8")

    assert 'revision = "071"' in source
    assert 'down_revision = "070"' in source
    assert source.count("CREATE INDEX CONCURRENTLY IF NOT EXISTS") == 4
    assert "ON library_artists USING gin(name gin_trgm_ops)" in source
    assert "ON library_albums USING gin(name gin_trgm_ops)" in source
    assert "ON library_tracks USING gin(title gin_trgm_ops)" in source
    assert "ON library_tracks USING gin(album gin_trgm_ops)" in source


def test_local_search_migration_is_reversible_without_blocking_table_writes():
    source = MIGRATION.read_text(encoding="utf-8")

    assert "autocommit_block()" in source
    assert source.count("DROP INDEX CONCURRENTLY IF EXISTS") == 4


def test_fresh_schema_includes_track_album_trigram_index():
    source = SCHEMA_SECTION.read_text(encoding="utf-8")

    assert (
        "CREATE INDEX IF NOT EXISTS idx_tracks_album_trgm "
        "ON library_tracks USING gin(album gin_trgm_ops)"
    ) in source
