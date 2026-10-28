from __future__ import annotations

import json

from sqlalchemy import text

from crate.db.tx import optional_scope
from crate.genre_facets import normalize_genre_facets


def update_raw_genre_classification(
    slug: str,
    classification: str,
    facets: list[dict] | None = None,
    *,
    session=None,
) -> dict | None:
    """Classify an unmapped library tag without changing its genre assignments."""

    canonical_slug = (slug or "").strip().lower()
    normalized_classification = (classification or "").strip().lower()
    if normalized_classification not in {"genre", "facet", "hybrid", "ignore"}:
        raise ValueError("Unsupported raw genre classification")
    normalized_facets = normalize_genre_facets(facets)
    if normalized_classification not in {"facet", "hybrid"} and normalized_facets:
        raise ValueError("Only facet and hybrid classifications can have facet values")
    if not canonical_slug:
        return None

    with optional_scope(session) as current:
        row = (
            current.execute(
                text(
                    """
                SELECT
                    g.id,
                    EXISTS (
                        SELECT 1 FROM genre_taxonomy_aliases alias
                        WHERE alias.alias_slug = g.slug
                           OR LOWER(TRIM(alias.alias_name)) = LOWER(TRIM(g.name))
                    ) AS is_mapped
                FROM genres g
                WHERE LOWER(g.slug) = :slug
                """
                ),
                {"slug": canonical_slug},
            )
            .mappings()
            .first()
        )
        if row is None:
            return None
        if row["is_mapped"]:
            raise ValueError("Mapped raw genres cannot be classified")

        genre_id = int(row["id"])
        current.execute(
            text(
                """
                INSERT INTO genre_taxonomy_raw_tag_classifications (
                    genre_id, classification, updated_at
                ) VALUES (:genre_id, :classification, NOW())
                ON CONFLICT (genre_id) DO UPDATE
                SET classification = EXCLUDED.classification,
                    updated_at = NOW()
                """
            ),
            {"genre_id": genre_id, "classification": normalized_classification},
        )

        facets_json = json.dumps(normalized_facets, separators=(",", ":"))
        if normalized_facets:
            current.execute(
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
        current.execute(
            text(
                "DELETE FROM genre_taxonomy_raw_tag_facets WHERE genre_id = :genre_id"
            ),
            {"genre_id": genre_id},
        )
        if normalized_facets:
            current.execute(
                text(
                    """
                    INSERT INTO genre_taxonomy_raw_tag_facets (genre_id, facet_id)
                    SELECT :genre_id, value.id
                    FROM jsonb_to_recordset(CAST(:facets AS JSONB))
                        AS incoming(dimension TEXT, slug TEXT, name TEXT)
                    JOIN genre_taxonomy_facet_values value
                      ON value.dimension = incoming.dimension
                     AND value.slug = incoming.slug
                    ON CONFLICT (genre_id, facet_id) DO NOTHING
                    """
                ),
                {"genre_id": genre_id, "facets": facets_json},
            )

    return {
        "slug": canonical_slug,
        "classification": normalized_classification,
        "facets": normalized_facets,
    }


def clear_raw_genre_classification(slug: str, *, session=None) -> None:
    """Remove facet classification after the raw tag becomes a genre alias."""

    canonical_slug = (slug or "").strip().lower()
    if not canonical_slug:
        return
    with optional_scope(session) as current:
        current.execute(
            text(
                """
                DELETE FROM genre_taxonomy_raw_tag_classifications classification
                USING genres g
                WHERE classification.genre_id = g.id
                  AND LOWER(g.slug) = :slug
                """
            ),
            {"slug": canonical_slug},
        )


__all__ = ["clear_raw_genre_classification", "update_raw_genre_classification"]
