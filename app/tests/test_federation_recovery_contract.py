from __future__ import annotations

from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import uuid

import pytest
from sqlalchemy import text


def test_peer_outage_marks_federated_search_as_partial(monkeypatch):
    from crate.federation import search_fanout

    local = {"artists": [{"name": "Local"}], "albums": [], "tracks": []}
    peer = {
        "node_uid": "00000000-0000-0000-0000-000000000002",
        "display_name": "Offline peer",
        "health_json": {"healthy": True},
    }
    monkeypatch.setattr(search_fanout, "search_all_hybrid", lambda *args: local)
    monkeypatch.setattr(search_fanout, "_get_approved_peers_for_search", lambda: [peer])
    monkeypatch.setattr(search_fanout, "_search_local_index", lambda *args: None)
    monkeypatch.setattr(search_fanout, "_search_one_peer", lambda **kwargs: None)

    result = search_fanout.federated_search(
        "query",
        scope="federated",
        local_node={"node_uid": "00000000-0000-0000-0000-000000000001"},
    )

    assert result["artists"] == local["artists"]
    assert result["federation"] == {
        "complete": False,
        "attempted_peers": 1,
        "completed_peers": 0,
        "failed_peer_uids": [peer["node_uid"]],
        "timed_out_peer_uids": [],
    }


def test_failed_delta_page_rolls_back_items_and_cursor(pg_db):
    del pg_db
    from crate.db.jobs.global_catalog_reconciliation import (
        apply_federation_delta_page,
    )
    from crate.db.tx import read_scope

    peer_uid = str(uuid.uuid4())
    first_uid = f"artist-{uuid.uuid4()}"

    with pytest.raises(ValueError, match="Invalid federation delta entity"):
        apply_federation_delta_page(
            node_uid=peer_uid,
            items=[
                {
                    "sequence": 41,
                    "entity_type": "artist",
                    "remote_entity_uid": first_uid,
                    "operation": "upsert",
                    "payload_revision": "sha256:valid",
                    "payload": {"name": "High Vis"},
                },
                {
                    "sequence": 42,
                    "entity_type": "unsupported",
                    "remote_entity_uid": "invalid",
                    "operation": "upsert",
                    "payload_revision": "sha256:invalid",
                    "payload": {},
                },
            ],
            next_cursor="cursor-42",
        )

    with read_scope() as session:
        item_count = session.execute(
            text(
                """
                SELECT COUNT(*) FROM federation_catalog_items
                WHERE node_uid = CAST(:node_uid AS uuid)
                  AND remote_entity_uid = :entity_uid
                """
            ),
            {"node_uid": peer_uid, "entity_uid": first_uid},
        ).scalar_one()
        cursor_count = session.execute(
            text(
                """
                SELECT COUNT(*) FROM federation_catalog_cursors
                WHERE node_uid = CAST(:node_uid AS uuid)
                """
            ),
            {"node_uid": peer_uid},
        ).scalar_one()

    assert item_count == 0
    assert cursor_count == 0


def test_partial_federated_search_is_not_cached_as_complete(monkeypatch):
    from crate.api import browse_media
    from crate.api.schemas.media import SearchResponse
    from crate.db.repositories import federation as federation_repo
    from crate.federation import search_fanout

    cache_writes: list[tuple] = []
    monkeypatch.setattr(browse_media, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(browse_media, "get_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        browse_media,
        "set_cache",
        lambda *args, **kwargs: cache_writes.append((args, kwargs)),
    )
    monkeypatch.setattr(browse_media, "record_later", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        federation_repo,
        "get_local_node",
        lambda: {"node_uid": "00000000-0000-0000-0000-000000000001"},
    )
    monkeypatch.setattr(
        search_fanout,
        "federated_search",
        lambda **kwargs: {
            "artists": [{"name": "Local"}],
            "albums": [],
            "tracks": [],
            "federation": {
                "complete": False,
                "attempted_peers": 1,
                "completed_peers": 0,
                "failed_peer_uids": ["peer-a"],
                "timed_out_peer_uids": [],
            },
        },
    )

    result = browse_media.api_search(
        object(),
        q="High Vis",
        limit=20,
        scope="federated",
    )

    assert result["federation"]["complete"] is False
    serialized = SearchResponse.model_validate(result).model_dump(exclude_none=True)
    assert serialized["federation"] == result["federation"]
    assert cache_writes == []


def test_expired_failed_import_releases_reservation(pg_db):
    del pg_db
    from crate.db.jobs.federation_imports import cleanup_expired_imports
    from crate.db.tx import read_scope, transaction_scope

    request_uid = str(uuid.uuid4())
    peer_uid = str(uuid.uuid4())
    deadline = datetime.now(timezone.utc) - timedelta(minutes=1)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO federation_import_requests (
                    request_id, node_uid, remote_entity_uid, title, status,
                    idempotency_key, reserved_bytes, cleanup_deadline
                ) VALUES (
                    CAST(:request_uid AS uuid), CAST(:peer_uid AS uuid),
                    'remote-album', 'Interrupted import', 'failed',
                    :idempotency_key, 4096, :deadline
                )
                """
            ),
            {
                "request_uid": request_uid,
                "peer_uid": peer_uid,
                "idempotency_key": f"recovery-{request_uid}",
                "deadline": deadline,
            },
        )

    assert cleanup_expired_imports() == 1

    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                SELECT status, reserved_bytes
                FROM federation_import_requests
                WHERE request_id = CAST(:request_uid AS uuid)
                """
                ),
                {"request_uid": request_uid},
            )
            .mappings()
            .one()
        )

    assert dict(row) == {"status": "cleaned", "reserved_bytes": 0}


def test_expired_active_import_becomes_visible_failure_and_releases_space(pg_db):
    del pg_db
    from crate.db.jobs.federation_imports import expire_stale_imports
    from crate.db.tx import read_scope, transaction_scope

    request_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO federation_import_requests (
                    request_id, node_uid, remote_entity_uid, title, status,
                    idempotency_key, reserved_bytes, cleanup_deadline,
                    staging_relative_path
                ) VALUES (
                    CAST(:request_uid AS uuid), CAST(:peer_uid AS uuid),
                    'remote-album', 'Crashed import', 'downloading',
                    :idempotency_key, 8192, NOW() - INTERVAL '1 minute',
                    '.imports/federation/crashed-import'
                )
                """
            ),
            {
                "request_uid": request_uid,
                "peer_uid": str(uuid.uuid4()),
                "idempotency_key": f"crash-{request_uid}",
            },
        )

    expired = expire_stale_imports()

    assert [str(item["request_id"]) for item in expired] == [request_uid]
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                SELECT status, reserved_bytes, failure_reason
                FROM federation_import_requests
                WHERE request_id = CAST(:request_uid AS uuid)
                """
                ),
                {"request_uid": request_uid},
            )
            .mappings()
            .one()
        )
    assert row["status"] == "failed"
    assert row["reserved_bytes"] == 0
    assert "lease expired" in row["failure_reason"].lower()


def test_import_reservation_fails_before_db_write_when_disk_headroom_is_exhausted(
    monkeypatch,
    tmp_path,
):
    from crate.db.jobs import federation_imports

    monkeypatch.setenv("CRATE_FEDERATION_IMPORT_FREE_HEADROOM_BYTES", "900")
    monkeypatch.setattr(
        federation_imports.shutil,
        "disk_usage",
        lambda _path: SimpleNamespace(total=1000, used=0, free=1000),
    )

    with pytest.raises(ValueError, match="Insufficient free storage"):
        federation_imports.reserve_import_storage(
            str(uuid.uuid4()),
            expected_bytes=200,
            library_path=tmp_path,
        )


def test_periodic_worker_cleanup_removes_only_bounded_import_staging(
    monkeypatch,
    tmp_path,
):
    from crate import worker
    from crate.db.jobs import federation_imports

    staging = tmp_path / ".imports/federation/expired-request"
    staging.mkdir(parents=True)
    (staging / "partial.flac").write_bytes(b"partial")
    outside = tmp_path.parent / "must-survive"
    outside.mkdir(exist_ok=True)
    (outside / "file").write_bytes(b"safe")
    monkeypatch.setattr(
        federation_imports,
        "expire_stale_imports",
        lambda: [
            {"staging_relative_path": ".imports/federation/expired-request"},
            {"staging_relative_path": "../must-survive"},
        ],
    )

    assert worker._cleanup_federation_imports({"library_path": str(tmp_path)}) == 1
    assert not staging.exists()
    assert outside.exists()


def test_chaos_runner_covers_every_operational_failure_class():
    root = Path(__file__).resolve().parents[2]
    source = (root / "scripts/federation-chaos-e2e.py").read_text()
    required = {
        "peer-outage",
        "api-restart",
        "worker-restart",
        "import-recovery",
        "redis-restart",
        "postgres-restart",
        "key-rotation-offline",
        "grant-revocation",
        "readplane-restart",
        "adversarial-contracts",
    }

    assert required <= set(source.split('"'))


def test_chaos_runner_accepts_all_without_positional_scenarios():
    root = Path(__file__).resolve().parents[2]
    path = root / "scripts/federation-chaos-e2e.py"
    spec = importlib.util.spec_from_file_location("federation_chaos_e2e", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
        args = module.parse_args(["--all"])
    finally:
        sys.modules.pop(spec.name, None)

    assert args.all is True
    assert args.scenarios == []


def test_chaos_context_syncs_fixtures_before_remote_search():
    root = Path(__file__).resolve().parents[2]
    path = root / "scripts/federation-chaos-e2e.py"
    spec = importlib.util.spec_from_file_location("federation_chaos_context", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    calls: list[str] = []
    fake_e2e = SimpleNamespace(
        pair_nodes=lambda: ("a", "b", "a-uid", "b-uid"),
        sync_fixtures=lambda a, b: calls.append("sync-fixtures"),
        sync_remote_catalog=lambda a, uid: calls.append("sync-remote"),
        first_remote_track=lambda a: calls.append("search") or {"id": "track"},
    )
    try:
        spec.loader.exec_module(module)
        module.E2E = fake_e2e
        context = module.prepare_context()
    finally:
        sys.modules.pop(spec.name, None)

    assert calls == ["sync-fixtures", "sync-remote", "search"]
    assert context.remote_track == {"id": "track"}


def test_local_key_rotation_accepts_uuid_loaded_from_postgres(monkeypatch):
    from crate.api import admin_federation

    node_uid = uuid.uuid4()
    rotation_uid = uuid.uuid4()
    rotation = {
        "rotation_uid": rotation_uid,
        "new_key_id": "key-next",
        "activate_at": datetime.now(timezone.utc),
        "grace_until": datetime.now(timezone.utc) + timedelta(minutes=5),
    }
    monkeypatch.setattr(admin_federation, "_require_nodes_manage", lambda request: None)
    monkeypatch.setattr(
        admin_federation.repo,
        "get_local_node",
        lambda: {"node_uid": node_uid},
    )
    monkeypatch.setattr(
        admin_federation,
        "prepare_local_rotation",
        lambda **kwargs: rotation,
    )
    monkeypatch.setattr(
        admin_federation,
        "announce_local_rotation",
        lambda uid: rotation,
    )
    monkeypatch.setattr(
        admin_federation.repo,
        "record_audit_event",
        lambda **kwargs: None,
    )

    result = admin_federation.rotate_local_key(
        str(node_uid),
        object(),
        admin_federation.RotationStartBody(),
    )

    assert result["rotation_uid"] == rotation_uid


def test_production_router_has_health_checked_fastapi_readplane_fallbacks():
    from pathlib import Path

    import yaml

    root = Path(__file__).resolve().parents[2]
    dynamic_path = root / "deploy/traefik/federation-readplane.yml"
    dynamic = yaml.safe_load(dynamic_path.read_text())
    services = dynamic["http"]["services"]
    for service_name in (
        "crate-readplane-interactive",
        "crate-readplane-sse",
        "crate-readplane-stream",
    ):
        assert services[service_name]["failover"] == {
            "service": "crate-readplane-primary",
            "fallback": "crate-api-read-fallback",
        }
    assert (
        services["crate-readplane-primary"]["loadBalancer"]["healthCheck"]["path"]
        == "/readyz"
    )
    assert (
        services["crate-api-read-fallback"]["loadBalancer"]["healthCheck"]["path"]
        == "/api/status"
    )

    mount = (
        "./deploy/traefik/federation-readplane.yml:"
        "/conf/crate-federation-readplane.yml:ro"
    )
    for compose_name in ("docker-compose.yaml", "docker-compose.home.yaml"):
        compose = yaml.safe_load((root / compose_name).read_text())
        assert mount in compose["services"]["traefik"]["volumes"]
        labels = compose["services"]["crate-readplane"]["labels"]
        assert (
            labels["traefik.http.routers.crate-readplane-stream.service"]
            == "crate-readplane-stream@file"
        )
        assert (
            labels["traefik.http.routers.crate-readplane-interactive.service"]
            == "crate-readplane-interactive@file"
        )
        assert (
            labels["traefik.http.routers.crate-readplane-sse.service"]
            == "crate-readplane-sse@file"
        )

    nginx = (root / "app/listen/nginx.conf").read_text()
    assert "upstream crate_readplane_backend" in nginx
    assert "server crate-api:8585 backup" in nginx
    assert "proxy_next_upstream error timeout http_502 http_503 http_504" in nginx

    deploy = (root / "scripts/deploy.sh").read_text()
    assert "deploy/traefik/federation-readplane.yml" in deploy
