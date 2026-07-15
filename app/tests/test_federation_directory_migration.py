from __future__ import annotations

from pathlib import Path

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope


MIGRATION = Path(
    "app/crate/db/migrations/versions/069_federation_directory_subscriptions.py"
)


def test_directory_migration_separates_subscriptions_candidates_and_peers():
    source = MIGRATION.read_text()

    assert 'revision = "069"' in source
    assert 'down_revision = "068"' in source
    assert "federation_directory_subscriptions" in source
    assert "federation_directory_refresh_runs" in source
    assert "federation_directory_candidates" in source
    assert "trusted_keys_json" in source
    assert "etag" in source and "last_modified" in source
    assert "last_success_at" in source and "last_error_code" in source
    assert "ON DELETE SET NULL" in source
    assert "ON DELETE CASCADE" in source


def test_directory_migration_has_single_run_and_candidate_uniqueness_guards():
    source = MIGRATION.read_text()

    assert "uq_federation_directory_running" in source
    assert "WHERE status = 'running'" in source
    assert "UNIQUE (subscription_id, node_uid)" in source
    assert "refresh_interval_seconds BETWEEN 300 AND 604800" in source


def test_directory_deletion_preserves_approved_peer_and_clears_origin(pg_db):
    from crate.db.repositories import federation as federation_repo
    from crate.db.repositories import federation_directories as directory_repo

    node_uid = "11111111-1111-4111-8111-111111111111"
    federation_repo.upsert_peer(
        node_uid=node_uid,
        display_name="Peer One",
        api_base_url="https://peer.example",
        active_key_id="peer-key",
        trust_state="approved",
    )
    subscription = directory_repo.create_subscription(
        url="https://directory.example/nodes.json",
        trusted_keys=[{"key_id": "directory-key", "public_key": "abc"}],
    )
    candidate = directory_repo.upsert_candidate(
        subscription_id=subscription["id"],
        node_uid=node_uid,
        descriptor_url="https://peer.example/.well-known/crate-node",
        descriptor_digest="a" * 64,
        display_name="Peer One",
        advertised_key_id="peer-key",
    )
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE federation_nodes
                SET directory_candidate_id = :candidate_id
                WHERE node_uid = CAST(:node_uid AS uuid)
                """
            ),
            {"candidate_id": candidate["id"], "node_uid": node_uid},
        )

    assert directory_repo.delete_subscription(str(subscription["subscription_uid"]))

    with read_scope() as session:
        peer = (
            session.execute(
                text(
                    """
                SELECT trust_state, directory_candidate_id
                FROM federation_nodes
                WHERE node_uid = CAST(:node_uid AS uuid)
                """
                ),
                {"node_uid": node_uid},
            )
            .mappings()
            .one()
        )
    assert peer["trust_state"] == "approved"
    assert peer["directory_candidate_id"] is None


def test_directory_refresh_claim_prevents_overlap(pg_db):
    from crate.db.repositories import federation_directories as directory_repo

    subscription = directory_repo.create_subscription(
        url="https://directory.example/nodes.json",
        trusted_keys=[],
    )

    assert directory_repo.claim_refresh(subscription["id"]) is not None
    assert directory_repo.claim_refresh(subscription["id"]) is None
