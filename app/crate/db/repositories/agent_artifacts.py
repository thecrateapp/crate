"""Private artifact references bound to the exact agent authorization."""

import json
from uuid import uuid4

from sqlalchemy import text

from crate.agent_access import authorization_context
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories.agent_requests import (
    _authorize,
    _execution_job,
    _principal_for_job,
)
from crate.db.tx import optional_scope, read_scope


def register_artifact(
    task_id: str, *, path: str, filename: str, sha256: str, byte_size: int, session=None
) -> dict:
    with optional_scope(session) as current:
        job = _execution_job(current, task_id)
        principal = _principal_for_job(job)
        _authorize(current, principal, {"library.metadata.export"}, worker=True)
        if job["payload"].get("domain_operation") != "metadata_export":
            raise DiagnosticError("FORBIDDEN", "Only metadata exports create artifacts")
        artifact_id = str(uuid4())
        current.execute(
            text("""INSERT INTO agent_artifacts(id,principal_id,authorization_context,job_id,path,filename,sha256,byte_size,required_grant)
            VALUES(:id,:principal,CAST(:context AS jsonb),:job,:path,:filename,:sha256,:size,'library.metadata.export')"""),
            {
                "id": artifact_id,
                "principal": principal.id,
                "context": json.dumps(authorization_context(principal)),
                "job": task_id,
                "path": path,
                "filename": filename,
                "sha256": sha256,
                "size": byte_size,
            },
        )
        return {
            "artifact_id": artifact_id,
            "download_path": f"/mcp/artifacts/{artifact_id}",
            "filename": filename,
            "sha256": sha256,
            "byte_size": byte_size,
            "expires_in_seconds": 86400,
        }


def get_owned_artifact(principal, artifact_id: str, *, session=None) -> dict:
    def _read(current):
        _authorize(current, principal, {"library.metadata.export"})
        row = (
            current.execute(
                text("""SELECT a.* FROM agent_artifacts a JOIN agent_jobs j ON j.task_id=a.job_id JOIN tasks t ON t.id=j.task_id
            WHERE a.id=CAST(:id AS uuid) AND a.principal_id=CAST(:principal AS uuid)
              AND a.authorization_context=CAST(:context AS jsonb) AND a.expires_at>NOW()
              AND t.status='completed'"""),
                {
                    "id": artifact_id,
                    "principal": principal.id,
                    "context": json.dumps(authorization_context(principal)),
                },
            )
            .mappings()
            .first()
        )
        if row is None:
            raise DiagnosticError(
                "NOT_FOUND", "Owned artifact is unavailable or expired"
            )
        return dict(row)

    if session is not None:
        return _read(session)
    with read_scope() as current:
        return _read(current)


__all__ = ["register_artifact", "get_owned_artifact"]
