from crate.api import jam, playlists
from crate.api.public_urls import public_share_url
from crate.api.schemas.jam import JamInviteCreateRequest, JamInviteResponse
from crate.api.schemas.playlists import PlaylistInviteRequest, PlaylistInviteResponse
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


def test_playlist_invite_preserves_relative_urls_and_exposes_public_url(monkeypatch):
    monkeypatch.setenv(
        "CRATE_PUBLIC_LISTEN_BASE_URL", "https://listen.custom.test/library/"
    )
    monkeypatch.setattr(playlists, "_require_auth", lambda _request: {"id": 7})
    monkeypatch.setattr(
        playlists, "get_playlist", lambda _playlist_id: {"id": 12, "user_id": 7}
    )
    monkeypatch.setattr(playlists, "is_playlist_owner", lambda *_args: True)
    monkeypatch.setattr(
        playlists,
        "create_playlist_invite",
        lambda *_args, **_kwargs: {"token": "playlist-token", "playlist_id": 12},
    )

    response = playlists.invite(
        _request(), playlist_id=12, body=PlaylistInviteRequest()
    )

    expected = "/playlist/invite/playlist-token"
    assert response["join_url"] == expected
    assert response["qr_value"] == expected
    assert response["public_url"] == (
        "https://listen.custom.test/library/playlist/invite/playlist-token"
    )
    assert (
        PlaylistInviteResponse.model_validate(response).public_url
        == response["public_url"]
    )


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
