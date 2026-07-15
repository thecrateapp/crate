"""Read models for the global catalog Admin surface."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.queries.global_catalog import get_global_catalog_counts
from crate.db.repositories import global_catalog_state
from crate.db.tx import read_scope
from crate.genre_taxonomy import get_core_taxonomy_descriptor


def get_global_catalog_admin_status() -> dict[str, Any]:
    counts = get_global_catalog_counts()
    state = global_catalog_state.get_catalog_state()
    descriptor = get_core_taxonomy_descriptor()
    with read_scope() as session:
        last_run = (
            session.execute(
                text(
                    """
                    SELECT
                        run_id::text AS run_id,
                        mode,
                        status,
                        started_at,
                        completed_at,
                        source_rows_seen,
                        sources_upserted,
                        canonical_created,
                        canonical_updated,
                        error
                    FROM global_catalog_reconciliation_runs
                    ORDER BY started_at DESC
                    LIMIT 1
                    """
                )
            )
            .mappings()
            .first()
        )
        stale_peer_count = int(
            session.execute(
                text(
                    """
                    SELECT COUNT(DISTINCT node_uid)
                    FROM global_catalog_sources
                    WHERE source_kind = 'federated'
                      AND source_stale = true
                    """
                )
            ).scalar()
            or 0
        )
        ambiguous_candidate_count = int(
            session.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM global_catalog_sources
                    WHERE match_confidence >= 0.850
                      AND match_confidence < 0.950
                    """
                )
            ).scalar()
            or 0
        )
        genre_projection = (
            session.execute(
                text(
                    """
                    SELECT
                        COUNT(*) FILTER (WHERE invalidated_at IS NULL)::integer AS active_assertions,
                        COUNT(*) FILTER (
                            WHERE invalidated_at IS NULL AND global_genre_uid IS NULL
                        )::integer AS unmapped_assertions,
                        (
                            SELECT COUNT(*)::integer
                            FROM global_catalog_entity_genres
                        ) AS memberships
                    FROM global_catalog_genre_assertions
                    """
                )
            )
            .mappings()
            .one()
        )
    return {
        "state": state,
        "counts": counts,
        "taxonomy": {
            "id": descriptor["taxonomy_id"],
            "version": descriptor["version"],
            "digest": descriptor["digest"],
        },
        "genre_projection": dict(genre_projection),
        "last_run": dict(last_run) if last_run else None,
        "stale_peer_count": stale_peer_count,
        "ambiguous_candidate_count": ambiguous_candidate_count,
    }


def list_global_catalog_runs(limit: int = 25) -> list[dict[str, Any]]:
    capped = max(1, min(int(limit or 25), 100))
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT
                        run_id::text AS run_id,
                        mode,
                        status,
                        started_at,
                        completed_at,
                        peer_count,
                        source_rows_seen,
                        sources_upserted,
                        canonical_created,
                        canonical_updated,
                        auto_merged,
                        ambiguous_candidates,
                        error,
                        metadata_json
                    FROM global_catalog_reconciliation_runs
                    ORDER BY started_at DESC
                    LIMIT :limit
                    """
                ),
                {"limit": capped},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def list_global_catalog_duplicate_candidates(
    limit: int = 50,
) -> list[dict[str, Any]]:
    capped = max(1, min(int(limit or 50), 200))
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT
                        entity_type,
                        match_key,
                        COUNT(*) AS source_count,
                        JSONB_AGG(
                            JSONB_BUILD_OBJECT(
                                'source_kind', source_kind,
                                'node_uid', node_uid,
                                'remote_entity_uid', remote_entity_uid,
                                'local_entity_uid', local_entity_uid,
                                'global_entity_uid', global_entity_uid,
                                'match_confidence', match_confidence,
                                'match_method', match_method
                            )
                            ORDER BY preferred_for_display DESC, source_kind ASC
                        ) AS sources
                    FROM global_catalog_sources
                    WHERE match_confidence >= 0.850
                    GROUP BY entity_type, match_key
                    HAVING COUNT(*) > 1
                    ORDER BY source_count DESC, entity_type ASC, match_key ASC
                    LIMIT :limit
                    """
                ),
                {"limit": capped},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


__all__ = [
    "get_global_catalog_admin_status",
    "list_global_catalog_duplicate_candidates",
    "list_global_catalog_runs",
]
