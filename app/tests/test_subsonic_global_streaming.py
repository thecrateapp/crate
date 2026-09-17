from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import Response
import pytest

from crate.federation.playback_service import PlaybackServiceError


USER = {
    "id": 41,
    "email": "listener@example.test",
    "username": "listener",
    "role": "user",
    "password_hash": "unused",
}
ARTIST_UID = "11111111-1111-4111-8111-111111111111"
ALBUM_UID = "22222222-2222-4222-8222-222222222222"
TRACK_UID = "33333333-3333-4333-8333-333333333333"


def _auth():
    return patch("crate.subsonic.auth.authenticate", return_value=USER)


def _media_auth():
    return patch("crate.api.subsonic.media.authenticate", return_value=USER)


def test_global_stream_is_proxied_without_exposing_ticket_or_redirect(test_app):
    proxied = Response(
        b"audio",
        status_code=206,
        media_type="audio/flac",
        headers={"Content-Range": "bytes 0-4/5", "Accept-Ranges": "bytes"},
    )
    with (
        _media_auth(),
        patch(
            "crate.federation.playback_service.stream_global_track",
            return_value=proxied,
        ) as stream,
    ):
        response = test_app.get(
            f"/rest/stream?u=listener&p=secret&id=gt-{TRACK_UID}"
            "&format=m4a&maxBitRate=160",
            headers={"Range": "bytes=0-4"},
        )

    assert response.status_code == 206
    assert response.content == b"audio"
    assert "location" not in response.headers
    assert "ticket" not in response.headers
    request_headers = stream.call_args.kwargs["request_headers"]
    assert request_headers["range"] == "bytes=0-4"
    assert stream.call_args.kwargs["user"] == USER
    assert stream.call_args.kwargs["delivery_policy"] == "data_saver"


def test_global_stream_maps_internal_playback_failure_without_leaking_detail(test_app):
    with (
        _media_auth(),
        patch(
            "crate.federation.playback_service.stream_global_track",
            side_effect=PlaybackServiceError(503, "peer secret detail"),
        ),
    ):
        response = test_app.get(f"/rest/stream?u=listener&p=secret&id=gt-{TRACK_UID}")

    assert response.status_code == 503
    assert b"peer secret detail" not in response.content


def test_global_cover_art_uses_canonical_resolver_with_subsonic_user(test_app):
    image = Response(
        b"image",
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=900"},
    )
    with (
        _auth(),
        patch(
            "crate.federation.global_artwork.serve_global_artwork",
            return_value=image,
        ) as serve,
    ):
        response = test_app.get(
            f"/rest/getCoverArt?u=listener&p=secret&id=gal-{ALBUM_UID}&size=320"
        )

    assert response.status_code == 200
    assert response.content == b"image"
    serve.assert_called_once_with(
        ALBUM_UID,
        entity_type="album",
        user=USER,
        size=320,
        image_format=None,
    )


def test_artwork_references_from_all_media_serializers_resolve(test_app):
    from crate.subsonic.serializers import (
        serialize_album,
        serialize_artist,
        serialize_artist_indexes,
        serialize_song,
    )

    artist = {
        "global_artist_uid": ARTIST_UID,
        "name": "High Vis",
        "album_count": 1,
        "has_photo": True,
    }
    album = {
        "global_album_uid": ALBUM_UID,
        "global_artist_uid": ARTIST_UID,
        "name": "Blending",
        "artist": "High Vis",
        "year": 2022,
        "track_count": 1,
        "duration": 190,
        "has_cover": True,
    }
    song = {
        "global_track_uid": TRACK_UID,
        "global_album_uid": ALBUM_UID,
        "global_artist_uid": ARTIST_UID,
        "title": "Talk For Hours",
        "artist": "High Vis",
        "album": "Blending",
        "track_number": 1,
        "disc_number": 1,
        "duration": 190,
        "format": "flac",
        "has_cover": True,
    }
    references = [
        serialize_artist_indexes([artist])["index"][0]["artist"][0]["coverArt"],
        serialize_artist(artist, albums=[album])["coverArt"],
        serialize_album(album, songs=[song])["coverArt"],
        serialize_song(song)["coverArt"],
    ]
    image = Response(b"art", media_type="image/webp")

    with (
        _auth(),
        patch(
            "crate.federation.global_artwork.serve_global_artwork", return_value=image
        ) as serve,
    ):
        responses = [
            test_app.get(f"/rest/getCoverArt?u=listener&p=secret&id={reference}")
            for reference in references
        ]

    assert all(response.status_code == 200 for response in responses)
    assert all(response.content == b"art" for response in responses)
    assert serve.call_count == len(references)


def test_global_scrobble_records_global_identity_and_actual_source(test_app):
    track = {
        "global_track_uid": TRACK_UID,
        "global_album_uid": ALBUM_UID,
        "global_artist_uid": ARTIST_UID,
        "title": "Marigold",
        "artist": "High Vis",
        "album": "Blending",
        "duration": 228,
    }
    with (
        _auth(),
        patch("crate.subsonic.services.playback.get_global_track", return_value=track),
        patch(
            "crate.federation.playback_service.get_remembered_source",
            return_value={
                "content_origin": "remote",
                "source_node_uid": "44444444-4444-4444-8444-444444444444",
            },
        ),
        patch("crate.subsonic.services.playback.record_play_event") as record_event,
    ):
        response = test_app.get(
            f"/rest/scrobble?u=listener&p=secret&id=gt-{TRACK_UID}"
            "&submission=true&time=1784023200000"
        )

    assert response.status_code == 200
    payload = record_event.call_args.kwargs
    assert payload["track_id"] is None
    assert payload["global_track_uid"] == TRACK_UID
    assert payload["content_origin"] == "remote"
    assert payload["source_node_uid"] == "44444444-4444-4444-8444-444444444444"


def test_local_global_source_rejects_paths_outside_library(tmp_path):
    outside = tmp_path.parent / "outside.flac"
    outside.write_bytes(b"secret")
    with (
        patch(
            "crate.federation.playback_service.resolve_global_track_playback",
            return_value={"kind": "local", "local_track_id": 7},
        ),
        patch(
            "crate.federation.playback_service.get_track_delivery_row_by_id",
            return_value={"id": 7, "path": str(outside)},
        ),
        patch("crate.api._deps.library_path", return_value=tmp_path),
        patch(
            "crate.playback_provenance.resolve_local_content_provenance",
            return_value=("local", None),
        ),
        patch("crate.federation.playback_service._remember_source"),
    ):
        from crate.federation.playback_service import stream_global_track

        with pytest.raises(PlaybackServiceError) as error:
            stream_global_track(TRACK_UID, user=USER, request_headers={})

    assert error.value.status_code == 403


def test_remote_stream_disconnect_closes_upstream_context_and_client(monkeypatch):
    from crate.federation import playback_service

    node_uid = "55555555-5555-4555-8555-555555555555"
    peer_uid = "44444444-4444-4444-8444-444444444444"
    upstream = MagicMock()
    upstream.status_code = 200
    upstream.headers = {"content-type": "audio/flac"}
    upstream.iter_bytes.return_value = iter((b"first", b"second"))

    context = MagicMock()
    context.__enter__.return_value = upstream
    client = MagicMock()
    client.stream.return_value = context

    monkeypatch.setattr(
        playback_service,
        "resolve_global_track_playback",
        lambda _uid: {
            "kind": "remote",
            "node_uid": peer_uid,
            "remote_entity_uid": "track-remote",
        },
    )
    monkeypatch.setattr(
        playback_service.federation_repo,
        "get_local_node",
        lambda: {
            "node_uid": node_uid,
            "active_key_id": "key-1",
            "private_key_ref": "ref-1",
        },
    )
    monkeypatch.setattr(
        playback_service.federation_repo,
        "get_peer",
        lambda _uid: {
            "trust_state": "approved",
            "api_base_url": "https://peer.example.test",
        },
    )
    monkeypatch.setattr(
        playback_service,
        "build_outbound_user_assertion",
        lambda **_kwargs: "assertion",
    )
    monkeypatch.setattr(
        playback_service,
        "federated_post",
        lambda **_kwargs: SimpleNamespace(
            status_code=200, json=lambda: {"ticket_uid": "ticket-1"}
        ),
    )
    monkeypatch.setattr(
        playback_service, "SignedFederationClient", lambda **_kwargs: client
    )
    monkeypatch.setattr(
        playback_service, "get_shared_client", lambda _timeout: object()
    )
    monkeypatch.setattr(playback_service, "_remember_source", lambda **_kwargs: None)

    async def disconnect_after_first_chunk():
        response = playback_service.stream_global_track(
            TRACK_UID, user=USER, request_headers={}
        )
        assert await anext(response.body_iterator) == b"first"
        await response.body_iterator.aclose()

    asyncio.run(disconnect_after_first_chunk())

    context.__exit__.assert_called_once_with(None, None, None)
    client.close.assert_called_once_with()


@pytest.mark.parametrize(
    "content_type", ["text/html", "image/svg+xml", "application/json"]
)
def test_remote_global_artwork_rejects_unsafe_content_types(content_type, monkeypatch):
    import crate.federation.global_artwork as artwork

    monkeypatch.setattr(
        artwork,
        "resolve_global_album_artwork",
        lambda _uid: {
            "kind": "remote",
            "node_uid": "44444444-4444-4444-8444-444444444444",
            "remote_entity_uid": "album-remote",
        },
    )
    monkeypatch.setattr(
        artwork.federation_repo,
        "get_local_node",
        lambda: {
            "node_uid": "55555555-5555-4555-8555-555555555555",
            "active_key_id": "key-1",
            "private_key_ref": "federation/keys/key-1.pem",
        },
    )
    monkeypatch.setattr(
        artwork.federation_repo,
        "get_peer",
        lambda _uid: {
            "trust_state": "approved",
            "disabled_at": None,
            "api_base_url": "https://peer.example",
        },
    )
    monkeypatch.setattr(artwork, "build_outbound_user_assertion", lambda **_kw: "jwt")

    class FakeResponse:
        status_code = 200
        headers = {"content-type": content_type}
        content = b"unsafe"

    class FakeClient:
        def __init__(self, **kwargs):
            assert kwargs["max_response_bytes"] == artwork.MAX_ARTWORK_BYTES

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def request(self, method, path, *, user_assertion):
            assert method == "GET"
            assert user_assertion == "jwt"
            return FakeResponse()

    monkeypatch.setattr(artwork, "SignedFederationClient", FakeClient)

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as error:
        artwork.serve_global_artwork(
            ALBUM_UID,
            entity_type="album",
            user=USER,
        )

    assert error.value.status_code == 502


def test_remote_global_artwork_preserves_cache_validators(monkeypatch):
    import crate.federation.global_artwork as artwork

    monkeypatch.setattr(
        artwork,
        "resolve_global_album_artwork",
        lambda _uid: {
            "kind": "remote",
            "node_uid": "44444444-4444-4444-8444-444444444444",
            "remote_entity_uid": "album-remote",
        },
    )
    monkeypatch.setattr(
        artwork.federation_repo,
        "get_local_node",
        lambda: {
            "node_uid": "55555555-5555-4555-8555-555555555555",
            "active_key_id": "key-1",
            "private_key_ref": "federation/keys/key-1.pem",
        },
    )
    monkeypatch.setattr(
        artwork.federation_repo,
        "get_peer",
        lambda _uid: {
            "trust_state": "approved",
            "disabled_at": None,
            "api_base_url": "https://peer.example",
        },
    )
    monkeypatch.setattr(artwork, "build_outbound_user_assertion", lambda **_kw: "jwt")

    class FakeResponse:
        status_code = 200
        headers = {
            "content-type": "image/jpeg",
            "etag": '"peer-revision"',
            "last-modified": "Mon, 14 Sep 2026 09:00:00 GMT",
        }
        content = b"image"

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def request(self, method, path, *, user_assertion):
            assert method == "GET"
            assert path.endswith("?size=512")
            assert user_assertion == "jwt"
            return FakeResponse()

    monkeypatch.setattr(artwork, "SignedFederationClient", FakeClient)

    response = artwork.serve_global_artwork(
        ALBUM_UID,
        entity_type="album",
        user=USER,
        size=512,
    )

    assert response.headers["etag"] == '"peer-revision"'
    assert response.headers["last-modified"] == "Mon, 14 Sep 2026 09:00:00 GMT"
