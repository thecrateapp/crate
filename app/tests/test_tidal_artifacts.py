import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from crate import tidal
from crate.m4a_fix import repair_tidal_artifacts
from crate.worker_handlers.acquisition import (
    _summarize_tidal_audio_quality,
    _tidal_audio_quality_event,
    _tidal_download_inner,
)


def _write_mp4_header(path: Path) -> None:
    path.write_bytes(b"\x00\x00\x00\x18ftypisom" + b"\x00" * 64)


@pytest.mark.parametrize(
    ("quality", "expected_tidal_quality", "expected_atmos_filter"),
    [
        ("normal", "normal", "none"),
        ("low", "low", "none"),
        ("high", "high", "none"),
        ("max", "max", "none"),
        ("lossless", "max", "none"),
        ("atmos", "normal", "only"),
    ],
)
def test_tidal_download_uses_collision_safe_output_template(
    tmp_path,
    monkeypatch,
    quality,
    expected_tidal_quality,
    expected_atmos_filter,
):
    captured: list[list[str]] = []

    class FakeProc:
        def __init__(self, cmd, **_kwargs):
            captured.append(cmd)
            processing_dir = Path(cmd[cmd.index("--path") + 1])
            album_dir = processing_dir / "KNEECAP" / "H.O.O.D 2025"
            album_dir.mkdir(parents=True)
            (album_dir / "01-01 - H.O.O.D (2025 Mix).m4a").write_bytes(b"fake-aac")
            self.stdout = iter(
                [
                    "Total downloads: 1\n",
                    "Downloaded H.O.O.D  123 /tmp/out\n",
                ]
            )
            self.returncode = 0

        def wait(self, timeout=None):
            return 0

        def kill(self):
            return None

    monkeypatch.setattr(tidal, "PROCESSING_DIR", str(tmp_path))
    monkeypatch.setattr(tidal.subprocess, "Popen", FakeProc)
    monkeypatch.setattr(tidal, "_sync_tiddl_country_code", lambda: None)

    result = tidal.download(
        "https://tidal.com/album/413046494",
        quality=quality,
        task_id="task-hood",
    )

    assert result["success"] is True
    assert result["audio_file_count"] == 1
    cmd = captured[0]
    assert cmd[cmd.index("-q") + 1] == expected_tidal_quality
    assert cmd[cmd.index("--dolby-atmos") + 1] == expected_atmos_filter
    assert cmd[cmd.index("--output") + 1] == tidal.TIDDL_OUTPUT_TEMPLATE
    assert "{item.number:02d}" in tidal.TIDDL_OUTPUT_TEMPLATE
    assert "{item.title_version}" in tidal.TIDDL_OUTPUT_TEMPLATE


def test_get_album_tracks_preserves_tidal_version_metadata(monkeypatch):
    class FakeResponse:
        status_code = 200

        def json(self):
            return {
                "items": [
                    {
                        "id": 413046496,
                        "title": "H.O.O.D",
                        "version": "2025 Mix",
                        "trackNumber": 1,
                        "volumeNumber": 1,
                        "duration": 173,
                        "isrc": "GBPVV2400717",
                        "artist": {"name": "KNEECAP"},
                        "mediaMetadata": {"tags": ["LOSSLESS", "HIRES_LOSSLESS"]},
                    }
                ]
            }

    monkeypatch.setattr(tidal, "get_auth_token", lambda: "token")
    monkeypatch.setattr(tidal, "get_setting", lambda _key, default=None: default)
    monkeypatch.setattr(
        tidal.requests,
        "get",
        lambda *_args, **_kwargs: FakeResponse(),
    )

    tracks = tidal.get_album_tracks("413046494")

    assert tracks == [
        {
            "id": "413046496",
            "title": "H.O.O.D",
            "version": "2025 Mix",
            "display_title": "H.O.O.D (2025 Mix)",
            "artist": "KNEECAP",
            "track_number": 1,
            "volume_number": 1,
            "duration": 173,
            "isrc": "GBPVV2400717",
            "url": "https://tidal.com/track/413046496",
            "quality": ["LOSSLESS", "HIRES_LOSSLESS"],
        }
    ]


def test_refresh_token_falls_back_to_raw_client_when_tiddl_cli_model_fails(
    tmp_path, monkeypatch
):
    auth_dir = tmp_path / ".tiddl"
    auth_dir.mkdir()
    auth_file = auth_dir / "auth.json"
    auth_file.write_text(
        json.dumps(
            {
                "token": "expired-token",
                "refresh_token": "refresh-token",
                "expires_at": 1,
                "user_id": "old-user",
                "country_code": "US",
            }
        )
    )

    monkeypatch.setattr(tidal, "TIDDL_CONFIG_DIR", str(auth_dir))
    monkeypatch.setattr(
        tidal.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            returncode=1, stdout="", stderr="ValidationError: user.facebookUid"
        ),
    )
    monkeypatch.setattr(
        tidal,
        "_raw_tidal_refresh",
        lambda refresh: {
            "access_token": "fresh-token",
            "expires_in": 3600,
            "user_id": 9,
            "user": {"userId": 9, "countryCode": "ES"},
        },
    )
    monkeypatch.setattr(tidal, "get_setting", lambda _key, default=None: "ES")

    assert tidal.refresh_token() is True

    refreshed = json.loads(auth_file.read_text())
    assert refreshed["token"] == "fresh-token"
    assert refreshed["refresh_token"] == "refresh-token"
    assert refreshed["user_id"] == "9"
    assert refreshed["country_code"] == "ES"
    assert refreshed["expires_at"] > 1


def test_configured_country_env_overrides_stale_db_setting(monkeypatch):
    monkeypatch.setenv("TIDAL_COUNTRY_CODE", "ES")
    monkeypatch.setattr(tidal, "get_setting", lambda _key, default=None: "US")

    assert tidal._configured_country_code() == "ES"


def test_download_syncs_tiddl_country_before_cli(tmp_path, monkeypatch):
    auth_dir = tmp_path / ".tiddl"
    auth_dir.mkdir()
    auth_file = auth_dir / "auth.json"
    auth_file.write_text(
        json.dumps(
            {
                "token": "token",
                "refresh_token": "refresh",
                "country_code": "ES",
            }
        )
    )

    class FakeProc:
        def __init__(self, _cmd, **_kwargs):
            self.stdout = iter([])
            self.returncode = 0

        def wait(self, timeout=None):
            return 0

        def kill(self):
            return None

    monkeypatch.setattr(tidal, "TIDDL_CONFIG_DIR", str(auth_dir))
    monkeypatch.setattr(tidal, "PROCESSING_DIR", str(tmp_path / "processing"))
    monkeypatch.setattr(tidal, "get_setting", lambda _key, default=None: "ES")
    monkeypatch.setattr(tidal.subprocess, "Popen", FakeProc)

    result = tidal.download("https://tidal.com/album/51384997", task_id="task-country")

    assert result["success"] is True
    assert json.loads(auth_file.read_text())["country_code"] == "ES"


def test_download_treats_zero_tiddl_downloads_as_failure(tmp_path, monkeypatch):
    class FakeProc:
        def __init__(self, _cmd, **_kwargs):
            self.stdout = iter(
                [
                    "API Error: Album [515052476] not found\n",
                    "Total downloads: 0\n",
                ]
            )
            self.returncode = 0

        def wait(self, timeout=None):
            return 0

        def kill(self):
            return None

    monkeypatch.setattr(tidal, "PROCESSING_DIR", str(tmp_path / "processing"))
    monkeypatch.setattr(tidal, "_sync_tiddl_country_code", lambda: None)
    monkeypatch.setattr(tidal.subprocess, "Popen", FakeProc)

    result = tidal.download("https://tidal.com/album/515052476", task_id="zero")

    assert result["success"] is False
    assert "Total downloads: 0" in result["error"]


def test_move_to_library_detailed_imports_loose_tiddl_audio_root(tmp_path, monkeypatch):
    processing = tmp_path / "processing"
    library = tmp_path / "library"
    processing.mkdir()
    loose_track = processing / "01 - Get To It.flac"
    loose_track.write_bytes(b"fLaC" + b"\x00" * 128)

    monkeypatch.setattr(
        tidal,
        "infer_album_identity",
        lambda _path: ("Quicksand", "Get to It & Regenerate"),
    )
    monkeypatch.setattr(
        tidal,
        "resolve_import_album_target",
        lambda root, artist, album: ({}, Path(root) / artist / album, False),
    )

    moved = tidal.move_to_library_detailed(str(processing), str(library))

    assert moved == [
        {
            "artist": "Quicksand",
            "album": "Get to It & Regenerate",
            "path": str(library / "Quicksand" / "Get to It & Regenerate"),
            "moved": 1,
        }
    ]
    assert (
        library / "Quicksand" / "Get to It & Regenerate" / loose_track.name
    ).exists()


def test_refresh_token_keeps_tiddl_cli_success_path(tmp_path, monkeypatch):
    auth_dir = tmp_path / ".tiddl"
    auth_dir.mkdir()
    (auth_dir / "auth.json").write_text(
        json.dumps({"token": "token", "refresh_token": "refresh"})
    )

    monkeypatch.setattr(tidal, "TIDDL_CONFIG_DIR", str(auth_dir))
    monkeypatch.setattr(
        tidal.subprocess, "run", lambda *_args, **_kwargs: SimpleNamespace(returncode=0)
    )
    monkeypatch.setattr(
        tidal,
        "_raw_tidal_refresh",
        lambda _refresh: (_ for _ in ()).throw(
            AssertionError("fallback should not run")
        ),
    )

    assert tidal.refresh_token() is True


def test_repair_tidal_artifacts_recovers_raw_flac_and_deletes_temp(tmp_path):
    album_dir = tmp_path / "Terror" / "Still Suffer"
    album_dir.mkdir(parents=True)
    raw_flac = album_dir / "Promised Only Lies.m4a"
    raw_flac.write_bytes(b"fLaC" + b"\x00" * 128)
    temp_file = album_dir / "tmpdeadbeef"
    temp_file.write_bytes(b"")

    summary = repair_tidal_artifacts(tmp_path)

    assert summary["renamed_to_flac"] == 1
    assert summary["deleted"] == 1
    assert (album_dir / "Promised Only Lies.flac").exists()
    assert not raw_flac.exists()
    assert not temp_file.exists()
    assert summary["unrecoverable"] == 0


@pytest.mark.parametrize("codec", ["aac", "ac4"])
def test_repair_tidal_artifacts_normalizes_supported_mp4_audio_to_m4a(
    tmp_path, monkeypatch, codec
):
    album_dir = tmp_path / "Terror" / "Still Suffer"
    album_dir.mkdir(parents=True)
    invalid_flac = album_dir / "Promised Only Lies.flac"
    _write_mp4_header(invalid_flac)

    monkeypatch.setattr("crate.m4a_fix._probe_audio_codec", lambda _path: codec)

    summary = repair_tidal_artifacts(tmp_path, allow_lossy_rename=True)

    assert summary["renamed_to_m4a"] == 1
    assert (album_dir / "Promised Only Lies.m4a").exists()
    assert not invalid_flac.exists()
    assert summary["lossy_files"] == ["Terror/Still Suffer/Promised Only Lies.flac"]
    assert summary["unrecoverable"] == 0


def test_summarize_tidal_audio_quality_reports_actual_bit_depths_and_sample_rates(
    tmp_path, monkeypatch
):
    album_dir = tmp_path / "Terror" / "Still Suffer"
    album_dir.mkdir(parents=True)
    (album_dir / "01 - Track 1.flac").write_bytes(b"audio")
    (album_dir / "02 - Track 2.flac").write_bytes(b"audio")
    records = [
        {
            "path": str(album_dir / "01 - Track 1.flac"),
            "ok": True,
            "bit_depth": 24,
            "sample_rate": 96000,
        },
        {
            "path": str(album_dir / "02 - Track 2.flac"),
            "ok": True,
            "bit_depth": 16,
            "sample_rate": 44100,
        },
    ]

    quality_calls = []

    def _run_quality(**kwargs):
        quality_calls.append(kwargs)
        return {"tracks": records}

    monkeypatch.setattr(
        "crate.crate_cli.run_quality",
        _run_quality,
    )

    summary = _summarize_tidal_audio_quality([{"path": str(album_dir)}])

    assert summary == {
        "tracks_total": 2,
        "tracks_probed": 2,
        "profiles": [
            {"bit_depth": 16, "sample_rate": 44100, "tracks": 1},
            {"bit_depth": 24, "sample_rate": 96000, "tracks": 1},
        ],
    }
    assert quality_calls == [
        {
            "directory": str(album_dir),
            "extensions": "aac,aif,aiff,alac,flac,m4a,mp3,ogg,opus,wav,wma",
        }
    ]


def test_summarize_tidal_audio_quality_batches_sibling_album_probes(
    tmp_path, monkeypatch
):
    artist_dir = tmp_path / "Terror"
    album_dirs = [artist_dir / "Album One", artist_dir / "Album Two"]
    tracks = []
    for album_dir in album_dirs:
        album_dir.mkdir(parents=True)
        track = album_dir / "01 - Track.flac"
        track.write_bytes(b"audio")
        tracks.append(track)

    unrelated_track = artist_dir / "Existing Album" / "01 - Existing.flac"
    unrelated_track.parent.mkdir()
    unrelated_track.write_bytes(b"audio")

    quality_calls = []

    def _run_quality(**kwargs):
        quality_calls.append(kwargs)
        return {
            "tracks": [
                {
                    "path": str(track),
                    "ok": True,
                    "bit_depth": 24,
                    "sample_rate": 96000,
                }
                for track in [*tracks, unrelated_track]
            ]
        }

    monkeypatch.setattr("crate.crate_cli.run_quality", _run_quality)
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.read_audio_quality",
        lambda *_args, **_kwargs: pytest.fail("native probe should cover all tracks"),
    )

    summary = _summarize_tidal_audio_quality(
        [{"path": str(album_dir)} for album_dir in album_dirs]
    )

    assert quality_calls == [
        {
            "directory": str(artist_dir),
            "extensions": "aac,aif,aiff,alac,flac,m4a,mp3,ogg,opus,wav,wma",
        }
    ]
    assert summary == {
        "tracks_total": 2,
        "tracks_probed": 2,
        "profiles": [{"bit_depth": 24, "sample_rate": 96000, "tracks": 2}],
    }


def test_summarize_tidal_audio_quality_falls_back_for_unprobed_native_tracks(
    tmp_path, monkeypatch
):
    album_dir = tmp_path / "Terror" / "Still Suffer"
    album_dir.mkdir(parents=True)
    first_track = album_dir / "01 - Track 1.flac"
    second_track = album_dir / "02 - Track 2.flac"
    first_track.write_bytes(b"audio")
    second_track.write_bytes(b"audio")
    monkeypatch.setattr(
        "crate.crate_cli.run_quality",
        lambda **_kwargs: {
            "tracks": [
                {
                    "path": str(first_track),
                    "ok": True,
                    "bit_depth": 24,
                    "sample_rate": None,
                }
            ]
        },
    )

    fallback_calls = []

    def _read_audio_quality(audio_file, *, use_native_probe=True):
        fallback_calls.append((audio_file, use_native_probe))
        if audio_file == first_track:
            return {"bit_depth": 24, "sample_rate": 96000}
        return {"bit_depth": 16, "sample_rate": 44100}

    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.read_audio_quality", _read_audio_quality
    )

    summary = _summarize_tidal_audio_quality([{"path": str(album_dir)}])

    assert summary == {
        "tracks_total": 2,
        "tracks_probed": 2,
        "profiles": [
            {"bit_depth": 16, "sample_rate": 44100, "tracks": 1},
            {"bit_depth": 24, "sample_rate": 96000, "tracks": 1},
        ],
    }
    assert fallback_calls == [(first_track, False), (second_track, False)]


def test_summarize_tidal_audio_quality_falls_back_when_native_probe_raises(
    tmp_path, monkeypatch
):
    album_dir = tmp_path / "Terror" / "Still Suffer"
    album_dir.mkdir(parents=True)
    track = album_dir / "01 - Track 1.flac"
    track.write_bytes(b"audio")

    def _raise_probe_error(**_kwargs):
        raise RuntimeError("native probe unavailable")

    monkeypatch.setattr("crate.crate_cli.run_quality", _raise_probe_error)
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.read_audio_quality",
        lambda _path, *, use_native_probe=True: {
            "bit_depth": 24,
            "sample_rate": 96000,
        },
    )

    summary = _summarize_tidal_audio_quality([{"path": str(album_dir)}])

    assert summary == {
        "tracks_total": 1,
        "tracks_probed": 1,
        "profiles": [{"bit_depth": 24, "sample_rate": 96000, "tracks": 1}],
    }


@pytest.mark.parametrize("native_tracks", [[], [{"ok": False, "error": "probe"}]])
def test_summarize_tidal_audio_quality_skips_unreadable_fallback_tracks(
    tmp_path, monkeypatch, native_tracks
):
    album_dir = tmp_path / "Terror" / "Still Suffer"
    album_dir.mkdir(parents=True)
    audio_files = [album_dir / f"{index:02d}.flac" for index in range(1, 4)]
    for audio_file in audio_files:
        audio_file.write_bytes(b"audio")

    monkeypatch.setattr(
        "crate.crate_cli.run_quality",
        lambda **_kwargs: {"tracks": native_tracks},
    )

    def _read_audio_quality(audio_file, *, use_native_probe=True):
        if audio_file == audio_files[0]:
            raise OSError("unreadable track")
        if audio_file == audio_files[1]:
            return None
        return {"bit_depth": 24, "sample_rate": 96000}

    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.read_audio_quality", _read_audio_quality
    )

    summary = _summarize_tidal_audio_quality([{"path": str(album_dir)}])

    assert summary == {
        "tracks_total": 3,
        "tracks_probed": 1,
        "profiles": [{"bit_depth": 24, "sample_rate": 96000, "tracks": 1}],
    }


@pytest.mark.parametrize("path", [None, "", "   ", Path(), "."])
def test_summarize_tidal_audio_quality_ignores_missing_album_paths(
    tmp_path, monkeypatch, path
):
    (tmp_path / "01 - unrelated.flac").write_bytes(b"audio")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("crate.crate_cli.run_quality", lambda **_kwargs: {"tracks": []})

    summary = _summarize_tidal_audio_quality([{"path": path}])

    assert summary == {"tracks_total": 0, "tracks_probed": 0, "profiles": []}


@pytest.mark.parametrize(
    ("audio_quality", "requested_quality", "expected_event"),
    [
        (
            {
                "tracks_total": 2,
                "tracks_probed": 2,
                "profiles": [{"bit_depth": 24, "sample_rate": 96000, "tracks": 2}],
            },
            "max",
            (
                "info",
                "Observed downloaded audio quality in 2/2 tracks: "
                "24-bit / 96000 Hz (2 tracks)",
            ),
        ),
        (
            {
                "tracks_total": 2,
                "tracks_probed": 2,
                "profiles": [{"bit_depth": 16, "sample_rate": 44100, "tracks": 2}],
            },
            "max",
            (
                "warn",
                "Tidal MAX was requested, but no 24-bit audio was confirmed "
                "(2/2 tracks inspected). Observed: 16-bit / 44100 Hz (2 tracks)",
            ),
        ),
        (
            {
                "tracks_total": 10,
                "tracks_probed": 10,
                "profiles": [
                    {"bit_depth": 16, "sample_rate": 44100, "tracks": 9},
                    {"bit_depth": 24, "sample_rate": 96000, "tracks": 1},
                ],
            },
            "max",
            (
                "warn",
                "Tidal MAX was requested, but only 1 of 10 tracks met the 24-bit "
                "target (10/10 tracks inspected). Observed: 16-bit / 44100 Hz "
                "(9 tracks), 24-bit / 96000 Hz (1 track)",
            ),
        ),
        (
            {
                "tracks_total": 2,
                "tracks_probed": 2,
                "profiles": [{"bit_depth": 16, "sample_rate": 44100, "tracks": 2}],
            },
            "lossless",
            (
                "info",
                "Observed downloaded audio quality in 2/2 tracks: "
                "16-bit / 44100 Hz (2 tracks)",
            ),
        ),
        (
            {
                "tracks_total": 2,
                "tracks_probed": 2,
                "profiles": [
                    {"bit_depth": 8, "sample_rate": 22050, "tracks": 1},
                    {"bit_depth": 16, "sample_rate": 44100, "tracks": 1},
                ],
            },
            "lossless",
            (
                "warn",
                "Tidal lossless was requested, but only 1 of 2 tracks met the 16-bit "
                "target (2/2 tracks inspected). Observed: 8-bit / 22050 Hz "
                "(1 track), 16-bit / 44100 Hz (1 track)",
            ),
        ),
        (
            {
                "tracks_total": 2,
                "tracks_probed": 1,
                "profiles": [{"bit_depth": 24, "sample_rate": 96000, "tracks": 1}],
            },
            "max",
            (
                "warn",
                "Tidal MAX was requested, but only 1 of 2 tracks met the 24-bit "
                "target (1/2 tracks inspected). Observed: 24-bit / 96000 Hz "
                "(1 track)",
            ),
        ),
        (
            {
                "tracks_total": 2,
                "tracks_probed": 2,
                "profiles": [{"bit_depth": 8, "sample_rate": 22050, "tracks": 2}],
            },
            "lossless",
            (
                "warn",
                "Tidal lossless was requested, but no 16-bit audio was confirmed "
                "(2/2 tracks inspected). Observed: 8-bit / 22050 Hz (2 tracks)",
            ),
        ),
        (
            {"tracks_total": 2, "tracks_probed": 0, "profiles": []},
            "lossless",
            (
                "warn",
                "Tidal lossless was requested, but Crate could not verify the "
                "downloaded bit depth or sample rate",
            ),
        ),
    ],
)
def test_tidal_audio_quality_event_reports_detected_quality(
    audio_quality, requested_quality, expected_event
):
    assert (
        _tidal_audio_quality_event(audio_quality, requested_quality) == expected_event
    )


def test_repair_tidal_artifacts_marks_temp_aac_unrecoverable(tmp_path, monkeypatch):
    album_dir = tmp_path / "Terror" / "Still Suffer"
    album_dir.mkdir(parents=True)
    temp_mp4 = album_dir / "tmpcafebabe"
    _write_mp4_header(temp_mp4)

    monkeypatch.setattr("crate.m4a_fix._probe_audio_codec", lambda _path: "aac")

    summary = repair_tidal_artifacts(tmp_path, allow_lossy_rename=True)

    assert summary["deleted"] == 0
    assert summary["unrecoverable"] == 1
    assert summary["lossy_files"] == ["Terror/Still Suffer/tmpcafebabe"]


def test_repair_tidal_artifacts_accepts_named_dolby_atmos_ac4_m4a(
    tmp_path, monkeypatch
):
    album_dir = tmp_path / "Terror" / "Still Suffer"
    album_dir.mkdir(parents=True)
    atmos_file = album_dir / "01 - Track.m4a"
    _write_mp4_header(atmos_file)

    monkeypatch.setattr("crate.m4a_fix._probe_audio_codec", lambda _path: "ac4")

    summary = repair_tidal_artifacts(tmp_path, allow_lossy_rename=True)

    assert atmos_file.exists()
    assert summary["renamed_to_m4a"] == 0
    assert summary["unrecoverable"] == 0
    assert summary["lossy_files"] == []


@pytest.mark.parametrize(
    (
        "requested_quality",
        "expected_download_calls",
        "expected_quality_inspections",
        "album_dir_lookup_error",
        "fallback_to_normal",
        "quality_inspection_error",
    ),
    [
        ("max", ["max", "max", "normal"], 0, False, True, False),
        ("normal", ["normal"], 0, False, False, False),
        ("atmos", ["atmos"], 0, False, False, False),
        ("max", ["max", "max", "normal"], 0, True, True, False),
        ("max", ["max"], 1, False, False, False),
        ("max", ["max"], 1, False, False, True),
    ],
)
def test_tidal_download_inner_inspects_only_successful_lossless_downloads(
    tmp_path,
    monkeypatch,
    requested_quality,
    expected_download_calls,
    expected_quality_inspections,
    album_dir_lookup_error,
    fallback_to_normal,
    quality_inspection_error,
):
    initial_dir = tmp_path / "initial" / "Terror" / "Still Suffer"
    initial_dir.mkdir(parents=True)
    if requested_quality == "max" and not fallback_to_normal:
        for idx in range(10):
            (initial_dir / f"{idx + 1:02d} - Track {idx + 1}.m4a").write_bytes(
                b"fake-aac"
            )
    else:
        _write_mp4_header(initial_dir / "Promised Only Lies.flac")
        (initial_dir / "tmpdeadbeef").write_bytes(b"")

    fallback_dir = tmp_path / "fallback" / "Terror" / "Still Suffer"
    fallback_dir.mkdir(parents=True)
    for idx in range(10):
        (fallback_dir / f"{idx + 1:02d} - Track {idx + 1}.m4a").write_bytes(b"fake-aac")

    download_calls: list[str] = []

    def _fake_download(
        _url: str, quality: str = "max", task_id: str = "", progress_callback=None
    ):
        download_calls.append(quality)
        incomplete_lossless = quality == "max" and fallback_to_normal
        path = (
            initial_dir.parent.parent
            if quality == "max"
            else fallback_dir.parent.parent
        )
        return {
            "success": True,
            "path": str(path),
            "file_count": 2 if incomplete_lossless else 10,
            "audio_file_count": 0 if incomplete_lossless else 10,
            "invalid_audio_files": [],
            "temp_artifact_files": [],
            "errors": [],
        }

    class _DummySync:
        def __init__(self, _config):
            pass

        def sync_album(self, _album_dir, _artist_name):
            return None

    monkeypatch.setattr("crate.m4a_fix._probe_audio_codec", lambda _path: "aac")
    monkeypatch.setattr("crate.tidal.download", _fake_download)
    monkeypatch.setattr("crate.tidal.ensure_auth", lambda: True)
    monkeypatch.setattr("crate.tidal.get_album_track_count", lambda _album_id: 10)
    monkeypatch.setattr(
        "crate.tidal.get_album_tracks",
        lambda _album_id: [{"id": str(i)} for i in range(10)],
    )
    monkeypatch.setattr(
        "crate.tidal.move_to_library_detailed",
        lambda _path, _lib, **_kwargs: [
            {
                "artist": "Terror",
                "album": "Still Suffer",
                "path": str(tmp_path / "library" / "Terror" / "Still Suffer"),
                "moved": 10,
            }
        ],
    )
    monkeypatch.setattr("crate.library_sync.LibrarySync", _DummySync)
    task_events = []
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_task_event",
        lambda *args, **kwargs: task_events.append(args),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_progress", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.emit_item_event",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.set_cache", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.delete_cache", lambda *args, **kwargs: None
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.append_domain_event",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition.update_tidal_download",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._resolve_tidal_preferred_artist_name",
        lambda *args, **kwargs: "Terror",
    )
    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._align_tidal_staged_artist_dirs",
        lambda *args, **kwargs: ["Terror"],
    )
    monkeypatch.setattr("crate.worker_handlers.acquisition.start_scan", lambda: None)
    if album_dir_lookup_error:
        from crate.worker_handlers import acquisition

        original_existing_album_dir = acquisition._existing_album_dir
        lookup_failed = False

        def _raise_once(raw_path):
            nonlocal lookup_failed
            if not lookup_failed:
                lookup_failed = True
                raise OSError("temporary album path lookup failure")
            return original_existing_album_dir(raw_path)

        monkeypatch.setattr(
            "crate.worker_handlers.acquisition._existing_album_dir", _raise_once
        )
    quality_inspections = []
    observed_quality = {
        "tracks_total": 10,
        "tracks_probed": 10,
        "profiles": [{"bit_depth": 24, "sample_rate": 96000, "tracks": 10}],
    }

    def _record_quality_inspection(albums):
        quality_inspections.append(albums)
        if quality_inspection_error:
            raise OSError("temporary quality inspection failure")
        if not fallback_to_normal and requested_quality == "max":
            return observed_quality
        return _summarize_tidal_audio_quality(albums)

    monkeypatch.setattr(
        "crate.worker_handlers.acquisition._summarize_tidal_audio_quality",
        _record_quality_inspection,
    )
    (tmp_path / "library" / "Terror" / "Still Suffer").mkdir(
        parents=True, exist_ok=True
    )

    result = _tidal_download_inner(
        "task-1",
        {"artist": "Terror", "album": "Still Suffer", "content_type": "album"},
        {"library_path": str(tmp_path / "library")},
        "https://tidal.com/album/493246888",
        requested_quality,
        38,
        tmp_path / "library",
    )

    assert result["success"] is True
    assert result["files"] == 10
    assert result["quality"] == ("normal" if fallback_to_normal else requested_quality)
    assert result["audio_quality"] == (
        observed_quality
        if expected_quality_inspections and not quality_inspection_error
        else {"tracks_total": 0, "tracks_probed": 0, "profiles": []}
    )
    assert download_calls == expected_download_calls
    assert len(quality_inspections) == expected_quality_inspections
    assert not any(
        len(event) > 2
        and isinstance(event[2], dict)
        and "Tidal MAX was requested" in event[2].get("message", "")
        for event in task_events
    )
    if fallback_to_normal:
        assert any(
            len(event) > 2
            and isinstance(event[2], dict)
            and "retrying in normal quality" in event[2].get("message", "")
            for event in task_events
        )
    else:
        assert not any(
            len(event) > 2
            and isinstance(event[2], dict)
            and "retrying in normal quality" in event[2].get("message", "")
            for event in task_events
        )
    if expected_quality_inspections and not quality_inspection_error:
        assert any(
            len(event) > 2
            and event[1] == "info"
            and isinstance(event[2], dict)
            and "Observed downloaded audio quality in 10/10 tracks"
            in event[2].get("message", "")
            for event in task_events
        )
    if quality_inspection_error:
        assert not any(
            len(event) > 2
            and isinstance(event[2], dict)
            and "Observed downloaded audio quality" in event[2].get("message", "")
            for event in task_events
        )
