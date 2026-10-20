from __future__ import annotations

from collections import Counter
from types import SimpleNamespace


def _write_file(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"test")


def test_quality_report_detects_album_issues_without_rescanning_albums(
    tmp_path, monkeypatch
):
    from crate import quality

    artist_dir = tmp_path / "Converge"
    lossy_dir = artist_dir / "Jane Doe (AAC)"
    lossless_dir = artist_dir / "Jane Doe (FLAC)"
    mixed_dir = artist_dir / "You Fail Me"

    lossy_track = lossy_dir / "01 - Concubine.m4a"
    lossless_track = lossless_dir / "01 - Concubine.flac"
    mixed_flac = mixed_dir / "01 - First.flac"
    mixed_mp3 = mixed_dir / "02 - Second.mp3"

    for path in [lossy_track, lossless_track, mixed_flac, mixed_mp3]:
        _write_file(path)

    directory_calls = Counter()
    audio_reads = Counter()
    tag_calls = Counter()
    real_iterdir = type(tmp_path).iterdir

    def count_directory(directory):
        directory_calls[str(directory)] += 1
        return real_iterdir(directory)

    def fake_read_tags(filepath):
        tag_calls[str(filepath.parent)] += 1
        if filepath.parent in {lossy_dir, lossless_dir}:
            return {"album": "Jane Doe"}
        return {"album": "You Fail Me"}

    def fake_mutagen_file(filepath):
        audio_reads[filepath] += 1
        bitrate = {
            lossy_track: 128000,
            lossless_track: 0,
            mixed_flac: 0,
            mixed_mp3: 256000,
        }[filepath]
        return SimpleNamespace(info=SimpleNamespace(length=180.0, bitrate=bitrate))

    monkeypatch.setattr(type(tmp_path), "iterdir", count_directory)
    monkeypatch.setattr(quality, "read_tags", fake_read_tags)
    monkeypatch.setattr(quality.mutagen, "File", fake_mutagen_file)

    report = quality.quality_report(tmp_path, {".flac", ".m4a", ".mp3"})

    assert report["coverage"] == "metadata_only"
    assert report["low_bitrate_count"] == 1
    assert report["mixed_format_count"] == 1
    assert report["lossy_with_lossless_count"] == 1
    assert report["lossy_with_lossless"][0]["lossy_album"] == "Jane Doe (AAC)"
    assert report["lossy_with_lossless"][0]["lossless_album"] == "Jane Doe (FLAC)"
    assert audio_reads == Counter(
        {path: 1 for path in [lossy_track, lossless_track, mixed_flac, mixed_mp3]}
    )
    assert directory_calls == Counter(
        {
            str(tmp_path): 1,
            str(artist_dir): 1,
            str(lossy_dir): 1,
            str(lossless_dir): 1,
            str(mixed_dir): 1,
        }
    )
    assert tag_calls == Counter(
        {
            str(lossy_dir): 1,
            str(lossless_dir): 1,
            str(mixed_dir): 1,
        }
    )


def test_quality_report_marks_unreadable_files_as_corrupt(tmp_path, monkeypatch):
    from crate import quality

    artist_dir = tmp_path / "Botch"
    album_dir = artist_dir / "We Are the Romans"
    broken_track = album_dir / "01 - To Our Friends In The Great White North.flac"
    _write_file(broken_track)

    monkeypatch.setattr(
        quality, "read_tags", lambda filepath: {"album": filepath.parent.name}
    )
    monkeypatch.setattr(quality.mutagen, "File", lambda filepath: None)

    report = quality.quality_report(tmp_path, {".flac"})

    assert report["corrupt_count"] == 1
    assert report["corrupt"][0]["artist"] == "Botch"
    assert report["corrupt"][0]["album"] == "We Are the Romans"
    assert report["corrupt"][0]["reason"] == "Cannot read file"


def test_m4a_alac_is_lossless_even_with_a_low_container_bitrate(tmp_path, monkeypatch):
    from crate import quality

    track = tmp_path / "Artist" / "Album" / "one.m4a"
    _write_file(track)
    monkeypatch.setattr(quality, "read_tags", lambda path: {"album": "Album"})
    monkeypatch.setattr(
        quality.mutagen,
        "File",
        lambda path: SimpleNamespace(
            info=SimpleNamespace(codec="alac", length=180.0, bitrate=128000)
        ),
    )
    report = quality.quality_report(tmp_path, {".m4a"})
    assert report["scanned_tracks"] == 1
    assert report["low_bitrate"] == []
    assert report["lossy_with_lossless"] == []
    assert report["audio_decode_verified"] is False
    assert report["method"] == "metadata_heuristics_v1"


def test_metadata_failure_and_suspicious_duration_are_not_confirmed_corruption(
    tmp_path, monkeypatch
):
    from crate import quality

    tracks = [tmp_path / "Artist" / "Album" / f"{n}.flac" for n in range(3)]
    for path in tracks:
        _write_file(path)

    def reader(path):
        if path == tracks[0]:
            return None
        if path == tracks[1]:
            return SimpleNamespace(info=SimpleNamespace(length=0.2))
        raise OSError("private path /music/secret and token=supersecret")

    monkeypatch.setattr(quality, "read_tags", lambda path: {"album": "Album"})
    monkeypatch.setattr(quality.mutagen, "File", reader)
    report = quality.quality_report(tmp_path, {".flac"})
    assert report["corrupt_count"] == 3
    assert all(item["confirmed_corruption"] is False for item in report["corrupt"])
    assert {item["evidence"] for item in report["corrupt"]} == {
        "metadata_unreadable",
        "duration_suspicious",
    }
    assert "supersecret" not in str(report)
    assert "/music/secret" not in str(report)


def test_quality_cancels_cooperatively_before_reading_more_files(tmp_path, monkeypatch):
    import pytest
    from crate import quality

    tracks = [tmp_path / "Artist" / "Album" / f"{n}.flac" for n in range(2)]
    for path in tracks:
        _write_file(path)
    reads = []

    def reader(path):
        reads.append(path)
        return SimpleNamespace(info=SimpleNamespace(length=180.0))

    monkeypatch.setattr(quality.mutagen, "File", reader)
    monkeypatch.setattr(quality, "read_tags", lambda path: {})
    with pytest.raises(quality.QualityScanCancelled):
        quality.quality_report(tmp_path, {".flac"}, cancelled=lambda: bool(reads))
    assert len(reads) == 1


def test_quality_scan_does_not_follow_artist_album_or_track_symlinks(
    tmp_path, monkeypatch
):
    from crate import quality

    root = tmp_path / "music"
    root.mkdir()
    outside = tmp_path / "outside"
    external_track = outside / "Artist" / "Album" / "private.flac"
    _write_file(external_track)
    local = root / "Local" / "Album" / "good.flac"
    _write_file(local)
    (root / "Unsafe Artist").symlink_to(
        external_track.parent.parent, target_is_directory=True
    )
    (root / "Local" / "Unsafe Album").symlink_to(
        external_track.parent, target_is_directory=True
    )
    (local.parent / "unsafe.flac").symlink_to(external_track)
    seen = []

    def reader(path):
        seen.append(path)
        return SimpleNamespace(info=SimpleNamespace(length=180.0))

    monkeypatch.setattr(quality.mutagen, "File", reader)
    monkeypatch.setattr(quality, "read_tags", lambda path: {})
    report = quality.quality_report(root, {".flac"})
    assert seen == [local]
    assert report["scanned_tracks"] == 1
    assert report["skipped_unsafe_paths"] == 3
    assert report["coverage"] == "partial"


def test_quality_normalized_album_match_remains_unverified_edition_evidence(
    tmp_path, monkeypatch
):
    from crate import quality

    for album, extension in [
        ("Album (1990 master)", ".mp3"),
        ("Album [2026 remaster]", ".flac"),
    ]:
        _write_file(tmp_path / "Artist" / album / f"one{extension}")
    monkeypatch.setattr(quality, "read_tags", lambda path: {"album": path.parent.name})
    monkeypatch.setattr(
        quality.mutagen,
        "File",
        lambda path: SimpleNamespace(
            info=SimpleNamespace(length=180.0, bitrate=320000)
        ),
    )
    report = quality.quality_report(tmp_path, {".flac", ".mp3"})
    assert report["lossy_with_lossless_count"] == 1
    evidence = report["lossy_with_lossless"][0]
    assert evidence["evidence"] == "normalized_album_name_heuristic"
    assert evidence["same_edition_verified"] is False


def test_bitrate_threshold_only_flags_measured_lossy_rates_below_192kbps(
    tmp_path, monkeypatch
):
    from crate import quality

    rates = {"low.mp3": 191999, "boundary.mp3": 192000, "unknown.mp3": 0}
    for name in rates:
        _write_file(tmp_path / "Artist" / "Album" / name)
    monkeypatch.setattr(quality, "read_tags", lambda path: {})
    monkeypatch.setattr(
        quality.mutagen,
        "File",
        lambda path: SimpleNamespace(
            info=SimpleNamespace(length=180.0, bitrate=rates[path.name])
        ),
    )
    report = quality.quality_report(tmp_path, {".mp3"})
    assert report["low_bitrate_count"] == 1
    assert report["low_bitrate"][0]["file"] == "low.mp3"
    assert report["low_bitrate"][0]["evidence"] == "bitrate_heuristic"


def test_quality_discovers_year_album_and_disc_layouts_without_omitting_or_repeating_tracks(
    tmp_path, monkeypatch
):
    from crate import quality

    relative_tracks = [
        "Artist/1999/Year Album/one.mp3",
        "Artist/1999/Year Album/CD 1/two.flac",
        "Artist/1999/Year Album/CD 2/three.mp3",
        "Artist/Direct Album/direct.mp3",
        "Artist/Direct Album/disc one/four.flac",
        "Artist/Direct Album/disc two/five.mp3",
    ]
    tracks = [tmp_path / relative for relative in relative_tracks]
    for track in tracks:
        _write_file(track)
    reads = Counter()

    def reader(path):
        reads[path] += 1
        return SimpleNamespace(info=SimpleNamespace(length=180.0, bitrate=128000))

    monkeypatch.setattr(quality.mutagen, "File", reader)
    monkeypatch.setattr(quality, "read_tags", lambda path: {"album": "Album"})
    report = quality.quality_report(tmp_path, {".flac", ".mp3"})
    assert reads == Counter({track: 1 for track in tracks})
    assert report["scanned_tracks"] == len(tracks)
    assert report["low_bitrate_count"] == 4
    assert report["coverage"] == "metadata_only"


def test_quality_nested_discovery_checks_cancellation_before_visiting_deep_tree(
    tmp_path, monkeypatch
):
    import pytest
    from crate import quality

    deepest = tmp_path / "Artist" / "2000" / "Album" / "CD" / "nested" / "more"
    deepest.mkdir(parents=True)
    visited = []
    real_iterdir = type(tmp_path).iterdir

    def visit(path):
        visited.append(path)
        return real_iterdir(path)

    checkpoints = [0]

    def cancelled():
        checkpoints[0] += 1
        return checkpoints[0] >= 4

    monkeypatch.setattr(type(tmp_path), "iterdir", visit)
    monkeypatch.setattr(
        quality.mutagen,
        "File",
        lambda path: pytest.fail("Cancelled discovery read audio"),
    )
    with pytest.raises(quality.QualityScanCancelled):
        quality.quality_report(tmp_path, {".flac"}, cancelled=cancelled)
    assert deepest not in visited


def test_quality_nested_discovery_never_follows_links_outside_the_library(
    tmp_path, monkeypatch
):
    from crate import quality

    root = tmp_path / "music"
    good = root / "Artist" / "1999" / "Album" / "CD 1" / "one.flac"
    private = tmp_path / "outside" / "private.flac"
    _write_file(good)
    _write_file(private)
    (good.parent.parent / "CD private").symlink_to(
        private.parent, target_is_directory=True
    )
    (good.parent / "linked.flac").symlink_to(private)
    reads = []

    def reader(path):
        reads.append(path)
        return SimpleNamespace(info=SimpleNamespace(length=180.0))

    monkeypatch.setattr(quality.mutagen, "File", reader)
    monkeypatch.setattr(quality, "read_tags", lambda path: {})
    report = quality.quality_report(root, {".flac"})
    assert reads == [good]
    assert report["scanned_tracks"] == 1
    assert report["skipped_unsafe_paths"] == 2
    assert report["coverage"] == "partial"


def test_quality_groups_multiple_discs_as_one_logical_album_with_unambiguous_evidence(
    tmp_path, monkeypatch
):
    from crate import quality

    for relative in ["CD1/one.flac", "CD2/one.mp3"]:
        _write_file(tmp_path / "Artist" / "2020" / "Album" / relative)
    monkeypatch.setattr(quality, "read_tags", lambda path: {"album": "Album"})
    monkeypatch.setattr(
        quality.mutagen,
        "File",
        lambda path: SimpleNamespace(
            info=SimpleNamespace(length=180.0, bitrate=128000)
        ),
    )
    report = quality.quality_report(tmp_path, {".flac", ".mp3"})
    assert report["mixed_format_count"] == 1
    mixed = report["mixed_format_albums"][0]
    assert mixed["album"] == "Album"
    assert mixed["track_count"] == 2
    assert mixed["formats"] == [".flac", ".mp3"]
    assert report["low_bitrate_count"] == 1
    assert report["low_bitrate"][0]["album"] == "Album"
    assert report["low_bitrate"][0]["file"] == "CD2/one.mp3"
    assert report["lossy_with_lossless"] == []


def test_quality_combines_base_audio_and_disc_subdirectories_without_false_editions(
    tmp_path, monkeypatch
):
    from crate import quality

    for relative in ["base.flac", "CD1/one.mp3", "CD2/two.flac"]:
        _write_file(tmp_path / "Artist" / "Album" / relative)
    monkeypatch.setattr(quality, "read_tags", lambda path: {"album": "Album"})
    monkeypatch.setattr(
        quality.mutagen,
        "File",
        lambda path: SimpleNamespace(
            info=SimpleNamespace(length=180.0, bitrate=128000)
        ),
    )
    report = quality.quality_report(tmp_path, {".flac", ".mp3"})
    assert report["scanned_tracks"] == 3
    assert report["mixed_format_count"] == 1
    assert report["mixed_format_albums"][0]["album"] == "Album"
    assert report["mixed_format_albums"][0]["track_count"] == 3
    assert report["low_bitrate"][0]["file"] == "CD1/one.mp3"
    assert report["lossy_with_lossless"] == []


def test_quality_compares_distinct_album_roots_across_years_using_relative_paths(
    tmp_path, monkeypatch
):
    from crate import quality

    for relative in ["2019/Album (AAC)/one.mp3", "2020/Album (FLAC)/one.flac"]:
        _write_file(tmp_path / "Artist" / relative)
    monkeypatch.setattr(quality, "read_tags", lambda path: {"album": "Album"})
    monkeypatch.setattr(
        quality.mutagen,
        "File",
        lambda path: SimpleNamespace(
            info=SimpleNamespace(length=180.0, bitrate=128000)
        ),
    )
    report = quality.quality_report(tmp_path, {".flac", ".mp3"})
    assert report["mixed_format_albums"] == []
    assert report["lossy_with_lossless_count"] == 1
    evidence = report["lossy_with_lossless"][0]
    assert evidence["lossy_album"] == "2019/Album (AAC)"
    assert evidence["lossless_album"] == "2020/Album (FLAC)"
    assert evidence["same_edition_verified"] is False
