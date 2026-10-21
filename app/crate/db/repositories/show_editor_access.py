"""Internal human ownership for show plans; never issues a remote credential."""

import hashlib
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import text

from crate.agent_access import AgentPrincipal, authorization_context
from crate.agent_diagnostics import DiagnosticError
from crate.api.permissions import get_user_capabilities
from crate.db.repositories.auth_user_accounts import get_user_by_id
from crate.db.tx import optional_scope, read_scope

_GRANTS = frozenset({"curation.shows.read", "curation.shows.write"})


def _require_user(current, user_id, grants):
    current.execute(
        text("SELECT id FROM users WHERE id=:id FOR SHARE"), {"id": user_id}
    ).all()
    current.execute(
        text("SELECT role FROM user_roles WHERE user_id=:id FOR SHARE"), {"id": user_id}
    ).all()
    user = get_user_by_id(user_id, session=current)
    required = (
        {"curation.shows.write"}
        if "curation.shows.write" in grants
        else {"library.view"}
    )
    if (
        not user
        or user.get("status", "active") != "active"
        or not required <= get_user_capabilities(user)
    ):
        raise DiagnosticError(
            "FORBIDDEN", "Show editing permission is no longer available"
        )


def authorize_show_editor(current, principal, row, grants) -> None:
    if (
        row["kind"] != "human"
        or principal.human_actor_id != row["human_owner_user_id"]
        or principal.actor_user_id != row["human_owner_user_id"]
        or not set(grants) <= _GRANTS
    ):
        raise DiagnosticError(
            "FORBIDDEN", "Internal human ownership does not match this operation"
        )
    _require_user(current, principal.human_actor_id, grants)


def get_show_editor_principal(user_id: int, *, session=None) -> AgentPrincipal:
    if type(user_id) is not int or user_id < 1:
        raise DiagnosticError("FORBIDDEN", "A current human show editor is required")
    with optional_scope(session) as current:
        _require_user(current, user_id, {"curation.shows.write"})
        principal_id = str(uuid5(NAMESPACE_URL, f"crate:show-editor:{user_id}"))
        credential_id = str(uuid5(NAMESPACE_URL, f"crate:show-editor-proof:{user_id}"))
        current.execute(
            text("""INSERT INTO agent_principals(id,name,kind,grants,human_owner_user_id,require_approval)
            VALUES (:id,'Admin show editor','human',:grants,:user,FALSE) ON CONFLICT DO NOTHING"""),
            {"id": principal_id, "grants": sorted(_GRANTS), "user": user_id},
        )
        current.execute(
            text("""INSERT INTO agent_credentials(id,principal_id,token_digest,expires_at)
            VALUES (:id,:principal,:digest,NOW()+INTERVAL '100 years') ON CONFLICT DO NOTHING"""),
            {
                "id": credential_id,
                "principal": principal_id,
                "digest": hashlib.sha256(uuid4().bytes).hexdigest(),
            },
        )
        return AgentPrincipal(
            principal_id,
            credential_id,
            "Admin show editor",
            _GRANTS,
            actor_user_id=user_id,
            human_actor_id=user_id,
            accepted_scopes=_GRANTS,
        )


def read_show_job(principal, job_id: str, *, session=None) -> dict:
    from crate.db.repositories.agent_requests import _authorize, _job

    def read(current):
        _authorize(current, principal, {"curation.shows.write"})
        job = _job(current, job_id)
        if (
            not job
            or job["principal_id"] != principal.id
            or job["authorization_context"] != authorization_context(principal)
            or job["payload"].get("domain_operation")
            not in {"shows_import", "shows_extract"}
        ):
            raise DiagnosticError("NOT_FOUND", "Owned show job was not found")
        if (
            job["operation"] == "extract_shows"
            and not current.execute(
                text(
                    "SELECT 1 FROM show_extraction_drafts WHERE task_id=:id AND expires_at>NOW()"
                ),
                {"id": job_id},
            ).first()
        ):
            raise DiagnosticError(
                "RESULT_EXPIRED",
                "Private extraction evidence expired; the durable request ledger is retained",
            )
        return {"job_id": job_id, "status": job["status"], "result": job["result"]}

    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)


__all__ = ["authorize_show_editor", "get_show_editor_principal", "read_show_job"]
