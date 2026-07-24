from __future__ import annotations

import importlib


def _migration():
    return importlib.import_module(
        "crate.db.migrations.versions.064_federation_trust_hardening"
    )


def test_trust_migration_normalizes_keys_and_pairings(monkeypatch):
    migration = _migration()
    statements: list[str] = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.upgrade()

    sql = "\n".join(statements)
    assert migration.revision == "064"
    assert migration.down_revision == "063"
    assert "CREATE TABLE federation_local_keys" in sql
    assert "CREATE TABLE federation_peer_keys" in sql
    assert "CREATE TABLE federation_pairings" in sql
    assert "CREATE TABLE federation_key_rotations" in sql
    assert "jsonb_array_elements" in sql
    assert "idx_federation_local_keys_one_active" in sql
    assert "UNIQUE (node_uid, key_id)" in sql
    assert "remote_pending" in sql


def test_trust_migration_downgrade_preserves_legacy_key_projection(monkeypatch):
    migration = _migration()
    statements: list[str] = []
    monkeypatch.setattr(migration.op, "execute", statements.append)

    migration.downgrade()

    sql = "\n".join(statements)
    assert "UPDATE federation_local_node" in sql
    assert "UPDATE federation_nodes" in sql
    assert "jsonb_agg" in sql
    assert "DROP TABLE IF EXISTS federation_key_rotations" in sql
    assert "DROP TABLE IF EXISTS federation_pairings" in sql
    assert "DROP TABLE IF EXISTS federation_peer_keys" in sql
    assert "DROP TABLE IF EXISTS federation_local_keys" in sql


def test_federation_trust_orm_models_match_the_migration():
    from crate.db.orm.federation import (
        FederationKeyRotation,
        FederationLocalKey,
        FederationPairing,
        FederationPeerKey,
    )

    assert FederationLocalKey.__tablename__ == "federation_local_keys"
    assert FederationPeerKey.__tablename__ == "federation_peer_keys"
    assert FederationPairing.__tablename__ == "federation_pairings"
    assert FederationKeyRotation.__tablename__ == "federation_key_rotations"
    assert set(FederationLocalKey.__table__.columns.keys()) >= {
        "key_id",
        "node_uid",
        "public_key",
        "private_key_ref",
        "status",
        "not_before",
        "not_after",
    }
    assert set(FederationPairing.__table__.columns.keys()) >= {
        "pairing_uid",
        "direction",
        "state",
        "local_challenge",
        "remote_challenge",
        "negotiated_protocol",
        "signature_profile",
        "descriptor_digest",
        "expires_at",
        "verified_at",
        "failure_reason",
    }
