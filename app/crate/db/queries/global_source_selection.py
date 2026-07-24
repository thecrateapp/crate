"""Persistence queries for canonical facet source selection."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope

_ENTITY_TABLES = {
    "artist": ("global_catalog_artists", "global_artist_uid"),
    "album": ("global_catalog_albums", "global_album_uid"),
    "track": ("global_catalog_tracks", "global_track_uid"),
}


def list_global_source_candidates(
    *, entity_type: str, global_entity_uid: str
) -> list[dict[str, Any]] | None:
    """Return active source rows, or ``None`` when the entity does not exist."""
    table_name, id_column = _ENTITY_TABLES[entity_type]
    with read_scope() as session:
        exists = session.execute(
            text(f"SELECT 1 FROM {table_name} WHERE {id_column} = :global_entity_uid"),
            {"global_entity_uid": global_entity_uid},
        ).first()
        if exists is None:
            return None

        rows = (
            session.execute(
                text(
                    """
                    SELECT
                        s.entity_type,
                        s.global_entity_uid::text AS global_entity_uid,
                        s.source_kind,
                        s.node_uid::text AS node_uid,
                        s.remote_entity_uid,
                        s.local_id,
                        s.local_entity_uid::text AS local_entity_uid,
                        s.source_revision,
                        s.source_payload_json,
                        s.match_confidence,
                        s.preferred_for_display,
                        s.preferred_for_artwork,
                        s.preferred_for_playback,
                        s.updated_at,
                        n.trust_state,
                        n.disabled_at,
                        n.health_json
                    FROM global_catalog_sources s
                    LEFT JOIN federation_nodes n ON n.node_uid = s.node_uid
                    WHERE s.entity_type = :entity_type
                      AND s.global_entity_uid = :global_entity_uid
                      AND NOT s.source_stale
                      AND s.source_deleted_at IS NULL
                    """
                ),
                {
                    "entity_type": entity_type,
                    "global_entity_uid": global_entity_uid,
                },
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


__all__ = ["list_global_source_candidates"]
