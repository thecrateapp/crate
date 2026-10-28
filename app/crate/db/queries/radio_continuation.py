"""Resolve the active buffer with indexed, batched identity lookups."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope


def get_buffer_context(
    refs: list[str], *, session: Session | None = None
) -> list[dict]:
    positions: dict[str, int] = {}
    ids: list[int] = []
    uids: list[str] = []
    for index, ref in enumerate(refs):
        if ref.isdecimal() and 0 < int(ref) <= 2**63 - 1:
            ids.append(int(ref))
            positions[str(int(ref))] = index
        else:
            try:
                uid = str(UUID(ref))
            except ValueError:
                continue
            uids.append(uid)
            positions[uid] = index
    if not ids and not uids:
        return []

    def read(current):
        rows = (
            current.execute(
                text("""
            SELECT id AS track_id, entity_uid, title, artist, bliss_vector,
                   bpm, audio_key, audio_scale, energy, year, duration
            FROM library_tracks
            WHERE (id = ANY(:ids) OR entity_uid = ANY(CAST(:uids AS uuid[])))
              AND bliss_vector IS NOT NULL
        """),
                {"ids": ids, "uids": uids},
            )
            .mappings()
            .all()
        )
        return sorted(
            (dict(row) for row in rows),
            key=lambda row: max(
                positions.get(str(row["track_id"]), -1),
                positions.get(str(row["entity_uid"]), -1),
            ),
        )

    if session is not None:
        return read(session)
    with read_scope() as current:
        return read(current)
