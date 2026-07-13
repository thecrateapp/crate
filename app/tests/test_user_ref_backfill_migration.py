import importlib


def test_user_ref_backfill_version_migration_advances_the_projection_contract(
    monkeypatch,
):
    migration = importlib.import_module(
        "crate.db.migrations.versions.061_user_ref_backfill_version"
    )
    statements: list[str] = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.upgrade()

    assert migration.revision == "061"
    assert migration.down_revision == "060"
    assert "ADD COLUMN IF NOT EXISTS user_refs_backfill_version" in "\n".join(
        statements
    )
