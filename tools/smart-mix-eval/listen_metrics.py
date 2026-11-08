"""Automatic listening metrics of rendered transitions (Smart Mix 3, SM5).

Stands in for the blind listening of design §10 where nobody listens: each plan
is rendered offline with ``render_pair`` (the mix, and each deck alone on the same
clock) and the rendered audio is measured around the transition.

- **Beat agreement** (Beat This!, ``crate.smart_mix.beat_model``) on each deck's
  stem: for every outgoing beat inside the mix, the phase error to the nearest
  incoming beat, folded into one beat period. ``beatClashMs`` adds the time both
  decks are at full level (the harness's own definition: crossfade gain of half or
  more) while the beats disagree by more than ``PHASE_TOLERANCE_MS``. On the mix,
  ``mixIbiCv`` is the variation of the beat intervals inside the mix: flams and
  trainwrecks make them irregular.
- **Voice on voice** (YAMNet, ``crate.smart_mix.voice_model``) on each stem: time
  at full level with a voiced patch on both decks, a patch voiced from the byte
  threshold of the profiles (``VOCAL_THRESHOLD``, gate SG1b).
- **Loudness** (EBU R128 momentary and short-term loudness from FFmpeg's
  ``ebur128``) on the mix: the step between the short-term loudness before and
  after the mix, the momentary bump above and dip below both sides during it, and
  the steepest short-term change around it.

Plans are read from ``run_eval.py`` reports: ``NAME=report.json`` takes each
edge's served plan, ``NAME=report.json:deterministic`` the planner's own plan of
a refined report. Identical plans are measured once, and measurements are cached
by plan. Audio paths come from the database, read-only.

usage:
    listen_metrics.py --plans smart-mix-v2=out/v2/report.json \\
        --plans smart-mix-v3=out/ai/report.json:deterministic \\
        --plans smart-mix-v3+ai=out/ai/report.json \\
        --compare smart-mix-v3+ai:smart-mix-v3 --compare smart-mix-v3:smart-mix-v2 \\
        --output out/listen [--jobs 8]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np

from common import (
    display_path,
    ensure_app_on_path,
    git_commit,
    open_read_only_database,
    resolve_dsn,
    write_json,
)

ensure_app_on_path()

from crate.smart_mix.evaluation import (  # noqa: E402
    OVERLAP_FLOOR_GAIN,
    crossfade_gains,
    effective_curve,
)
from crate.smart_mix.models import TransitionPlan  # noqa: E402
from crate.smart_mix.vocals import VOCAL_THRESHOLD  # noqa: E402
from render_pair import plan_from_dict, render_pair  # noqa: E402

METRICS_VERSION = 1
STEP_MS = 10
# Beats further apart than this sound as a flam (about 1/16 beat at 150 BPM).
PHASE_TOLERANCE_MS = 25.0
# Loudness context each side of the mix.
CONTEXT_MS = 6_000
SLOPE_CONTEXT_MS = 3_000
SLOPE_SPAN_MS = 1_000
SILENCE_LUFS = -70.0
YAMNET_RATE = 16_000

LOWER_IS_BETTER = frozenset(
    {
        "beatClashMs",
        "phaseErrorMsMedian",
        "mixIbiCv",
        "voiceOnVoiceMs",
        "levelStepLuAbs",
        "bumpLu",
        "dipLu",
        "maxShortTermSlopeLuPerS",
    }
)
HIGHER_IS_BETTER = frozenset({"lockedShare"})
# A difference smaller than this counts as the same (a noise floor, not a JND).
SAME_WITHIN = {
    "beatClashMs": 100.0,
    "phaseErrorMsMedian": 5.0,
    "lockedShare": 0.05,
    "mixIbiCv": 0.02,
    "voiceOnVoiceMs": 480.0,
    "levelStepLuAbs": 0.5,
    "bumpLu": 0.5,
    "dipLu": 0.5,
    "maxShortTermSlopeLuPerS": 0.5,
}
METRICS = tuple(SAME_WITHIN)
LABELS = {
    "beatClashMs": "Beat clash at full level (ms)",
    "phaseErrorMsMedian": "Beat phase error, median (ms)",
    "lockedShare": "Beats within 25 ms",
    "mixIbiCv": "Mix beat interval variation (CV)",
    "voiceOnVoiceMs": "Voice on voice at full level (ms)",
    "levelStepLuAbs": "Loudness step across the mix, |LU|",
    "bumpLu": "Loudness bump during the mix (LU)",
    "dipLu": "Loudness dip during the mix (LU)",
    "maxShortTermSlopeLuPerS": "Steepest short-term change (LU/s)",
}


@dataclass(frozen=True, slots=True)
class PlanSelector:
    name: str
    report: Path
    deterministic: bool = False


def parse_selector(value: str) -> PlanSelector:
    name, _, rest = value.partition("=")
    if not name or not rest:
        raise ValueError("--plans takes NAME=report.json[:deterministic]")
    path, _, which = rest.partition(":")
    if which not in ("", "deterministic"):
        raise ValueError(f"Unknown plan selector {which!r}")
    return PlanSelector(name, Path(path), deterministic=which == "deterministic")


def plan_key(plan: Mapping[str, Any]) -> str:
    canonical = json.dumps(
        {"v": METRICS_VERSION, "plan": dict(plan)},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


# --- pure measurements -------------------------------------------------------


def full_level_mask(
    plan: TransitionPlan, *, start_ms: int, total_ms: int, step_ms: int = STEP_MS
) -> np.ndarray:
    """Render-time steps with both decks at half amplitude or more (crossfade only)."""
    centres = np.arange(0, total_ms, step_ms) + step_ms / 2
    mask = np.zeros(centres.size, dtype=bool)
    if plan.duration_ms <= 0:
        return mask
    curve = effective_curve(plan)
    progress = (centres - start_ms) / plan.duration_ms
    for index in np.flatnonzero((progress >= 0) & (progress < 1)):
        outgoing, incoming = crossfade_gains(float(progress[index]), curve)
        mask[index] = outgoing >= OVERLAP_FLOOR_GAIN and incoming >= OVERLAP_FLOOR_GAIN
    return mask


def beat_agreement(
    outgoing_beats_ms: Sequence[float],
    incoming_beats_ms: Sequence[float],
    *,
    overlap: tuple[int, int],
    full_level: np.ndarray,
    step_ms: int = STEP_MS,
    tolerance_ms: float = PHASE_TOLERANCE_MS,
) -> dict[str, Any]:
    """Phase of the incoming beats against the outgoing ones inside the mix."""
    outgoing = np.asarray(sorted(outgoing_beats_ms), dtype=np.float64)
    incoming = np.asarray(sorted(incoming_beats_ms), dtype=np.float64)
    empty = {
        "comparedBeats": 0,
        "phaseErrorMsMedian": None,
        "phaseErrorMsP90": None,
        "phaseErrorBeatMedian": None,
        "lockedShare": None,
        "beatClashMs": 0,
    }
    if outgoing.size < 2 or incoming.size == 0:
        return empty
    period = float(np.median(np.diff(outgoing)))
    if period <= 0:
        return empty
    start, end = overlap
    errors: list[float] = []
    clash_ms = 0.0
    for index, beat in enumerate(outgoing):
        if not start <= beat < end:
            continue
        nearest = incoming[np.argmin(np.abs(incoming - beat))]
        if abs(nearest - beat) > period:
            continue
        error = (nearest - beat + period / 2) % period - period / 2
        errors.append(abs(error))
        if abs(error) > tolerance_ms:
            following = (
                outgoing[index + 1] if index + 1 < outgoing.size else beat + period
            )
            first = max(0, int(beat // step_ms))
            last = min(full_level.size, int(following // step_ms))
            clash_ms += float(full_level[first:last].sum()) * step_ms
    if not errors:
        return empty
    values = np.asarray(errors)
    return {
        "comparedBeats": len(errors),
        "phaseErrorMsMedian": round(float(np.median(values)), 2),
        "phaseErrorMsP90": round(float(np.percentile(values, 90)), 2),
        "phaseErrorBeatMedian": round(float(np.median(values)) / period, 4),
        "lockedShare": round(float(np.mean(values <= tolerance_ms)), 4),
        "beatClashMs": round(clash_ms),
    }


def ibi_cv(beats_ms: Sequence[float], start_ms: float, end_ms: float) -> float | None:
    """Coefficient of variation of the beat intervals inside a window."""
    inside = np.asarray([b for b in sorted(beats_ms) if start_ms <= b < end_ms])
    if inside.size < 3:
        return None
    intervals = np.diff(inside)
    mean = float(intervals.mean())
    return None if mean <= 0 else round(float(intervals.std()) / mean, 4)


def voice_on_voice_ms(
    outgoing: tuple[np.ndarray, np.ndarray],
    incoming: tuple[np.ndarray, np.ndarray],
    full_level: np.ndarray,
    *,
    step_ms: int = STEP_MS,
    threshold: int = VOCAL_THRESHOLD,
) -> int:
    """Full-level time with a voiced patch (centres, bytes) on both decks."""
    times = np.arange(full_level.size) * step_ms + step_ms / 2

    def voiced(windows: tuple[np.ndarray, np.ndarray]) -> np.ndarray:
        centres = np.asarray(windows[0], dtype=np.float64)
        levels = np.asarray(windows[1])
        if centres.size == 0:
            return np.zeros(times.size, dtype=bool)
        nearest = np.clip(np.searchsorted(centres, times), 1, centres.size - 1)
        left = centres[nearest - 1]
        right = centres[nearest]
        index = np.where(times - left <= right - times, nearest - 1, nearest)
        if centres.size == 1:
            index = np.zeros(times.size, dtype=int)
        return levels[index] >= threshold

    both = full_level & voiced(outgoing) & voiced(incoming)
    return int(both.sum()) * step_ms


_EBUR128_LINE = re.compile(
    r"t:\s*(?P<t>[\d.]+)\s+TARGET:.*?M:\s*(?P<m>-?[\d.]+|-?inf|nan)\s+"
    r"S:\s*(?P<s>-?[\d.]+|-?inf|nan)"
)


def parse_ebur128(log: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Times (ms), momentary and short-term loudness from ``ebur128`` frame logs."""
    times, momentary, short_term = [], [], []
    for match in _EBUR128_LINE.finditer(log):
        times.append(round(float(match["t"]) * 1000))
        momentary.append(float(match["m"]))
        short_term.append(float(match["s"]))
    return (
        np.asarray(times, dtype=np.int64),
        np.asarray(momentary, dtype=np.float64),
        np.asarray(short_term, dtype=np.float64),
    )


def loudness_jumps(
    times_ms: np.ndarray,
    momentary: np.ndarray,
    short_term: np.ndarray,
    *,
    start_ms: int,
    end_ms: int,
    context_ms: int = CONTEXT_MS,
) -> dict[str, Any]:
    """Loudness around a mix: step across it, bump and dip during it, steepest change."""
    times = np.asarray(times_ms, dtype=np.float64)

    def median(values: np.ndarray, low: float, high: float) -> float | None:
        selected = values[(times >= low) & (times < high) & (values > SILENCE_LUFS)]
        return None if selected.size == 0 else float(np.median(selected))

    pre_s = median(short_term, start_ms - context_ms, start_ms)
    post_s = median(short_term, end_ms, end_ms + context_ms)
    pre_m = median(momentary, start_ms - context_ms, start_ms)
    post_m = median(momentary, end_ms, end_ms + context_ms)
    during = momentary[
        (times >= start_ms) & (times < end_ms) & (momentary > SILENCE_LUFS)
    ]
    sides = [value for value in (pre_m, post_m) if value is not None]
    step = None if pre_s is None or post_s is None else post_s - pre_s
    window = (times >= start_ms - SLOPE_CONTEXT_MS) & (
        times < end_ms + SLOPE_CONTEXT_MS
    )
    slopes = []
    frame_ms = float(np.median(np.diff(times))) if times.size > 1 else 100.0
    lag = max(1, round(SLOPE_SPAN_MS / max(1.0, frame_ms)))
    for index in np.flatnonzero(window):
        if index - lag < 0:
            continue
        before, after = short_term[index - lag], short_term[index]
        if before > SILENCE_LUFS and after > SILENCE_LUFS:
            slopes.append(abs(after - before))
    return {
        "preShortTermLufs": _round(pre_s, 2),
        "postShortTermLufs": _round(post_s, 2),
        "levelStepLu": _round(step, 2),
        "levelStepLuAbs": _round(None if step is None else abs(step), 2),
        "bumpLu": _round(
            float(during.max()) - max(sides) if during.size and sides else None, 2
        ),
        "dipLu": _round(
            min(sides) - float(during.min()) if during.size and sides else None, 2
        ),
        "maxShortTermSlopeLuPerS": _round(
            max(slopes) * 1000 / SLOPE_SPAN_MS if slopes else None, 2
        ),
    }


# --- rendering and models -----------------------------------------------------


def measure_plan(
    plan: TransitionPlan,
    outgoing_path: Path,
    incoming_path: Path,
    workdir: Path,
    *,
    beat_model: Any,
    voice_model: Any,
    ffmpeg: str = "ffmpeg",
    keep_audio: bool = False,
) -> dict[str, Any]:
    """Render one plan (mix and stems) and measure it; see the module docstring."""
    from crate.smart_mix.beat_model import track_beats
    from crate.smart_mix.vocals import voice_window_bytes

    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    paths = {name: workdir / f"{name}.wav" for name in ("mix", "outgoing", "incoming")}
    try:
        result = render_pair(
            plan, outgoing_path, incoming_path, paths["mix"], ffmpeg=ffmpeg
        )
        for stem in ("outgoing", "incoming"):
            render_pair(
                plan,
                outgoing_path,
                incoming_path,
                paths[stem],
                ffmpeg=ffmpeg,
                stem=stem,
            )
        start, end = result.transition_start_ms, result.transition_end_ms
        mask = full_level_mask(plan, start_ms=start, total_ms=result.duration_ms)
        beats = {}
        voices = {}
        for name, path in paths.items():
            audio, rate = _load_mono(path)
            track = track_beats(audio, rate, model=beat_model)
            beats[name] = list(track.beats_ms) if track else []
            if name != "mix":
                windows = voice_model.voice_windows(_resample(audio, rate, YAMNET_RATE))
                levels = np.frombuffer(
                    voice_window_bytes(windows).scores, dtype=np.uint8
                )
                voices[name] = (np.asarray(windows.centres_ms), levels)
        loudness = loudness_jumps(
            *_ebur128(paths["mix"], ffmpeg), start_ms=start, end_ms=end
        )
    finally:
        if not keep_audio:
            for path in paths.values():
                path.unlink(missing_ok=True)
    return {
        "mode": str(plan.mode),
        "curve": effective_curve(plan),
        "durationMs": plan.duration_ms,
        "render": result.to_dict() | {"output": None},
        **beat_agreement(
            beats["outgoing"], beats["incoming"], overlap=(start, end), full_level=mask
        ),
        "mixIbiCv": ibi_cv(beats["mix"], start, end),
        "voiceOnVoiceMs": voice_on_voice_ms(
            voices["outgoing"], voices["incoming"], mask
        ),
        **loudness,
    }


def _load_mono(path: Path) -> tuple[np.ndarray, int]:
    import soundfile

    audio, rate = soundfile.read(str(path), dtype="float32", always_2d=True)
    return np.ascontiguousarray(audio.mean(axis=1)), int(rate)


def _resample(audio: np.ndarray, rate: int, target: int) -> np.ndarray:
    if rate == target:
        return audio
    import soxr

    return np.asarray(soxr.resample(audio, rate, target), dtype=np.float32)


def _ebur128(path: Path, ffmpeg: str) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    completed = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-nostats",
            "-nostdin",
            "-i",
            str(path),
            "-filter_complex",
            "ebur128=framelog=info",
            "-f",
            "null",
            "-",
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=300,
    )
    return parse_ebur128(completed.stderr)


# --- summaries ----------------------------------------------------------------


def summarize_variant(
    measures: Mapping[str, Mapping[str, Any]],
    edges: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    """Mean, p50 and p95 of every metric, overall, by tempo band and by mode."""

    def stats(edge_ids: Iterable[str]) -> dict[str, Any]:
        selected = [measures[edge] for edge in edge_ids]
        return {
            metric: _stats(item.get(metric) for item in selected) for metric in METRICS
        }

    groups: dict[str, dict[str, list[str]]] = {
        "byTempoBand": defaultdict(list),
        "byMode": defaultdict(list),
    }
    for edge in measures:
        info = edges.get(edge, {})
        groups["byTempoBand"][str(info.get("tempoBand"))].append(edge)
        mode = info.get("mode") or measures[edge].get("mode")
        groups["byMode"][str(mode)].append(edge)
    return {
        "edges": len(measures),
        "overall": stats(measures),
        **{
            group: {name: stats(ids) for name, ids in sorted(items.items())}
            for group, items in groups.items()
        },
    }


def compare_variants(
    current: Mapping[str, Mapping[str, Any]],
    baseline: Mapping[str, Mapping[str, Any]],
    edges: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    """Current minus baseline on the edges both measured: mean delta and how many
    edges got better, stayed the same (within ``SAME_WITHIN``) or got worse."""
    paired = sorted(set(current) & set(baseline))

    def deltas(edge_ids: Sequence[str]) -> dict[str, Any]:
        result = {}
        for metric in METRICS:
            values = [
                (current[edge].get(metric), baseline[edge].get(metric))
                for edge in edge_ids
            ]
            pairs = [(a, b) for a, b in values if a is not None and b is not None]
            differences = [a - b for a, b in pairs]
            sign = -1.0 if metric in LOWER_IS_BETTER else 1.0
            within = SAME_WITHIN[metric]
            result[metric] = {
                "n": len(pairs),
                "meanDelta": _round(float(np.mean(differences)), 4)
                if differences
                else None,
                "better": sum(1 for d in differences if sign * d > within),
                "same": sum(1 for d in differences if abs(d) <= within),
                "worse": sum(1 for d in differences if sign * d < -within),
            }
        return result

    by_band: dict[str, list[str]] = defaultdict(list)
    for edge in paired:
        by_band[str(edges.get(edge, {}).get("tempoBand"))].append(edge)
    changed = [
        edge
        for edge in paired
        if current[edge].get("planKey") != baseline[edge].get("planKey")
    ]
    return {
        "pairedEdges": len(paired),
        "changedPlans": len(changed),
        "overall": deltas(paired),
        "changed": deltas(changed),
        "byTempoBand": {name: deltas(ids) for name, ids in sorted(by_band.items())},
    }


def _stats(values: Iterable[Any]) -> dict[str, Any]:
    collected = [float(value) for value in values if value is not None]
    if not collected:
        return {"n": 0, "mean": None, "p50": None, "p95": None}
    return {
        "n": len(collected),
        "mean": _round(float(np.mean(collected)), 4),
        "p50": _round(float(np.percentile(collected, 50)), 4),
        "p95": _round(float(np.percentile(collected, 95)), 4),
    }


def _round(value: float | None, digits: int) -> float | None:
    return None if value is None else round(float(value), digits)


def render_markdown(result: Mapping[str, Any]) -> str:
    lines = [
        "# Smart Mix listening metrics",
        "",
        f"- Created {result['meta']['createdAt']} at commit"
        f" `{str(result['meta'].get('gitCommit') or '?')[:12]}`",
        f"- Beat tracker: {result['meta'].get('beatTracker')}; voice: YAMNet"
        f" (byte >= {VOCAL_THRESHOLD}); loudness: FFmpeg ebur128",
        f"- Phase tolerance {PHASE_TOLERANCE_MS:.0f} ms; full level = crossfade gain"
        f" >= {OVERLAP_FLOOR_GAIN}",
        "",
    ]
    for name, variant in result["variants"].items():
        summary = variant["summary"]
        lines += [
            f"## {name}",
            "",
            f"{summary['edges']} edges, {variant['uniquePlans']} distinct plans;"
            f" source `{variant['source']}`.",
            "",
            "| Metric | n | mean | p50 | p95 | beatmatch n | beatmatch mean |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
        beatmatch = summary["byMode"].get("beatmatch", {})
        for metric in METRICS:
            values = summary["overall"][metric]
            bm = beatmatch.get(metric, {"n": 0, "mean": None})
            lines.append(
                f"| {LABELS[metric]} | {values['n']} | {_cell(values['mean'])} |"
                f" {_cell(values['p50'])} | {_cell(values['p95'])} | {bm['n']} |"
                f" {_cell(bm['mean'])} |"
            )
        lines.append("")
    for comparison in result["comparisons"]:
        lines += [
            f"## {comparison['current']} minus {comparison['baseline']}",
            "",
            f"{comparison['pairedEdges']} paired edges, {comparison['changedPlans']}"
            " with a different plan. Better/same/worse count edges; same means"
            " within the noise floor of each metric.",
            "",
            "| Metric | n | mean delta | better | same | worse |"
            " changed: mean delta | changed: better | changed: worse |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
        for metric in METRICS:
            overall = comparison["overall"][metric]
            changed = comparison["changed"][metric]
            lines.append(
                f"| {LABELS[metric]} | {overall['n']} | {_cell(overall['meanDelta'], signed=True)} |"
                f" {overall['better']} | {overall['same']} | {overall['worse']} |"
                f" {_cell(changed['meanDelta'], signed=True)} | {changed['better']} |"
                f" {changed['worse']} |"
            )
        lines.append("")
    return "\n".join(lines)


def _cell(value: float | None, *, signed: bool = False) -> str:
    if value is None:
        return "n/a"
    text = f"{value:,.3f}" if abs(value) < 10 else f"{value:,.0f}"
    return f"+{text}" if signed and value > 0 else text


# --- command line -------------------------------------------------------------

_MODELS: dict[str, Any] = {}


def _init_worker() -> None:
    import torch

    from crate.smart_mix.beat_model import load_beat_model
    from crate.smart_mix.voice_model import load_voice_model

    torch.set_num_threads(1)
    _MODELS["beat"] = load_beat_model()
    _MODELS["voice"] = load_voice_model()
    if _MODELS["beat"] is None or _MODELS["voice"] is None:
        raise RuntimeError("Beat This! and YAMNet need torch and their weights")


def _measure_job(
    job: tuple[str, dict[str, Any], str, str, str, bool],
) -> tuple[str, dict]:
    key, plan, outgoing, incoming, ffmpeg, keep_audio = job
    with tempfile.TemporaryDirectory(prefix="sm5-listen-") as scratch:
        workdir = Path(scratch)
        try:
            metrics = measure_plan(
                plan_from_dict(plan),
                Path(outgoing),
                Path(incoming),
                workdir,
                beat_model=_MODELS["beat"],
                voice_model=_MODELS["voice"],
                ffmpeg=ffmpeg,
                keep_audio=keep_audio,
            )
        except Exception as error:  # one broken render must not stop the run
            metrics = {"error": type(error).__name__}
    return key, metrics


def load_plans(selector: PlanSelector) -> dict[str, dict[str, Any]]:
    """Edge id -> {plan, tempoBand, genre} of a report, served or deterministic."""
    report = json.loads(selector.report.read_text())
    plans = {}
    for edge in report["edges"]:
        if selector.deterministic:
            if "deterministic" not in edge:
                raise ValueError(f"{selector.report} has no deterministic plans")
            plan = edge["deterministic"]["plan"]
        else:
            plan = edge["plan"]
        plans[str(edge["edgeId"])] = {
            "plan": plan,
            "tempoBand": edge.get("tempoBand"),
            "genre": edge.get("genreRoot") or edge.get("rootGenre"),
        }
    return plans


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("--dsn", help="postgresql:// URL (or SMART_MIX_EVAL_DSN)")
    parser.add_argument("--plans", action="append", required=True, type=parse_selector)
    parser.add_argument(
        "--compare", action="append", default=[], metavar="CURRENT:BASELINE"
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--limit", type=int, help="measure only the first N edges")
    parser.add_argument(
        "--music-root", default="/music=/music", metavar="DB_PREFIX=LOCAL"
    )
    parser.add_argument("--keep-audio", action="store_true")
    parser.add_argument("--allow-remote-database", action="store_true")
    args = parser.parse_args(argv)
    args.dsn = resolve_dsn(args.dsn)
    if not args.dsn:
        parser.error("--dsn or SMART_MIX_EVAL_DSN is required")
    names = {selector.name for selector in args.plans}
    for pair in args.compare:
        current, _, baseline = pair.partition(":")
        if current not in names or baseline not in names:
            parser.error(f"--compare {pair}: both sides must be --plans names")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    # TEST_GAP: the database, process pool and real models run against the dev
    # library (see README); the measurements and summaries are tested.
    args = parse_args(argv)
    open_read_only_database(args.dsn, allow_remote=args.allow_remote_database)
    from crate.db.queries.browse_media_track_lookup import get_track_path_by_entity_uid
    from crate.smart_mix.beat_model import beat_tracker_name

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        print("ffmpeg is not installed", file=sys.stderr)
        return 2
    variants = {selector.name: load_plans(selector) for selector in args.plans}
    if args.limit is not None:
        keep = sorted(next(iter(variants.values())))[: args.limit]
        variants = {
            name: {edge: plans[edge] for edge in keep if edge in plans}
            for name, plans in variants.items()
        }
    prefix, _, local = args.music_root.partition("=")
    uids = sorted(
        {
            item["plan"][key]
            for plans in variants.values()
            for item in plans.values()
            for key in ("outgoingTrackEntityUid", "incomingTrackEntityUid")
        }
    )
    paths = {}
    for uid in uids:
        stored = get_track_path_by_entity_uid(uid)
        if stored:
            paths[uid] = (
                local + stored[len(prefix) :] if stored.startswith(prefix) else stored
            )
    cache = args.output / "plans"
    cache.mkdir(parents=True, exist_ok=True)
    jobs: dict[str, tuple] = {}
    for plans in variants.values():
        for item in plans.values():
            plan = item["plan"]
            key = plan_key(plan)
            outgoing = paths.get(plan["outgoingTrackEntityUid"])
            incoming = paths.get(plan["incomingTrackEntityUid"])
            if key in jobs or (cache / f"{key}.json").is_file():
                continue
            if not outgoing or not incoming:
                write_json(cache / f"{key}.json", {"error": "missing_audio"})
                continue
            jobs[key] = (key, plan, outgoing, incoming, ffmpeg, args.keep_audio)
    print(f"{len(jobs)} plans to render and measure", file=sys.stderr)
    if jobs:
        with ProcessPoolExecutor(
            max_workers=args.jobs, initializer=_init_worker
        ) as pool:
            for done, (key, metrics) in enumerate(
                pool.map(_measure_job, jobs.values()), 1
            ):
                write_json(cache / f"{key}.json", metrics)
                if done % 25 == 0:
                    print(f"  {done}/{len(jobs)}", file=sys.stderr)
    measured: dict[str, dict[str, dict[str, Any]]] = {}
    result_variants = {}
    for selector in args.plans:
        plans = variants[selector.name]
        measures = {}
        edges = {}
        for edge, item in plans.items():
            key = plan_key(item["plan"])
            metrics = json.loads((cache / f"{key}.json").read_text())
            if "error" in metrics:
                continue
            measures[edge] = {**metrics, "planKey": key}
            edges[edge] = {"tempoBand": item["tempoBand"], "mode": metrics.get("mode")}
        measured[selector.name] = measures
        result_variants[selector.name] = {
            "source": display_path(selector.report)
            + (":deterministic" if selector.deterministic else ""),
            "uniquePlans": len({plan_key(item["plan"]) for item in plans.values()}),
            "failed": len(plans) - len(measures),
            "summary": summarize_variant(measures, edges),
            "edges": measures,
        }
    edge_info = {
        edge: {"tempoBand": item["tempoBand"]}
        for plans in variants.values()
        for edge, item in plans.items()
    }
    comparisons = []
    for pair in args.compare:
        current, _, baseline = pair.partition(":")
        comparisons.append(
            {
                "current": current,
                "baseline": baseline,
                **compare_variants(measured[current], measured[baseline], edge_info),
            }
        )
    result = {
        "meta": {
            "createdAt": datetime.now(UTC).isoformat(),
            "gitCommit": git_commit(),
            "beatTracker": beat_tracker_name(),
            "metricsVersion": METRICS_VERSION,
            "phaseToleranceMs": PHASE_TOLERANCE_MS,
            "sameWithin": SAME_WITHIN,
        },
        "variants": result_variants,
        "comparisons": comparisons,
    }
    write_json(args.output / "listen.json", result)
    (args.output / "listen.md").write_text(render_markdown(result))
    print(f"-> {args.output}", file=sys.stderr)
    return 0


__all__ = [
    "LOWER_IS_BETTER",
    "PlanSelector",
    "beat_agreement",
    "compare_variants",
    "full_level_mask",
    "ibi_cv",
    "loudness_jumps",
    "measure_plan",
    "parse_ebur128",
    "parse_selector",
    "plan_key",
    "summarize_variant",
    "voice_on_voice_ms",
]


if __name__ == "__main__":
    raise SystemExit(main())
