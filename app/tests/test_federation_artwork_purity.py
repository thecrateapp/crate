from __future__ import annotations

from types import SimpleNamespace


def test_federated_album_artwork_uses_persistent_delivery(monkeypatch, tmp_path):
    from crate.api import federation

    cover = tmp_path / "cover.jpg"
    cover.write_bytes(b"cover")
    delivered = []
    monkeypatch.setattr(
        "crate.db.repositories.library.get_library_album_by_entity_uid",
        lambda _uid: {"entity_uid": "album-entity", "path": str(tmp_path)},
    )
    monkeypatch.setattr(
        "crate.api.artwork_delivery.deliver_artwork",
        lambda asset, **kwargs: (
            delivered.append((asset, kwargs)) or SimpleNamespace(status_code=200)
        ),
    )

    response = federation._serve_federated_album_asset(
        "album-entity",
        size=384,
        image_format="webp",
        not_found_detail="missing",
    )

    assert response.status_code == 200
    assert delivered[0][0].kind == "album-cover"
    assert delivered[0][0].entity_key == "album-entity"
    assert delivered[0][1]["local_original"] == cover


def test_federated_artist_artwork_uses_persistent_delivery(monkeypatch, tmp_path):
    from crate.api import federation

    photo = tmp_path / "artist.jpg"
    photo.write_bytes(b"photo")
    delivered = []
    monkeypatch.setattr("crate.api._deps.library_path", lambda: tmp_path)
    monkeypatch.setattr(
        "crate.db.repositories.library.get_library_artist_by_entity_uid",
        lambda _uid: {"entity_uid": "artist-entity", "name": "Artist"},
    )
    monkeypatch.setattr(
        "crate.storage_layout.resolve_artist_dir",
        lambda *_args, **_kwargs: tmp_path,
    )
    monkeypatch.setattr(
        "crate.api.artwork_delivery.deliver_artwork",
        lambda asset, **kwargs: (
            delivered.append((asset, kwargs)) or SimpleNamespace(status_code=200)
        ),
    )

    response = federation._federated_artist_sidecar_image(
        "artist-entity",
        candidate_names=("artist.jpg",),
        artwork_kind="artist-photo",
        size=256,
        image_format="webp",
        not_found_detail="missing",
    )

    assert response.status_code == 200
    assert delivered[0][0].kind == "artist-photo"
    assert delivered[0][1]["local_original"] == photo


def test_global_local_artist_artwork_uses_persistent_delivery(monkeypatch, tmp_path):
    from crate.federation import global_artwork

    photo = tmp_path / "artist.jpg"
    photo.write_bytes(b"photo")
    delivered = []
    monkeypatch.setattr("crate.api._deps.library_path", lambda: tmp_path)
    monkeypatch.setattr(
        "crate.db.repositories.library.get_library_artist_by_entity_uid",
        lambda _uid: {"entity_uid": "artist-entity", "name": "Artist"},
    )
    monkeypatch.setattr(
        "crate.storage_layout.resolve_artist_dir",
        lambda *_args, **_kwargs: tmp_path,
    )
    monkeypatch.setattr(
        "crate.api.artwork_delivery.deliver_artwork",
        lambda asset, **kwargs: (
            delivered.append((asset, kwargs)) or SimpleNamespace(status_code=200)
        ),
    )

    response = global_artwork._serve_local_artist_photo(
        "artist-entity", size=256, image_format="webp"
    )

    assert response.status_code == 200
    assert delivered[0][0].kind == "artist-photo"
