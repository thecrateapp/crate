"""Playback source selection for canonical global catalog tracks."""

from __future__ import annotations

from typing import Any

from crate.federation.global_source_resolver import (
    GlobalEntityNotFound,
    NoGlobalSource,
    resolve_global_source,
)


class GlobalTrackNotFound(Exception):
    """Raised when a canonical track UID does not exist."""


class NoPlayableGlobalTrack(Exception):
    """Raised when a canonical track has no healthy playable source."""


def resolve_global_track_playback(global_track_uid: str) -> dict[str, Any]:
    """Return the best playable source for a canonical track.

    The caller turns this selection into the final playback response. Local
    sources always win so an isolated instance keeps the exact current behavior.
    """
    try:
        selection = resolve_global_source(
            global_entity_uid=global_track_uid,
            entity_type="track",
            facet="playback",
        )
    except GlobalEntityNotFound:
        raise GlobalTrackNotFound(global_track_uid) from None
    except NoGlobalSource:
        raise NoPlayableGlobalTrack(global_track_uid) from None

    if selection["kind"] == "local":
        return {
            "kind": "local",
            "local_track_id": selection["local_id"],
            "local_track_entity_uid": selection["local_entity_uid"],
        }
    remote_selection = {
        "kind": "remote",
        "node_uid": selection["node_uid"],
        "remote_entity_uid": selection["remote_entity_uid"],
    }
    quality = _quality_from_payload(selection.get("source_payload"))
    if quality:
        remote_selection["quality"] = quality
    return remote_selection


def _quality_from_payload(payload: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    quality: dict[str, Any] = {}
    fmt = str(payload.get("format") or "").strip().lower()
    if fmt:
        quality["format"] = fmt
    for key in ("bitrate", "sample_rate", "bit_depth", "size_bytes"):
        value = payload.get(key)
        if value is None:
            continue
        try:
            normalized = int(value)
        except (TypeError, ValueError):
            continue
        if normalized <= 0:
            continue
        quality[key] = normalized
    return quality


__all__ = [
    "GlobalTrackNotFound",
    "NoPlayableGlobalTrack",
    "resolve_global_track_playback",
]
