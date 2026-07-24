from __future__ import annotations

from types import SimpleNamespace


def test_album_id_and_entity_routes_use_same_canonical_asset(monkeypatch, tmp_path):
    from crate.api import browse_album

    album_dir = tmp_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    cover = album_dir / "cover.jpg"
    cover.write_bytes(b"cover")
    album = {
        "id": 7,
        "entity_uid": "album-entity",
        "artist": "Artist",
        "name": "Album",
    }
    delivered = []
    monkeypatch.setattr(browse_album, "get_library_album_by_id", lambda _id: album)
    monkeypatch.setattr(
        browse_album, "get_library_album_by_entity_uid", lambda _uid: album
    )
    monkeypatch.setattr(browse_album, "get_library_artist", lambda _name: {})
    monkeypatch.setattr(browse_album, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        browse_album, "resolve_album_dir", lambda *_args, **_kwargs: album_dir
    )
    monkeypatch.setattr(
        browse_album,
        "deliver_artwork",
        lambda asset, **kwargs: (
            delivered.append((asset, kwargs)) or SimpleNamespace(status_code=200)
        ),
    )

    browse_album.api_cover_by_id(7, size=320, image_format="webp")
    browse_album.api_cover_by_entity_uid("album-entity", size=320, image_format="webp")

    assert [asset.entity_key for asset, _kwargs in delivered] == [
        "album-entity",
        "album-entity",
    ]
    assert all(asset.kind == "album-cover" for asset, _kwargs in delivered)
    assert all(kwargs["local_original"] == cover for _asset, kwargs in delivered)
    assert all(kwargs["requested_size"] == 320 for _asset, kwargs in delivered)


def test_artist_id_and_entity_routes_use_same_canonical_asset(monkeypatch, tmp_path):
    from crate.api import browse_artist

    artist_dir = tmp_path / "Artist"
    artist_dir.mkdir()
    photo = artist_dir / "artist.jpg"
    photo.write_bytes(b"photo")
    artist = {
        "id": 5,
        "entity_uid": "artist-entity",
        "name": "Artist",
    }
    delivered = []
    monkeypatch.setattr(browse_artist, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(browse_artist, "artist_name_from_id", lambda _id: "Artist")
    monkeypatch.setattr(browse_artist, "get_library_artist", lambda _name: artist)
    monkeypatch.setattr(browse_artist, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        browse_artist, "get_library_artist_by_entity_uid", lambda _uid: artist
    )
    monkeypatch.setattr(
        browse_artist,
        "resolve_artist_dir",
        lambda *_args, **_kwargs: artist_dir,
    )
    monkeypatch.setattr(
        browse_artist,
        "deliver_artwork",
        lambda asset, **kwargs: (
            delivered.append((asset, kwargs)) or SimpleNamespace(status_code=200)
        ),
    )

    browse_artist.api_artist_photo_by_id(SimpleNamespace(), 5, size=256)
    browse_artist.api_artist_photo_by_entity_uid(
        SimpleNamespace(), "artist-entity", size=256
    )

    assert [asset.entity_key for asset, _kwargs in delivered] == [
        "artist-entity",
        "artist-entity",
    ]
    assert all(asset.kind == "artist-photo" for asset, _kwargs in delivered)
    assert all(kwargs["local_original"] == photo for _asset, kwargs in delivered)
