"""Stem analyses stored per track and producer (Smart Mix Stems, STEM-D1 and D4).

``track_stem_signals`` keeps one ``stem-analysis/1`` per track and producer kind: the
server's own (Smart Mix playlists) and Crate Decks' upload, which records the user in
``contributed_by``. A row describes the file of its source revision; readers ignore rows
of another revision (:func:`crate.smart_mix.stems.choose_analysis`).

A store replaces the producer's row when its source revision changed, or when the new
separator is at least as strong. A weaker separator never overwrites a stronger
analysis of the same file, and a Decks upload is not kept when the server already has
an analysis of the same file from an equal or stronger separator, since the server's
would win anyway. Both rules are checked in the store's single statement.

Stores do not check that the revision is still the track's current one: the Decks API
checks it before storing, and a server task must read the file's revision again before
storing, as profile tasks do.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from contextlib import nullcontext
from dataclasses import dataclass
from typing import Literal

from pydantic import ValidationError
from sqlalchemy import BIGINT, and_, any_, bindparam, select, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryTrack
from crate.db.orm.smart_mix import TrackMixProfileRow, TrackStemSignalsRow
from crate.db.repositories.library_shared import coerce_uuid
from crate.db.tx import optional_scope, read_scope
from crate.smart_mix.stems import (
    SEPARATOR_STRENGTH,
    STEM_ANALYSIS_SCHEMA,
    STEM_SOURCES,
    ProducerKind,
    StemAnalysis,
)

log = logging.getLogger(__name__)

StemStoreResult = Literal["stored", "replaced", "kept_stronger"]


@dataclass(frozen=True, slots=True)
class StemTrack:
    """A local track, its current source revision and its stored stem analyses.

    ``source_revision`` and ``duration_ms`` come from the track's current profile; both
    are None while the track has none (never analysed, or its file changed since).
    """

    track_id: int
    source_revision: str | None
    duration_ms: int | None
    analyses: tuple[StemAnalysis, ...]


def _strength(column: str) -> str:
    cases = " ".join(
        f"WHEN '{model}' THEN {rank}" for model, rank in SEPARATOR_STRENGTH.items()
    )
    return f"(CASE {column} {cases} ELSE 0 END)"


_UPSERT = text(
    f"""
    INSERT INTO track_stem_signals (
        track_id, producer_kind, producer, separator_model, separator_version,
        source_revision, hop_ms, drums_levels, bass_levels, other_levels,
        vocals_levels, drum_beats_ms, duration_ms, contributed_by
    )
    SELECT
        CAST(:track_id AS BIGINT), :producer_kind, :producer, :separator_model,
        :separator_version, :source_revision, :hop_ms, :drums_levels, :bass_levels,
        :other_levels, :vocals_levels, CAST(:drum_beats_ms AS INTEGER[]),
        :duration_ms, CAST(:contributed_by AS INTEGER)
    WHERE :producer_kind = 'server' OR NOT EXISTS (
        SELECT 1
        FROM track_stem_signals server
        WHERE server.track_id = CAST(:track_id AS BIGINT)
          AND server.producer_kind = 'server'
          AND server.source_revision = :source_revision
          AND {_strength("server.separator_model")} >= :strength
    )
    ON CONFLICT (track_id, producer_kind) DO UPDATE SET
        producer = EXCLUDED.producer,
        separator_model = EXCLUDED.separator_model,
        separator_version = EXCLUDED.separator_version,
        source_revision = EXCLUDED.source_revision,
        hop_ms = EXCLUDED.hop_ms,
        drums_levels = EXCLUDED.drums_levels,
        bass_levels = EXCLUDED.bass_levels,
        other_levels = EXCLUDED.other_levels,
        vocals_levels = EXCLUDED.vocals_levels,
        drum_beats_ms = EXCLUDED.drum_beats_ms,
        duration_ms = EXCLUDED.duration_ms,
        contributed_by = EXCLUDED.contributed_by,
        updated_at = NOW()
    WHERE track_stem_signals.source_revision <> EXCLUDED.source_revision
       OR {_strength("track_stem_signals.separator_model")}
          <= {_strength("EXCLUDED.separator_model")}
    RETURNING (xmax = 0) AS inserted
    """
)


def upsert_stem_analysis(
    track_id: int,
    analysis: StemAnalysis,
    *,
    producer_kind: ProducerKind,
    contributed_by: int | None = None,
    session: Session | None = None,
) -> StemStoreResult:
    """Store ``analysis`` as the track's ``producer_kind`` analysis.

    ``stored`` adds the row, ``replaced`` overwrites the producer's previous one and
    ``kept_stronger`` stores nothing because a stronger (or, against the server, an
    equal) analysis of the same file is kept.
    """
    if analysis.producer_kind != producer_kind:
        raise ValueError(
            f"a {producer_kind} analysis needs a crate-{producer_kind}/ producer"
        )
    if producer_kind == "server" and contributed_by is not None:
        raise ValueError("only Decks uploads are contributed by a user")
    beats = analysis.drum_beats_ms
    parameters = {
        "track_id": int(track_id),
        "producer_kind": producer_kind,
        "producer": analysis.producer,
        "separator_model": analysis.separator.model,
        "separator_version": analysis.separator.version,
        "source_revision": analysis.source_revision,
        "hop_ms": analysis.hop_ms,
        **{f"{stem}_levels": getattr(analysis.levels, stem) for stem in STEM_SOURCES},
        "drum_beats_ms": None if beats is None else list(beats),
        "duration_ms": analysis.duration_ms,
        "contributed_by": contributed_by,
        "strength": SEPARATOR_STRENGTH[analysis.separator.model],
    }
    with optional_scope(session) as current:
        inserted = current.execute(_UPSERT, parameters).scalar_one_or_none()
    if inserted is None:
        log.info(
            "Track %s: kept the stronger stem analysis of source revision %s over "
            "the %s one from %s",
            track_id,
            analysis.source_revision,
            analysis.separator.model,
            analysis.producer,
        )
        return "kept_stronger"
    return "stored" if inserted else "replaced"


def get_stem_analyses(
    track_ids: Sequence[int], *, session: Session | None = None
) -> dict[int, list[StemAnalysis]]:
    """Every stored analysis of each track, in one query; server last on each track.

    Each requested track is a key, with an empty list when it has none.
    """
    requested = list(dict.fromkeys(int(track_id) for track_id in track_ids))
    if not requested:
        return {}

    def _impl(current: Session) -> dict[int, list[StemAnalysis]]:
        rows = (
            current.execute(
                select(TrackStemSignalsRow)
                .where(
                    TrackStemSignalsRow.track_id
                    == any_(
                        bindparam("track_ids", value=requested, type_=ARRAY(BIGINT))
                    )
                )
                .order_by(
                    TrackStemSignalsRow.track_id, TrackStemSignalsRow.producer_kind
                )
            )
            .scalars()
            .all()
        )
        analyses: dict[int, list[StemAnalysis]] = {
            track_id: [] for track_id in requested
        }
        for row in rows:
            analysis = _row_to_analysis(row)
            if analysis is not None:
                analyses[row.track_id].append(analysis)
        return analyses

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_stem_track(
    entity_uid: str, *, session: Session | None = None
) -> StemTrack | None:
    """The local track ``entity_uid`` with its current revision and analyses, or None."""
    statement = (
        select(
            LibraryTrack.id,
            LibraryTrack.duration,
            TrackMixProfileRow.source_revision,
            TrackMixProfileRow.duration_ms,
            TrackStemSignalsRow,
        )
        .select_from(LibraryTrack)
        .outerjoin(
            TrackMixProfileRow,
            and_(
                TrackMixProfileRow.track_id == LibraryTrack.id,
                TrackMixProfileRow.source_stale_at.is_(None),
            ),
        )
        .outerjoin(TrackStemSignalsRow, TrackStemSignalsRow.track_id == LibraryTrack.id)
        .where(LibraryTrack.entity_uid == coerce_uuid(entity_uid))
        .order_by(TrackStemSignalsRow.producer_kind)
    )
    manager = nullcontext(session) if session is not None else read_scope()
    with manager as current:
        rows = current.execute(statement).all()
        if not rows:
            return None
        track_id, library_duration, source_revision, profile_duration, _ = rows[0]
        analyses = tuple(
            analysis
            for *_columns, row in rows
            if row is not None and (analysis := _row_to_analysis(row)) is not None
        )
    duration_ms: int | None = None
    if source_revision is not None:
        # The profile's decoder duration, else the library's (as profile reads do).
        duration_ms = (
            int(profile_duration)
            if profile_duration is not None
            else max(0, round(float(library_duration or 0) * 1_000))
        )
    return StemTrack(
        track_id=int(track_id),
        source_revision=source_revision,
        duration_ms=duration_ms,
        analyses=analyses,
    )


def _row_to_analysis(row: TrackStemSignalsRow) -> StemAnalysis | None:
    try:
        return StemAnalysis.model_validate(
            {
                "schema": STEM_ANALYSIS_SCHEMA,
                "producer": row.producer,
                "separator": {
                    "model": row.separator_model,
                    "version": row.separator_version,
                    "sources": STEM_SOURCES,
                },
                "sourceRevision": row.source_revision,
                "hopMs": row.hop_ms,
                "levels": {
                    stem: bytes(getattr(row, f"{stem}_levels")) for stem in STEM_SOURCES
                },
                "drumBeatsMs": row.drum_beats_ms,
                "durationMs": row.duration_ms,
            }
        )
    except ValidationError:
        # Every row was validated on the way in; an unreadable one only loses the stems.
        log.warning(
            "Track %s: ignoring an unreadable %s stem analysis",
            row.track_id,
            row.producer_kind,
            exc_info=True,
        )
        return None


__all__ = [
    "StemStoreResult",
    "StemTrack",
    "get_stem_analyses",
    "get_stem_track",
    "upsert_stem_analysis",
]
