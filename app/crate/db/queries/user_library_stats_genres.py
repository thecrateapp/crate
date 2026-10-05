from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from crate.genre_taxonomy import resolve_genre_slug, slugify_genre


def weighted_genre_split_sql(source_sql: str) -> str:
    return f"""
        WITH source AS (
            {source_sql}
        ),
        totals AS (
            SELECT COALESCE(SUM(play_count), 0)::double precision AS total_plays
            FROM source
        ),
        row_labels AS (
            SELECT DISTINCT ON (source.genre_name, LOWER(TRIM(part.label)))
                source.genre_name,
                LOWER(TRIM(part.label)) AS genre_key,
                TRIM(part.label) AS label
            FROM source
            CROSS JOIN LATERAL unnest(string_to_array(source.genre_name, ',')) AS part(label)
            WHERE TRIM(part.label) <> ''
            ORDER BY source.genre_name, LOWER(TRIM(part.label)), TRIM(part.label)
        ),
        label_counts AS (
            SELECT genre_name, COUNT(*)::double precision AS label_count
            FROM row_labels
            GROUP BY genre_name
        ),
        weighted AS (
            SELECT
                row_labels.genre_key,
                MIN(row_labels.label) AS genre_name,
                SUM(source.play_count / label_counts.label_count) AS weight,
                SUM(source.complete_play_count / label_counts.label_count) AS complete_weight,
                SUM(source.minutes_listened / label_counts.label_count) AS minutes_listened,
                MIN(source.first_played_at) AS first_played_at,
                MAX(source.last_played_at) AS last_played_at
            FROM row_labels
            JOIN source ON source.genre_name = row_labels.genre_name
            JOIN label_counts ON label_counts.genre_name = row_labels.genre_name
            GROUP BY row_labels.genre_key
        )
        SELECT
            weighted.genre_name,
            weighted.weight,
            weighted.complete_weight,
            weighted.minutes_listened,
            weighted.first_played_at,
            weighted.last_played_at,
            CASE
                WHEN totals.total_plays > 0 THEN weighted.weight / totals.total_plays
                ELSE 0
            END AS share
        FROM weighted
        CROSS JOIN totals
        ORDER BY weighted.weight DESC, weighted.minutes_listened DESC, weighted.genre_key
        LIMIT :lim
    """


def format_weighted_genre_rows(rows: list[Mapping[str, Any]]) -> list[dict]:
    items: list[dict] = []
    for row in rows:
        name = str(row["genre_name"])
        weight = float(row["weight"] or 0)
        items.append(
            {
                "genre_name": name,
                "slug": resolve_genre_slug(name) or slugify_genre(name) or None,
                "play_count": round(weight),
                "complete_play_count": round(float(row["complete_weight"] or 0)),
                "minutes_listened": float(row["minutes_listened"] or 0),
                "weight": weight,
                "share": float(row["share"] or 0),
                "first_played_at": row.get("first_played_at"),
                "last_played_at": row.get("last_played_at"),
            }
        )
    return items


__all__ = ["format_weighted_genre_rows", "weighted_genre_split_sql"]
