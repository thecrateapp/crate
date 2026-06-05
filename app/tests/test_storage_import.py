import uuid

from crate import storage_import


def test_managed_track_destination_can_replace_existing_audio(tmp_path, monkeypatch):
    track_uid = uuid.UUID("00000000-0000-0000-0000-000000000123")
    src = tmp_path / "staged.flac"
    src.write_bytes(b"new")
    target = tmp_path / "album"
    target.mkdir()
    existing = target / f"{track_uid}.flac"
    existing.write_bytes(b"old")

    monkeypatch.setattr(storage_import, "read_tags", lambda _path: {})
    monkeypatch.setattr(storage_import, "track_entity_uid", lambda **_kwargs: track_uid)

    collision = storage_import.resolve_managed_track_destination(
        src,
        target,
        artist_name="Artist",
        album_name="Album",
        album_entity_uid="album-uid",
    )
    replacement = storage_import.resolve_managed_track_destination(
        src,
        target,
        artist_name="Artist",
        album_name="Album",
        album_entity_uid="album-uid",
        replace_existing_audio=True,
    )

    assert collision != existing
    assert replacement == existing


def test_import_target_uses_managed_layout_for_existing_entity_artist(
    tmp_path, monkeypatch
):
    artist_uid = "11111111-1111-4111-8111-111111111111"
    album_uid = uuid.UUID("22222222-2222-4222-8222-222222222222")

    monkeypatch.setattr(
        storage_import,
        "get_library_artist",
        lambda _name: {
            "name": "Sparta",
            "folder_name": "Sparta",
            "entity_uid": artist_uid,
        },
    )
    monkeypatch.setattr(storage_import, "get_library_album", lambda *_args: None)
    monkeypatch.setattr(storage_import, "album_entity_uid", lambda **_kwargs: album_uid)

    _artist, target, managed = storage_import.resolve_import_album_target(
        tmp_path,
        "Sparta",
        "Crater",
    )

    assert managed is True
    assert target == tmp_path / artist_uid / str(album_uid)
