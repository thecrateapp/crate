"""Stem analyses (``stem-analysis/1``) and the stems layer of a profile.

Smart Mix Stems (STEM-D1) has two producers of one format: the server, which separates
the tracks of Smart Mix playlists, and Crate Decks, which separates on the DJ's machine
and may upload its analysis. A ``stem-analysis/1`` document holds, per stem (drums,
bass, other, vocals), one level byte per 250 ms window, optional beats tracked on the
drum stem, the separator, the producer and the server source revision the producer
analysed. It never holds audio.

The stems layer is derived on read, never stored: the mean level byte of each stem over
each phrase of the profile, and whether the phrase has vocals, bass and drums
(STEM-D4, design section 5). It only exists when the analysis describes the profile's
file: the same source revision and a duration within 2 %.

The API imports this module and the API image has no numpy, so only
:func:`encode_levels`, which producers call, imports it.
"""

from __future__ import annotations

import base64
import binascii
from collections.abc import Iterable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Annotated, Any, Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    PlainSerializer,
    WithJsonSchema,
    model_validator,
)

from crate.smart_mix.models import (
    STEM_VOCAL_DETECTOR,
    StemPhraseLevels,
    StemsLayer,
    TrackMixProfile,
)
from crate.smart_mix.phrase_grid import phrase_spans_ms

if TYPE_CHECKING:
    import numpy as np

STEM_ANALYSIS_SCHEMA = "stem-analysis/1"
# In the order of the Decks sidecar (STEM-D9).
STEM_SOURCES = ("drums", "bass", "other", "vocals")
STEM_HOP_MS = 250
# Levels are RMS in dBFS, linear from LEVEL_FLOOR_DB (byte 0) to 0 dBFS (byte 255).
LEVEL_FLOOR_DB = -60.0
_BYTES_PER_DB = 255.0 / -LEVEL_FLOOR_DB
# STEM-D4: the stronger separator wins, whoever produced it; the server on a tie. A new
# model needs a new separator identifier and a gate (STEM-D3).
SEPARATOR_STRENGTH = {"htdemucs": 1, "htdemucs_ft": 2}
# An analysis applies to a profile whose duration is within this share of its own.
MAX_DURATION_MISMATCH = 0.02


@dataclass(frozen=True, slots=True)
class PresenceCut:
    """When a phrase has a stem: its mean level byte is at least ``floor`` and at most
    ``drop`` bytes below the track's loudest phrase of that stem (4.25 bytes per dB).

    The floor rejects separation leakage in tracks without the stem; the drop follows
    the level each track mixes the stem at, which an absolute cut cannot (ST0).
    """

    floor: int
    drop: int


# Provisional, until ST3 calibrates them: a floor of -40 dBFS and a drop of 12 dB.
STEM_PRESENCE_CUTS = {
    "vocals": PresenceCut(floor=85, drop=51),
    "bass": PresenceCut(floor=85, drop=51),
    "drums": PresenceCut(floor=85, drop=51),
}
# Upper bounds for untrusted uploads; a track longer than a day is not a track.
MAX_DURATION_MS = 86_400_000
MAX_DRUM_BEATS = 100_000
# Crate Decks uploads (STEM-D8, design §7): the permission an uploader needs, granted
# to admins by default, and the setting an admin turns uploads off with.
STEM_CONTRIBUTE_PERMISSION = "smart_mix.stems.contribute"
STEM_UPLOADS_SETTING = "smart_mix_stem_uploads_enabled"
# Smart Mix playlists (STEM-D2): admin settings of each instance that cap the tracks the
# server separates. Each Smart Mix playlist holds at most 300 local tracks by default;
# the limit across a user's Smart Mix playlists (distinct tracks) is off unless set.
STEM_MAX_TRACKS_PER_PLAYLIST_SETTING = "smart_mix_stem_max_tracks_per_playlist"
STEM_MAX_TRACKS_PER_USER_SETTING = "smart_mix_stem_max_tracks_per_user"
DEFAULT_STEM_MAX_TRACKS_PER_PLAYLIST = 300
# Until the server has separated tracks, each takes about four minutes: separating,
# the drum beats and the stem file of a five-minute track took 2.5-3.5 minutes with four
# threads on a development laptop (ST2.PR2), and the i7-7700 is slower per thread.
ESTIMATED_STEM_SECONDS_PER_TRACK = 240
# The task that separates the tracks of Smart Mix playlists (ST2.PR3), and the stem
# files it keeps for Crate Decks (STEM-D6): an admin setting caps their total size, 50
# GiB by default; 0 keeps none.
STEM_TASK_TYPE = "analyze_playlist_stems"
STEM_QUOTA_SETTING = "smart_mix_stem_quota_gib"
DEFAULT_STEM_QUOTA_GIB = 50
MAX_STEM_QUOTA_GIB = 100_000

ProducerKind = Literal["server", "decks"]
SeparatorModel = Literal["htdemucs", "htdemucs_ft"]
StemJobState = Literal["pending", "analyzing", "ready", "failed"]
STEM_JOB_STATES: tuple[StemJobState, ...] = ("pending", "analyzing", "ready", "failed")


def stem_track_limit(value: str | None, *, default: int | None) -> int | None:
    """A stored track limit: a positive integer, else ``default`` (None is no limit)."""
    try:
        limit = int(value.strip()) if value is not None else None
    except ValueError:
        return default
    if limit is None or limit < 1:
        return default
    return limit


def stem_quota_gib(value: str | None) -> int:
    """The stored stem quota in GiB: a whole number from 0, else the default."""
    try:
        quota = int(value.strip()) if value is not None else None
    except ValueError:
        return DEFAULT_STEM_QUOTA_GIB
    if quota is None or not 0 <= quota <= MAX_STEM_QUOTA_GIB:
        return DEFAULT_STEM_QUOTA_GIB
    return quota


def _decode_level_bytes(value: Any) -> Any:
    if isinstance(value, bytes | bytearray | memoryview):
        return bytes(value)
    if isinstance(value, str):
        try:
            return base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("levels must be standard base64") from error
    return value


LevelBytes = Annotated[
    bytes,
    BeforeValidator(_decode_level_bytes),
    PlainSerializer(
        lambda value: base64.b64encode(value).decode("ascii"),
        return_type=str,
        when_used="json",
    ),
    WithJsonSchema(
        {
            "type": "string",
            "format": "byte",
            "description": (
                "Base64, one byte per window: RMS in dBFS, linear from -60 dB (0) "
                "to 0 dB (255)."
            ),
        }
    ),
]


class _StemModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class StemSeparator(_StemModel):
    model: SeparatorModel
    version: str = Field(
        pattern=r"^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$",
        description="Separator identifier, such as htdemucs-onnx-1.",
    )
    sources: tuple[
        Literal["drums"], Literal["bass"], Literal["other"], Literal["vocals"]
    ]


class StemLevels(_StemModel):
    drums: LevelBytes
    bass: LevelBytes
    other: LevelBytes
    vocals: LevelBytes


class StemAnalysis(_StemModel):
    """A ``stem-analysis/1`` document (Smart Mix Stems design, section 5)."""

    schema_version: Literal["stem-analysis/1"] = Field(alias="schema")
    producer: str = Field(
        pattern=r"^crate-(server|decks)/[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$",
        description="crate-server/<version> or crate-decks/<version>.",
    )
    separator: StemSeparator
    source_revision: str = Field(
        alias="sourceRevision",
        pattern=r"^[0-9a-f]{64}$",
        description="The server's sourceRevision of the track the producer analysed.",
    )
    hop_ms: Literal[250] = Field(alias="hopMs")
    levels: StemLevels
    drum_beats_ms: tuple[int, ...] | None = Field(
        default=None,
        alias="drumBeatsMs",
        max_length=MAX_DRUM_BEATS,
        description="Beats tracked on the drum stem, strictly increasing.",
    )
    duration_ms: int = Field(alias="durationMs", gt=0, le=MAX_DURATION_MS)

    @model_validator(mode="after")
    def _check_windows_and_beats(self) -> StemAnalysis:
        counts = {len(getattr(self.levels, stem)) for stem in STEM_SOURCES}
        if len(counts) != 1:
            raise ValueError("every stem needs the same number of windows")
        covered_ms = counts.pop() * self.hop_ms
        if covered_ms > self.duration_ms + self.hop_ms:
            raise ValueError("levels are longer than the duration plus one window")
        if covered_ms < self.duration_ms - self.hop_ms or covered_ms == 0:
            raise ValueError("levels are shorter than the duration minus one window")
        beats = self.drum_beats_ms
        if beats:
            if beats[0] < 0 or beats[-1] > self.duration_ms:
                raise ValueError("drum beats must fall within the analysed audio")
            if any(b <= a for a, b in zip(beats, beats[1:], strict=False)):
                raise ValueError("drum beats must be strictly increasing")
        return self

    @property
    def producer_kind(self) -> ProducerKind:
        return "server" if self.producer.startswith("crate-server/") else "decks"


def encode_levels(rms_db: np.ndarray) -> bytes:
    """One byte per window: -60 dBFS or less is 0 and 0 dBFS or more is 255.

    Linear in dB and rounded half up, ``floor((dB + 60) * 255 / 60 + 0.5)``, so every
    producer encodes the same bytes. Silence (-inf) is 0; NaN is an error.
    """
    import numpy as np

    values = np.asarray(rms_db, dtype=np.float64)
    if values.ndim != 1:
        raise ValueError("levels must be one value per window")
    if np.isnan(values).any():
        raise ValueError("levels must not be NaN")
    clipped = np.clip(values, LEVEL_FLOOR_DB, 0.0)
    scaled = np.floor((clipped - LEVEL_FLOOR_DB) * _BYTES_PER_DB + 0.5)
    return scaled.astype(np.uint8).tobytes()


def duration_matches(analysed_ms: int, profile_ms: int) -> bool:
    """Whether an analysis of ``analysed_ms`` describes a profile of ``profile_ms``."""
    return (
        profile_ms > 0
        and abs(analysed_ms - profile_ms) <= MAX_DURATION_MISMATCH * profile_ms
    )


def choose_analysis(
    rows: Iterable[StemAnalysis], *, source_revision: str
) -> StemAnalysis | None:
    """The analysis Smart Mix uses for a file (STEM-D4).

    Analyses of another source revision describe another file and are ignored. Of the
    rest, the stronger separator wins; on a tie, the server's own analysis.
    """
    current = [row for row in rows if row.source_revision == source_revision]
    if not current:
        return None
    return max(
        current,
        key=lambda row: (
            SEPARATOR_STRENGTH[row.separator.model],
            row.producer_kind == "server",
        ),
    )


def stem_phrase_layer(
    profile: TrackMixProfile, analysis: StemAnalysis
) -> StemsLayer | None:
    """Mean stem levels and presence per phrase, or None when the analysis does not
    apply.

    It does not apply to another source revision, to a duration that differs by more
    than 2 %, or to a profile without phrases. A window belongs to the phrase that
    holds its centre. The last phrase ends where the beat grid puts its last bar,
    capped at the profile's duration (or at the duration without a grid); a phrase
    with no window at all leaves the profile without a layer. Presence follows
    ``STEM_PRESENCE_CUTS``.
    """
    if analysis.source_revision != profile.source_revision:
        return None
    if not duration_matches(analysis.duration_ms, profile.duration_ms):
        return None
    if not profile.phrases:
        return None
    levels = {stem: getattr(analysis.levels, stem) for stem in STEM_SOURCES}
    hop = analysis.hop_ms
    spans: list[tuple[int, int, dict[str, int]]] = []
    for start_ms, end_ms in phrase_spans_ms(profile.phrases, profile.beat_grid_ms):
        end_ms = min(end_ms, profile.duration_ms)
        if end_ms <= start_ms:
            end_ms = profile.duration_ms
        if span_mean_byte(levels["drums"], start_ms, end_ms, hop) is None:
            return None
        means = {
            stem: span_mean_byte(values, start_ms, end_ms, hop) or 0
            for stem, values in levels.items()
        }
        spans.append((start_ms, end_ms, means))
    loudest = {
        stem: max(means[stem] for _start, _end, means in spans)
        for stem in STEM_PRESENCE_CUTS
    }
    return StemsLayer(
        producer=analysis.producer,
        separator_model=analysis.separator.model,
        separator_version=analysis.separator.version,
        phrases=tuple(
            StemPhraseLevels(
                start_ms=start_ms,
                end_ms=end_ms,
                **means,
                vocal_present=_present("vocals", means, loudest),
                bass_present=_present("bass", means, loudest),
                drums_present=_present("drums", means, loudest),
            )
            for start_ms, end_ms, means in spans
        ),
        vocal_detector=STEM_VOCAL_DETECTOR,
    )


def span_mean_byte(
    levels: bytes, start_ms: int, end_ms: int, hop_ms: int
) -> int | None:
    """Mean byte of the windows whose centre lies in [start, end), rounded half up;
    None when no window does."""
    first = max(0, _first_window_from(start_ms, hop_ms))
    stop = min(len(levels), _first_window_from(end_ms, hop_ms))
    if stop <= first:
        return None
    return _mean_byte(levels[first:stop])


def stem_present(level: int, loudest: int, cut: PresenceCut) -> bool:
    """Whether a phrase whose mean byte is ``level`` has the stem (``PresenceCut``)."""
    return level >= cut.floor and level >= loudest - cut.drop


def _present(stem: str, means: dict[str, int], loudest: dict[str, int]) -> bool:
    return stem_present(means[stem], loudest[stem], STEM_PRESENCE_CUTS[stem])


def _first_window_from(time_ms: int, hop_ms: int) -> int:
    """The first window whose centre is at or after ``time_ms``."""
    return -(-(2 * time_ms - hop_ms) // (2 * hop_ms))


def _mean_byte(values: bytes) -> int:
    """The mean of ``values``, rounded half up."""
    return (2 * sum(values) + len(values)) // (2 * len(values))


__all__ = [
    "DEFAULT_STEM_MAX_TRACKS_PER_PLAYLIST",
    "DEFAULT_STEM_QUOTA_GIB",
    "MAX_STEM_QUOTA_GIB",
    "STEM_QUOTA_SETTING",
    "STEM_TASK_TYPE",
    "ESTIMATED_STEM_SECONDS_PER_TRACK",
    "LEVEL_FLOOR_DB",
    "MAX_DURATION_MISMATCH",
    "PresenceCut",
    "SEPARATOR_STRENGTH",
    "STEM_ANALYSIS_SCHEMA",
    "STEM_CONTRIBUTE_PERMISSION",
    "STEM_HOP_MS",
    "STEM_JOB_STATES",
    "STEM_MAX_TRACKS_PER_PLAYLIST_SETTING",
    "STEM_MAX_TRACKS_PER_USER_SETTING",
    "STEM_PRESENCE_CUTS",
    "STEM_SOURCES",
    "STEM_UPLOADS_SETTING",
    "STEM_VOCAL_DETECTOR",
    "ProducerKind",
    "StemAnalysis",
    "StemJobState",
    "StemLevels",
    "StemPhraseLevels",
    "StemSeparator",
    "StemsLayer",
    "choose_analysis",
    "duration_matches",
    "encode_levels",
    "span_mean_byte",
    "stem_phrase_layer",
    "stem_present",
    "stem_quota_gib",
    "stem_track_limit",
]
