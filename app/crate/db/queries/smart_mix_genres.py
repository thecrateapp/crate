"""Genre reads of the Smart Mix planner (Smart Mix Stems, STEM-G1)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope


@dataclass(frozen=True, slots=True)
class TrackGenres:
    """A track's album genres and its artist's genres (taxonomy names to weights)."""

    album: Mapping[str, float] = field(default_factory=dict)
    artist: Mapping[str, float] = field(default_factory=dict)


def get_track_genres(
    entity_uids: Sequence[str], *, session: Session | None = None
) -> dict[str, TrackGenres]:
    """Each track's album genres and artist genres with their weights, in one query.

    Artist genres are matched on the track's artist name, case and surrounding space
    aside, as radio reads them. A genre without a weight counts as 1.0. Tracks with
    no genre at all are left out.
    """
    uids = list(dict.fromkeys(str(uid) for uid in entity_uids if uid))
    if not uids:
        return {}

    def _impl(current: Session) -> dict[str, TrackGenres]:
        rows = current.execute(
            text(
                """
                SELECT track.entity_uid::text AS entity_uid, 'album' AS source,
                       genre.name, COALESCE(album_genre.weight, 1.0) AS weight
                FROM library_tracks AS track
                JOIN album_genres AS album_genre ON album_genre.album_id = track.album_id
                JOIN genres AS genre ON genre.id = album_genre.genre_id
                WHERE track.entity_uid = ANY(CAST(:uids AS uuid[]))
                UNION ALL
                SELECT track.entity_uid::text, 'artist', genre.name,
                       COALESCE(artist_genre.weight, 1.0)
                FROM library_tracks AS track
                JOIN artist_genres AS artist_genre
                    ON lower(trim(artist_genre.artist_name)) = lower(trim(track.artist))
                JOIN genres AS genre ON genre.id = artist_genre.genre_id
                WHERE track.entity_uid = ANY(CAST(:uids AS uuid[]))
                ORDER BY 1, 2, 3
                """
            ),
            {"uids": uids},
        ).mappings()
        found: dict[str, dict[str, dict[str, float]]] = {}
        for row in rows:
            sources = found.setdefault(row["entity_uid"], {"album": {}, "artist": {}})
            sources[row["source"]][str(row["name"])] = float(row["weight"])
        return {
            uid: TrackGenres(album=sources["album"], artist=sources["artist"])
            for uid, sources in found.items()
        }

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["TrackGenres", "get_track_genres"]
