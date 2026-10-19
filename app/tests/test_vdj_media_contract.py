from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from crate import media_access
from crate.api.auth import AuthMiddleware

REAL_RESOLVE_USER = AuthMiddleware.resolve_user
TRACK_UID = "11111111-1111-4111-8111-111111111111"
STREAM_PATH = f"/api/vdj/tracks/by-entity/{TRACK_UID}/stream"
AUDIO = bytes(range(256)) * 16


class _FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.ttls: dict[str, int] = {}

    def set(self, key: str, value: str, *, ex: int) -> bool:
        self.values[key] = value
        self.ttls[key] = ex
        return True

    def get(self, key: str) -> str | None:
        return self.values.get(key)


@pytest.fixture(autouse=True)
def _vdj_enabled(monkeypatch):
    monkeypatch.setenv("CRATE_VDJ_ENABLED", "true")


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    redis = _FakeRedis()
    monkeypatch.setattr(media_access, "_redis_client", lambda: redis)
    return redis


@pytest.fixture
def token_state(monkeypatch: pytest.MonkeyPatch) -> dict:
    state = {"active": True, "scopes": ["vdj.media.read"]}

    def resolve(token_id: int):
        if not state["active"]:
            return None
        return {
            "id": token_id,
            "user_id": 7,
            "email": "dj@example.test",
            "role": "user",
            "scopes": state["scopes"],
        }

    monkeypatch.setattr(
        "crate.db.repositories.access_tokens.resolve_access_token_by_id", resolve
    )
    return state


@pytest.fixture
def audio_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    from crate.api import browse_media

    path = tmp_path / "track.flac"
    path.write_bytes(AUDIO)
    monkeypatch.setattr(
        browse_media,
        "get_track_delivery_row_by_entity_uid",
        lambda entity_uid: {"id": 1, "entity_uid": entity_uid, "path": str(path)},
    )
    monkeypatch.setattr(
        browse_media,
        "resolve_playback",
        lambda _track, _delivery, enqueue=True: SimpleNamespace(
            file_path=path,
            media_type="audio/flac",
            delivery={"format": "flac"},
            source={"format": "flac"},
            requested_policy="original",
            effective_policy="original",
            transcoded=False,
            variant_status=None,
            preparing=False,
        ),
    )
    return path


def _token_ticket(path: str = STREAM_PATH) -> str:
    return media_access.issue_media_access_ticket(
        user_id=7,
        access_token_id=42,
        audience="stream",
        path=path,
    ).ticket


def _get(test_app, ticket: str, *, path: str = STREAM_PATH, **headers):
    with patch.object(AuthMiddleware, "resolve_user", REAL_RESOLVE_USER):
        return test_app.get(f"{path}?media_ticket={ticket}", headers=headers)


def test_access_token_tickets_cover_the_initial_download(fake_redis) -> None:
    issued = media_access.issue_media_access_ticket(
        user_id=7, access_token_id=42, audience="stream", path=STREAM_PATH
    )

    [ttl] = fake_redis.ttls.values()
    assert ttl == media_access.ACCESS_TOKEN_MEDIA_TTL_SECONDS == 15 * 60
    remaining = issued.expires_at - datetime.now(timezone.utc)
    assert timedelta(minutes=14) < remaining <= timedelta(minutes=15)


def test_session_tickets_keep_their_short_lifetime(fake_redis) -> None:
    media_access.issue_media_access_ticket(
        user_id=7,
        session_id="session-1",
        audience="stream",
        path="/api/tracks/by-entity/track-1/stream",
    )

    assert list(fake_redis.ttls.values()) == [media_access.MEDIA_ACCESS_TTL_SECONDS]
    assert media_access.MEDIA_ACCESS_TTL_SECONDS == 60


def test_token_ticket_serves_full_partial_and_suffix_ranges(
    test_app, fake_redis, token_state, audio_file
) -> None:
    ticket = _token_ticket()

    full = _get(test_app, ticket)
    partial = _get(test_app, ticket, Range="bytes=0-99")
    suffix = _get(test_app, ticket, Range="bytes=-100")

    assert full.status_code == 200
    assert full.content == AUDIO
    assert partial.status_code == 206
    assert partial.content == AUDIO[:100]
    assert partial.headers["content-range"] == f"bytes 0-99/{len(AUDIO)}"
    assert suffix.status_code == 206
    assert suffix.content == AUDIO[-100:]


def test_unsatisfiable_range_is_rejected(
    test_app, fake_redis, token_state, audio_file
) -> None:
    response = _get(
        test_app, _token_ticket(), Range=f"bytes={len(AUDIO) + 10}-{len(AUDIO) + 20}"
    )

    assert response.status_code == 416


def test_head_reports_the_full_length(
    test_app, fake_redis, token_state, audio_file
) -> None:
    ticket = _token_ticket()
    with patch.object(AuthMiddleware, "resolve_user", REAL_RESOLVE_USER):
        response = test_app.head(f"{STREAM_PATH}?media_ticket={ticket}")

    assert response.status_code == 200
    assert response.headers["content-length"] == str(len(AUDIO))


def test_revoking_the_token_stops_the_next_range(
    test_app, fake_redis, token_state, audio_file
) -> None:
    ticket = _token_ticket()
    assert _get(test_app, ticket, Range="bytes=0-99").status_code == 206

    token_state["active"] = False

    assert _get(test_app, ticket, Range="bytes=100-199").status_code == 401


def test_expired_ticket_is_rejected_before_the_first_request(
    test_app, fake_redis, token_state, audio_file
) -> None:
    ticket = _token_ticket()
    fake_redis.values.clear()

    assert _get(test_app, ticket).status_code == 401


def test_ticket_for_another_track_is_rejected(
    test_app, fake_redis, token_state, audio_file
) -> None:
    other_path = "/api/vdj/tracks/by-entity/22222222-2222-4222-8222-222222222222/stream"
    ticket = _token_ticket(other_path)

    assert _get(test_app, ticket).status_code == 401


def test_ticket_without_media_scope_is_forbidden(
    test_app, fake_redis, token_state, audio_file
) -> None:
    ticket = _token_ticket()
    token_state["scopes"] = ["vdj.catalog.read"]

    assert _get(test_app, ticket).status_code == 403


def test_vdj_playback_identifies_the_local_track_it_resolved(
    test_app, fake_redis, token_state, audio_file, monkeypatch
) -> None:
    from crate.api import browse_media

    monkeypatch.setattr(
        "crate.playback_provenance.resolve_local_content_provenance",
        lambda _track_id: ("local", None),
    )
    monkeypatch.setattr(
        "crate.playback_provenance.issue_playback_session",
        lambda **_kwargs: "playback-session",
    )
    monkeypatch.setattr(
        browse_media,
        "resolution_to_payload",
        lambda _resolution, stream_url: {
            "stream_url": stream_url,
            "requested_policy": "original",
            "effective_policy": "original",
            "source": {"format": "flac"},
            "delivery": {"format": "flac"},
            "preparing": False,
        },
    )

    async def token_user(_middleware, _request):
        return {
            "id": 7,
            "auth_type": "access_token",
            "access_token_id": 42,
            "scopes": ["vdj.media.read"],
        }

    with patch.object(AuthMiddleware, "resolve_user", token_user):
        response = test_app.get(f"/api/vdj/tracks/by-entity/{TRACK_UID}/playback")

    assert response.status_code == 200
    payload = response.json()
    assert payload["entity_uid"] == TRACK_UID
    assert payload["content_origin"] == "local"
    assert payload["preparing"] is False
    assert payload["delivery"]["format"] == "flac"
