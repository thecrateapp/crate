from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import transaction_scope
from crate.genre_taxonomy import invalidate_runtime_taxonomy_cache_after_commit


def _normalize_slug(value: str | None) -> str:
    return (value or "").strip().lower()


def delete_library_genre(slug: str, *, session=None) -> dict | None:
    normalized_slug = _normalize_slug(slug)
    if not normalized_slug:
        return None
    if session is None:
        with transaction_scope() as s:
            return delete_library_genre(normalized_slug, session=s)

    row = (
        session.execute(
            text(
                """
                SELECT
                    g.id,
                    g.name,
                    g.slug,
                    COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
                    COUNT(DISTINCT alg.album_id)::INTEGER AS album_count
                FROM genres g
                LEFT JOIN artist_genres ag ON ag.genre_id = g.id
                LEFT JOIN album_genres alg ON alg.genre_id = g.id
                WHERE g.slug = :slug
                GROUP BY g.id, g.name, g.slug
                """
            ),
            {"slug": normalized_slug},
        )
        .mappings()
        .first()
    )
    if not row:
        return None

    genre_id = int(row["id"])
    artist_count = int(row["artist_count"] or 0)
    album_count = int(row["album_count"] or 0)

    session.execute(
        text("DELETE FROM artist_genres WHERE genre_id = :genre_id"),
        {"genre_id": genre_id},
    )
    session.execute(
        text("DELETE FROM album_genres WHERE genre_id = :genre_id"),
        {"genre_id": genre_id},
    )
    session.execute(
        text(
            """
            DELETE FROM genre_taxonomy_aliases
            WHERE alias_slug = :slug
               OR LOWER(TRIM(alias_name)) = LOWER(TRIM(:name))
            """
        ),
        {"slug": row["slug"], "name": row["name"]},
    )
    session.execute(
        text("DELETE FROM genres WHERE id = :genre_id"), {"genre_id": genre_id}
    )
    invalidate_runtime_taxonomy_cache_after_commit(session)
    return {
        "slug": row["slug"],
        "name": row["name"],
        "deleted_library_genres": 1,
        "deleted_taxonomy_nodes": 0,
        "removed_artist_assignments": artist_count,
        "removed_album_assignments": album_count,
        "removed_raw_genres": [row["slug"]],
    }


def delete_taxonomy_genre(slug: str, *, session=None) -> dict | None:
    normalized_slug = _normalize_slug(slug)
    if not normalized_slug:
        return None
    if session is None:
        with transaction_scope() as s:
            return delete_taxonomy_genre(normalized_slug, session=s)

    node = (
        session.execute(
            text("SELECT id, slug, name FROM genre_taxonomy_nodes WHERE slug = :slug"),
            {"slug": normalized_slug},
        )
        .mappings()
        .first()
    )
    if not node:
        return None

    node_id = int(node["id"])
    alias_rows = (
        session.execute(
            text(
                """
                SELECT alias_slug, alias_name
                FROM genre_taxonomy_aliases
                WHERE genre_id = :node_id
                """
            ),
            {"node_id": node_id},
        )
        .mappings()
        .all()
    )
    alias_slugs = sorted({str(row["alias_slug"]) for row in alias_rows})
    alias_names = sorted({str(row["alias_name"]) for row in alias_rows})
    candidate_slugs = sorted({node["slug"], *alias_slugs})

    raw_rows = (
        session.execute(
            text(
                """
                SELECT id, slug
                FROM genres
                WHERE slug = ANY(:candidate_slugs)
                   OR LOWER(TRIM(name)) = ANY(:alias_names)
                """
            ),
            {
                "candidate_slugs": candidate_slugs,
                "alias_names": [name.strip().lower() for name in alias_names],
            },
        )
        .mappings()
        .all()
    )
    raw_ids = [int(row["id"]) for row in raw_rows]
    raw_slugs = sorted({str(row["slug"]) for row in raw_rows})

    artist_count = 0
    album_count = 0
    if raw_ids:
        counts = (
            session.execute(
                text(
                    """
                    SELECT
                        (SELECT COUNT(*)::INTEGER FROM artist_genres WHERE genre_id = ANY(:raw_ids)) AS artist_count,
                        (SELECT COUNT(*)::INTEGER FROM album_genres WHERE genre_id = ANY(:raw_ids)) AS album_count
                    """
                ),
                {"raw_ids": raw_ids},
            )
            .mappings()
            .first()
        )
        artist_count = int(counts["artist_count"] or 0) if counts else 0
        album_count = int(counts["album_count"] or 0) if counts else 0
        session.execute(
            text("DELETE FROM artist_genres WHERE genre_id = ANY(:raw_ids)"),
            {"raw_ids": raw_ids},
        )
        session.execute(
            text("DELETE FROM album_genres WHERE genre_id = ANY(:raw_ids)"),
            {"raw_ids": raw_ids},
        )
        session.execute(
            text("DELETE FROM genres WHERE id = ANY(:raw_ids)"),
            {"raw_ids": raw_ids},
        )

    session.execute(
        text(
            """
            DELETE FROM genre_taxonomy_edges
            WHERE source_genre_id = :node_id OR target_genre_id = :node_id
            """
        ),
        {"node_id": node_id},
    )
    session.execute(
        text("DELETE FROM genre_taxonomy_aliases WHERE genre_id = :node_id"),
        {"node_id": node_id},
    )
    session.execute(
        text("DELETE FROM genre_taxonomy_nodes WHERE id = :node_id"),
        {"node_id": node_id},
    )
    invalidate_runtime_taxonomy_cache_after_commit(session)
    return {
        "slug": node["slug"],
        "name": node["name"],
        "deleted_library_genres": len(raw_ids),
        "deleted_taxonomy_nodes": 1,
        "removed_artist_assignments": artist_count,
        "removed_album_assignments": album_count,
        "removed_raw_genres": raw_slugs,
    }


__all__ = ["delete_library_genre", "delete_taxonomy_genre"]
