"""Admin APIs for the canonical global catalog."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from crate.api.permissions import require_permission
from crate.db.queries.global_catalog import get_global_catalog_counts
from crate.db.repositories.global_catalog_state import get_catalog_state
from crate.db.repositories.tasks import create_task_dedup
from crate.db.tx import read_scope
from crate.federation.global_decisions import record_match_decision

router = APIRouter(prefix="/api/admin/global-catalog", tags=["admin"])


class ReconcileRequest(BaseModel):
    mode: str = Field("incremental", pattern="^(incremental|full)$")


class DecisionRequest(BaseModel):
    entity_type: str
    decision_type: str
    source_a: dict[str, Any]
    source_b: dict[str, Any]
    target_global_uid: str | None = None
    reason: str | None = None


@router.get("/status")
def global_catalog_status(request: Request):
    require_permission(request, "federation.nodes.view")
    return get_global_catalog_admin_status()


@router.get("/runs")
def global_catalog_runs(request: Request, limit: int = 25):
    require_permission(request, "federation.nodes.view")
    return {"items": list_global_catalog_runs(limit=limit)}


@router.get("/duplicates")
def global_catalog_duplicates(request: Request, limit: int = 50):
    require_permission(request, "federation.nodes.view")
    return {"items": list_global_catalog_duplicate_candidates(limit=limit)}


@router.post("/reconcile")
def global_catalog_reconcile(request: Request, body: ReconcileRequest):
    require_permission(request, "federation.policy.manage")
    task_type = (
        "global_catalog_reconcile_full"
        if body.mode == "full"
        else "global_catalog_reconcile_incremental"
    )
    task_id = create_task_dedup(
        task_type,
        {"triggered_by": "admin"},
        dedup_key=f"manual:{task_type}",
    )
    return {"task_id": task_id, "status": "queued"}


@router.post("/decisions")
def global_catalog_decision(request: Request, body: DecisionRequest):
    user = require_permission(request, "federation.policy.manage")
    return record_match_decision(
        entity_type=body.entity_type,
        decision_type=body.decision_type,
        source_a=body.source_a,
        source_b=body.source_b,
        target_global_uid=body.target_global_uid,
        reason=body.reason,
        admin_user_id=int(user["id"]),
    )


def get_global_catalog_admin_status() -> dict[str, Any]:
    counts = get_global_catalog_counts()
    state = get_catalog_state()
    from crate.genre_taxonomy import get_core_taxonomy_descriptor

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


def list_global_catalog_duplicate_candidates(limit: int = 50) -> list[dict[str, Any]]:
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
    "router",
]
