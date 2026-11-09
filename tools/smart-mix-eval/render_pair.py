"""Render a Smart Mix transition offline, for listening (Smart Mix 3, SM0.PR2).

Given a plan and the two audio files, FFmpeg renders 30-60 s around the
transition the way the Android engine plays it:

- the outgoing track from ``outgoingCueMs - pre`` at its own tempo, until the
  end of the mix;
- the incoming track from its start position (with ``beatPhaseOffsetMs x
  incomingTempoRatio`` in beatmatch), time-stretched with ``atempo`` in
  beatmatch, from the start of the mix;
- equal power or DJ blend crossfade and loudness staging with ``volume``
  expressions, the same formulas as ``crate.smart_mix.evaluation``;
- in beatmatch with ``bassHandoff="balanced"``, a 150 Hz ``lowshelf`` at
  -24 dB on each deck, swapped around ``handoffProgress`` through
  ``asendcmd`` commands every 10 ms, like ``BassHandoffFilter``;
- 50 ms ``afade`` at both ends of the excerpt.

The incoming track keeps the mix tempo after the transition; Android ramps it
back to 1.0 over 4 s, which this render leaves out.

``stem="outgoing"`` or ``"incoming"`` renders one deck alone, on the same clock as
the mix and at unity gain (no crossfade, staging or bass shelf): what that deck
plays, for measurements that need each track separately (``listen_metrics.py``).

usage:
    render_pair.py --plan plan.json --outgoing a.flac --incoming b.flac --output pair.wav
    render_pair.py --report report.json --edge e0001 --outgoing a.flac ...
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from common import ensure_app_on_path

ensure_app_on_path()

from crate.smart_mix.evaluation import (  # noqa: E402
    BASS_CUT_DB,
    BASS_SHELF_HZ,
    BASS_SWAP_FRACTION,
    DJ_BLEND_ENTRY,
    DJ_BLEND_EXIT,
    bass_cut_db,
    bass_handoff_engaged,
    effective_curve,
    incoming_start_ms,
    incoming_tempo,
)
from crate.smart_mix.models import TransitionPlan  # noqa: E402

DEFAULT_SAMPLE_RATE = 44_100
MIN_RENDER_MS = 30_000
MAX_RENDER_MS = 60_000
CONTEXT_MS = 12_000
EDGE_FADE_SECONDS = 0.05
COMMAND_STEP_MS = 10
FRAME_SAMPLES = 256
SHELF_Q = 0.7071
INCOMING_MARGIN_SECONDS = 0.5
STEMS = ("outgoing", "incoming")

Stem = Literal["outgoing", "incoming"]


@dataclass(frozen=True, slots=True)
class RenderWindow:
    outgoing_start_ms: int
    pre_ms: int
    duration_ms: int
    post_ms: int

    @property
    def total_ms(self) -> int:
        return self.pre_ms + self.duration_ms + self.post_ms


@dataclass(frozen=True, slots=True)
class Filtergraph:
    graph: str
    commands: dict[str, str]
    outgoing_seconds: float
    incoming_start_seconds: float
    incoming_seconds: float


@dataclass(frozen=True, slots=True)
class RenderResult:
    output: Path
    duration_ms: int
    transition_start_ms: int
    transition_end_ms: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "output": str(self.output),
            "durationMs": self.duration_ms,
            "transitionStartMs": self.transition_start_ms,
            "transitionEndMs": self.transition_end_ms,
        }


def render_window(
    plan: TransitionPlan, *, seconds: float | None = None
) -> RenderWindow:
    """Excerpt bounds: 12 s each side of the mix, clamped to 30-60 s in total.

    The context is split evenly before and after the mix; when the outgoing
    cue is too early for the pre-roll, the remainder goes after it.
    """
    duration_ms = plan.duration_ms
    if seconds is not None:
        total_ms = round(seconds * 1_000)
    else:
        total_ms = min(MAX_RENDER_MS, max(MIN_RENDER_MS, duration_ms + 2 * CONTEXT_MS))
    total_ms = max(total_ms, duration_ms)
    pre_ms = min((total_ms - duration_ms) // 2, plan.outgoing_cue_ms)
    return RenderWindow(
        outgoing_start_ms=plan.outgoing_cue_ms - pre_ms,
        pre_ms=pre_ms,
        duration_ms=duration_ms,
        post_ms=total_ms - duration_ms - pre_ms,
    )


def build_filtergraph(
    plan: TransitionPlan,
    window: RenderWindow,
    sample_rate: int,
    *,
    stem: str | None = None,
) -> Filtergraph:
    """The ``-filter_complex`` graph and the bass handoff command files.

    Command files are referenced by bare name (``outgoing.cmd``,
    ``incoming.cmd``); ``render_pair`` writes them next to where FFmpeg runs.
    With ``stem`` the graph plays that deck alone at unity gain.
    """
    if stem is not None and stem not in STEMS:
        raise ValueError(f"Unknown stem {stem!r}")
    ratio = incoming_tempo(plan)
    curve = effective_curve(plan)
    handoff = bass_handoff_engaged(plan)
    pre_seconds = window.pre_ms / 1_000
    duration_seconds = window.duration_ms / 1_000
    total_samples = round(window.total_ms * sample_rate / 1_000)
    total_seconds = window.total_ms / 1_000
    prepare = (
        f"aresample={sample_rate},"
        "aformat=sample_fmts=fltp:channel_layouts=stereo,"
        "asetpts=PTS-STARTPTS"
    )
    frames = f"asetnsamples=n={FRAME_SAMPLES}:p=0"
    tempo = (
        f",atempo={ratio:.6g},asetpts=PTS-STARTPTS" if abs(ratio - 1.0) > 1e-9 else ""
    )
    outgoing_bass = incoming_bass = ""
    commands: dict[str, str] = {}
    if handoff and window.duration_ms > 0 and stem is None:
        outgoing_bass = _shelf("outgoing", initial_db=0.0)
        incoming_bass = _shelf("incoming", initial_db=BASS_CUT_DB)
        commands = _bass_commands(plan, window)
    outgoing_volume = _outgoing_gain_expression(
        pre_seconds, duration_seconds, curve, plan.outgoing_gain_db
    )
    incoming_volume = _incoming_gain_expression(
        duration_seconds, curve, plan.incoming_gain_db
    )
    pre_samples = round(window.pre_ms * sample_rate / 1_000)
    delay = f"adelay=delays={pre_samples}S:all=1"
    ending = (
        f"apad,atrim=end_sample={total_samples},"
        f"afade=t=in:st=0:d={EDGE_FADE_SECONDS},"
        f"afade=t=out:st={total_seconds - EDGE_FADE_SECONDS:.6f}:"
        f"d={EDGE_FADE_SECONDS}[mix]"
    )
    if stem == "outgoing":
        graph = f"[0:a]{prepare},{frames},{ending}"
    elif stem == "incoming":
        graph = f"[1:a]{prepare}{tempo},{frames},{delay},{ending}"
    else:
        graph = ";".join(
            (
                f"[0:a]{prepare},{frames}{outgoing_bass},"
                f"volume='{outgoing_volume}':eval=frame[outgoing]",
                f"[1:a]{prepare}{tempo},{frames}{incoming_bass},"
                f"volume='{incoming_volume}':eval=frame,{delay}[incoming]",
                "[outgoing][incoming]amix=inputs=2:normalize=0:duration=longest,"
                + ending,
            )
        )
    return Filtergraph(
        graph=graph,
        commands=commands,
        outgoing_seconds=(window.pre_ms + window.duration_ms) / 1_000,
        incoming_start_seconds=incoming_start_ms(plan) / 1_000,
        incoming_seconds=(window.duration_ms + window.post_ms) * ratio / 1_000
        + INCOMING_MARGIN_SECONDS,
    )


def render_pair(
    plan: TransitionPlan,
    outgoing_path: Path,
    incoming_path: Path,
    output_path: Path,
    *,
    seconds: float | None = None,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
    ffmpeg: str = "ffmpeg",
    stem: Stem | None = None,
) -> RenderResult:
    """Render the transition (or one deck's ``stem``) to a 16-bit stereo WAV."""
    window = render_window(plan, seconds=seconds)
    filtergraph = build_filtergraph(plan, window, sample_rate, stem=stem)
    output_path = Path(output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="smart-mix-render-") as scratch:
        for name, content in filtergraph.commands.items():
            (Path(scratch) / f"{name}.cmd").write_text(content)
        command = [
            ffmpeg,
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            f"{window.outgoing_start_ms / 1_000:.6f}",
            "-t",
            f"{filtergraph.outgoing_seconds:.6f}",
            "-i",
            str(Path(outgoing_path).resolve()),
            "-ss",
            f"{filtergraph.incoming_start_seconds:.6f}",
            "-t",
            f"{filtergraph.incoming_seconds:.6f}",
            "-i",
            str(Path(incoming_path).resolve()),
            "-filter_complex",
            filtergraph.graph,
            "-map",
            "[mix]",
            "-ac",
            "2",
            "-ar",
            str(sample_rate),
            "-c:a",
            "pcm_s16le",
            str(output_path),
        ]
        subprocess.run(command, cwd=scratch, check=True, timeout=300)
    return RenderResult(
        output=output_path,
        duration_ms=window.total_ms,
        transition_start_ms=window.pre_ms,
        transition_end_ms=window.pre_ms + window.duration_ms,
    )


def plan_from_dict(payload: Mapping[str, Any]) -> TransitionPlan:
    """A plan from its API form (``TransitionPlan.to_dict()``) or a report edge."""
    data = payload.get("plan", payload)
    return TransitionPlan(
        planner_version=int(data["plannerVersion"]),
        outgoing_track_entity_uid=str(data["outgoingTrackEntityUid"]),
        incoming_track_entity_uid=str(data["incomingTrackEntityUid"]),
        mode=data["mode"],
        duration_ms=int(data["durationMs"]),
        outgoing_cue_ms=int(data["outgoingCueMs"]),
        incoming_cue_ms=int(data["incomingCueMs"]),
        incoming_tempo_ratio=float(data["incomingTempoRatio"]),
        beat_phase_offset_ms=int(data["beatPhaseOffsetMs"]),
        handoff_progress=float(data["handoffProgress"]),
        outgoing_gain_db=float(data["outgoingGainDb"]),
        incoming_gain_db=float(data["incomingGainDb"]),
        curve=str(data["curve"]),
        bass_handoff=str(data["bassHandoff"]),
        confidence=float(data["confidence"]),
        fallback_reason=data.get("fallbackReason"),
    )


def _shelf(name: str, *, initial_db: float) -> str:
    return (
        f",asendcmd=f={name}.cmd,"
        f"lowshelf@{name}=f={BASS_SHELF_HZ:g}:t=q:w={SHELF_Q}:g={initial_db:g}"
    )


def _bass_commands(plan: TransitionPlan, window: RenderWindow) -> dict[str, str]:
    """Shelf gains every 10 ms through the swap, in each chain's own time.

    The outgoing chain starts ``pre`` before the mix; the incoming chain
    starts with the mix.
    """
    half_window = BASS_SWAP_FRACTION / 2.0
    centre = max(half_window, min(1.0 - half_window, plan.handoff_progress))
    first_ms = (centre - half_window) * window.duration_ms
    last_ms = (centre + half_window) * window.duration_ms
    outgoing_lines: list[str] = []
    incoming_lines: list[str] = []
    position_ms = first_ms
    while True:
        progress = min(position_ms, last_ms) / window.duration_ms
        outgoing_db, incoming_db = bass_cut_db(progress, plan.handoff_progress)
        mix_seconds = min(position_ms, last_ms) / 1_000
        outgoing_lines.append(
            f"{window.pre_ms / 1_000 + mix_seconds:.4f} [enter] "
            f"lowshelf@outgoing g {outgoing_db:.3f};"
        )
        incoming_lines.append(
            f"{mix_seconds:.4f} [enter] lowshelf@incoming g {incoming_db:.3f};"
        )
        if position_ms >= last_ms:
            break
        position_ms += COMMAND_STEP_MS
    return {
        "outgoing": "\n".join(outgoing_lines) + "\n",
        "incoming": "\n".join(incoming_lines) + "\n",
    }


def _crossfade_expression(progress: str, curve: str) -> str:
    if curve != "dj-blend":
        return progress
    entry = DJ_BLEND_ENTRY
    exit_ = DJ_BLEND_EXIT
    rising = _smoothstep(f"{progress}/{entry}")
    falling = _smoothstep(f"({progress}-{exit_})/{1 - exit_:g}")
    return (
        f"if(lte({progress},{entry}),0.5*{rising},"
        f"if(lt({progress},{exit_}),0.5,0.5+0.5*{falling}))"
    )


def _smoothstep(value: str) -> str:
    clipped = f"clip({value},0,1)"
    return f"({clipped}*{clipped}*(3-2*{clipped}))"


def _outgoing_gain_expression(
    start_seconds: float,
    duration_seconds: float,
    curve: str,
    gain_db: float,
) -> str:
    if duration_seconds <= 0:
        return f"if(lt(t,{start_seconds:.6f}),1,0)"
    gain = 10 ** (gain_db / 20)
    crossfade = _crossfade_expression("ld(0)", curve)
    return (
        f"st(0,clip((t-{start_seconds:.6f})/{duration_seconds:.6f},0,1));"
        f"st(1,{crossfade});"
        f"if(lt(t,{start_seconds:.6f}),1,"
        "if(gte(ld(1),1),0,cos(ld(1)*PI/2))"
        f"*(1+({gain:.6f}-1)*if(gte(ld(0),0.5),1,0.5-0.5*cos(PI*ld(0)/0.5))))"
    )


def _incoming_gain_expression(
    duration_seconds: float,
    curve: str,
    gain_db: float,
) -> str:
    if duration_seconds <= 0:
        return "1"
    gain = 10 ** (gain_db / 20)
    crossfade = _crossfade_expression("ld(0)", curve)
    return (
        f"st(0,clip(t/{duration_seconds:.6f},0,1));"
        f"st(1,{crossfade});"
        "sin(ld(1)*PI/2)"
        f"*(1+({gain:.6f}-1)*if(lte(ld(0),0.5),1,0.5+0.5*cos(PI*(ld(0)-0.5)/0.5)))"
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--plan", type=Path, help="plan JSON (API form)")
    source.add_argument("--report", type=Path, help="run_eval report.json")
    parser.add_argument("--edge", help="edge id in --report")
    parser.add_argument("--outgoing", type=Path, required=True)
    parser.add_argument("--incoming", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seconds", type=float)
    parser.add_argument("--sample-rate", type=int, default=DEFAULT_SAMPLE_RATE)
    args = parser.parse_args(argv)
    if args.report and not args.edge:
        parser.error("--edge is required with --report")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.plan:
        payload = json.loads(args.plan.read_text())
    else:
        report = json.loads(args.report.read_text())
        payload = next(
            (edge for edge in report["edges"] if edge["edgeId"] == args.edge), None
        )
        if payload is None:
            print(f"edge {args.edge} is not in {args.report}", file=sys.stderr)
            return 2
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        print("ffmpeg is not installed", file=sys.stderr)
        return 2
    result = render_pair(
        plan_from_dict(payload),
        args.outgoing,
        args.incoming,
        args.output,
        seconds=args.seconds,
        sample_rate=args.sample_rate,
        ffmpeg=ffmpeg,
    )
    print(json.dumps(result.to_dict()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
