from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha256

import pytest
from sqlalchemy import text


def test_create_access_token_returns_secret_once_and_stores_only_digest(pg_db):
    from crate.db.repositories.access_tokens import (
        create_access_token,
        get_access_token_by_secret,
        list_access_tokens,
    )

    user = pg_db.create_user("vdj-token-owner@test.com")
    created = create_access_token(
        user_id=user["id"],
        name="VirtualDJ laptop",
        scopes=["vdj.catalog.read", "vdj.media.read"],
    )

    raw_secret = created["token"]
    assert raw_secret.startswith("crv_")
    assert created["token_prefix"] == raw_secret[:12]
    assert created["scopes"] == ["vdj.catalog.read", "vdj.media.read"]
    assert get_access_token_by_secret(raw_secret)["user_id"] == user["id"]

    listed = list_access_tokens(user["id"])
    assert len(listed) == 1
    assert "token" not in listed[0]
    assert listed[0]["token_digest"] == sha256(raw_secret.encode()).hexdigest()

    with __import__(
        "crate.db.tx", fromlist=["transaction_scope"]
    ).transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                SELECT token_digest, token_prefix
                FROM user_access_tokens
                WHERE id = :token_id
                """
                ),
                {"token_id": created["id"]},
            )
            .mappings()
            .one()
        )
    assert row["token_digest"] == sha256(raw_secret.encode()).hexdigest()
    assert row["token_prefix"] == raw_secret[:12]


def test_access_token_expiry_and_revocation_are_checked_immediately(pg_db):
    from crate.db.repositories.access_tokens import (
        create_access_token,
        get_access_token_by_secret,
        revoke_access_token,
    )

    user = pg_db.create_user("vdj-token-expiry@test.com")
    expired = create_access_token(
        user_id=user["id"],
        name="Expired",
        scopes=["vdj.catalog.read"],
        expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    assert get_access_token_by_secret(expired["token"]) is None

    active = create_access_token(
        user_id=user["id"],
        name="Revoked",
        scopes=["vdj.catalog.read"],
    )
    assert revoke_access_token(user["id"], active["id"]) is True
    assert get_access_token_by_secret(active["token"]) is None
    assert revoke_access_token(user["id"], active["id"]) is False


def test_access_token_scopes_are_validated_and_rotation_is_atomic(pg_db):
    from crate.db.repositories.access_tokens import (
        create_access_token,
        get_access_token_by_secret,
        rotate_access_token,
    )

    user = pg_db.create_user("vdj-token-rotate@test.com")
    with pytest.raises(ValueError, match="Unsupported access token scope"):
        create_access_token(
            user_id=user["id"],
            name="Invalid",
            scopes=["admin.access"],
        )

    old = create_access_token(
        user_id=user["id"],
        name="Old token",
        scopes=["vdj.catalog.read"],
    )
    rotated = rotate_access_token(user["id"], old["id"])

    assert rotated["token"] != old["token"]
    assert get_access_token_by_secret(old["token"]) is None
    assert get_access_token_by_secret(rotated["token"])["id"] == rotated["id"]
    assert rotated["scopes"] == old["scopes"]


def test_access_token_lookup_isolated_by_secret_and_user(pg_db):
    from crate.db.repositories.access_tokens import (
        create_access_token,
        get_access_token,
    )

    owner = pg_db.create_user("vdj-token-owner-isolation@test.com")
    other = pg_db.create_user("vdj-token-other-isolation@test.com")
    created = create_access_token(
        user_id=owner["id"],
        name="Owner token",
        scopes=["vdj.catalog.read"],
    )

    assert get_access_token(other["id"], created["id"]) is None
    assert get_access_token(owner["id"], created["id"])["id"] == created["id"]


def _last_used_at(token_id: int):
    from crate.db.tx import read_scope

    with read_scope() as session:
        return session.execute(
            text("SELECT last_used_at FROM user_access_tokens WHERE id = :id"),
            {"id": token_id},
        ).scalar_one()


def test_resolve_access_token_updates_last_used_only_outside_the_window(pg_db):
    from crate.db.repositories.access_tokens import (
        create_access_token,
        resolve_access_token,
    )

    user = pg_db.create_user("vdj-token-last-used@test.com")
    created = create_access_token(
        user_id=user["id"], name="Laptop", scopes=["vdj.catalog.read"]
    )
    first_use = datetime.now(timezone.utc)

    assert (
        resolve_access_token(created["token"], now=first_use)["user_id"] == user["id"]
    )
    assert _last_used_at(created["id"]) == first_use

    resolve_access_token(created["token"], now=first_use + timedelta(minutes=1))
    assert _last_used_at(created["id"]) == first_use

    later = first_use + timedelta(minutes=6)
    resolve_access_token(created["token"], now=later)
    assert _last_used_at(created["id"]) == later


@pytest.mark.parametrize("minutes_since_last_use", [0, 6])
def test_resolve_access_token_does_not_wait_for_a_row_lock(
    pg_db, minutes_since_last_use
):
    import threading

    from crate.db.repositories.access_tokens import (
        create_access_token,
        resolve_access_token,
    )
    from crate.db.tx import transaction_scope

    user = pg_db.create_user("vdj-token-no-lock@test.com")
    created = create_access_token(
        user_id=user["id"], name="Laptop", scopes=["vdj.catalog.read"]
    )
    last_use = datetime.now(timezone.utc)
    resolve_access_token(created["token"], now=last_use)
    resolve_at = last_use + timedelta(minutes=minutes_since_last_use)

    resolved: dict = {}
    locked = threading.Event()
    release = threading.Event()

    def hold_row_lock():
        with transaction_scope() as session:
            session.execute(
                text("SELECT id FROM user_access_tokens WHERE id = :id FOR UPDATE"),
                {"id": created["id"]},
            )
            locked.set()
            release.wait(timeout=10)

    holder = threading.Thread(target=hold_row_lock)
    holder.start()
    try:
        assert locked.wait(timeout=10)

        def resolve_while_locked():
            try:
                resolved["token"] = resolve_access_token(
                    created["token"], now=resolve_at
                )
            except Exception as exc:
                resolved["error"] = exc

        worker = threading.Thread(target=resolve_while_locked)
        worker.start()
        worker.join(timeout=5)
        assert not worker.is_alive()
        assert "error" not in resolved, resolved.get("error")
        assert resolved["token"]["id"] == created["id"]
    finally:
        release.set()
        holder.join(timeout=10)


def test_revocation_is_effective_on_the_next_resolution(pg_db):
    from crate.db.repositories.access_tokens import (
        create_access_token,
        resolve_access_token,
        revoke_access_token,
    )

    user = pg_db.create_user("vdj-token-revoked-next@test.com")
    created = create_access_token(
        user_id=user["id"], name="Laptop", scopes=["vdj.catalog.read"]
    )
    assert resolve_access_token(created["token"]) is not None

    assert revoke_access_token(user["id"], created["id"]) is True
    assert resolve_access_token(created["token"]) is None
