"""Real PostgreSQL interleavings must revoke every descendant of reused authority."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic

import pytest
from sqlalchemy import text

from crate.db.repositories import mcp_oauth as store
from crate.db.tx import read_scope

from tests.test_mcp_oauth_integration import _code, _exchange, _refresh

pytest_plugins = ["tests.test_mcp_oauth_integration"]


def wait_until_blocked(pid, timeout=8):
    deadline = monotonic() + timeout
    pause = Event()
    while monotonic() < deadline:
        with read_scope() as session:
            waiting = session.execute(
                text("SELECT wait_event_type FROM pg_stat_activity WHERE pid=:pid"),
                {"pid": pid},
            ).scalar_one_or_none()
        if waiting == "Lock":
            return True
        pause.wait(0.01)
    return False


@pytest.mark.parametrize("reused", ["refresh", "code"])
def test_reused_ancestor_revokes_descendant_inserted_during_lock_wait(
    oauth_env, monkeypatch, reused
):
    code = _code(oauth_env)
    original = _exchange(code)
    assert original[0] == 200
    first = _refresh(original[1]["refresh_token"])
    assert first[0] == 200
    save_entered, allow_save, replay_entered = Event(), Event(), Event()
    replay_pid = {}
    save_token = store.save_oauth_token
    get_token = store.get_oauth_token
    query_code = store.query_code

    def pause_before_insert(token, credential, *, session):
        save_entered.set()
        assert allow_save.wait(10), "The test did not release the descendant insert"
        return save_token(token, credential, session=session)

    def record_replay_pid(session):
        replay_pid["value"] = session.execute(
            text("SELECT pg_backend_pid()")
        ).scalar_one()
        replay_entered.set()

    def capture_refresh(raw, *args, **kwargs):
        if (
            reused == "refresh"
            and raw == original[1]["refresh_token"]
            and kwargs.get("refresh")
        ):
            record_replay_pid(kwargs["session"])
        return get_token(raw, *args, **kwargs)

    def capture_code(raw, *args, **kwargs):
        if reused == "code" and raw == code:
            record_replay_pid(kwargs["session"])
        return query_code(raw, *args, **kwargs)

    monkeypatch.setattr(store, "save_oauth_token", pause_before_insert)
    monkeypatch.setattr(store, "get_oauth_token", capture_refresh)
    monkeypatch.setattr(store, "query_code", capture_code)
    with ThreadPoolExecutor(max_workers=2) as pool:
        rotation = pool.submit(_refresh, first[1]["refresh_token"])
        try:
            assert save_entered.wait(8), "Rotation never reached its INSERT boundary"
            replay = (
                pool.submit(_refresh, original[1]["refresh_token"])
                if reused == "refresh"
                else pool.submit(_exchange, code)
            )
            assert replay_entered.wait(8), "Reuse never reached PostgreSQL"
            assert wait_until_blocked(replay_pid["value"]), (
                "Reuse did not wait for the in-flight rotation"
            )
        finally:
            allow_save.set()
        rotated = rotation.result(timeout=10)
        rejected = replay.result(timeout=10)

    assert rotated[0] == 200, rotated
    assert rejected[0] == 400, rejected
    descendant = rotated[1]
    for issued in (original[1], first[1], descendant):
        assert store.resolve_oauth_access_token(issued["access_token"]) is None
    assert _refresh(descendant["refresh_token"])[0] == 400


@pytest.mark.parametrize("reused", ["refresh", "code"])
def test_rotation_waiting_for_reuse_cannot_issue_another_descendant(
    oauth_env, monkeypatch, reused
):
    code = _code(oauth_env)
    original = _exchange(code)
    assert original[0] == 200
    first = _refresh(original[1]["refresh_token"])
    assert first[0] == 200
    revocation_written, allow_commit, rotation_entered = Event(), Event(), Event()
    rotation_pid = {}
    revoke_family = store.revoke_token_family
    get_token = store.get_oauth_token

    def pause_after_revocation(family_id, *, session):
        revoke_family(family_id, session=session)
        revocation_written.set()
        assert allow_commit.wait(10), "The test did not release the family revocation"

    def capture_rotation(raw, *args, **kwargs):
        if raw == first[1]["refresh_token"] and kwargs.get("refresh"):
            rotation_pid["value"] = (
                kwargs["session"].execute(text("SELECT pg_backend_pid()")).scalar_one()
            )
            rotation_entered.set()
        return get_token(raw, *args, **kwargs)

    monkeypatch.setattr(store, "revoke_token_family", pause_after_revocation)
    monkeypatch.setattr(store, "get_oauth_token", capture_rotation)
    with ThreadPoolExecutor(max_workers=2) as pool:
        replay = (
            pool.submit(_refresh, original[1]["refresh_token"])
            if reused == "refresh"
            else pool.submit(_exchange, code)
        )
        try:
            assert revocation_written.wait(8), "Reuse never wrote its revocation"
            rotation = pool.submit(_refresh, first[1]["refresh_token"])
            assert rotation_entered.wait(8)
            assert wait_until_blocked(rotation_pid["value"]), (
                "Rotation did not wait for reuse to commit"
            )
        finally:
            allow_commit.set()
        rejected_reuse = replay.result(timeout=10)
        rejected_rotation = rotation.result(timeout=10)

    assert rejected_reuse[0] == rejected_rotation[0] == 400
    assert store.resolve_oauth_access_token(original[1]["access_token"]) is None
    assert store.resolve_oauth_access_token(first[1]["access_token"]) is None
    with read_scope() as session:
        assert (
            session.execute(text("SELECT COUNT(*) FROM mcp_oauth_tokens")).scalar_one()
            == 2
        )
