from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BIGINT,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    SmallInteger,
    Text,
    text,
)
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
    analyzed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("NOW()"),
    )
