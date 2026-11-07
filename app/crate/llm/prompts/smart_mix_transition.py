"""Prompt and response of the Smart Mix transition refinement (SM4.PR1, design §8).

The model is a DJ choosing one transition from the menu the v3 planner computed
(SM3-D1). The input is compact JSON with numbers and structural labels only
(SM3-D6): tempo, Camelot key, energy, danceability, valence, loudness, the
phrases around the mix window with their energy per bar and voice, the set
history and the candidates. Never a title, artist, album, path, track or profile
identifier, user or address. The genre slug goes only when Settings allow it.

``SmartMixRefinementResponse`` is closed (``extra="forbid"``) and bounded; the
server validates the choice again (``crate.smart_mix.refinement``). Nothing here
logs or stores the prompt or the answer.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from crate.smart_mix.models import (
    VOCAL_THRESHOLD,
    TrackMixProfile,
    TransitionCandidate,
    TransitionContext,
)
from crate.smart_mix.policy import PLANNER_POLICY_V3, PlannerPolicy
from crate.smart_mix.refinement import allowed_bass_handoffs, phrase_windows

PROMPT_VERSION = "sm3-refine-3"
_BEATS_PER_BAR = 4

SYSTEM_PROMPT = """\
You are a DJ. A planner computed valid transitions between two tracks \
("candidates"). Pick one and optionally adjust it; you cannot invent times, \
tempos or gains, the server rebuilds and checks the plan.

Input: "out" (playing) and "in" (next) tracks: bpm, bpmConf, stability, key \
(Camelot), energy, dance, valence (0-100), lufs, genre, and phrases (last of \
"out", first of "in"): kind, bars, energy, voice (1 = vocals), curve (energy per \
bar, 0-9). "history": previous transitions, oldest first. "rules": balanced bass \
and blends over 12 s allowed, phrase lengths. Candidate "i": phrase indexes \
"out"/"in", bars (null = preferred), sec, mode, bass, bassOk (the bass_handoff \
answers it accepts), curve, tempo change %, score and parts (alignment, energy, \
harmony, stability, bass, position, vocal clash; 0-100).

Answer JSON: candidate_index; outgoing_phrase_shift, incoming_phrase_shift \
(-1/0/1: a phrase earlier or later); length_step (-1/0/1 in "rules" lengths); \
bass_handoff (one of the chosen candidate's bassOk; balanced only on a \
beatmatch); reason (one sentence); confidence (0-1, below 0.55 the planner's \
choice stays); notes (optional).

Guidance: the score already weighs phrase alignment, energy continuity, key, \
stability, bass and vocal overlap, so candidate 0 is the best by those. Choose \
another only for what the score cannot see: genre conventions (techno and house \
like long beatmatched phrase-aligned blends, hip-hop and pop short mixes, drum \
and bass double drops) and the history's energy arc.\
"""


Shift = Literal[-1, 0, 1]
Note = Annotated[str, Field(max_length=120)]


def _compact_schema(schema: dict[str, Any]) -> None:
    """Titles and descriptions only add tokens: the system prompt explains fields."""
    schema.pop("title", None)
    schema.pop("description", None)
    for field in schema.get("properties", {}).values():
        field.pop("title", None)


# The model's choice (design §8); crate.smart_mix.refinement validates it again.
class SmartMixRefinementResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_extra=_compact_schema)

    candidate_index: int = Field(ge=0, le=PLANNER_POLICY_V3.max_candidates - 1)
    outgoing_phrase_shift: Shift
    incoming_phrase_shift: Shift
    length_step: Shift
    bass_handoff: Literal["keep", "none", "balanced"]
    reason: str = Field(max_length=240)
    confidence: float = Field(ge=0.0, le=1.0)
    notes: list[Note] = Field(default_factory=list, max_length=4)


def _fingerprint(value: Any) -> str:
    # The runtime hashes the response schema the same way (crate.ai.runtime._hash).
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


SCHEMA_FINGERPRINT = _fingerprint(SmartMixRefinementResponse.model_json_schema())


def build_refinement_input(
    outgoing: TrackMixProfile,
    incoming: TrackMixProfile,
    candidates: Sequence[TransitionCandidate],
    *,
    policy: PlannerPolicy,
    context: TransitionContext,
    genres: tuple[str | None, str | None] = (None, None),
    send_genre: bool = True,
    set_history: Sequence[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    """The numeric input of one edge; ``genres`` go only with ``send_genre``."""
    outgoing_window, incoming_window = phrase_windows(outgoing, incoming, candidates)
    outgoing_genre, incoming_genre = genres if send_genre else (None, None)
    payload: dict[str, Any] = {
        "v": PROMPT_VERSION,
        "out": _track(outgoing, outgoing_window, outgoing_genre),
        "in": _track(incoming, incoming_window, incoming_genre),
        "rules": {
            "bass": context.allow_bass_handoff,
            "longBlend": context.allow_long_beatmatch,
            "lengths": sorted(policy.phrase_lengths),
        },
    }
    history = [
        {
            "mode": str(entry["mode"]),
            "bars": int(entry["durationBars"]),
            "dEnergy": round(float(entry["deltaEnergy"]) * 100),
        }
        for entry in set_history
    ]
    if history:
        payload["history"] = history
    payload["candidates"] = [
        _candidate(candidate, outgoing_window, incoming_window, context)
        for candidate in candidates
    ]
    return payload


def render_refinement_prompt(payload: Mapping[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


def _percent(value: float | None) -> int | None:
    return None if value is None else round(float(value) * 100)


def _track(
    profile: TrackMixProfile, window: range, genre: str | None
) -> dict[str, Any]:
    values: dict[str, Any] = {
        "bpm": None if profile.bpm is None else round(profile.bpm, 2),
        "bpmConf": _percent(profile.bpm_confidence),
        "stability": _percent(profile.tempo_stability),
        "key": profile.camelot,
        "energy": _percent(profile.global_energy),
        "dance": _percent(profile.danceability),
        "valence": _percent(profile.valence),
        "lufs": None
        if profile.integrated_lufs is None
        else round(profile.integrated_lufs, 1),
        "genre": genre,
    }
    track = {key: value for key, value in values.items() if value is not None}
    track["phrases"] = [_phrase(profile, index) for index in window]
    return track


def _phrase(profile: TrackMixProfile, index: int) -> dict[str, Any]:
    phrases = profile.phrases or ()
    phrase = phrases[index]
    item: dict[str, Any] = {
        "kind": phrase.kind,
        "bars": phrase.bars,
        "energy": _percent(phrase.energy),
    }
    voices = profile.vocal_presence
    if voices is not None and len(voices) == len(phrases):
        item["voice"] = int(voices[index] >= VOCAL_THRESHOLD)
    curve = profile.energy_curve
    if curve:
        # The curve holds one byte per bar from the first downbeat; a phrase starts
        # on a downbeat, so its bar is its beat over four.
        first = phrase.start_beat // _BEATS_PER_BAR
        last = first + phrase.bars
        if index + 1 < len(phrases):
            last = min(last, phrases[index + 1].start_beat // _BEATS_PER_BAR)
        digits = "".join(str(level * 10 // 256) for level in curve[first:last])
        if digits:
            item["curve"] = digits
    return item


def _candidate(
    candidate: TransitionCandidate,
    outgoing_window: range,
    incoming_window: range,
    context: TransitionContext,
) -> dict[str, Any]:
    breakdown = candidate.breakdown
    parts = [
        breakdown.alignment,
        breakdown.energy,
        breakdown.harmonic,
        breakdown.stability,
        breakdown.bass,
        breakdown.position,
    ]
    if breakdown.vocal is not None:
        parts.append(breakdown.vocal)
    return {
        "i": candidate.index,
        "out": _position(candidate.outgoing_phrase, outgoing_window),
        "in": _position(candidate.incoming_phrase, incoming_window),
        "bars": candidate.length_bars,
        "sec": round(candidate.duration_ms / 1000, 1),
        "mode": str(candidate.mode),
        "bass": candidate.bass_handoff,
        "bassOk": list(allowed_bass_handoffs(candidate, context)),
        "curve": candidate.curve,
        "tempo": round((candidate.incoming_tempo_ratio - 1.0) * 100, 1),
        "score": _percent(candidate.score),
        "parts": [_percent(part) for part in parts],
    }


def _position(index: int | None, window: range) -> int | None:
    return None if index is None or index not in window else index - window.start


__all__ = [
    "PROMPT_VERSION",
    "SCHEMA_FINGERPRINT",
    "SYSTEM_PROMPT",
    "SmartMixRefinementResponse",
    "build_refinement_input",
    "render_refinement_prompt",
]
