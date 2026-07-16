from __future__ import annotations

import json
import os
from pathlib import Path
import uuid

from alembic import command
from alembic.config import Config
import psycopg2


ROOT = Path(__file__).resolve().parents[2]


def _connection():
    return psycopg2.connect(
        host=os.environ["CRATE_POSTGRES_HOST"],
        port=os.environ["CRATE_POSTGRES_PORT"],
        user=os.environ["CRATE_POSTGRES_USER"],
        password=os.environ["CRATE_POSTGRES_PASSWORD"],
        dbname="crate_test",
    )


def _reset_schema() -> None:
    from crate.db.engine import reset_engine

    reset_engine()
    connection = _connection()
    connection.autocommit = True
    with connection.cursor() as cursor:
        cursor.execute("DROP SCHEMA IF EXISTS public CASCADE")
        cursor.execute("CREATE SCHEMA public")
        cursor.execute("GRANT ALL ON SCHEMA public TO PUBLIC")
    connection.close()


def _migrate(revision: str, *, downgrade: bool = False) -> None:
    config = Config(str(ROOT / "app/alembic.ini"))
    config.set_main_option(
        "script_location",
        str(ROOT / "app/crate/db/migrations"),
    )
    operation = command.downgrade if downgrade else command.upgrade
    operation(config, revision)


def _scalar(query: str, params: tuple = ()):
    connection = _connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(query, params)
            return cursor.fetchone()[0]
    finally:
        connection.close()


def _seed_063_legacy_state() -> dict[str, str]:
    local_uid = str(uuid.uuid4())
    peer_uid = str(uuid.uuid4())
    pairing_uid = str(uuid.uuid4())
    import_uid = str(uuid.uuid4())
    connection = _connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO federation_local_node (
                    node_uid, display_name, api_base_url, active_key_id,
                    public_keys_json, private_key_ref
                ) VALUES (%s, 'Legacy local', 'https://local.example.test',
                          'local-key', %s::jsonb,
                          'federation/keys/local-key.pem')
                """,
                (
                    local_uid,
                    json.dumps([{"key_id": "local-key", "public_key": "local-public"}]),
                ),
            )
            cursor.execute(
                """
                INSERT INTO federation_nodes (
                    node_uid, display_name, api_base_url, active_key_id,
                    public_keys_json, trust_state, default_grant_preset
                ) VALUES (%s, 'Legacy peer', 'https://peer.example.test',
                          'peer-key', %s::jsonb, 'pending', 'discovery')
                """,
                (
                    peer_uid,
                    json.dumps([{"key_id": "peer-key", "public_key": "peer-public"}]),
                ),
            )
            cursor.execute(
                """
                INSERT INTO federation_pairing_requests (
                    request_uid, remote_node_uid, remote_base_url, challenge,
                    status, expires_at
                ) VALUES (%s, %s, 'https://peer.example.test', 'challenge',
                          'pending', NOW() + INTERVAL '10 minutes')
                """,
                (pairing_uid, peer_uid),
            )
            cursor.execute(
                """
                INSERT INTO federation_peer_grants (
                    node_uid, principal_selector, preset, capabilities_json,
                    constraints_json
                ) VALUES (%s, %s, 'discovery',
                          '["catalog.search"]'::jsonb,
                          '{"max_results": 7}'::jsonb)
                """,
                (peer_uid, f"peer_users:{peer_uid}"),
            )
            cursor.execute(
                """
                INSERT INTO federation_import_requests (
                    request_id, node_uid, remote_entity_uid, title, status
                ) VALUES (%s, %s, 'legacy-album', 'Legacy album',
                          'pending_approval')
                """,
                (import_uid, peer_uid),
            )
        connection.commit()
    finally:
        connection.close()
    return {
        "local_uid": local_uid,
        "peer_uid": peer_uid,
        "pairing_uid": pairing_uid,
        "import_uid": import_uid,
    }


def _assert_hardened_state(ids: dict[str, str]) -> None:
    assert _scalar("SELECT version_num FROM alembic_version") == "071"
    assert (
        _scalar(
            "SELECT status FROM federation_local_keys WHERE node_uid = %s",
            (ids["local_uid"],),
        )
        == "active"
    )
    assert (
        _scalar(
            "SELECT status FROM federation_peer_keys WHERE node_uid = %s",
            (ids["peer_uid"],),
        )
        == "active"
    )
    assert (
        _scalar(
            "SELECT state FROM federation_pairings WHERE pairing_uid = %s",
            (ids["pairing_uid"],),
        )
        == "remote_pending"
    )
    assert (
        _scalar(
            "SELECT status FROM federation_import_requests WHERE request_id = %s",
            (ids["import_uid"],),
        )
        == "awaiting_approval"
    )
    assert _scalar(
        "SELECT idempotency_key IS NOT NULL FROM federation_import_requests "
        "WHERE request_id = %s",
        (ids["import_uid"],),
    )
    assert (
        _scalar(
            "SELECT capabilities_json ? 'stream.proxy' FROM federation_peer_grants "
            "WHERE node_uid = %s",
            (ids["peer_uid"],),
        )
        is False
    )


def test_empty_database_migrates_from_base_to_head(pg_db):
    del pg_db
    _reset_schema()

    _migrate("head")

    assert _scalar("SELECT version_num FROM alembic_version") == "071"
    for table in (
        "federation_local_keys",
        "federation_catalog_changes",
        "global_catalog_artist_route_aliases",
        "user_global_track_likes",
        "federation_directory_subscriptions",
        "federation_risk_observations",
    ):
        assert _scalar("SELECT to_regclass(%s) IS NOT NULL", (f"public.{table}",))


def test_063_snapshot_upgrades_without_trust_or_import_escalation(pg_db):
    del pg_db
    _reset_schema()
    _migrate("063")
    ids = _seed_063_legacy_state()

    _migrate("head")

    _assert_hardened_state(ids)
    assert (
        _scalar(
            "SELECT trust_state FROM federation_nodes WHERE node_uid = %s",
            (ids["peer_uid"],),
        )
        == "pending"
    )


def test_head_rolls_back_to_063_boundary_and_reupgrades(pg_db):
    del pg_db
    _reset_schema()
    _migrate("063")
    ids = _seed_063_legacy_state()
    _migrate("head")

    _migrate("063", downgrade=True)

    assert _scalar("SELECT version_num FROM alembic_version") == "063"
    assert (
        _scalar(
            "SELECT status FROM federation_import_requests WHERE request_id = %s",
            (ids["import_uid"],),
        )
        == "pending_approval"
    )
    assert _scalar(
        "SELECT public_keys_json @> %s::jsonb FROM federation_local_node "
        "WHERE node_uid = %s",
        (json.dumps([{"key_id": "local-key"}]), ids["local_uid"]),
    )

    _migrate("head")

    _assert_hardened_state(ids)
