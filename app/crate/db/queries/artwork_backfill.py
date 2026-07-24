"""Bounded keyset scans for persistent artwork backfills."""

from __future__ import annotations

from sqlalchemy import select, text

from crate.db.orm.library import LibraryAlbum, LibraryArtist
from crate.db.tx import read_scope


def list_artwork_backfill_artists(*, after_id: int = 0, limit: int = 100) -> list[dict]:
    capped_limit = max(1, min(int(limit), 1000))
    with read_scope() as session:
        rows = (
            session.execute(
                select(LibraryArtist.id, LibraryArtist.entity_uid)
                .where(
                    LibraryArtist.id.is_not(None),
                    LibraryArtist.id > max(0, int(after_id)),
                )
                .order_by(LibraryArtist.id)
                .limit(capped_limit)
            )
            .mappings()
            .all()
        )
    return [
        {
            "id": int(row["id"]),
            "entity_uid": str(row["entity_uid"]) if row["entity_uid"] else None,
        }
        for row in rows
    ]


def list_artwork_backfill_albums(*, after_id: int = 0, limit: int = 100) -> list[dict]:
    capped_limit = max(1, min(int(limit), 1000))
    with read_scope() as session:
        rows = (
            session.execute(
                select(LibraryAlbum.id, LibraryAlbum.entity_uid)
                .where(
                    LibraryAlbum.id > max(0, int(after_id)),
                    LibraryAlbum.quarantined_at.is_(None),
                )
                .order_by(LibraryAlbum.id)
                .limit(capped_limit)
            )
            .mappings()
            .all()
        )
    return [
        {
            "id": int(row["id"]),
            "entity_uid": str(row["entity_uid"]) if row["entity_uid"] else None,
        }
        for row in rows
    ]


def list_artwork_backfill_genres(
    *, after_slug: str = "", limit: int = 100
) -> list[dict]:
    capped_limit = max(1, min(int(limit), 1000))
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT slug, cover_path
                    FROM genre_taxonomy_nodes
                    WHERE slug > :after_slug
                      AND cover_path IS NOT NULL
                      AND cover_path <> ''
                    ORDER BY slug
                    LIMIT :limit
                    """
                ),
                {
                    "after_slug": (after_slug or "").strip().lower(),
                    "limit": capped_limit,
                },
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


__all__ = [
    "list_artwork_backfill_albums",
    "list_artwork_backfill_artists",
    "list_artwork_backfill_genres",
]
