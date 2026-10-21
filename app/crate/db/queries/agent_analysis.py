"""Bounded pipeline state reads; no library-wide aggregates."""

from __future__ import annotations

import hashlib
import json
from uuid import UUID

from sqlalchemy import text

from crate.db.tx import read_scope


def analysis_targets_version(state: dict) -> str:
    return hashlib.sha256(
        json.dumps(state, sort_keys=True, default=str).encode()
    ).hexdigest()


def read_analysis_targets(
    track_uids: list[str],
    pipelines: list[str],
    *,
    session=None,
    locked: bool = False,
    require_all: bool = True,
) -> dict:
    uids = [str(UUID(str(uid))) for uid in track_uids]
    if not 1 <= len(uids) <= 200 or len(set(uids)) != len(uids):
        raise ValueError("Analysis requires 1 to 200 unique tracks")
    if (
        not pipelines
        or len(set(pipelines)) != len(pipelines)
        or set(pipelines) - {"analysis", "bliss"}
    ):
        raise ValueError("Unsupported analysis pipelines")

    def load(current):
        tracks = [
            dict(r)
            for r in current.execute(
                text(
                    "SELECT id,entity_uid::text AS entity_uid,path,size,updated_at,analysis_state,bliss_state FROM library_tracks WHERE entity_uid=ANY(CAST(:uids AS uuid[])) ORDER BY id"
                    + (" FOR UPDATE" if locked else "")
                ),
                {"uids": uids},
            ).mappings()
        ]
        if require_all and len(tracks) != len(uids):
            raise ValueError("An analysis target is not in the library")
        processing = [
            dict(r)
            for r in current.execute(
                text(
                    "SELECT track_id,pipeline,state,generation,pipeline_signature,last_error FROM track_processing_state WHERE track_id=ANY(:ids) AND pipeline=ANY(:pipelines) ORDER BY pipeline,track_id"
                ),
                {"ids": [t["id"] for t in tracks], "pipelines": pipelines},
            ).mappings()
        ]
        by_key = {(r["track_id"], r["pipeline"]): r for r in processing}
        return {
            "tracks": tracks,
            "processing": [
                by_key.get(
                    (t["id"], p),
                    {
                        "track_id": t["id"],
                        "pipeline": p,
                        "state": t.get(p + "_state") or "pending",
                        "generation": 0,
                        "pipeline_signature": None,
                        "last_error": None,
                    },
                )
                for p in sorted(pipelines)
                for t in tracks
            ],
        }

    if session is not None:
        return load(session)
    if locked:
        raise ValueError("Locked reads require a transaction")
    with read_scope() as current:
        return load(current)


__all__ = ["analysis_targets_version", "read_analysis_targets"]
