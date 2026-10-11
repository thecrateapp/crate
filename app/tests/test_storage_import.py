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

    assert collision.dest != existing
    assert collision.replaces is None
    assert replacement.dest == existing


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


def _managed_album(tmp_path):
    library = tmp_path / "library"
    target = library / "artist-uid" / "album-uid"
    target.mkdir(parents=True)
    return library, target


def _fake_audio(monkeypatch, tags_by_name: dict, quality_by_name: dict):
    monkeypatch.setattr(
        storage_import, "read_tags", lambda path: dict(tags_by_name[path.name])
    )
    monkeypatch.setattr(
        storage_import,
        "read_audio_quality",
        lambda path: dict(quality_by_name[path.name]),
    )


def _resolve(src, target, **kwargs):
    return storage_import.resolve_managed_track_destination(
        src,
        target,
        artist_name="Peace Test",
        album_name="Repercussion",
        album_entity_uid=target.name,
        **kwargs,
    )


TERMINATE = {"title": "Terminate", "tracknumber": "2", "discnumber": "1"}


def test_redownload_of_same_quality_track_is_skipped(tmp_path, monkeypatch):
    _library, target = _managed_album(tmp_path)
    existing = target / "existing.flac"
    existing.write_bytes(b"old")
    src = tmp_path / "02 - Terminate.flac"
    src.write_bytes(b"new")
    quality = {"duration": 41.8, "bit_depth": 16, "sample_rate": 44100, "bitrate": 1}
    _fake_audio(
        monkeypatch,
        {existing.name: TERMINATE, src.name: TERMINATE},
        {existing.name: quality, src.name: quality},
    )

    assert _resolve(src, target) is None
    assert existing.read_bytes() == b"old"


def test_redownload_of_lower_quality_track_is_skipped(tmp_path, monkeypatch):
    _library, target = _managed_album(tmp_path)
    existing = target / "existing.flac"
    existing.write_bytes(b"hires")
    src = tmp_path / "theia.flac"
    src.write_bytes(b"cd")
    _fake_audio(
        monkeypatch,
        {existing.name: TERMINATE, src.name: TERMINATE},
        {
            existing.name: {"duration": 204.0, "bit_depth": 24, "sample_rate": 48000},
            src.name: {"duration": 204.0, "bit_depth": 16, "sample_rate": 44100},
        },
    )

    assert _resolve(src, target) is None


def test_better_copy_takes_over_existing_track_identity(tmp_path, monkeypatch):
    library, target = _managed_album(tmp_path)
    existing = target / "existing.mp3"
    existing.write_bytes(b"lossy")
    src = tmp_path / "terminate.flac"
    src.write_bytes(b"lossless")
    _fake_audio(
        monkeypatch,
        {existing.name: TERMINATE, src.name: TERMINATE},
        {
            existing.name: {"duration": 41.8, "bitrate": 320000},
            src.name: {"duration": 42.1, "bit_depth": 16, "sample_rate": 44100},
        },
    )

    placement = _resolve(src, target)

    assert placement == storage_import.ManagedTrackPlacement(
        dest=target / "existing.flac", replaces=existing
    )
    assert existing.exists()

    storage_import.install_managed_track(src, placement, library_root=library)

    assert (target / "existing.flac").read_bytes() == b"lossless"
    assert not existing.exists()
    trashed = library / ".crate-trash" / "tracks" / "artist-uid" / "album-uid"
    assert (trashed / "existing.mp3").read_bytes() == b"lossy"


def test_failed_install_restores_the_replaced_copy(tmp_path, monkeypatch):
    library, target = _managed_album(tmp_path)
    existing = target / "existing.flac"
    existing.write_bytes(b"old")
    src = tmp_path / "missing-source.flac"
    placement = storage_import.ManagedTrackPlacement(dest=existing, replaces=existing)

    try:
        storage_import.install_managed_track(src, placement, library_root=library)
    except OSError:
        pass
    else:
        raise AssertionError("install should fail for a missing source")

    assert existing.read_bytes() == b"old"
    assert not list((library / ".crate-trash").rglob("*.flac"))


def test_unknown_duration_never_drops_the_new_copy(tmp_path, monkeypatch):
    _library, target = _managed_album(tmp_path)
    existing = target / "existing.flac"
    existing.write_bytes(b"old")
    src = tmp_path / "unreadable.flac"
    src.write_bytes(b"new")
    _fake_audio(
        monkeypatch,
        {existing.name: TERMINATE, src.name: TERMINATE},
        {existing.name: {"duration": 41.8}, src.name: {"duration": None}},
    )

    placement = _resolve(src, target)

    assert placement is not None
    assert placement.replaces is None
    assert placement.dest != existing


def test_same_title_with_different_duration_is_not_treated_as_a_copy(
    tmp_path, monkeypatch
):
    _library, target = _managed_album(tmp_path)
    existing = target / "existing.flac"
    existing.write_bytes(b"album version")
    src = tmp_path / "terminate-live.flac"
    src.write_bytes(b"live version")
    _fake_audio(
        monkeypatch,
        {existing.name: TERMINATE, src.name: TERMINATE},
        {existing.name: {"duration": 41.8}, src.name: {"duration": 95.0}},
    )

    placement = _resolve(src, target)

    assert placement is not None
    assert placement.replaces is None
    assert placement.dest.parent == target
    assert placement.dest != existing


def test_move_album_tree_does_not_add_copies_on_redownload(tmp_path, monkeypatch):
    _library, target = _managed_album(tmp_path)
    existing = target / "existing.flac"
    existing.write_bytes(b"old")
    staged = tmp_path / "staging" / "Repercussion"
    staged.mkdir(parents=True)
    (staged / "02 - Terminate.flac").write_bytes(b"new")
    (staged / "cover.jpg").write_bytes(b"cover")
    quality = {"duration": 41.8, "bit_depth": 16, "sample_rate": 44100}
    _fake_audio(
        monkeypatch,
        {existing.name: TERMINATE, "02 - Terminate.flac": TERMINATE},
        {existing.name: quality, "02 - Terminate.flac": quality},
    )

    moved = storage_import.move_album_tree(
        staged,
        target,
        managed_track_names=True,
        artist_name="Peace Test",
        album_name="Repercussion",
    )

    assert moved == 1
    assert sorted(path.name for path in target.iterdir()) == [
        "cover.jpg",
        "existing.flac",
    ]
    assert not staged.exists()
