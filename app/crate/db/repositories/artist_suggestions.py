from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.serialize import serialize_row, serialize_rows
from crate.db.tx import optional_scope, read_scope, transaction_scope

OPEN_STATUSES = ("new", "triaged", "searching")
VALID_STATUSES = (*OPEN_STATUSES, "accepted", "dismissed", "downloaded")


def normalize_artist_suggestion_name(name: str) -> str:
    normalized = re.sub(r"\s+", " ", (name or "").strip().lower())
    return re.sub(r"[^a-z0-9&.' -]+", "", normalized).strip()


def _serialize_suggestion(row) -> dict:
    suggestion = serialize_row(row) or {}
    supporters = suggestion.get("supporters")
    if supporters is None:
        suggestion["supporters"] = []
    return suggestion


def _get_suggestion(session, suggestion_id: int) -> dict | None:
    row = (
        session.execute(
            text("""
            SELECT
                s.*,
                creator.name AS created_by_name,
                creator.email AS created_by_email,
                creator.avatar AS created_by_avatar,
                triager.name AS triaged_by_name,
                COALESCE((
                    SELECT COUNT(*)
                    FROM artist_suggestion_supporters ass
                    WHERE ass.suggestion_id = s.id
                ), 0)::INTEGER AS supporter_count,
                COALESCE((
                    SELECT json_agg(
                        json_build_object(
                            'user_id', ass.user_id,
                            'name', u.name,
                            'email', u.email,
                            'avatar', u.avatar,
                            'note', ass.note,
                            'artist_url', ass.artist_url,
                            'created_at', ass.created_at
                        )
                        ORDER BY ass.created_at DESC
                    )
                    FROM artist_suggestion_supporters ass
                    LEFT JOIN users u ON u.id = ass.user_id
                    WHERE ass.suggestion_id = s.id
                ), '[]'::json) AS supporters
            FROM artist_suggestions s
            LEFT JOIN users creator ON creator.id = s.created_by_user_id
            LEFT JOIN users triager ON triager.id = s.triaged_by_user_id
            WHERE s.id = :suggestion_id
            """),
            {"suggestion_id": suggestion_id},
        )
        .mappings()
        .first()
    )
    return _serialize_suggestion(row) if row else None


def create_artist_suggestion(
    *,
    user_id: int,
    artist_name: str,
    artist_url: str | None = None,
    note: str | None = None,
    session=None,
) -> dict:
    normalized_name = normalize_artist_suggestion_name(artist_name)
    if len(normalized_name) < 2:
        raise ValueError("Artist name is too short")
    clean_artist_name = re.sub(r"\s+", " ", artist_name.strip())[:200]
    clean_artist_url = (artist_url or "").strip()[:500] or None
    clean_note = (note or "").strip()[:1000] or None
    now = datetime.now(timezone.utc)

    def _impl(s) -> dict:
        def _touch_existing_suggestion(suggestion_id: int) -> None:
            s.execute(
                text("""
                UPDATE artist_suggestions
                SET updated_at = :now,
                    artist_url = COALESCE(artist_url, :artist_url),
                    note = COALESCE(note, :note)
                WHERE id = :suggestion_id
                """),
                {
                    "suggestion_id": suggestion_id,
                    "artist_url": clean_artist_url,
                    "note": clean_note,
                    "now": now,
                },
            )

        existing = (
            s.execute(
                text("""
                SELECT id
                FROM artist_suggestions
                WHERE normalized_artist_name = :normalized_name
                  AND status = ANY(:open_statuses)
                ORDER BY created_at DESC
                LIMIT 1
                """),
                {
                    "normalized_name": normalized_name,
                    "open_statuses": list(OPEN_STATUSES),
                },
            )
            .mappings()
            .first()
        )
        if existing:
            suggestion_id = int(existing["id"])
            _touch_existing_suggestion(suggestion_id)
        else:
            row = (
                s.execute(
                    text("""
                    INSERT INTO artist_suggestions (
                        artist_name, normalized_artist_name, artist_url, note,
                        status, created_by_user_id, created_at, updated_at
                    )
                    VALUES (
                        :artist_name, :normalized_name, :artist_url, :note,
                        'new', :user_id, :now, :now
                    )
                    ON CONFLICT DO NOTHING
                    RETURNING id
                    """),
                    {
                        "artist_name": clean_artist_name,
                        "normalized_name": normalized_name,
                        "artist_url": clean_artist_url,
                        "note": clean_note,
                        "user_id": user_id,
                        "now": now,
                    },
                )
                .mappings()
                .first()
            )
            if row:
                suggestion_id = int(row["id"])
            else:
                raced = (
                    s.execute(
                        text("""
                        SELECT id
                        FROM artist_suggestions
                        WHERE normalized_artist_name = :normalized_name
                          AND status = ANY(:open_statuses)
                        ORDER BY created_at DESC
                        LIMIT 1
                        """),
                        {
                            "normalized_name": normalized_name,
                            "open_statuses": list(OPEN_STATUSES),
                        },
                    )
                    .mappings()
                    .first()
                )
                if not raced:
                    raise ValueError("Artist suggestion already exists")
                suggestion_id = int(raced["id"])
                _touch_existing_suggestion(suggestion_id)

        s.execute(
            text("""
            INSERT INTO artist_suggestion_supporters (
                suggestion_id, user_id, artist_url, note, created_at
            )
            VALUES (:suggestion_id, :user_id, :artist_url, :note, :now)
            ON CONFLICT (suggestion_id, user_id) DO UPDATE SET
                artist_url = COALESCE(EXCLUDED.artist_url, artist_suggestion_supporters.artist_url),
                note = COALESCE(EXCLUDED.note, artist_suggestion_supporters.note),
                created_at = EXCLUDED.created_at
            """),
            {
                "suggestion_id": suggestion_id,
                "user_id": user_id,
                "artist_url": clean_artist_url,
                "note": clean_note,
                "now": now,
            },
        )
        return _get_suggestion(s, suggestion_id) or {}

    with optional_scope(session) as s:
        return _impl(s)


def list_artist_suggestions(
    *,
    status: str | None = None,
    limit: int = 50,
    include_resolved: bool = False,
) -> list[dict]:
    normalized_status = (status or "").strip().lower()
    if normalized_status == "open":
        statuses = list(OPEN_STATUSES)
    elif normalized_status in VALID_STATUSES:
        statuses = [normalized_status]
    elif include_resolved:
        statuses = list(VALID_STATUSES)
    else:
        statuses = list(OPEN_STATUSES)

    with read_scope() as session:
        rows = (
            session.execute(
                text("""
                SELECT
                    s.*,
                    creator.name AS created_by_name,
                    creator.email AS created_by_email,
                    creator.avatar AS created_by_avatar,
                    triager.name AS triaged_by_name,
                    COALESCE((
                        SELECT COUNT(*)
                        FROM artist_suggestion_supporters ass
                        WHERE ass.suggestion_id = s.id
                    ), 0)::INTEGER AS supporter_count,
                    COALESCE((
                        SELECT json_agg(
                            json_build_object(
                                'user_id', ass.user_id,
                                'name', u.name,
                                'email', u.email,
                                'avatar', u.avatar,
                                'note', ass.note,
                                'artist_url', ass.artist_url,
                                'created_at', ass.created_at
                            )
                            ORDER BY ass.created_at DESC
                        )
                        FROM artist_suggestion_supporters ass
                        LEFT JOIN users u ON u.id = ass.user_id
                        WHERE ass.suggestion_id = s.id
                    ), '[]'::json) AS supporters
                FROM artist_suggestions s
                LEFT JOIN users creator ON creator.id = s.created_by_user_id
                LEFT JOIN users triager ON triager.id = s.triaged_by_user_id
                WHERE s.status = ANY(:statuses)
                ORDER BY
                    CASE s.status
                        WHEN 'new' THEN 0
                        WHEN 'triaged' THEN 1
                        WHEN 'searching' THEN 2
                        ELSE 3
                    END,
                    s.updated_at DESC,
                    s.created_at DESC
                LIMIT :limit
                """),
                {"statuses": statuses, "limit": max(1, min(limit, 200))},
            )
            .mappings()
            .all()
        )
    return serialize_rows(rows)


def update_artist_suggestion_status(
    suggestion_id: int,
    *,
    status: str,
    actor_user_id: int,
    linked_artist_id: int | None = None,
    linked_task_id: str | None = None,
) -> dict | None:
    normalized_status = status.strip().lower()
    if normalized_status not in VALID_STATUSES:
        raise ValueError(f"Unsupported artist suggestion status: {status}")
    resolved = normalized_status in {"accepted", "dismissed", "downloaded"}
    now = datetime.now(timezone.utc)
    with transaction_scope() as session:
        result = session.execute(
            text("""
            UPDATE artist_suggestions
            SET status = :status,
                triaged_by_user_id = :actor_user_id,
                linked_artist_id = COALESCE(:linked_artist_id, linked_artist_id),
                linked_task_id = COALESCE(:linked_task_id, linked_task_id),
                resolved_at = CASE WHEN :resolved THEN :now ELSE NULL END,
                updated_at = :now
            WHERE id = :suggestion_id
            """),
            {
                "suggestion_id": suggestion_id,
                "status": normalized_status,
                "actor_user_id": actor_user_id,
                "linked_artist_id": linked_artist_id,
                "linked_task_id": linked_task_id,
                "resolved": resolved,
                "now": now,
            },
        )
        if int(getattr(result, "rowcount", 0) or 0) == 0:
            return None
        return _get_suggestion(session, suggestion_id)


def list_user_artist_suggestions(user_id: int, *, limit: int = 20) -> list[dict]:
    with read_scope() as session:
        rows = (
            session.execute(
                text("""
                SELECT s.*
                FROM artist_suggestions s
                JOIN artist_suggestion_supporters ass ON ass.suggestion_id = s.id
                WHERE ass.user_id = :user_id
                ORDER BY ass.created_at DESC
                LIMIT :limit
                """),
                {"user_id": user_id, "limit": max(1, min(limit, 100))},
            )
            .mappings()
            .all()
        )
    return serialize_rows(rows)
