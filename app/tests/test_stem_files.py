"""The stem files the server keeps for Crate Decks (Smart Mix Stems, STEM-D6).

One MP4 per track with three AAC streams (drums, bass, vocals) on the music volume,
within an admin quota evicted by least recent use, served with Range support.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from sqlalchemy import text

from crate.db.repositories.smart_mix_playlists import set_smart_mix_playlist
from crate.db.tx import read_scope, transaction_scope
from crate.smart_mix import separation
from crate.smart_mix.stem_files import (
    enforce_stem_quota,
    stem_file_name,
    sweep_stem_directory,
    write_stem_file,
)
from crate.smart_mix.stem_storage import StemsVolumeError
from tests.test_smart_mix_playlists_repository import (
    _playlist,
    _profiled,
    _tracks,
    _user,
)

RATE = separation.SAMPLE_RATE
REVISION = "c" * 64


def _gain_graph(mix: np.ndarray, spec: np.ndarray):
    gains = np.array([1.0, 0.5, 0.25, 0.125], np.float32)
    wave = (mix[:, None] * gains[None, :, None, None]).astype(np.float32)
    spec_out = np.zeros(
        (1, 4, 4, separation.BINS, separation.SEGMENT_FRAMES), np.float32
    )
    return spec_out, wave


@pytest.fixture
def root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "smart-mix-stems"
    (directory / ".scratch").mkdir(parents=True)
    monkeypatch.setenv("CRATE_STEMS_DIR", str(directory))
    return directory


def _separated(tmp_path: Path, root: Path, seconds: float = 3.0):
    t = np.arange(int(seconds * RATE)) / RATE
    tone = 0.3 * np.sin(2 * np.pi * 220 * t)
    path = tmp_path / "tone.wav"
    sf.write(str(path), np.stack([tone, tone]).T, RATE, subtype="FLOAT")
    return separation.separate(
        path, threads=1, scratch=root / ".scratch", graph=_gain_graph
    )


def _probe(path: Path) -> list[dict]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name,channels,sample_rate,bit_rate:stream_tags=handler_name",
            "-of",
            "json",
            str(path),
        ],
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)["streams"]


def test_files_are_written_under_the_music_volume_only(
    tmp_path: Path, root: Path
) -> None:
    name = stem_file_name(1234, REVISION)
    assert name == f"d2/1234-{REVISION[:16]}.mp4"

    with _separated(tmp_path, root) as stems:
        size = write_stem_file(stems, root / name)

        for outside in (tmp_path / "elsewhere" / "x.mp4", root / ".scratch" / "x.mp4"):
            with pytest.raises(StemsVolumeError):
                write_stem_file(stems, outside)
            assert not outside.exists()
        # Only the stems are in scratch: the MP4 was moved, not copied.
        assert sorted(p.name for p in stems.directory.iterdir()) == sorted(
            f"{stem}.f32" for stem in separation.SOURCES
        )

    out = root / name
    assert out.stat().st_size == size > 0
    streams = _probe(out)
    assert [stream["tags"]["handler_name"] for stream in streams] == [
        "drums",
        "bass",
        "vocals",
    ]
    assert {stream["codec_name"] for stream in streams} == {"aac"}
    assert {(stream["channels"], stream["sample_rate"]) for stream in streams} == {
        (2, "44100")
    }
    assert not (tmp_path / "elsewhere").exists()


def test_writing_needs_the_stems_directory(
    tmp_path: Path, root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with _separated(tmp_path, root) as stems:
        monkeypatch.delenv("CRATE_STEMS_DIR")
        with pytest.raises(StemsVolumeError):
            write_stem_file(stems, root / "aa" / "1.mp4")


def _stem_file(root: Path, track_id: int, size: int, *, used_hours_ago: float) -> str:
    name = stem_file_name(track_id, REVISION)
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\0" * size)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_stem_files (
                    track_id, path, bytes, separator_model, separator_version,
                    source_revision, last_used_at
                ) VALUES (
                    :track_id, :path, :bytes, 'htdemucs', 'htdemucs-onnx-1', :rev,
                    NOW() - make_interval(secs => :seconds)
                )
                """
            ),
            {
                "track_id": track_id,
                "path": name,
                "bytes": size,
                "rev": REVISION,
                "seconds": used_hours_ago * 3600,
            },
        )
    return name


def _kept() -> set[int]:
    with read_scope() as session:
        return set(
            session.execute(text("SELECT track_id FROM track_stem_files")).scalars()
        )


def _use_playlist(playlist_id: int, hours_ago: float) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE smart_mix_playlists SET last_used_at = NOW() - "
                "make_interval(secs => :seconds) WHERE playlist_id = :id"
            ),
            {"seconds": hours_ago * 3600, "id": playlist_id},
        )


def test_quota_evicts_least_recently_used_files_of_disabled_playlists_first(
    pg_db, root: Path
) -> None:
    del pg_db
    held, recent, older, loose = _tracks("stem-quota", 4)
    owner = _user("stem-quota-owner")
    on = _playlist(owner, [held], name="On")
    off = _playlist(owner, [recent, older], name="Off")
    set_smart_mix_playlist(on, user_id=owner, enabled=True)
    set_smart_mix_playlist(off, user_id=owner, enabled=True)
    set_smart_mix_playlist(off, user_id=owner, enabled=False)
    _use_playlist(on, hours_ago=500)
    _use_playlist(off, hours_ago=400)
    # The file of the playlist that is on is the least recently used of all.
    names = {
        held: _stem_file(root, held, 100, used_hours_ago=1000),
        recent: _stem_file(root, recent, 100, used_hours_ago=1),
        older: _stem_file(root, older, 100, used_hours_ago=900),
        loose: _stem_file(root, loose, 100, used_hours_ago=600),
    }

    assert enforce_stem_quota(400) == 0
    assert _kept() == {held, recent, older, loose}

    # Files of tracks in no Smart Mix playlist that is on go first, by last use
    # (the playlist's or the file's, whichever is later); then the rest.
    assert enforce_stem_quota(250) == 200
    assert _kept() == {held, recent}
    assert enforce_stem_quota(100) == 100
    assert _kept() == {held}
    for track_id, name in names.items():
        assert (root / name).exists() == (track_id == held)

    assert enforce_stem_quota(0) == 100
    assert _kept() == set()


def test_sweeping_removes_orphans_and_stale_scratch(pg_db, root: Path) -> None:
    del pg_db
    (kept,) = _tracks("stem-sweep", 1)
    kept_name = _stem_file(root, kept, 10, used_hours_ago=0)
    orphan = root / "ff" / "999999-orphan.mp4"
    orphan.parent.mkdir(parents=True)
    orphan.write_bytes(b"x")
    fresh_orphan = root / "ff" / "999998-fresh.mp4"
    fresh_orphan.write_bytes(b"x")
    stale = root / ".scratch" / "separate-stale"
    stale.mkdir()
    (stale / "drums.f32").write_bytes(b"x")
    running = root / ".scratch" / "separate-running"
    running.mkdir()
    old = time.time() - 4 * 3600
    for path in (orphan, stale / "drums.f32", stale):
        os.utime(path, (old, old))

    removed = sweep_stem_directory(root, min_age_seconds=3600)

    assert removed == 2
    assert not orphan.exists() and not stale.exists()
    assert fresh_orphan.exists() and running.exists()
    assert (root / kept_name).exists()


def _downloadable(root: Path, name: str, owner: int) -> tuple[int, str, bytes]:
    (track,) = _tracks(name, 1)
    _profiled(track, REVISION)
    content = bytes(range(256)) * 4
    stem_name = stem_file_name(track, REVISION)
    (root / stem_name).parent.mkdir(parents=True, exist_ok=True)
    (root / stem_name).write_bytes(content)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_stem_files (
                    track_id, path, bytes, separator_model, separator_version,
                    source_revision, last_used_at
                ) VALUES (
                    :track_id, :path, :bytes, 'htdemucs', 'htdemucs-onnx-1', :rev,
                    NOW() - INTERVAL '1 day'
                )
                """
            ),
            {
                "track_id": track,
                "path": stem_name,
                "bytes": len(content),
                "rev": REVISION,
            },
        )
        uid = session.execute(
            text("SELECT entity_uid::text FROM library_tracks WHERE id = :id"),
            {"id": track},
        ).scalar_one()
    playlist_id = _playlist(owner, [track], name=f"{name} set")
    set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True)
    _use_playlist(playlist_id, hours_ago=48)
    return track, str(uid), content


def _last_used(track: int) -> tuple:
    with read_scope() as session:
        return tuple(
            session.execute(
                text(
                    """
                    SELECT f.last_used_at > NOW() - INTERVAL '1 minute',
                           smp.last_used_at > NOW() - INTERVAL '1 minute'
                    FROM track_stem_files f
                    JOIN playlist_tracks pt ON pt.track_id = f.track_id
                    JOIN smart_mix_playlists smp ON smp.playlist_id = pt.playlist_id
                    WHERE f.track_id = :track
                    """
                ),
                {"track": track},
            ).one()
        )


def test_range_download(pg_db, test_app, root: Path) -> None:
    del pg_db
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO users (id, email, username, created_at) "
                "VALUES (1, 'test@test.com', 'testadmin', now()) "
                "ON CONFLICT (id) DO NOTHING"
            )
        )
    track, uid, content = _downloadable(root, "stem-download", owner=1)
    url = f"/api/decks/tracks/{uid}/stems"

    partial = test_app.get(url, headers={"Range": "bytes=10-19"})
    assert partial.status_code == 206
    assert partial.content == content[10:20]
    assert partial.headers["content-range"] == f"bytes 10-19/{len(content)}"
    assert partial.headers["content-type"] == "audio/mp4"

    whole = test_app.get(url)
    assert whole.status_code == 200
    assert whole.content == content
    assert whole.headers["accept-ranges"] == "bytes"
    # A download is a real use of the file and of the owner's Smart Mix playlist.
    assert _last_used(track) == (True, True)


def _file_revision(track: int, revision: str) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE track_stem_files SET source_revision = :rev "
                "WHERE track_id = :track"
            ),
            {"rev": revision, "track": track},
        )


def test_no_download_of_another_file_or_without_storage(
    pg_db, test_app, root: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    del pg_db
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO users (id, email, username, created_at) "
                "VALUES (1, 'test@test.com', 'testadmin', now()) "
                "ON CONFLICT (id) DO NOTHING"
            )
        )
    track, uid, _content = _downloadable(root, "stem-download-stale", owner=1)
    url = f"/api/decks/tracks/{uid}/stems"
    assert test_app.get(url).status_code == 200

    # A file of another revision describes another audio.
    _file_revision(track, "d" * 64)
    assert test_app.get(url).status_code == 404
    _file_revision(track, REVISION)
    assert test_app.get(url).status_code == 200

    monkeypatch.delenv("CRATE_STEMS_DIR")
    assert test_app.get(url).status_code == 404
    missing = "00000000-0000-4000-8000-000000000000"
    assert test_app.get(f"/api/decks/tracks/{missing}/stems").status_code == 404


def test_admins_set_the_stem_quota(pg_db, test_app) -> None:
    del pg_db
    from crate.api.settings import _get_smart_mix_settings

    assert _get_smart_mix_settings()["stem_quota_gib"] == 50
    response = test_app.put("/api/settings/smart-mix", json={"stem_quota_gib": 120})
    assert response.status_code == 200
    assert test_app.get("/api/settings").json()["smart_mix"]["stem_quota_gib"] == 120
    # Omitting it keeps it; 0 keeps no stem files.
    test_app.put("/api/settings/smart-mix", json={"stem_uploads_enabled": True})
    assert _get_smart_mix_settings()["stem_quota_gib"] == 120
    test_app.put("/api/settings/smart-mix", json={"stem_quota_gib": 0})
    assert _get_smart_mix_settings()["stem_quota_gib"] == 0

    for invalid in ({"stem_quota_gib": -1}, {"stem_quota_gib": None}):
        assert (
            test_app.put("/api/settings/smart-mix", json=invalid).status_code == 422
        ), invalid
