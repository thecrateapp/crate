"""Crate Decks batch mix profiles (S4).

One statement reads, for up to ``DECKS_PROFILES_BATCH_LIMIT`` entity UIDs, each local
track's current profile (beat grid and structure included) and the stem analyses of
that profile's file. It looks tracks up by their unique ``entity_uid`` index and the
profiles and analyses by primary key, so it never scans or aggregates over
``library_tracks``.

Access is the single profile endpoint's: Decks reads the server's local library, the
same for every signed-in user, so a UID outside it (another server's track, a deleted
one) is simply not found.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import and_, any_, bindparam, select
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Session

from crate.db.orm.library import LibraryTrack
from crate.db.orm.smart_mix import TrackMixProfileRow, TrackStemSignalsRow
from crate.db.repositories.smart_mix import _row_to_profile
from crate.db.repositories.smart_mix_stems import _row_to_analysis
from crate.db.tx import read_scope
from crate.smart_mix.models import TrackMixProfile
from crate.smart_mix.stems import StemAnalysis

DECKS_PROFILES_BATCH_LIMIT = 200


@dataclass(frozen=True, slots=True)
class DecksProfileRead:
    """A track's current profile and the stem analyses of the same file."""

    profile: TrackMixProfile
    analyses: tuple[StemAnalysis, ...]


def get_decks_mix_profiles(
    entity_uids: Sequence[str], *, session: Session | None = None
) -> dict[str, DecksProfileRead]:
    """The current profile of each local track in ``entity_uids``, by entity UID.

    Tracks without a profile, with a stale one (the file changed since it was
    analysed) and UIDs outside the local library are absent. Analyses of another
    source revision describe another file and are left out by the join, as
    :func:`crate.smart_mix.stems.choose_analysis` would ignore them.
    """
    requested = list(dict.fromkeys(str(uid) for uid in entity_uids))
    if not requested:
        return {}
    if len(requested) > DECKS_PROFILES_BATCH_LIMIT:
        raise ValueError(
            f"At most {DECKS_PROFILES_BATCH_LIMIT} entity UIDs per batch, "
            f"got {len(requested)}"
        )
    statement = (
        select(
            TrackMixProfileRow,
            LibraryTrack.entity_uid,
            LibraryTrack.duration,
            TrackStemSignalsRow,
        )
        .select_from(LibraryTrack)
        .join(
            TrackMixProfileRow,
            and_(
                TrackMixProfileRow.track_id == LibraryTrack.id,
                TrackMixProfileRow.source_stale_at.is_(None),
            ),
        )
        .outerjoin(
            TrackStemSignalsRow,
            and_(
                TrackStemSignalsRow.track_id == LibraryTrack.id,
                TrackStemSignalsRow.source_revision
                == TrackMixProfileRow.source_revision,
            ),
        )
        .where(
            LibraryTrack.entity_uid
            == any_(
                bindparam(
                    "entity_uids", value=requested, type_=ARRAY(UUID(as_uuid=False))
                )
            )
        )
        .order_by(LibraryTrack.id, TrackStemSignalsRow.producer_kind)
    )

    def _impl(current: Session) -> dict[str, DecksProfileRead]:
        tracks: dict[str, tuple[TrackMixProfileRow, object, float | None]] = {}
        analyses: dict[str, list[StemAnalysis]] = {}
        for row, entity_uid, duration, stem_row in current.execute(statement).all():
            uid = str(entity_uid)
            if uid not in tracks:
                tracks[uid] = (row, entity_uid, duration)
                analyses[uid] = []
            if stem_row is not None:
                analysis = _row_to_analysis(stem_row)
                if analysis is not None:
                    analyses[uid].append(analysis)
        # Only the stems layer reads the structure (phrases): like the single
        # endpoint, parse it only for tracks with an analysis of their file.
        return {
            uid: DecksProfileRead(
                profile=_row_to_profile(
                    row,
                    entity_uid,
                    duration,
                    include_beat_grid=True,
                    include_structure=bool(analyses[uid]),
                ),
                analyses=tuple(analyses[uid]),
            )
            for uid, (row, entity_uid, duration) in tracks.items()
        }

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = [
    "DECKS_PROFILES_BATCH_LIMIT",
    "DecksProfileRead",
    "get_decks_mix_profiles",
]
