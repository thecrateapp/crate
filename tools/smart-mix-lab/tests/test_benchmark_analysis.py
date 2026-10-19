from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

from benchmark_analysis import (
    BLOCK_FRAMES,
    SAMPLE_RATE,
    click_frames,
    generated_corpus,
    opposite_phase_frames,
    write_wav,
)


def test_long_fixture_is_written_in_bounded_blocks(tmp_path: Path) -> None:
    blocks = list(click_frames(124.0, 25.0))

    assert max(block.shape[0] for block in blocks) <= BLOCK_FRAMES
    frames = write_wav(tmp_path / "long.wav", iter(blocks))
    with wave.open(str(tmp_path / "long.wav")) as handle:
        assert handle.getnchannels() == 2
        assert handle.getframerate() == SAMPLE_RATE
        assert handle.getnframes() == frames == 25 * SAMPLE_RATE


def test_opposite_phase_fixture_keeps_channel_polarity() -> None:
    block = next(opposite_phase_frames(1.0))

    assert np.allclose(block[:, 0] * -0.8, block[:, 1] * 0.9)


def test_corpus_covers_long_duration_and_edge_cases() -> None:
    names = [name for name, _frames in generated_corpus(7_200)]

    assert "long-7200.wav" in names
    assert {"opposite-phase.wav", "silence.wav"} <= set(names)
