"""User lookup queries for the Subsonic API."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import read_scope


def get_user_by_username(username: str) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text("SELECT * FROM users WHERE username = :username"),
                {"username": username},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


def get_recent_now_playing_rows() -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT key, value_json
                    FROM cache
                    WHERE key LIKE 'now_playing:%'
                      AND updated_at >= NOW() - INTERVAL '7 hours'
                    """
                )
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def get_active_usernames(user_ids: list[int]) -> dict[int, str]:
    if not user_ids:
        return {}
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT id, COALESCE(username, email) AS username
                    FROM users
                    WHERE id = ANY(:user_ids)
                      AND status = 'active'
                      AND deleted_at IS NULL
                    """
                ),
                {"user_ids": user_ids},
            )
            .mappings()
            .all()
        )
    return {int(row["id"]): str(row["username"] or "") for row in rows}


__all__ = [
    "get_active_usernames",
    "get_recent_now_playing_rows",
    "get_user_by_username",
]
