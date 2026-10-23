from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope

EQ_SOURCE_ORDER = [
    "genre_taxonomy_preset",
    "genre_taxonomy_inherited_preset",
    "no_genre_eq",
]


def get_sound_intelligence_health(*, session=None) -> dict:
    if session is None:
        with read_scope() as s:
            return get_sound_intelligence_health(session=s)

    taxonomy_row = (
        session.execute(
            text(
                """
                WITH RECURSIVE parent_walk AS (
                    SELECT
                        edge.source_genre_id AS node_id,
                        edge.target_genre_id AS ancestor_id,
                        1 AS depth,
                        ARRAY[edge.source_genre_id, edge.target_genre_id] AS path
                    FROM genre_taxonomy_edges edge
                    WHERE edge.relation_type = 'parent'
                    UNION ALL
                    SELECT
                        walk.node_id,
                        edge.target_genre_id,
                        walk.depth + 1,
                        walk.path || edge.target_genre_id
                    FROM parent_walk walk
                    JOIN genre_taxonomy_edges edge
                      ON edge.source_genre_id = walk.ancestor_id
                     AND edge.relation_type = 'parent'
                    WHERE walk.depth < 32
                      AND NOT edge.target_genre_id = ANY(walk.path)
                ),
                effective_genre_eq AS (
                    SELECT
                        node.id,
                        node.slug,
                        node.name,
                        node.eq_gains,
                        CASE
                            WHEN node.eq_gains IS NOT NULL THEN 'direct'
                            WHEN inherited.slug IS NOT NULL THEN 'inherited'
                            ELSE 'none'
                        END AS preset_source
                    FROM genre_taxonomy_nodes node
                    LEFT JOIN LATERAL (
                        SELECT ancestor.slug
                        FROM parent_walk walk
                        JOIN genre_taxonomy_nodes ancestor
                          ON ancestor.id = walk.ancestor_id
                        WHERE walk.node_id = node.id
                          AND ancestor.eq_gains IS NOT NULL
                        ORDER BY walk.depth, ancestor.slug
                        LIMIT 1
                    ) inherited ON TRUE
                ),
                node_stats AS (
                    SELECT
                        n.id,
                        n.slug,
                        n.is_top_level,
                        n.description,
                        n.eq_gains,
                        EXISTS (
                            SELECT 1
                            FROM genre_taxonomy_edges e
                            WHERE e.source_genre_id = n.id
                              AND e.relation_type = 'parent'
                        ) AS has_parent
                    FROM genre_taxonomy_nodes n
                ),
                raw_unmapped AS (
                    SELECT COUNT(*)::INTEGER AS count
                    FROM genres g
                    LEFT JOIN genre_taxonomy_aliases alias
                      ON alias.alias_slug = g.slug
                    WHERE alias.genre_id IS NULL
                ),
                edge_stats AS (
                    SELECT
                        COUNT(*)::INTEGER AS total_edges,
                        COUNT(*) FILTER (WHERE locked IS TRUE)::INTEGER AS locked_edges,
                        COUNT(*) FILTER (WHERE source = 'manual')::INTEGER AS manual_edges,
                        COUNT(*) FILTER (WHERE source IN ('llm', 'ai'))::INTEGER AS ai_edges
                    FROM genre_taxonomy_edges
                ),
                listening_genres AS (
                    SELECT genre_name, SUM(play_count)::numeric AS play_count
                    FROM user_genre_stats
                    WHERE stat_window = '90d' AND play_count > 0
                    GROUP BY genre_name
                ),
                listening_tokens AS (
                    SELECT DISTINCT
                        listening.genre_name,
                        listening.play_count,
                        trim(both '-' FROM regexp_replace(
                            lower(trim(token.value)), '[^a-z0-9]+', '-', 'g'
                        )) AS token_slug
                    FROM listening_genres listening
                    CROSS JOIN LATERAL regexp_split_to_table(
                        listening.genre_name, '[,;]'
                    ) AS token(value)
                ),
                tokens_with_count AS (
                    SELECT
                        genre_name,
                        play_count,
                        token_slug,
                        COUNT(*) OVER (PARTITION BY genre_name) AS token_count
                    FROM listening_tokens
                    WHERE token_slug <> ''
                ),
                listening_by_node AS (
                    SELECT
                        alias.genre_id AS node_id,
                        SUM(tokens.play_count / tokens.token_count)::numeric
                            AS weighted_play_count
                    FROM tokens_with_count tokens
                    JOIN genre_taxonomy_aliases alias
                      ON alias.alias_slug = tokens.token_slug
                    GROUP BY alias.genre_id
                ),
                listening_total AS (
                    SELECT COALESCE(SUM(play_count), 0)::numeric AS play_count
                    FROM listening_genres
                ),
                listening_priorities AS (
                    SELECT
                        effective.slug,
                        effective.name,
                        listening.weighted_play_count,
                        CASE WHEN total.play_count > 0 THEN
                            ROUND(
                                100 * listening.weighted_play_count
                                    / total.play_count,
                                1
                            )::float
                        ELSE 0 END AS listening_share_90d_pct
                    FROM effective_genre_eq effective
                    JOIN listening_by_node listening
                      ON listening.node_id = effective.id
                    CROSS JOIN listening_total total
                    WHERE effective.preset_source = 'none'
                      AND listening.weighted_play_count > 0
                    ORDER BY listening.weighted_play_count DESC, effective.name
                    LIMIT 6
                )
                SELECT
                    COUNT(*)::INTEGER AS node_count,
                    COUNT(*) FILTER (WHERE is_top_level IS TRUE)::INTEGER AS top_level_count,
                    COUNT(*) FILTER (
                        WHERE is_top_level IS NOT TRUE AND has_parent IS NOT TRUE
                    )::INTEGER AS orphan_count,
                    COUNT(*) FILTER (
                        WHERE description IS NULL OR trim(description) = ''
                    )::INTEGER AS missing_description_count,
                    COUNT(*) FILTER (WHERE eq_gains IS NULL)::INTEGER AS missing_direct_eq_count,
                    (SELECT COUNT(*)::INTEGER FROM effective_genre_eq
                     WHERE preset_source = 'direct') AS direct_eq_count,
                    (SELECT COUNT(*)::INTEGER FROM effective_genre_eq
                     WHERE preset_source = 'inherited') AS inherited_eq_count,
                    (SELECT COUNT(*)::INTEGER FROM effective_genre_eq
                     WHERE preset_source = 'none') AS missing_effective_eq_count,
                    (SELECT count FROM raw_unmapped)::INTEGER AS unmapped_raw_count,
                    (SELECT total_edges FROM edge_stats)::INTEGER AS edge_count,
                    (SELECT locked_edges FROM edge_stats)::INTEGER AS locked_edge_count,
                    (SELECT manual_edges FROM edge_stats)::INTEGER AS manual_edge_count,
                    (SELECT ai_edges FROM edge_stats)::INTEGER AS ai_edge_count,
                    COALESCE(
                        (
                            SELECT jsonb_agg(
                                jsonb_build_object(
                                    'slug', slug,
                                    'name', name,
                                    'weighted_play_count', ROUND(weighted_play_count, 1),
                                    'listening_share_90d_pct', listening_share_90d_pct
                                ) ORDER BY weighted_play_count DESC, name
                            )
                            FROM listening_priorities
                        ),
                        '[]'::jsonb
                    ) AS listening_priorities
                FROM node_stats
                """
            )
        )
        .mappings()
        .first()
    ) or {}

    node_count = int(taxonomy_row.get("node_count") or 0)
    counts = {
        "genre_taxonomy_preset": int(taxonomy_row.get("direct_eq_count") or 0),
        "genre_taxonomy_inherited_preset": int(
            taxonomy_row.get("inherited_eq_count") or 0
        ),
        "no_genre_eq": int(taxonomy_row.get("missing_effective_eq_count") or 0),
    }

    return {
        "eq": {
            "total_genres": node_count,
            "sources": [
                {
                    "source": source,
                    "count": counts[source],
                    "percent": round((counts[source] / node_count) * 100, 1)
                    if node_count
                    else 0.0,
                }
                for source in EQ_SOURCE_ORDER
            ],
        },
        "taxonomy": {
            key: int(taxonomy_row.get(key) or 0)
            for key in (
                "node_count",
                "top_level_count",
                "orphan_count",
                "missing_description_count",
                "missing_direct_eq_count",
                "missing_effective_eq_count",
                "unmapped_raw_count",
                "edge_count",
                "locked_edge_count",
                "manual_edge_count",
                "ai_edge_count",
            )
        },
        "listening_priorities": [
            {
                "slug": str(item["slug"]),
                "name": str(item["name"]),
                "weighted_play_count": float(item["weighted_play_count"] or 0),
                "listening_share_90d_pct": float(item["listening_share_90d_pct"] or 0),
            }
            for item in (taxonomy_row.get("listening_priorities") or [])
        ],
    }


__all__ = ["EQ_SOURCE_ORDER", "get_sound_intelligence_health"]
