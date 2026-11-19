from __future__ import annotations

import logging
import os
import re
import secrets
from datetime import datetime, timezone

from sqlalchemy import func, select

from crate.db.orm.user import User, UserExternalIdentity
from crate.db.repositories.auth_shared import model_to_dict
from crate.db.repositories.auth_user_roles import hydrate_user_roles, set_user_roles
from crate.db.tx import optional_scope, read_scope, transaction_scope

log = logging.getLogger(__name__)


def suggest_username(email: str, preferred: str | None = None, *, session=None) -> str:
    base = (preferred or email.split("@")[0]).strip().lower()
    base = re.sub(r"[^a-z0-9._-]+", "-", base).strip(".-_") or "user"

    def _impl(s) -> str:
        candidate = base
        suffix = 1
        while True:
            exists = s.execute(
                select(User.id).where(User.username == candidate).limit(1)
            ).scalar_one_or_none()
            if exists is None:
                return candidate
            candidate = f"{base}-{suffix}"
            suffix += 1

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


def count_users() -> int:
    with read_scope() as session:
        return int(
            session.execute(select(func.count()).select_from(User)).scalar_one() or 0
        )


BOOTSTRAP_ADMIN_EMAIL = "admin@cratemusic.app"
_MIN_BOOTSTRAP_PASSWORD_LENGTH = 8
_WEAK_BOOTSTRAP_PASSWORDS = frozenset({"admin", "password", "changeme", "change-me"})


def _dev_admin_seed_enabled() -> bool:
    return os.environ.get("CRATE_DEV_ADMIN_SEED", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _bootstrap_admin_password(dev_seed: bool) -> tuple[str, bool]:
    configured = os.environ.get("DEFAULT_ADMIN_PASSWORD", "")
    if configured and dev_seed:
        return configured, False
    if (
        len(configured) >= _MIN_BOOTSTRAP_PASSWORD_LENGTH
        and configured.lower() not in _WEAK_BOOTSTRAP_PASSWORDS
    ):
        return configured, False
    if configured:
        log.warning(
            "DEFAULT_ADMIN_PASSWORD is too weak for the bootstrap admin; "
            "a random initial password will be generated instead"
        )
    return secrets.token_urlsafe(18), True


def _seed_admin(session=None) -> str | None:
    if session is None:
        with transaction_scope() as s:
            return _seed_admin(s)

    total_users = int(
        session.execute(select(func.count()).select_from(User)).scalar_one() or 0
    )
    if total_users == 0:
        from crate.auth import hash_password

        existing = session.execute(
            select(User).where(User.email == BOOTSTRAP_ADMIN_EMAIL).limit(1)
        ).scalar_one_or_none()
        if existing is None:
            dev_seed = _dev_admin_seed_enabled()
            password, generated = _bootstrap_admin_password(dev_seed)
            session.add(
                User(
                    email=BOOTSTRAP_ADMIN_EMAIL,
                    username="admin",
                    name="Admin",
                    password_hash=hash_password(password),
                    password_change_required=not dev_seed,
                    role="admin",
                    created_at=datetime.now(timezone.utc),
                )
            )
            return password if generated else None
    else:
        admin = session.execute(
            select(User).where(User.email == BOOTSTRAP_ADMIN_EMAIL).limit(1)
        ).scalar_one_or_none()
        if admin is not None and not admin.username:
            admin.username = "admin"


def create_user(
    email: str,
    name: str | None = None,
    password_hash: str | None = None,
    avatar: str | None = None,
    role: str = "user",
    google_id: str | None = None,
    username: str | None = None,
    *,
    session=None,
) -> dict:
    def _impl(s) -> dict:
        existing = s.execute(
            select(User).where(User.email == email).limit(1)
        ).scalar_one_or_none()
        if existing is not None:
            raise ValueError(f"Email already registered: {email}")

        final_username = username or suggest_username(email, session=s)
        user = User(
            email=email,
            username=final_username,
            name=name,
            password_hash=password_hash,
            avatar=avatar,
            role=role,
            google_id=google_id,
            created_at=datetime.now(timezone.utc),
        )
        s.add(user)
        s.flush()
        set_user_roles(user.id, [role], session=s)
        return hydrate_user_roles(model_to_dict(user), session=s) or {}

    with optional_scope(session) as s:
        return _impl(s)


def get_user_by_email(email: str) -> dict | None:
    with read_scope() as session:
        user = session.execute(
            select(User).where(User.email == email).limit(1)
        ).scalar_one_or_none()
        return (
            hydrate_user_roles(model_to_dict(user), session=session) if user else None
        )


def get_user_by_google_id(google_id: str) -> dict | None:
    with read_scope() as session:
        user = session.execute(
            select(User).where(User.google_id == google_id).limit(1)
        ).scalar_one_or_none()
        return (
            hydrate_user_roles(model_to_dict(user), session=session) if user else None
        )


def get_user_by_external_identity(provider: str, external_user_id: str) -> dict | None:
    with read_scope() as session:
        user = session.execute(
            select(User)
            .join(UserExternalIdentity, UserExternalIdentity.user_id == User.id)
            .where(
                UserExternalIdentity.provider == provider,
                UserExternalIdentity.external_user_id == external_user_id,
            )
            .limit(1)
        ).scalar_one_or_none()
        return (
            hydrate_user_roles(model_to_dict(user), session=session) if user else None
        )


def get_user_by_id(user_id: int, *, session=None) -> dict | None:
    def _impl(s) -> dict | None:
        user = s.get(User, user_id)
        return hydrate_user_roles(model_to_dict(user), session=s) if user else None

    if session is not None:
        return _impl(session)
    with read_scope() as s:
        return _impl(s)


__all__ = [
    "BOOTSTRAP_ADMIN_EMAIL",
    "_seed_admin",
    "count_users",
    "create_user",
    "get_user_by_email",
    "get_user_by_external_identity",
    "get_user_by_google_id",
    "get_user_by_id",
    "suggest_username",
]
