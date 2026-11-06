"""Reads of the Smart Mix refinement task (SM4.PR2)."""

from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope


def get_track_genre_slugs(
    entity_uids: Sequence[str], *, session: Session | None = None
) -> dict[str, str | None]:
    """Each track's main album genre slug (highest weight), or None, in one query."""
    uids = list(dict.fromkeys(str(uid) for uid in entity_uids if uid))
    if not uids:
        return {}

    def _impl(current: Session) -> dict[str, str | None]:
        rows = current.execute(
            text(
                """
                SELECT track.entity_uid::text AS entity_uid, top.slug
                FROM library_tracks AS track
                LEFT JOIN LATERAL (
                    SELECT genre.slug
                    FROM album_genres AS album_genre
                    JOIN genres AS genre ON genre.id = album_genre.genre_id
                    WHERE album_genre.album_id = track.album_id
                    ORDER BY album_genre.weight DESC NULLS LAST, genre.slug
                    LIMIT 1
                ) AS top ON true
                WHERE track.entity_uid = ANY(CAST(:uids AS uuid[]))
                """
            ),
            {"uids": uids},
        ).mappings()
        return {row["entity_uid"]: row["slug"] for row in rows}

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["get_track_genre_slugs"]
