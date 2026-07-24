from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope

EQ_SOURCE_ORDER = [
    "user_track_preset",
    "instance_track_preset",
    "instance_album_preset",
    "genre_taxonomy_preset",
    "audio_analysis_preset",
    "flat",
]


def get_sound_intelligence_health(*, session=None) -> dict:
    if session is None:
        with read_scope() as s:
            return get_sound_intelligence_health(session=s)

    eq_rows = (
        session.execute(
            text(
                """
                WITH track_sources AS (
                    SELECT
                        t.id,
                        CASE
                            WHEN EXISTS (
                                SELECT 1 FROM equalizer_presets ep
                                WHERE ep.scope = 'user'
                                  AND ep.target_type = 'track'
                                  AND ep.target_entity_uid = t.entity_uid
                            ) THEN 'user_track_preset'
                            WHEN EXISTS (
                                SELECT 1 FROM equalizer_presets ep
                                WHERE ep.scope = 'instance'
                                  AND ep.target_type = 'track'
                                  AND ep.target_entity_uid = t.entity_uid
                            ) THEN 'instance_track_preset'
                            WHEN EXISTS (
                                SELECT 1
                                FROM library_albums a
                                JOIN equalizer_presets ep
                                  ON ep.scope = 'instance'
                                 AND ep.target_type = 'album'
                                 AND ep.target_entity_uid = a.entity_uid
                                WHERE a.id = t.album_id
                            ) THEN 'instance_album_preset'
                            WHEN EXISTS (
                                SELECT 1
                                FROM album_genres ag
                                JOIN genres g ON g.id = ag.genre_id
                                JOIN genre_taxonomy_aliases alias
                                  ON alias.alias_slug = g.slug
                                JOIN genre_taxonomy_nodes node
                                  ON node.id = alias.genre_id
                                WHERE ag.album_id = t.album_id
                                  AND node.eq_gains IS NOT NULL
                            ) THEN 'genre_taxonomy_preset'
                            WHEN (
                                t.analysis_state = 'complete'
                                OR t.energy IS NOT NULL
                                OR t.danceability IS NOT NULL
                                OR t.loudness IS NOT NULL
                                OR t.dynamic_range IS NOT NULL
                            ) THEN 'audio_analysis_preset'
                            ELSE 'flat'
                        END AS source
                    FROM library_tracks t
                    WHERE t.entity_uid IS NOT NULL
                )
                SELECT source, COUNT(*)::INTEGER AS count
                FROM track_sources
                GROUP BY source
                """
            )
        )
        .mappings()
        .all()
    )
    counts = {source: 0 for source in EQ_SOURCE_ORDER}
    for row in eq_rows:
        counts[str(row["source"])] = int(row["count"] or 0)
    total_tracks = sum(counts.values())

    taxonomy_row = (
        session.execute(
            text(
                """
                WITH node_stats AS (
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
                    (SELECT count FROM raw_unmapped)::INTEGER AS unmapped_raw_count,
                    (SELECT total_edges FROM edge_stats)::INTEGER AS edge_count,
                    (SELECT locked_edges FROM edge_stats)::INTEGER AS locked_edge_count,
                    (SELECT manual_edges FROM edge_stats)::INTEGER AS manual_edge_count,
                    (SELECT ai_edges FROM edge_stats)::INTEGER AS ai_edge_count
                FROM node_stats
                """
            )
        )
        .mappings()
        .first()
    ) or {}

    return {
        "eq": {
            "total_tracks": total_tracks,
            "sources": [
                {
                    "source": source,
                    "count": counts[source],
                    "percent": round((counts[source] / total_tracks) * 100, 1)
                    if total_tracks
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
                "unmapped_raw_count",
                "edge_count",
                "locked_edge_count",
                "manual_edge_count",
                "ai_edge_count",
            )
        },
    }


__all__ = ["EQ_SOURCE_ORDER", "get_sound_intelligence_health"]
