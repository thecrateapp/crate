"""Federation domain events — emit events for projector/snapshot integration.

Phase 4/5/6: catalog sync completion, peer health changes, import events.
Published to Redis Streams via the existing domain event infrastructure.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger(__name__)


def _publish_event(
    event_type: str,
    payload: dict,
    *,
    scope: str = "federation",
    subject_key: str | None = None,
):
    try:
        from crate.db.domain_events import append_domain_event

        append_domain_event(
            event_type,
            payload,
            scope=scope,
            subject_key=str(
                subject_key
                if subject_key is not None
                else payload.get("node_uid") or ""
            ),
        )
    except Exception as e:
        log.debug("Domain event publish skipped: %s", e)


def emit_catalog_sync_completed(node_uid: str, items_synced: int, revision: str):
    _publish_event(
        "federation.catalog.sync.completed",
        {
            "node_uid": node_uid,
            "items_synced": items_synced,
            "revision": revision,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        },
    )


def emit_catalog_sync_failed(node_uid: str, error: str):
    _publish_event(
        "federation.catalog.sync.failed",
        {
            "node_uid": node_uid,
            "error": error,
            "failed_at": datetime.now(timezone.utc).isoformat(),
        },
    )


def emit_peer_health_changed(node_uid: str, healthy: bool, latency_ms: int):
    _publish_event(
        "federation.peer.health.changed",
        {
            "node_uid": node_uid,
            "healthy": healthy,
            "latency_ms": latency_ms,
            "changed_at": datetime.now(timezone.utc).isoformat(),
        },
    )


def emit_catalog_item_upserted(node_uid: str, entity_type: str, remote_entity_uid: str):
    _publish_event(
        "federation.catalog.item.upserted",
        {
            "node_uid": node_uid,
            "entity_type": entity_type,
            "remote_entity_uid": remote_entity_uid,
        },
    )


def emit_global_catalog_source_changed(
    *,
    node_uid: str,
    reason: str,
    entity_type: str | None = None,
    remote_entity_uid: str | None = None,
    global_entity_uid: str | None = None,
    facet: str | None = None,
):
    payload = {
        "node_uid": node_uid,
        "reason": reason,
        "changed_at": datetime.now(timezone.utc).isoformat(),
    }
    if entity_type:
        payload["entity_type"] = entity_type
    if remote_entity_uid:
        payload["remote_entity_uid"] = remote_entity_uid
    if global_entity_uid:
        payload["global_entity_uid"] = global_entity_uid
    if facet:
        payload["facet"] = facet

    _publish_event(
        "global_catalog.source.changed",
        payload,
        scope="global_catalog",
        subject_key=global_entity_uid or node_uid,
    )
