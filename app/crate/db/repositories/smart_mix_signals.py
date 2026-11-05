"""Model outputs stored per track for Smart Mix profiles (SM3-D16).

Beat This! is about three quarters of a profile's cost, so its beats, downbeats and
bar length are kept per track, with YAMNet's voice windows. They hold while the file
(``source_revision``) and the tracker or detector name stay the same; a later analyzer
version reads them instead of running the models again. One row per track: beats and
voice of the same source revision share it, and storing either for another revision
replaces the row whole, since the other half described the old file.

``updated_at`` is when the storing task read the file, with a time zone. Signals of
another revision replace the row only when they were read after the row's, so a slow
task that read the file before it was replaced never overwrites the newer file's
signals; such a store writes nothing and is logged at info.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import case, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from crate.db.orm.smart_mix import TrackMixSignalsRow
from crate.db.tx import optional_scope, read_scope

log = logging.getLogger(__name__)


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
    updated_at: datetime | None = None,
    session: Session | None = None,
) -> None:
    """Keep the model beats of ``source_revision``; its voice windows stay.

    ``updated_at`` is when the task read the file (default: now); it needs a time zone.
    """
    _upsert(
        "beats",
        track_id,
        source_revision,
        {
            "beat_tracker": tracker,
            "beats_ms": [int(beat) for beat in beats_ms],
            "downbeats_ms": [int(beat) for beat in downbeats_ms],
            "beats_per_bar": beats_per_bar,
        },
        kept=_VOICE_COLUMNS,
        updated_at=updated_at,
        session=session,
    )


def store_track_mix_voice(
    track_id: int,
    source_revision: str,
    *,
    detector: str,
    hop_ms: int,
    scores: bytes,
    updated_at: datetime | None = None,
    session: Session | None = None,
) -> None:
    """Keep the voice windows of ``source_revision``; its beats stay.

    ``updated_at`` is when the task read the file (default: now); it needs a time zone.
    """
    _upsert(
        "voice",
        track_id,
        source_revision,
        {
            "vocal_detector": detector,
            "voice_hop_ms": int(hop_ms),
            "voice_scores": bytes(scores),
        },
        kept=_BEAT_COLUMNS,
        updated_at=updated_at,
        session=session,
    )


def _upsert(
    signal: str,
    track_id: int,
    source_revision: str,
    values: dict[str, Any],
    *,
    kept: tuple[str, ...],
    updated_at: datetime | None,
    session: Session | None,
) -> None:
    if updated_at is not None and updated_at.utcoffset() is None:
        # PostgreSQL would read it in the session's time zone, not the worker's.
        raise ValueError("updated_at needs a time zone")
    statement = insert(TrackMixSignalsRow).values(
        track_id=int(track_id),
        source_revision=source_revision,
        updated_at=func.now() if updated_at is None else updated_at,
        **values,
    )
    same_source = TrackMixSignalsRow.source_revision == source_revision
    read_later = TrackMixSignalsRow.updated_at <= statement.excluded.updated_at
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
            "updated_at": func.greatest(
                TrackMixSignalsRow.updated_at, statement.excluded.updated_at
            ),
        },
        # Another file's signals replace the row only when read after it was.
        where=or_(same_source, read_later),
    )
    with optional_scope(session) as current:
        stored = current.execute(statement).rowcount
    if not stored:
        log.info(
            "Track %s: not storing the %s of source revision %s; the stored signals "
            "of another revision were read later",
            track_id,
            signal,
            source_revision,
        )


__all__ = [
    "TrackMixSignals",
    "get_track_mix_signals",
    "store_track_mix_beats",
    "store_track_mix_voice",
]
