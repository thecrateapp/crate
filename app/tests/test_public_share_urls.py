from crate.api import jam
from crate.api.public_urls import public_share_url
from crate.api.schemas.jam import JamInviteCreateRequest, JamInviteResponse
from starlette.requests import Request


def _request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [],
            "query_string": b"",
            "server": ("api.example.test", 443),
            "scheme": "https",
            "client": ("127.0.0.1", 12345),
        }
    )


def test_public_share_url_returns_none_without_a_canonical_listen_origin(
    monkeypatch,
):
    monkeypatch.delenv("CRATE_PUBLIC_LISTEN_BASE_URL", raising=False)

    assert public_share_url("/jam/invite/token") is None


def test_public_share_url_ignores_invalid_configured_origins(monkeypatch):
    monkeypatch.setenv(
        "CRATE_PUBLIC_LISTEN_BASE_URL", "https://user:password@listen.test"
    )

    assert public_share_url("/jam/invite/token") is None


def test_jam_invite_preserves_relative_urls_and_exposes_public_url(monkeypatch):
    monkeypatch.setenv("CRATE_PUBLIC_LISTEN_BASE_URL", "https://music.example.test")
    monkeypatch.setattr(jam, "_require_auth", lambda _request: {"id": 7})
    monkeypatch.setattr(
        jam,
        "get_jam_room",
        lambda _room_id: {"id": "room-1", "host_user_id": 7, "status": "active"},
    )
    monkeypatch.setattr(
        jam,
        "create_jam_room_invite",
        lambda *_args, **_kwargs: {"token": "jam-token", "room_id": "room-1"},
    )

    response = jam.create_room_invite(
        _request(), room_id="room-1", body=JamInviteCreateRequest()
    )

    expected = "/jam/invite/jam-token"
    assert response["join_url"] == expected
    assert response["qr_value"] == expected
    assert response["public_url"] == "https://music.example.test/jam/invite/jam-token"
    assert (
        JamInviteResponse.model_validate(response).public_url == response["public_url"]
    )
