"""Stored path row queries."""

from __future__ import annotations

from contextlib import nullcontext

from sqlalchemy import text

from crate.db.tx import read_scope
from crate.db.queries.playable_media_filters import (
    playable_track_clause,
    playable_media_params,
)


def get_music_path_row(path_id: int, user_id: int, *, session=None) -> dict | None:
    with nullcontext(session) if session is not None else read_scope() as current:
        row = (
            current.execute(
                text(
                    f"""
                SELECT id, name, origin_type, origin_value, origin_label,
                       dest_type, dest_value, dest_label, waypoints, step_count,
                       COALESCE((
                           SELECT jsonb_agg(entry.value || jsonb_build_object(
                               'format', lt.format, 'bitrate', lt.bitrate,
                               'sample_rate', lt.sample_rate, 'bit_depth', lt.bit_depth,
                               'duration', lt.duration, 'path', lt.path,
                               'bpm', lt.bpm, 'audio_key', lt.audio_key,
                               'audio_scale', lt.audio_scale,
                               'playable', COALESCE(lt.id IS NOT NULL AND la.id IS NOT NULL
                                   AND NULLIF(lt.path, '') IS NOT NULL
                                   AND {playable_track_clause("lt", "la")}, FALSE)
                           ) ORDER BY entry.ordinality)
                           FROM jsonb_array_elements(music_paths.tracks) WITH ORDINALITY AS entry(value, ordinality)
                           LEFT JOIN library_tracks lt ON lt.id = (entry.value->>'track_id')::integer
                           LEFT JOIN library_albums la ON la.id = lt.album_id
                       ), '[]'::jsonb) AS tracks, generation_metadata, created_at, updated_at
                FROM music_paths
                WHERE id = :id AND user_id = :user_id
                """
                ),
                {"id": path_id, "user_id": user_id, **playable_media_params()},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


def list_music_path_rows(user_id: int, *, session=None) -> list[dict]:
    with nullcontext(session) if session is not None else read_scope() as current:
        rows = (
            current.execute(
                text(
                    """
                SELECT id, name, origin_type, origin_value, origin_label,
                       dest_type, dest_value, dest_label, waypoints, step_count,
                       jsonb_array_length(tracks) AS track_count, generation_metadata,
                       created_at, updated_at
                FROM music_paths
                WHERE user_id = :user_id
                ORDER BY created_at DESC
                """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


__all__ = ["get_music_path_row", "list_music_path_rows"]
