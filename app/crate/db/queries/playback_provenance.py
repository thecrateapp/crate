"""Read-side lookup for local playback content provenance."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_imported_track_source_node_uid(track_id: int) -> str | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT request.node_uid::text AS source_node_uid
                    FROM library_tracks track
                    JOIN federation_import_requests request
                      ON request.status = 'completed'
                     AND request.metadata_json #>> '{provenance,local_album_id}'
                         = track.album_id::text
                    WHERE track.id = :track_id
                    ORDER BY request.completed_at DESC NULLS LAST, request.id DESC
                    LIMIT 1
                    """
                ),
                {"track_id": track_id},
            )
            .mappings()
            .first()
        )
    if not row or not row.get("source_node_uid"):
        return None
    return str(row["source_node_uid"])


__all__ = ["get_imported_track_source_node_uid"]
