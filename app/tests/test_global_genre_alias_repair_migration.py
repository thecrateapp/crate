from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION_PATH = (
    ROOT
    / "app/crate/db/migrations/versions/078_repair_global_genre_alias_assertions.py"
)


def test_global_genre_alias_repair_migration_is_revision_078() -> None:
    migration = MIGRATION_PATH.read_text()

    assert 'revision = "078"' in migration
    assert 'down_revision = "077"' in migration


def test_global_genre_alias_repair_migration_is_scoped_and_set_based() -> None:
    migration = MIGRATION_PATH.read_text()

    assert "mapping_method IN ('local_alias', 'receiver_mapping')" in migration
    assert "alias.origin <> 'legacy'" not in migration
    assert "UPDATE global_catalog_genre_assertions" in migration
    assert "DELETE FROM global_catalog_entity_genres" in migration
    assert "INSERT INTO global_catalog_entity_genres" in migration
    assert "CREATE TEMP TABLE crate_stale_genre_alias_assertions" in migration
    assert "SELECT DISTINCT entity_type, global_entity_uid" in migration
