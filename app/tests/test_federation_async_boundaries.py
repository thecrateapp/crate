from __future__ import annotations

import ast
from pathlib import Path


def test_signed_request_verification_is_offloaded_from_the_event_loop() -> None:
    source = Path("app/crate/api/federation.py").read_text()

    assert "await asyncio.to_thread(_verify_signed_node_request" in source


def test_async_federation_routes_do_not_call_blocking_services_directly() -> None:
    source = Path("app/crate/api/federation.py").read_text()
    tree = ast.parse(source)
    blocking_names = {
        "_catalog_manifest_items",
        "_catalog_manifest_items_after",
        "_catalog_manifest_snapshot",
        "_catalog_share_policy",
        "_federated_artist_sidecar_image",
        "_peer_has_capability",
        "_public_album_detail",
        "_public_artist_detail",
        "_public_facet_payload",
        "_public_track_detail",
        "_request_redis",
        "_require_capability",
        "_require_user_assertion",
        "_serve_federated_album_asset",
        "_serve_federated_asset",
        "acquire_prepare_reservation",
        "acquire_stream_slot",
        "append_domain_event",
        "catalog_high_water_mark",
        "catalog_retention_floor",
        "create_ticket",
        "get_ticket",
        "get_track_delivery_row_by_entity_uid",
        "handle_remote_search",
        "inspect_playback_preparation",
        "list_catalog_changes",
        "prepare_playback",
        "reconcile_stream_bytes",
        "record_playback_prepare_request",
        "record_playback_prepare_result",
        "record_remote_playback_delivery",
        "release_stream_slot",
        "reserve_stream_bytes",
        "resolve_playback",
        "taxonomy_release_health",
        "validate_ticket",
    }
    blocking_attributes = {
        "repo.get_local_node",
        "repo.get_remote_subject",
        "repo.record_audit_event",
        "repo.update_peer",
        "trust_repo.get_active_local_key",
        "trust_repo.get_peer_verification_key",
        "trust_repo.list_peer_public_keys",
        "trust_repo.upsert_peer_key",
    }
    violations: list[str] = []

    for function in ast.walk(tree):
        if not isinstance(function, ast.AsyncFunctionDef):
            continue
        for call in ast.walk(function):
            if not isinstance(call, ast.Call):
                continue
            name = ast.unparse(call.func)
            if name in blocking_names or name in blocking_attributes:
                violations.append(f"{function.name}:{call.lineno}:{name}")

    assert violations == []
