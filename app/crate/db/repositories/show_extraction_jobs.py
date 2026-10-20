"""Private extraction artifacts; acceptance, ownership and runtime remain common."""

import hashlib
import json
from uuid import uuid4
from sqlalchemy import text
from crate.agent_diagnostics import DiagnosticError
from crate.api.schemas.show_imports import ShowExtractionInput
from crate.db.repositories import agent_requests as requests
from crate.db.repositories.agent_operation_jobs import finish_operation
from crate.db.tx import optional_scope, read_scope
from crate.show_ocr import validate_image

GRANTS = {"curation.shows.write"}


def _human(current, principal):
    requests._authorize(current, principal, GRANTS)
    if principal.human_actor_id is None:
        raise DiagnosticError(
            "FORBIDDEN", "Only a current Admin show editor may extract sources"
        )


def _cleanup(current):
    current.execute(
        text("""UPDATE agent_jobs SET result=jsonb_build_object('execution',jsonb_build_object('status',coalesce(result->'execution'->>'status','expired')),'expired',true)
       WHERE task_id IN (SELECT d.task_id FROM show_extraction_drafts d LEFT JOIN tasks t ON t.id=d.task_id WHERE d.expires_at<NOW() AND (t.id IS NULL OR t.status NOT IN ('pending','running','delegated','completing')) LIMIT 100)""")
    )
    current.execute(
        text(
            "DELETE FROM show_image_uploads WHERE id IN (SELECT id FROM show_image_uploads WHERE expires_at<NOW() LIMIT 100)"
        )
    )
    current.execute(
        text(
            "DELETE FROM show_extraction_drafts WHERE id IN (SELECT d.id FROM show_extraction_drafts d LEFT JOIN tasks t ON t.id=d.task_id WHERE d.expires_at<NOW() AND (t.id IS NULL OR t.status NOT IN ('pending','running','delegated','completing')) LIMIT 100)"
        )
    )


def stage_show_image(principal, data: bytes, *, session=None) -> dict:
    kind, width, height = validate_image(data)
    with optional_scope(session) as current:
        _human(current, principal)
        requests._lock_principal(current, principal.id)
        _cleanup(current)
        digest = hashlib.sha256(data).hexdigest()
        existing = (
            current.execute(
                text(
                    "SELECT id::text,media_type,sha256,width,height FROM show_image_uploads WHERE actor_user_id=:actor AND sha256=:hash AND expires_at>NOW() LIMIT 1"
                ),
                {"actor": principal.human_actor_id, "hash": digest},
            )
            .mappings()
            .first()
        )
        if existing:
            return {
                "upload_id": existing["id"],
                "media_type": existing["media_type"],
                "sha256": digest,
                "width": existing["width"],
                "height": existing["height"],
                "expires_in_seconds": 86400,
            }
        used = current.execute(
            text(
                "SELECT coalesce(SUM(octet_length(content)),0) FROM show_image_uploads WHERE actor_user_id=:actor AND expires_at>NOW()"
            ),
            {"actor": principal.human_actor_id},
        ).scalar_one()
        if used + len(data) > 24 * 1024 * 1024:
            raise DiagnosticError(
                "LIMIT_EXCEEDED",
                "Private image staging is limited to 24 MiB per editor for 24 hours",
            )
        upload_id = str(uuid4())
        media_type = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[
            kind
        ]
        digest = hashlib.sha256(data).hexdigest()
        current.execute(
            text("""INSERT INTO show_image_uploads(id,actor_user_id,content,media_type,sha256,width,height)
          VALUES(:id,:actor,:data,:type,:hash,:width,:height)"""),
            {
                "id": upload_id,
                "actor": principal.human_actor_id,
                "data": data,
                "type": media_type,
                "hash": digest,
                "width": width,
                "height": height,
            },
        )
        return {
            "upload_id": upload_id,
            "media_type": media_type,
            "sha256": digest,
            "expires_in_seconds": 86400,
            "width": width,
            "height": height,
        }


def _uploads(current, actor, ids, *, content=False):
    rows = (
        current.execute(
            text(
                "SELECT id::text,media_type,sha256,width,height"
                + (",content" if content else "")
                + " FROM show_image_uploads WHERE id=ANY(CAST(:ids AS uuid[])) AND actor_user_id=:actor AND expires_at>NOW() FOR SHARE"
            ),
            {"ids": ids, "actor": actor},
        )
        .mappings()
        .all()
    )
    if len(rows) != len(ids):
        raise DiagnosticError(
            "NOT_FOUND", "An owned image is missing or expired; upload it again"
        )
    by_id = {row["id"]: dict(row) for row in rows}
    return [by_id[value] for value in ids]


def accept_show_extraction(
    principal, parameters: dict, idempotency_key: str, *, session=None
) -> dict:
    source = ShowExtractionInput.model_validate(parameters).model_dump(mode="json")
    key = requests._key(idempotency_key)
    fingerprint = requests._hash(source)
    with optional_scope(session) as current:
        _human(current, principal)
        requests._lock_principal(current, principal.id)
        replay = requests._replay(current, principal, "extract_shows", key, fingerprint)
        if replay:
            return replay
        accepted_ai = None
        if source["mode"] in {"vision", "text_llm", "ocr_text_llm"}:
            from crate.ai import configuration
            from crate.ai.consumers import acceptance_reference
            from crate.ai.contracts import AIConfigurationError
            from crate.show_extraction import SHOW_ACTIONS, show_llm_configuration

            try:
                context = configuration.resolve_action(SHOW_ACTIONS[source["mode"]])
            except AIConfigurationError:
                raise DiagnosticError(
                    "LLM_UNAVAILABLE", "Selected model configuration is unavailable"
                ) from None
            selected = show_llm_configuration(source["mode"], context=context)
            accepted_ai = acceptance_reference(context)
            if (
                source["expected_model"] != selected["model"]
                or source["expected_configuration"]
                != selected["configuration_fingerprint"]
            ):
                raise DiagnosticError(
                    "CONFIGURATION_CHANGED",
                    "The configured model changed; review it before sending the source",
                )
        _cleanup(current)
        _uploads(current, principal.human_actor_id, source["upload_ids"])
        recent = current.execute(
            text("""SELECT count(*) FROM agent_jobs WHERE principal_id=:id
          AND operation='extract_shows' AND created_at>NOW()-INTERVAL '15 minutes'"""),
            {"id": principal.id},
        ).scalar_one()
        if recent >= 10:
            raise DiagnosticError(
                "LIMIT_EXCEEDED",
                "Extraction is limited to ten jobs per editor in fifteen minutes",
            )
        draft_id = str(uuid4())
        accepted = requests._accept(
            current,
            principal,
            "extract_shows",
            {
                "domain_operation": "shows_extract",
                "draft_id": draft_id,
                **({"ai_acceptance": accepted_ai} if accepted_ai else {}),
            },
            key,
            request_hash=fingerprint,
        )
        current.execute(
            text(
                "INSERT INTO show_extraction_drafts(id,actor_user_id,task_id,input) VALUES(:id,:actor,:task,CAST(:input AS jsonb))"
            ),
            {
                "id": draft_id,
                "actor": principal.human_actor_id,
                "task": accepted["job_id"],
                "input": json.dumps(source),
            },
        )
        return accepted


def load_show_extraction(task_id: str, *, session=None) -> dict:
    with optional_scope(session) as current:
        job = requests._execution_job(current, task_id)
        if job["operation"] != "extract_shows":
            raise DiagnosticError("FORBIDDEN", "This is not a show extraction job")
        principal = requests._principal_for_job(job)
        _human(current, principal)
        row = (
            current.execute(
                text(
                    "SELECT id::text,input FROM show_extraction_drafts WHERE id=CAST(:id AS uuid) AND actor_user_id=:actor AND expires_at>NOW()"
                ),
                {"id": job["payload"]["draft_id"], "actor": principal.human_actor_id},
            )
            .mappings()
            .first()
        )
        if not row:
            raise DiagnosticError(
                "NOT_FOUND", "Private source expired; re-upload or paste its text"
            )
        images = _uploads(
            current, principal.human_actor_id, row["input"]["upload_ids"], content=True
        )
        return {
            "job": job,
            # Derived only after current principal and private-source ownership checks.
            "human_actor_id": principal.human_actor_id,
            "draft_id": row["id"],
            "input": row["input"],
            "images": [
                {**image, "content": bytes(image["content"])} for image in images
            ],
        }


def finish_show_extraction(task_id: str, result: dict, *, session=None) -> dict:
    with optional_scope(session) as current:
        job = requests._execution_job(current, task_id)
        if job["result"] is not None:
            return job["result"]
        current.execute(
            text(
                "UPDATE show_extraction_drafts SET result=CAST(:result AS jsonb),status=:status WHERE task_id=:task"
            ),
            {
                "result": json.dumps(result.get("draft", {})),
                "status": result["execution"]["status"],
                "task": task_id,
            },
        )
        return finish_operation(task_id, result, session=current)


def show_extractor_readiness(*, session=None) -> dict:
    def read(current):
        row = current.execute(
            text("SELECT value FROM settings WHERE key='show_extractor_readiness'")
        ).scalar_one_or_none()
        return (
            json.loads(row)
            if row
            else {
                "ocr": {
                    "available": False,
                    "reason": "Worker readiness not checked yet",
                },
                "connectivity": "not_checked",
                "vision": "unknown",
            }
        )

    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


def save_show_extractor_readiness(state: dict, *, session=None) -> None:
    with optional_scope(session) as current:
        current.execute(
            text(
                "INSERT INTO settings(key,value) VALUES('show_extractor_readiness',:value) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value"
            ),
            {"value": json.dumps(state)},
        )


def cleanup_expired_show_sources(*, session=None) -> None:
    with optional_scope(session) as current:
        _cleanup(current)


def read_show_drafts(principal, draft_id: str | None = None, *, session=None) -> dict:
    with optional_scope(session) as current:
        _human(current, principal)
        if draft_id is not None:
            row = (
                current.execute(
                    text(
                        "SELECT id::text,task_id AS job_id,status,result,input FROM show_extraction_drafts WHERE id=CAST(:id AS uuid) AND actor_user_id=:actor AND expires_at>NOW()"
                    ),
                    {"id": draft_id, "actor": principal.human_actor_id},
                )
                .mappings()
                .first()
            )
            if not row:
                raise DiagnosticError("NOT_FOUND", "Owned draft is missing or expired")
            return dict(row)
        rows = (
            current.execute(
                text(
                    "SELECT d.id::text,d.task_id AS job_id,t.status,d.expires_at::text,"
                    "d.created_at,d.input->>'mode' AS mode,"
                    "CASE WHEN jsonb_typeof(d.result->'candidates')='array'"
                    " THEN jsonb_array_length(d.result->'candidates') END AS candidate_count"
                    " FROM show_extraction_drafts d JOIN tasks t ON t.id=d.task_id"
                    " WHERE d.actor_user_id=:actor AND d.expires_at>NOW()"
                    " AND d.input->>'mode' <> 'probe'"
                    " ORDER BY d.created_at DESC LIMIT 10"
                ),
                {"actor": principal.human_actor_id},
            )
            .mappings()
            .all()
        )
        return {"items": [dict(row) for row in rows]}


def cancel_show_job(principal, job_id: str, *, session=None) -> dict:
    from crate.db.repositories.show_editor_access import read_show_job
    from crate.db.repositories.task_control import request_cancellation

    with optional_scope(session) as current:
        read_show_job(principal, job_id, session=current)
        return request_cancellation(
            job_id,
            actor_user_id=principal.human_actor_id,
            principal_id=principal.id,
            session=current,
        )


def check_show_extraction_authority(task_id: str, *, session=None) -> bool:
    """Reauthorize without reloading private image bytes on every OCR heartbeat."""
    with optional_scope(session) as current:
        job = requests._execution_job(current, task_id)
        if (
            job["operation"] != "extract_shows"
            or requests._principal_for_job(job).human_actor_id is None
        ):
            raise DiagnosticError(
                "FORBIDDEN", "Only owned Admin extraction jobs can use this worker"
            )
        return bool(
            current.execute(
                text(
                    "SELECT cancellation_requested_at IS NOT NULL FROM tasks WHERE id=:id"
                ),
                {"id": task_id},
            ).scalar_one()
        )


__all__ = [
    "stage_show_image",
    "accept_show_extraction",
    "load_show_extraction",
    "finish_show_extraction",
    "show_extractor_readiness",
    "save_show_extractor_readiness",
    "cleanup_expired_show_sources",
    "read_show_drafts",
    "cancel_show_job",
    "check_show_extraction_authority",
]
