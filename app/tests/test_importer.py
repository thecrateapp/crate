from crate import importer


def test_import_queue_preserves_metadata_when_target_is_managed(tmp_path, monkeypatch):
    source = tmp_path / "staged" / "Album"
    source.mkdir(parents=True)
    track = source / "01 Track.flac"
    track.write_bytes(b"audio")
    cover = source / "cover.jpg"
    cover.write_bytes(b"cover")

    target = (
        tmp_path
        / "library"
        / "11111111-1111-4111-8111-111111111111"
        / "22222222-2222-4222-8222-222222222222"
    )

    monkeypatch.setattr(importer, "get_audio_files", lambda *_args: [track])
    monkeypatch.setattr(
        importer,
        "read_tags",
        lambda _path: {
            "albumartist": "Sparta",
            "album": "Crater",
        },
    )
    monkeypatch.setattr(
        importer,
        "resolve_import_album_target",
        lambda *_args: ({}, target, True),
    )
    monkeypatch.setattr(
        importer,
        "resolve_managed_track_destination",
        lambda *_args, **_kwargs: target / "track.flac",
    )

    queue = importer.ImportQueue({"library_path": str(tmp_path / "library")})
    result = queue.import_item(str(source))

    assert result["artist"] == "Sparta"
    assert result["album"] == "Crater"
    assert result["dest"] == str(target)
    assert (target / "track.flac").read_bytes() == b"audio"
    assert (target / "cover.jpg").read_bytes() == b"cover"
