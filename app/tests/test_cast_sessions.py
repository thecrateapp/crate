from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope


NOW = datetime(2026, 9, 14, 20, 0, tzinfo=timezone.utc)


def _queue(*item_ids: str) -> list[dict]:
    return [
        {
            "item_id": item_id,
            "track_id": index + 1,
            "title": f"Track {index + 1}",
            "artist": "Artist",
        }
        for index, item_id in enumerate(item_ids)
    ]


def test_cast_session_stores_only_lease_hash_and_scopes_owner(pg_db, monkeypatch):
    from crate.db.repositories import cast_sessions

    monkeypatch.setattr(cast_sessions, "_now", lambda: NOW)
    owner = pg_db.create_user("cast-session-owner@test.com")
    other = pg_db.create_user("cast-session-other@test.com")

    created = cast_sessions.create_cast_session(
        owner["id"],
        target_device_id="living-room",
        protocol_version=1,
        receiver_capabilities={"spectrum": True},
        appearance={"skin_id": "crate-red", "resolved_mode": "dark"},
        queue=_queue("item-1", "item-2"),
        current_index=1,
        current_time=12.5,
        repeat_mode="all",
        shuffle=True,
        revision=4,
    )

    assert created["lease"]
    assert created["session_id"]
    assert created["expires_at"] == NOW + timedelta(hours=8)
    assert created["last_used_at"] == NOW
    assert (
        cast_sessions.get_cast_session_by_lease(created["lease"])["user_id"]
        == owner["id"]
    )
    assert (
        cast_sessions.get_cast_session_for_user(other["id"], created["session_id"])
        is None
    )

    with read_scope() as session:
        raw = (
            session.execute(
                text(
                    "SELECT lease_hash, capabilities_json, appearance_json "
                    "FROM cast_playback_sessions WHERE session_id = :session_id"
                ),
                {"session_id": created["session_id"]},
            )
            .mappings()
            .one()
        )

    assert raw["lease_hash"] != created["lease"]
    assert created["lease"] not in str(dict(raw))
    assert raw["capabilities_json"]["spectrum"] is True
    assert raw["appearance_json"]["skin_id"] == "crate-red"


def test_cast_session_enforces_idle_and_absolute_expiry(pg_db, monkeypatch):
    from crate.db.repositories import cast_sessions

    clock = {"now": NOW}
    monkeypatch.setattr(cast_sessions, "_now", lambda: clock["now"])
    owner = pg_db.create_user("cast-session-expiry@test.com")

    idle = cast_sessions.create_cast_session(
        owner["id"],
        queue=_queue("idle-item"),
    )
    clock["now"] = NOW + timedelta(minutes=30, seconds=1)
    assert cast_sessions.get_cast_session_by_lease(idle["lease"]) is None

    absolute = cast_sessions.create_cast_session(
        owner["id"],
        queue=_queue("absolute-item"),
    )
    absolute_created_at = clock["now"]
    clock["now"] = absolute_created_at + timedelta(hours=7, minutes=59)
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE cast_playback_sessions SET last_used_at = :last_used_at "
                "WHERE session_id = :session_id"
            ),
            {
                "last_used_at": clock["now"] - timedelta(minutes=1),
                "session_id": absolute["session_id"],
            },
        )
    touched = cast_sessions.touch_cast_session(absolute["lease"])
    assert touched is not None
    assert touched["expires_at"] == absolute_created_at + timedelta(hours=8)

    clock["now"] = absolute_created_at + timedelta(hours=8, seconds=1)
    assert cast_sessions.get_cast_session_by_lease(absolute["lease"]) is None


def test_cast_session_touch_refreshes_idle_window(pg_db, monkeypatch):
    from crate.db.repositories import cast_sessions

    clock = {"now": NOW}
    monkeypatch.setattr(cast_sessions, "_now", lambda: clock["now"])
    owner = pg_db.create_user("cast-session-touch@test.com")
    created = cast_sessions.create_cast_session(
        owner["id"],
        queue=_queue("item-1"),
    )

    clock["now"] = NOW + timedelta(minutes=29)
    touched = cast_sessions.touch_cast_session(created["lease"])
    assert touched["last_used_at"] == clock["now"]

    clock["now"] = NOW + timedelta(minutes=58)
    assert cast_sessions.get_cast_session_by_lease(created["lease"]) is not None


def test_cast_session_queue_update_is_cas_and_idempotent(pg_db, monkeypatch):
    from crate.db.repositories import cast_sessions

    monkeypatch.setattr(cast_sessions, "_now", lambda: NOW)
    owner = pg_db.create_user("cast-session-cas@test.com")
    created = cast_sessions.create_cast_session(
        owner["id"],
        queue=_queue("item-1", "item-2"),
        current_index=0,
        revision=7,
    )

    applied = cast_sessions.update_cast_session_queue(
        owner["id"],
        created["session_id"],
        expected_revision=7,
        mutation_id="mutation-1",
        queue=_queue("item-2", "item-1", "item-3"),
        repeat_mode="one",
        shuffle=False,
    )
    assert applied["mutation_status"] == "applied"
    assert applied["revision"] == 8
    assert applied["current_index"] == 1
    assert applied["current_time"] == 0
    assert [item["item_id"] for item in applied["queue"]] == [
        "item-2",
        "item-1",
        "item-3",
    ]

    second = cast_sessions.update_cast_session_queue(
        owner["id"],
        created["session_id"],
        expected_revision=8,
        mutation_id="mutation-2",
        queue=_queue("item-3", "item-2"),
    )
    assert second["mutation_status"] == "applied"
    assert second["revision"] == 9
    assert second["current_index"] == 1

    duplicate = cast_sessions.update_cast_session_queue(
        owner["id"],
        created["session_id"],
        expected_revision=7,
        mutation_id="mutation-1",
        queue=_queue("ignored"),
    )
    assert duplicate["mutation_status"] == "duplicate"
    assert duplicate["revision"] == 9
    assert duplicate["queue"] == second["queue"]

    conflict = cast_sessions.update_cast_session_queue(
        owner["id"],
        created["session_id"],
        expected_revision=7,
        mutation_id="mutation-3",
        queue=_queue("stale"),
    )
    assert conflict["mutation_status"] == "conflict"
    assert conflict["revision"] == 9
    assert conflict["queue"] == second["queue"]

    assert (
        cast_sessions.update_cast_session_queue(
            owner["id"] + 1,
            created["session_id"],
            expected_revision=8,
            mutation_id="mutation-4",
            queue=_queue("forbidden"),
        )
        is None
    )


def test_cast_session_revocation_is_owner_scoped(pg_db, monkeypatch):
    from crate.db.repositories import cast_sessions

    monkeypatch.setattr(cast_sessions, "_now", lambda: NOW)
    owner = pg_db.create_user("cast-session-revoke-owner@test.com")
    other = pg_db.create_user("cast-session-revoke-other@test.com")
    created = cast_sessions.create_cast_session(
        owner["id"],
        queue=_queue("item-1"),
    )

    assert (
        cast_sessions.revoke_cast_session(other["id"], created["session_id"]) is False
    )
    assert cast_sessions.revoke_cast_session(owner["id"], created["session_id"])
    assert cast_sessions.revoke_cast_session(owner["id"], created["session_id"])
    assert cast_sessions.get_cast_session_by_lease(created["lease"]) is None

    with transaction_scope() as session:
        revoked_at = session.execute(
            text(
                "SELECT revoked_at FROM cast_playback_sessions "
                "WHERE session_id = :session_id"
            ),
            {"session_id": created["session_id"]},
        ).scalar_one()
    assert revoked_at == NOW


def test_cast_session_validates_bounded_queue_and_payloads(pg_db, monkeypatch):
    from crate.db.repositories import cast_sessions

    monkeypatch.setattr(cast_sessions, "_now", lambda: NOW)
    owner = pg_db.create_user("cast-session-validation@test.com")

    with pytest.raises(ValueError, match="unique item_id"):
        cast_sessions.create_cast_session(
            owner["id"], queue=_queue("duplicate", "duplicate")
        )
    with pytest.raises(ValueError, match="at most"):
        cast_sessions.create_cast_session(
            owner["id"],
            queue=_queue(*(f"item-{index}" for index in range(1_001))),
        )
    with pytest.raises(ValueError, match="capabilities"):
        cast_sessions.create_cast_session(
            owner["id"],
            queue=_queue("item-1"),
            receiver_capabilities={"value": "x" * 20_000},
        )
    oversized_item = _queue("item-1")[0]
    oversized_item["title"] = "x" * 20_000
    with pytest.raises(ValueError, match="queue item"):
        cast_sessions.create_cast_session(owner["id"], queue=[oversized_item])


def test_receiver_state_uses_its_own_monotonic_sequence(pg_db, monkeypatch):
    from crate.db.repositories import cast_sessions

    monkeypatch.setattr(cast_sessions, "_now", lambda: NOW)
    owner = pg_db.create_user("cast-session-state@test.com")
    created = cast_sessions.create_cast_session(
        owner["id"], queue=_queue("item-1", "item-2"), current_index=0
    )

    updated = cast_sessions.update_cast_session_state(
        created["lease"],
        state_seq=2,
        current_index=1,
        current_time=42.5,
    )
    stale = cast_sessions.update_cast_session_state(
        created["lease"],
        state_seq=1,
        current_index=0,
        current_time=0,
    )

    assert updated["state_seq"] == 2
    assert updated["current_index"] == 1
    assert updated["current_time"] == 42.5
    assert stale["state_seq"] == 2
    assert stale["current_index"] == 1


def test_cast_session_cleanup_removes_only_old_terminal_rows(pg_db, monkeypatch):
    from crate.db.repositories import cast_sessions

    monkeypatch.setattr(cast_sessions, "_now", lambda: NOW)
    owner = pg_db.create_user("cast-session-cleanup@test.com")
    expired = cast_sessions.create_cast_session(owner["id"], queue=_queue("expired"))
    active = cast_sessions.create_cast_session(owner["id"], queue=_queue("active"))
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE cast_playback_sessions "
                "SET expires_at = :expired_at "
                "WHERE session_id = :session_id"
            ),
            {
                "expired_at": NOW - timedelta(days=2),
                "session_id": expired["session_id"],
            },
        )

    assert cast_sessions.cleanup_cast_sessions(retention=timedelta(days=1)) == 1
    assert cast_sessions.get_cast_session_by_lease(active["lease"]) is not None
