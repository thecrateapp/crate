"""Playback source selection for canonical global catalog tracks."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope
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


def _resolve_global_track_playback_legacy(global_track_uid: str) -> dict[str, Any]:
    with read_scope() as session:
        exists = session.execute(
            text(
                """
                SELECT 1
                FROM global_catalog_tracks
                WHERE global_track_uid = :global_track_uid
                """
            ),
            {"global_track_uid": global_track_uid},
        ).first()
        if not exists:
            raise GlobalTrackNotFound(global_track_uid)

        local = (
            session.execute(
                text(
                    """
                    SELECT
                        COALESCE(s.local_id, t.local_track_id) AS local_track_id,
                        COALESCE(
                            s.local_entity_uid::text,
                            t.local_track_entity_uid::text
                        ) AS local_track_entity_uid
                    FROM global_catalog_tracks t
                    LEFT JOIN global_catalog_sources s
                      ON s.global_entity_uid = t.global_track_uid
                     AND s.entity_type = 'track'
                     AND s.source_kind = 'local'
                     AND NOT s.source_stale
                     AND s.source_deleted_at IS NULL
                    WHERE t.global_track_uid = :global_track_uid
                      AND (
                        s.local_id IS NOT NULL
                        OR s.local_entity_uid IS NOT NULL
                        OR t.local_track_id IS NOT NULL
                        OR t.local_track_entity_uid IS NOT NULL
                      )
                    ORDER BY
                        COALESCE(s.preferred_for_playback, true) DESC,
                        s.updated_at DESC NULLS LAST
                    LIMIT 1
                    """
                ),
                {"global_track_uid": global_track_uid},
            )
            .mappings()
            .first()
        )
        if local:
            return {
                "kind": "local",
                "local_track_id": local["local_track_id"],
                "local_track_entity_uid": local["local_track_entity_uid"],
            }

        remote = (
            session.execute(
                text(
                    """
                    SELECT
                        node_uid::text AS node_uid,
                        remote_entity_uid
                    FROM global_catalog_sources
                    WHERE entity_type = 'track'
                      AND global_entity_uid = :global_track_uid
                      AND source_kind = 'federated'
                      AND node_uid IS NOT NULL
                      AND remote_entity_uid IS NOT NULL
                      AND NOT source_stale
                      AND source_deleted_at IS NULL
                    ORDER BY
                        preferred_for_playback DESC,
                        match_confidence DESC,
                        updated_at DESC,
                        id ASC
                    LIMIT 1
                    """
                ),
                {"global_track_uid": global_track_uid},
            )
            .mappings()
            .first()
        )
        if remote:
            return {
                "kind": "remote",
                "node_uid": remote["node_uid"],
                "remote_entity_uid": remote["remote_entity_uid"],
            }

    raise NoPlayableGlobalTrack(global_track_uid)


__all__ = [
    "GlobalTrackNotFound",
    "NoPlayableGlobalTrack",
    "resolve_global_track_playback",
]
