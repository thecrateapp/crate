"""Candidate menu of the Smart Mix v3 planner (SM3-D3).

``plan_transition_candidates`` returns up to ``policy.max_candidates`` complete,
valid plans for one edge, best first. The v3 plan is the first one; SM4 hands the
whole menu to a model that may pick another.

With stored phrases on both tracks (analyzer v7), a candidate mixes from the start
of one of the last ``outgoing_phrase_choices`` outgoing phrases that admit a mix,
into the start of one of the first ``incoming_phrase_choices`` incoming phrases.
In beatmatch it lasts one of ``policy.phrase_lengths`` bars of the outgoing tempo or
the context's preferred duration; a phrase length longer than the preferred
duration needs a long blend (longer than ``maximum_transition_ms``, allowed by the
context), as in v2. In a crossfade (v2 decided the pair cannot be beatmatched) it
keeps the preferred duration, because the incoming bars do not follow the outgoing
ones. Each geometry is tried with the bass handoff on (when the context allows it)
and off, and with both curves when the mix is short enough for either; a long blend
is always a DJ blend. v2's own plan joins the menu: it can mix in the tail after
the last phrase or over the incoming lead-in, which no phrase start reaches. Every
plan goes through ``TransitionPlan`` and must pass the planner policy
(``crate.smart_mix.evaluation.policy_violations``), so the limits of v2 hold for
every candidate.

The score adds weighted components in [0, 1] (``policy.candidate_weights``, whose
first six weights add up to 1):

- alignment: the share of the four mix boundaries (outgoing cue and end, incoming
  start and end) within an eighth of a beat of a phrase boundary;
- energy: one minus the energy step between the phrases the decks play at the
  handoff (the profile's outro and intro energies when the handoff falls outside
  the phrases), over ``candidate_energy_step_limit``;
- harmonic: with compatible keys longer blends score higher, with incompatible keys
  less time with both decks at full level does; unknown keys are neutral;
- stability: long blends lose with less tempo stability and more time stretch;
- bass: one with the bass handoff, otherwise the share of the mix without both
  basses at full level;
- position: one minus the music the mix leaves out, over
  ``candidate_position_limit_ms``: the outgoing phrases after the mix that are not
  an outro and the incoming phrases before it that are not an intro;

and subtracts ``weights.vocal`` times the time with voice on both decks at full
level over ``candidate_vocal_reference_ms`` (the longest blend, so the penalty
grows with every second), when both profiles carry the voice per phrase (SM3-D13; a
phrase has voice from ``VOCAL_THRESHOLD``). Candidates are ranked on that score
before it is clamped to [0, 1]; ties keep the later outgoing phrase, the earlier
incoming phrase, the longer mix, the bass handoff and v2's curve.

With ``policy.stems_layer``, a stems layer on both profiles (Smart Mix Stems,
STEM-D5), a Crate Decks request and an edge of the beatmatch family
(``stems_layer_applies``: ``context.source`` in ``policy.stems_layer_sources`` and both
tracks' gate priors known and at least ``policy.stems_layer_min_genre_prior``, STEM-G1),
on the phrase menu:

- the vocal penalty counts the phrases where the vocal stem or YAMNet's stored byte
  hears voice (rules revision 3; the stem alone without YAMNet's bytes);
- the bass component is one minus the share of the mix with both basses at full
  level (crossfade and bass handoff) while both phrases have a bassline, so a mix
  where one side has none scores like a handoff;
- ``weights.drums_only_entry`` times the share of the mix before the handoff where
  the incoming plays a phrase with drums and neither bass nor vocals is added;
- ``weights.vocal_free_exit`` times the share of the mix where the outgoing plays a
  phrase without vocals is added.

Vocals in the last two terms follow the same either-detector rule. The terms go in
``CandidateScore.stems``. Without stems on both tracks, for another client or outside
the beatmatch family, every candidate and score is the one of rules revision 1.

Without phrases on both tracks (profiles before v7, tracks the analyzer could not
segment, segmentations under ``minimum_structure_confidence``) the menu is the bar
heuristic of v2: its own plan first, then the other phrase-length windows it would
consider and their bass and curve variants. The automatic album, manual skips and
missing profiles keep v2's single plan.

Only what the plan API loads is read: no beat grid, so the harness and the API plan
alike. Every function is pure and deterministic.
"""

from __future__ import annotations

import math
import re
from bisect import bisect_left, bisect_right
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from functools import cache

from crate.smart_mix.camelot import CamelotRelationship, camelot_relationship
from crate.smart_mix.evaluation import (
    OVERLAP_FLOOR_DB,
    OVERLAP_FLOOR_GAIN,
    PHRASE_TOLERANCE_BEATS,
    bass_cut_db,
    crossfade_gains,
    policy_violations,
)
from crate.smart_mix.models import (
    VOCAL_THRESHOLD,
    CandidateScore,
    StemScore,
    StemsLayer,
    TrackMixProfile,
    TransitionCandidate,
    TransitionContext,
    TransitionFallbackReason,
    TransitionMode,
    TransitionPlan,
)
from crate.smart_mix.planner import (
    _beat_phase_offset,
    _beatmatch_fallback_reason,
    _cue_stability,
    _cue_tempo_ratio,
    _fit_window,
    _loudness_delta,
    _minimum_beatmatch_ms,
    _outro_beat,
    _playable_end_ms,
    _round_score,
    _safe_deck_gain,
    _transition_duration,
    plan_transition,
    score_compatibility,
)
from crate.smart_mix.policy import PLANNER_POLICY_V3, PlannerPolicy
from crate.smart_mix.transition_fit import genre_beatmatch_prior

_BEATS_PER_BAR = 4
_HANDOFF_PROGRESS = 0.5
_CURVES = ("equal-power", "dj-blend")
_DIGITS = 6


Span = tuple[float, float]


@dataclass(frozen=True, slots=True)
class _StemSpans:
    """Where a profile's stems layer says each stem plays, on its phrases' spans."""

    vocals: tuple[Span, ...]
    bass: tuple[Span, ...]
    drums_only: tuple[Span, ...]
    vocal_free: tuple[Span, ...]


@dataclass(frozen=True, slots=True)
class _Timeline:
    """A profile's phrases on its own time axis, in milliseconds.

    ``cut_suffix[i]`` is the music of phrases ``i..`` that is not an outro and
    ``skip_prefix[i]`` the music of phrases ``..i-1`` that is not an intro, so the
    music a mix leaves out takes two bisections.
    """

    starts: tuple[float, ...]
    ends: tuple[float, ...]
    energies: tuple[float, ...]
    boundaries: tuple[float, ...]
    tolerance_ms: float
    voiced_spans: tuple[tuple[float, float], ...] | None
    cut_lengths: tuple[float, ...]
    skip_lengths: tuple[float, ...]
    cut_suffix: tuple[float, ...]
    skip_prefix: tuple[float, ...]
    # Only when the stems layer applies to the edge and the profile carries one.
    stems: _StemSpans | None = None

    def is_boundary(self, position_ms: float) -> bool:
        index = bisect_left(self.boundaries, position_ms - self.tolerance_ms)
        return (
            index < len(self.boundaries)
            and self.boundaries[index] <= position_ms + self.tolerance_ms
        )

    def energy_at(self, position_ms: float) -> float | None:
        index = bisect_right(self.starts, position_ms) - 1
        if index < 0 or position_ms >= self.ends[index]:
            return None
        return self.energies[index]

    def unplayed_after(self, position_ms: float) -> float:
        """Music after a position that is not an outro."""
        index = bisect_right(self.ends, position_ms)
        if index >= len(self.ends):
            return 0.0
        partial = (
            self.ends[index] - max(self.starts[index], position_ms)
            if self.cut_lengths[index]
            else 0.0
        )
        return partial + self.cut_suffix[index + 1]

    def skipped_before(self, position_ms: float) -> float:
        """Music before a position that is not an intro."""
        index = bisect_left(self.starts, position_ms)
        if index == 0:
            return 0.0
        last = index - 1
        partial = (
            min(self.ends[last], position_ms) - self.starts[last]
            if self.skip_lengths[last]
            else 0.0
        )
        return self.skip_prefix[last] + partial


@dataclass(frozen=True, slots=True)
class _Edge:
    outgoing: TrackMixProfile
    incoming: TrackMixProfile
    context: TransitionContext
    policy: PlannerPolicy
    outgoing_uid: str
    incoming_uid: str
    fallback_reason: TransitionFallbackReason | None
    tempo_ratio: float
    outgoing_gain_db: float
    incoming_gain_db: float
    beatmatch_confidence: float
    crossfade_confidence: float
    relationship: CamelotRelationship
    stability: float | None
    requested_ms: int
    # The six component weights, in CandidateScore order.
    weights: tuple[float, ...]

    @property
    def beatmatch(self) -> bool:
        return self.fallback_reason is None


@dataclass(frozen=True, slots=True)
class _Geometry:
    """Where and how long a mix runs; variants change only bass and curve."""

    beatmatch: bool
    duration_ms: int
    outgoing_cue_ms: int
    incoming_cue_ms: int
    ratio: float
    beat_phase_offset_ms: int
    outgoing_phrase: int | None = None
    incoming_phrase: int | None = None
    length_bars: int | None = None

    @property
    def incoming_start_ms(self) -> int:
        """``crate.smart_mix.evaluation.incoming_start_ms`` of its plans."""
        if not self.beatmatch:
            return self.incoming_cue_ms
        return self.incoming_cue_ms + round(self.beat_phase_offset_ms * self.ratio)

    @property
    def playback_rate(self) -> float:
        return self.ratio if self.beatmatch else 1.0


@dataclass(frozen=True, slots=True)
class _Option:
    geometry: _Geometry
    bass_handoff: str
    curve: str
    components: tuple[float, float, float, float, float, float]
    vocal: float | None
    # Unclamped, so heavy vocal penalties still order the options below 0.
    raw_score: float
    structure_used: bool
    plan: TransitionPlan | None = None
    stems: StemScore | None = None


def plan_transition_candidates(
    outgoing: TrackMixProfile | None,
    incoming: TrackMixProfile | None,
    context: TransitionContext,
    policy: PlannerPolicy = PLANNER_POLICY_V3,
    *,
    outgoing_track_entity_uid: str | None = None,
    incoming_track_entity_uid: str | None = None,
    outgoing_genre_prior: float | None = None,
    incoming_genre_prior: float | None = None,
) -> list[TransitionCandidate]:
    """The candidate menu of one edge, best first (see the module docstring).

    The genre priors are each track's ``genre_beatmatch_prior``; unknown keeps the
    stems layer off (STEM-G1)."""
    baseline = plan_transition(
        outgoing,
        incoming,
        context,
        outgoing_track_entity_uid=outgoing_track_entity_uid,
        incoming_track_entity_uid=incoming_track_entity_uid,
        policy=policy,
    )
    if (
        outgoing is None
        or incoming is None
        or not context.automatic
        or context.source == "album"
        or _is_short_cut(baseline, policy)
    ):
        return [_single(baseline, policy)]
    edge = _edge(outgoing, incoming, context, policy, baseline)
    stems = stems_layer_applies(
        policy, outgoing_genre_prior, incoming_genre_prior, source=context.source
    )
    outgoing_phrases = _timeline(outgoing, policy, stems=stems)
    incoming_phrases = _timeline(incoming, policy, stems=stems)
    if outgoing_phrases is not None and incoming_phrases is not None:
        options = _phrase_options(edge, outgoing_phrases, incoming_phrases)
        if options:
            # v2's own plan stays on the menu, scored on the same phrases: it can
            # mix in the tail after the last phrase or over the incoming lead-in,
            # which no phrase start reaches.
            options.append(
                _fixed_option(edge, baseline, outgoing_phrases, incoming_phrases)
            )
            return _menu(edge, _ranked(options, policy))
    first = _fixed_option(edge, baseline, None, None)
    return _menu(edge, [first, *_ranked(_heuristic_options(edge, baseline), policy)])


def recompose_candidate(
    outgoing: TrackMixProfile,
    incoming: TrackMixProfile,
    context: TransitionContext,
    policy: PlannerPolicy = PLANNER_POLICY_V3,
    *,
    outgoing_phrase: int,
    incoming_phrase: int,
    length_bars: int | None,
    bass_handoff: str,
    curve: str,
    outgoing_track_entity_uid: str | None = None,
    incoming_track_entity_uid: str | None = None,
) -> TransitionPlan | None:
    """A plan placed on two phrases the way the menu places its candidates, or None.

    SM4 rebuilds a model's adjusted choice (another phrase, the next or previous
    length, the bass handoff) with this, so the plan comes from the same geometry,
    variants and policy check as every candidate (SM3-D1). ``curve`` is kept when
    the geometry allows it; otherwise the geometry's own curve is used (a long blend
    is always a DJ blend, a crossfade equal power). None when the phrases, the
    length or the bass handoff do not give a valid plan.
    """
    baseline = plan_transition(
        outgoing,
        incoming,
        context,
        outgoing_track_entity_uid=outgoing_track_entity_uid,
        incoming_track_entity_uid=incoming_track_entity_uid,
        policy=policy,
    )
    edge = _edge(outgoing, incoming, context, policy, baseline)
    outgoing_phrases = _timeline(outgoing, policy)
    incoming_phrases = _timeline(incoming, policy)
    if (
        outgoing_phrases is None
        or incoming_phrases is None
        or not 0 <= outgoing_phrase < len(outgoing_phrases.starts)
        or not 0 <= incoming_phrase < len(incoming_phrases.starts)
        or length_bars not in _lengths(edge)
    ):
        return None
    outgoing_cue = round(outgoing_phrases.starts[outgoing_phrase])
    incoming_cue = round(incoming_phrases.starts[incoming_phrase])
    offset = (
        _snapped_phase_offset(edge, outgoing_cue, incoming_cue, edge.tempo_ratio)
        if edge.beatmatch
        else 0
    )
    geometry = _phrase_geometry(
        edge,
        outgoing_cue,
        incoming_cue,
        offset,
        outgoing_phrase,
        incoming_phrase,
        length_bars,
    )
    if geometry is None:
        return None
    bass_handoffs, curves = _variants(edge, geometry)
    if bass_handoff not in bass_handoffs:
        return None
    plan = _plan(edge, geometry, bass_handoff, curve if curve in curves else curves[0])
    return None if _violates_policy(edge, plan) else plan


# --- phrases ---------------------------------------------------------------


# STEM-G1, rules revision 4: genres of the machine-drum industrial family. Their drums
# are programmed or played to a grid (Godflesh, Ministry, Fear Factory, Author &
# Punisher, EBM): on the development library 75 % of their tracks have a steady tempo
# (stability >= 0.9), like electronic dance music (80 %), against 32 % for extreme
# metal and 56-57 % for punk and rock. Matched at the start of a word, like the
# genre beatmatch priors, so "electro-industrial" and "old school ebm" count.
MACHINE_DRUM_GENRES = (
    "industrial",
    "ebm",
    "aggrotech",
    "dark electro",
    "neue deutsche h",
)
# The gate prior of a track of that family: in, whatever its other genres say.
MACHINE_DRUM_PRIOR = 1.0


def stems_gate_prior(
    album_genres: Mapping[str, float] | None,
    artist_genres: Mapping[str, float] | None,
) -> float | None:
    """The genre prior the stems gate reads for a track (STEM-G1).

    ``MACHINE_DRUM_PRIOR`` when the track's top artist genre or top album genre (ties
    included) is of the machine-drum industrial family (``MACHINE_DRUM_GENRES``);
    otherwise the album genres' ``genre_beatmatch_prior``, None without album genres.
    The shared prior table is not changed: compatible tracks and radio keep their
    priors."""
    if any(
        _machine_drums(genre)
        for genre in (*_top_genres(artist_genres), *_top_genres(album_genres))
    ):
        return MACHINE_DRUM_PRIOR
    return genre_beatmatch_prior(album_genres) if album_genres else None


def _top_genres(genres: Mapping[str, float] | None) -> list[str]:
    if not genres:
        return []
    weights = {name: float(weight or 0.0) for name, weight in genres.items()}
    best = max(weights.values())
    return [name for name, weight in weights.items() if weight == best]


def _machine_drums(genre: str) -> bool:
    normalized = " ".join(genre.casefold().replace("_", " ").split())
    return any(
        re.search(rf"(?<![a-z]){re.escape(keyword)}", normalized)
        for keyword in MACHINE_DRUM_GENRES
    )


def stems_layer_applies(
    policy: PlannerPolicy,
    outgoing_genre_prior: float | None,
    incoming_genre_prior: float | None,
    *,
    source: str,
) -> bool:
    """Whether the stems layer scores an edge (STEM-G1): the policy has it, the request
    comes from a client it serves (``policy.stems_layer_sources``: Crate Decks, rules
    revision 5) and both tracks belong to the beatmatch family, their gate priors
    (``stems_gate_prior``) known and at least ``policy.stems_layer_min_genre_prior``.
    Other clients, live-drum rock, metal and punk and tracks without a known genre stay
    on rules revision 1's menu."""
    if not policy.stems_layer or source not in policy.stems_layer_sources:
        return False
    floor = policy.stems_layer_min_genre_prior
    return all(
        prior is not None and prior >= floor
        for prior in (outgoing_genre_prior, incoming_genre_prior)
    )


def _timeline(
    profile: TrackMixProfile, policy: PlannerPolicy, *, stems: bool = False
) -> _Timeline | None:
    phrases = profile.phrases
    if not phrases or not profile.bpm:
        return None
    if profile.time_signature not in (None, _BEATS_PER_BAR):
        return None
    confidence = profile.structure_confidence or 0.0
    if confidence < policy.minimum_structure_confidence:
        return None
    beat_ms = 60_000.0 / profile.bpm
    starts = tuple(float(phrase.start_ms) for phrase in phrases)
    ends = tuple(
        min(
            starts[index] + phrase.bars * _BEATS_PER_BAR * beat_ms,
            starts[index + 1] if index + 1 < len(starts) else math.inf,
        )
        for index, phrase in enumerate(phrases)
    )
    lengths = [end - start for start, end in zip(starts, ends, strict=True)]
    cut_lengths = tuple(
        0.0 if phrase.kind == "outro" else length
        for phrase, length in zip(phrases, lengths, strict=True)
    )
    skip_lengths = tuple(
        0.0 if phrase.kind == "intro" else length
        for phrase, length in zip(phrases, lengths, strict=True)
    )
    cut_suffix = [0.0] * (len(phrases) + 1)
    for index in reversed(range(len(phrases))):
        cut_suffix[index] = cut_suffix[index + 1] + cut_lengths[index]
    skip_prefix = [0.0] * (len(phrases) + 1)
    for index, length in enumerate(skip_lengths):
        skip_prefix[index + 1] = skip_prefix[index] + length
    voices = profile.vocal_presence
    voiced = (
        tuple(value >= VOCAL_THRESHOLD for value in voices)
        if voices is not None and len(voices) == len(phrases)
        else None
    )
    voiced_spans = (
        tuple(
            (start, end)
            for start, end, flag in zip(starts, ends, voiced, strict=True)
            if flag
        )
        if voiced is not None
        else None
    )
    return _Timeline(
        starts=starts,
        ends=ends,
        energies=tuple(phrase.energy for phrase in phrases),
        boundaries=tuple(sorted({*starts, *ends})),
        tolerance_ms=PHRASE_TOLERANCE_BEATS * beat_ms,
        voiced_spans=voiced_spans,
        cut_lengths=cut_lengths,
        skip_lengths=skip_lengths,
        cut_suffix=tuple(cut_suffix),
        skip_prefix=tuple(skip_prefix),
        stems=(
            _stem_spans(profile.stems, starts, ends, voiced)
            if stems and profile.stems is not None
            else None
        ),
    )


def _stem_spans(
    layer: StemsLayer,
    starts: tuple[float, ...],
    ends: tuple[float, ...],
    yamnet_voiced: tuple[bool, ...] | None,
) -> _StemSpans:
    """The layer's presence on the phrases' own spans (the ones every term uses).

    A phrase has voice when the vocal stem or YAMNet's stored byte says so (rules
    revision 3): the stem misses about half the voice YAMNet hears where they
    disagree (ST3 report, held-out lyrics labels)."""
    heard = yamnet_voiced or (False,) * len(layer.phrases)
    entries = [
        (a, b, stem, stem.vocal_present or yamnet)
        for a, b, stem, yamnet in zip(starts, ends, layer.phrases, heard, strict=True)
    ]
    return _StemSpans(
        vocals=tuple((a, b) for a, b, _, voice in entries if voice),
        bass=tuple((a, b) for a, b, stem, _ in entries if stem.bass_present),
        drums_only=tuple(
            (a, b)
            for a, b, stem, voice in entries
            if stem.drums_present and not stem.bass_present and not voice
        ),
        vocal_free=tuple((a, b) for a, b, _, voice in entries if not voice),
    )


def _phrase_options(
    edge: _Edge,
    outgoing_phrases: _Timeline,
    incoming_phrases: _Timeline,
) -> list[_Option]:
    policy = edge.policy
    incoming_choices = range(
        min(policy.incoming_phrase_choices, len(incoming_phrases.starts))
    )
    options: list[_Option] = []
    used_outgoing = 0
    for outgoing_index in reversed(range(len(outgoing_phrases.starts))):
        if used_outgoing >= policy.outgoing_phrase_choices:
            break
        found = False
        outgoing_cue = round(outgoing_phrases.starts[outgoing_index])
        for incoming_index in incoming_choices:
            incoming_cue = round(incoming_phrases.starts[incoming_index])
            offset = (
                _snapped_phase_offset(
                    edge, outgoing_cue, incoming_cue, edge.tempo_ratio
                )
                if edge.beatmatch
                else 0
            )
            for length_bars in _lengths(edge):
                geometry = _phrase_geometry(
                    edge,
                    outgoing_cue,
                    incoming_cue,
                    offset,
                    outgoing_index,
                    incoming_index,
                    length_bars,
                )
                if geometry is None:
                    continue
                variants = _scored_variants(
                    edge, geometry, outgoing_phrases, incoming_phrases
                )
                if variants:
                    found = True
                    options.extend(variants)
        if found:
            used_outgoing += 1
    return options


def _lengths(edge: _Edge) -> tuple[int | None, ...]:
    if not edge.beatmatch:
        return (None,)
    return (*edge.policy.phrase_lengths, None)


def _phrase_geometry(
    edge: _Edge,
    outgoing_cue: int,
    incoming_cue: int,
    offset: int,
    outgoing_index: int,
    incoming_index: int,
    length_bars: int | None,
) -> _Geometry | None:
    outgoing, policy = edge.outgoing, edge.policy
    ratio = edge.tempo_ratio if edge.beatmatch else 1.0
    if length_bars is None:
        duration = _fitted_duration(edge, outgoing_cue, incoming_cue, ratio)
    else:
        bpm = _outro_beat(outgoing)[0] or outgoing.bpm
        if not bpm:
            return None
        duration = math.floor(length_bars * _BEATS_PER_BAR * 60_000.0 / bpm)
    if duration is None or not _window_fits(
        edge, outgoing_cue, incoming_cue, duration, ratio
    ):
        return None
    if edge.beatmatch and duration < _minimum_beatmatch_ms(outgoing, policy):
        return None
    long_blend = duration > policy.maximum_transition_ms
    if long_blend and not _long_blend_allowed(edge, duration):
        return None
    if not long_blend and duration > edge.requested_ms:
        # The context's preferred duration bounds every mix but a long blend, as
        # in v2: a client without long blends gets no 8-bar mix at 170 BPM.
        return None
    return _Geometry(
        beatmatch=edge.beatmatch,
        duration_ms=duration,
        outgoing_cue_ms=outgoing_cue,
        incoming_cue_ms=incoming_cue,
        ratio=ratio,
        beat_phase_offset_ms=offset,
        outgoing_phrase=outgoing_index,
        incoming_phrase=incoming_index,
        length_bars=length_bars,
    )


def _fitted_duration(
    edge: _Edge, outgoing_cue: int, incoming_cue: int, ratio: float
) -> int | None:
    """The preferred duration, shortened to the windows the cues leave (as v2 does)."""
    policy = edge.policy
    outgoing_room = _playable_end_ms(edge.outgoing) - outgoing_cue
    incoming_room = math.floor(
        (
            _playable_end_ms(edge.incoming)
            - incoming_cue
            - policy.minimum_incoming_body_ms
        )
        / ratio
    )
    duration = min(edge.requested_ms, outgoing_room, incoming_room)
    if duration < policy.minimum_transition_ms:
        return None
    return duration


def _window_fits(
    edge: _Edge, outgoing_cue: int, incoming_cue: int, duration: int, ratio: float
) -> bool:
    policy = edge.policy
    outgoing_end = _playable_end_ms(edge.outgoing)
    earliest_cue = min(
        int(outgoing_end * policy.minimum_outgoing_body_ratio),
        policy.minimum_outgoing_body_ms,
    )
    if outgoing_cue < earliest_cue or outgoing_cue + duration > outgoing_end:
        return False
    incoming_end = _playable_end_ms(edge.incoming) - policy.minimum_incoming_body_ms
    return (
        duration >= policy.minimum_transition_ms
        and incoming_cue + duration * ratio <= incoming_end
    )


def _long_blend_allowed(edge: _Edge, duration: int) -> bool:
    policy = edge.policy
    return (
        edge.beatmatch
        and edge.context.allow_long_beatmatch
        and duration <= policy.maximum_long_beatmatch_ms
        and all(
            stability is not None
            and stability >= policy.minimum_long_beatmatch_stability
            for stability in (
                edge.outgoing.tempo_stability,
                edge.incoming.tempo_stability,
            )
        )
    )


def _variants(
    edge: _Edge, geometry: _Geometry
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """The bass handoffs and curves a geometry is tried with."""
    if not geometry.beatmatch:
        return ("none",), ("equal-power",)
    bass = ("balanced", "none") if edge.context.allow_bass_handoff else ("none",)
    long_blend = geometry.duration_ms > edge.policy.maximum_transition_ms
    return bass, ("dj-blend",) if long_blend else _CURVES


def _snapped_phase_offset(
    edge: _Edge, outgoing_cue: int, incoming_cue: int, ratio: float
) -> int:
    """v2's phase offset, without waiting a whole beat for a rounding residue.

    Phrase starts are grid beats rounded to whole milliseconds, so two cues on the
    beat can come out a millisecond apart in either direction. A negative residue
    wraps to almost a beat and would start the incoming one beat late, off its
    phrase; within ``candidate_phase_snap_ms`` of a beat it starts on the beat.
    """
    offset = _beat_phase_offset(
        edge.outgoing, edge.incoming, outgoing_cue, incoming_cue, ratio
    )
    bpm = _outro_beat(edge.outgoing)[0]
    if not bpm:
        return offset
    beat_ms = 60_000.0 / bpm
    if beat_ms - offset <= edge.policy.candidate_phase_snap_ms:
        return 0
    return offset


# --- bar heuristic (no structure) ------------------------------------------


def _heuristic_options(edge: _Edge, baseline: TransitionPlan) -> list[_Option]:
    """The windows of v2's bar heuristic other than v2's plan, with variants."""
    if baseline.mode != TransitionMode.BEATMATCH:
        return []
    windows: list[tuple[int, int, int, int | None]] = []
    bpm = _outro_beat(edge.outgoing)[0] or 0.0
    beats_per_bar = edge.outgoing.time_signature or _BEATS_PER_BAR
    for length_bars in edge.policy.phrase_lengths if bpm > 0 else ():
        phrase_ms = math.floor(length_bars * beats_per_bar * 60_000.0 / bpm)
        window = _fit_window(
            edge.outgoing,
            edge.incoming,
            phrase_ms,
            edge.tempo_ratio,
            edge.policy,
            snap_to_beats=True,
        )
        if window.fits and window.duration_ms >= phrase_ms:
            windows.append(
                (window.outgoing_cue_ms, window.incoming_cue_ms, phrase_ms, length_bars)
            )
    short = _fit_window(
        edge.outgoing,
        edge.incoming,
        edge.requested_ms,
        edge.tempo_ratio,
        edge.policy,
        snap_to_beats=True,
    )
    if short.fits:
        windows.append(
            (short.outgoing_cue_ms, short.incoming_cue_ms, short.duration_ms, None)
        )
    options: list[_Option] = []
    for outgoing_cue, incoming_cue, duration, length_bars in windows:
        if duration < _minimum_beatmatch_ms(edge.outgoing, edge.policy):
            continue
        long_blend = duration > edge.policy.maximum_transition_ms
        if long_blend and not _long_blend_allowed(edge, duration):
            continue
        geometry = _Geometry(
            beatmatch=True,
            duration_ms=duration,
            outgoing_cue_ms=outgoing_cue,
            incoming_cue_ms=incoming_cue,
            ratio=edge.tempo_ratio,
            beat_phase_offset_ms=_beat_phase_offset(
                edge.outgoing,
                edge.incoming,
                outgoing_cue,
                incoming_cue,
                edge.tempo_ratio,
            ),
            length_bars=length_bars,
        )
        options.extend(_scored_variants(edge, geometry, None, None))
    return options


def _fixed_option(
    edge: _Edge,
    plan: TransitionPlan,
    outgoing_phrases: _Timeline | None,
    incoming_phrases: _Timeline | None,
) -> _Option:
    """An existing plan (v2's), scored on the phrases when they are given."""
    beatmatch = plan.mode == TransitionMode.BEATMATCH
    geometry = _Geometry(
        beatmatch=beatmatch,
        duration_ms=plan.duration_ms,
        outgoing_cue_ms=plan.outgoing_cue_ms,
        incoming_cue_ms=plan.incoming_cue_ms,
        ratio=plan.incoming_tempo_ratio,
        beat_phase_offset_ms=plan.beat_phase_offset_ms,
    )
    [option] = _curve_options(
        edge,
        geometry,
        plan.curve,
        (plan.bass_handoff,),
        _geometry_terms(edge, geometry, outgoing_phrases, incoming_phrases),
        outgoing_phrases,
        incoming_phrases,
        structure_used=False,
    )
    return _Option(
        geometry=option.geometry,
        bass_handoff=option.bass_handoff,
        curve=option.curve,
        components=option.components,
        vocal=option.vocal,
        raw_score=option.raw_score,
        structure_used=False,
        plan=plan,
        stems=option.stems,
    )


# --- score -----------------------------------------------------------------


def _scored_variants(
    edge: _Edge,
    geometry: _Geometry,
    outgoing_phrases: _Timeline | None,
    incoming_phrases: _Timeline | None,
) -> list[_Option]:
    """The bass and curve variants of a geometry, scored.

    The geometry already keeps the rules of the policy that depend on where and
    how long a mix runs (windows, bodies, duration, long blends); gains, true peak
    and tempo are the same for the whole edge. ``_menu`` still checks every plan it
    returns against the whole policy.
    """
    terms = _geometry_terms(edge, geometry, outgoing_phrases, incoming_phrases)
    structured = outgoing_phrases is not None and incoming_phrases is not None
    bass_handoffs, curves = _variants(edge, geometry)
    return [
        option
        for curve in curves
        for option in _curve_options(
            edge,
            geometry,
            curve,
            bass_handoffs,
            terms,
            outgoing_phrases,
            incoming_phrases,
            structure_used=structured,
        )
    ]


def _geometry_terms(
    edge: _Edge,
    geometry: _Geometry,
    outgoing_phrases: _Timeline | None,
    incoming_phrases: _Timeline | None,
) -> tuple[float, float, float, float]:
    """Alignment, energy, position and stability: the same for every variant."""
    policy = edge.policy
    duration = geometry.duration_ms
    rate = geometry.playback_rate
    outgoing_cue = geometry.outgoing_cue_ms
    incoming_start = geometry.incoming_start_ms
    outgoing_end = outgoing_cue + duration
    if outgoing_phrases is not None and incoming_phrases is not None:
        alignment = (
            outgoing_phrases.is_boundary(outgoing_cue)
            + incoming_phrases.is_boundary(incoming_start)
            + outgoing_phrases.is_boundary(outgoing_end)
            + incoming_phrases.is_boundary(incoming_start + duration * rate)
        ) / 4.0
        handoff_ms = _HANDOFF_PROGRESS * duration
        step = _step(
            outgoing_phrases.energy_at(outgoing_cue + handoff_ms),
            incoming_phrases.energy_at(incoming_start + handoff_ms * rate),
        )
        unplayed = outgoing_phrases.unplayed_after(outgoing_end)
        skipped = incoming_phrases.skipped_before(geometry.incoming_cue_ms)
    else:
        alignment = policy.neutral_dimension_score
        step = None
        unplayed = max(0.0, _playable_end_ms(edge.outgoing) - outgoing_end)
        skipped = max(
            0.0, geometry.incoming_cue_ms - float(edge.incoming.active_start_ms or 0)
        )
    if step is None:
        # Without phrases, or with a handoff outside them (a tail or a lead-in),
        # compare the profile's edge energies, as the evaluation does.
        step = _step(edge.outgoing.outro_energy, edge.incoming.intro_energy)
    energy = (
        policy.neutral_dimension_score
        if step is None
        else 1.0 - min(1.0, step / policy.candidate_energy_step_limit)
    )
    position = 1.0 - min(1.0, (unplayed + skipped) / policy.candidate_position_limit_ms)
    return alignment, energy, position, _stability(edge, geometry)


def _curve_options(
    edge: _Edge,
    geometry: _Geometry,
    curve: str,
    bass_handoffs: tuple[str, ...],
    terms: tuple[float, float, float, float],
    outgoing_phrases: _Timeline | None,
    incoming_phrases: _Timeline | None,
    *,
    structure_used: bool,
) -> list[_Option]:
    """A geometry on one curve, once per bass handoff: only the bass term differs."""
    policy = edge.policy
    weights = policy.candidate_weights
    alignment, energy, position, stability = terms
    duration = geometry.duration_ms
    # The engines apply the DJ blend and the bass handoff only in beatmatch.
    effective_curve = curve if geometry.beatmatch else "equal-power"
    window_start, window_end = _full_level_window(effective_curve)
    full_share = window_end - window_start
    stems = (
        (outgoing_phrases.stems, incoming_phrases.stems)
        if outgoing_phrases is not None
        and incoming_phrases is not None
        and outgoing_phrases.stems is not None
        and incoming_phrases.stems is not None
        else None
    )
    if stems is not None:
        # The vocal stem replaces YAMNet's voice (STEM-D4).
        vocal_ms: float | None = _span_overlap_ms(
            stems[0].vocals,
            stems[1].vocals,
            geometry,
            window_start * duration,
            window_end * duration,
        )
    elif outgoing_phrases is not None and incoming_phrases is not None:
        vocal_ms = _vocal_overlap_ms(
            outgoing_phrases,
            incoming_phrases,
            geometry,
            window_start * duration,
            window_end * duration,
        )
    else:
        vocal_ms = None
    vocal = (
        None
        if vocal_ms is None
        else _component(vocal_ms / policy.candidate_vocal_reference_ms)
    )
    shared = (
        _component(alignment),
        _component(energy),
        _component(_harmonic(edge, duration, full_share * duration)),
        _component(stability),
    )
    position_component = _component(position)
    penalty = weights.vocal * (vocal or 0.0)
    bonus = 0.0
    entry = exit_ = 0.0
    if stems is not None:
        entry = _drums_only_entry(stems[1], geometry)
        exit_ = _vocal_free_exit(stems[0], geometry)
        bonus = weights.drums_only_entry * entry + weights.vocal_free_exit * exit_
    options = []
    for bass_handoff in bass_handoffs:
        handoff = geometry.beatmatch and bass_handoff == "balanced"
        stem_score = None
        if stems is None:
            bass = 1.0 if handoff else 1.0 - full_share
        else:
            bass_start, bass_end = _bass_full_level_window(effective_curve, handoff)
            bass_ms = _span_overlap_ms(
                stems[0].bass,
                stems[1].bass,
                geometry,
                bass_start * duration,
                bass_end * duration,
            )
            bass = 1.0 - bass_ms / duration
            stem_score = StemScore(
                vocal_overlap_ms=round(vocal_ms or 0.0),
                bass_overlap_ms=round(bass_ms),
                drums_only_entry=entry,
                vocal_free_exit=exit_,
            )
        components = (*shared, _component(bass), position_component)
        raw = (
            sum(
                component * weight
                for component, weight in zip(components, edge.weights, strict=True)
            )
            - penalty
        )
        if stems is not None:
            raw += bonus
        options.append(
            _Option(
                geometry=geometry,
                bass_handoff=bass_handoff,
                curve=curve,
                components=components,
                vocal=vocal,
                raw_score=round(raw, _DIGITS),
                structure_used=structure_used,
                stems=stem_score,
            )
        )
    return options


def _component(value: float) -> float:
    return max(0.0, min(1.0, value))


def _step(outgoing: float | None, incoming: float | None) -> float | None:
    if outgoing is None or incoming is None:
        return None
    return abs(float(incoming) - float(outgoing))


def _harmonic(edge: _Edge, duration: int, full_ms: float) -> float:
    policy = edge.policy
    neutral = policy.neutral_dimension_score
    if edge.relationship is CamelotRelationship.UNKNOWN:
        return neutral
    if edge.relationship is CamelotRelationship.INCOMPATIBLE:
        return neutral * max(0.0, 1.0 - full_ms / policy.maximum_transition_ms)
    return neutral + (1.0 - neutral) * min(
        1.0, duration / policy.maximum_long_beatmatch_ms
    )


def _stability(edge: _Edge, geometry: _Geometry) -> float:
    if not geometry.beatmatch:
        return 1.0
    policy = edge.policy
    stability = edge.stability if edge.stability is not None else 0.0
    drift = _unit((1.0 - stability) / max(1e-9, 1.0 - policy.minimum_tempo_stability))
    stretch = _unit(
        abs(round(geometry.ratio, 6) - 1.0) / max(1e-9, policy.maximum_tempo_adjustment)
    )
    exposure = min(1.0, geometry.duration_ms / policy.maximum_long_beatmatch_ms)
    return 1.0 - exposure * _unit(0.5 * drift + 0.5 * stretch)


def _vocal_overlap_ms(
    outgoing_phrases: _Timeline,
    incoming_phrases: _Timeline,
    geometry: _Geometry,
    window_start: float,
    window_end: float,
) -> float | None:
    """Mix time within the full-level window with voice on both decks."""
    if outgoing_phrases.voiced_spans is None or incoming_phrases.voiced_spans is None:
        return None
    return _span_overlap_ms(
        outgoing_phrases.voiced_spans,
        incoming_phrases.voiced_spans,
        geometry,
        window_start,
        window_end,
    )


def _span_overlap_ms(
    outgoing: Iterable[Span],
    incoming: Iterable[Span],
    geometry: _Geometry,
    window_start: float,
    window_end: float,
) -> float:
    """Mix time within a window where both decks play one of their spans."""
    if window_end <= window_start:
        return 0.0
    outgoing_spans = _clipped(
        _outgoing_mix_time(outgoing, geometry), window_start, window_end
    )
    if not outgoing_spans:
        return 0.0
    incoming_spans = _clipped(
        _incoming_mix_time(incoming, geometry), window_start, window_end
    )
    return sum(
        max(0.0, min(out_end, in_end) - max(out_start, in_start))
        for out_start, out_end in outgoing_spans
        for in_start, in_end in incoming_spans
    )


def _outgoing_mix_time(spans: Iterable[Span], geometry: _Geometry) -> Iterable[Span]:
    cue = geometry.outgoing_cue_ms
    return ((start - cue, end - cue) for start, end in spans)


def _incoming_mix_time(spans: Iterable[Span], geometry: _Geometry) -> Iterable[Span]:
    start_ms = geometry.incoming_start_ms
    rate = geometry.playback_rate
    return (
        ((start - start_ms) / rate, (end - start_ms) / rate) for start, end in spans
    )


def _drums_only_entry(incoming: _StemSpans, geometry: _Geometry) -> float:
    """Share of the mix before the handoff with the incoming on drums only."""
    handoff_ms = _HANDOFF_PROGRESS * geometry.duration_ms
    if handoff_ms <= 0:
        return 0.0
    covered = sum(
        end - start
        for start, end in _clipped(
            _incoming_mix_time(incoming.drums_only, geometry), 0.0, handoff_ms
        )
    )
    return covered / handoff_ms


def _vocal_free_exit(outgoing: _StemSpans, geometry: _Geometry) -> float:
    """Share of the mix with the outgoing on a phrase without vocals."""
    duration = geometry.duration_ms
    if duration <= 0:
        return 0.0
    covered = sum(
        end - start
        for start, end in _clipped(
            _outgoing_mix_time(outgoing.vocal_free, geometry), 0.0, float(duration)
        )
    )
    return covered / duration


def _clipped(
    spans: Iterable[tuple[float, float]], low: float, high: float
) -> list[tuple[float, float]]:
    return [
        (max(start, low), min(end, high))
        for start, end in spans
        if end > low and start < high
    ]


@cache
def _full_level_window(curve: str) -> tuple[float, float]:
    """Mix progress during which both decks are at full level on ``curve``.

    Full level is the evaluation's: a crossfade gain of at least
    ``OVERLAP_FLOOR_GAIN``. The incoming gain only rises and the outgoing gain only
    falls, so each edge is found by bisection.
    """
    start = _first_progress(
        lambda progress: crossfade_gains(progress, curve)[1] >= OVERLAP_FLOOR_GAIN
    )
    end = _first_progress(
        lambda progress: crossfade_gains(progress, curve)[0] < OVERLAP_FLOOR_GAIN
    )
    return start, max(start, end)


@cache
def _bass_full_level_window(curve: str, handoff: bool) -> tuple[float, float]:
    """Mix progress during which both basses are at full level on ``curve``.

    A bass is at full level when its crossfade gain plus the bass handoff shelf (with
    the handoff at ``_HANDOFF_PROGRESS``) is at least ``OVERLAP_FLOOR_DB``, as in
    ``crate.smart_mix.evaluation.bass_overlap_ms``. The incoming bass only rises and
    the outgoing bass only falls, so the window is an interval, empty with the
    handoff.
    """
    if not handoff:
        return _full_level_window(curve)

    def levels(progress: float) -> tuple[float, float]:
        outgoing_gain, incoming_gain = crossfade_gains(progress, curve)
        outgoing_cut, incoming_cut = bass_cut_db(progress, _HANDOFF_PROGRESS)
        return (
            _gain_db(outgoing_gain) + outgoing_cut,
            _gain_db(incoming_gain) + incoming_cut,
        )

    start = _first_progress(lambda progress: levels(progress)[1] >= OVERLAP_FLOOR_DB)
    end = _first_progress(lambda progress: levels(progress)[0] < OVERLAP_FLOOR_DB)
    return start, max(start, end)


def _first_progress(condition) -> float:
    """The first mix progress where a condition that stays true once true holds."""
    low, high = 0.0, 1.0
    for _ in range(60):
        middle = (low + high) / 2.0
        if condition(middle):
            high = middle
        else:
            low = middle
    return high


def _gain_db(gain: float) -> float:
    return -math.inf if gain <= 0.0 else 20.0 * math.log10(gain)


def _unit(value: float) -> float:
    return max(0.0, min(1.0, value))


# --- plans and menu --------------------------------------------------------


def _edge(
    outgoing: TrackMixProfile,
    incoming: TrackMixProfile,
    context: TransitionContext,
    policy: PlannerPolicy,
    baseline: TransitionPlan,
) -> _Edge:
    fallback_reason = _beatmatch_fallback_reason(outgoing, incoming, context, policy)
    compatibility = score_compatibility(
        outgoing, incoming, beatmatch_affinity=1.0, policy=policy
    )
    stabilities = (
        _cue_stability(outgoing.outro_tempo_stability, outgoing.tempo_stability),
        _cue_stability(incoming.intro_tempo_stability, incoming.tempo_stability),
    )
    return _Edge(
        outgoing=outgoing,
        incoming=incoming,
        context=context,
        policy=policy,
        outgoing_uid=baseline.outgoing_track_entity_uid,
        incoming_uid=baseline.incoming_track_entity_uid,
        fallback_reason=fallback_reason,
        tempo_ratio=(
            round(_cue_tempo_ratio(outgoing, incoming), 6)
            if fallback_reason is None
            else 1.0
        ),
        outgoing_gain_db=_safe_deck_gain(outgoing, 0.0, policy),
        incoming_gain_db=_safe_deck_gain(
            incoming, _loudness_delta(outgoing, incoming, policy), policy
        ),
        beatmatch_confidence=min(
            compatibility.transition, compatibility.signal_confidence
        ),
        crossfade_confidence=compatibility.signal_confidence,
        relationship=camelot_relationship(outgoing.camelot, incoming.camelot),
        stability=(
            None
            if any(value is None for value in stabilities)
            else min(value for value in stabilities if value is not None)
        ),
        requested_ms=_transition_duration(context.preferred_duration_ms, policy),
        weights=tuple(
            weight for _name, weight in policy.candidate_weights.components()
        ),
    )


def _plan(
    edge: _Edge, geometry: _Geometry, bass_handoff: str, curve: str
) -> TransitionPlan:
    beatmatch = geometry.beatmatch
    return TransitionPlan(
        planner_version=edge.policy.version,
        outgoing_track_entity_uid=edge.outgoing_uid,
        incoming_track_entity_uid=edge.incoming_uid,
        mode=TransitionMode.BEATMATCH if beatmatch else TransitionMode.ADAPTIVE,
        duration_ms=geometry.duration_ms,
        outgoing_cue_ms=geometry.outgoing_cue_ms,
        incoming_cue_ms=geometry.incoming_cue_ms,
        incoming_tempo_ratio=round(geometry.ratio, 6),
        beat_phase_offset_ms=geometry.beat_phase_offset_ms,
        handoff_progress=_HANDOFF_PROGRESS,
        outgoing_gain_db=round(edge.outgoing_gain_db, 4),
        incoming_gain_db=round(edge.incoming_gain_db, 4),
        curve=curve,
        bass_handoff=bass_handoff,
        confidence=_round_score(
            edge.beatmatch_confidence if beatmatch else edge.crossfade_confidence
        ),
        fallback_reason=None if beatmatch else edge.fallback_reason,
    )


def _violates_policy(edge: _Edge, plan: TransitionPlan) -> bool:
    return bool(
        policy_violations(
            plan,
            edge.outgoing,
            edge.incoming,
            context=edge.context,
            policy=edge.policy,
        )
    )


def _ranked(options: list[_Option], policy: PlannerPolicy) -> list[_Option]:
    maximum_transition_ms = policy.maximum_transition_ms

    def key(option: _Option) -> tuple:
        geometry = option.geometry
        long_blend = geometry.duration_ms > maximum_transition_ms
        preferred_curve = "dj-blend" if long_blend else "equal-power"
        return (
            -option.raw_score,
            -(geometry.outgoing_phrase if geometry.outgoing_phrase is not None else -1),
            geometry.incoming_phrase if geometry.incoming_phrase is not None else -1,
            -geometry.duration_ms,
            option.bass_handoff != "balanced",
            option.curve != preferred_curve,
            geometry.outgoing_cue_ms,
            geometry.incoming_cue_ms,
            option.plan is not None,
            option.curve,
            option.bass_handoff,
        )

    return sorted(options, key=key)


def _menu(edge: _Edge, options: list[_Option]) -> list[TransitionCandidate]:
    """The first ``max_candidates`` distinct valid plans, in order."""
    menu: list[TransitionCandidate] = []
    seen: set[tuple] = set()
    for option in options:
        plan = option.plan or _plan(
            edge, option.geometry, option.bass_handoff, option.curve
        )
        identity = _plan_identity(plan)
        if identity in seen:
            continue
        seen.add(identity)
        if option.plan is None and _violates_policy(edge, plan):
            continue
        alignment, energy, harmonic, stability, bass, position = option.components
        geometry = option.geometry
        menu.append(
            TransitionCandidate.from_plan(
                plan,
                index=len(menu),
                score=_round_score(option.raw_score),
                breakdown=CandidateScore(
                    alignment=alignment,
                    energy=energy,
                    harmonic=harmonic,
                    stability=stability,
                    bass=bass,
                    position=position,
                    vocal=option.vocal,
                    stems=option.stems,
                ),
                structure_used=option.structure_used,
                outgoing_phrase=geometry.outgoing_phrase,
                incoming_phrase=geometry.incoming_phrase,
                length_bars=geometry.length_bars,
            )
        )
        if len(menu) >= edge.policy.max_candidates:
            break
    return menu


def _single(plan: TransitionPlan, policy: PlannerPolicy) -> TransitionCandidate:
    """The only plan of an edge without choices: neutral in every component."""
    neutral = policy.neutral_dimension_score
    breakdown = CandidateScore(
        alignment=neutral,
        energy=neutral,
        harmonic=neutral,
        stability=neutral,
        bass=neutral,
        position=neutral,
    )
    return TransitionCandidate.from_plan(
        plan,
        index=0,
        score=_round_score(breakdown.weighted_sum(policy.candidate_weights)),
        breakdown=breakdown,
        structure_used=False,
    )


def _plan_identity(plan: TransitionPlan) -> tuple:
    return (
        plan.mode,
        plan.duration_ms,
        plan.outgoing_cue_ms,
        plan.incoming_cue_ms,
        plan.incoming_tempo_ratio,
        plan.beat_phase_offset_ms,
        plan.outgoing_gain_db,
        plan.incoming_gain_db,
        plan.curve,
        plan.bass_handoff,
        plan.confidence,
        plan.fallback_reason,
    )


def _is_short_cut(plan: TransitionPlan, policy: PlannerPolicy) -> bool:
    return (
        plan.mode == TransitionMode.ADAPTIVE
        and plan.fallback_reason == TransitionFallbackReason.INSUFFICIENT_WINDOW
        and plan.duration_ms <= policy.manual_ramp_ms
    )


__all__ = [
    "MACHINE_DRUM_GENRES",
    "plan_transition_candidates",
    "recompose_candidate",
    "stems_gate_prior",
    "stems_layer_applies",
]
