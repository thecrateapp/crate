from __future__ import annotations

import importlib


def test_import_hardening_migration_is_idempotent_and_bounded(monkeypatch):
    migration = importlib.import_module(
        "crate.db.migrations.versions.067_federation_import_hardening"
    )
    statements: list[str] = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.upgrade()

    sql = "\n".join(statements)
    assert migration.revision == "067"
    assert migration.down_revision == "066"
    for column in (
        "idempotency_key",
        "expected_bytes",
        "reserved_bytes",
        "received_bytes",
        "manifest_digest",
        "approval_metadata",
        "staging_relative_path",
        "cleanup_deadline",
    ):
        assert column in sql
    for status in (
        "requested",
        "awaiting_approval",
        "approved",
        "reserving",
        "downloading",
        "verifying",
        "importing",
        "completed",
        "cancelled",
        "failed",
        "cleaned",
    ):
        assert status in sql
    assert "UNIQUE (idempotency_key)" in sql
    assert "/music" not in sql


def test_import_hardening_downgrade_preserves_legacy_table(monkeypatch):
    migration = importlib.import_module(
        "crate.db.migrations.versions.067_federation_import_hardening"
    )
    statements: list[str] = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.downgrade()

    sql = "\n".join(statements)
    assert "DROP TABLE federation_import_requests" not in sql
    assert "DROP COLUMN IF EXISTS idempotency_key" in sql
