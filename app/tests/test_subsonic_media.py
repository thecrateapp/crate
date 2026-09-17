from unittest.mock import patch

import pytest
from fastapi import Response


USER = {"id": 41, "email": "listener@example.test", "role": "user"}


@pytest.mark.parametrize(
    ("audio_format", "max_bit_rate", "expected"),
    [
        (None, None, "original"),
        ("raw", 192, "original"),
        ("m4a", 128, "data_saver"),
        ("m4a", 160, "data_saver"),
        ("m4a", 192, "balanced"),
        ("m4a", 320, "balanced"),
    ],
)
def test_transcode_policy_maps_only_worker_supported_profiles(
    audio_format, max_bit_rate, expected
):
    from crate.subsonic.services.media import select_transcode_policy

    assert select_transcode_policy(audio_format, max_bit_rate) == expected


@pytest.mark.parametrize(("audio_format", "max_bit_rate"), [("mp3", 192), ("m4a", 96)])
def test_unsupported_transcode_requests_return_a_protocol_error(
    audio_format, max_bit_rate
):
    from crate.subsonic.errors import ErrorCode, OpenSubsonicError
    from crate.subsonic.services.media import select_transcode_policy

    with pytest.raises(OpenSubsonicError) as error:
        select_transcode_policy(audio_format, max_bit_rate)

    assert error.value.code == ErrorCode.GENERIC


def test_local_stream_uses_playback_worker_and_supports_ranges(test_app, tmp_path):
    from crate.streaming.service import PlaybackResolution

    audio = tmp_path / "song.flac"
    audio.write_bytes(b"0123456789")
    track = {"id": 7, "title": "Song", "path": str(audio), "format": "flac"}
    resolution = PlaybackResolution(
        requested_policy="data_saver",
        effective_policy="original",
        file_path=audio,
        media_type="audio/flac",
        source={},
        delivery={"fallback": True},
        transcoded=False,
        cache_hit=False,
        preparing=True,
        task_id="worker-task-1",
        variant_id="variant-1",
        variant_status="queued",
    )
    with (
        patch("crate.api.subsonic.media.authenticate", return_value=USER),
        patch("crate.subsonic.services.media.get_track_full", return_value=track),
        patch(
            "crate.subsonic.services.media.resolve_playback",
            return_value=resolution,
        ) as resolve,
    ):
        response = test_app.get(
            "/rest/stream?u=listener&p=secret&id=7&format=m4a&maxBitRate=160",
            headers={"Range": "bytes=2-5"},
        )

    assert response.status_code == 206
    assert response.content == b"2345"
    assert response.headers["content-range"] == "bytes 2-5/10"
    assert response.headers["content-type"].startswith("audio/flac")
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["content-length"] == str(len(b"2345"))
    assert response.headers["cache-control"] == "private, no-store"
    resolve.assert_called_once_with(track, "data_saver", enqueue=True)


def test_download_returns_original_as_an_attachment_without_transcoding(
    test_app, tmp_path
):
    audio = tmp_path / "song.flac"
    audio.write_bytes(b"original-audio")
    track = {"id": 7, "title": "Song", "path": str(audio), "format": "flac"}
    with (
        patch("crate.api.subsonic.media.authenticate", return_value=USER),
        patch("crate.subsonic.services.media.get_track_full", return_value=track),
        patch("crate.subsonic.services.media.resolve_source_path", return_value=audio),
        patch("crate.subsonic.services.media.resolve_playback") as resolve,
    ):
        response = test_app.get(
            "/rest/download?u=listener&p=secret&id=7&format=m4a&maxBitRate=128"
        )

    assert response.status_code == 200
    assert response.content == b"original-audio"
    assert response.headers["content-disposition"] == 'attachment; filename="song.flac"'
    assert response.headers["content-type"].startswith("audio/flac")
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["content-length"] == str(len(b"original-audio"))
    assert response.headers["cache-control"] == "private, no-store"
    resolve.assert_not_called()


def test_global_download_streams_original_and_encodes_unicode_filename():
    from crate.subsonic.services.media import download_track

    upstream = Response(b"audio", media_type="audio/flac")
    track = {"title": "Beyoncé", "format": "flac"}
    with (
        patch("crate.subsonic.services.media.get_global_track", return_value=track),
        patch(
            "crate.federation.playback_service.stream_global_track",
            return_value=upstream,
        ) as stream,
    ):
        response = download_track(
            "gt-11111111-1111-4111-8111-111111111111",
            user=USER,
            request_headers={"range": "bytes=0-4"},
        )

    assert response.headers["content-disposition"].startswith(
        'attachment; filename="Beyonc.flac"; filename*=UTF-8'
    )
    assert "Beyonc%C3%A9.flac" in response.headers["content-disposition"]
    stream.assert_called_once_with(
        "11111111-1111-4111-8111-111111111111",
        user=USER,
        request_headers={"range": "bytes=0-4"},
        delivery_policy="original",
    )


def test_media_routes_reject_unauthenticated_requests_with_protocol_envelopes(
    test_app,
):
    from crate.subsonic.errors import ErrorCode, OpenSubsonicError

    with patch(
        "crate.api.subsonic.media.authenticate",
        side_effect=OpenSubsonicError(ErrorCode.INVALID_CREDENTIALS, "Unauthorized"),
    ):
        stream = test_app.get("/rest/stream?u=listener&p=bad&id=7&f=json")
        download = test_app.get("/rest/download?u=listener&p=bad&id=7&f=json")

    for response in (stream, download):
        assert response.status_code == 200
        assert response.json()["subsonic-response"]["error"]["code"] == 40


def test_media_routes_are_registered_with_legacy_view_aliases(test_app):
    paths = {route.path for route in test_app.app.routes}
    from crate.api.subsonic import create_subsonic_router

    v1_paths = [route.path for route in create_subsonic_router("v1").routes]

    assert {
        "/rest/stream",
        "/rest/stream.view",
        "/rest/download",
        "/rest/download.view",
    }.issubset(paths)
    assert v1_paths.count("/rest/stream") == 1
    assert v1_paths.count("/rest/download") == 1

    api_paths = test_app.app.openapi()["paths"]
    stream_parameters = {
        parameter["name"]
        for parameter in api_paths["/rest/stream"]["get"]["parameters"]
    }
    download_parameters = {
        parameter["name"]
        for parameter in api_paths["/rest/download"]["get"]["parameters"]
    }
    assert {"u", "p", "f", "id", "format", "maxBitRate"}.issubset(stream_parameters)
    assert {"u", "p", "f", "id"}.issubset(download_parameters)


def test_preparing_transcode_falls_back_to_source_while_worker_is_busy(
    test_app, tmp_path
):
    from crate.streaming.service import PlaybackResolution

    audio = tmp_path / "song.flac"
    audio.write_bytes(b"source-audio")
    track = {"id": 7, "title": "Song", "path": str(audio), "format": "flac"}
    resolution = PlaybackResolution(
        requested_policy="balanced",
        effective_policy="original",
        file_path=audio,
        media_type="audio/flac",
        source={},
        delivery={"fallback": True},
        transcoded=False,
        cache_hit=False,
        preparing=True,
        task_id=None,
        variant_id="variant-1",
        variant_status="queued",
    )
    with (
        patch("crate.api.subsonic.media.authenticate", return_value=USER),
        patch("crate.subsonic.services.media.get_track_full", return_value=track),
        patch(
            "crate.subsonic.services.media.resolve_playback",
            return_value=resolution,
        ),
    ):
        response = test_app.get(
            "/rest/stream?u=listener&p=secret&id=7&format=m4a&maxBitRate=192"
        )

    assert response.status_code == 200
    assert response.content == b"source-audio"
