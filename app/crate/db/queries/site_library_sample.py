from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.queries.playable_media_filters import (
    playable_media_params,
    playable_track_clause,
)
from crate.db.tx import read_scope


def get_bliss_sample(
    *, limit: int, seed: float, session: Session | None = None
) -> list[dict]:
    def _impl(current: Session) -> list[dict]:
        rows = current.execute(
            text(
                f"""
                SELECT t.id AS track_id, t.title, t.artist, t.genre, t.bpm, t.audio_key,
                       t.bliss_vector
                FROM library_tracks t
                JOIN library_albums a ON t.album_id = a.id
                WHERE t.bliss_vector IS NOT NULL
                  AND cardinality(t.bliss_vector) = 20
                  AND {playable_track_clause("t", "a")}
                ORDER BY md5(t.id::text || :seed)
                LIMIT :limit
                """
            ),
            {"limit": limit, "seed": repr(seed), **playable_media_params()},
        ).mappings()
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["get_bliss_sample"]
