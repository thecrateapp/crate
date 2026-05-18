from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import text

from crate.db.tx import optional_scope


def _serialize_row(row: Any) -> dict:
    data = dict(row)
    for key, value in list(data.items()):
        if isinstance(value, datetime):
            data[key] = value.isoformat()
    return data


def record_album_contribution(
    *,
    user_id: int,
    source: str,
    source_ref: str,
    album_id: int | None,
    album_entity_uid: str | None,
    artist_name: str,
    album_name: str,
    track_entity_uids: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
    session=None,
) -> dict:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                INSERT INTO library_contributions (
                    user_id,
                    source,
                    source_ref,
                    album_id,
                    album_entity_uid,
                    artist_name,
                    album_name,
                    track_entity_uids,
                    metadata_json,
                    status,
                    imported_at,
                    withdrawn_at
                )
                VALUES (
                    :user_id,
                    :source,
                    :source_ref,
                    :album_id,
                    CAST(:album_entity_uid AS uuid),
                    :artist_name,
                    :album_name,
                    CAST(:track_entity_uids AS uuid[]),
                    CAST(:metadata_json AS jsonb),
                    'active',
                    NOW(),
                    NULL
                )
                ON CONFLICT (user_id, source, source_ref)
                DO UPDATE SET
                    album_id = COALESCE(EXCLUDED.album_id, library_contributions.album_id),
                    album_entity_uid = COALESCE(
                        EXCLUDED.album_entity_uid,
                        library_contributions.album_entity_uid
                    ),
                    artist_name = EXCLUDED.artist_name,
                    album_name = EXCLUDED.album_name,
                    track_entity_uids = EXCLUDED.track_entity_uids,
                    metadata_json = EXCLUDED.metadata_json,
                    status = 'active',
                    withdrawn_at = NULL
                RETURNING *
                """),
                {
                    "user_id": user_id,
                    "source": source,
                    "source_ref": source_ref,
                    "album_id": album_id,
                    "album_entity_uid": album_entity_uid,
                    "artist_name": artist_name,
                    "album_name": album_name,
                    "track_entity_uids": track_entity_uids or [],
                    "metadata_json": json.dumps(metadata or {}),
                },
            )
            .mappings()
            .one()
        )
    return _serialize_row(row)


def list_album_contributors(album_id: int, *, session=None) -> list[dict]:
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text("""
                SELECT
                    lc.*,
                    u.email AS user_email,
                    u.username AS user_username,
                    u.name AS user_name,
                    u.avatar AS user_avatar
                FROM library_contributions lc
                JOIN users u ON u.id = lc.user_id
                WHERE lc.album_id = :album_id
                  AND lc.status = 'active'
                ORDER BY lc.imported_at ASC
                """),
                {"album_id": album_id},
            )
            .mappings()
            .all()
        )
    return [_serialize_row(row) for row in rows]


def get_user_album_contribution(
    *,
    user_id: int,
    contribution_id: int,
    source: str = "",
    session=None,
) -> dict | None:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                SELECT
                    lc.*,
                    la.path AS album_path,
                    la.slug AS album_slug,
                    la.has_cover,
                    la.track_count,
                    la.total_duration
                FROM library_contributions lc
                LEFT JOIN library_albums la ON la.id = lc.album_id
                WHERE lc.id = :contribution_id
                  AND lc.user_id = :user_id
                  AND (:source = '' OR lc.source = :source)
                LIMIT 1
                """),
                {
                    "user_id": user_id,
                    "contribution_id": contribution_id,
                    "source": source,
                },
            )
            .mappings()
            .first()
        )
    return _serialize_row(row) if row else None


def mark_album_contribution_withdrawn(
    *,
    user_id: int,
    contribution_id: int,
    source: str = "",
    session=None,
) -> dict | None:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                UPDATE library_contributions
                SET status = 'withdrawn',
                    withdrawn_at = NOW()
                WHERE id = :contribution_id
                  AND user_id = :user_id
                  AND (:source = '' OR source = :source)
                  AND status = 'active'
                RETURNING *
                """),
                {
                    "user_id": user_id,
                    "contribution_id": contribution_id,
                    "source": source,
                },
            )
            .mappings()
            .first()
        )
    return _serialize_row(row) if row else None


def count_active_album_contributors(
    album_id: int,
    *,
    exclude_user_id: int | None = None,
    session=None,
) -> int:
    with optional_scope(session) as s:
        row = (
            s.execute(
                text("""
                SELECT COUNT(*) AS count
                FROM library_contributions
                WHERE album_id = :album_id
                  AND status = 'active'
                  AND (:exclude_user_id IS NULL OR user_id != :exclude_user_id)
                """),
                {"album_id": album_id, "exclude_user_id": exclude_user_id},
            )
            .mappings()
            .one()
        )
    return int(row["count"] or 0)


def list_user_album_contributions(
    user_id: int,
    *,
    source: str = "",
    status: str = "active",
    session=None,
) -> list[dict]:
    with optional_scope(session) as s:
        rows = (
            s.execute(
                text("""
                SELECT
                    lc.*,
                    la.slug AS album_slug,
                    la.has_cover,
                    la.path AS album_path
                FROM library_contributions lc
                LEFT JOIN library_albums la ON la.id = lc.album_id
                WHERE lc.user_id = :user_id
                  AND (:status = '' OR lc.status = :status)
                  AND (:source = '' OR lc.source = :source)
                ORDER BY lc.imported_at DESC
                """),
                {"user_id": user_id, "source": source, "status": status},
            )
            .mappings()
            .all()
        )
    return [_serialize_row(row) for row in rows]


__all__ = [
    "count_active_album_contributors",
    "get_user_album_contribution",
    "list_album_contributors",
    "list_user_album_contributions",
    "mark_album_contribution_withdrawn",
    "record_album_contribution",
]
