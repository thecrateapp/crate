from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.repositories.global_user_library import (
    mutate_global_track_like,
    project_local_album_save,
    project_local_artist_follow,
    remove_projected_local_album_save,
    remove_projected_local_artist_follow,
)
from crate.db.repositories.user_library_shared import (
    emit_user_domain_event,
    utc_now_iso,
)
from crate.db.tx import transaction_scope


def _has_changed(result: Any) -> bool:
    return int(getattr(result, "rowcount", 0) or 0) > 0


def follow_artist(user_id: int, artist_name: str) -> bool:
    now = utc_now_iso()
    with transaction_scope() as session:
        result = session.execute(
            text(
                """
                INSERT INTO user_follows (user_id, artist_name, created_at)
                VALUES (:user_id, :artist_name, :created_at)
                ON CONFLICT DO NOTHING
                """
            ),
            {"user_id": user_id, "artist_name": artist_name, "created_at": now},
        )
        changed = _has_changed(result)
        project_local_artist_follow(
            session,
            user_id=user_id,
            artist_name=artist_name,
        )
        if changed:
            emit_user_domain_event(
                session,
                event_type="user.follows.changed",
                user_id=user_id,
                payload={"action": "follow", "artist_name": artist_name},
            )
        return changed


def unfollow_artist(user_id: int, artist_name: str) -> bool:
    with transaction_scope() as session:
        result = session.execute(
            text(
                "DELETE FROM user_follows WHERE user_id = :user_id AND artist_name = :artist_name"
            ),
            {"user_id": user_id, "artist_name": artist_name},
        )
        changed = _has_changed(result)
        remove_projected_local_artist_follow(
            session,
            user_id=user_id,
            artist_name=artist_name,
        )
        if changed:
            emit_user_domain_event(
                session,
                event_type="user.follows.changed",
                user_id=user_id,
                payload={"action": "unfollow", "artist_name": artist_name},
            )
        return changed


def save_album(user_id: int, album_id: int) -> bool:
    now = utc_now_iso()
    with transaction_scope() as session:
        result = session.execute(
            text(
                """
                INSERT INTO user_saved_albums (user_id, album_id, created_at)
                VALUES (:user_id, :album_id, :created_at)
                ON CONFLICT DO NOTHING
                """
            ),
            {"user_id": user_id, "album_id": album_id, "created_at": now},
        )
        changed = _has_changed(result)
        project_local_album_save(
            session,
            user_id=user_id,
            album_id=album_id,
        )
        if changed:
            emit_user_domain_event(
                session,
                event_type="user.saved_albums.changed",
                user_id=user_id,
                payload={"action": "save", "album_id": album_id},
            )
        return changed


def unsave_album(user_id: int, album_id: int) -> bool:
    with transaction_scope() as session:
        result = session.execute(
            text(
                "DELETE FROM user_saved_albums WHERE user_id = :user_id AND album_id = :album_id"
            ),
            {"user_id": user_id, "album_id": album_id},
        )
        changed = _has_changed(result)
        remove_projected_local_album_save(
            session,
            user_id=user_id,
            album_id=album_id,
        )
        if changed:
            emit_user_domain_event(
                session,
                event_type="user.saved_albums.changed",
                user_id=user_id,
                payload={"action": "unsave", "album_id": album_id},
            )
        return changed


def like_track(
    user_id: int,
    track_id: int | None = None,
    *,
    global_track_uid: str | None = None,
    track_entity_uid: str | None = None,
    track_path: str | None = None,
) -> bool | None:
    return mutate_global_track_like(
        user_id,
        liked=True,
        global_track_uid=global_track_uid,
        track_id=track_id,
        track_entity_uid=track_entity_uid,
        track_path=track_path,
    )


def unlike_track(
    user_id: int,
    track_id: int | None = None,
    *,
    global_track_uid: str | None = None,
    track_entity_uid: str | None = None,
    track_path: str | None = None,
) -> bool:
    return bool(
        mutate_global_track_like(
            user_id,
            liked=False,
            global_track_uid=global_track_uid,
            track_id=track_id,
            track_entity_uid=track_entity_uid,
            track_path=track_path,
        )
    )


__all__ = [
    "follow_artist",
    "like_track",
    "save_album",
    "unfollow_artist",
    "unlike_track",
    "unsave_album",
]
