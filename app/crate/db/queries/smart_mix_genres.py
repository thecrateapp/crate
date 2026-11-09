"""Genre reads of the Smart Mix planner (Smart Mix Stems, STEM-G1)."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope


def get_track_album_genres(
    entity_uids: Sequence[str], *, session: Session | None = None
) -> dict[str, dict[str, float]]:
    """Each track's album genres (taxonomy names) with their weights, in one query.

    A genre without a weight counts as 1.0. Tracks whose album has no genre are left
    out, so ``genre_beatmatch_prior`` sees them as unknown.
    """
    uids = list(dict.fromkeys(str(uid) for uid in entity_uids if uid))
    if not uids:
        return {}

    def _impl(current: Session) -> dict[str, dict[str, float]]:
        rows = current.execute(
            text(
                """
                SELECT track.entity_uid::text AS entity_uid,
                       genre.name,
                       COALESCE(album_genre.weight, 1.0) AS weight
                FROM library_tracks AS track
                JOIN album_genres AS album_genre ON album_genre.album_id = track.album_id
                JOIN genres AS genre ON genre.id = album_genre.genre_id
                WHERE track.entity_uid = ANY(CAST(:uids AS uuid[]))
                ORDER BY track.entity_uid, genre.name
                """
            ),
            {"uids": uids},
        ).mappings()
        genres: dict[str, dict[str, float]] = defaultdict(dict)
        for row in rows:
            genres[row["entity_uid"]][str(row["name"])] = float(row["weight"])
        return dict(genres)

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["get_track_album_genres"]
