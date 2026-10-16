"""Fresh cookie-session identity for consent and human integration decisions."""

from sqlalchemy import text

from crate.agent_diagnostics import DiagnosticError
from crate.api.permissions import get_user_capabilities
from crate.db.repositories.auth_user_accounts import get_user_by_id
from crate.db.tx import read_scope


def get_agent_human_session(
    user_id: int, session_id: str, *, session=None
) -> dict | None:
    def _read(current):
        valid = current.execute(
            text("""
            SELECT 1 FROM sessions WHERE id = :sid AND user_id = :user_id
            AND revoked_at IS NULL AND expires_at > NOW()
        """),
            {"sid": session_id, "user_id": user_id},
        ).first()
        if valid is None:
            return None
        user = get_user_by_id(user_id, session=current)
        if user is None or (user.get("status") or "active") != "active":
            return None
        return {
            **user,
            "session_id": session_id,
            "capabilities": sorted(get_user_capabilities(user)),
        }

    if session is not None:
        return _read(session)
    with read_scope() as current:
        return _read(current)


def require_agent_human_capabilities(
    actor: dict, capabilities: set[str], *, session
) -> dict:
    session.execute(text("SET LOCAL statement_timeout = '5s'"))
    session.execute(text("SET LOCAL lock_timeout = '2s'"))
    session.execute(
        text("SELECT id FROM users WHERE id = :id FOR SHARE"), {"id": actor["id"]}
    ).all()
    session.execute(
        text("SELECT role FROM user_roles WHERE user_id = :id FOR SHARE"),
        {"id": actor["id"]},
    ).all()
    session.execute(
        text("SELECT id FROM sessions WHERE id = :sid FOR SHARE"),
        {"sid": actor["session_id"]},
    ).all()
    user = get_agent_human_session(actor["id"], actor["session_id"], session=session)
    if user is None or not capabilities <= set(user["capabilities"]):
        raise DiagnosticError(
            "FORBIDDEN", "The human session no longer permits this decision"
        )
    return user


__all__ = ["get_agent_human_session", "require_agent_human_capabilities"]
