"""Facet-aware source selection for canonical global catalog entities."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from crate.db.queries.global_source_selection import list_global_source_candidates


class GlobalEntityNotFound(Exception):
    """Raised when a canonical global entity does not exist."""


class NoGlobalSource(Exception):
    """Raised when no healthy source can serve the requested facet."""


_ENTITY_TYPES = {"artist", "album", "track"}

_PREFERRED_COLUMNS = {
    "artist_background": "preferred_for_artwork",
    "artist_photo": "preferred_for_artwork",
    "album_artwork": "preferred_for_artwork",
    "playback": "preferred_for_playback",
}


@dataclass(frozen=True)
class _Candidate:
    row: dict[str, Any]
    facet_payload: dict[str, Any]
    score: tuple[Any, ...]


def resolve_global_source(
    *,
    global_entity_uid: str,
    entity_type: str,
    facet: str,
) -> dict[str, Any]:
    """Return the best local or federated source for a global entity facet."""
    if entity_type not in _ENTITY_TYPES:
        raise GlobalEntityNotFound(global_entity_uid)

    rows = list_global_source_candidates(
        entity_type=entity_type,
        global_entity_uid=global_entity_uid,
    )
    if rows is None:
        raise GlobalEntityNotFound(global_entity_uid)

    candidates = [
        candidate
        for row in rows
        if (candidate := _candidate_for(row, facet)) is not None
    ]
    if not candidates:
        raise NoGlobalSource(f"{entity_type}:{global_entity_uid}:{facet}")

    selected = min(candidates, key=lambda candidate: candidate.score)
    row = selected.row
    result = {
        "kind": "local" if row["source_kind"] == "local" else "remote",
        "entity_type": row["entity_type"],
        "global_entity_uid": row["global_entity_uid"],
        "local_id": row["local_id"],
        "local_entity_uid": row["local_entity_uid"],
        "node_uid": row["node_uid"],
        "remote_entity_uid": row["remote_entity_uid"],
        "source_revision": row["source_revision"],
        "source_payload": _payload(row),
        "facet": facet,
        "facet_payload": selected.facet_payload,
    }
    if result["kind"] == "local":
        result["kind"] = "local"
    return result


def _candidate_for(row: dict[str, Any], facet: str) -> _Candidate | None:
    if row["source_kind"] == "federated" and not _peer_is_usable(row):
        return None
    facet_payload = _facet_payload(row, facet)
    if not facet_payload.get("available"):
        return None

    source_rank = 0 if row["source_kind"] == "local" else 1
    preferred_rank = 0 if _is_preferred(row, facet) else 1
    latency = _latency_ms(row)
    confidence = -float(row.get("match_confidence") or 0)
    updated_at = row.get("updated_at")
    timestamp = getattr(updated_at, "timestamp", None)
    timestamp_value = timestamp() if callable(timestamp) else None
    updated_rank = (
        -float(timestamp_value) if isinstance(timestamp_value, int | float | str) else 0
    )
    stable_rank = str(row.get("remote_entity_uid") or row.get("local_entity_uid") or "")

    return _Candidate(
        row=row,
        facet_payload=facet_payload,
        score=(
            source_rank,
            preferred_rank,
            latency,
            confidence,
            updated_rank,
            stable_rank,
        ),
    )


def _peer_is_usable(row: dict[str, Any]) -> bool:
    trust_state = row.get("trust_state")
    if trust_state is None:
        return False
    if trust_state != "approved" or row.get("disabled_at") is not None:
        return False
    health = _health(row)
    healthy = health.get("healthy")
    return healthy is not False


def _facet_payload(row: dict[str, Any], facet: str) -> dict[str, Any]:
    payload = _payload(row)
    facets = payload.get("facets")
    if isinstance(facets, dict) and facets:
        value = facets.get(facet)
        if isinstance(value, dict):
            return value
        if facet == "artist_background":
            value = facets.get("artist_photo")
            if isinstance(value, dict):
                return value
        return {"available": False}
    return _legacy_facet_payload(row, payload, facet)


def _legacy_facet_payload(
    row: dict[str, Any],
    payload: dict[str, Any],
    facet: str,
) -> dict[str, Any]:
    source_kind = row.get("source_kind")
    if facet in {"metadata", "artist_info", "album_detail", "track_info"}:
        return {"available": True}
    if facet == "artist_photo":
        return {"available": bool(payload.get("has_photo"))}
    if facet == "artist_background":
        return {
            "available": bool(payload.get("has_background") or payload.get("has_photo"))
        }
    if facet == "album_artwork":
        return {"available": bool(payload.get("has_cover") or payload.get("artwork"))}
    if facet == "playback":
        availability = payload.get("availability")
        if isinstance(availability, dict) and "stream" in availability:
            return {"available": bool(availability.get("stream"))}
        return {"available": source_kind == "local" or source_kind == "federated"}
    if facet == "track_analysis":
        return {"available": False}
    return {"available": False}


def _is_preferred(row: dict[str, Any], facet: str) -> bool:
    column = _PREFERRED_COLUMNS.get(facet, "preferred_for_display")
    return bool(row.get(column))


def _latency_ms(row: dict[str, Any]) -> int:
    if row.get("source_kind") == "local":
        return 0
    health = _health(row)
    try:
        return int(health.get("latency_ms") or 1_000_000)
    except (TypeError, ValueError):
        return 1_000_000


def _health(row: dict[str, Any]) -> dict[str, Any]:
    value = row.get("health_json")
    return value if isinstance(value, dict) else {}


def _payload(row: dict[str, Any]) -> dict[str, Any]:
    value = row.get("source_payload_json")
    return value if isinstance(value, dict) else {}


__all__ = [
    "GlobalEntityNotFound",
    "NoGlobalSource",
    "resolve_global_source",
]
