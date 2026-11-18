"""Reads the federated search router needs about the local library."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope


def local_artist_album_counts(
    names: list[str], *, session: Session | None = None
) -> dict[str, int]:
    """Return `{lower(name): album_count}` for the local artists named.

    Reads the precomputed `library_artists.album_count`; never counts tracks.
    """

    def _impl(current: Session) -> dict[str, int]:
        rows = current.execute(
            text(
                """
                SELECT LOWER(name) AS name_key,
                       MAX(COALESCE(album_count, 0))::integer AS album_count
                FROM library_artists
                WHERE LOWER(name) = ANY(:names)
                GROUP BY LOWER(name)
                """
            ),
            {"names": sorted({name.lower() for name in names})},
        ).mappings()
        return {row["name_key"]: int(row["album_count"]) for row in rows}

    if not names:
        return {}
    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["local_artist_album_counts"]
