from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "app/crate/db/migrations/versions/079_album_release_group_types.py"


def test_release_type_migration_is_revision_079():
    migration = MIGRATION.read_text()

    assert 'revision = "079"' in migration
    assert 'down_revision = "078"' in migration


def test_release_type_migration_covers_local_and_global_catalogs():
    migration = MIGRATION.read_text()

    assert '("library_albums", "global_catalog_albums")' in migration
    assert '"release_group_primary_type TEXT"' in migration
    assert '"release_group_secondary_types JSONB"' in migration
