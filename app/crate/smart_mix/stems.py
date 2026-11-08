"""Stem analyses (``stem-analysis/1``) and the stems layer of a profile.

Smart Mix Stems (STEM-D1) has two producers of one format: the server, which separates
the tracks of Smart Mix playlists, and Crate Decks, which separates on the DJ's machine
and may upload its analysis. A ``stem-analysis/1`` document holds, per stem (drums,
bass, other, vocals), one level byte per 250 ms window, optional beats tracked on the
drum stem, the separator, the producer and the server source revision the producer
analysed. It never holds audio.

The stems layer is derived on read, never stored: the mean level byte of each stem over
each phrase of the profile (STEM-D4). It only exists when the analysis describes the
profile's file: the same source revision and a duration within 2 %.

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

from crate.smart_mix.models import TrackMixProfile
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
# Upper bounds for untrusted uploads; a track longer than a day is not a track.
MAX_DURATION_MS = 86_400_000
MAX_DRUM_BEATS = 100_000
# Crate Decks uploads (STEM-D8, design §7): the permission an uploader needs, granted
# to admins by default, and the setting an admin turns uploads off with.
STEM_CONTRIBUTE_PERMISSION = "smart_mix.stems.contribute"
STEM_UPLOADS_SETTING = "smart_mix_stem_uploads_enabled"

ProducerKind = Literal["server", "decks"]
SeparatorModel = Literal["htdemucs", "htdemucs_ft"]


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


@dataclass(frozen=True, slots=True)
class StemPhraseLevels:
    """Mean level byte of each stem over one phrase of the profile."""

    start_ms: int
    end_ms: int
    drums: int
    bass: int
    other: int
    vocals: int

    def to_dict(self) -> dict[str, int]:
        return {
            "startMs": self.start_ms,
            "endMs": self.end_ms,
            "drums": self.drums,
            "bass": self.bass,
            "other": self.other,
            "vocals": self.vocals,
        }


@dataclass(frozen=True, slots=True)
class StemsLayer:
    """The stems layer of a profile: per-phrase levels and where they came from."""

    producer: str
    separator_model: str
    separator_version: str
    phrases: tuple[StemPhraseLevels, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "producer": self.producer,
            "separatorModel": self.separator_model,
            "separatorVersion": self.separator_version,
            "phrases": [phrase.to_dict() for phrase in self.phrases],
        }


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
    """Mean stem levels per phrase, or None when the analysis does not apply.

    It does not apply to another source revision, to a duration that differs by more
    than 2 %, or to a profile without phrases. A window belongs to the phrase that
    holds its centre. The last phrase ends where the beat grid puts its last bar,
    capped at the profile's duration (or at the duration without a grid); a phrase
    with no window at all leaves the profile without a layer.
    """
    if analysis.source_revision != profile.source_revision:
        return None
    if not duration_matches(analysis.duration_ms, profile.duration_ms):
        return None
    if not profile.phrases:
        return None
    levels = {stem: getattr(analysis.levels, stem) for stem in STEM_SOURCES}
    windows = len(levels["drums"])
    hop = analysis.hop_ms
    phrases: list[StemPhraseLevels] = []
    for start_ms, end_ms in phrase_spans_ms(profile.phrases, profile.beat_grid_ms):
        end_ms = min(end_ms, profile.duration_ms)
        if end_ms <= start_ms:
            end_ms = profile.duration_ms
        first = max(0, _first_window_from(start_ms, hop))
        stop = min(windows, _first_window_from(end_ms, hop))
        if stop <= first:
            return None
        means = {
            stem: _mean_byte(values[first:stop]) for stem, values in levels.items()
        }
        phrases.append(StemPhraseLevels(start_ms=start_ms, end_ms=end_ms, **means))
    return StemsLayer(
        producer=analysis.producer,
        separator_model=analysis.separator.model,
        separator_version=analysis.separator.version,
        phrases=tuple(phrases),
    )


def _first_window_from(time_ms: int, hop_ms: int) -> int:
    """The first window whose centre is at or after ``time_ms``."""
    return -(-(2 * time_ms - hop_ms) // (2 * hop_ms))


def _mean_byte(values: bytes) -> int:
    """The mean of ``values``, rounded half up."""
    return (2 * sum(values) + len(values)) // (2 * len(values))


__all__ = [
    "LEVEL_FLOOR_DB",
    "MAX_DURATION_MISMATCH",
    "SEPARATOR_STRENGTH",
    "STEM_ANALYSIS_SCHEMA",
    "STEM_CONTRIBUTE_PERMISSION",
    "STEM_HOP_MS",
    "STEM_SOURCES",
    "STEM_UPLOADS_SETTING",
    "ProducerKind",
    "StemAnalysis",
    "StemLevels",
    "StemPhraseLevels",
    "StemSeparator",
    "StemsLayer",
    "choose_analysis",
    "duration_matches",
    "encode_levels",
    "stem_phrase_layer",
]
