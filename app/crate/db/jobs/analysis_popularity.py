"""Popularity and requeue helpers used by worker analysis handlers."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.jobs.analysis_shared import (
    append_pipeline_event,
    mark_ops_snapshot_dirty,
    requeue_filter_clauses,
    requeue_filter_params,
)
from crate.db.tx import transaction_scope


def _rowcount(result: object) -> int:
    return int(getattr(result, "rowcount", 0) or 0)


def get_albums_needing_popularity(artist_name: str) -> list[dict]:
    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT id, name, tag_album FROM library_albums "
                    "WHERE artist = :artist AND lastfm_listeners IS NULL"
                ),
                {"artist": artist_name},
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]


def update_album_popularity(album_id: int, listeners: int, playcount: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_albums SET lastfm_listeners = :listeners, lastfm_playcount = :playcount "
                "WHERE id = :id"
            ),
            {"listeners": listeners, "playcount": playcount, "id": album_id},
        )


def get_tracks_needing_popularity(artist_name: str, limit: int = 50) -> list[dict]:
    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT t.id, t.title FROM library_tracks t "
                    "JOIN library_albums a ON t.album_id = a.id "
                    "WHERE a.artist = :artist AND t.lastfm_listeners IS NULL "
                    "AND t.title IS NOT NULL AND t.title != '' LIMIT :lim"
                ),
                {"artist": artist_name, "lim": limit},
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]


def update_track_popularity(track_id: int, listeners: int, playcount: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET lastfm_listeners = :listeners, lastfm_playcount = :playcount "
                "WHERE id = :id"
            ),
            {"listeners": listeners, "playcount": playcount, "id": track_id},
        )


def requeue_tracks(
    set_clause: str,
    track_id: int | None = None,
    album_id: int | None = None,
    artist: str | None = None,
    album_name: str | None = None,
    scope: str | None = None,
    pipelines: list[str] | None = None,
) -> int:
    """Requeue tracks for analysis/bliss pipeline reprocessing.

    The ``set_clause`` is constructed internally by the caller
    (``worker_handlers/analysis.py``) from hardcoded column assignments
    such as ``analysis_state = 'pending'``.  It is not derived from
    user input and therefore does not use SQL parameter binding.
    """
    filters = requeue_filter_clauses(
        track_id=track_id,
        album_id=album_id,
        artist=artist,
        album_name=album_name,
        scope=scope,
    )
    params = requeue_filter_params(track_id, album_id, artist, album_name)
    requested = sorted(set(pipelines or []))
    if set(requested) - {"analysis", "bliss"}:
        raise ValueError("Unsupported analysis pipeline")
    with transaction_scope() as session:
        ids = list(
            session.execute(
                text(f"SELECT id FROM library_tracks WHERE {filters} ORDER BY id"),
                params,
            ).scalars()
        )
        if not ids:
            return 0
        if requested:
            session.execute(
                text(
                    "INSERT INTO track_processing_state(track_id,pipeline,state) SELECT t.id,p.pipeline,'pending' FROM library_tracks t CROSS JOIN unnest(CAST(:pipelines AS text[])) p(pipeline) WHERE t.id=ANY(:ids) ON CONFLICT(track_id,pipeline) DO NOTHING"
                ),
                {"ids": ids, "pipelines": requested},
            )
            from crate.db.jobs.analysis_generations import lock_processing_rows

            lock_processing_rows(session, ids, requested)
            session.execute(
                text(
                    "UPDATE track_processing_state SET state='pending',generation=generation+1,claim_token=NULL,pipeline_signature=NULL,claimed_by=NULL,claimed_at=NULL,last_error=NULL,completed_at=NULL,updated_at=NOW() WHERE track_id=ANY(:ids) AND pipeline=ANY(:pipelines)"
                ),
                {"ids": ids, "pipelines": requested},
            )
        # SQL_SAFE: set_clause is an internal closed assignment list from the worker.
        result = session.execute(
            text(f"UPDATE library_tracks SET {set_clause} WHERE id=ANY(:ids)"),
            {"ids": ids},
        )
        for pipeline in requested:
            append_pipeline_event(
                session, pipeline=pipeline, track_id=track_id, state="pending"
            )
        mark_ops_snapshot_dirty(session)
        return _rowcount(result)


__all__ = [
    "get_albums_needing_popularity",
    "get_tracks_needing_popularity",
    "requeue_tracks",
    "update_album_popularity",
    "update_track_popularity",
]
