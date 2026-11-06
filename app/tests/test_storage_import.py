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


def test_install_quarantines_any_file_already_at_the_destination(tmp_path):
    library, target = _managed_album(tmp_path)
    occupant = target / "existing.flac"
    occupant.write_bytes(b"unrelated")
    src = tmp_path / "new.flac"
    src.write_bytes(b"new")

    storage_import.install_managed_track(
        src, storage_import.ManagedTrackPlacement(dest=occupant), library_root=library
    )

    assert occupant.read_bytes() == b"new"
    trashed = library / ".crate-trash" / "tracks" / "artist-uid" / "album-uid"
    assert (trashed / "existing.flac").read_bytes() == b"unrelated"


def test_lossless_formats_outrank_lossy_ones():
    from crate.audio import audio_format_rank

    assert {audio_format_rank(fmt) for fmt in ("flac", ".ape", "wv", "dsf")} == {100}
    assert audio_format_rank("mp3") < audio_format_rank("m4a") < 100


def _write_flac(path, *, title, position, checksum, date="2026-11-06"):
    from mutagen.flac import FLAC

    path.parent.mkdir(parents=True, exist_ok=True)
    stream_info = (
        (4096).to_bytes(2, "big") * 2
        + bytes(6)
        + ((44100 << 44) | (1 << 41) | (15 << 36) | (44100 * 158)).to_bytes(8, "big")
        + checksum.to_bytes(16, "big")
    )
    path.write_bytes(b"fLaC\x80\x00\x00\x22" + stream_info)
    audio = FLAC(path)
    audio["title"] = title
    audio["tracknumber"] = str(position)
    audio["album"] = "Chosen Hell"
    audio["artist"] = "Comeback Kid"
    audio["date"] = date
    audio.save()


def test_album_import_reuses_identical_single_identity_at_its_album_position(tmp_path):
    from mutagen.flac import FLAC

    library, target = _managed_album(tmp_path)
    existing = target / "single-identity.flac"
    _write_flac(
        existing, title="Chosen Hell", position=1, checksum=42, date="2026-08-27"
    )
    staged = tmp_path / "staging"
    _write_flac(staged / "01.flac", title="Target On My Back", position=1, checksum=1)
    _write_flac(staged / "02.flac", title="Vindication", position=2, checksum=2)
    _write_flac(staged / "06.flac", title="Chosen Hell", position=6, checksum=42)

    moved = storage_import.move_album_tree(
        staged,
        target,
        managed_track_names=True,
        artist_name="Comeback Kid",
        album_name="Chosen Hell",
        library_root=library,
    )

    assert moved == 3
    assert len(list(target.glob("*.flac"))) == 3
    assert FLAC(existing)["tracknumber"] == ["6"]
    assert FLAC(existing)["date"] == ["2026-11-06"]
    old_copy = library / ".crate-trash/tracks/artist-uid/album-uid/single-identity.flac"
    assert FLAC(old_copy)["tracknumber"] == ["1"]


def test_album_import_does_not_merge_a_different_recording_with_the_same_title(
    tmp_path,
):
    library, target = _managed_album(tmp_path)
    existing = target / "single-identity.flac"
    _write_flac(existing, title="Chosen Hell", position=1, checksum=42)
    staged = tmp_path / "staging"
    _write_flac(staged / "01.flac", title="Target On My Back", position=1, checksum=1)
    _write_flac(staged / "02.flac", title="Vindication", position=2, checksum=2)
    _write_flac(staged / "06.flac", title="Chosen Hell", position=6, checksum=43)

    storage_import.move_album_tree(
        staged,
        target,
        managed_track_names=True,
        artist_name="Comeback Kid",
        album_name="Chosen Hell",
        library_root=library,
    )

    assert len(list(target.glob("*.flac"))) == 4
    assert existing.exists()
    assert not (library / ".crate-trash").exists()


def test_album_import_preserves_intentionally_repeated_identical_tracks(tmp_path):
    library, target = _managed_album(tmp_path)
    existing = target / "single-identity.flac"
    _write_flac(existing, title="Chosen Hell", position=1, checksum=42)
    staged = tmp_path / "staging"
    _write_flac(staged / "01.flac", title="Opening", position=1, checksum=1)
    _write_flac(staged / "02.flac", title="Chosen Hell", position=2, checksum=42)
    _write_flac(staged / "06.flac", title="Chosen Hell", position=6, checksum=42)

    storage_import.move_album_tree(
        staged,
        target,
        managed_track_names=True,
        artist_name="Comeback Kid",
        album_name="Chosen Hell",
        library_root=library,
    )

    assert len(list(target.glob("*.flac"))) == 4
    assert existing.exists()


def test_unreadable_flac_has_no_recording_identity(tmp_path):
    path = tmp_path / "corrupt.flac"
    path.write_bytes(b"not a valid FLAC")
    stat = path.stat()

    assert (
        storage_import._flac_audio_identity(str(path), stat.st_mtime_ns, stat.st_size)
        is None
    )


def test_missing_flac_checksum_does_not_merge_an_advance_single(tmp_path):
    library, target = _managed_album(tmp_path)
    existing = target / "single-identity.flac"
    _write_flac(existing, title="Chosen Hell", position=1, checksum=0)
    staged = tmp_path / "staging"
    _write_flac(staged / "01.flac", title="Target On My Back", position=1, checksum=1)
    _write_flac(staged / "02.flac", title="Vindication", position=2, checksum=2)
    _write_flac(staged / "06.flac", title="Chosen Hell", position=6, checksum=0)

    storage_import.move_album_tree(
        staged,
        target,
        managed_track_names=True,
        artist_name="Comeback Kid",
        album_name="Chosen Hell",
        library_root=library,
    )

    assert len(list(target.glob("*.flac"))) == 4
    assert existing.exists()
    assert not (library / ".crate-trash").exists()
