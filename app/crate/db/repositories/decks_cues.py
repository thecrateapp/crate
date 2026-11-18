"""Crate Decks cue sets and corrections: compare-and-set writes (S7, F8.S-PR1).

A client replaces a whole cue set, or a whole correction, naming the revision it
last saw (``base_revision``; 0 when it saw none). In one transaction, with the
stored row locked:

- the track must be in the local library (``not_found`` otherwise);
- when the submitted content equals the stored one, nothing is written and the
  result is ``unchanged``, whatever the base revision (a retried PUT whose
  answer was lost succeeds instead of conflicting with itself);
- when the base revision is not the stored one the result is ``conflict``, with
  the stored content;
- otherwise the content is replaced and the revision goes up by one (``stored``).

The revision belongs to the whole set (``user_track_cue_sets``): an emptied set
or a cleared correction keeps its row, so revisions never go back.

Writes stamp ``updated_at`` with ``now()``. Every result but ``not_found`` also
carries ``server_time``, ``clock_timestamp()`` read last in the transaction, so
it is at or after the ``updated_at`` it is returned with (see
``crate.db.queries.decks_cues``).
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.queries.decks_cues import (
    CORRECTION_COLUMNS,
    CUE_SET_COLUMNS,
    canonical_cues,
    correction_from_row,
    cue_sets_from_rows,
    empty_cue_set,
)
from crate.db.tx import optional_scope
from crate.smart_mix.beat_grid import FORMAT_NAME, encode_beat_grid

DecksSyncStatus = Literal["stored", "unchanged", "conflict", "not_found"]


@dataclass(frozen=True, slots=True)
class DecksSyncResult:
    """``current`` is the stored content after the call and ``server_time`` the
    database clock read after it (both None when not found)."""

    status: DecksSyncStatus
    current: dict[str, Any] | None
    server_time: datetime | None = None


def put_decks_cue_set(
    user_id: int,
    entity_uid: str,
    cues: Sequence[Mapping[str, Any]],
    *,
    base_revision: int,
    client_id: str | None,
    session: Session | None = None,
) -> DecksSyncResult:
    """Replace the user's cue set of a track if ``base_revision`` is current.

    ``cues`` must already satisfy the set rules (the API schema checks them);
    the table constraints back them up and raise ``IntegrityError``.
    """
    uid = str(uuid.UUID(str(entity_uid)))
    submitted = canonical_cues(cues)
    with optional_scope(session) as current_session:
        if not _local_track_exists(current_session, uid):
            return DecksSyncResult("not_found", None)
        for _attempt in range(2):
            stored = _locked_cue_set(current_session, user_id, uid)
            if stored["cues"] == submitted:
                return _result(current_session, "unchanged", stored)
            if stored["revision"] != base_revision:
                return _result(current_session, "conflict", stored)
            revision = _bump_cue_set(current_session, user_id, uid, stored, client_id)
            if revision is not None:
                break
            # Another first write of this set committed in between: compare again.
        else:  # pragma: no cover - the second read always sees the stored row
            raise RuntimeError("cue set row vanished while locked")
        _replace_cues(current_session, user_id, uid, submitted, revision, client_id)
        return _result(
            current_session, "stored", _locked_cue_set(current_session, user_id, uid)
        )


def put_decks_correction(
    user_id: int,
    entity_uid: str,
    *,
    base_revision: int,
    bpm: float | None,
    beat_grid_ms: Sequence[int] | None,
    key: str | None,
    client_id: str | None,
    session: Session | None = None,
) -> DecksSyncResult:
    """Replace the user's correction of a track if ``base_revision`` is current.

    All three values null clears the correction and keeps its revision.
    ``beat_grid_ms`` holds absolute beat positions, stored in ``delta-ms-v1``.
    """
    uid = str(uuid.UUID(str(entity_uid)))
    grid = list(beat_grid_ms) if beat_grid_ms else None
    values = {
        "bpm": None if bpm is None else float(bpm),
        "beat_grid_format": FORMAT_NAME if grid else None,
        "beat_grid_data": encode_beat_grid(grid) if grid else None,
        "key": key.strip().upper() if key else None,
    }
    with optional_scope(session) as current_session:
        if not _local_track_exists(current_session, uid):
            return DecksSyncResult("not_found", None)
        for _attempt in range(2):
            stored = _locked_correction(current_session, user_id, uid)
            if (
                stored["bpm"] == values["bpm"]
                and stored["beat_grid_ms"] == grid
                and stored["key"] == values["key"]
            ):
                return _result(current_session, "unchanged", stored)
            if stored["revision"] != base_revision:
                return _result(current_session, "conflict", stored)
            if _write_correction(
                current_session, user_id, uid, stored["revision"], values, client_id
            ):
                return _result(
                    current_session,
                    "stored",
                    _locked_correction(current_session, user_id, uid),
                )
        raise RuntimeError(  # pragma: no cover - the second read sees the row
            "correction row vanished while locked"
        )


def _result(
    session: Session, status: DecksSyncStatus, current: dict[str, Any]
) -> DecksSyncResult:
    """Read the clock after everything ``current`` reflects."""
    server_time = session.execute(text("SELECT clock_timestamp()")).scalar_one()
    return DecksSyncResult(status, current, server_time)


def _local_track_exists(session: Session, uid: str) -> bool:
    return (
        session.execute(
            text(
                "SELECT 1 FROM library_tracks "
                "WHERE entity_uid = CAST(:uid AS uuid) LIMIT 1"
            ),
            {"uid": uid},
        ).first()
        is not None
    )


def _locked_cue_set(session: Session, user_id: int, uid: str) -> dict[str, Any]:
    rows = (
        session.execute(
            text(
                f"""
                SELECT {CUE_SET_COLUMNS}
                FROM user_track_cue_sets s
                LEFT JOIN user_track_cues c
                    ON c.user_id = s.user_id AND c.entity_uid = s.entity_uid
                WHERE s.user_id = :user_id AND s.entity_uid = CAST(:uid AS uuid)
                FOR UPDATE OF s
                """
            ),
            {"user_id": user_id, "uid": uid},
        )
        .mappings()
        .all()
    )
    return cue_sets_from_rows(rows).get(uid) or empty_cue_set(uid)


def _bump_cue_set(
    session: Session,
    user_id: int,
    uid: str,
    stored: Mapping[str, Any],
    client_id: str | None,
) -> int | None:
    """The set's new revision, or None when another first write won the race."""
    params = {"user_id": user_id, "uid": uid, "client_id": client_id}
    if stored["revision"] == 0:
        statement = """
            INSERT INTO user_track_cue_sets
                (user_id, entity_uid, revision, updated_at, client_id)
            VALUES (:user_id, CAST(:uid AS uuid), 1, now(), :client_id)
            ON CONFLICT (user_id, entity_uid) DO NOTHING
            RETURNING revision
        """
    else:
        statement = """
            UPDATE user_track_cue_sets
            SET revision = revision + 1, updated_at = now(), client_id = :client_id
            WHERE user_id = :user_id AND entity_uid = CAST(:uid AS uuid)
            RETURNING revision
        """
    return session.execute(text(statement), params).scalar_one_or_none()


def _replace_cues(
    session: Session,
    user_id: int,
    uid: str,
    cues: Sequence[Mapping[str, Any]],
    revision: int,
    client_id: str | None,
) -> None:
    # Delete first: a hot cue slot may pass from one cue type to another.
    session.execute(
        text(
            """
            DELETE FROM user_track_cues
            WHERE user_id = :user_id AND entity_uid = CAST(:uid AS uuid)
              AND (cue_type || ':' || slot::text) <> ALL(CAST(:keys AS text[]))
            """
        ),
        {
            "user_id": user_id,
            "uid": uid,
            "keys": [f"{cue['cue_type']}:{cue['slot']}" for cue in cues],
        },
    )
    if not cues:
        return
    # Unchanged cues keep the revision, time and client that last changed them.
    session.execute(
        text(
            """
            INSERT INTO user_track_cues
                (user_id, entity_uid, cue_type, slot, start_ms, end_ms, label, color,
                 revision, updated_at, client_id)
            VALUES
                (:user_id, CAST(:uid AS uuid), :cue_type, :slot, :start_ms, :end_ms,
                 :label, :color, :revision, now(), :client_id)
            ON CONFLICT (user_id, entity_uid, cue_type, slot) DO UPDATE SET
                start_ms = EXCLUDED.start_ms,
                end_ms = EXCLUDED.end_ms,
                label = EXCLUDED.label,
                color = EXCLUDED.color,
                revision = EXCLUDED.revision,
                updated_at = EXCLUDED.updated_at,
                client_id = EXCLUDED.client_id
            WHERE (
                user_track_cues.start_ms, user_track_cues.end_ms,
                user_track_cues.label, user_track_cues.color
            ) IS DISTINCT FROM (
                EXCLUDED.start_ms, EXCLUDED.end_ms, EXCLUDED.label, EXCLUDED.color
            )
            """
        ),
        [
            {
                "user_id": user_id,
                "uid": uid,
                "revision": revision,
                "client_id": client_id,
                **cue,
            }
            for cue in cues
        ],
    )


def _locked_correction(session: Session, user_id: int, uid: str) -> dict[str, Any]:
    row = (
        session.execute(
            text(
                f"""
                SELECT {CORRECTION_COLUMNS}
                FROM user_track_corrections
                WHERE user_id = :user_id AND entity_uid = CAST(:uid AS uuid)
                FOR UPDATE
                """
            ),
            {"user_id": user_id, "uid": uid},
        )
        .mappings()
        .first()
    )
    if row is not None:
        return correction_from_row(row)
    return {
        "entity_uid": uid,
        "revision": 0,
        "updated_at": None,
        "client_id": None,
        "bpm": None,
        "beat_grid_format": None,
        "beat_grid_ms": None,
        "key": None,
    }


def _write_correction(
    session: Session,
    user_id: int,
    uid: str,
    stored_revision: int,
    values: Mapping[str, Any],
    client_id: str | None,
) -> bool:
    """False when another first write of this correction won the race."""
    params = {"user_id": user_id, "uid": uid, "client_id": client_id, **values}
    if stored_revision == 0:
        statement = """
            INSERT INTO user_track_corrections
                (user_id, entity_uid, bpm, beat_grid_format, beat_grid_data, key,
                 revision, updated_at, client_id)
            VALUES
                (:user_id, CAST(:uid AS uuid), :bpm, :beat_grid_format,
                 :beat_grid_data, :key, 1, now(), :client_id)
            ON CONFLICT (user_id, entity_uid) DO NOTHING
            RETURNING revision
        """
    else:
        statement = """
            UPDATE user_track_corrections
            SET bpm = :bpm, beat_grid_format = :beat_grid_format,
                beat_grid_data = :beat_grid_data, key = :key,
                revision = revision + 1, updated_at = now(), client_id = :client_id
            WHERE user_id = :user_id AND entity_uid = CAST(:uid AS uuid)
            RETURNING revision
        """
    return session.execute(text(statement), params).scalar_one_or_none() is not None


__all__ = [
    "DecksSyncResult",
    "DecksSyncStatus",
    "put_decks_correction",
    "put_decks_cue_set",
]
