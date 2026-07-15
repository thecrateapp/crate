from __future__ import annotations

from pathlib import Path

from sqlalchemy import text

from crate.db.tx import read_scope


MIGRATION = Path("app/crate/db/migrations/versions/070_federation_risk_observations.py")


def test_risk_migration_has_bounded_non_permanent_state():
    source = MIGRATION.read_text()

    assert 'revision = "070"' in source
    assert 'down_revision = "069"' in source
    assert "federation_risk_observations" in source
    assert "federation_risk_snapshots" in source
    assert "federation_temporary_actions" in source
    assert "expires_at TIMESTAMPTZ NOT NULL" in source
    assert "reversed_at TIMESTAMPTZ" in source
    assert "permanent" not in source.lower()
    assert "metadata_json" in source
    assert "CHECK (octet_length(metadata_json::text) <= 16384)" in source


def test_risk_schema_enforces_action_expiry_and_observation_retention(pg_db):
    with read_scope() as session:
        columns = {
            (row["table_name"], row["column_name"], row["is_nullable"])
            for row in session.execute(
                text(
                    """
                    SELECT table_name, column_name, is_nullable
                    FROM information_schema.columns
                    WHERE table_name IN (
                        'federation_risk_observations',
                        'federation_risk_snapshots',
                        'federation_temporary_actions'
                    )
                    """
                )
            )
            .mappings()
            .all()
        }

    assert (
        "federation_risk_observations",
        "expires_at",
        "NO",
    ) in columns
    assert (
        "federation_temporary_actions",
        "expires_at",
        "NO",
    ) in columns
    assert (
        "federation_temporary_actions",
        "reversed_at",
        "YES",
    ) in columns


def test_risk_repository_aggregates_duplicate_signals_and_reverses_actions(pg_db):
    from crate.db.repositories import federation_risk

    peer_uid = "11111111-1111-4111-8111-111111111111"
    first = federation_risk.record_observation(
        peer_node_uid=peer_uid,
        subject_hash="subject-1",
        observation_type="invalid_signature",
        severity="high",
        dedupe_key="request-window-1",
        metadata={"reason_code": "signature_invalid"},
    )
    second = federation_risk.record_observation(
        peer_node_uid=peer_uid,
        subject_hash="subject-1",
        observation_type="invalid_signature",
        severity="high",
        dedupe_key="request-window-1",
        metadata={"reason_code": "signature_invalid"},
    )

    assert second["id"] == first["id"]
    assert second["count"] == 2

    action = federation_risk.create_temporary_action(
        peer_node_uid=peer_uid,
        subject_hash=None,
        action_type="throttle",
        capability="federation.stream.play",
        reason_code="signature_flood",
        ttl_seconds=300,
    )
    assert action["expires_at"] is not None
    assert federation_risk.reverse_temporary_action(action["id"])
    assert federation_risk.list_active_temporary_actions(peer_uid) == []
