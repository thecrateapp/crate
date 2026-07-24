"""Remote facet fetchers backed by the federated content cache."""

from __future__ import annotations

from typing import Any

from fastapi import Request

from crate.federation.global_content_cache import (
    get_cached_json_facet,
    store_json_facet,
)


def get_or_fetch_remote_json_facet(
    selection: dict[str, Any],
    request: Request,
) -> dict[str, Any]:
    cached = get_cached_json_facet(selection)
    if cached is not None:
        return cached

    from crate.api.federation_remote import remote_json_facet

    payload = remote_json_facet(
        selection["node_uid"],
        selection["remote_entity_uid"],
        selection["entity_type"],
        selection["facet"],
        request,
    )
    if isinstance(payload, dict):
        ttl_seconds = _ttl_seconds(selection)
        store_json_facet(selection, payload, ttl_seconds=ttl_seconds)
        return payload
    return {}


def _ttl_seconds(selection: dict[str, Any]) -> int:
    facet_payload = selection.get("facet_payload")
    if isinstance(facet_payload, dict):
        try:
            return int(facet_payload.get("ttl_seconds") or 3600)
        except (TypeError, ValueError):
            return 3600
    return 3600


__all__ = ["get_or_fetch_remote_json_facet"]
