"""Portable metadata never follows untrusted paths or overwrites an export."""

import copy
import hashlib
import json
import os
from pathlib import Path
from unittest.mock import Mock

import pytest
from crate import portable_metadata as portable


@pytest.fixture
def album_payload(tmp_path):
    album = tmp_path / "music" / "Artist" / "Album"
    album.mkdir(parents=True)
    track = album / "01.flac"
    track.write_bytes(b"original audio")
    (album / "cover.jpg").write_bytes(b"original artwork")
    return {
        "schema_version": 1,
        "artist": {
            "name": "Artist",
            "entity_uid": "10000000-0000-0000-0000-000000000001",
        },
        "album": {
            "id": 10,
            "name": "Album",
            "artist": "Artist",
            "path": str(album),
            "entity_uid": "20000000-0000-0000-0000-000000000001",
            "artwork_files": ["cover.jpg"],
        },
        "tracks": [
            {
                "filename": track.name,
                "relative_path": track.name,
                "path": str(track),
                "entity_uid": "30000000-0000-0000-0000-000000000001",
                "lyrics": {"plain": "lyrics"},
                "analysis": {"bpm": 120.0},
            }
        ],
    }


def _raw_sidecar(album_payload, *, value=None):
    path = Path(album_payload["album"]["path"]) / ".crate" / "album.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value if value is not None else album_payload))
    return path


@pytest.mark.parametrize("field", ["relative_path", "filename"])
@pytest.mark.parametrize(
    "path",
    [
        "../escape.flac",
        "/tmp/escape.flac",
        "disc/../../escape.flac",
        "..\\escape.flac",
        "\x00bad",
    ],
)
def test_load_rejects_absolute_traversal_and_platform_ambiguous_track_paths(
    album_payload, field, path
):
    track = album_payload["tracks"][0]
    track.pop("relative_path", None)
    track.pop("filename", None)
    track[field] = path
    sidecar = _raw_sidecar(album_payload)
    with pytest.raises(ValueError):
        portable.load_album_sidecar(sidecar)


@pytest.mark.parametrize("field", ["relative_path", "filename"])
@pytest.mark.parametrize(
    "path",
    ["../escape.flac", "/tmp/escape.flac", "disc/../../escape.flac", "..\\escape.flac"],
)
def test_export_rejects_untrusted_track_path_before_creating_destination(
    tmp_path, album_payload, field, path
):
    track = album_payload["tracks"][0]
    track.pop("relative_path", None)
    track.pop("filename", None)
    track[field] = path
    destination = tmp_path / "export"
    with pytest.raises(ValueError):
        portable.export_album_rich_metadata(
            album_payload, export_root=destination, include_audio=False
        )
    assert not destination.exists()


def test_export_rejects_audio_source_outside_the_album_even_with_safe_relative_path(
    tmp_path, album_payload
):
    outside = tmp_path / "private.flac"
    outside.write_bytes(b"private")
    album_payload["tracks"][0]["path"] = str(outside)
    destination = tmp_path / "export"
    with pytest.raises(ValueError):
        portable.export_album_rich_metadata(album_payload, export_root=destination)
    assert not destination.exists()
    assert outside.read_bytes() == b"private"


@pytest.mark.parametrize(
    "link_kind", ["sidecar_directory", "sidecar_file", "track", "track_directory"]
)
def test_load_rejects_symlinked_sidecar_and_track_components(
    tmp_path, album_payload, link_kind
):
    album = Path(album_payload["album"]["path"])
    outside = tmp_path / "outside"
    outside.mkdir()
    if link_kind == "sidecar_directory":
        external_sidecar = outside / "album.json"
        external_sidecar.write_text(json.dumps(album_payload))
        (album / ".crate").symlink_to(outside, target_is_directory=True)
        sidecar = album / ".crate" / "album.json"
    elif link_kind == "sidecar_file":
        external_sidecar = outside / "album.json"
        external_sidecar.write_text(json.dumps(album_payload))
        sidecar = album / ".crate" / "album.json"
        sidecar.parent.mkdir()
        sidecar.symlink_to(external_sidecar)
    else:
        external_track = outside / "private.flac"
        external_track.write_bytes(b"private")
        if link_kind == "track":
            track = album / "01.flac"
            track.unlink()
            track.symlink_to(external_track)
        else:
            (album / "disc").symlink_to(outside, target_is_directory=True)
            album_payload["tracks"][0]["relative_path"] = "disc/private.flac"
        sidecar = _raw_sidecar(album_payload)
    with pytest.raises(ValueError):
        portable.load_album_sidecar(sidecar)


@pytest.mark.parametrize(
    "link_kind", ["album", "sidecar_directory", "sidecar_file", "track"]
)
def test_sidecar_write_rejects_symlinks_without_modifying_external_files(
    tmp_path, album_payload, link_kind
):
    album = Path(album_payload["album"]["path"])
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / "album.json"
    sentinel.write_bytes(b"private original")
    if link_kind == "album":
        alias = tmp_path / "album-alias"
        alias.symlink_to(album, target_is_directory=True)
        album_payload["album"]["path"] = str(alias)
    elif link_kind == "sidecar_directory":
        (album / ".crate").symlink_to(outside, target_is_directory=True)
    elif link_kind == "sidecar_file":
        (album / ".crate").mkdir()
        (album / ".crate" / "album.json").symlink_to(sentinel)
    else:
        track = album / "01.flac"
        track.unlink()
        track.symlink_to(sentinel)
    with pytest.raises(ValueError):
        portable.write_album_portable_metadata(album_payload, write_audio_tags=False)
    assert sentinel.read_bytes() == b"private original"


@pytest.mark.parametrize(
    "artwork", ["../private.jpg", "/tmp/private.jpg", "..\\private.jpg"]
)
def test_export_rejects_untrusted_artwork_names_before_creating_destination(
    tmp_path, album_payload, artwork
):
    album_payload["album"]["artwork_files"] = [artwork]
    destination = tmp_path / "export"
    with pytest.raises(ValueError):
        portable.export_album_rich_metadata(
            album_payload, export_root=destination, include_audio=False
        )
    assert not destination.exists()


def test_export_rejects_symlinked_artwork_before_creating_destination(
    tmp_path, album_payload
):
    album = Path(album_payload["album"]["path"])
    (album / "cover.jpg").unlink()
    private = tmp_path / "private.jpg"
    private.write_bytes(b"private image")
    (album / "cover.jpg").symlink_to(private)
    destination = tmp_path / "export"
    with pytest.raises(ValueError):
        portable.export_album_rich_metadata(
            album_payload, export_root=destination, include_audio=False
        )
    assert not destination.exists()
    assert private.read_bytes() == b"private image"


@pytest.mark.parametrize("component", ["root", "artist", "album"])
def test_export_rejects_symlinked_destination_components(
    tmp_path, album_payload, component
):
    outside = tmp_path / "outside"
    outside.mkdir()
    destination = tmp_path / "export"
    if component == "root":
        destination.symlink_to(outside, target_is_directory=True)
    elif component == "artist":
        destination.mkdir()
        (destination / "Artist").symlink_to(outside, target_is_directory=True)
    else:
        (destination / "Artist").mkdir(parents=True)
        (destination / "Artist" / "Album").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        portable.export_album_rich_metadata(
            album_payload, export_root=destination, include_audio=False
        )
    assert list(outside.iterdir()) == []


def test_existing_export_is_preserved_instead_of_merged_or_overwritten(
    tmp_path, album_payload
):
    destination = tmp_path / "export"
    target = destination / "Artist" / "Album"
    target.mkdir(parents=True)
    sentinel = target / "cover.jpg"
    sentinel.write_bytes(b"existing image")
    with pytest.raises((ValueError, FileExistsError)):
        portable.export_album_rich_metadata(
            album_payload, export_root=destination, include_audio=False
        )
    assert sentinel.read_bytes() == b"existing image"
    assert sorted(path.name for path in target.iterdir()) == ["cover.jpg"]


def test_metadata_only_export_copies_artwork_and_sidecar_without_reading_or_tagging_audio(
    tmp_path, album_payload, monkeypatch
):
    tagger = Mock(side_effect=AssertionError("Metadata-only export must not tag audio"))
    monkeypatch.setattr(portable, "write_track_rich_tags", tagger)
    source = Path(album_payload["tracks"][0]["path"])
    original = source.read_bytes()
    payload_before = copy.deepcopy(album_payload)
    result = portable.export_album_rich_metadata(
        album_payload, export_root=tmp_path / "export", include_audio=False
    )
    target = Path(result["export_path"])
    assert result["tracks"] == 1
    assert result["artwork_files"] == 1
    assert result["tag_errors"] == []
    assert not (target / "01.flac").exists()
    assert (target / "cover.jpg").read_bytes() == b"original artwork"
    sidecar = portable.load_album_sidecar(result["sidecar_path"])
    assert sidecar["tracks"][0]["path"] == str(target / "01.flac")
    assert sidecar["tracks"][0]["lyrics"]["plain"] == "lyrics"
    assert sidecar["tracks"][0]["analysis"]["bpm"] == 120.0
    assert album_payload == payload_before
    assert source.read_bytes() == original
    tagger.assert_not_called()


def test_sidecar_load_rebases_legacy_absolute_audio_paths_to_current_album(
    album_payload,
):
    track = album_payload["tracks"][0]
    track.pop("relative_path")
    track.pop("filename")
    track["path"] = "/old/library/Album/01.flac"
    sidecar = _raw_sidecar(album_payload)
    result = portable.load_album_sidecar(sidecar)
    assert result["tracks"][0]["path"] == str(sidecar.parent.parent / "01.flac")
    assert result["tracks"][0]["relative_path"] == "01.flac"
    assert result["_sidecar_sha256"] == hashlib.sha256(sidecar.read_bytes()).hexdigest()


@pytest.mark.parametrize("version", [None, 0, 2, "1", True])
def test_unsupported_or_ambiguous_sidecar_schema_is_rejected(album_payload, version):
    album_payload["schema_version"] = version
    sidecar = _raw_sidecar(album_payload)
    with pytest.raises(ValueError):
        portable.load_album_sidecar(sidecar)


@pytest.mark.parametrize(
    "change",
    [
        {"tracks": None},
        {"tracks": {}},
        {"tracks": [None]},
        {"tracks": ["track"]},
        {"album": []},
        {"artist": []},
    ],
)
def test_invalid_sidecar_shapes_are_rejected(album_payload, change):
    changed_payload = {**album_payload, **change}
    sidecar = _raw_sidecar(album_payload, value=changed_payload)
    with pytest.raises(ValueError):
        portable.load_album_sidecar(sidecar)


def test_sidecar_size_limit_is_enforced_on_read_and_write(album_payload, monkeypatch):
    sidecar = _raw_sidecar(album_payload)
    original = sidecar.read_bytes()
    monkeypatch.setattr(portable, "MAX_SIDECAR_BYTES", 20)
    with pytest.raises(ValueError, match="size limit"):
        portable.load_album_sidecar(sidecar)
    with pytest.raises(ValueError, match="size limit"):
        portable.write_album_sidecar(album_payload)
    assert sidecar.read_bytes() == original
    assert list(sidecar.parent.glob("*.tmp")) == []


def test_sidecar_track_limit_is_enforced_on_read_and_write(album_payload, monkeypatch):
    monkeypatch.setattr(portable, "MAX_SIDECAR_TRACKS", 1)
    album_payload["tracks"].append(copy.deepcopy(album_payload["tracks"][0]))
    sidecar = _raw_sidecar(album_payload)
    with pytest.raises(ValueError, match="track list"):
        portable.load_album_sidecar(sidecar)
    with pytest.raises(ValueError, match="track list"):
        portable.write_album_sidecar(album_payload)


@pytest.mark.parametrize("number", [float("nan"), float("inf"), float("-inf")])
def test_nonfinite_analysis_values_are_rejected_on_read_and_write(
    album_payload, number
):
    album_payload["tracks"][0]["analysis"]["bpm"] = number
    sidecar = _raw_sidecar(album_payload)
    with pytest.raises(ValueError):
        portable.load_album_sidecar(sidecar)
    with pytest.raises(ValueError):
        portable.write_album_sidecar(album_payload)


def test_sidecar_enumeration_stops_before_traversing_beyond_the_requested_limit(
    tmp_path, album_payload, monkeypatch
):
    sidecar = _raw_sidecar(album_payload)

    def bounded_walk(self, pattern):
        yield sidecar
        raise AssertionError("Enumeration continued after requested limit")

    monkeypatch.setattr(Path, "rglob", bounded_walk)
    assert portable.iter_album_sidecars(tmp_path, limit=1) == [sidecar]


def test_sidecar_enumeration_rejects_linked_sidecar_paths(
    tmp_path, album_payload, monkeypatch
):
    album = Path(album_payload["album"]["path"])
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "album.json").write_text(json.dumps(album_payload))
    (album / ".crate").symlink_to(outside, target_is_directory=True)
    sidecar = album / ".crate" / "album.json"
    monkeypatch.setattr(Path, "rglob", lambda self, pattern: iter([sidecar]))
    with pytest.raises(ValueError):
        portable.iter_album_sidecars(tmp_path)


@pytest.mark.parametrize("operation", ["identity", "rich"])
def test_tag_writers_refuse_symlink_audio_before_any_mutagen_write(
    tmp_path, monkeypatch, operation
):
    original = tmp_path / "private.flac"
    original.write_bytes(b"private original audio")
    link = tmp_path / "link.flac"
    link.symlink_to(original)
    tagger = Mock(side_effect=AssertionError("Symlink reached tag writer"))
    monkeypatch.setattr(portable, "_write_tags_for_path", tagger)
    with pytest.raises(ValueError):
        if operation == "identity":
            portable.write_track_identity_tags(
                link, artist_uid="a", album_uid="b", track_uid="c"
            )
        else:
            portable.write_track_rich_tags(
                link, artist_uid="a", album_uid="b", track_payload={"entity_uid": "c"}
            )
    assert original.read_bytes() == b"private original audio"
    tagger.assert_not_called()


def test_named_artwork_lookup_refuses_symlink_and_path_escape(tmp_path, album_payload):
    album = Path(album_payload["album"]["path"])
    private = tmp_path / "private.jpg"
    private.write_bytes(b"private image")
    (album / "linked.jpg").symlink_to(private)
    for name in ["linked.jpg", "../private.jpg", str(private)]:
        with pytest.raises(ValueError):
            portable.find_album_artwork_file(album, [name])


def test_fifo_sidecar_is_opened_without_blocking_and_rejected_as_nonregular_file(
    album_payload, monkeypatch
):
    album = Path(album_payload["album"]["path"])
    sidecar = album / ".crate" / "album.json"
    sidecar.parent.mkdir()
    os.mkfifo(sidecar)
    real_open = os.open

    def nonblocking_open(path, flags):
        assert flags & os.O_NONBLOCK, "FIFO must never be opened in blocking mode"
        return real_open(path, flags)

    monkeypatch.setattr(portable.os, "open", nonblocking_open)
    with pytest.raises(ValueError, match="not a regular file"):
        portable.load_album_sidecar(sidecar)


@pytest.mark.parametrize("source_path", [None, ""])
def test_export_requires_source_album_path_before_creating_any_directory(
    tmp_path, album_payload, source_path
):
    album_payload["album"]["path"] = source_path
    destination = tmp_path / "export"
    with pytest.raises(ValueError):
        portable.export_album_rich_metadata(
            album_payload, export_root=destination, include_audio=False
        )
    assert not destination.exists()


@pytest.mark.parametrize(
    "operation",
    ["sidecar_write", "portable_write", "export_source", "export_root", "sidecar_load"],
)
def test_intermediate_symlink_ancestors_are_rejected_without_modifying_external_album(
    tmp_path, album_payload, operation
):
    outside = tmp_path / "outside"
    external_album = outside / "Album"
    external_album.mkdir(parents=True)
    external_track = external_album / "01.flac"
    external_track.write_bytes(b"outside original audio")
    (external_album / "cover.jpg").write_bytes(b"outside original image")
    external_sidecar = external_album / ".crate" / "album.json"
    external_sidecar.parent.mkdir()
    external_sidecar.write_text(json.dumps(album_payload))
    music = tmp_path / "library"
    music.mkdir()
    linked_artist = music / "linked-artist"
    linked_artist.symlink_to(outside, target_is_directory=True)
    linked_album = linked_artist / "Album"
    payload = copy.deepcopy(album_payload)
    if operation != "export_root":
        payload["album"]["path"] = str(linked_album)
        payload["tracks"][0]["path"] = str(linked_album / "01.flac")
    before = {
        path.relative_to(outside): path.read_bytes()
        for path in outside.rglob("*")
        if path.is_file()
    }
    with pytest.raises(ValueError):
        if operation == "sidecar_write":
            portable.write_album_sidecar(payload)
        elif operation == "portable_write":
            portable.write_album_portable_metadata(payload, write_audio_tags=False)
        elif operation == "export_source":
            portable.export_album_rich_metadata(
                payload, export_root=tmp_path / "export", include_audio=False
            )
        elif operation == "export_root":
            portable.export_album_rich_metadata(
                payload, export_root=linked_artist / "exports", include_audio=False
            )
        else:
            portable.load_album_sidecar(linked_album / ".crate" / "album.json")
    after = {
        path.relative_to(outside): path.read_bytes()
        for path in outside.rglob("*")
        if path.is_file()
    }
    assert after == before
    assert not (tmp_path / "export").exists()
    assert not (outside / "exports").exists()
