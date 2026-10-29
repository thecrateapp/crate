from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch
import uuid

import pytest

_CONTEXT = {
    "source": "radio",
    "automatic": True,
    "offline": False,
    "preferredDurationMs": 12000,
    "userCueProfile": "default",
    "allowBeatmatch": False,
    "allowTempoAdjustment": False,
}


def _continuation_user():
    async def _resolve_user(self, request):
        del self, request
        return {
            "id": 42,
            "email": "listener@example.com",
            "role": "user",
            "auth_type": "access_token",
            "access_token_id": 21,
            "token_type": "playback_continuation",
            "session_id": None,
            "scopes": ["playback.continuation"],
        }

    return _resolve_user


def _no_planner_io(monkeypatch):
    from crate.api import smart_mix

    monkeypatch.setattr(
        smart_mix,
        "get_track_mix_profiles_by_entity_uids",
        lambda entity_uids, **_kwargs: [None for _ in entity_uids],
    )
    monkeypatch.setattr(smart_mix, "get_smart_mix_plan_caches", lambda _keys: {})
    monkeypatch.setattr(smart_mix, "set_smart_mix_plan_caches", lambda _plans: None)


def _radio_row(entity_uid: str, **extra) -> dict:
    return {
        "track_id": 7,
        "track_entity_uid": entity_uid,
        "track_path": f"/music/{entity_uid}.flac",
        "title": "Song",
        "artist": "Band",
        "album": "Record",
        "duration": 201.5,
        **extra,
    }


def test_continuation_returns_native_tracks_and_chained_plans(test_app, monkeypatch):
    from crate.api import smart_mix

    _no_planner_io(monkeypatch)
    after = str(uuid.uuid4())
    first = str(uuid.uuid4())
    second = str(uuid.uuid4())
    global_uid = str(uuid.uuid4())
    calls = []

    def _tracks(descriptor, *, user, limit, exclude_entity_uids):
        calls.append((descriptor, user["id"], limit, exclude_entity_uids))
        return [
            _radio_row(first),
            _radio_row(second, global_track_uid=global_uid),
        ], False

    monkeypatch.setattr(
        smart_mix,
        "get_continuation_descriptor",
        lambda token_id: {"kind": "shaped_radio", "sessionId": "radio-1"},
    )
    monkeypatch.setattr(smart_mix, "continuation_radio_tracks", _tracks)
    recent = str(uuid.uuid4())

    with patch("crate.api.auth.AuthMiddleware.resolve_user", _continuation_user()):
        response = test_app.post(
            "/api/playback/continuation",
            json={
                "plannerVersion": "smart-mix-v2",
                "afterTrackEntityUid": after,
                "recentEntityUids": [recent],
                "limit": 5,
                "delivery": "balanced",
                "context": _CONTEXT,
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["exhausted"] is False
    assert [track["id"] for track in body["tracks"]] == [first, global_uid]
    assert body["tracks"][0]["url"] == (
        f"/api/tracks/by-entity/{first}/stream?delivery=balanced"
    )
    assert body["tracks"][0]["durationMs"] == 201500
    assert body["tracks"][0]["source"]["track_path"] == f"/music/{first}.flac"
    assert [
        (plan["outgoingTrackEntityUid"], plan["incomingTrackEntityUid"])
        for plan in body["plans"]
    ] == [(after, first), (first, second)]
    assert calls == [
        ({"kind": "shaped_radio", "sessionId": "radio-1"}, 42, 5, {recent, after})
    ]


def test_continuation_without_descriptor_is_exhausted(test_app, monkeypatch):
    from crate.api import smart_mix

    monkeypatch.setattr(smart_mix, "get_continuation_descriptor", lambda token_id: None)

    with patch("crate.api.auth.AuthMiddleware.resolve_user", _continuation_user()):
        response = test_app.post(
            "/api/playback/continuation",
            json={"plannerVersion": "smart-mix-v2", "context": _CONTEXT},
        )

    assert response.json() == {
        "tracks": [],
        "plans": [],
        "exhausted": True,
        "status": "exhausted",
        "revision": 1,
    }


def test_continuation_requires_a_continuation_token(test_app):
    response = test_app.post(
        "/api/playback/continuation",
        json={"plannerVersion": "smart-mix-v2", "context": _CONTEXT},
    )

    assert response.status_code == 403


def test_continuation_token_stores_the_queue_descriptor(test_app, monkeypatch):
    from crate.api import smart_mix

    issued = []

    def _issue(**kwargs):
        issued.append(kwargs)
        return {
            "token": "crv_issued",
            "expires_at": datetime(2026, 10, 18, 22, 0, tzinfo=timezone.utc),
        }

    async def _session_user(self, request):
        del self, request
        return {"id": 42, "email": "listener@example.com", "session_id": "session-7"}

    monkeypatch.setattr(smart_mix, "issue_playback_continuation_token", _issue)

    with patch("crate.api.auth.AuthMiddleware.resolve_user", _session_user):
        response = test_app.post(
            "/api/playback/continuation-token",
            json={
                "descriptor": {
                    "kind": "seeded_radio",
                    "seedType": "album",
                    "seedId": "12",
                }
            },
        )

    assert response.status_code == 200
    assert issued == [
        {
            "user_id": 42,
            "session_id": "session-7",
            "descriptor": {"kind": "seeded_radio", "seedType": "album", "seedId": "12"},
        }
    ]


def test_continuation_token_rejects_an_incomplete_descriptor(test_app):
    response = test_app.post(
        "/api/playback/continuation-token",
        json={"descriptor": {"kind": "shaped_radio"}},
    )

    assert response.status_code == 422


def test_shaped_continuation_only_serves_the_session_owner(monkeypatch):
    from crate.api import radio
    import crate.radio_engine as radio_engine

    monkeypatch.setattr(radio_engine, "get_session_user_id", lambda session_id: 7)
    monkeypatch.setattr(
        radio_engine,
        "next_tracks",
        lambda session_id, count: pytest.fail("must not advance a foreign session"),
    )

    rows, exhausted = radio.continuation_radio_tracks(
        {"kind": "shaped_radio", "sessionId": "radio-1"},
        user={"id": 42},
        limit=5,
        exclude_entity_uids=set(),
    )

    assert rows == []
    assert exhausted is True


def test_shaped_continuation_skips_known_and_repeated_tracks(monkeypatch):
    from crate.api import radio
    import crate.radio_engine as radio_engine

    known = str(uuid.uuid4())
    fresh = str(uuid.uuid4())
    monkeypatch.setattr(radio_engine, "get_session_user_id", lambda session_id: 42)
    monkeypatch.setattr(
        radio_engine,
        "next_tracks",
        lambda session_id, count: {
            "tracks": [
                {"entity_uid": known, "title": "Known"},
                {"entity_uid": fresh, "title": "Fresh"},
                {"entity_uid": fresh, "title": "Fresh again"},
                {"title": "No uid"},
            ]
        },
    )

    rows, exhausted = radio.continuation_radio_tracks(
        {"kind": "shaped_radio", "sessionId": "radio-1"},
        user={"id": 42},
        limit=5,
        exclude_entity_uids={known},
    )

    assert [row["title"] for row in rows] == ["Fresh"]
    assert exhausted is False


def test_seeded_album_continuation_uses_the_album_generator(monkeypatch):
    from crate.api import radio

    entity_uid = str(uuid.uuid4())
    generated = []
    monkeypatch.setattr(radio, "get_album_for_radio", lambda album_id: {"name": "A"})
    monkeypatch.setattr(
        radio,
        "generate_album_radio",
        lambda album_id, limit, user_id: (
            generated.append((album_id, limit, user_id))
            or [{"track_entity_uid": entity_uid, "title": "Next"}]
        ),
    )
    monkeypatch.setattr(radio, "_enrich_radio_tracks", lambda rows: rows)

    rows, exhausted = radio.continuation_radio_tracks(
        {"kind": "seeded_radio", "seedType": "album", "seedId": "12"},
        user={"id": 42},
        limit=3,
        exclude_entity_uids={"a", "b"},
    )

    assert [row["track_entity_uid"] for row in rows] == [entity_uid]
    assert exhausted is False
    assert generated == [(12, 5, 42)]


def test_seeded_playlist_continuation_respects_playlist_ownership(monkeypatch):
    from crate.api import radio

    monkeypatch.setattr(
        radio,
        "get_playlist_for_radio",
        lambda playlist_id: {"scope": "user", "user_id": 7},
    )
    monkeypatch.setattr(
        radio,
        "generate_playlist_radio",
        lambda *args, **kwargs: pytest.fail("must not read a foreign playlist"),
    )

    rows, exhausted = radio.continuation_radio_tracks(
        {"kind": "seeded_radio", "seedType": "playlist", "seedId": "3"},
        user={"id": 42, "role": "user"},
        limit=3,
        exclude_entity_uids=set(),
    )

    assert (rows, exhausted) == ([], True)


def test_radio_next_rejects_another_users_session(test_app, monkeypatch):
    import crate.radio_engine as radio_engine

    session_id = "11111111-1111-4111-8111-111111111111"
    monkeypatch.setattr(
        radio_engine,
        "get_session_user_id",
        lambda value: 999 if value == session_id else None,
    )
    monkeypatch.setattr(
        radio_engine,
        "next_tracks",
        lambda session_id, count: pytest.fail("must not advance a foreign session"),
    )

    response = test_app.post(
        "/api/radio/next", json={"session_id": session_id, "count": 5}
    )

    assert response.status_code == 404


def test_continuation_descriptor_is_stored_with_the_token(pg_db):
    from crate.db.repositories.access_tokens import (
        get_continuation_descriptor,
        issue_playback_continuation_token,
    )
    from crate.db.repositories.auth_sessions import create_session

    user = pg_db.create_user("continuation-descriptor@test.com")
    session_id = f"session-{uuid.uuid4()}"
    create_session(
        session_id, user["id"], datetime.now(timezone.utc) + timedelta(days=1)
    )
    descriptor = {"kind": "shaped_radio", "sessionId": "radio-1"}

    issued = issue_playback_continuation_token(
        user_id=user["id"], session_id=session_id, descriptor=descriptor
    )

    assert get_continuation_descriptor(issued["id"]) == descriptor


def test_v116_schema_adds_the_descriptor_column():
    from crate.db.schema_sections.access_tokens_v116 import (
        create_playback_continuation_descriptor_v116_schema,
    )

    statements: list[str] = []

    class _Recorder:
        def execute(self, statement: str) -> None:
            statements.append(" ".join(statement.split()))

    create_playback_continuation_descriptor_v116_schema(_Recorder())

    assert statements == [
        "ALTER TABLE user_access_tokens ADD COLUMN IF NOT EXISTS "
        "continuation_descriptor JSONB"
    ]


def test_indexed_native_request_uses_buffer_tail_and_preserves_empty_status(
    test_app, monkeypatch
):
    from crate.api import smart_mix, radio

    tail, playing = uuid.uuid4(), uuid.uuid4()
    calls = []
    monkeypatch.setattr(
        smart_mix,
        "get_continuation_descriptor",
        lambda _: {
            "kind": "seeded_radio",
            "seedType": "album",
            "seedId": "12",
            "sessionId": "s",
        },
    )

    def indexed(descriptor, **kwargs):
        calls.append(kwargs)
        return {
            "tracks": [],
            "exhausted": False,
            "status": "retryable_empty",
            "session_id": "s",
            "batch_index": 0,
            "revision": 1,
        }

    monkeypatch.setattr(radio, "indexed_continuation_batch", indexed)
    with patch("crate.api.auth.AuthMiddleware.resolve_user", _continuation_user()):
        response = test_app.post(
            "/api/playback/continuation",
            json={
                "plannerVersion": "smart-mix-v2",
                "context": _CONTEXT,
                "recentEntityUids": [str(tail), str(playing)],
                "afterTrackEntityUid": str(tail),
                "batchIndex": 0,
            },
        )
    assert response.status_code == 200
    assert response.json()["status"] == "retryable_empty"
    assert response.json()["batchIndex"] == 0
    assert calls[0]["buffer_refs"] == [str(playing), str(tail)]


def test_legacy_native_lease_failure_returns_conflict_with_retry_after(
    test_app, monkeypatch
):
    from crate.api import smart_mix

    from tests.test_radio_contracts import _contended_radio_store

    session_id = str(uuid.uuid4())
    redis = _contended_radio_store(monkeypatch, session_id, user_id=42)
    monkeypatch.setattr(
        smart_mix,
        "get_continuation_descriptor",
        lambda _token_id: {"kind": "shaped_radio", "sessionId": session_id},
    )

    with (
        patch("crate.api.auth.AuthMiddleware.resolve_user", _continuation_user()),
        redis.lock(f"radio:session:{session_id}:lock", timeout=5),
    ):
        response = test_app.post(
            "/api/playback/continuation",
            json={"plannerVersion": "smart-mix-v2", "context": _CONTEXT},
        )

    assert response.status_code == 409
    assert response.headers["retry-after"] == "1"


@pytest.mark.parametrize("batch_index,cursor", [(0, -1), (4, 3)])
def test_indexed_native_contention_preserves_the_committed_cursor(
    test_app, monkeypatch, batch_index, cursor
):
    from crate.api import radio, smart_mix

    from tests.test_radio_contracts import _contended_radio_store

    session_id = str(uuid.uuid4())
    redis = _contended_radio_store(
        monkeypatch, session_id, existing=batch_index > 0, user_id=42
    )
    monkeypatch.setattr(
        smart_mix,
        "get_continuation_descriptor",
        lambda _token_id: {
            "kind": "seeded_radio",
            "seedType": "album",
            "seedId": "12",
            "sessionId": session_id,
        },
    )
    monkeypatch.setattr(radio, "get_album_for_radio", lambda _album_id: {"id": 12})
    with (
        patch("crate.api.auth.AuthMiddleware.resolve_user", _continuation_user()),
        redis.lock(f"radio:session:{session_id}:lock", timeout=5),
    ):
        response = test_app.post(
            "/api/playback/continuation",
            json={
                "plannerVersion": "smart-mix-v2",
                "context": _CONTEXT,
                "batchIndex": batch_index,
            },
        )

    assert response.status_code == 200
    assert response.json()["tracks"] == []
    assert response.json()["plans"] == []
    assert response.json()["status"] == "retryable_empty"
    assert response.json()["exhausted"] is False
    assert response.json()["batchIndex"] == cursor
