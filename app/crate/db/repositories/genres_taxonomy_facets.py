from __future__ import annotations

import json

from sqlalchemy import text

from crate.db.tx import transaction_scope
from crate.genre_facets import normalize_genre_facets
from crate.genre_taxonomy import invalidate_runtime_taxonomy_cache_after_commit


def replace_genre_taxonomy_facets(
    slug: str, facets: list[dict], *, session=None
) -> list[dict]:
    """Replace a taxonomy node's non-hierarchical facet assignments."""

    canonical_slug = (slug or "").strip().lower()
    if not canonical_slug:
        return []
    normalized = normalize_genre_facets(facets)
    if session is None:
        with transaction_scope() as current:
            return replace_genre_taxonomy_facets(
                canonical_slug, normalized, session=current
            )

    node_id = session.execute(
        text("SELECT id FROM genre_taxonomy_nodes WHERE slug = :slug"),
        {"slug": canonical_slug},
    ).scalar_one_or_none()
    if node_id is None:
        return []

    facets_json = json.dumps(normalized, separators=(",", ":"))
    if normalized:
        session.execute(
            text(
                """
                INSERT INTO genre_taxonomy_facet_values (dimension, slug, name)
                SELECT incoming.dimension, incoming.slug, incoming.name
                FROM jsonb_to_recordset(CAST(:facets AS JSONB))
                    AS incoming(dimension TEXT, slug TEXT, name TEXT)
                ON CONFLICT (dimension, slug) DO UPDATE
                SET name = EXCLUDED.name
                """
            ),
            {"facets": facets_json},
        )

    session.execute(
        text(
            "DELETE FROM genre_taxonomy_node_facets WHERE genre_id = :genre_id"
        ),
        {"genre_id": node_id},
    )
    if normalized:
        session.execute(
            text(
                """
                INSERT INTO genre_taxonomy_node_facets (genre_id, facet_id)
                SELECT :genre_id, value.id
                FROM jsonb_to_recordset(CAST(:facets AS JSONB))
                    AS incoming(dimension TEXT, slug TEXT, name TEXT)
                JOIN genre_taxonomy_facet_values value
                  ON value.dimension = incoming.dimension
                 AND value.slug = incoming.slug
                ON CONFLICT (genre_id, facet_id) DO NOTHING
                """
            ),
            {"genre_id": node_id, "facets": facets_json},
        )

    invalidate_runtime_taxonomy_cache_after_commit(session)
    return normalized


__all__ = ["replace_genre_taxonomy_facets"]
