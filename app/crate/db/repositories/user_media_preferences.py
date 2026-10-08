from __future__ import annotations

import uuid

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope


def _resolve_track_identity(
    session, track_id: int | None, global_track_uid: str | None
) -> tuple[int | None, str | None]:
    if global_track_uid is not None:
        try:
            canonical_uid = str(uuid.UUID(str(global_track_uid)))
        except (ValueError, AttributeError) as error:
            raise ValueError("Invalid global track UID") from error
        row = (
            session.execute(
                text(
                    "SELECT local_track_id FROM global_catalog_tracks "
                    "WHERE global_track_uid = CAST(:uid AS uuid)"
                ),
                {"uid": canonical_uid},
            )
            .mappings()
            .first()
        )
        return (
            (
                int(row["local_track_id"]) if row and row["local_track_id"] else None,
                canonical_uid,
            )
            if row
            else (None, None)
        )

    if track_id is None:
        return None, None
    row = (
        session.execute(
            text(
                "SELECT track.id AS track_id, "
                "catalog.global_track_uid::text AS global_track_uid "
                "FROM library_tracks track "
                "LEFT JOIN global_catalog_tracks catalog "
                "ON catalog.local_track_id = track.id "
                "WHERE track.id = :track_id LIMIT 1"
            ),
            {"track_id": track_id},
        )
        .mappings()
        .first()
    )
    if row is None:
        return None, None
    return int(row["track_id"]), row["global_track_uid"]


def set_track_rating(
    user_id: int,
    track_id: int | None,
    rating: int,
    *,
    global_track_uid: str | None = None,
) -> bool:
    """Set one user's rating; zero removes it without changing library metadata."""
    if not isinstance(rating, int) or not 0 <= rating <= 5:
        raise ValueError("Rating must be between 0 and 5")
    with transaction_scope() as session:
        resolved_track_id, resolved_global_uid = _resolve_track_identity(
            session, track_id, global_track_uid
        )
        if resolved_track_id is None and resolved_global_uid is None:
            return False

        if rating == 0:
            session.execute(
                text(
                    "DELETE FROM user_track_ratings WHERE user_id = :user_id "
                    "AND ((:track_id IS NOT NULL AND track_id = :track_id) "
                    "OR (:global_uid IS NOT NULL AND global_track_uid = CAST(:global_uid AS uuid)))"
                ),
                {
                    "user_id": user_id,
                    "track_id": resolved_track_id,
                    "global_uid": resolved_global_uid,
                },
            )
            return True

        if resolved_global_uid:
            if resolved_track_id is not None:
                session.execute(
                    text(
                        "DELETE FROM user_track_ratings "
                        "WHERE user_id = :user_id AND track_id = :track_id "
                        "AND global_track_uid IS NULL"
                    ),
                    {"user_id": user_id, "track_id": resolved_track_id},
                )
            session.execute(
                text(
                    """
                    INSERT INTO user_track_ratings
                        (user_id, track_id, global_track_uid, rating, updated_at)
                    VALUES
                        (:user_id, :track_id, CAST(:global_uid AS uuid), :rating, NOW())
                    ON CONFLICT (user_id, global_track_uid)
                        WHERE global_track_uid IS NOT NULL
                    DO UPDATE SET track_id = EXCLUDED.track_id,
                                  rating = EXCLUDED.rating,
                                  updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "user_id": user_id,
                    "track_id": resolved_track_id,
                    "global_uid": resolved_global_uid,
                    "rating": rating,
                },
            )
        else:
            session.execute(
                text(
                    """
                    INSERT INTO user_track_ratings
                        (user_id, track_id, rating, updated_at)
                    VALUES (:user_id, :track_id, :rating, NOW())
                    ON CONFLICT (user_id, track_id) WHERE track_id IS NOT NULL
                    DO UPDATE SET rating = EXCLUDED.rating,
                                  updated_at = EXCLUDED.updated_at
                    """
                ),
                {"user_id": user_id, "track_id": resolved_track_id, "rating": rating},
            )
        return True


def get_track_rating(
    user_id: int,
    track_id: int | None = None,
    *,
    global_track_uid: str | None = None,
) -> int:
    with read_scope() as session:
        resolved_track_id, resolved_global_uid = _resolve_track_identity(
            session, track_id, global_track_uid
        )
        if resolved_track_id is None and resolved_global_uid is None:
            return 0
        row = (
            session.execute(
                text(
                    """
                    SELECT rating FROM user_track_ratings
                    WHERE user_id = :user_id
                      AND ((:track_id IS NOT NULL AND track_id = :track_id)
                        OR (:global_uid IS NOT NULL
                            AND global_track_uid = CAST(:global_uid AS uuid)))
                    ORDER BY (global_track_uid IS NOT NULL) DESC
                    LIMIT 1
                    """
                ),
                {
                    "user_id": user_id,
                    "track_id": resolved_track_id,
                    "global_uid": resolved_global_uid,
                },
            )
            .mappings()
            .first()
        )
    return int(row["rating"]) if row else 0


__all__ = ["get_track_rating", "set_track_rating"]
