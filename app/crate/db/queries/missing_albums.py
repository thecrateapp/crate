"""Indexed local album inventory for missing-discography comparisons."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope


def get_artist_album_inventory(
    artist: str, *, session: Session | None = None
) -> dict | None:
    """Resolve a local artist and its non-quarantined albums in one read."""

    def _impl(current: Session) -> dict | None:
        rows = (
            current.execute(
                text(
                    """
                    WITH matched_artist AS (
                        SELECT id, name
                        FROM library_artists
                        WHERE LOWER(name) = LOWER(:artist)
                           OR folder_name = :artist
                        ORDER BY id
                        LIMIT 1
                    )
                    SELECT artist.name AS artist_name,
                           album.id AS album_id,
                           album.name,
                           COALESCE(album.tag_album, '') AS album_tag,
                           album.musicbrainz_releasegroupid AS mbid,
                           COALESCE(album.track_count, 0) AS track_count
                    FROM matched_artist artist
                    LEFT JOIN library_albums album
                      ON album.artist = artist.name
                     AND album.quarantined_at IS NULL
                    ORDER BY album.year, album.name
                    """
                ),
                {"artist": artist},
            )
            .mappings()
            .all()
        )
        if not rows:
            return None
        canonical_name = rows[0]["artist_name"]
        return {
            "artist": canonical_name,
            "local": [
                {
                    "name": row["name"],
                    "album_tag": row["album_tag"],
                    "mbid": row["mbid"],
                    "track_count": row["track_count"],
                }
                for row in rows
                if row["album_id"] is not None
            ],
        }

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["get_artist_album_inventory"]
