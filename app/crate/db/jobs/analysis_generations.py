"""Shared generation fences for daemon results and maintenance resets."""

from __future__ import annotations

from sqlalchemy import text

from crate.analysis_provenance import source_identity
from crate.db.jobs.analysis_state_events import (
    append_pipeline_event,
    mark_ops_snapshot_dirty,
)


def _fail_changed_sources(session, track_ids: set[int], pipeline: str) -> None:
    if not track_ids:
        return
    state_column = {"analysis": "analysis_state", "bliss": "bliss_state"}[pipeline]
    parameters = {"ids": sorted(track_ids), "pipeline": pipeline}
    session.execute(
        text(
            "UPDATE track_processing_state SET state='failed', claim_token=NULL, "
            "claimed_by=NULL, claimed_at=NULL, last_error='SOURCE_CHANGED', updated_at=NOW() "
            "WHERE track_id=ANY(:ids) AND pipeline=:pipeline"
        ),
        parameters,
    )
    session.execute(
        text(f"UPDATE library_tracks SET {state_column}='failed' WHERE id=ANY(:ids)"),
        parameters,
    )
    for track_id in sorted(track_ids):
        append_pipeline_event(
            session,
            pipeline=pipeline,
            track_id=track_id,
            state="failed",
            error_message="SOURCE_CHANGED",
        )
    mark_ops_snapshot_dirty(session)


def lock_processing_rows(
    session, track_ids: list[int], pipelines: list[str]
) -> list[dict]:
    # Library writers lock tracks before cascading into processing state. Keep
    # the same order for every DSP lifecycle operation, including resets.
    session.execute(
        text("SELECT id FROM library_tracks WHERE id=ANY(:ids) ORDER BY id FOR UPDATE"),
        {"ids": sorted(set(track_ids))},
    ).all()
    return [
        dict(row)
        for row in session.execute(
            text(
                "SELECT * FROM track_processing_state WHERE track_id=ANY(:ids) "
                "AND pipeline=ANY(:pipelines) ORDER BY pipeline, track_id FOR UPDATE"
            ),
            {"ids": sorted(set(track_ids)), "pipelines": sorted(set(pipelines))},
        ).mappings()
    ]


def accepted_claim_ids(
    session,
    *,
    track_ids: list[int],
    pipeline: str,
    claims: dict[int, dict] | None,
    verify_source: bool = False,
) -> set[int]:
    from crate.db.jobs.operator_generations import allowed_generation_ids

    accepted = set()
    rows = lock_processing_rows(session, track_ids, [pipeline])
    for row in rows:
        track_id = int(row["track_id"])
        claim = claims.get(track_id) if claims is not None else None
        if claim is None:
            # Compatibility writes may populate legacy data, never a managed generation.
            if (
                claims is None
                and row.get("operator_authority") is None
                and int(row["generation"]) == 0
                and row["claim_token"] is None
            ):
                accepted.add(track_id)
        elif (
            row["state"] == "analyzing"
            and int(row["generation"]) == int(claim["generation"])
            and str(row["claim_token"]) == str(claim["claim_token"])
        ):
            accepted.add(track_id)
    if claims is not None and accepted:
        paths = {
            int(row["id"]): row["path"]
            for row in session.execute(
                text(
                    "SELECT id,path FROM library_tracks WHERE id=ANY(:ids) ORDER BY id FOR UPDATE"
                ),
                {"ids": sorted(accepted)},
            ).mappings()
        }
        accepted = {
            track_id
            for track_id in accepted
            if "path" not in claims[track_id]
            or claims[track_id]["path"] == paths.get(track_id)
        }
    # Authority rejection mutates processing state. Only the matching current
    # claim may invalidate its generation; late/incompatible deliveries are inert.
    accepted &= allowed_generation_ids(
        session,
        rows=[row for row in rows if int(row["track_id"]) in accepted],
        pipeline=pipeline,
    )
    if claims is not None and verify_source and accepted:
        changed = set()
        for track_id in accepted:
            claim = claims[track_id]
            # Older internal callers have no physical-source snapshot. Daemons
            # supply one; check it after row locks, including any lock wait.
            if "_source" not in claim:
                continue
            try:
                if source_identity(paths[track_id]) == claim["_source"]:
                    continue
            except (OSError, ValueError):
                pass
            changed.add(track_id)
        _fail_changed_sources(session, changed, pipeline)
        accepted -= changed
    return accepted


def record_signatures(session, *, pipeline: str, signatures: dict[int, str]) -> None:
    for track_id, signature in signatures.items():
        session.execute(
            text(
                "UPDATE track_processing_state SET pipeline_signature=:signature "
                "WHERE track_id=:id AND pipeline=:pipeline"
            ),
            {"id": track_id, "pipeline": pipeline, "signature": signature},
        )


__all__ = ["accepted_claim_ids", "lock_processing_rows", "record_signatures"]
