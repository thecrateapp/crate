"""Read queries for Listen Crates."""

from __future__ import annotations

from typing import Literal

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope

CrateAccess = Literal["owner", "collaborator", "public", "none"]


def get_crate(crate_id: str, *, session: Session | None = None) -> dict | None:
    def _impl(current: Session) -> dict | None:
        row = (
            current.execute(
                text(
                    """
                    SELECT
                        c.id::text AS id,
                        c.owner_id,
                        owner.username AS owner_username,
                        owner.name AS owner_name,
                        owner.avatar AS owner_avatar,
                        c.name,
                        c.description,
                        c.visibility,
                        c.is_collaborative,
                        c.created_at,
                        c.updated_at,
                        COALESCE(
                            jsonb_agg(
                                jsonb_build_object(
                                    'global_album_uid', ca.global_album_uid::text,
                                    'position', ca.position,
                                    'name', album.canonical_name,
                                    'artist_name', album.artist_name,
                                    'year', album.year,
                                    'has_cover', album.has_cover,
                                    'artwork_source_json', album.artwork_source_json
                                ) ORDER BY ca.position
                            ) FILTER (WHERE ca.global_album_uid IS NOT NULL),
                            '[]'::jsonb
                        ) AS albums
                    FROM crates c
                    JOIN users owner ON owner.id = c.owner_id
                    LEFT JOIN crate_albums ca ON ca.crate_id = c.id
                    LEFT JOIN global_catalog_albums album
                      ON album.global_album_uid = ca.global_album_uid
                    WHERE c.id = CAST(:crate_id AS uuid)
                    GROUP BY c.id, owner.id
                    """
                ),
                {"crate_id": crate_id},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_crate_playback_tracks(
    crate_id: str, *, session: Session | None = None
) -> list[dict]:
    """Flatten available catalog tracks in crate, disc, and track order."""

    def _impl(current: Session) -> list[dict]:
        rows = (
            current.execute(
                text(
                    """
                    SELECT
                        track.global_track_uid::text AS global_track_uid,
                        track.global_album_uid::text AS global_album_uid,
                        track.global_artist_uid::text AS global_artist_uid,
                        track.local_track_id,
                        track.local_track_entity_uid::text AS local_track_entity_uid,
                        track.canonical_title AS title,
                        track.artist_name AS artist,
                        track.album_name AS album,
                        track.duration_seconds AS duration,
                        track.disc_number,
                        track.track_number
                    FROM crate_albums crate_album
                    JOIN global_catalog_tracks track
                      ON track.global_album_uid = crate_album.global_album_uid
                    WHERE crate_album.crate_id = CAST(:crate_id AS uuid)
                      AND (track.has_local IS TRUE OR track.has_remote IS TRUE)
                    ORDER BY crate_album.position,
                             COALESCE(track.disc_number, 1),
                             COALESCE(track.track_number, 0),
                             track.canonical_title,
                             track.global_track_uid
                    """
                ),
                {"crate_id": crate_id},
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_crates_for_user(user_id: int, *, session: Session | None = None) -> list[dict]:
    def _impl(current: Session) -> list[dict]:
        rows = (
            current.execute(
                text(
                    """
                    WITH visible_crates AS (
                        SELECT
                            c.id,
                            c.owner_id,
                            owner.username AS owner_username,
                            owner.name AS owner_name,
                            c.name,
                            c.description,
                            c.visibility,
                            c.is_collaborative,
                            c.created_at,
                            c.updated_at,
                            CASE WHEN c.owner_id = :user_id
                                THEN 'owner' ELSE 'collaborator' END AS access
                        FROM crates c
                        JOIN users owner ON owner.id = c.owner_id
                        WHERE c.owner_id = :user_id
                           OR (
                               c.is_collaborative IS TRUE
                               AND EXISTS (
                                   SELECT 1
                                   FROM crate_members member
                                   WHERE member.crate_id = c.id
                                     AND member.user_id = :user_id
                               )
                           )
                    ),
                    crate_album_summary AS (
                        SELECT
                            ca.crate_id,
                            COUNT(*)::integer AS album_count,
                            jsonb_agg(
                                jsonb_build_object(
                                    'global_album_uid', album.global_album_uid::text,
                                    'position', ca.position,
                                    'name', album.canonical_name,
                                    'artist_name', album.artist_name,
                                    'year', album.year,
                                    'has_cover', album.has_cover,
                                    'artwork_source_json', album.artwork_source_json
                                ) ORDER BY ca.position
                            ) -> 0 AS first_album
                        FROM visible_crates visible
                        JOIN crate_albums ca ON ca.crate_id = visible.id
                        JOIN global_catalog_albums album
                          ON album.global_album_uid = ca.global_album_uid
                        GROUP BY ca.crate_id
                    )
                    SELECT
                        visible.id::text AS id,
                        visible.owner_id,
                        visible.owner_username,
                        visible.owner_name,
                        visible.name,
                        visible.description,
                        visible.visibility,
                        visible.is_collaborative,
                        visible.created_at,
                        visible.updated_at,
                        COALESCE(summary.album_count, 0) AS album_count,
                        summary.first_album,
                        visible.access
                    FROM visible_crates visible
                    LEFT JOIN crate_album_summary summary
                      ON summary.crate_id = visible.id
                    ORDER BY visible.updated_at DESC, visible.id
                    """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_public_crates_for_user(
    user_id: int, *, session: Session | None = None
) -> list[dict]:
    def _impl(current: Session) -> list[dict]:
        rows = (
            current.execute(
                text(
                    """
                    WITH visible_crates AS (
                        SELECT
                            c.id,
                            c.owner_id,
                            owner.username AS owner_username,
                            owner.name AS owner_name,
                            c.name,
                            c.description,
                            c.visibility,
                            c.is_collaborative,
                            c.created_at,
                            c.updated_at
                        FROM crates c
                        JOIN users owner ON owner.id = c.owner_id
                        WHERE c.owner_id = :user_id
                          AND c.visibility = 'public'
                    ),
                    crate_album_summary AS (
                        SELECT
                            ca.crate_id,
                            COUNT(*)::integer AS album_count,
                            jsonb_agg(
                                jsonb_build_object(
                                    'global_album_uid', album.global_album_uid::text,
                                    'position', ca.position,
                                    'name', album.canonical_name,
                                    'artist_name', album.artist_name,
                                    'year', album.year,
                                    'has_cover', album.has_cover,
                                    'artwork_source_json', album.artwork_source_json
                                ) ORDER BY ca.position
                            ) -> 0 AS first_album
                        FROM visible_crates visible
                        JOIN crate_albums ca ON ca.crate_id = visible.id
                        JOIN global_catalog_albums album
                          ON album.global_album_uid = ca.global_album_uid
                        GROUP BY ca.crate_id
                    )
                    SELECT
                        visible.id::text AS id,
                        visible.owner_id,
                        visible.owner_username,
                        visible.owner_name,
                        visible.name,
                        visible.description,
                        visible.visibility,
                        visible.is_collaborative,
                        visible.created_at,
                        visible.updated_at,
                        COALESCE(summary.album_count, 0) AS album_count,
                        summary.first_album
                    FROM visible_crates visible
                    LEFT JOIN crate_album_summary summary
                      ON summary.crate_id = visible.id
                    ORDER BY visible.updated_at DESC, visible.id
                    """
                ),
                {"user_id": user_id},
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_crate_access(
    crate_id: str, user_id: int | None, *, session: Session | None = None
) -> CrateAccess:
    def _impl(current: Session) -> CrateAccess:
        access = current.execute(
            text(
                """
                SELECT CASE
                    WHEN :user_id IS NOT NULL AND c.owner_id = :user_id
                        THEN 'owner'
                    WHEN :user_id IS NOT NULL
                         AND c.is_collaborative IS TRUE
                         AND EXISTS (
                             SELECT 1
                             FROM crate_members member
                             WHERE member.crate_id = c.id
                               AND member.user_id = :user_id
                         )
                        THEN 'collaborator'
                    WHEN c.visibility = 'public' THEN 'public'
                    ELSE 'none'
                END AS access
                FROM crates c
                WHERE c.id = CAST(:crate_id AS uuid)
                """
            ),
            {"crate_id": crate_id, "user_id": user_id},
        ).scalar_one_or_none()
        return access or "none"

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_crate_members(crate_id: str, *, session: Session | None = None) -> list[dict]:
    def _impl(current: Session) -> list[dict]:
        rows = (
            current.execute(
                text(
                    """
                    SELECT
                        member.crate_id::text AS crate_id,
                        member.user_id,
                        member.invited_by,
                        member.created_at,
                        member_user.username,
                        member_user.name AS display_name,
                        member_user.avatar
                    FROM crate_members member
                    JOIN users member_user ON member_user.id = member.user_id
                    WHERE member.crate_id = CAST(:crate_id AS uuid)
                    ORDER BY member.created_at, member.user_id
                    """
                ),
                {"crate_id": crate_id},
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_crate_invite(token: str, *, session: Session | None = None) -> dict | None:
    def _impl(current: Session) -> dict | None:
        row = (
            current.execute(
                text(
                    """
                    SELECT
                        crate.id::text AS crate_id,
                        crate.name AS crate_name,
                        owner.name AS owner_name,
                        owner.username AS owner_username,
                        invite.expires_at
                    FROM crate_invites invite
                    JOIN crates crate ON crate.id = invite.crate_id
                    JOIN users owner ON owner.id = crate.owner_id
                    WHERE invite.token = :token
                      AND crate.is_collaborative IS TRUE
                      AND (invite.expires_at IS NULL OR invite.expires_at > NOW())
                      AND (invite.max_uses IS NULL OR invite.use_count < invite.max_uses)
                    """
                ),
                {"token": token},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = [
    "CrateAccess",
    "get_crate",
    "get_crate_access",
    "get_crate_playback_tracks",
    "get_crates_for_user",
    "get_crate_invite",
    "get_crate_members",
    "get_public_crates_for_user",
]
