"""Authoritative queue state for Jam Sessions."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _track_payloads_match(left: dict, right: dict) -> bool:
    identity_keys = (
        ("globalTrackUid", "global_track_uid"),
        ("entityUid", "entity_uid"),
        ("id",),
        ("path",),
    )
    for keys in identity_keys:
        left_value = next((left.get(key) for key in keys if left.get(key)), None)
        right_value = next((right.get(key) for key in keys if right.get(key)), None)
        if left_value is not None and right_value is not None:
            if str(left_value) == str(right_value):
                return True
    return False


def _canonicalize_track_payload(session, payload: dict) -> dict:
    """Attach stable library identities and artwork metadata to a Jam track."""
    if not isinstance(payload, dict):
        return payload

    numeric_id = None
    for key in ("libraryTrackId", "library_track_id", "track_id", "id"):
        value = payload.get(key)
        if isinstance(value, int) and value > 0:
            numeric_id = value
            break
        if isinstance(value, str) and value.isdigit() and int(value) > 0:
            numeric_id = int(value)
            break

    entity_uid = next(
        (
            str(payload.get(key))
            for key in ("entityUid", "entity_uid", "track_entity_uid")
            if payload.get(key)
        ),
        None,
    )
    path = next(
        (str(payload.get(key)) for key in ("path", "track_path") if payload.get(key)),
        None,
    )
    if numeric_id is None and entity_uid is None and path is None:
        return payload

    conditions = []
    params: dict[str, object] = {}
    if numeric_id is not None:
        conditions.append("t.id = :track_id")
        params["track_id"] = numeric_id
    if entity_uid is not None:
        conditions.append("t.entity_uid::text = :entity_uid")
        params["entity_uid"] = entity_uid
    if path is not None:
        conditions.append("t.path = :track_path")
        params["track_path"] = path

    row = (
        session.execute(
            text(
                f"""
                SELECT
                    t.id,
                    t.entity_uid::text AS entity_uid,
                    t.path,
                    COALESCE(NULLIF(t.title, ''), t.filename) AS title,
                    t.artist,
                    t.album,
                    t.duration,
                    t.album_id,
                    a.entity_uid::text AS album_entity_uid,
                    a.slug AS album_slug,
                    t.bpm,
                    t.genre,
                    t.bliss_vector
                FROM library_tracks t
                LEFT JOIN library_albums a ON a.id = t.album_id
                WHERE {" OR ".join(conditions)}
                ORDER BY CASE
                    WHEN t.id = :track_id THEN 0
                    WHEN t.entity_uid::text = :entity_uid THEN 1
                    ELSE 2
                END
                LIMIT 1
                """
            ),
            {**params, "track_id": numeric_id, "entity_uid": entity_uid},
        )
        .mappings()
        .first()
    )
    if row is None:
        return payload

    canonical = dict(payload)
    canonical.update(
        {
            "libraryTrackId": int(row["id"]),
            "entityUid": row["entity_uid"],
            "path": row["path"],
            "title": row["title"],
            "artist": row["artist"],
            "album": row["album"],
            "duration": row["duration"],
            "albumId": row["album_id"],
            "albumEntityUid": row["album_entity_uid"],
            "albumSlug": row["album_slug"],
            "bpm": row["bpm"],
            "genre": row["genre"],
        }
    )
    if row["bliss_vector"] is not None:
        canonical["blissVector"] = list(row["bliss_vector"])
    if row["entity_uid"]:
        canonical.setdefault("globalTrackUid", row["entity_uid"])
    return canonical


def _serialize_queue_item(row: dict) -> dict:
    item = dict(row)
    item["id"] = str(item["id"])
    item["track"] = item.pop("track_payload")
    item["vote_count"] = int(item.get("vote_count") or 0)
    item["voted_by_me"] = bool(item.get("voted_by_me"))
    return item


def add_jam_queue_item(
    room_id: str,
    track: dict,
    added_by: int,
    *,
    source: str = "owner",
) -> dict:
    now = _now()
    with transaction_scope() as session:
        track = _canonicalize_track_payload(session, track)
        # Serialize queue additions per room. This closes the race where two
        # browser tabs submit the same current track at the same time.
        session.execute(
            text("SELECT id FROM jam_rooms WHERE id = :room_id FOR UPDATE"),
            {"room_id": room_id},
        ).scalar_one()
        existing_rows = (
            session.execute(
                text(
                    """
                    SELECT q.*, 0::bigint AS vote_count, false AS voted_by_me
                    FROM jam_room_queue_items q
                    WHERE q.room_id = :room_id
                      AND q.status IN ('queued', 'playing')
                    ORDER BY q.position ASC, q.created_at ASC, q.id ASC
                    FOR UPDATE
                    """
                ),
                {"room_id": room_id},
            )
            .mappings()
            .all()
        )
        for existing_row in existing_rows:
            existing_track = existing_row.get("track_payload")
            if isinstance(existing_track, dict) and _track_payloads_match(
                track, existing_track
            ):
                duplicate = _serialize_queue_item(dict(existing_row))
                duplicate["_deduplicated"] = True
                return duplicate
        position = session.execute(
            text(
                """
                SELECT COALESCE(MAX(position), -1) + 1
                FROM jam_room_queue_items
                WHERE room_id = :room_id AND status IN ('queued', 'playing')
                """
            ),
            {"room_id": room_id},
        ).scalar_one()
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO jam_room_queue_items
                        (room_id, track_payload, added_by, source, position, created_at)
                    VALUES
                        (:room_id, CAST(:track AS jsonb), :added_by, :source, :position, :created_at)
                    RETURNING *, 0::bigint AS vote_count, false AS voted_by_me
                    """
                ),
                {
                    "room_id": room_id,
                    "track": json.dumps(track),
                    "added_by": added_by,
                    "source": source,
                    "position": position,
                    "created_at": now,
                },
            )
            .mappings()
            .one()
        )
    item = _serialize_queue_item(dict(row))
    item["_deduplicated"] = False
    return item


def list_jam_queue_items(room_id: str, *, user_id: int | None = None) -> list[dict]:
    with transaction_scope() as session:
        queue_mode = (
            session.execute(
                text("SELECT queue_mode FROM jam_rooms WHERE id = :room_id"),
                {"room_id": room_id},
            ).scalar_one_or_none()
            or "manual"
        )
        rows = [
            dict(row)
            for row in (
                session.execute(
                    text(
                        """
                    SELECT
                        q.*,
                        COUNT(v.user_id)::int AS vote_count,
                        COALESCE(BOOL_OR(v.user_id = :user_id), false) AS voted_by_me
                    FROM jam_room_queue_items q
                    LEFT JOIN jam_room_queue_votes v
                      ON v.room_id = q.room_id AND v.queue_item_id = q.id
                    WHERE q.room_id = :room_id
                      AND q.status IN ('queued', 'playing')
                    GROUP BY q.id
                    ORDER BY
                        CASE WHEN q.status = 'playing' THEN 0 ELSE 1 END,
                        CASE WHEN :queue_mode IN ('auto', 'auto_dj') THEN COUNT(v.user_id) ELSE 0 END DESC,
                        q.position ASC,
                        q.created_at ASC,
                        q.id ASC
                    """
                    ),
                    {"room_id": room_id, "user_id": user_id, "queue_mode": queue_mode},
                )
                .mappings()
                .all()
            )
        ]
        for row in rows:
            payload = row.get("track_payload")
            if isinstance(payload, dict):
                row["track_payload"] = _canonicalize_track_payload(session, payload)
    return [_serialize_queue_item(dict(row)) for row in rows]


def list_jam_queue_vote_tracks(room_id: str) -> list[dict]:
    """Return active voted tracks in the shape required by queue shaping."""
    with transaction_scope() as session:
        rows = [
            dict(row)
            for row in (
                session.execute(
                    text(
                        """
                        SELECT q.track_payload, COUNT(v.user_id)::int AS vote_count
                        FROM jam_room_queue_items q
                        JOIN jam_room_queue_votes v
                          ON v.room_id = q.room_id AND v.queue_item_id = q.id
                        WHERE q.room_id = :room_id
                          AND q.status IN ('queued', 'playing')
                        GROUP BY q.id
                        ORDER BY COUNT(v.user_id) DESC, q.position ASC, q.id ASC
                        """
                    ),
                    {"room_id": room_id},
                )
                .mappings()
                .all()
            )
        ]

        result: list[dict] = []
        for row in rows:
            payload = row.get("track_payload")
            if not isinstance(payload, dict):
                continue
            payload = _canonicalize_track_payload(session, payload)
            vector = payload.get("blissVector") or payload.get("bliss_vector")
            if not isinstance(vector, list) or not vector:
                continue
            result.append(
                {"bliss_vector": vector, "vote_count": int(row["vote_count"])}
            )
        return result


def remove_jam_queue_item(room_id: str, queue_item_id: str | int) -> bool:
    with transaction_scope() as session:
        result = session.execute(
            text(
                """
                UPDATE jam_room_queue_items
                SET status = 'removed', completed_at = :completed_at
                WHERE room_id = :room_id
                  AND id = :queue_item_id
                  AND status IN ('queued', 'playing')
                """
            ),
            {
                "room_id": room_id,
                "queue_item_id": int(queue_item_id),
                "completed_at": _now(),
            },
        )
    return bool(getattr(result, "rowcount", 0))


def advance_jam_queue(room_id: str) -> dict | None:
    """Mark the current item as played and atomically select the next item."""
    with transaction_scope() as session:
        room_payload = session.execute(
            text(
                """
                SELECT current_track_payload
                FROM jam_rooms
                WHERE id = :room_id
                FOR UPDATE
                """
            ),
            {"room_id": room_id},
        ).scalar_one_or_none()
        current_track = (
            room_payload.get("track")
            if isinstance(room_payload, dict)
            and isinstance(room_payload.get("track"), dict)
            else None
        )
        playing_id = session.execute(
            text(
                """
                SELECT id
                FROM jam_room_queue_items
                WHERE room_id = :room_id AND status = 'playing'
                ORDER BY position ASC, id ASC
                LIMIT 1
                FOR UPDATE
                """
            ),
            {"room_id": room_id},
        ).scalar_one_or_none()
        if playing_id is None and current_track is not None:
            queued_rows = (
                session.execute(
                    text(
                        """
                        SELECT id, track_payload
                        FROM jam_room_queue_items
                        WHERE room_id = :room_id AND status = 'queued'
                        ORDER BY position ASC, created_at ASC, id ASC
                        FOR UPDATE
                        """
                    ),
                    {"room_id": room_id},
                )
                .mappings()
                .all()
            )
            reconciled_id = next(
                (
                    row["id"]
                    for row in queued_rows
                    if isinstance(row.get("track_payload"), dict)
                    and _track_payloads_match(current_track, row["track_payload"])
                ),
                None,
            )
            if reconciled_id is not None:
                session.execute(
                    text(
                        """
                        UPDATE jam_room_queue_items
                        SET status = 'played', completed_at = :completed_at
                        WHERE room_id = :room_id AND id = :queue_item_id
                        """
                    ),
                    {
                        "room_id": room_id,
                        "queue_item_id": reconciled_id,
                        "completed_at": _now(),
                    },
                )
        session.execute(
            text(
                """
                UPDATE jam_room_queue_items
                SET status = 'played', completed_at = :completed_at
                WHERE room_id = :room_id AND status = 'playing'
                """
            ),
            {"room_id": room_id, "completed_at": _now()},
        )
        queue_mode = (
            session.execute(
                text("SELECT queue_mode FROM jam_rooms WHERE id = :room_id"),
                {"room_id": room_id},
            ).scalar_one_or_none()
            or "manual"
        )
        row = (
            session.execute(
                text(
                    """
                    SELECT q.id
                    FROM jam_room_queue_items q
                    LEFT JOIN jam_room_queue_votes v
                      ON v.room_id = q.room_id AND v.queue_item_id = q.id
                    WHERE q.room_id = :room_id AND q.status = 'queued'
                    GROUP BY q.id
                    ORDER BY
                        CASE WHEN :queue_mode IN ('auto', 'auto_dj') THEN COUNT(v.user_id) ELSE 0 END DESC,
                        q.position ASC,
                        q.created_at ASC,
                        q.id ASC
                    LIMIT 1
                    """
                ),
                {"room_id": room_id, "queue_mode": queue_mode},
            )
            .mappings()
            .first()
        )
        if row is None:
            return None
        locked = session.execute(
            text(
                """
                SELECT id
                FROM jam_room_queue_items
                WHERE room_id = :room_id AND id = :id AND status = 'queued'
                FOR UPDATE
                """
            ),
            {"room_id": room_id, "id": row["id"]},
        ).first()
        if locked is None:
            return None
        selected = (
            session.execute(
                text(
                    """
                    UPDATE jam_room_queue_items
                    SET status = 'playing', started_at = :started_at
                    WHERE room_id = :room_id AND id = :id
                    RETURNING *, 0::bigint AS vote_count, false AS voted_by_me
                    """
                ),
                {"room_id": room_id, "id": row["id"], "started_at": _now()},
            )
            .mappings()
            .one()
        )
    return _serialize_queue_item(dict(selected))


def start_jam_queue(room_id: str) -> dict | None:
    """Start the current queue without skipping an item already playing."""
    with transaction_scope() as session:
        current_id = session.execute(
            text(
                """
                SELECT id
                FROM jam_room_queue_items
                WHERE room_id = :room_id AND status = 'playing'
                ORDER BY position ASC, id ASC
                LIMIT 1
                """
            ),
            {"room_id": room_id},
        ).scalar_one_or_none()

    if current_id is not None:
        current = next(
            (
                item
                for item in list_jam_queue_items(room_id)
                if item["id"] == str(current_id)
            ),
            None,
        )
        if current is not None:
            return current

    return advance_jam_queue(room_id)


def reorder_jam_queue_item(
    room_id: str, queue_item_id: str | int, to_index: int
) -> list[dict]:
    with transaction_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT id
                    FROM jam_room_queue_items
                    WHERE room_id = :room_id AND status IN ('queued', 'playing')
                    ORDER BY position ASC, created_at ASC, id ASC
                    FOR UPDATE
                    """
                ),
                {"room_id": room_id},
            )
            .scalars()
            .all()
        )
        ids = [int(value) for value in rows]
        item_id = int(queue_item_id)
        if item_id in ids:
            ids.remove(item_id)
            ids.insert(max(0, min(to_index, len(ids))), item_id)
            for position, current_id in enumerate(ids):
                session.execute(
                    text(
                        """
                        UPDATE jam_room_queue_items
                        SET position = :position
                        WHERE room_id = :room_id AND id = :id
                        """
                    ),
                    {"room_id": room_id, "id": current_id, "position": position},
                )
    return list_jam_queue_items(room_id)


def toggle_jam_queue_vote(room_id: str, queue_item_id: str | int, user_id: int) -> dict:
    """Register one idempotent vote from a member for a queue item.

    The public name is kept for compatibility with the websocket event, but a
    vote is intentionally not removable: one member can vote each queue item
    once for the lifetime of that item.
    """
    with transaction_scope() as session:
        inserted = (
            session.execute(
                text(
                    """
                INSERT INTO jam_room_queue_votes (room_id, queue_item_id, user_id)
                SELECT :room_id, q.id, :user_id
                FROM jam_room_queue_items q
                WHERE q.room_id = :room_id
                  AND q.id = :queue_item_id
                  AND q.status IN ('queued', 'playing')
                ON CONFLICT DO NOTHING
                RETURNING 1
                """
                ),
                {
                    "room_id": room_id,
                    "queue_item_id": int(queue_item_id),
                    "user_id": user_id,
                },
            ).scalar_one_or_none()
            is not None
        )
        count = session.execute(
            text(
                """
                SELECT COUNT(*)
                FROM jam_room_queue_votes
                WHERE room_id = :room_id AND queue_item_id = :queue_item_id
                """
            ),
            {"room_id": room_id, "queue_item_id": int(queue_item_id)},
        ).scalar_one()
    return {"voted": inserted, "vote_count": int(count)}


def create_jam_track_request(room_id: str, track: dict, requested_by: int) -> dict:
    with transaction_scope() as session:
        track = _canonicalize_track_payload(session, track)
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO jam_room_track_requests (room_id, track_payload, requested_by, created_at)
                    VALUES (:room_id, CAST(:track AS jsonb), :requested_by, :created_at)
                    RETURNING *
                    """
                ),
                {
                    "room_id": room_id,
                    "track": json.dumps(track),
                    "requested_by": requested_by,
                    "created_at": _now(),
                },
            )
            .mappings()
            .one()
        )
    return _serialize_request(dict(row))


def _serialize_request(row: dict) -> dict:
    item = dict(row)
    item["id"] = str(item["id"])
    item["track"] = item.pop("track_payload")
    if item.get("queue_item_id") is not None:
        item["queue_item_id"] = str(item["queue_item_id"])
    return item


def list_jam_track_requests(room_id: str, *, pending_only: bool = True) -> list[dict]:
    status_clause = "AND r.status = 'pending'" if pending_only else ""
    with transaction_scope() as session:
        rows = [
            dict(row)
            for row in (
                session.execute(
                    text(
                        f"""
                    SELECT r.*,
                           requester.username AS requester_username,
                           COALESCE(NULLIF(requester.name, ''), requester.username) AS requester_name
                    FROM jam_room_track_requests r
                    LEFT JOIN users requester ON requester.id = r.requested_by
                    WHERE r.room_id = :room_id {status_clause}
                    ORDER BY r.created_at ASC, r.id ASC
                    """
                    ),
                    {"room_id": room_id},
                )
                .mappings()
                .all()
            )
        ]
        for row in rows:
            payload = row.get("track_payload")
            if isinstance(payload, dict):
                row["track_payload"] = _canonicalize_track_payload(session, payload)
    return [_serialize_request(row) for row in rows]


def resolve_jam_track_request(
    room_id: str,
    request_id: str | int,
    resolved_by: int,
    *,
    approve: bool,
) -> dict | None:
    with transaction_scope() as session:
        request = (
            session.execute(
                text(
                    """
                    SELECT *
                    FROM jam_room_track_requests
                    WHERE room_id = :room_id AND id = :request_id AND status = 'pending'
                    FOR UPDATE
                    """
                ),
                {"room_id": room_id, "request_id": int(request_id)},
            )
            .mappings()
            .first()
        )
        if request is None:
            return None
        request_payload = request.get("track_payload")
        if isinstance(request_payload, dict):
            request_payload = _canonicalize_track_payload(session, request_payload)
        queue_item_id = None
        if approve:
            position = session.execute(
                text(
                    """
                    SELECT COALESCE(MAX(position), -1) + 1
                    FROM jam_room_queue_items
                    WHERE room_id = :room_id AND status IN ('queued', 'playing')
                    """
                ),
                {"room_id": room_id},
            ).scalar_one()
            queue_item_id = session.execute(
                text(
                    """
                    INSERT INTO jam_room_queue_items
                        (room_id, track_payload, added_by, source, position, created_at)
                    VALUES
                        (:room_id, CAST(:track_payload AS jsonb), :added_by, 'request', :position, :created_at)
                    RETURNING id
                    """
                ),
                {
                    "room_id": room_id,
                    "track_payload": json.dumps(request_payload),
                    "added_by": resolved_by,
                    "position": position,
                    "created_at": _now(),
                },
            ).scalar_one()
        resolved = (
            session.execute(
                text(
                    """
                    UPDATE jam_room_track_requests
                    SET status = :status,
                        resolved_by = :resolved_by,
                        queue_item_id = :queue_item_id,
                        resolved_at = :resolved_at
                    WHERE room_id = :room_id AND id = :request_id
                    RETURNING *
                    """
                ),
                {
                    "room_id": room_id,
                    "request_id": int(request_id),
                    "status": "approved" if approve else "rejected",
                    "resolved_by": resolved_by,
                    "queue_item_id": queue_item_id,
                    "resolved_at": _now(),
                },
            )
            .mappings()
            .one()
        )
        resolved = dict(resolved)
        resolved["track_payload"] = request_payload
    return _serialize_request(resolved)


__all__ = [
    "add_jam_queue_item",
    "advance_jam_queue",
    "create_jam_track_request",
    "list_jam_queue_items",
    "list_jam_queue_vote_tracks",
    "list_jam_track_requests",
    "remove_jam_queue_item",
    "reorder_jam_queue_item",
    "resolve_jam_track_request",
    "toggle_jam_queue_vote",
]
