"""Resolve the active buffer with indexed, batched identity lookups."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope

_LEGACY_BUFFER_CONTEXT_SQL = """
            SELECT id AS track_id, entity_uid, title, artist, bliss_vector,
                   bpm, audio_key, audio_scale, energy, year, duration
            FROM library_tracks
            WHERE (id = ANY(:ids) OR entity_uid = ANY(CAST(:uids AS uuid[])))
              AND bliss_vector IS NOT NULL
        """

_BUFFER_CONTEXT_SQL = """
    WITH requested_globals AS MATERIALIZED (
        SELECT global_track_uid, local_track_id, local_track_entity_uid,
               canonical_title, artist_name, duration_seconds
        FROM global_catalog_tracks
        WHERE global_track_uid = ANY(CAST(:uids AS uuid[]))
    )
    SELECT id AS track_id, entity_uid, title, artist, bliss_vector,
           bpm, audio_key, audio_scale, energy, year, duration,
           NULL::uuid AS global_track_uid
    FROM library_tracks
    WHERE id = ANY(CAST(:ids AS bigint[]))
    UNION ALL
    SELECT id AS track_id, entity_uid, title, artist, bliss_vector,
           bpm, audio_key, audio_scale, energy, year, duration,
           NULL::uuid AS global_track_uid
    FROM library_tracks
    WHERE entity_uid = ANY(CAST(:uids AS uuid[]))
    UNION ALL
    SELECT COALESCE(by_id.id, by_entity.id) AS track_id,
           COALESCE(by_id.entity_uid, by_entity.entity_uid) AS entity_uid,
           COALESCE(NULLIF(by_id.title, ''), NULLIF(by_entity.title, ''),
                    gct.canonical_title) AS title,
           COALESCE(NULLIF(by_id.artist, ''), NULLIF(by_entity.artist, ''),
                    gct.artist_name) AS artist,
           COALESCE(by_id.bliss_vector, by_entity.bliss_vector) AS bliss_vector,
           COALESCE(by_id.bpm, by_entity.bpm) AS bpm,
           COALESCE(by_id.audio_key, by_entity.audio_key) AS audio_key,
           COALESCE(by_id.audio_scale, by_entity.audio_scale) AS audio_scale,
           COALESCE(by_id.energy, by_entity.energy) AS energy,
           COALESCE(by_id.year, by_entity.year) AS year,
           COALESCE(by_id.duration, by_entity.duration, gct.duration_seconds) AS duration,
           gct.global_track_uid
    FROM requested_globals gct
    LEFT JOIN LATERAL (
        SELECT id, entity_uid, title, artist, bliss_vector,
               bpm, audio_key, audio_scale, energy, year, duration
        FROM library_tracks WHERE id = gct.local_track_id LIMIT 1
    ) by_id ON TRUE
    LEFT JOIN LATERAL (
        SELECT id, entity_uid, title, artist, bliss_vector,
               bpm, audio_key, audio_scale, energy, year, duration
        FROM library_tracks WHERE entity_uid = gct.local_track_entity_uid LIMIT 1
    ) by_entity ON TRUE
"""


def get_buffer_context(
    refs: list[str],
    *,
    include_global: bool = True,
    session: Session | None = None,
) -> list[dict]:
    """Resolve aliases once, retaining the original local-only path for rollback."""
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

    def _impl(current: Session) -> list[dict]:
        rows = (
            current.execute(
                text(
                    _BUFFER_CONTEXT_SQL
                    if include_global
                    else _LEGACY_BUFFER_CONTEXT_SQL
                ),
                {"ids": ids, "uids": uids},
            )
            .mappings()
            .all()
        )
        if not include_global:
            return sorted(
                (dict(row) for row in rows),
                key=lambda row: max(
                    positions.get(str(row["track_id"]), -1),
                    positions.get(str(row["entity_uid"]), -1),
                ),
            )
        resolved: dict[tuple[str, str], tuple[int, dict]] = {}
        for item in rows:
            row = dict(item)
            position = max(
                positions.get(str(row.get("track_id")), -1),
                positions.get(str(row.get("entity_uid")), -1),
                positions.get(str(row.get("global_track_uid")), -1),
            )
            identity = (
                ("local", str(row["track_id"]))
                if row.get("track_id") is not None
                else ("global", str(row.get("global_track_uid")))
            )
            existing = resolved.get(identity)
            if (
                existing is None
                or position > existing[0]
                or (position == existing[0] and row.get("global_track_uid") is not None)
            ):
                resolved[identity] = (position, row)
        return [row for _, row in sorted(resolved.values(), key=lambda item: item[0])]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["get_buffer_context"]
