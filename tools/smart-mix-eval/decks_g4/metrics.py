"""SM5's listening metrics on the Decks G4 and G4b renders (Crate Decks plan, G4).

Two kinds of render of the same pairs are measured with the same functions of
``listen_metrics.py`` (beat clash and phase with Beat This!, voice on voice with
YAMNet, bass on bass, EBU R128 loudness):

- **Android**: a plan rendered by ``render_pair.py`` the way the Android engine
  plays it, through ``listen_metrics.measure_plan`` unchanged. The plans are the
  ones Decks played (``playedPlan`` of each Decks run), so Android and Decks play
  the same plan, and the Android app's own plan for the edge (``listen``).
- **Decks**: the renders of ``decksg4render_test.cpp`` (the real engine, Auto
  DJ, adapter and director): ``mix.wav`` and each deck alone at unity gain
  (``outgoing.wav``, ``incoming.wav``) on the same clock, and ``trace.csv``. The
  excerpt is cut as ``render_pair.render_window`` cuts Android's (the same
  context before and after the mix), around the transition as Decks played it:
  from the incoming deck's start to the outgoing deck's stop. "Full level"
  takes each deck's crossfade gain from what the engine applied (crossfader
  gain times pregain, the plan's staging divided out, as SM5's mask leaves the
  staging out), and bass on bass applies the EQ cut the director set.

It also reads from the trace how far each run's decks were from where the
plan puts them (``alignment``): the incoming deck's position against the
outgoing one's, in output time, at the start and through the mix.

usage (in the analysis worker image, with the music under /music):
    metrics.py --pairs pairs.json --runs runs --reference reference_plans.json \\
        --music-root HOST_PREFIX=/music --output out [--jobs 6]
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shutil
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from common import ensure_app_on_path  # noqa: E402

ensure_app_on_path()

import listen_metrics as lm  # noqa: E402
from crate.smart_mix.evaluation import (  # noqa: E402
    OVERLAP_FLOOR_DB,
    OVERLAP_FLOOR_GAIN,
    staging_gains,
)
from render_pair import plan_from_dict, render_window  # noqa: E402

METRICS_VERSION = 1
EDGE_FADE_MS = 50
DECKS_VARIANTS = ("v3", "v2", "v3-norg")
RATE = 44_100


def read_trace(path: Path) -> dict[str, np.ndarray]:
    with path.open() as handle:
        rows = list(csv.DictReader(handle))
    return {key: np.asarray([float(row[key]) for row in rows]) for key in rows[0]}


def write_wav(path: Path, audio: np.ndarray) -> None:
    import soundfile

    soundfile.write(str(path), audio, RATE, subtype="FLOAT")


def transition_times(report: dict[str, Any], trace: dict[str, np.ndarray]) -> tuple[float, float]:
    """Start and end of the transition as played, in the render's time (ms)."""
    events = {event["state"]: event["tMs"] for event in report["events"]}
    t = trace["tMs"]
    if report.get("mixed") and "Running" in events:
        start = events["Running"]
        ends = [
            event["tMs"]
            for event in report["events"]
            if event["state"] in ("Completed", "FellBack", "Cancelled") and event["tMs"] >= start
        ]
        end = ends[0] if ends else start + report["durationMs"]
        return start, end
    # Auto DJ's own fade: deck 2 starts, deck 1 stops
    playing = np.flatnonzero(trace["play2"] > 0)
    start = float(t[playing[0]]) if playing.size else float(t[-1])
    stopped = np.flatnonzero((trace["play1"] == 0) & (t > start))
    end = float(t[stopped[0]]) if stopped.size else float(t[-1])
    return start, end


def alignment(report: dict[str, Any], trace: dict[str, np.ndarray], start: float, end: float) -> dict:
    """Where the incoming deck is against where the plan puts it, in output ms.

    ``offset(t) = (pos2 - startIncomingCue) / ratio - (pos1 - plannedStart) / rate1``:
    zero when both decks are where the plan says for the outgoing deck's position.
    """
    plan = report.get("playedPlan") or report["askedPlan"]
    if not report.get("mixed"):
        return {}
    t = trace["tMs"]
    ratio = plan["incomingTempoRatio"] if plan["mode"] == "beatmatch" else 1.0
    inside = (t >= start + 30) & (t < end) & (trace["play2"] > 0)
    if not inside.any():
        return {}
    offset = (trace["pos2Ms"][inside] - plan["startIncomingCueMs"]) / ratio - (
        trace["pos1Ms"][inside] - report["plannedStartOutgoingMs"]
    ) / np.maximum(trace["rate1"][inside], 1e-6)
    return {
        "offsetAtStartMs": round(float(offset[0]), 2),
        "offsetMedianMs": round(float(np.median(offset)), 2),
        "offsetDriftMs": round(float(offset[-1] - offset[0]), 2),
        "startVsPlanOutgoingMs": round(
            report["startOutgoingMs"] - report["plannedStartOutgoingMs"], 2
        ),
    }


def measure_decks(run: Path, beat_model: Any, voice_model: Any, ffmpeg: str) -> dict[str, Any]:
    from crate.smart_mix.beat_model import track_beats
    from crate.smart_mix.vocals import voice_window_bytes

    report = json.loads((run / "report.json").read_text())
    trace = read_trace(run / "trace.csv")
    stems_trace = read_trace(run / "trace-stems.csv")
    plan_dict = report.get("playedPlan") or report["askedPlan"]
    plan = plan_from_dict(plan_dict)
    start, end = transition_times(report, trace)
    duration = max(0.0, end - start)
    window = render_window(plan)
    pre, post = window.pre_ms, window.post_ms
    first = int(round((start - pre) * RATE / 1000))
    last = int(round((end + post) * RATE / 1000))
    import soundfile

    audio = {}
    for name in ("mix", "outgoing", "incoming"):
        data, rate = soundfile.read(str(run / f"{name}.wav"), dtype="float32", always_2d=True)
        assert rate == RATE
        clip = np.zeros((last - first, 2), dtype=np.float32)
        lo, hi = max(0, first), min(len(data), last)
        if hi > lo:
            clip[lo - first : hi - first] = data[lo:hi]
        fade = int(EDGE_FADE_MS * RATE / 1000)
        ramp = np.linspace(0.0, 1.0, fade, dtype=np.float32)[:, None]
        clip[:fade] *= ramp
        clip[-fade:] *= ramp[::-1]
        audio[name] = clip
    total_ms = int(round((last - first) * 1000 / RATE))
    steps = total_ms // lm.STEP_MS
    centres = np.arange(steps) * lm.STEP_MS + lm.STEP_MS / 2 + (start - pre)

    # Crossfade gains as the engine applied them, staging divided out
    def at(column: str, source: dict[str, np.ndarray] = trace) -> np.ndarray:
        return np.interp(centres, source["tMs"], source[column])

    rate1 = float(np.interp(start, trace["tMs"], trace["rate1"])) or 1.0
    report_duration = report["durationMs"] if report.get("mixed") else duration
    progress = (centres - start) * rate1 / max(report_duration, 1.0)
    within = (centres >= start) & (centres < end)
    incoming_db = float(report.get("incomingStagingDb", min(0.0, plan.incoming_gain_db)))
    fade_gain = {}
    for index, role in ((1, 0), (2, 1)):
        applied = at(f"xfGain{index}") * at(f"pregain{index}")
        if report.get("mixed"):
            staging = np.asarray(
                [
                    # The director only attenuates (curves::stagingGain), and with
                    # ReplayGain stages the incoming deck's residual (G4 finding 3)
                    staging_gains(float(p), min(0.0, plan.outgoing_gain_db), incoming_db)[role]
                    for p in progress
                ]
            )
            applied = applied / np.maximum(staging, 1e-6)
        fade_gain[index] = applied
    mask = within & (fade_gain[1] >= OVERLAP_FLOOR_GAIN) & (fade_gain[2] >= OVERLAP_FLOOR_GAIN)

    with tempfile.TemporaryDirectory(prefix="decks-g4-") as scratch:
        paths = {}
        for name, clip in audio.items():
            paths[name] = Path(scratch) / f"{name}.wav"
            write_wav(paths[name], clip)
        beats, voices, low_end = {}, {}, {}
        for name, clip in audio.items():
            mono = np.ascontiguousarray(clip.mean(axis=1))
            track = track_beats(mono, RATE, model=beat_model)
            beats[name] = list(track.beats_ms) if track else []
            if name != "mix":
                windows = voice_model.voice_windows(lm._resample(mono, RATE, lm.YAMNET_RATE))
                levels = np.frombuffer(voice_window_bytes(windows).scores, dtype=np.uint8)
                voices[name] = (np.asarray(windows.centres_ms), levels)
                low_end[name] = lm.low_band_db(mono, RATE, steps)
        loudness = lm.loudness_jumps(
            *lm._ebur128(paths["mix"], ffmpeg), start_ms=pre, end_ms=pre + int(duration)
        )

    # Bass on bass with the engine's own gains and EQ cuts
    def playing(levels: np.ndarray) -> np.ndarray:
        audible = levels[np.isfinite(levels) & (levels > lm.BASS_SILENCE_DB)]
        if audible.size == 0:
            return np.zeros(levels.size, dtype=bool)
        reference = float(np.percentile(audible, 90))
        return (levels >= reference - lm.BASS_PLAYING_DROP_DB) & (levels > lm.BASS_SILENCE_DB)

    both = playing(low_end["outgoing"]) & playing(low_end["incoming"]) & within
    with np.errstate(divide="ignore"):
        out_db = 20 * np.log10(np.maximum(fade_gain[1], 0)) + at("lowCut1Db")
        in_db = 20 * np.log10(np.maximum(fade_gain[2], 0)) + at("lowCut2Db")
    bass = int(np.sum(both & (out_db >= OVERLAP_FLOOR_DB) & (in_db >= OVERLAP_FLOOR_DB))) * lm.STEP_MS
    excerpt_start = pre
    beat = lm.beat_agreement(
        [b for b in beats["outgoing"]],
        [b for b in beats["incoming"]],
        overlap=(excerpt_start, excerpt_start + int(duration)),
        full_level=mask,
    )
    # Both passes must have run alike for the stems to sit under the mix
    common = min(trace["tMs"].size, stems_trace["tMs"].size)
    pass_gap = float(
        np.max(
            np.abs(trace["pos1Ms"][:common] - stems_trace["pos1Ms"][:common])
            + np.abs(trace["pos2Ms"][:common] - stems_trace["pos2Ms"][:common])
        )
    )
    return {
        "mode": plan_dict["mode"],
        "curve": plan_dict["curve"],
        "durationMs": int(duration),
        "plannedDurationMs": plan_dict["durationMs"],
        "render": {"durationMs": total_ms, "transitionStartMs": pre, "transitionEndMs": pre + int(duration)},
        "mixed": report.get("mixed"),
        "reason": report.get("reason"),
        "passGapMs": round(pass_gap, 3),
        **beat,
        "mixIbiCv": lm.ibi_cv(beats["mix"], excerpt_start, excerpt_start + duration),
        "voiceOnVoiceMs": lm.voice_on_voice_ms(voices["outgoing"], voices["incoming"], mask),
        "bassOnBassMs": bass,
        "fullLevelMs": int(mask.sum()) * lm.STEP_MS,
        **loudness,
        "alignment": alignment(report, trace, start, end),
    }


def measure_android(plan_dict: dict, outgoing: str, incoming: str, beat_model, voice_model, ffmpeg):
    plan = plan_from_dict(plan_dict)
    with tempfile.TemporaryDirectory(prefix="decks-g4-android-") as scratch:
        result = lm.measure_plan(
            plan,
            Path(outgoing),
            Path(incoming),
            Path(scratch),
            beat_model=beat_model,
            voice_model=voice_model,
            ffmpeg=ffmpeg,
        )
    window = render_window(plan)
    mask = lm.full_level_mask(plan, start_ms=window.pre_ms, total_ms=window.total_ms)
    return result | {"fullLevelMs": int(mask.sum()) * lm.STEP_MS}


_MODELS: dict[str, Any] = {}


def _init_worker() -> None:
    lm._init_worker()
    _MODELS.update(lm._MODELS)


def _job(job: tuple) -> tuple[str, dict]:
    key, kind, payload, ffmpeg = job
    try:
        if kind == "decks":
            result = measure_decks(Path(payload), _MODELS["beat"], _MODELS["voice"], ffmpeg)
        else:
            plan, outgoing, incoming = payload
            result = measure_android(plan, outgoing, incoming, _MODELS["beat"], _MODELS["voice"], ffmpeg)
    except Exception as error:  # one broken render must not stop the run
        import traceback

        result = {"error": f"{type(error).__name__}: {error}", "trace": traceback.format_exc()}
    return key, result


def job_key(*parts: Any) -> str:
    text = json.dumps([METRICS_VERSION, *parts], sort_keys=True)
    return hashlib.sha256(text.encode()).hexdigest()[:20]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--pairs", type=Path, required=True)
    parser.add_argument("--runs", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--music-root", required=True, metavar="HOST_PREFIX=LOCAL")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--jobs", type=int, default=4)
    args = parser.parse_args(argv)
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise SystemExit("ffmpeg is not installed")
    host, _, local = args.music_root.partition("=")

    def local_path(path: str) -> str:
        return local + path[len(host) :] if path.startswith(host) else path

    pairs = json.loads(args.pairs.read_text())["pairs"]
    reference = json.loads(args.reference.read_text())["pairs"]
    cache = args.output / "cache"
    cache.mkdir(parents=True, exist_ok=True)
    jobs: dict[str, tuple] = {}
    layout: dict[str, dict[str, str]] = {}
    for pair in pairs:
        layout[pair["id"]] = {}
        outgoing, incoming = local_path(pair["outgoingPath"]), local_path(pair["incomingPath"])
        for variant in DECKS_VARIANTS:
            run = args.runs / pair["id"] / variant
            if not (run / "report.json").is_file():
                continue
            report = json.loads((run / "report.json").read_text())
            key = job_key("decks", str(run), (run / "report.json").stat().st_mtime)
            jobs[key] = (key, "decks", str(run), ffmpeg)
            layout[pair["id"]][f"decks-{variant}"] = key
            if variant in ("v3", "v2"):
                plan = report.get("playedPlan") or report["askedPlan"]
                key = job_key("android", plan, outgoing, incoming)
                jobs[key] = (key, "android", (plan, outgoing, incoming), ffmpeg)
                layout[pair["id"]][f"android-{variant}"] = key
        listen = reference[pair["id"]]["listen"]
        key = job_key("android", listen, outgoing, incoming)
        jobs[key] = (key, "android", (listen, outgoing, incoming), ffmpeg)
        layout[pair["id"]]["android-listen"] = key
    todo = [job for key, job in jobs.items() if not (cache / f"{key}.json").is_file()]
    print(f"{len(todo)} of {len(jobs)} renders to measure", file=sys.stderr)
    if todo:
        with ProcessPoolExecutor(max_workers=args.jobs, initializer=_init_worker) as pool:
            for done, (key, result) in enumerate(pool.map(_job, todo), 1):
                (cache / f"{key}.json").write_text(json.dumps(result))
                print(f"  {done}/{len(todo)} {'error' if 'error' in result else 'ok'}", file=sys.stderr)
    measures = {
        pair_id: {
            name: json.loads((cache / f"{key}.json").read_text()) for name, key in names.items()
        }
        for pair_id, names in layout.items()
    }
    (args.output / "metrics.json").write_text(json.dumps(measures, indent=1))
    print(f"-> {args.output / 'metrics.json'}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
