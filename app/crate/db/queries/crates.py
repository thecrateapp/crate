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


def get_crates_for_user(user_id: int, *, session: Session | None = None) -> list[dict]:
    def _impl(current: Session) -> list[dict]:
        rows = (
            current.execute(
                text(
                    """
                    SELECT
                        c.id::text AS id,
                        c.owner_id,
                        owner.username AS owner_username,
                        owner.name AS owner_name,
                        c.name,
                        c.description,
                        c.visibility,
                        c.is_collaborative,
                        c.created_at,
                        c.updated_at,
                        (
                            SELECT COUNT(*)::integer
                            FROM crate_albums ca
                            WHERE ca.crate_id = c.id
                        ) AS album_count,
                        (
                            SELECT jsonb_build_object(
                                'global_album_uid', album.global_album_uid::text,
                                'position', ca.position,
                                'name', album.canonical_name,
                                'artist_name', album.artist_name,
                                'year', album.year,
                                'has_cover', album.has_cover,
                                'artwork_source_json', album.artwork_source_json
                            )
                            FROM crate_albums ca
                            JOIN global_catalog_albums album
                              ON album.global_album_uid = ca.global_album_uid
                            WHERE ca.crate_id = c.id
                            ORDER BY ca.position
                            LIMIT 1
                        ) AS first_album,
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
                    ORDER BY c.updated_at DESC, c.id
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
                    SELECT
                        c.id::text AS id,
                        c.owner_id,
                        owner.username AS owner_username,
                        owner.name AS owner_name,
                        c.name,
                        c.description,
                        c.visibility,
                        c.is_collaborative,
                        c.created_at,
                        c.updated_at,
                        (
                            SELECT COUNT(*)::integer
                            FROM crate_albums ca
                            WHERE ca.crate_id = c.id
                        ) AS album_count,
                        (
                            SELECT jsonb_build_object(
                                'global_album_uid', album.global_album_uid::text,
                                'position', ca.position,
                                'name', album.canonical_name,
                                'artist_name', album.artist_name,
                                'year', album.year,
                                'has_cover', album.has_cover,
                                'artwork_source_json', album.artwork_source_json
                            )
                            FROM crate_albums ca
                            JOIN global_catalog_albums album
                              ON album.global_album_uid = ca.global_album_uid
                            WHERE ca.crate_id = c.id
                            ORDER BY ca.position
                            LIMIT 1
                        ) AS first_album
                    FROM crates c
                    JOIN users owner ON owner.id = c.owner_id
                    WHERE c.owner_id = :user_id
                      AND c.visibility = 'public'
                    ORDER BY c.updated_at DESC, c.id
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
    "get_crates_for_user",
    "get_crate_invite",
    "get_crate_members",
    "get_public_crates_for_user",
]
