"""Read queries for Listen Crates."""

from __future__ import annotations

import re
from typing import Literal
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope
from crate.slugs import build_crate_slug

CrateAccess = Literal["owner", "collaborator", "public", "none"]
CrateListScope = Literal["member", "public_owned", "followed"]

_CRATE_LIST_SCOPES: dict[str, str] = {
    "member": """
        SELECT
            c.*,
            owner.username AS owner_username,
            owner.name AS owner_name,
            CASE WHEN c.owner_id = :user_id THEN 'owner' ELSE 'collaborator' END
                AS access,
            NULL::timestamptz AS followed_at
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
    """,
    "public_owned": """
        SELECT
            c.*,
            owner.username AS owner_username,
            owner.name AS owner_name,
            NULL::text AS access,
            NULL::timestamptz AS followed_at
        FROM crates c
        JOIN users owner ON owner.id = c.owner_id
        WHERE c.owner_id = :user_id
          AND c.visibility = 'public'
    """,
    "followed": """
        SELECT
            c.*,
            owner.username AS owner_username,
            owner.name AS owner_name,
            NULL::text AS access,
            follower.followed_at
        FROM crate_followers follower
        JOIN crates c ON c.id = follower.crate_id
        JOIN users owner ON owner.id = c.owner_id
        WHERE follower.user_id = :user_id
          AND c.visibility = 'public'
    """,
}


_SHORT_CODE_RE = re.compile(r"^[0-9A-Za-z]{8}$")


def crate_public_ref(name: str | None, short_code: str) -> str:
    return f"{build_crate_slug(name)}-{short_code}"


def _with_public_ref(crate: dict) -> dict:
    if crate.get("short_code"):
        crate["public_ref"] = crate_public_ref(crate.get("name"), crate["short_code"])
    return crate


def resolve_crate_ref(ref: str, *, session: Session | None = None) -> str | None:
    """Resolve a Crate UUID or ``{slug}-{short_code}`` ref to its UUID."""

    try:
        return str(UUID(str(ref)))
    except (TypeError, ValueError):
        pass
    short_code = str(ref or "").rsplit("-", 1)[-1]
    if not _SHORT_CODE_RE.match(short_code):
        return None

    def _impl(current: Session) -> str | None:
        return current.execute(
            text("SELECT id::text FROM crates WHERE short_code = :short_code"),
            {"short_code": short_code},
        ).scalar_one_or_none()

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def _is_descending(crate: dict) -> bool:
    return bool(crate.get("is_ordered", True)) and crate.get("sort_direction") == "desc"


def get_crate(
    crate_id: str,
    user_id: int | None = None,
    *,
    session: Session | None = None,
) -> dict | None:
    def _impl(current: Session) -> dict | None:
        row = (
            current.execute(
                text(
                    """
                    SELECT
                        c.id::text AS id,
                        c.short_code,
                        c.owner_id,
                        owner.username AS owner_username,
                        owner.name AS owner_name,
                        owner.avatar AS owner_avatar,
                        c.name,
                        c.description,
                        c.visibility,
                        c.is_collaborative,
                        c.is_ordered,
                        c.sort_direction,
                        c.loop_enabled,
                        c.created_at,
                        c.updated_at,
                        (
                            SELECT COUNT(*)::integer
                            FROM crate_albums crate_album_count
                            WHERE crate_album_count.crate_id = c.id
                        ) AS album_count,
                        (
                            SELECT COUNT(*)::integer
                            FROM crate_albums crate_album_count
                            JOIN global_catalog_tracks track_count
                              ON track_count.global_album_uid = crate_album_count.global_album_uid
                            WHERE crate_album_count.crate_id = c.id
                        ) AS track_count,
                        (
                            SELECT COUNT(*)::integer
                            FROM crate_followers follower
                            WHERE follower.crate_id = c.id
                        ) AS follower_count,
                        (
                            CAST(:user_id AS integer) IS NOT NULL
                            AND EXISTS (
                                SELECT 1
                                FROM crate_followers follower
                                WHERE follower.crate_id = c.id
                                  AND follower.user_id = :user_id
                            )
                        ) AS is_followed,
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
                {"crate_id": crate_id, "user_id": user_id},
            )
            .mappings()
            .first()
        )
        return _with_public_ref(dict(row)) if row else None

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
                    JOIN crates crate
                      ON crate.id = crate_album.crate_id
                    JOIN global_catalog_tracks track
                      ON track.global_album_uid = crate_album.global_album_uid
                    WHERE crate_album.crate_id = CAST(:crate_id AS uuid)
                      AND (track.has_local IS TRUE OR track.has_remote IS TRUE)
                    ORDER BY CASE
                                 WHEN crate.is_ordered IS TRUE
                                  AND crate.sort_direction = 'desc'
                                     THEN -crate_album.position
                                 ELSE crate_album.position
                             END,
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


def get_crate_for_user(
    crate_id: str,
    user_id: int | None,
    *,
    session: Session | None = None,
) -> tuple[dict | None, CrateAccess]:
    """Return a Crate and its access level using one read transaction."""

    def _impl(current: Session) -> tuple[dict | None, CrateAccess]:
        access = get_crate_access(crate_id, user_id, session=current)
        if access == "none":
            return None, access
        return get_crate(crate_id, user_id=user_id, session=current), access

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_crate_genre_rows(
    crate_id: str, *, limit: int = 6, session: Session | None = None
) -> list[dict]:
    """Aggregate local album genres, giving every Crate album the same weight."""

    def _impl(current: Session) -> list[dict]:
        rows = (
            current.execute(
                text(
                    """
                    WITH album_weights AS (
                        SELECT
                            genre.name,
                            genre.slug,
                            COALESCE(album_genre.weight, 0) AS weight,
                            SUM(COALESCE(album_genre.weight, 0)) OVER (
                                PARTITION BY album_genre.album_id
                            ) AS album_total
                        FROM crate_albums crate_album
                        JOIN global_catalog_albums album
                          ON album.global_album_uid = crate_album.global_album_uid
                        JOIN album_genres album_genre
                          ON album_genre.album_id = album.local_album_id
                        JOIN genres genre
                          ON genre.id = album_genre.genre_id
                        WHERE crate_album.crate_id = CAST(:crate_id AS uuid)
                    )
                    SELECT
                        name,
                        slug,
                        SUM(
                            CASE WHEN album_total > 0 THEN weight / album_total ELSE 0 END
                        )::float AS weight
                    FROM album_weights
                    GROUP BY name, slug
                    ORDER BY weight DESC, name ASC
                    LIMIT :limit
                    """
                ),
                {"crate_id": crate_id, "limit": limit},
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_crate_detail_for_user(
    crate_id: str, user_id: int | None
) -> tuple[dict | None, CrateAccess, list[dict]]:
    """Return a Crate, its access level and genre rows in one read transaction."""

    with read_scope() as current:
        crate, access = get_crate_for_user(crate_id, user_id, session=current)
        if crate is None:
            return None, access, []
        return crate, access, get_crate_genre_rows(crate_id, session=current)


def get_crate_playback_tracks_for_user(
    crate_id: str,
    user_id: int,
    *,
    session: Session | None = None,
) -> list[dict] | None:
    """Return playback tracks only when the user can access the Crate."""

    def _impl(current: Session) -> list[dict] | None:
        if get_crate_access(crate_id, user_id, session=current) == "none":
            return None
        return get_crate_playback_tracks(crate_id, session=current)

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_crate_offline_tracks_for_user(
    crate_id: str,
    user_id: int,
    *,
    session: Session | None = None,
) -> tuple[dict | None, list[dict] | None]:
    """Return an accessible Crate and its local tracks for offline transfer."""

    def _impl(current: Session) -> tuple[dict | None, list[dict] | None]:
        if get_crate_access(crate_id, user_id, session=current) == "none":
            return None, None
        crate = get_crate(crate_id, user_id=user_id, session=current)
        if crate is None:
            return None, None
        rows = (
            current.execute(
                text(
                    """
                    SELECT
                        lt.*,
                        album.slug AS album_slug,
                        crate_album.position AS crate_position,
                        catalog_track.disc_number,
                        catalog_track.track_number
                    FROM crate_albums crate_album
                    JOIN global_catalog_tracks catalog_track
                      ON catalog_track.global_album_uid = crate_album.global_album_uid
                    JOIN LATERAL (
                        SELECT candidate.*
                        FROM library_tracks candidate
                        WHERE candidate.id = catalog_track.local_track_id
                           OR candidate.entity_uid = catalog_track.local_track_entity_uid
                        ORDER BY (candidate.id = catalog_track.local_track_id)
                                 DESC NULLS LAST
                        LIMIT 1
                    ) lt ON TRUE
                    LEFT JOIN library_albums album ON album.id = lt.album_id
                    WHERE crate_album.crate_id = CAST(:crate_id AS uuid)
                    ORDER BY CASE
                                 WHEN :descending THEN -crate_album.position
                                 ELSE crate_album.position
                             END,
                             COALESCE(catalog_track.disc_number, 1),
                             COALESCE(catalog_track.track_number, 0),
                             lt.title,
                             lt.id
                    """
                ),
                {
                    "crate_id": crate_id,
                    "descending": _is_descending(crate),
                },
            )
            .mappings()
            .all()
        )
        unique_rows: list[dict] = []
        seen_track_ids: set[int] = set()
        for row in rows:
            if row["id"] in seen_track_ids:
                continue
            seen_track_ids.add(row["id"])
            unique_rows.append(dict(row))
        return crate, unique_rows

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_crate_download_source(
    crate_id: str, *, session: Session | None = None
) -> tuple[dict | None, list[dict]]:
    """Return the Crate identity and its ordered local tracks for ZIP packaging."""

    def _impl(current: Session) -> tuple[dict | None, list[dict]]:
        crate = (
            current.execute(
                text(
                    """
                    SELECT
                        id::text AS id,
                        name,
                        is_ordered,
                        sort_direction
                    FROM crates
                    WHERE id = CAST(:crate_id AS uuid)
                    """
                ),
                {"crate_id": crate_id},
            )
            .mappings()
            .first()
        )
        if crate is None:
            return None, []
        crate = dict(crate)
        rows = (
            current.execute(
                text(
                    """
                    SELECT
                        lt.id,
                        lt.path,
                        lt.size,
                        lt.updated_at,
                        lt.artist,
                        lt.album
                    FROM crate_albums crate_album
                    JOIN global_catalog_tracks catalog_track
                      ON catalog_track.global_album_uid = crate_album.global_album_uid
                    JOIN LATERAL (
                        SELECT
                            candidate.id,
                            candidate.path,
                            candidate.size,
                            candidate.updated_at,
                            candidate.artist,
                            candidate.album,
                            candidate.title
                        FROM library_tracks candidate
                        WHERE candidate.id = catalog_track.local_track_id
                           OR candidate.entity_uid = catalog_track.local_track_entity_uid
                        ORDER BY (candidate.id = catalog_track.local_track_id)
                                 DESC NULLS LAST
                        LIMIT 1
                    ) lt ON TRUE
                    WHERE crate_album.crate_id = CAST(:crate_id AS uuid)
                      AND COALESCE(lt.path, '') <> ''
                    ORDER BY CASE
                                 WHEN :descending THEN -crate_album.position
                                 ELSE crate_album.position
                             END,
                             COALESCE(catalog_track.disc_number, 1),
                             COALESCE(catalog_track.track_number, 0),
                             lt.title,
                             lt.id
                    """
                ),
                {"crate_id": crate_id, "descending": _is_descending(crate)},
            )
            .mappings()
            .all()
        )
        tracks: list[dict] = []
        seen_track_ids: set[int] = set()
        for row in rows:
            if row["id"] in seen_track_ids:
                continue
            seen_track_ids.add(row["id"])
            tracks.append(dict(row))
        return crate, tracks

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_crate_download_source_for_user(
    crate_id: str,
    user_id: int,
    *,
    session: Session | None = None,
) -> tuple[dict | None, list[dict]]:
    def _impl(current: Session) -> tuple[dict | None, list[dict]]:
        if get_crate_access(crate_id, user_id, session=current) == "none":
            return None, []
        return get_crate_download_source(crate_id, session=current)

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_active_crate_invites(
    crate_id: str, *, session: Session | None = None
) -> list[dict]:
    def _impl(current: Session) -> list[dict]:
        rows = (
            current.execute(
                text(
                    """
                    SELECT
                        invite.token,
                        invite.crate_id::text AS crate_id,
                        invite.created_by,
                        invite.created_at,
                        invite.expires_at,
                        invite.max_uses,
                        invite.use_count
                    FROM crate_invites invite
                    JOIN crates crate ON crate.id = invite.crate_id
                    WHERE invite.crate_id = CAST(:crate_id AS uuid)
                      AND crate.is_collaborative IS TRUE
                      AND (invite.expires_at IS NULL OR invite.expires_at > NOW())
                      AND (
                          invite.max_uses IS NULL
                          OR invite.use_count < invite.max_uses
                      )
                    ORDER BY invite.created_at DESC, invite.token
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


def _list_crates(
    user_id: int,
    *,
    scope: CrateListScope,
    viewer_id: int | None,
    session: Session | None = None,
) -> list[dict]:
    visible_crates_sql = _CRATE_LIST_SCOPES[scope]

    def _impl(current: Session) -> list[dict]:
        rows = (
            current.execute(
                text(
                    f"""
                    WITH visible_crates AS ({visible_crates_sql}),
                    crate_album_previews AS (
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
                                ) ORDER BY ca.position, ca.global_album_uid
                            ) AS albums
                        FROM visible_crates visible
                        JOIN crate_albums ca ON ca.crate_id = visible.id
                        JOIN global_catalog_albums album
                          ON album.global_album_uid = ca.global_album_uid
                        GROUP BY ca.crate_id
                    ),
                    crate_track_counts AS (
                        SELECT
                            ca.crate_id,
                            COUNT(track.global_track_uid)::integer AS track_count
                        FROM visible_crates visible
                        JOIN crate_albums ca ON ca.crate_id = visible.id
                        JOIN global_catalog_tracks track
                          ON track.global_album_uid = ca.global_album_uid
                        GROUP BY ca.crate_id
                    ),
                    crate_follower_counts AS (
                        SELECT
                            follower.crate_id,
                            COUNT(*)::integer AS follower_count,
                            BOOL_OR(follower.user_id = :viewer_id) AS is_followed
                        FROM visible_crates visible
                        JOIN crate_followers follower
                          ON follower.crate_id = visible.id
                        GROUP BY follower.crate_id
                    )
                    SELECT
                        visible.id::text AS id,
                        visible.short_code,
                        visible.owner_id,
                        visible.owner_username,
                        visible.owner_name,
                        visible.name,
                        visible.description,
                        visible.visibility,
                        visible.is_collaborative,
                        visible.is_ordered,
                        visible.sort_direction,
                        visible.loop_enabled,
                        visible.created_at,
                        visible.updated_at,
                        COALESCE(previews.album_count, 0) AS album_count,
                        previews.albums -> 0 AS first_album,
                        COALESCE(previews.albums, '[]'::jsonb) AS albums,
                        COALESCE(track_counts.track_count, 0) AS track_count,
                        COALESCE(followers.follower_count, 0) AS follower_count,
                        COALESCE(followers.is_followed, FALSE) AS is_followed,
                        visible.access
                    FROM visible_crates visible
                    LEFT JOIN crate_album_previews previews
                      ON previews.crate_id = visible.id
                    LEFT JOIN crate_track_counts track_counts
                      ON track_counts.crate_id = visible.id
                    LEFT JOIN crate_follower_counts followers
                      ON followers.crate_id = visible.id
                    ORDER BY visible.followed_at DESC NULLS LAST,
                             visible.updated_at DESC,
                             visible.id
                    """
                ),
                {"user_id": user_id, "viewer_id": viewer_id},
            )
            .mappings()
            .all()
        )
        result = [_with_public_ref(dict(row)) for row in rows]
        if scope != "member":
            for row in result:
                row.pop("access", None)
        return result

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_crates_for_user(user_id: int, *, session: Session | None = None) -> list[dict]:
    return _list_crates(
        user_id,
        scope="member",
        viewer_id=user_id,
        session=session,
    )


def get_public_crates_for_user(
    user_id: int,
    *,
    viewer_id: int | None = None,
    session: Session | None = None,
) -> list[dict]:
    return _list_crates(
        user_id,
        scope="public_owned",
        viewer_id=viewer_id,
        session=session,
    )


def get_followed_crates_for_user(
    user_id: int, *, session: Session | None = None
) -> list[dict]:
    return _list_crates(
        user_id,
        scope="followed",
        viewer_id=user_id,
        session=session,
    )


def is_album_in_public_crate(
    crate_id: str, global_album_uid: str, *, session: Session | None = None
) -> bool:
    def _impl(current: Session) -> bool:
        return bool(
            current.execute(
                text(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM crate_albums crate_album
                        JOIN crates crate ON crate.id = crate_album.crate_id
                        WHERE crate_album.crate_id = CAST(:crate_id AS uuid)
                          AND crate_album.global_album_uid = CAST(:album_uid AS uuid)
                          AND crate.visibility = 'public'
                    )
                    """
                ),
                {"crate_id": crate_id, "album_uid": global_album_uid},
            ).scalar_one()
        )

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
                        crate_id,
                        user_id,
                        invited_by,
                        created_at,
                        username,
                        name,
                        name AS display_name,
                        avatar,
                        role
                    FROM (
                        SELECT
                            crate.id::text AS crate_id,
                            crate.owner_id AS user_id,
                            NULL::integer AS invited_by,
                            crate.created_at,
                            owner.username,
                            owner.name,
                            owner.avatar,
                            'owner' AS role,
                            0 AS role_order
                        FROM crates crate
                        JOIN users owner ON owner.id = crate.owner_id
                        WHERE crate.id = CAST(:crate_id AS uuid)
                        UNION ALL
                        SELECT
                            member.crate_id::text,
                            member.user_id,
                            member.invited_by,
                            member.created_at,
                            member_user.username,
                            member_user.name,
                            member_user.avatar,
                            'collaborator',
                            1
                        FROM crate_members member
                        JOIN users member_user ON member_user.id = member.user_id
                        WHERE member.crate_id = CAST(:crate_id AS uuid)
                    ) crate_member_rows
                    ORDER BY role_order, created_at, user_id
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


def get_crate_invite(
    token: str, user_id: int | None = None, *, session: Session | None = None
) -> dict | None:
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
                      AND (
                          invite.max_uses IS NULL
                          OR invite.use_count < invite.max_uses
                          OR EXISTS (
                              SELECT 1
                              FROM crate_members member
                              WHERE member.crate_id = invite.crate_id
                                AND member.user_id = :user_id
                          )
                      )
                    """
                ),
                {"token": token, "user_id": user_id},
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
    "CrateListScope",
    "crate_public_ref",
    "get_crate",
    "get_active_crate_invites",
    "get_crate_access",
    "get_crate_download_source",
    "get_crate_download_source_for_user",
    "get_crate_detail_for_user",
    "get_crate_for_user",
    "get_crate_genre_rows",
    "get_crate_playback_tracks",
    "get_crate_playback_tracks_for_user",
    "get_crate_offline_tracks_for_user",
    "get_crates_for_user",
    "get_crate_invite",
    "get_crate_members",
    "get_followed_crates_for_user",
    "get_public_crates_for_user",
    "is_album_in_public_crate",
    "resolve_crate_ref",
]
