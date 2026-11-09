"""Stem analyses of an evaluation pool (Smart Mix Stems ST3.PR3)."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from separate_pool import (
    check_scratch,
    level_differences,
    load_stem_analyses,
    read_tracks,
    sdr_db,
)
from crate.smart_mix.stems import STEM_SOURCES, StemAnalysis

UID = "00000000-0000-4000-8000-000000000001"
OTHER = "00000000-0000-4000-8000-000000000002"


def _analysis(level: int = 100, *, windows: int = 8) -> StemAnalysis:
    return StemAnalysis(
        schema_version="stem-analysis/1",
        producer="crate-server/eval",
        separator={
            "model": "htdemucs",
            "version": "htdemucs-onnx-1",
            "sources": STEM_SOURCES,
        },
        source_revision="a" * 64,
        hop_ms=250,
        levels={stem: bytes([level]) * windows for stem in STEM_SOURCES},
        duration_ms=windows * 250,
    )


def test_read_tracks_maps_the_music_root_and_skips_repeats(tmp_path: Path) -> None:
    pool = tmp_path / "pool.tsv"
    pool.write_text(
        f"# uid\tpath\n{UID}\t/music/a/one.flac\n{UID}\t/music/a/again.flac\n"
        f"{OTHER}\t/elsewhere/two.mp3\textra\n\nbroken-line\n"
    )

    tracks = read_tracks(pool, music_root="/music=/data/audio")

    assert [(t.entity_uid, str(t.path)) for t in tracks] == [
        (UID, "/data/audio/a/one.flac"),
        (OTHER, "/elsewhere/two.mp3"),
    ]


def test_scratch_audio_never_goes_to_memory(tmp_path: Path, monkeypatch) -> None:
    import separate_pool

    for memory in ("/tmp/separate", "/dev/shm/separate", "/run/user/1000/x"):
        with pytest.raises(SystemExit, match="in memory"):
            check_scratch(Path(memory))
    # pytest's tmp_path may itself be under /tmp: only /dev/shm counts here.
    monkeypatch.setattr(separate_pool, "_MEMORY_ROOTS", (Path("/dev/shm"),))
    scratch = check_scratch(tmp_path / "scratch")
    assert scratch.is_dir()


def test_sdr_and_level_differences() -> None:
    reference = np.sin(np.linspace(0, 40, 4_000)).astype(np.float32)

    assert math.isinf(sdr_db(reference, reference))
    assert sdr_db(reference, reference * 0.99) == pytest.approx(40.0, abs=0.01)
    differences = level_differences(_analysis(100), _analysis(101))
    assert differences["drums"] == {"windows": 8, "differing": 8, "maxByteDelta": 1}
    assert level_differences(_analysis(), _analysis(windows=9))["bass"] == {
        "windows": [8, 9]
    }


def test_load_stem_analyses_reads_one_file_per_track(tmp_path: Path) -> None:
    for uid, level in ((UID, 10), (OTHER, 20)):
        (tmp_path / f"{uid}.json").write_text(
            _analysis(level).model_dump_json(by_alias=True)
        )
    (tmp_path / "run-1.json").write_text(json.dumps({"separated": 2}))
    (tmp_path / "index.jsonl").write_text("{}\n")

    analyses = load_stem_analyses(tmp_path)

    assert set(analyses) == {UID, OTHER}
    assert analyses[OTHER].levels.vocals == bytes([20]) * 8
