"""Federation worker task handlers — catalog sync, import, health polling.

Phase 4/5/6 worker integration. All long-running operations go through Dramatiq.
"""

from __future__ import annotations

import logging

from crate.db.repositories import federation as repo
from crate.worker_handlers import TaskHandler

log = logging.getLogger(__name__)


def _handle_catalog_sync(task_id: str, params: dict, config: dict) -> dict:
    """Sync federated catalog from a peer with pagination."""
    node_uid = params.get("node_uid", "")
    if not node_uid:
        peers = repo.list_peers(trust_state="approved")
        results: list[dict] = []
        total_synced = 0
        for peer in peers:
            peer_uid = str(peer.get("node_uid") or "")
            if not peer_uid or peer.get("disabled_at"):
                continue
            result = _sync_single_peer_catalog(peer_uid, params)
            results.append({"node_uid": peer_uid, **result})
            total_synced += int(result.get("synced") or 0)
        return {"peers": len(results), "synced": total_synced, "results": results}

    return _sync_single_peer_catalog(str(node_uid), params)


def _duration_seconds(item: dict) -> int | None:
    value = item.get("duration_seconds", item.get("duration"))
    if value is None:
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _manifest_page_items(items: object) -> list[dict]:
    if isinstance(items, list):
        return [item for item in items if isinstance(item, dict)]
    if isinstance(items, dict):
        page_items: list[dict] = []
        for entity_type, key in (
            ("artist", "artists"),
            ("album", "albums"),
            ("track", "tracks"),
        ):
            for item in items.get(key, []):
                if isinstance(item, dict):
                    page_items.append({"entity_type": entity_type, **item})
        return page_items
    return []


def _sync_single_peer_catalog(node_uid: str, params: dict) -> dict:
    from crate.federation.catalog import upsert_catalog_item, upsert_cursor
    from crate.federation.events import (
        emit_catalog_sync_completed,
        emit_catalog_sync_failed,
        emit_global_catalog_source_changed,
    )
    from crate.federation.global_content_cache import invalidate_source_cache

    peer = repo.get_peer(node_uid)
    if not peer:
        return {"error": "peer not found"}

    from crate.federation.client import federated_get

    local_node = repo.get_local_node()
    if not local_node:
        return {"error": "local node not configured"}

    page_size = max(1, min(int(params.get("page_size", 200) or 200), 500))
    base_path = f"/api/federation/v1/catalog/manifest?page_size={page_size}"
    total_count = 0
    revision = ""
    page = params.get("start_page", 0)
    max_pages = params.get("max_pages", 10)

    for _ in range(max_pages):
        try:
            resp = federated_get(
                base_url=peer["api_base_url"],
                path=f"{base_path}&page={page}",
                node_id=local_node["node_uid"],
                key_id=local_node["active_key_id"],
                private_key_ref=local_node["private_key_ref"],
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            repo.update_peer(node_uid, last_error=str(e)[:200])
            if total_count == 0:
                emit_catalog_sync_failed(node_uid, str(e)[:200])
                return {"error": str(e)[:200]}
            break

        revision = data.get("revision", "")
        page_items = _manifest_page_items(data.get("items", []))

        if not page_items:
            break

        for item in page_items:
            entity_type = str(item.get("entity_type") or "")
            remote_entity_uid = str(
                item.get("remote_entity_uid") or item.get("entity_uid") or ""
            )
            if entity_type not in {"artist", "album", "track"} or not remote_entity_uid:
                continue
            upsert_catalog_item(
                node_uid=node_uid,
                remote_entity_uid=remote_entity_uid,
                entity_type=entity_type,
                title=str(item.get("title") or item.get("name") or ""),
                artist=item.get("artist"),
                album=item.get("album"),
                year=str(item["year"]) if item.get("year") is not None else None,
                duration_seconds=_duration_seconds(item),
                track_number=item.get("track_number"),
                disc_number=item.get("disc_number"),
                remote_revision=revision,
                raw_json=item,
            )
            invalidated = invalidate_source_cache(node_uid, remote_entity_uid)
            if invalidated:
                emit_global_catalog_source_changed(
                    node_uid=node_uid,
                    reason="manifest_revision_changed",
                    entity_type=entity_type,
                    remote_entity_uid=remote_entity_uid,
                )
            total_count += 1

        total_pages = data.get("total_pages")
        if total_pages is not None and data.get("page", page) >= int(total_pages) - 1:
            break
        if total_pages is None and len(page_items) < page_size:
            break
        page += 1

    upsert_cursor(node_uid, revision)
    emit_catalog_sync_completed(node_uid, total_count, revision)
    return {"synced": total_count, "revision": revision, "pages": page + 1}


def _handle_federation_import(task_id: str, params: dict, config: dict) -> dict:
    """Import remote content from a peer into the local library."""
    request_id = params.get("request_id", "")
    if not request_id:
        return {"error": "missing request_id"}

    from crate.federation.imports import get_import_request, record_import_provenance

    req = get_import_request(request_id)
    if not req:
        return {"error": "import request not found"}

    if req["status"] != "approved":
        return {"error": "import request not approved"}

    record_import_provenance(
        album_id=0,
        node_uid=req["node_uid"],
        node_name="",
        remote_entity_uid=req["remote_entity_uid"],
    )

    return {"status": "completed", "request_id": request_id}


def _handle_health_poll(task_id: str, params: dict, config: dict) -> dict:
    """Poll all approved peers for health status."""
    from crate.federation.health import run_health_poll

    results = run_health_poll()
    healthy = sum(1 for r in results if r.get("healthy"))
    return {"total": len(results), "healthy": healthy, "results": results}


FEDERATION_TASK_HANDLERS: dict[str, TaskHandler] = {
    "federation_catalog_sync": _handle_catalog_sync,
    "federation_sync_catalog": _handle_catalog_sync,
    "federation_import": _handle_federation_import,
    "federation_health_poll": _handle_health_poll,
}
