from importlib import import_module


class _Executor:
    def __init__(self):
        self.statements = []

    def execute(self, statement):
        self.statements.append(statement)


def test_publication_migration_uses_shared_additive_schema(monkeypatch):
    migration = import_module(
        "crate.db.migrations.versions.159_federation_catalog_publication"
    )
    schema = import_module(
        "crate.db.schema_sections.federation_catalog_publication_v159"
    )
    actual, expected = _Executor(), _Executor()
    monkeypatch.setattr(migration, "op", actual)
    migration.upgrade()
    schema.create_federation_catalog_publication_v159_schema(expected)
    assert migration.down_revision == "158"
    assert actual.statements == expected.statements
    assert "DROP CONSTRAINT" not in "\n".join(actual.statements)


def test_publication_downgrade_flushes_intents_and_preserves_recovery_boundary(
    monkeypatch,
):
    migration = import_module(
        "crate.db.migrations.versions.159_federation_catalog_publication"
    )
    actual = _Executor()
    monkeypatch.setattr(migration, "op", actual)
    migration.downgrade()
    sql = "\n".join(actual.statements)
    assert sql.index("INSERT INTO federation_catalog_changes") < sql.index(
        "DROP TABLE IF EXISTS federation_catalog_change_outbox"
    )
    assert "DROP TABLE IF EXISTS federation_catalog_feed_state" not in sql
