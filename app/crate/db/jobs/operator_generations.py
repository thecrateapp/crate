"""Existing DSP generations retain operator proof and fail durably at claim/write."""

import json

from sqlalchemy import text

from crate.agent_diagnostics import DiagnosticError
from crate.analysis_provenance import source_identity
from crate.db.jobs.analysis_state_events import (
    append_pipeline_event,
    mark_ops_snapshot_dirty,
)
from crate.db.repositories.agent_descendants import parent_reference, validate_parent


def bind_generation(session, *, track_id, pipelines, task_id, source):
    reference = parent_reference(task_id, session=session)
    session.execute(
        text(
            "UPDATE track_processing_state SET operator_authority=jsonb_build_object('parent',CAST(:parent AS jsonb),'generation',generation,'source',CAST(:source AS jsonb)) WHERE track_id=:id AND pipeline=ANY(:pipelines)"
        ),
        {
            "parent": json.dumps(reference),
            "source": json.dumps(source),
            "id": track_id,
            "pipelines": pipelines,
        },
    )


def allowed_generation_ids(session, *, rows, pipeline):
    allowed = set()
    for row in rows:
        track_id = int(row["track_id"])
        authority = row.get("operator_authority")
        if authority is None:
            allowed.add(track_id)
            continue
        try:
            if int(row["generation"]) != authority["generation"] or authority.get(
                "denied"
            ):
                raise DiagnosticError(
                    "PLAN_STALE", "Operator generation was reset or previously denied"
                )
            validate_parent(authority["parent"], session=session)
            path = session.execute(
                text("SELECT path FROM library_tracks WHERE id=:id"), {"id": track_id}
            ).scalar_one()
            if source_identity(path) != authority["source"]:
                raise DiagnosticError(
                    "SOURCE_CHANGED", "Approved processing source changed"
                )
        except (DiagnosticError, OSError, ValueError) as error:
            code = (
                error.code if isinstance(error, DiagnosticError) else "SOURCE_CHANGED"
            )
            # This transaction commits the denial; ordinary reset/reseed retains
            # the proof and denied marker. A new reviewed plan must replace it.
            session.execute(
                text(
                    "UPDATE track_processing_state SET state='failed',claim_token=NULL,claimed_by=NULL,claimed_at=NULL,last_error=:error,operator_authority=operator_authority || jsonb_build_object('denied',true),updated_at=NOW() WHERE track_id=:id AND pipeline=:pipeline"
                ),
                {
                    "error": "OPERATOR_AUTHORITY:" + code,
                    "id": track_id,
                    "pipeline": pipeline,
                },
            )
            column = {"analysis": "analysis_state", "bliss": "bliss_state"}[pipeline]
            session.execute(
                text(f"UPDATE library_tracks SET {column}='failed' WHERE id=:id"),
                {"id": track_id},
            )
            append_pipeline_event(
                session,
                pipeline=pipeline,
                track_id=track_id,
                state="failed",
                error_message="OPERATOR_AUTHORITY:" + code,
            )
            mark_ops_snapshot_dirty(session)
        else:
            allowed.add(track_id)
    return allowed


__all__ = ["allowed_generation_ids", "bind_generation"]
