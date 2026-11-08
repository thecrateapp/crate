from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    ARRAY,
    BIGINT,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    REAL,
    SmallInteger,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from crate.db.engine import Base


class TrackMixProfileRow(Base):
    __tablename__ = "track_mix_profiles"
    __table_args__ = (
        CheckConstraint("quality IN ('full', 'partial', 'legacy', 'unavailable')"),
        CheckConstraint("profile_version > 0"),
        CheckConstraint("bpm_confidence IS NULL OR bpm_confidence BETWEEN 0 AND 1"),
        CheckConstraint("tempo_stability IS NULL OR tempo_stability BETWEEN 0 AND 1"),
        CheckConstraint("key_confidence IS NULL OR key_confidence BETWEEN 0 AND 1"),
        CheckConstraint("(beat_grid_format IS NULL) = (beat_grid_data IS NULL)"),
    )

    track_id: Mapped[int] = mapped_column(
        BIGINT,
        ForeignKey("library_tracks.id", ondelete="CASCADE"),
        primary_key=True,
    )
    profile_version: Mapped[int] = mapped_column(Integer, nullable=False)
    profile_revision: Mapped[str] = mapped_column(Text, nullable=False)
    analyzer: Mapped[str] = mapped_column(Text, nullable=False)
    analyzer_version: Mapped[str] = mapped_column(Text, nullable=False)
    source_revision: Mapped[str] = mapped_column(Text, nullable=False)
    quality: Mapped[str] = mapped_column(Text, nullable=False)
    bpm: Mapped[float | None] = mapped_column(Float)
    bpm_confidence: Mapped[float | None] = mapped_column(Float)
    tempo_stability: Mapped[float | None] = mapped_column(Float)
    beat_anchor_ms: Mapped[int | None] = mapped_column(BIGINT)
    downbeat_anchor_ms: Mapped[int | None] = mapped_column(BIGINT)
    time_signature: Mapped[int | None] = mapped_column(SmallInteger)
    beat_grid_format: Mapped[str | None] = mapped_column(Text)
    beat_grid_data: Mapped[bytes | None] = mapped_column(LargeBinary)
    audio_key: Mapped[str | None] = mapped_column(Text)
    audio_scale: Mapped[str | None] = mapped_column(Text)
    key_camelot: Mapped[str | None] = mapped_column(Text)
    key_confidence: Mapped[float | None] = mapped_column(Float)
    intro_cue_ms: Mapped[int | None] = mapped_column(BIGINT)
    outro_cue_ms: Mapped[int | None] = mapped_column(BIGINT)
    intro_bpm: Mapped[float | None] = mapped_column(Float)
    intro_beat_ms: Mapped[int | None] = mapped_column(BIGINT)
    outro_bpm: Mapped[float | None] = mapped_column(Float)
    outro_beat_ms: Mapped[int | None] = mapped_column(BIGINT)
    intro_tempo_stability: Mapped[float | None] = mapped_column(Float)
    outro_tempo_stability: Mapped[float | None] = mapped_column(Float)
    intro_downbeat_ms: Mapped[int | None] = mapped_column(BIGINT)
    outro_downbeat_ms: Mapped[int | None] = mapped_column(BIGINT)
    intro_lufs: Mapped[float | None] = mapped_column(Float)
    outro_lufs: Mapped[float | None] = mapped_column(Float)
    true_peak_dbfs: Mapped[float | None] = mapped_column(Float)
    intro_energy: Mapped[float | None] = mapped_column(Float)
    outro_energy: Mapped[float | None] = mapped_column(Float)
    intro_spectral_density: Mapped[float | None] = mapped_column(Float)
    outro_spectral_density: Mapped[float | None] = mapped_column(Float)
    global_energy: Mapped[float | None] = mapped_column(Float)
    danceability: Mapped[float | None] = mapped_column(Float)
    valence: Mapped[float | None] = mapped_column(Float)
    bliss_vector_revision: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[int | None] = mapped_column(BIGINT)
    active_start_ms: Mapped[int | None] = mapped_column(BIGINT)
    active_end_ms: Mapped[int | None] = mapped_column(BIGINT)
    integrated_lufs: Mapped[float | None] = mapped_column(Float)
    measurement_version: Mapped[str | None] = mapped_column(Text)
    phrases: Mapped[list | None] = mapped_column(JSONB)
    energy_curve: Mapped[bytes | None] = mapped_column(LargeBinary)
    vocal_presence: Mapped[bytes | None] = mapped_column(LargeBinary)
    vocal_detector: Mapped[str | None] = mapped_column(Text)
    beat_tracker: Mapped[str | None] = mapped_column(Text)
    structure_confidence: Mapped[float | None] = mapped_column(REAL)
    source_stale_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    analyzed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("NOW()"),
    )


class TrackMixSignalsRow(Base):
    """The model outputs a track's profile was built from (SM3-D16)."""

    __tablename__ = "track_mix_signals"
    __table_args__ = (
        CheckConstraint("beats_per_bar IS NULL OR beats_per_bar > 0"),
        CheckConstraint("voice_hop_ms IS NULL OR voice_hop_ms > 0"),
        CheckConstraint("(beat_tracker IS NULL) = (beats_ms IS NULL)"),
        CheckConstraint("(beats_ms IS NULL) = (downbeats_ms IS NULL)"),
        CheckConstraint("(vocal_detector IS NULL) = (voice_scores IS NULL)"),
        CheckConstraint("(voice_scores IS NULL) = (voice_hop_ms IS NULL)"),
    )

    track_id: Mapped[int] = mapped_column(
        BIGINT,
        ForeignKey("library_tracks.id", ondelete="CASCADE"),
        primary_key=True,
    )
    source_revision: Mapped[str] = mapped_column(Text, nullable=False)
    beat_tracker: Mapped[str | None] = mapped_column(Text)
    beats_ms: Mapped[list[int] | None] = mapped_column(ARRAY(Integer))
    downbeats_ms: Mapped[list[int] | None] = mapped_column(ARRAY(Integer))
    beats_per_bar: Mapped[int | None] = mapped_column(SmallInteger)
    vocal_detector: Mapped[str | None] = mapped_column(Text)
    voice_hop_ms: Mapped[int | None] = mapped_column(SmallInteger)
    voice_scores: Mapped[bytes | None] = mapped_column(LargeBinary)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("NOW()"),
    )


class TrackStemSignalsRow(Base):
    """A track's stem analysis by one producer (``stem-analysis/1``, STEM-D1)."""

    __tablename__ = "track_stem_signals"
    __table_args__ = (
        CheckConstraint("producer_kind IN ('server', 'decks')"),
        CheckConstraint("hop_ms > 0"),
        CheckConstraint("duration_ms > 0"),
        CheckConstraint("producer LIKE ('crate-' || producer_kind || '/%')"),
        CheckConstraint("producer_kind = 'decks' OR contributed_by IS NULL"),
        CheckConstraint("octet_length(drums_levels) > 0"),
        CheckConstraint("octet_length(bass_levels) = octet_length(drums_levels)"),
        CheckConstraint("octet_length(other_levels) = octet_length(drums_levels)"),
        CheckConstraint("octet_length(vocals_levels) = octet_length(drums_levels)"),
    )

    track_id: Mapped[int] = mapped_column(
        BIGINT,
        ForeignKey("library_tracks.id", ondelete="CASCADE"),
        primary_key=True,
    )
    producer_kind: Mapped[str] = mapped_column(Text, primary_key=True)
    producer: Mapped[str] = mapped_column(Text, nullable=False)
    separator_model: Mapped[str] = mapped_column(Text, nullable=False)
    separator_version: Mapped[str] = mapped_column(Text, nullable=False)
    source_revision: Mapped[str] = mapped_column(Text, nullable=False)
    hop_ms: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    drums_levels: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    bass_levels: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    other_levels: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    vocals_levels: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    drum_beats_ms: Mapped[list[int] | None] = mapped_column(ARRAY(Integer))
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    contributed_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("NOW()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("NOW()"),
    )
