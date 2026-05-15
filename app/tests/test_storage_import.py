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
