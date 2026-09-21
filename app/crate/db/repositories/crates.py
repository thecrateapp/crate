"""Listen Crate persistence operations."""

from __future__ import annotations

from collections.abc import Sequence
import secrets

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import optional_scope


class CrateNotFoundError(LookupError):
    """Raised when a Crate does not exist."""


class CrateAlbumNotFoundError(LookupError):
    """Raised when an album is not present in the global catalog."""


class CrateAlbumAlreadyExistsError(ValueError):
    """Raised when an album is already in the Crate."""


class InvalidCrateAlbumOrderError(ValueError):
    """Raised when a reorder omits, repeats, or adds an album."""


class CrateCollaborationDisabledError(ValueError):
    """Raised when an invite is requested for a non-collaborative Crate."""


class CrateAccessDeniedError(PermissionError):
    """Raised when a write is attempted without current Crate access."""


def _lock_crate_for_write(
    current: Session,
    crate_id: str,
    *,
    actor_id: int,
    owner_only: bool = False,
) -> dict:
    row = (
        current.execute(
            text(
                """
                SELECT
                    c.id::text AS crate_id,
                    c.owner_id,
                    c.is_collaborative,
                    CASE
                        WHEN c.owner_id = :actor_id
                            THEN 'owner'
                        WHEN c.is_collaborative IS TRUE
                             AND EXISTS (
                                 SELECT 1
                                 FROM crate_members member
                                 WHERE member.crate_id = c.id
                                   AND member.user_id = :actor_id
                             )
                            THEN 'collaborator'
                        ELSE 'none'
                    END AS access
                FROM crates c
                WHERE c.id = CAST(:crate_id AS uuid)
                FOR UPDATE
                """
            ),
            {"actor_id": actor_id, "crate_id": crate_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        raise CrateNotFoundError(crate_id)

    access = row["access"]
    if access == "none" or (owner_only and access != "owner"):
        raise CrateAccessDeniedError(crate_id)
    return dict(row)


def create_crate(
    owner_id: int,
    name: str,
    description: str = "",
    is_collaborative: bool = False,
    *,
    session: Session | None = None,
) -> str:
    with optional_scope(session) as current:
        crate_id = current.execute(
            text(
                """
                INSERT INTO crates (owner_id, name, description, is_collaborative)
                VALUES (:owner_id, :name, :description, :is_collaborative)
                RETURNING id::text
                """
            ),
            {
                "owner_id": owner_id,
                "name": name,
                "description": description,
                "is_collaborative": is_collaborative,
            },
        ).scalar_one()
    return str(crate_id)


def update_crate(
    crate_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    visibility: str | None = None,
    is_collaborative: bool | None = None,
    actor_id: int,
    session: Session | None = None,
) -> bool:
    updates = {
        key: value
        for key, value in {
            "name": name,
            "description": description,
            "visibility": visibility,
            "is_collaborative": is_collaborative,
        }.items()
        if value is not None
    }
    assignments = ", ".join(f"{column} = :{column}" for column in updates)
    with optional_scope(session) as current:
        _lock_crate_for_write(
            current,
            crate_id,
            actor_id=actor_id,
            owner_only=actor_id is not None
            and (visibility is not None or is_collaborative is not None),
        )
        if not updates:
            return True

        result = current.execute(
            text(
                f"""
                UPDATE crates
                SET {assignments}, updated_at = NOW()
                WHERE id = CAST(:crate_id AS uuid)
                RETURNING id
                """
            ),
            {**updates, "crate_id": crate_id},
        ).scalar_one_or_none()
        if result is None:
            return False

        if is_collaborative is False:
            current.execute(
                text("DELETE FROM crate_members WHERE crate_id = CAST(:id AS uuid)"),
                {"id": crate_id},
            )
            current.execute(
                text("DELETE FROM crate_invites WHERE crate_id = CAST(:id AS uuid)"),
                {"id": crate_id},
            )
    return True


def add_crate_album(
    crate_id: str,
    global_album_uid: str,
    *,
    added_by: int,
    session: Session | None = None,
) -> dict:
    with optional_scope(session) as current:
        _lock_crate_for_write(current, crate_id, actor_id=added_by)

        album_exists = current.execute(
            text(
                """
                SELECT 1 FROM global_catalog_albums
                WHERE global_album_uid = CAST(:uid AS uuid)
                """
            ),
            {"uid": global_album_uid},
        ).scalar_one_or_none()
        if album_exists is None:
            raise CrateAlbumNotFoundError(global_album_uid)

        position = current.execute(
            text(
                """
                SELECT COALESCE(MAX(position) + 1, 0)
                FROM crate_albums
                WHERE crate_id = CAST(:crate_id AS uuid)
                """
            ),
            {"crate_id": crate_id},
        ).scalar_one()
        added = (
            current.execute(
                text(
                    """
                    WITH inserted AS (
                        INSERT INTO crate_albums (
                            crate_id, global_album_uid, position, added_by
                        ) VALUES (
                            CAST(:crate_id AS uuid), CAST(:album_uid AS uuid),
                            :position, :added_by
                        )
                        ON CONFLICT (crate_id, global_album_uid) DO NOTHING
                        RETURNING global_album_uid, position
                    )
                    SELECT
                        inserted.global_album_uid::text AS global_album_uid,
                        inserted.position,
                        album.canonical_name AS name,
                        album.artist_name,
                        album.year,
                        album.has_cover,
                        album.artwork_source_json
                    FROM inserted
                    JOIN global_catalog_albums album
                      ON album.global_album_uid = inserted.global_album_uid
                    """
                ),
                {
                    "crate_id": crate_id,
                    "album_uid": global_album_uid,
                    "position": position,
                    "added_by": added_by,
                },
            )
            .mappings()
            .first()
        )
        if added is None:
            raise CrateAlbumAlreadyExistsError(global_album_uid)

        current.execute(
            text("UPDATE crates SET updated_at = NOW() WHERE id = CAST(:id AS uuid)"),
            {"id": crate_id},
        )
        return dict(added)


def remove_crate_album(
    crate_id: str,
    global_album_uid: str,
    *,
    actor_id: int,
    session: Session | None = None,
) -> bool:
    with optional_scope(session) as current:
        _lock_crate_for_write(current, crate_id, actor_id=actor_id)

        removed_position = current.execute(
            text(
                """
                DELETE FROM crate_albums
                WHERE crate_id = CAST(:crate_id AS uuid)
                  AND global_album_uid = CAST(:album_uid AS uuid)
                RETURNING position
                """
            ),
            {"crate_id": crate_id, "album_uid": global_album_uid},
        ).scalar_one_or_none()
        if removed_position is None:
            return False

        position_offset = current.execute(
            text(
                """
                SELECT COALESCE(MAX(position)::bigint, -1) + 1
                FROM crate_albums
                WHERE crate_id = CAST(:crate_id AS uuid)
                """
            ),
            {"crate_id": crate_id},
        ).scalar_one()
        current.execute(
            text(
                """
                UPDATE crate_albums
                SET position = position + :position_offset
                WHERE crate_id = CAST(:crate_id AS uuid)
                  AND position > :removed_position
                """
            ),
            {
                "crate_id": crate_id,
                "position_offset": position_offset,
                "removed_position": removed_position,
            },
        )
        current.execute(
            text(
                """
                UPDATE crate_albums
                SET position = position - :position_offset - 1
                WHERE crate_id = CAST(:crate_id AS uuid)
                  AND position >= :position_offset
                """
            ),
            {"crate_id": crate_id, "position_offset": position_offset},
        )
        current.execute(
            text("UPDATE crates SET updated_at = NOW() WHERE id = CAST(:id AS uuid)"),
            {"id": crate_id},
        )
    return True


def reorder_crate_albums(
    crate_id: str,
    global_album_uids: Sequence[str],
    *,
    actor_id: int,
    session: Session | None = None,
) -> None:
    requested = [str(album_uid) for album_uid in global_album_uids]
    if len(requested) != len(set(requested)):
        raise InvalidCrateAlbumOrderError("Album ids must not repeat")

    with optional_scope(session) as current:
        _lock_crate_for_write(current, crate_id, actor_id=actor_id)

        current_ids = set(
            current.execute(
                text(
                    """
                    SELECT global_album_uid::text
                    FROM crate_albums
                    WHERE crate_id = CAST(:crate_id AS uuid)
                    """
                ),
                {"crate_id": crate_id},
            ).scalars()
        )
        if set(requested) != current_ids:
            raise InvalidCrateAlbumOrderError(
                "Order must contain each Crate album exactly once"
            )

        if requested:
            current.execute(
                text(
                    """
                    WITH position_offset AS (
                        SELECT COALESCE(MAX(position)::bigint, -1) + 1 AS value
                        FROM crate_albums
                        WHERE crate_id = CAST(:crate_id AS uuid)
                    )
                    UPDATE crate_albums album
                    SET position = album.position + position_offset.value
                    FROM position_offset
                    WHERE album.crate_id = CAST(:crate_id AS uuid)
                    """
                ),
                {"crate_id": crate_id},
            )
            current.execute(
                text(
                    """
                    UPDATE crate_albums
                    SET position = :position
                    WHERE crate_id = CAST(:crate_id AS uuid)
                      AND global_album_uid = CAST(:album_uid AS uuid)
                    """
                ),
                [
                    {"position": position, "crate_id": crate_id, "album_uid": uid}
                    for position, uid in enumerate(requested)
                ],
            )
        current.execute(
            text("UPDATE crates SET updated_at = NOW() WHERE id = CAST(:id AS uuid)"),
            {"id": crate_id},
        )


def delete_crate(
    crate_id: str,
    *,
    actor_id: int,
    session: Session | None = None,
) -> bool:
    with optional_scope(session) as current:
        _lock_crate_for_write(current, crate_id, actor_id=actor_id, owner_only=True)
        deleted = current.execute(
            text(
                """
                DELETE FROM crates
                WHERE id = CAST(:crate_id AS uuid)
                RETURNING id
                """
            ),
            {"crate_id": crate_id},
        ).scalar_one_or_none()
    return deleted is not None


def remove_crate_member(
    crate_id: str,
    user_id: int,
    *,
    actor_id: int,
    session: Session | None = None,
) -> bool:
    with optional_scope(session) as current:
        _lock_crate_for_write(current, crate_id, actor_id=actor_id, owner_only=True)
        removed = current.execute(
            text(
                """
                DELETE FROM crate_members
                WHERE crate_id = CAST(:crate_id AS uuid)
                  AND user_id = :user_id
                RETURNING user_id
                """
            ),
            {"crate_id": crate_id, "user_id": user_id},
        ).scalar_one_or_none()
    return removed is not None


def create_crate_invite(
    crate_id: str,
    created_by: int,
    *,
    expires_in_hours: int = 168,
    max_uses: int | None = 20,
    session: Session | None = None,
) -> dict:
    """Create an invite; ``expires_in_hours=0`` means no expiry."""

    if expires_in_hours < 0:
        raise ValueError("expires_in_hours must be non-negative")
    if max_uses is not None and max_uses < 1:
        raise ValueError("max_uses must be positive or None")

    token = secrets.token_urlsafe(24)

    with optional_scope(session) as current:
        crate = _lock_crate_for_write(
            current, crate_id, actor_id=created_by, owner_only=True
        )
        if not crate["is_collaborative"]:
            raise CrateCollaborationDisabledError(crate_id)

        row = (
            current.execute(
                text(
                    """
                    INSERT INTO crate_invites (
                        token, crate_id, created_by, expires_at, max_uses
                    ) VALUES (
                        :token, CAST(:crate_id AS uuid), :created_by,
                        CASE
                            WHEN :expires_in_hours > 0
                            THEN NOW() + make_interval(hours => :expires_in_hours)
                            ELSE NULL
                        END,
                        :max_uses
                    )
                    RETURNING
                        token,
                        crate_id::text AS crate_id,
                        created_by,
                        expires_at,
                        max_uses,
                        use_count,
                        created_at
                    """
                ),
                {
                    "token": token,
                    "crate_id": crate_id,
                    "created_by": created_by,
                    "expires_in_hours": expires_in_hours,
                    "max_uses": max_uses,
                },
            )
            .mappings()
            .one()
        )
        return dict(row)


def revoke_crate_invite(
    crate_id: str,
    token: str,
    *,
    actor_id: int,
    session: Session | None = None,
) -> bool:
    with optional_scope(session) as current:
        _lock_crate_for_write(current, crate_id, actor_id=actor_id, owner_only=True)
        revoked = current.execute(
            text(
                """
                DELETE FROM crate_invites
                WHERE crate_id = CAST(:crate_id AS uuid) AND token = :token
                RETURNING token
                """
            ),
            {"crate_id": crate_id, "token": token},
        ).scalar_one_or_none()
    return revoked is not None


def accept_crate_invite(
    token: str, user_id: int, *, session: Session | None = None
) -> dict | None:
    with optional_scope(session) as current:
        invite_crate_id = current.execute(
            text(
                """
                SELECT crate_id::text
                FROM crate_invites
                WHERE token = :token
                """
            ),
            {"token": token},
        ).scalar_one_or_none()
        if invite_crate_id is None:
            return None

        crate = (
            current.execute(
                text(
                    """
                    SELECT
                        id::text AS crate_id,
                        owner_id,
                        is_collaborative
                    FROM crates
                    WHERE id = CAST(:crate_id AS uuid)
                    FOR UPDATE
                    """
                ),
                {"crate_id": invite_crate_id},
            )
            .mappings()
            .first()
        )
        if crate is None:
            return None

        invite = (
            current.execute(
                text(
                    """
                    SELECT
                        invite.crate_id::text AS crate_id,
                        invite.created_by,
                        invite.max_uses,
                        invite.use_count
                    FROM crate_invites invite
                    WHERE invite.token = :token
                      AND (
                          invite.expires_at IS NULL OR invite.expires_at > NOW()
                      )
                    FOR UPDATE
                    """
                ),
                {"token": token},
            )
            .mappings()
            .first()
        )
        if invite is None:
            return None
        if invite["crate_id"] != crate["crate_id"]:
            return None
        if not crate["is_collaborative"] or crate["owner_id"] == user_id:
            return None

        existing_member = current.execute(
            text(
                """
                SELECT 1
                FROM crate_members
                WHERE crate_id = CAST(:crate_id AS uuid) AND user_id = :user_id
                """
            ),
            {"crate_id": invite["crate_id"], "user_id": user_id},
        ).scalar_one_or_none()
        if existing_member is not None:
            return {"crate_id": invite["crate_id"]}

        if invite["max_uses"] is not None and invite["use_count"] >= invite["max_uses"]:
            return None

        current.execute(
            text(
                """
                INSERT INTO crate_members (crate_id, user_id, invited_by)
                VALUES (CAST(:crate_id AS uuid), :user_id, :invited_by)
                ON CONFLICT (crate_id, user_id) DO NOTHING
                """
            ),
            {
                "crate_id": invite["crate_id"],
                "user_id": user_id,
                "invited_by": invite["created_by"],
            },
        )
        current.execute(
            text(
                "UPDATE crate_invites SET use_count = use_count + 1 WHERE token = :token"
            ),
            {"token": token},
        )
        return {"crate_id": invite["crate_id"]}


__all__ = [
    "CrateAlbumAlreadyExistsError",
    "CrateAlbumNotFoundError",
    "CrateAccessDeniedError",
    "CrateCollaborationDisabledError",
    "CrateNotFoundError",
    "InvalidCrateAlbumOrderError",
    "add_crate_album",
    "accept_crate_invite",
    "create_crate",
    "create_crate_invite",
    "delete_crate",
    "remove_crate_album",
    "remove_crate_member",
    "reorder_crate_albums",
    "revoke_crate_invite",
    "update_crate",
]
