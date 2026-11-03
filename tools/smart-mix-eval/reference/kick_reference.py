"""Waveform reference for grid accuracy, checkable by eye in any editor.

At 5 positions spread over the track (1/6 .. 5/6), take the 16 beats of the grid under
test nearest that position, average the low-passed (<150 Hz, zero-phase) Hilbert envelope
around each beat over -P/2..+P/2, and report where the folded kick envelope crosses 50 %
of its rise, relative to the grid beat. 0 ms means the grid sits on the kick attack.
usage: kick_reference.py <scratch> <variant> [<variant> ...]
"""

import json
import sys
import warnings
from pathlib import Path

import librosa
import numpy as np
import scipy.signal as sg

root = Path(sys.argv[1])
FULL_CSV = [
    "62654024-d52e-5523-a386-05b9c424c4bb",
    "e71c8c68-42d0-5d34-99cd-49c223d78e76",
    "c7709c78-5064-5c1c-8f85-2c5c720c9b5f",
    "3ccf98d0-53c3-5235-9122-98ef5f349d89",
    "b4533240-9708-5577-aeb3-1926a5e224fc",
    "11bb8d08-df9f-5e37-b7f9-2009d581503d",
    "aa3b1640-57a2-5d1c-b985-12f1b71dc65b",
    "2dbb326e-da09-5a4c-9edc-ff0ae5ec9187",
    "2a4f222b-e433-534f-b40d-e6a7ad221aa2",
    "60852b5f-0050-5680-9e73-e660e3b4431a",
]


def attack_offset(envelope, sample_rate, beats_ms, period_ms):
    """Steepest rise of the kick envelope folded over the given beats, within +-60 ms."""
    offsets = np.arange(-60, 61)
    folded = np.zeros(offsets.size)
    used = 0
    for beat in beats_ms:
        index = np.round((beat + offsets) * sample_rate / 1000).astype(int)
        if index[0] < 0 or index[-1] >= envelope.size:
            continue
        folded += envelope[index]
        used += 1
    if not used:
        return None
    rise = np.diff(np.convolve(folded / used, np.ones(5) / 5, mode="same"))
    return float(offsets[int(np.argmax(rise[2:-2])) + 2])


def probes(grid_ms, duration_ms):
    grid = np.asarray(grid_ms, dtype=float)
    picks = []
    for sixth in range(1, 6):
        centre = duration_ms * sixth / 6
        nearest = int(np.argmin(np.abs(grid - centre)))
        start = max(0, min(nearest - 16, grid.size - 32))
        picks.append(grid[start : start + 32])
    return picks


rows = {}
for uid in FULL_CSV:
    audio_path = next(Path.home().joinpath(".cache/crate-decks-spike").glob(f"{uid}.*"))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        audio, rate = librosa.load(str(audio_path), sr=None, mono=True)
    low = sg.sosfiltfilt(sg.butter(4, 150, "low", fs=rate, output="sos"), audio)
    envelope = np.abs(sg.hilbert(low))
    duration_ms = audio.size * 1000 / rate
    ref = json.loads((root / "ref" / f"{uid}.json").read_text())
    mixxx_period = 60_000.0 / ref["bpm"]
    mixxx_grid = np.arange(ref["firstBeatMs"], duration_ms, mixxx_period)
    grids = {"mixxx": (mixxx_grid, mixxx_period)}
    for variant in sys.argv[2:]:
        profile = json.loads((Path(variant) / "spike" / f"{uid}.json").read_text())[
            "mixProfile"
        ]
        grid = profile["beatGridMs"]
        period = float(np.median(np.diff(grid)))
        grids[Path(variant).name] = (grid, period)
    row = {}
    for name, (grid, period) in grids.items():
        errors = [
            attack_offset(envelope, rate, window, period)
            for window in probes(grid, duration_ms)
        ]
        row[name] = errors
    rows[uid] = row
    print(
        uid[:8],
        "  ".join(
            f"{name}: max {max(abs(e) for e in errs):5.1f} ms [{', '.join(f'{e:+.0f}' for e in errs)}]"
            for name, errs in row.items()
        ),
    )

for name in rows[FULL_CSV[0]]:
    maxima = [max(abs(e) for e in row[name]) for row in rows.values()]
    print(
        f"{name:10s} median of per-track max {np.median(maxima):6.1f} ms; tracks within 5 ms {sum(m <= 5 for m in maxima)}/10; within 10 ms {sum(m <= 10 for m in maxima)}/10"
    )
