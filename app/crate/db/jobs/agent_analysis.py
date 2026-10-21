"""Exact, generation-bound maintenance requeue."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.jobs.analysis_generations import lock_processing_rows
from crate.db.jobs.analysis_state_events import (
    append_pipeline_event,
    mark_ops_snapshot_dirty,
)
from crate.db.queries.agent_analysis import (
    analysis_targets_version,
    read_analysis_targets,
)
from crate.db.tx import optional_scope


def requeue_analysis_targets(
    track_uids: list[str],
    pipelines: list[str],
    *,
    expected_version: str,
    mode: str,
    session=None,
) -> dict:
    if mode not in {"pending", "refresh"}:
        raise ValueError("Unsupported analysis mode")
    with optional_scope(session) as current:
        before = read_analysis_targets(track_uids, pipelines, session=current)
        ids = [t["id"] for t in before["tracks"]]
        lock_processing_rows(current, ids, pipelines)
        current.execute(
            text(
                "INSERT INTO track_processing_state(track_id,pipeline,state) SELECT t.id,p.pipeline,CASE WHEN p.pipeline='analysis' THEN COALESCE(t.analysis_state,'pending') ELSE COALESCE(t.bliss_state,'pending') END FROM library_tracks t CROSS JOIN unnest(CAST(:pipelines AS text[])) p(pipeline) WHERE t.id=ANY(:ids) ON CONFLICT(track_id,pipeline) DO NOTHING"
            ),
            {"ids": ids, "pipelines": pipelines},
        )
        state = read_analysis_targets(
            track_uids, pipelines, session=current, locked=True, require_all=False
        )
        if analysis_targets_version(state) != expected_version:
            return {"status": "conflict", "code": "SOURCE_CHANGED", "references": []}
        uids_by_id = {t["id"]: t["entity_uid"] for t in state["tracks"]}
        references = []
        for row in state["processing"]:
            if mode == "pending" and row["state"] != "pending":
                continue
            generation = current.execute(
                text(
                    "UPDATE track_processing_state SET state='pending',generation=generation+1,claim_token=NULL,pipeline_signature=NULL,claimed_by=NULL,claimed_at=NULL,last_error=NULL,completed_at=NULL,updated_at=NOW() WHERE track_id=:id AND pipeline=:pipeline RETURNING generation"
                ),
                {"id": row["track_id"], "pipeline": row["pipeline"]},
            ).scalar_one()
            column = (
                "analysis_state" if row["pipeline"] == "analysis" else "bliss_state"
            )
            current.execute(
                text(f"UPDATE library_tracks SET {column}='pending' WHERE id=:id"),
                {"id": row["track_id"]},
            )
            append_pipeline_event(
                current,
                pipeline=row["pipeline"],
                track_id=row["track_id"],
                state="pending",
            )
            references.append(
                {
                    "track_uid": uids_by_id[row["track_id"]],
                    "pipeline": row["pipeline"],
                    "generation": generation,
                }
            )
        if references:
            mark_ops_snapshot_dirty(current)
        return {
            "status": "requeued" if references else "skipped",
            "references": references,
        }


__all__ = ["requeue_analysis_targets"]
