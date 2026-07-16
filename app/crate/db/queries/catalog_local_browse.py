from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.queries.genres_library_catalog import get_all_genres
from crate.db.queries.genres_library_detail import get_genre_detail
from crate.db.tx import read_scope
from crate.genre_taxonomy import get_core_taxonomy_descriptor


def list_local_catalog_genres() -> list[dict]:
    grouped: dict[str, dict[str, Any]] = {}
    for genre in get_all_genres():
        slug = str(genre.get("canonical_slug") or genre.get("slug") or "").strip()
        if not slug:
            continue
        item = grouped.setdefault(
            slug,
            {
                "global_genre_uid": None,
                "canonical_slug": slug,
                "canonical_name": str(
                    genre.get("canonical_name") or genre.get("name") or slug
                ),
                "entity_count": 0,
                "artist_count": 0,
                "album_count": 0,
                "track_count": 0,
            },
        )
        item["artist_count"] += int(genre.get("artist_count") or 0)
        item["album_count"] += int(genre.get("album_count") or 0)
        item["entity_count"] = item["artist_count"] + item["album_count"]
    return sorted(
        grouped.values(),
        key=lambda item: (-item["entity_count"], item["canonical_name"]),
    )


def get_local_catalog_genre_detail(slug: str) -> dict | None:
    detail = get_genre_detail(slug, include_global_entities=False)
    if detail is None:
        return None
    payload = dict(detail)
    descriptor = get_core_taxonomy_descriptor()
    payload["taxonomy"] = {
        "id": descriptor["taxonomy_id"],
        "version": descriptor["version"],
        "digest": descriptor["digest"],
    }
    for key in ("artists", "albums", "related_genres", "shows"):
        payload.setdefault(key, [])
    return payload


_LOCAL_DECADE_WHERE = """
    la.name NOT LIKE '.%'
    AND COALESCE(la.folder_name, '') NOT LIKE '.%'
    AND EXISTS (
        SELECT 1
        FROM library_albums decade_album
        WHERE LOWER(decade_album.artist) = LOWER(la.name)
          AND substring(COALESCE(decade_album.year, ''), 1, 4) ~ '^[0-9]{4}$'
          AND CAST(substring(decade_album.year, 1, 4) AS INTEGER)
              BETWEEN :decade_start AND :decade_end
    )
"""


def get_local_decade_artists(
    *,
    decade_start: int,
    decade_end: int,
    page: int = 1,
    per_page: int = 50,
) -> dict:
    safe_page = max(1, int(page or 1))
    safe_per_page = max(1, min(int(per_page or 50), 120))
    params = {
        "decade_start": int(decade_start),
        "decade_end": int(decade_end),
        "limit": safe_per_page,
        "offset": (safe_page - 1) * safe_per_page,
    }
    with read_scope() as session:
        total = int(
            session.execute(
                text(
                    f"SELECT COUNT(*) FROM library_artists la WHERE {_LOCAL_DECADE_WHERE}"
                ),
                params,
            ).scalar()
            or 0
        )
        rows = (
            session.execute(
                text(
                    f"""
                    SELECT
                        la.id,
                        la.entity_uid::text AS entity_uid,
                        la.slug,
                        la.name,
                        la.album_count,
                        la.track_count,
                        la.total_size,
                        la.formats_json,
                        la.primary_format,
                        la.has_photo
                    FROM library_artists la
                    WHERE {_LOCAL_DECADE_WHERE}
                    ORDER BY la.name ASC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                params,
            )
            .mappings()
            .all()
        )

    items = []
    for row in rows:
        entity_uid = str(row["entity_uid"]) if row.get("entity_uid") else None
        items.append(
            {
                "id": row["id"],
                "entity_uid": entity_uid,
                "local_artist_entity_uid": entity_uid,
                "global_uid": None,
                "global_artist_uid": None,
                "slug": row.get("slug"),
                "name": row["name"],
                "albums": int(row.get("album_count") or 0),
                "tracks": int(row.get("track_count") or 0),
                "total_size_mb": round(int(row.get("total_size") or 0) / (1024**2)),
                "formats": row.get("formats_json")
                if isinstance(row.get("formats_json"), list)
                else [],
                "primary_format": row.get("primary_format"),
                "has_photo": bool(row.get("has_photo")),
                "has_issues": False,
                "popularity": None,
                "popularity_score": None,
                "popularity_confidence": None,
                "availability": {
                    "catalog": True,
                    "stream": True,
                    "import": False,
                    "local": True,
                    "remote": False,
                    "healthy": True,
                },
            }
        )
    return {
        "items": items,
        "total": total,
        "page": safe_page,
        "per_page": safe_per_page,
    }


__all__ = [
    "get_local_catalog_genre_detail",
    "get_local_decade_artists",
    "list_local_catalog_genres",
]
