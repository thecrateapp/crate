from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from fastapi.responses import Response
import pytest
from unittest.mock import patch
from urllib.parse import urlencode

from crate.api.subsonic import create_subsonic_router
from crate.subsonic.errors import ErrorCode, OpenSubsonicError
from crate.subsonic.params import collect_parameters
from crate.subsonic.routes import OpenSubsonicAPIRouter


def _client(engine: str = "legacy") -> TestClient:
    app = FastAPI()
    app.include_router(create_subsonic_router(engine))
    return TestClient(app)


def _auth_form(**extra: str) -> dict[str, str]:
    return {
        "u": "listener",
        "p": "form-secret-not-for-logs",
        "v": "1.16.1",
        "c": "form-post-tests",
        "f": "json",
        **extra,
    }


@pytest.mark.parametrize("engine", ["legacy", "v1"])
def test_all_get_routes_also_accept_form_post(engine: str) -> None:
    for route in create_subsonic_router(engine).routes:
        methods = getattr(route, "methods", set()) or set()
        if "GET" in methods:
            assert "POST" in methods, route.path


@pytest.mark.parametrize(
    "path,response_format",
    [
        ("/rest/getMusicFolders", "json"),
        ("/rest/getMusicFolders.view", "xml"),
    ],
)
def test_legacy_route_has_get_form_post_and_view_parity(
    path: str, response_format: str
) -> None:
    client = _client()
    params = _auth_form(f=response_format)

    with (
        patch("crate.subsonic.auth.authenticate", return_value={"id": 1}) as auth,
        patch(
            "crate.api.subsonic.legacy.catalog.music_folders",
            return_value=[{"id": 1, "name": "Music"}],
        ),
    ):
        get_response = client.get(path, params=params)
        post_response = client.post(path, data=params)

    assert get_response.status_code == post_response.status_code == 200
    assert get_response.content == post_response.content
    assert auth.call_args.args[0].first("p") == "form-secret-not-for-logs"


def test_form_post_parses_encoded_scalar_and_preserves_empty_values() -> None:
    client = _client()
    values = _auth_form(genre="hip hop & r&b / 音", count="8")

    with (
        patch(
            "crate.api.subsonic.legacy._require_subsonic_auth", return_value={"id": 1}
        ),
        patch(
            "crate.api.subsonic.legacy.get_global_tracks_by_genre", return_value=[]
        ) as get_tracks,
    ):
        response = client.post("/rest/getSongsByGenre", data=values)

    assert response.status_code == 200
    assert response.json()["subsonic-response"]["status"] == "ok"
    assert get_tracks.call_args.args[0] == "hip hop & r&b / 音"
    assert get_tracks.call_args.kwargs["offset"] == 0


def test_form_post_avatar_returns_same_binary_content_as_get() -> None:
    client = _client("v1")
    params = _auth_form(username="listener")
    user = {"id": 1, "username": "listener", "avatar": "https://avatar.test/a"}

    with (
        patch("crate.subsonic.auth.authenticate", return_value={"id": 1}),
        patch("crate.api.subsonic.system.get_user_by_username", return_value=user),
        patch(
            "crate.api.subsonic.system.fetch_avatar",
            return_value=(b"avatar-data", "image/jpeg"),
        ),
    ):
        get_response = client.get("/rest/getAvatar", params=params)
        post_response = client.post("/rest/getAvatar", data=params)

    assert get_response.status_code == post_response.status_code == 200
    assert get_response.content == post_response.content == b"avatar-data"
    assert get_response.headers["content-type"] == post_response.headers["content-type"]


def test_form_post_stream_uses_the_same_media_parameters_as_get() -> None:
    client = _client("v1")
    params = _auth_form(id="track-1", format="flac", maxBitRate="320")

    with (
        patch("crate.api.subsonic.media.authenticate", return_value={"id": 1}),
        patch(
            "crate.api.subsonic.media.media_service.stream_track",
            return_value=Response(b"audio-data", media_type="audio/flac"),
        ) as stream_track,
    ):
        get_response = client.get("/rest/stream", params=params)
        post_response = client.post("/rest/stream", data=params)

    assert get_response.status_code == post_response.status_code == 200
    assert get_response.content == post_response.content == b"audio-data"
    assert stream_track.call_args.args[0] == "track-1"
    assert stream_track.call_args.kwargs["audio_format"] == "flac"
    assert stream_track.call_args.kwargs["max_bit_rate"] == "320"


def test_form_post_preserves_repeated_list_parameters_for_playlists() -> None:
    client = _client()
    fields = {
        "u": "listener",
        "p": "form-secret-not-for-logs",
        "f": "json",
        "name": "",
        "songId": ["song-1", "song-2"],
    }

    with (
        patch(
            "crate.api.subsonic.legacy._require_subsonic_auth", return_value={"id": 1}
        ),
        patch(
            "crate.api.subsonic.legacy.playlist_service.create_playlist",
            return_value={"id": "playlist-1", "name": "Mix", "entry": []},
        ) as create_playlist,
    ):
        response = client.post("/rest/createPlaylist.view", data=fields)

    assert response.status_code == 200
    assert response.json()["subsonic-response"]["status"] == "ok"
    assert create_playlist.call_args.kwargs == {
        "name": "",
        "playlist_id": None,
        "song_ids": ["song-1", "song-2"],
    }


@pytest.mark.parametrize("response_format", ["json", "xml"])
def test_v1_get_and_form_post_errors_have_identical_envelopes(
    response_format: str,
) -> None:
    client = _client("v1")
    params = {
        "v": "1.16.1",
        "c": "form-post-tests",
        "f": response_format,
        "u": "listener",
        "p": "form-secret-not-for-logs",
    }

    with patch(
        "crate.subsonic.auth.authenticate",
        side_effect=OpenSubsonicError(ErrorCode.INVALID_CREDENTIALS, "invalid"),
    ):
        get_response = client.get("/rest/ping", params=params)
        post_response = client.post("/rest/ping", data=params)

    assert get_response.status_code == post_response.status_code == 200
    assert get_response.content == post_response.content
    assert "form-secret-not-for-logs" not in post_response.text


def test_form_post_secrets_stay_out_of_the_request_url() -> None:
    router = OpenSubsonicAPIRouter()

    @router.get("/form-post-probe")
    async def form_post_probe(request: Request) -> dict[str, object]:
        params = await collect_parameters(request)
        return {
            "query": request.scope["query_string"].decode(),
            "ids": params.get_all("id"),
            "authenticated": params.contains("p"),
            "body_retained": hasattr(request, "_body"),
        }

    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).post(
        "/form-post-probe",
        data={"id": ["track-1", "track-2"], "p": "form-secret-not-for-logs"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "query": "",
        "ids": ["track-1", "track-2"],
        "authenticated": True,
        "body_retained": False,
    }


def test_form_post_rejects_oversized_body_without_echoing_it() -> None:
    router = OpenSubsonicAPIRouter()

    @router.get("/form-post-probe")
    def form_post_probe() -> dict[str, str]:
        return {"status": "ok"}

    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).post(
        "/form-post-probe",
        content=b"p=" + b"s" * (4 * 1024 * 1024),
        headers={"content-type": "application/x-www-form-urlencoded"},
    )

    assert response.status_code == 413
    assert "s" * 64 not in response.text


def test_form_post_rejects_too_many_fields_without_echoing_values() -> None:
    router = OpenSubsonicAPIRouter()

    @router.get("/form-post-probe")
    def form_post_probe() -> dict[str, str]:
        return {"status": "ok"}

    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).post(
        "/form-post-probe",
        content=urlencode([("id", f"private-{index}") for index in range(50_001)]),
        headers={"content-type": "application/x-www-form-urlencoded"},
    )

    assert response.status_code == 400
    assert "private-0" not in response.text


def test_form_post_secret_is_not_exposed_by_validation_or_operation_errors(
    caplog: pytest.LogCaptureFixture,
) -> None:
    client = _client("v1")
    with (
        patch("crate.subsonic.auth.authenticate", return_value={"id": 1}),
        patch(
            "crate.subsonic.services.system_operations.scan_status",
            side_effect=RuntimeError("storage unavailable"),
        ),
        patch(
            "crate.api.subsonic.legacy._require_subsonic_auth", return_value={"id": 1}
        ),
    ):
        operation_response = client.post("/rest/getScanStatus", data=_auth_form())
        validation_response = client.post(
            "/rest/getSongsByGenre",
            data=_auth_form(genre="rock", count="not-an-integer"),
        )

    assert operation_response.status_code == 200
    assert "form-secret-not-for-logs" not in operation_response.text
    assert validation_response.status_code == 422
    assert "form-secret-not-for-logs" not in validation_response.text
    assert "form-secret-not-for-logs" not in caplog.text


def test_form_post_extension_is_advertised_after_parity_is_complete() -> None:
    from crate.subsonic.capabilities import advertised_extensions

    assert {"name": "formPost", "versions": [1]} in advertised_extensions()

    response = _client("v1").post(
        "/rest/getOpenSubsonicExtensions",
        data={"v": "1.16.1", "c": "form-post-tests", "f": "json"},
    )
    advertised = response.json()["subsonic-response"]["openSubsonicExtensions"]
    assert {"name": "formPost", "versions": [1]} in advertised
