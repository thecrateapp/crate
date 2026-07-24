from __future__ import annotations

import uuid

import pytest


def test_import_manifest_rejects_cross_origin_and_size_mismatch():
    from crate.federation.imports import validate_import_manifest

    manifest = {
        "schema": "crate-import-manifest-v1",
        "album_uid": "album-1",
        "total_bytes": 10,
        "tracks": [
            {
                "entity_uid": "track-1",
                "size_bytes": 9,
                "sha256": "a" * 64,
                "url": "/api/federation/v1/import-files/track-1",
            }
        ],
    }
    with pytest.raises(ValueError, match="total_bytes"):
        validate_import_manifest(manifest, max_bytes=100)

    manifest["total_bytes"] = 9
    manifest["tracks"][0]["url"] = "https://evil.example/file"
    with pytest.raises(ValueError, match="relative"):
        validate_import_manifest(manifest, max_bytes=100)


def test_import_manifest_enforces_hash_and_hard_limit():
    from crate.federation.imports import validate_import_manifest

    manifest = {
        "schema": "crate-import-manifest-v1",
        "album_uid": "album-1",
        "total_bytes": 11,
        "tracks": [
            {
                "entity_uid": "track-1",
                "size_bytes": 11,
                "sha256": "b" * 64,
                "url": "/api/federation/v1/import-files/track-1",
            }
        ],
    }

    with pytest.raises(ValueError, match="limit"):
        validate_import_manifest(manifest, max_bytes=10)
    assert validate_import_manifest(manifest, max_bytes=11)["total_bytes"] == 11


def test_staging_path_is_relative_and_cannot_traverse():
    from crate.federation.imports import safe_staging_relative_path

    assert safe_staging_relative_path("request-1/01-track.flac").as_posix() == (
        "request-1/01-track.flac"
    )
    for invalid in ("/tmp/file", "../file", "request/../../file"):
        with pytest.raises(ValueError):
            safe_staging_relative_path(invalid)


def test_import_request_metadata_patch_uses_a_bound_json_value(pg_db):
    del pg_db
    from crate.db.repositories import federation as federation_repo
    from crate.db.repositories.federation_imports import (
        create_import_request,
        update_import_request,
    )

    node_uid = "11111111-1111-4111-8111-111111111111"
    federation_repo.upsert_peer(
        node_uid=node_uid,
        display_name="Remote",
        api_base_url="https://remote.example.test",
        active_key_id="key-1",
        trust_state="approved",
    )
    request = create_import_request(
        node_uid=node_uid,
        remote_entity_uid="album-1",
        entity_type="album",
        title="Remote Album",
    )

    updated = update_import_request(
        str(request["request_id"]),
        status="approved",
        metadata_patch={"task_id": "task-1"},
    )

    assert updated is not None
    assert updated["status"] == "approved"
    assert updated["metadata_json"]["task_id"] == "task-1"


def test_import_provenance_targets_local_album_and_requeues_reconciliation(pg_db):
    from sqlalchemy import text

    from crate.db.queries.global_catalog_sources import get_local_source
    from crate.db.repositories import federation as federation_repo
    from crate.db.repositories.federation_imports import (
        create_import_request,
        record_import_provenance,
        update_import_request,
    )
    from crate.db.tx import read_scope

    node_uid = str(uuid.uuid4())
    global_album_uid = str(uuid.uuid4())
    local_album_uid = str(uuid.uuid4())
    federation_repo.upsert_peer(
        node_uid=node_uid,
        display_name="Remote",
        api_base_url="https://remote.example.test",
        active_key_id="key-1",
        trust_state="approved",
    )
    pg_db.upsert_artist({"name": "Birds In Row"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Birds In Row",
            "name": "Gris Klein",
            "path": "/music/Birds In Row/Gris Klein",
            "entity_uid": local_album_uid,
            "year": "2022",
        }
    )
    request = create_import_request(
        node_uid=node_uid,
        remote_entity_uid="remote-album-1",
        entity_type="album",
        title="Gris Klein",
        global_album_uid=global_album_uid,
    )
    update_import_request(str(request["request_id"]), status="importing")

    record_import_provenance(
        album_id=album_id,
        node_uid=node_uid,
        node_name="Remote",
        remote_entity_uid="remote-album-1",
        request_id=str(request["request_id"]),
    )

    source = get_local_source("album", local_album_uid)
    assert source is not None
    assert source["source_payload"]["imported_global_album_uid"] == global_album_uid
    with read_scope() as session:
        dirty = (
            session.execute(
                text(
                    """
                    SELECT completed_at
                    FROM global_catalog_dirty_sources
                    WHERE dedupe_key = :dedupe_key
                    """
                ),
                {"dedupe_key": f"local:album:{local_album_uid}"},
            )
            .mappings()
            .one()
        )
    assert dirty["completed_at"] is None


def test_album_reconciliation_prefers_verified_import_provenance(monkeypatch):
    from crate.db.jobs import global_catalog_reconciliation as reconciliation

    target_uid = str(uuid.uuid4())
    source = {
        "entity_type": "album",
        "source_kind": "local",
        "local_entity_uid": str(uuid.uuid4()),
        "source_payload": {"imported_global_album_uid": target_uid},
    }
    monkeypatch.setattr(
        reconciliation,
        "force_merge_target_for_source",
        lambda session, source: None,
    )
    monkeypatch.setattr(
        reconciliation,
        "merge_blocked_for_source",
        lambda session, source, target: False,
    )

    resolved_uid, score = reconciliation._resolve_album_target(
        object(),
        source,
        str(uuid.uuid4()),
    )

    assert resolved_uid == target_uid
    assert score.confidence == 1.0
    assert score.method == "federation_import_provenance"
