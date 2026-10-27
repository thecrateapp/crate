"""Beat grid for a film soundtrack.

    uv run --python 3.12 --with librosa python film/beats.py TRACK.flac \
        --id listen --first-bar 77 --end-bar 110 --artist "..." --title "..." --out film/data/listen.beats.json

Bars are numbered from the first tracked beat of the whole song, four beats per bar, which is the
numbering the plan uses. Inside the window the grid is a constant tempo fitted to the tracked beats,
so cuts never inherit beat-tracker jitter. Times in the output are relative to the window start.
"""

import argparse
import json

import librosa
import numpy as np

BEATS_PER_BAR = 4


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("--id", required=True)
    parser.add_argument("--first-bar", type=int, required=True)
    parser.add_argument("--end-bar", type=int, required=True, help="bar where the window stops (exclusive)")
    parser.add_argument("--artist", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    y, sr = librosa.load(args.path, sr=22050, mono=True)
    onset = librosa.onset.onset_strength(y=y, sr=sr)
    _, tracked = librosa.beat.beat_track(onset_envelope=onset, sr=sr, units="time")

    first = args.first_bar * BEATS_PER_BAR
    last = args.end_bar * BEATS_PER_BAR
    anchor = tracked[first]
    count = last - first
    # Tracked beats snap to analysis frames (~23 ms), so single intervals alternate around the real
    # period; the span over the whole window does not.
    period = float((tracked[last] - tracked[first]) / count)
    window = tracked[(tracked >= anchor - period / 2) & (tracked <= anchor + period * (count + 0.5))]
    phase = 0.0
    inliers = np.ones(len(window), dtype=bool)
    for _ in range(8):
        slots = np.round((window - anchor - phase) / period)
        period, phase = np.polyfit(slots[inliers], (window - anchor)[inliers], 1)
        error = window - anchor - (period * slots + phase)
        inliers = np.abs(error) < period * 0.12
    residual_ms = float(np.percentile(np.abs(error[inliers]), 95) * 1000)
    inlier_share = float(inliers.mean())

    start = anchor + phase
    beats = period * np.arange(count)
    duration = period * count

    rms = librosa.feature.rms(y=y)[0]
    rms_times = librosa.times_like(rms, sr=sr)
    energy = np.array([rms[(rms_times >= start + b) & (rms_times < start + b + period)].mean() for b in beats])
    energy = energy / energy.max()

    # Breakdowns without a kick pull the onset peak to the off-beats, so only loud beats set the phase.
    fine = librosa.onset.onset_strength(y=y, sr=sr, hop_length=128)
    fine_times = librosa.times_like(fine, sr=sr, hop_length=128)
    loud = beats[energy >= 0.6] + start
    nudges = np.arange(-0.06, 0.0601, 0.005)
    nudge = float(nudges[np.argmax([np.interp(loud + n, fine_times, fine).mean() for n in nudges])])
    start += nudge

    out = {
        "id": args.id,
        "artist": args.artist,
        "title": args.title,
        "bpm": round(60 / period, 3),
        "beatsPerBar": BEATS_PER_BAR,
        "firstBar": args.first_bar,
        "bars": args.end_bar - args.first_bar,
        "sourceStart": round(float(start), 4),
        "duration": round(float(duration), 4),
        "beats": [round(float(b), 4) for b in beats],
        "energy": [round(float(e), 3) for e in energy],
        "p95ResidualMs": round(residual_ms, 1),
        "onGridShare": round(inlier_share, 3),
        "phaseNudgeMs": round(nudge * 1000, 1),
    }
    with open(args.out, "w") as handle:
        json.dump(out, handle, indent=2)
        handle.write("\n")
    print(f"{args.id}: {out['bpm']} BPM, {out['bars']} bars, {duration:.2f}s from {start:.2f}s, {inlier_share:.0%} of tracked beats on the grid (p95 {residual_ms:.0f} ms), phase nudge {nudge * 1000:+.0f} ms")


if __name__ == "__main__":
    main()
