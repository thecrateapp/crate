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
                    LEFT JOIN crate_albums ca ON ca.crate_id = c.id
                    LEFT JOIN global_catalog_albums album
                      ON album.global_album_uid = ca.global_album_uid
                    WHERE c.id = CAST(:crate_id AS uuid)
                    GROUP BY c.id
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
                        ) AS album_count
                    FROM crates c
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
                        ) AS album_count
                    FROM crates c
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


__all__ = [
    "CrateAccess",
    "get_crate",
    "get_crate_access",
    "get_crates_for_user",
    "get_public_crates_for_user",
]
