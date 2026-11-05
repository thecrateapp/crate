"""Model outputs stored per track for Smart Mix profiles (SM3-D16).

Beat This! is about three quarters of a profile's cost, so its beats, downbeats and
bar length are kept per track, with YAMNet's voice windows. They hold while the file
(``source_revision``) and the tracker or detector name stay the same; a later analyzer
version reads them instead of running the models again. One row per track: beats and
voice of the same source revision share it, and storing either for another revision
replaces the row whole, since the other half described the old file.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from crate.db.orm.smart_mix import TrackMixSignalsRow
from crate.db.tx import optional_scope, read_scope


@dataclass(frozen=True, slots=True)
class TrackMixSignals:
    source_revision: str
    beat_tracker: str | None = None
    beats_ms: tuple[int, ...] | None = None
    downbeats_ms: tuple[int, ...] | None = None
    beats_per_bar: int | None = None
    vocal_detector: str | None = None
    voice_hop_ms: int | None = None
    voice_scores: bytes | None = None


_BEAT_COLUMNS = ("beat_tracker", "beats_ms", "downbeats_ms", "beats_per_bar")
_VOICE_COLUMNS = ("vocal_detector", "voice_hop_ms", "voice_scores")


def get_track_mix_signals(
    track_id: int, *, session: Session | None = None
) -> TrackMixSignals | None:
    def _impl(current: Session) -> TrackMixSignals | None:
        row = current.execute(
            select(TrackMixSignalsRow).where(TrackMixSignalsRow.track_id == track_id)
        ).scalar_one_or_none()
        if row is None:
            return None
        return TrackMixSignals(
            source_revision=row.source_revision,
            beat_tracker=row.beat_tracker,
            beats_ms=None if row.beats_ms is None else tuple(row.beats_ms),
            downbeats_ms=None if row.downbeats_ms is None else tuple(row.downbeats_ms),
            beats_per_bar=row.beats_per_bar,
            vocal_detector=row.vocal_detector,
            voice_hop_ms=row.voice_hop_ms,
            voice_scores=None if row.voice_scores is None else bytes(row.voice_scores),
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def store_track_mix_beats(
    track_id: int,
    source_revision: str,
    *,
    tracker: str,
    beats_ms: Sequence[int],
    downbeats_ms: Sequence[int],
    beats_per_bar: int | None,
    session: Session | None = None,
) -> None:
    """Keep the model beats of ``source_revision``; its voice windows stay."""
    _upsert(
        track_id,
        source_revision,
        {
            "beat_tracker": tracker,
            "beats_ms": [int(beat) for beat in beats_ms],
            "downbeats_ms": [int(beat) for beat in downbeats_ms],
            "beats_per_bar": beats_per_bar,
        },
        kept=_VOICE_COLUMNS,
        session=session,
    )


def store_track_mix_voice(
    track_id: int,
    source_revision: str,
    *,
    detector: str,
    hop_ms: int,
    scores: bytes,
    session: Session | None = None,
) -> None:
    """Keep the voice windows of ``source_revision``; its beats stay."""
    _upsert(
        track_id,
        source_revision,
        {
            "vocal_detector": detector,
            "voice_hop_ms": int(hop_ms),
            "voice_scores": bytes(scores),
        },
        kept=_BEAT_COLUMNS,
        session=session,
    )


def _upsert(
    track_id: int,
    source_revision: str,
    values: dict[str, Any],
    *,
    kept: tuple[str, ...],
    session: Session | None,
) -> None:
    statement = insert(TrackMixSignalsRow).values(
        track_id=int(track_id),
        source_revision=source_revision,
        updated_at=func.now(),
        **values,
    )
    same_source = TrackMixSignalsRow.source_revision == source_revision
    statement = statement.on_conflict_do_update(
        index_elements=[TrackMixSignalsRow.track_id],
        set_={
            "source_revision": statement.excluded.source_revision,
            **{column: statement.excluded[column] for column in values},
            # The other model's outputs survive only for the same file.
            **{
                column: case(
                    (same_source, getattr(TrackMixSignalsRow, column)), else_=None
                )
                for column in kept
            },
            "updated_at": func.now(),
        },
    )
    with optional_scope(session) as current:
        current.execute(statement)


__all__ = [
    "TrackMixSignals",
    "get_track_mix_signals",
    "store_track_mix_beats",
    "store_track_mix_voice",
]
