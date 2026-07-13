import importlib


def _migration_module():
    return importlib.import_module(
        "crate.db.migrations.versions.058_node_first_catalog_state"
    )


def test_node_first_catalog_state_migration_follows_global_catalog_refs():
    migration = _migration_module()

    assert migration.revision == "058"
    assert migration.down_revision == "057"


def test_node_first_catalog_state_upgrade_creates_state_and_claim_index(monkeypatch):
    migration = _migration_module()
    statements: list[str] = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.upgrade()

    sql = "\n".join(statements)
    assert "CREATE TABLE IF NOT EXISTS global_catalog_state" in sql
    assert "CREATE TABLE IF NOT EXISTS global_catalog_dirty_sources" in sql
    assert "idx_global_catalog_dirty_sources_pending" in sql
    assert "WHERE completed_at IS NULL" in sql
    assert "INSERT INTO global_catalog_state" in sql
    assert "global_catalog_dirty_sources_local_ref_check" in sql
    assert "global_catalog_dirty_sources_federated_ref_check" in sql
