from __future__ import annotations

import importlib


def _migration():
    return importlib.import_module(
        "crate.db.migrations.versions.066_federation_catalog_change_log"
    )


def test_catalog_delta_migration_has_durable_order_and_resume_state(monkeypatch):
    migration = _migration()
    statements: list[str] = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.upgrade()

    sql = "\n".join(statements)
    assert migration.revision == "066"
    assert migration.down_revision == "065"
    assert "CREATE TABLE federation_catalog_changes" in sql
    assert "sequence BIGSERIAL PRIMARY KEY" in sql
    assert "UNIQUE (entity_type, entity_uid, payload_revision, operation)" in sql
    assert "idx_federation_catalog_changes_entity" in sql
    assert "retention_until" in sql
    for column in (
        "last_applied_cursor",
        "snapshot_cursor",
        "sync_session_uid",
        "last_full_verified_at",
        "consecutive_failures",
        "retry_after",
    ):
        assert column in sql
    assert "last_seen_sync_session_uid" in sql


def test_catalog_delta_migration_downgrade_is_complete(monkeypatch):
    migration = _migration()
    statements: list[str] = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.downgrade()

    sql = "\n".join(statements)
    assert "DROP TABLE IF EXISTS federation_catalog_changes" in sql
    assert "DROP COLUMN IF EXISTS last_applied_cursor" in sql


def test_catalog_change_orm_matches_migration():
    from crate.db.orm.federation import FederationCatalogChange

    assert FederationCatalogChange.__tablename__ == "federation_catalog_changes"
    assert set(FederationCatalogChange.__table__.columns.keys()) >= {
        "sequence",
        "entity_type",
        "entity_uid",
        "operation",
        "payload_revision",
        "payload_json",
        "occurred_at",
        "retention_until",
    }
