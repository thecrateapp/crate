"""Shared generation fences for daemon results and maintenance resets."""

from __future__ import annotations

from sqlalchemy import text


def lock_processing_rows(
    session, track_ids: list[int], pipelines: list[str]
) -> list[dict]:
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
    session, *, track_ids: list[int], pipeline: str, claims: dict[int, dict] | None
) -> set[int]:
    accepted = set()
    for row in lock_processing_rows(session, track_ids, [pipeline]):
        track_id = int(row["track_id"])
        claim = claims.get(track_id) if claims is not None else None
        if claim is None:
            # Compatibility writes may populate legacy data, never a managed generation.
            if (
                claims is None
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


__all__ = ["lock_processing_rows", "accepted_claim_ids", "record_signatures"]
