from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import optional_scope, read_scope


def normalize_role_values(roles: Iterable[str | None] | None) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for role in roles or []:
        value = (role or "").strip().lower()
        if not value or value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized or ["user"]


def _roles_for_user(session, user_id: int) -> list[str]:
    rows = (
        session.execute(
            text("""
            SELECT role
            FROM user_roles
            WHERE user_id = :user_id
            ORDER BY
                CASE role
                    WHEN 'owner' THEN 0
                    WHEN 'admin' THEN 1
                    WHEN 'ops' THEN 2
                    WHEN 'librarian' THEN 3
                    WHEN 'curator' THEN 4
                    WHEN 'editor' THEN 5
                    WHEN 'contributor' THEN 6
                    WHEN 'user' THEN 7
                    ELSE 99
                END,
                role
            """),
            {"user_id": user_id},
        )
        .scalars()
        .all()
    )
    return normalize_role_values(rows) if rows else []


def get_user_roles(user_id: int, *, session=None) -> list[str]:
    if session is not None:
        return normalize_role_values(_roles_for_user(session, user_id))
    with read_scope() as s:
        return normalize_role_values(_roles_for_user(s, user_id))


def hydrate_user_roles(user: dict | None, *, session=None) -> dict | None:
    if not user or user.get("id") is None:
        return user
    if session is not None:
        roles = _roles_for_user(session, int(user["id"]))
    else:
        roles = get_user_roles(int(user["id"]))
        if roles == ["user"] and user.get("role") and str(user.get("role")) != "user":
            roles = []
    if not roles and user.get("role"):
        roles = normalize_role_values([str(user.get("role"))])
    user["roles"] = roles
    user["role"] = roles[0] if roles else str(user.get("role") or "user")
    return user


def hydrate_users_roles(users: list[dict]) -> list[dict]:
    user_ids = [int(user["id"]) for user in users if user.get("id") is not None]
    if not user_ids:
        return users
    with read_scope() as session:
        rows = (
            session.execute(
                text("""
                SELECT user_id, role
                FROM user_roles
                WHERE user_id = ANY(:user_ids)
                ORDER BY user_id, role
                """),
                {"user_ids": user_ids},
            )
            .mappings()
            .all()
        )
    roles_by_user: dict[int, list[str]] = {}
    for row in rows:
        roles_by_user.setdefault(int(row["user_id"]), []).append(str(row["role"]))
    for user in users:
        db_roles = (
            roles_by_user.get(int(user["id"])) if user.get("id") is not None else None
        )
        roles = normalize_role_values(db_roles) if db_roles else []
        if not roles:
            roles = normalize_role_values([str(user.get("role"))])
        user["roles"] = roles
        user["role"] = roles[0] if roles else str(user.get("role") or "user")
    return users


def set_user_roles(
    user_id: int,
    roles: Iterable[str | None],
    *,
    assigned_by: int | None = None,
    session=None,
) -> list[str]:
    normalized = normalize_role_values(roles)
    now = datetime.now(timezone.utc)

    def _impl(s) -> list[str]:
        s.execute(
            text("DELETE FROM user_roles WHERE user_id = :user_id"),
            {"user_id": user_id},
        )
        for role in normalized:
            s.execute(
                text("""
                INSERT INTO user_roles (user_id, role, assigned_by, assigned_at)
                VALUES (:user_id, :role, :assigned_by, :assigned_at)
                ON CONFLICT (user_id, role) DO UPDATE SET
                    assigned_by = EXCLUDED.assigned_by,
                    assigned_at = EXCLUDED.assigned_at
                """),
                {
                    "user_id": user_id,
                    "role": role,
                    "assigned_by": assigned_by,
                    "assigned_at": now,
                },
            )
        s.execute(
            text("UPDATE users SET role = :role WHERE id = :user_id"),
            {"user_id": user_id, "role": normalized[0]},
        )
        return normalized

    with optional_scope(session) as s:
        return _impl(s)
