from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from crate.smart_mix.policy import CandidateWeights
from crate.smart_mix.versions import ANALYZER_VERSION


class MixProfileQuality(StrEnum):
    FULL = "full"
    PARTIAL = "partial"
    LEGACY = "legacy"
    UNAVAILABLE = "unavailable"


class TransitionMode(StrEnum):
    GAPLESS = "gapless"
    ADAPTIVE = "adaptive"
    BEATMATCH = "beatmatch"


class TransitionFallbackReason(StrEnum):
    MISSING_PROFILE = "missing_profile"
    LOW_CONFIDENCE = "low_confidence"
    UNSTABLE_TEMPO = "unstable_tempo"
    INCOMPATIBLE_TEMPO = "incompatible_tempo"
    INCOMPATIBLE_METER = "incompatible_meter"
    PRELOAD_DEADLINE = "preload_deadline"
    OFFLINE_UNAVAILABLE = "offline_unavailable"
    INSUFFICIENT_WINDOW = "insufficient_window"


PHRASE_KINDS = ("intro", "build", "peak", "break", "outro", "body")
PHRASE_BAR_LENGTHS = (8, 16, 32)
MAX_PHRASES = 120
MAX_ENERGY_CURVE_BARS = 2048
MAX_VOCAL_DETECTOR = 32
MAX_BEAT_TRACKER = 32
# Scale of the per-phrase voice byte (crate.smart_mix.vocals): the geometric mean of the
# phrase's YAMNet voice scores on a log scale, LOG_FLOOR or less is 0 and 1 is 255. Kept
# here, without numpy, so the API can read it.
VOCAL_LOG_FLOOR = 1e-4
# Gate SG1b (2026-11-05): a phrase has voice from this byte, a geometric mean voice score
# of about 0.0026. Against synced lyrics: precision 0.88, recall 0.78, specificity 0.66.
VOCAL_THRESHOLD = 90
# Smart Mix Stems (STEM-D4): the voice per phrase of a stems layer comes from the vocal
# stem, which replaces YAMNet's (``vocal_detector``) where both profiles of an edge
# carry one.
STEM_VOCAL_DETECTOR = "stem-vocals-1"


@dataclass(frozen=True, slots=True)
class Phrase:
    """A phrase of ``bars`` bars that starts on the downbeat ``start_beat``.

    ``start_beat`` indexes the profile beat grid and ``start_ms`` is that beat.
    ``energy`` is the mean bar energy on the scale of the other profile energies (RMS,
    0 at -60 dBFS and 1 at 0 dBFS); ``delta_energy`` is the change from the previous
    phrase and is null on the first one.
    """

    start_beat: int
    start_ms: int
    bars: int
    energy: float
    delta_energy: float | None
    kind: str

    def __post_init__(self) -> None:
        _require_non_negative_ms("start_beat", self.start_beat)
        _require_non_negative_ms("start_ms", self.start_ms)
        if self.bars not in PHRASE_BAR_LENGTHS:
            raise ValueError("phrase bars must be 8, 16 or 32")
        if self.kind not in PHRASE_KINDS:
            raise ValueError(f"Unsupported phrase kind: {self.kind!r}")
        object.__setattr__(self, "energy", _clamp_confidence(self.energy))
        if self.delta_energy is not None:
            delta = float(self.delta_energy)
            if not math.isfinite(delta) or abs(delta) > 1.0:
                raise ValueError("phrase delta_energy must be between -1 and 1")
            object.__setattr__(self, "delta_energy", delta)

    def to_dict(self) -> dict[str, Any]:
        return {
            "start_beat": self.start_beat,
            "start_ms": self.start_ms,
            "bars": self.bars,
            "energy": self.energy,
            "delta_energy": self.delta_energy,
            "kind": self.kind,
        }

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> Phrase:
        def value(snake_case: str, camel_case: str) -> Any:
            return payload.get(snake_case, payload.get(camel_case))

        return cls(
            start_beat=value("start_beat", "startBeat"),
            start_ms=value("start_ms", "startMs"),
            bars=value("bars", "bars"),
            energy=value("energy", "energy"),
            delta_energy=value("delta_energy", "deltaEnergy"),
            kind=value("kind", "kind"),
        )


@dataclass(frozen=True, slots=True)
class StructureDraft:
    """Phrases, one energy byte per bar from the first downbeat, and their confidence.

    ``energy_curve`` is null when the track has no downbeat to count bars from; an
    empty ``phrases`` with confidence 0 means the structure could not be segmented.
    """

    phrases: tuple[Phrase, ...]
    energy_curve: bytes | None
    structure_confidence: float

    def __post_init__(self) -> None:
        _validate_structure(self)


@dataclass(frozen=True, slots=True)
class TrackMixProfileDraft:
    analyzer: str
    analyzer_version: str
    duration_ms: int
    quality: MixProfileQuality | str
    bpm: float | None = None
    bpm_confidence: float | None = None
    tempo_stability: float | None = None
    beat_anchor_ms: int | None = None
    downbeat_anchor_ms: int | None = None
    time_signature: int | None = None
    beat_grid_ms: tuple[int, ...] = ()
    key: str | None = None
    scale: str | None = None
    camelot: str | None = None
    key_confidence: float | None = None
    intro_cue_ms: int | None = None
    outro_cue_ms: int | None = None
    intro_bpm: float | None = None
    intro_beat_ms: int | None = None
    outro_bpm: float | None = None
    outro_beat_ms: int | None = None
    intro_tempo_stability: float | None = None
    outro_tempo_stability: float | None = None
    intro_downbeat_ms: int | None = None
    outro_downbeat_ms: int | None = None
    intro_lufs: float | None = None
    outro_lufs: float | None = None
    true_peak_dbfs: float | None = None
    intro_energy: float | None = None
    outro_energy: float | None = None
    intro_spectral_density: float | None = None
    outro_spectral_density: float | None = None
    global_energy: float | None = None
    danceability: float | None = None
    valence: float | None = None
    active_start_ms: int | None = None
    active_end_ms: int | None = None
    integrated_lufs: float | None = None
    measurement_version: str | None = None
    phrases: tuple[Phrase, ...] | None = None
    energy_curve: bytes | None = None
    vocal_presence: bytes | None = None
    vocal_detector: str | None = None
    structure_confidence: float | None = None
    # The model that gave the beats and downbeats (SM3-D14); null with the
    # analyzer's own tracker.
    beat_tracker: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "quality", MixProfileQuality(self.quality))
        _require_non_negative_ms("duration_ms", self.duration_ms)
        _validate_measurements(self)
        _validate_structure(self)
        _validate_beat_tracker(self.beat_tracker)
        for field_name in (
            "beat_anchor_ms",
            "downbeat_anchor_ms",
            "intro_cue_ms",
            "outro_cue_ms",
            "intro_beat_ms",
            "outro_beat_ms",
            "intro_downbeat_ms",
            "outro_downbeat_ms",
        ):
            _require_non_negative_ms(field_name, getattr(self, field_name))
        object.__setattr__(
            self,
            "beat_grid_ms",
            tuple(
                _validated_ms("beat_grid_ms", position)
                for position in self.beat_grid_ms
            ),
        )
        if any(
            current <= previous
            for previous, current in zip(
                self.beat_grid_ms,
                self.beat_grid_ms[1:],
                strict=False,
            )
        ):
            raise ValueError("beat_grid_ms must be strictly increasing")
        for field_name in (
            "bpm_confidence",
            "tempo_stability",
            "intro_tempo_stability",
            "outro_tempo_stability",
            "key_confidence",
            "intro_energy",
            "outro_energy",
            "intro_spectral_density",
            "outro_spectral_density",
            "global_energy",
            "danceability",
            "valence",
        ):
            value = getattr(self, field_name)
            if value is not None:
                object.__setattr__(self, field_name, _clamp_confidence(value))


@dataclass(frozen=True, slots=True)
class StemPhraseLevels:
    """Mean level byte of each stem over one phrase of the profile, and which stems
    the phrase has (cuts in ``crate.smart_mix.stems.STEM_PRESENCE_CUTS``)."""

    start_ms: int
    end_ms: int
    drums: int
    bass: int
    other: int
    vocals: int
    vocal_present: bool = False
    bass_present: bool = False
    drums_present: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "startMs": self.start_ms,
            "endMs": self.end_ms,
            "drums": self.drums,
            "bass": self.bass,
            "other": self.other,
            "vocals": self.vocals,
            "vocalPresent": self.vocal_present,
            "bassPresent": self.bass_present,
            "drumsPresent": self.drums_present,
        }


@dataclass(frozen=True, slots=True)
class StemsLayer:
    """The stems layer of a profile (STEM-D4): one entry per phrase, derived on read
    from a ``stem-analysis/1`` (``crate.smart_mix.stems.stem_phrase_layer``)."""

    producer: str
    separator_model: str
    separator_version: str
    phrases: tuple[StemPhraseLevels, ...]
    vocal_detector: str = STEM_VOCAL_DETECTOR

    def to_dict(self) -> dict[str, Any]:
        return {
            "producer": self.producer,
            "separatorModel": self.separator_model,
            "separatorVersion": self.separator_version,
            "vocalDetector": self.vocal_detector,
            "phrases": [phrase.to_dict() for phrase in self.phrases],
        }


@dataclass(frozen=True, slots=True)
class TrackMixProfile:
    track_entity_uid: str
    profile_version: int
    profile_revision: str
    analyzer: str
    analyzer_version: str
    source_revision: str
    duration_ms: int
    quality: MixProfileQuality | str
    analyzed_at: datetime
    bpm: float | None = None
    bpm_confidence: float | None = None
    tempo_stability: float | None = None
    beat_anchor_ms: int | None = None
    downbeat_anchor_ms: int | None = None
    time_signature: int | None = None
    beat_grid_format: str | None = None
    beat_grid_ms: tuple[int, ...] = ()
    key: str | None = None
    scale: str | None = None
    camelot: str | None = None
    key_confidence: float | None = None
    intro_cue_ms: int | None = None
    outro_cue_ms: int | None = None
    intro_bpm: float | None = None
    intro_beat_ms: int | None = None
    outro_bpm: float | None = None
    outro_beat_ms: int | None = None
    intro_tempo_stability: float | None = None
    outro_tempo_stability: float | None = None
    intro_downbeat_ms: int | None = None
    outro_downbeat_ms: int | None = None
    intro_lufs: float | None = None
    outro_lufs: float | None = None
    true_peak_dbfs: float | None = None
    intro_energy: float | None = None
    outro_energy: float | None = None
    intro_spectral_density: float | None = None
    outro_spectral_density: float | None = None
    global_energy: float | None = None
    danceability: float | None = None
    valence: float | None = None
    bliss_vector_revision: str | None = None
    active_start_ms: int | None = None
    active_end_ms: int | None = None
    integrated_lufs: float | None = None
    measurement_version: str | None = None
    duration_source: str = "decoder"
    phrases: tuple[Phrase, ...] | None = None
    energy_curve: bytes | None = None
    vocal_presence: bytes | None = None
    vocal_detector: str | None = None
    structure_confidence: float | None = None
    # The model that gave the beats and downbeats (SM3-D14); null with the
    # analyzer's own tracker.
    beat_tracker: str | None = None
    # Smart Mix Stems (STEM-D4): attached by readers that found a stem analysis of
    # this file; never stored with the profile nor serialized by it.
    stems: StemsLayer | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "quality", MixProfileQuality(self.quality))
        _require_positive_int("profile_version", self.profile_version)
        _require_non_negative_ms("duration_ms", self.duration_ms)
        _validate_measurements(self)
        _validate_structure(self)
        _validate_beat_tracker(self.beat_tracker)
        if self.duration_source not in {"decoder", "library"}:
            raise ValueError("duration_source must be decoder or library")
        for field_name in (
            "duration_ms",
            "beat_anchor_ms",
            "downbeat_anchor_ms",
            "intro_cue_ms",
            "outro_cue_ms",
            "intro_beat_ms",
            "outro_beat_ms",
            "intro_downbeat_ms",
            "outro_downbeat_ms",
        ):
            _require_non_negative_ms(field_name, getattr(self, field_name))
        object.__setattr__(
            self,
            "beat_grid_ms",
            tuple(
                _validated_ms("beat_grid_ms", position)
                for position in self.beat_grid_ms
            ),
        )
        if any(
            current <= previous
            for previous, current in zip(
                self.beat_grid_ms, self.beat_grid_ms[1:], strict=False
            )
        ):
            raise ValueError("beat_grid_ms must be strictly increasing")
        for field_name in (
            "bpm_confidence",
            "tempo_stability",
            "intro_tempo_stability",
            "outro_tempo_stability",
            "key_confidence",
            "intro_energy",
            "outro_energy",
            "intro_spectral_density",
            "outro_spectral_density",
            "global_energy",
            "danceability",
            "valence",
        ):
            value = getattr(self, field_name)
            if value is not None:
                object.__setattr__(self, field_name, _clamp_confidence(value))
        if self.analyzed_at.tzinfo is None:
            raise ValueError("analyzed_at must be timezone-aware")

    def to_summary_dict(self) -> dict[str, Any]:
        return self._serialize(include_beat_grid=False)

    def to_full_dict(self) -> dict[str, Any]:
        return self._serialize(include_beat_grid=True)

    def _serialize(self, *, include_beat_grid: bool) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "trackEntityUid": self.track_entity_uid,
            "profileVersion": self.profile_version,
            "profileRevision": self.profile_revision,
            "analyzer": self.analyzer,
            "analyzerVersion": self.analyzer_version,
            "sourceRevision": self.source_revision,
            "durationMs": self.duration_ms,
            "bpm": self.bpm,
            "bpmConfidence": self.bpm_confidence,
            "tempoStability": self.tempo_stability,
            "beatAnchorMs": self.beat_anchor_ms,
            "downbeatAnchorMs": self.downbeat_anchor_ms,
            "timeSignature": self.time_signature,
            "beatGridFormat": self.beat_grid_format,
            "key": self.key,
            "scale": self.scale,
            "camelot": self.camelot,
            "keyConfidence": self.key_confidence,
            "introCueMs": self.intro_cue_ms,
            "outroCueMs": self.outro_cue_ms,
            "introBpm": self.intro_bpm,
            "introBeatMs": self.intro_beat_ms,
            "outroBpm": self.outro_bpm,
            "outroBeatMs": self.outro_beat_ms,
            "introTempoStability": self.intro_tempo_stability,
            "outroTempoStability": self.outro_tempo_stability,
            "introDownbeatMs": self.intro_downbeat_ms,
            "outroDownbeatMs": self.outro_downbeat_ms,
            "introLufs": self.intro_lufs,
            "outroLufs": self.outro_lufs,
            "truePeakDbfs": self.true_peak_dbfs,
            "introEnergy": self.intro_energy,
            "outroEnergy": self.outro_energy,
            "introSpectralDensity": self.intro_spectral_density,
            "outroSpectralDensity": self.outro_spectral_density,
            "globalEnergy": self.global_energy,
            "danceability": self.danceability,
            "valence": self.valence,
            "blissVectorRevision": self.bliss_vector_revision,
            "activeStartMs": self.active_start_ms,
            "activeEndMs": self.active_end_ms,
            "integratedLufs": self.integrated_lufs,
            "measurementVersion": self.measurement_version,
            "durationSource": self.duration_source,
            "quality": MixProfileQuality(self.quality).value,
            "analyzedAt": _isoformat(self.analyzed_at),
        }
        if include_beat_grid:
            payload["beatGridMs"] = list(self.beat_grid_ms)
        return payload


TRANSITION_CURVES = frozenset({"equal-power", "dj-blend"})


@dataclass(frozen=True, slots=True)
class TransitionContext:
    source: str
    automatic: bool
    offline: bool
    preferred_duration_ms: int
    user_cue_profile: str
    allow_beatmatch: bool
    allow_tempo_adjustment: bool
    allow_bass_handoff: bool = False
    allow_long_beatmatch: bool = False

    def __post_init__(self) -> None:
        if self.source not in {
            "album",
            "playlist",
            "radio",
            "shuffle",
            "infinite",
            "manual",
        }:
            raise ValueError(f"Unsupported transition source: {self.source!r}")
        _require_non_negative_ms("preferred_duration_ms", self.preferred_duration_ms)

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "source": self.source,
            "automatic": self.automatic,
            "offline": self.offline,
            "preferredDurationMs": self.preferred_duration_ms,
            "userCueProfile": self.user_cue_profile,
            "allowBeatmatch": self.allow_beatmatch,
            "allowTempoAdjustment": self.allow_tempo_adjustment,
            "allowBassHandoff": self.allow_bass_handoff,
        }
        if self.allow_long_beatmatch:
            payload["allowLongBeatmatch"] = True
        return payload


@dataclass(frozen=True, slots=True)
class TransitionPlan:
    planner_version: int
    outgoing_track_entity_uid: str
    incoming_track_entity_uid: str
    mode: TransitionMode | str
    duration_ms: int
    outgoing_cue_ms: int
    incoming_cue_ms: int
    incoming_tempo_ratio: float
    beat_phase_offset_ms: int
    handoff_progress: float
    outgoing_gain_db: float
    incoming_gain_db: float
    curve: str
    bass_handoff: str
    confidence: float
    fallback_reason: TransitionFallbackReason | str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "mode", TransitionMode(self.mode))
        if self.fallback_reason is not None:
            object.__setattr__(
                self,
                "fallback_reason",
                TransitionFallbackReason(self.fallback_reason),
            )
        _require_positive_int("planner_version", self.planner_version)
        for field_name in (
            "duration_ms",
            "outgoing_cue_ms",
            "incoming_cue_ms",
            "beat_phase_offset_ms",
        ):
            _require_non_negative_ms(field_name, getattr(self, field_name))
        ratio = float(self.incoming_tempo_ratio)
        if not math.isfinite(ratio) or ratio < 0.94 or ratio > 1.06:
            raise ValueError("incoming_tempo_ratio must be between 0.94 and 1.06")
        object.__setattr__(self, "incoming_tempo_ratio", ratio)
        object.__setattr__(
            self, "handoff_progress", _clamp_confidence(self.handoff_progress)
        )
        object.__setattr__(self, "confidence", _clamp_confidence(self.confidence))
        if self.curve not in TRANSITION_CURVES:
            raise ValueError(f"Unsupported transition curve: {self.curve!r}")
        if self.bass_handoff not in {"none", "balanced"}:
            raise ValueError(f"Unsupported bass handoff: {self.bass_handoff!r}")

    def to_dict(self) -> dict[str, Any]:
        return {
            "plannerVersion": self.planner_version,
            "outgoingTrackEntityUid": self.outgoing_track_entity_uid,
            "incomingTrackEntityUid": self.incoming_track_entity_uid,
            "mode": TransitionMode(self.mode).value,
            "durationMs": self.duration_ms,
            "outgoingCueMs": self.outgoing_cue_ms,
            "incomingCueMs": self.incoming_cue_ms,
            "incomingTempoRatio": self.incoming_tempo_ratio,
            "beatPhaseOffsetMs": self.beat_phase_offset_ms,
            "handoffProgress": self.handoff_progress,
            "outgoingGainDb": self.outgoing_gain_db,
            "incomingGainDb": self.incoming_gain_db,
            "curve": self.curve,
            "bassHandoff": self.bass_handoff,
            "confidence": self.confidence,
            "fallbackReason": (
                TransitionFallbackReason(self.fallback_reason).value
                if self.fallback_reason is not None
                else None
            ),
        }


@dataclass(frozen=True, slots=True)
class StemScore:
    """The stems terms of a v3 candidate (Smart Mix Stems, STEM-D5).

    Only when both profiles carry a stems layer. ``vocal_overlap_ms`` is the mix time
    with both decks at full level and stem vocals on both, the base of the vocal
    penalty in place of YAMNet's voice; ``bass_overlap_ms`` the time with both basses
    at full level (crossfade and bass handoff) and a bassline on both, the base of the
    bass component. ``drums_only_entry`` is the share of the mix before the handoff
    with the incoming on drums without bass or vocals, and ``vocal_free_exit`` the
    share of the mix with the outgoing on a phrase without vocals; both are bonuses.
    """

    vocal_overlap_ms: int
    bass_overlap_ms: int
    drums_only_entry: float
    vocal_free_exit: float

    def __post_init__(self) -> None:
        for name in ("vocal_overlap_ms", "bass_overlap_ms"):
            object.__setattr__(self, name, max(0, round(getattr(self, name))))
        for name in ("drums_only_entry", "vocal_free_exit"):
            object.__setattr__(
                self, name, round(_clamp_confidence(getattr(self, name)), 6)
            )

    def to_dict(self) -> dict[str, float | int]:
        return {
            "vocalOverlapMs": self.vocal_overlap_ms,
            "bassOverlapMs": self.bass_overlap_ms,
            "drumsOnlyEntry": self.drums_only_entry,
            "vocalFreeExit": self.vocal_free_exit,
        }


@dataclass(frozen=True, slots=True)
class CandidateScore:
    """The components of a v3 candidate score, each in [0, 1] (SM3-D3).

    ``vocal`` is the share of a reference overlap with voice on both decks, the base
    of a penalty, and is null unless both profiles carry the voice per phrase (YAMNet
    or, with stems on both, the vocal stem). ``stems`` holds the stems terms, null
    unless both profiles carry a stems layer.
    """

    alignment: float
    energy: float
    harmonic: float
    stability: float
    bass: float
    position: float
    vocal: float | None = None
    stems: StemScore | None = None

    def __post_init__(self) -> None:
        for name in (
            "alignment",
            "energy",
            "harmonic",
            "stability",
            "bass",
            "position",
        ):
            object.__setattr__(
                self, name, round(_clamp_confidence(getattr(self, name)), 6)
            )
        if self.vocal is not None:
            object.__setattr__(self, "vocal", round(_clamp_confidence(self.vocal), 6))

    def weighted_sum(self, weights: CandidateWeights) -> float:
        """The six weighted components, without the vocal penalty or stem bonuses."""
        return sum(
            getattr(self, name) * weight for name, weight in weights.components()
        )

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "alignment": self.alignment,
            "energy": self.energy,
            "harmonic": self.harmonic,
            "stability": self.stability,
            "bass": self.bass,
            "position": self.position,
            "vocal": self.vocal,
        }
        # Absent without stems, so menus without them keep their shape.
        if self.stems is not None:
            payload["stems"] = self.stems.to_dict()
        return payload


@dataclass(frozen=True, slots=True)
class TransitionCandidate:
    """One entry of the v3 candidate menu (SM3-D3): a complete, valid plan and why.

    ``index`` is the rank in the menu (0 is the planner's choice). The phrases index
    the profiles' ``phrases`` and ``length_bars`` is the mix length in outgoing bars;
    all three are null for a candidate of the bar heuristic, and ``length_bars`` for
    a mix of the context's preferred duration. ``structure_used`` says whether the
    candidate was placed on the stored phrases.
    """

    index: int
    outgoing_phrase: int | None
    incoming_phrase: int | None
    length_bars: int | None
    structure_used: bool
    score: float
    breakdown: CandidateScore
    planner_version: int
    outgoing_track_entity_uid: str
    incoming_track_entity_uid: str
    mode: TransitionMode | str
    duration_ms: int
    outgoing_cue_ms: int
    incoming_cue_ms: int
    incoming_tempo_ratio: float
    beat_phase_offset_ms: int
    handoff_progress: float
    outgoing_gain_db: float
    incoming_gain_db: float
    curve: str
    bass_handoff: str
    confidence: float
    fallback_reason: TransitionFallbackReason | str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "mode", TransitionMode(self.mode))
        if self.fallback_reason is not None:
            object.__setattr__(
                self, "fallback_reason", TransitionFallbackReason(self.fallback_reason)
            )
        if (
            isinstance(self.index, bool)
            or not isinstance(self.index, int)
            or self.index < 0
        ):
            raise ValueError("candidate index must be a non-negative integer")
        if self.length_bars is not None and self.length_bars not in PHRASE_BAR_LENGTHS:
            raise ValueError("candidate length_bars must be 8, 16 or 32")
        object.__setattr__(self, "score", round(_clamp_confidence(self.score), 6))

    @classmethod
    def from_plan(
        cls,
        plan: TransitionPlan,
        *,
        index: int,
        score: float,
        breakdown: CandidateScore,
        structure_used: bool,
        outgoing_phrase: int | None = None,
        incoming_phrase: int | None = None,
        length_bars: int | None = None,
    ) -> TransitionCandidate:
        return cls(
            index=index,
            outgoing_phrase=outgoing_phrase,
            incoming_phrase=incoming_phrase,
            length_bars=length_bars,
            structure_used=structure_used,
            score=score,
            breakdown=breakdown,
            planner_version=plan.planner_version,
            outgoing_track_entity_uid=plan.outgoing_track_entity_uid,
            incoming_track_entity_uid=plan.incoming_track_entity_uid,
            mode=plan.mode,
            duration_ms=plan.duration_ms,
            outgoing_cue_ms=plan.outgoing_cue_ms,
            incoming_cue_ms=plan.incoming_cue_ms,
            incoming_tempo_ratio=plan.incoming_tempo_ratio,
            beat_phase_offset_ms=plan.beat_phase_offset_ms,
            handoff_progress=plan.handoff_progress,
            outgoing_gain_db=plan.outgoing_gain_db,
            incoming_gain_db=plan.incoming_gain_db,
            curve=plan.curve,
            bass_handoff=plan.bass_handoff,
            confidence=plan.confidence,
            fallback_reason=plan.fallback_reason,
        )

    def to_plan(self) -> TransitionPlan:
        """The candidate as a plan, validated again by ``TransitionPlan``."""
        return TransitionPlan(
            planner_version=self.planner_version,
            outgoing_track_entity_uid=self.outgoing_track_entity_uid,
            incoming_track_entity_uid=self.incoming_track_entity_uid,
            mode=self.mode,
            duration_ms=self.duration_ms,
            outgoing_cue_ms=self.outgoing_cue_ms,
            incoming_cue_ms=self.incoming_cue_ms,
            incoming_tempo_ratio=self.incoming_tempo_ratio,
            beat_phase_offset_ms=self.beat_phase_offset_ms,
            handoff_progress=self.handoff_progress,
            outgoing_gain_db=self.outgoing_gain_db,
            incoming_gain_db=self.incoming_gain_db,
            curve=self.curve,
            bass_handoff=self.bass_handoff,
            confidence=self.confidence,
            fallback_reason=self.fallback_reason,
        )

    @property
    def stems_used(self) -> bool:
        """Whether the stems layer of both tracks scored this candidate (STEM-D5)."""
        return self.breakdown.stems is not None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "index": self.index,
            "outgoingPhrase": self.outgoing_phrase,
            "incomingPhrase": self.incoming_phrase,
            "lengthBars": self.length_bars,
            "structureUsed": self.structure_used,
            "score": self.score,
            "breakdown": self.breakdown.to_dict(),
            "plan": self.to_plan().to_dict(),
        }
        if self.stems_used:
            payload["stemsUsed"] = True
        return payload


def mix_profile_draft_from_payload(payload: Mapping[str, Any]) -> TrackMixProfileDraft:
    def value(snake_case: str, camel_case: str) -> Any:
        return payload.get(snake_case, payload.get(camel_case))

    return TrackMixProfileDraft(
        analyzer=str(value("analyzer", "analyzer") or "crate-rust"),
        analyzer_version=str(
            value("analyzer_version", "analyzerVersion") or ANALYZER_VERSION
        ),
        duration_ms=int(value("duration_ms", "durationMs") or 0),
        quality=value("quality", "quality") or MixProfileQuality.PARTIAL,
        bpm=value("bpm", "bpm"),
        bpm_confidence=value("bpm_confidence", "bpmConfidence"),
        tempo_stability=value("tempo_stability", "tempoStability"),
        beat_anchor_ms=value("beat_anchor_ms", "beatAnchorMs"),
        downbeat_anchor_ms=value("downbeat_anchor_ms", "downbeatAnchorMs"),
        time_signature=value("time_signature", "timeSignature"),
        beat_grid_ms=tuple(value("beat_grid_ms", "beatGridMs") or ()),
        key=value("key", "key"),
        scale=value("scale", "scale"),
        camelot=value("camelot", "camelot"),
        key_confidence=value("key_confidence", "keyConfidence"),
        intro_cue_ms=value("intro_cue_ms", "introCueMs"),
        outro_cue_ms=value("outro_cue_ms", "outroCueMs"),
        intro_bpm=value("intro_bpm", "introBpm"),
        intro_beat_ms=value("intro_beat_ms", "introBeatMs"),
        outro_bpm=value("outro_bpm", "outroBpm"),
        outro_beat_ms=value("outro_beat_ms", "outroBeatMs"),
        intro_tempo_stability=value("intro_tempo_stability", "introTempoStability"),
        outro_tempo_stability=value("outro_tempo_stability", "outroTempoStability"),
        intro_downbeat_ms=value("intro_downbeat_ms", "introDownbeatMs"),
        outro_downbeat_ms=value("outro_downbeat_ms", "outroDownbeatMs"),
        intro_lufs=value("intro_lufs", "introLufs"),
        outro_lufs=value("outro_lufs", "outroLufs"),
        true_peak_dbfs=value("true_peak_dbfs", "truePeakDbfs"),
        intro_energy=value("intro_energy", "introEnergy"),
        outro_energy=value("outro_energy", "outroEnergy"),
        intro_spectral_density=value("intro_spectral_density", "introSpectralDensity"),
        outro_spectral_density=value("outro_spectral_density", "outroSpectralDensity"),
        global_energy=value("global_energy", "globalEnergy"),
        danceability=value("danceability", "danceability"),
        valence=value("valence", "valence"),
        active_start_ms=value("active_start_ms", "activeStartMs"),
        active_end_ms=value("active_end_ms", "activeEndMs"),
        integrated_lufs=value("integrated_lufs", "integratedLufs"),
        measurement_version=value("measurement_version", "measurementVersion"),
        phrases=_phrases_from_payload(value("phrases", "phrases")),
        energy_curve=_bytes_from_payload(value("energy_curve", "energyCurve")),
        vocal_presence=_bytes_from_payload(value("vocal_presence", "vocalPresence")),
        vocal_detector=value("vocal_detector", "vocalDetector"),
        structure_confidence=value("structure_confidence", "structureConfidence"),
        beat_tracker=value("beat_tracker", "beatTracker"),
    )


def _phrases_from_payload(payload: Any) -> tuple[Phrase, ...] | None:
    if payload is None:
        return None
    return tuple(
        phrase if isinstance(phrase, Phrase) else Phrase.from_payload(phrase)
        for phrase in payload
    )


def _bytes_from_payload(payload: Any) -> bytes | None:
    return None if payload is None else bytes(payload)


def _validate_measurements(profile: Any) -> None:
    for field_name in ("bpm", "intro_bpm", "outro_bpm"):
        value = getattr(profile, field_name)
        if value is not None and not (math.isfinite(value) and value > 0):
            raise ValueError(f"{field_name} must be a positive finite number")
    for field_name in (
        "intro_lufs",
        "outro_lufs",
        "integrated_lufs",
        "true_peak_dbfs",
    ):
        value = getattr(profile, field_name)
        if value is not None and not math.isfinite(value):
            raise ValueError(f"{field_name} must be finite")
    _require_non_negative_ms("active_start_ms", profile.active_start_ms)
    _require_non_negative_ms("active_end_ms", profile.active_end_ms)
    start_ms = profile.active_start_ms
    end_ms = profile.active_end_ms
    if start_ms is not None and end_ms is not None and start_ms >= end_ms:
        raise ValueError("active_start_ms must be before active_end_ms")
    if end_ms is not None and end_ms > profile.duration_ms:
        raise ValueError("active_end_ms must not exceed duration_ms")


def _validate_structure(profile: Any) -> None:
    phrases = profile.phrases
    if phrases is not None:
        phrases = tuple(phrases)
        if len(phrases) > MAX_PHRASES:
            raise ValueError(f"a profile holds at most {MAX_PHRASES} phrases")
        if any(not isinstance(phrase, Phrase) for phrase in phrases):
            raise TypeError("phrases must be Phrase values")
        for current, following in zip(phrases, phrases[1:], strict=False):
            if (
                following.start_beat < current.start_beat + 4 * current.bars
                or following.start_ms <= current.start_ms
            ):
                raise ValueError("phrases must be ordered and must not overlap")
        object.__setattr__(profile, "phrases", phrases)
    curve = profile.energy_curve
    if curve is not None:
        curve = bytes(curve)
        if len(curve) > MAX_ENERGY_CURVE_BARS:
            raise ValueError(f"energy_curve holds at most {MAX_ENERGY_CURVE_BARS} bars")
        object.__setattr__(profile, "energy_curve", curve)
    vocals = getattr(profile, "vocal_presence", None)
    if vocals is not None:
        vocals = bytes(vocals)
        if phrases is None or len(vocals) != len(phrases):
            raise ValueError("vocal_presence needs one byte per phrase")
        object.__setattr__(profile, "vocal_presence", vocals)
    detector = getattr(profile, "vocal_detector", None)
    if (detector is None) != (vocals is None):
        raise ValueError("vocal_presence and vocal_detector go together")
    if detector is not None and (
        not isinstance(detector, str) or not 0 < len(detector) <= MAX_VOCAL_DETECTOR
    ):
        raise ValueError(
            f"vocal_detector must name the detector in 1-{MAX_VOCAL_DETECTOR} characters"
        )
    stems = getattr(profile, "stems", None)
    if stems is not None:
        if not isinstance(stems, StemsLayer):
            raise TypeError("stems must be a StemsLayer")
        if phrases is None or len(stems.phrases) != len(phrases):
            raise ValueError("a stems layer needs one entry per phrase")
    confidence = profile.structure_confidence
    if confidence is not None:
        object.__setattr__(
            profile, "structure_confidence", _clamp_confidence(confidence)
        )


def _validate_beat_tracker(tracker: str | None) -> None:
    if tracker is not None and (
        not isinstance(tracker, str) or not 0 < len(tracker) <= MAX_BEAT_TRACKER
    ):
        raise ValueError(
            f"beat_tracker must name the tracker in 1-{MAX_BEAT_TRACKER} characters"
        )


def _require_positive_int(name: str, value: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{name} must be a positive integer")


def _validated_ms(name: str, value: int) -> int:
    _require_non_negative_ms(name, value)
    return value


def _require_non_negative_ms(name: str, value: int | None) -> None:
    if value is None:
        return
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{name} must be an integer number of milliseconds")
    if value < 0:
        raise ValueError(f"{name} must not be negative")


def _clamp_confidence(value: float) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("confidence values must be finite")
    return max(0.0, min(1.0, number))


def _isoformat(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
