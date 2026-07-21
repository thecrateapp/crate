from __future__ import annotations

from types import SimpleNamespace


def _unexpected_request_path_work(*_args, **_kwargs):
    raise AssertionError("artwork GET performed worker-only work")


def test_album_cover_does_not_extract_embedded_artwork_during_request(
    tmp_path, monkeypatch
):
    from crate.api import browse_album

    album_dir = tmp_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    track = album_dir / "01 - Track.flac"
    track.write_bytes(b"not-a-real-track")

    monkeypatch.setattr(browse_album, "library_path", lambda: tmp_path)
    monkeypatch.setattr(browse_album, "extensions", lambda: [".flac"])
    monkeypatch.setattr(
        "crate.artwork_sources.extract_embedded_artwork",
        _unexpected_request_path_work,
    )

    response = browse_album.api_cover(
        "Artist", "Album", album_dir=album_dir, album_entity_uid=""
    )

    assert response.status_code == 200
    assert response.media_type == "image/svg+xml"


def test_artist_photo_does_not_call_remote_provider_during_request(
    tmp_path, monkeypatch
):
    from crate.api import browse_artist

    artist_dir = tmp_path / "Artist"
    artist_dir.mkdir()

    monkeypatch.setattr(browse_artist, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(browse_artist, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        browse_artist,
        "get_library_artist",
        lambda _name: {"id": 1, "entity_uid": "artist-entity", "name": "Artist"},
    )
    monkeypatch.setattr(
        browse_artist,
        "resolve_artist_dir",
        lambda *_args, **_kwargs: artist_dir,
    )
    monkeypatch.setattr(
        "crate.lastfm.get_best_artist_image", _unexpected_request_path_work
    )

    response = browse_artist.api_artist_photo(SimpleNamespace(), "Artist")

    assert response.status_code == 404


def test_artist_background_does_not_call_remote_provider_during_request(
    tmp_path, monkeypatch
):
    from crate.api import browse_artist

    artist_dir = tmp_path / "Artist"
    artist_dir.mkdir()
    monkeypatch.setattr(browse_artist, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(browse_artist, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        browse_artist,
        "get_library_artist",
        lambda _name: {"id": 1, "entity_uid": "artist-entity", "name": "Artist"},
    )
    monkeypatch.setattr(
        browse_artist,
        "resolve_artist_dir",
        lambda *_args, **_kwargs: artist_dir,
    )
    monkeypatch.setattr(
        "crate.lastfm.get_fanart_all_images", _unexpected_request_path_work
    )

    response = browse_artist.api_artist_background(SimpleNamespace(), "Artist")

    assert response.status_code == 404


def test_pre_release_cover_does_not_fetch_remote_image_during_request(
    tmp_path, monkeypatch
):
    from crate.api import browse_album

    monkeypatch.setattr(
        browse_album,
        "get_release_by_virtual_album_id",
        lambda _album_id: {
            "id": 46,
            "album_title": "Future Album",
            "cover_url": "https://images.example.test/future.jpg",
        },
    )
    monkeypatch.setattr(
        browse_album,
        "release_cover_abspath",
        lambda _album_id: tmp_path / "missing-cover.jpg",
    )
    monkeypatch.setattr(
        "requests.Session.get",
        _unexpected_request_path_work,
    )

    response = browse_album.api_cover_by_id(-46)

    assert response.status_code == 200
    assert response.media_type == "image/svg+xml"
