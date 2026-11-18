"""Crate Decks cue sets and corrections: batch reads (S7, F8.S-PR2).

Each read is one statement for up to ``DECKS_CUES_BATCH_LIMIT`` entity UIDs of one
user, by primary key (``user_id``, ``entity_uid = ANY(...)``). The tables are the
user's own data, so a UID with nothing stored (or outside the library) is simply
absent from the result; nothing joins or aggregates over ``library_tracks``.

Every read also returns ``server_time``: ``clock_timestamp()`` taken once, in the
same statement, after its snapshot. Writes stamp ``updated_at`` with ``now()``
(their transaction's start, before their commit), so every ``updated_at`` a read
can see is at or before its ``server_time``. ``now()`` would not do for the
reads: a writer that started after the reader's transaction and committed
before its statement has a later ``now()``.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope
from crate.smart_mix.beat_grid import decode_beat_grid

DECKS_CUES_BATCH_LIMIT = 200
# Mixxx hot cues 1-36: hotcue, loop and jump cues share these slots.
DECKS_HOTCUE_SLOTS = 36
DECKS_CUE_TYPES = ("main", "intro", "outro", "hotcue", "loop", "jump")
DECKS_SLOTTED_CUE_TYPES = frozenset({"hotcue", "loop", "jump"})
# Every hot cue slot plus main, intro and outro.
DECKS_CUE_SET_LIMIT = DECKS_HOTCUE_SLOTS + 3
DECKS_CUE_MAX_MS = 24 * 60 * 60 * 1000
DECKS_CUE_LABEL_MAX = 200
DECKS_CLIENT_ID_MAX = 128
DECKS_BPM_MIN = 30.0
DECKS_BPM_MAX = 300.0

# One clock reading per statement, whatever the number of rows.
SERVER_CLOCK_CTE = (
    "WITH server_clock AS MATERIALIZED (SELECT clock_timestamp() AS server_time)"
)


@dataclass(frozen=True, slots=True)
class DecksBatchRead:
    """Stored entries by entity UID in request order, and the DB clock reading."""

    found: dict[str, dict]
    server_time: datetime


_CUE_ORDER = {cue_type: index for index, cue_type in enumerate(DECKS_CUE_TYPES)}
CUE_FIELDS = ("cue_type", "slot", "start_ms", "end_ms", "label", "color")


def canonical_entity_uids(entity_uids: Sequence[str]) -> list[str]:
    """Lowercase hyphenated UIDs, each once, in request order.

    Raises ValueError for a value that is not a UUID or for more than
    ``DECKS_CUES_BATCH_LIMIT`` distinct UIDs.
    """
    requested = list(dict.fromkeys(str(uuid.UUID(str(uid))) for uid in entity_uids))
    if len(requested) > DECKS_CUES_BATCH_LIMIT:
        raise ValueError(
            f"At most {DECKS_CUES_BATCH_LIMIT} entity UIDs per batch, "
            f"got {len(requested)}"
        )
    return requested


def canonical_cues(cues: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """The cues with exactly ``CUE_FIELDS``, ordered by type then slot."""
    shaped = [{field: cue.get(field) for field in CUE_FIELDS} for cue in cues]
    return sorted(shaped, key=lambda cue: (_CUE_ORDER[cue["cue_type"]], cue["slot"]))


def empty_cue_set(entity_uid: str) -> dict[str, Any]:
    """What a track without a stored set reads as: revision 0, no cues."""
    return {
        "entity_uid": entity_uid,
        "revision": 0,
        "updated_at": None,
        "client_id": None,
        "cues": [],
    }


# Rows arrive as SQLAlchemy RowMapping, whose key type is wider than str
# (Mapping[_KeyType, Any]); Mapping is invariant in its key, so accept any key.
def cue_sets_from_rows(rows: Sequence[Mapping[Any, Any]]) -> dict[str, dict]:
    """Group set-and-cue rows (one per cue, or one with null cue fields for an
    empty set) into cue sets by entity UID."""
    sets: dict[str, dict] = {}
    for row in rows:
        if row["entity_uid"] is None:
            continue  # The clock row of a batch with nothing stored.
        uid = str(row["entity_uid"])
        current = sets.get(uid)
        if current is None:
            current = sets[uid] = {
                "entity_uid": uid,
                "revision": int(row["revision"]),
                "updated_at": row["updated_at"],
                "client_id": row["client_id"],
                "cues": [],
            }
        if row["cue_type"] is not None:
            current["cues"].append(
                {
                    "cue_type": row["cue_type"],
                    "slot": int(row["slot"]),
                    "start_ms": row["start_ms"],
                    "end_ms": row["end_ms"],
                    "label": row["label"],
                    "color": row["color"],
                }
            )
    for current in sets.values():
        current["cues"] = canonical_cues(current["cues"])
    return sets


def correction_from_row(row: Mapping[Any, Any]) -> dict[str, Any]:
    data = row["beat_grid_data"]
    return {
        "entity_uid": str(row["entity_uid"]),
        "revision": int(row["revision"]),
        "updated_at": row["updated_at"],
        "client_id": row["client_id"],
        "bpm": row["bpm"],
        "beat_grid_format": row["beat_grid_format"],
        "beat_grid_ms": None if data is None else decode_beat_grid(bytes(data)),
        "key": row["key"],
    }


CUE_SET_COLUMNS = """
    s.entity_uid::text AS entity_uid, s.revision, s.updated_at, s.client_id,
    c.cue_type, c.slot, c.start_ms, c.end_ms, c.label, c.color
"""
CORRECTION_COLUMNS = """
    entity_uid::text AS entity_uid, revision, updated_at, client_id,
    bpm, beat_grid_format, beat_grid_data, key
"""


def get_decks_cue_sets(
    user_id: int, entity_uids: Sequence[str], *, session: Session | None = None
) -> DecksBatchRead:
    """The user's stored cue set of each track in ``entity_uids``, in request
    order. Tracks without a stored set are absent (they read as revision 0)."""
    requested = canonical_entity_uids(entity_uids)

    def _impl(current: Session) -> DecksBatchRead:
        rows = (
            current.execute(
                text(
                    f"""
                    {SERVER_CLOCK_CTE}
                    SELECT server_clock.server_time, {CUE_SET_COLUMNS}
                    FROM server_clock
                    LEFT JOIN (
                        user_track_cue_sets s
                        LEFT JOIN user_track_cues c
                            ON c.user_id = s.user_id AND c.entity_uid = s.entity_uid
                    )
                        ON s.user_id = :user_id
                       AND s.entity_uid = ANY(CAST(:entity_uids AS uuid[]))
                    """
                ),
                {"user_id": user_id, "entity_uids": requested},
            )
            .mappings()
            .all()
        )
        sets = cue_sets_from_rows(rows)
        return DecksBatchRead(
            found={uid: sets[uid] for uid in requested if uid in sets},
            server_time=rows[0]["server_time"],
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_decks_corrections(
    user_id: int, entity_uids: Sequence[str], *, session: Session | None = None
) -> DecksBatchRead:
    """The user's stored correction of each track in ``entity_uids``, in request
    order. Tracks without one are absent (they read as revision 0)."""
    requested = canonical_entity_uids(entity_uids)

    def _impl(current: Session) -> DecksBatchRead:
        rows = (
            current.execute(
                text(
                    f"""
                    {SERVER_CLOCK_CTE}
                    SELECT server_clock.server_time, {CORRECTION_COLUMNS}
                    FROM server_clock
                    LEFT JOIN user_track_corrections
                        ON user_id = :user_id
                       AND entity_uid = ANY(CAST(:entity_uids AS uuid[]))
                    """
                ),
                {"user_id": user_id, "entity_uids": requested},
            )
            .mappings()
            .all()
        )
        corrections = {
            str(row["entity_uid"]): correction_from_row(row)
            for row in rows
            if row["entity_uid"] is not None
        }
        return DecksBatchRead(
            found={uid: corrections[uid] for uid in requested if uid in corrections},
            server_time=rows[0]["server_time"],
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = [
    "CORRECTION_COLUMNS",
    "CUE_FIELDS",
    "CUE_SET_COLUMNS",
    "DECKS_BPM_MAX",
    "DECKS_BPM_MIN",
    "DECKS_CLIENT_ID_MAX",
    "DECKS_CUES_BATCH_LIMIT",
    "DECKS_CUE_LABEL_MAX",
    "DECKS_CUE_MAX_MS",
    "DECKS_CUE_SET_LIMIT",
    "DECKS_CUE_TYPES",
    "DECKS_HOTCUE_SLOTS",
    "DECKS_SLOTTED_CUE_TYPES",
    "DecksBatchRead",
    "SERVER_CLOCK_CTE",
    "canonical_cues",
    "canonical_entity_uids",
    "correction_from_row",
    "cue_sets_from_rows",
    "empty_cue_set",
    "get_decks_corrections",
    "get_decks_cue_sets",
]
