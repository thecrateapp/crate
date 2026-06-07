from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope

NEGATIVE_HERO_ACTIONS = frozenset({"dismiss", "not_interested", "ignored_cooldown"})
ACTED_ACTIONS = frozenset({"opened", "played", "followed"})
DEFAULT_FEEDBACK_EXPIRY_DAYS = {
    "dismiss": 30,
    "hide_for_now": 30,
    "not_interested": 180,
    "ignored_cooldown": 14,
}
EXPOSURE_RETENTION_DAYS = 90


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _default_expires_at(action: str) -> datetime | None:
    days = DEFAULT_FEEDBACK_EXPIRY_DAYS.get(action)
    if days is None:
        return None
    return _utcnow() + timedelta(days=days)


def _normalize_entity_key(entity_type: str, entity_key: str) -> str:
    value = entity_key.strip()
    if not value:
        raise ValueError("entity_key is required")
    prefix = f"{entity_type}:"
    return value if value.startswith(prefix) else f"{prefix}{value}"


def _mark_exposures_acted(
    *,
    user_id: int,
    surface: str,
    entity_type: str,
    entity_key: str,
    session,
) -> None:
    session.execute(
        text(
            """
            UPDATE user_recommendation_exposures
            SET acted_at = NOW(), updated_at = NOW()
            WHERE user_id = :user_id
              AND surface = :surface
              AND entity_type = :entity_type
              AND entity_key = :entity_key
              AND acted_at IS NULL
            """
        ),
        {
            "user_id": user_id,
            "surface": surface,
            "entity_type": entity_type,
            "entity_key": entity_key,
        },
    )


def record_recommendation_feedback(
    *,
    user_id: int,
    surface: str,
    entity_type: str,
    entity_key: str,
    action: str,
    strength: float = 1.0,
    reason: str | None = None,
    metadata: dict[str, Any] | None = None,
    expires_at: datetime | None = None,
) -> dict[str, Any]:
    surface = surface.strip()
    entity_type = entity_type.strip()
    action = action.strip()
    if not surface:
        raise ValueError("surface is required")
    if not entity_type:
        raise ValueError("entity_type is required")
    if not action:
        raise ValueError("action is required")
    normalized_key = _normalize_entity_key(entity_type, entity_key)
    resolved_expires_at = (
        expires_at if expires_at is not None else _default_expires_at(action)
    )

    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO user_recommendation_feedback (
                        user_id, surface, entity_type, entity_key, action,
                        strength, reason, metadata_json, expires_at, created_at, updated_at
                    )
                    VALUES (
                        :user_id, :surface, :entity_type, :entity_key, :action,
                        :strength, :reason, CAST(:metadata_json AS jsonb), :expires_at, NOW(), NOW()
                    )
                    ON CONFLICT (user_id, surface, entity_type, entity_key, action)
                    DO UPDATE SET
                        strength = EXCLUDED.strength,
                        reason = EXCLUDED.reason,
                        metadata_json = EXCLUDED.metadata_json,
                        expires_at = EXCLUDED.expires_at,
                        updated_at = NOW()
                    RETURNING id, user_id, surface, entity_type, entity_key, action,
                              strength, reason, metadata_json, expires_at, created_at, updated_at
                    """
                ),
                {
                    "user_id": user_id,
                    "surface": surface,
                    "entity_type": entity_type,
                    "entity_key": normalized_key,
                    "action": action,
                    "strength": float(strength),
                    "reason": reason,
                    "metadata_json": json.dumps(metadata or {}),
                    "expires_at": resolved_expires_at,
                },
            )
            .mappings()
            .one()
        )
        if action in ACTED_ACTIONS:
            _mark_exposures_acted(
                user_id=user_id,
                surface=surface,
                entity_type=entity_type,
                entity_key=normalized_key,
                session=session,
            )
        return dict(row)


def _active_feedback_clause(action_list_name: str = "actions") -> str:
    return (
        f"action = ANY(:{action_list_name}) "
        "AND (expires_at IS NULL OR expires_at > NOW())"
    )


def has_active_recommendation_feedback(
    *,
    user_id: int,
    surface: str,
    entity_type: str,
    entity_key: str,
    actions: list[str] | tuple[str, ...] = tuple(NEGATIVE_HERO_ACTIONS),
) -> bool:
    normalized_key = _normalize_entity_key(entity_type, entity_key)
    with read_scope() as session:
        row = session.execute(
            text(
                f"""
                SELECT 1
                FROM user_recommendation_feedback
                WHERE user_id = :user_id
                  AND surface = :surface
                  AND entity_type = :entity_type
                  AND entity_key = :entity_key
                  AND {_active_feedback_clause()}
                LIMIT 1
                """
            ),
            {
                "user_id": user_id,
                "surface": surface,
                "entity_type": entity_type,
                "entity_key": normalized_key,
                "actions": list(actions),
            },
        ).first()
    return row is not None


def _maybe_create_ignored_cooldown(
    *,
    user_id: int,
    surface: str,
    entity_type: str,
    entity_key: str,
    shown_on: date,
    session,
) -> bool:
    if surface != "home.hero" or entity_type != "artist":
        return False
    window_start = shown_on - timedelta(days=3)

    acted = session.execute(
        text(
            """
            SELECT 1
            FROM user_recommendation_exposures
            WHERE user_id = :user_id
              AND surface = :surface
              AND entity_type = :entity_type
              AND entity_key = :entity_key
              AND shown_on >= :window_start
              AND shown_on <= :shown_on
              AND acted_at IS NOT NULL
            LIMIT 1
            """
        ),
        {
            "user_id": user_id,
            "surface": surface,
            "entity_type": entity_type,
            "entity_key": entity_key,
            "window_start": window_start,
            "shown_on": shown_on,
        },
    ).first()
    if acted is not None:
        return False

    shown_days = session.execute(
        text(
            """
            SELECT COUNT(*) AS shown_days
            FROM user_recommendation_exposures
            WHERE user_id = :user_id
              AND surface = :surface
              AND entity_type = :entity_type
              AND entity_key = :entity_key
              AND shown_on >= :window_start
              AND shown_on <= :shown_on
            """
        ),
        {
            "user_id": user_id,
            "surface": surface,
            "entity_type": entity_type,
            "entity_key": entity_key,
            "window_start": window_start,
            "shown_on": shown_on,
        },
    ).scalar_one()
    if int(shown_days or 0) < 2:
        return False

    existing = session.execute(
        text(
            """
            SELECT 1
            FROM user_recommendation_feedback
            WHERE user_id = :user_id
              AND surface = :surface
              AND entity_type = :entity_type
              AND entity_key = :entity_key
              AND action = 'ignored_cooldown'
              AND (expires_at IS NULL OR expires_at > NOW())
            LIMIT 1
            """
        ),
        {
            "user_id": user_id,
            "surface": surface,
            "entity_type": entity_type,
            "entity_key": entity_key,
        },
    ).first()
    if existing is not None:
        return False

    session.execute(
        text(
            """
            INSERT INTO user_recommendation_feedback (
                user_id, surface, entity_type, entity_key, action,
                strength, reason, metadata_json, expires_at, created_at, updated_at
            )
            VALUES (
                :user_id, :surface, :entity_type, :entity_key, 'ignored_cooldown',
                1.0, 'ignored_repeated_exposure', '{}'::jsonb,
                NOW() + INTERVAL '14 days', NOW(), NOW()
            )
            ON CONFLICT (user_id, surface, entity_type, entity_key, action)
            DO UPDATE SET
                expires_at = EXCLUDED.expires_at,
                updated_at = NOW()
            """
        ),
        {
            "user_id": user_id,
            "surface": surface,
            "entity_type": entity_type,
            "entity_key": entity_key,
        },
    )
    return True


def record_recommendation_exposure(
    *,
    user_id: int,
    surface: str,
    entity_type: str,
    entity_key: str,
    shown_on: date | None = None,
) -> dict[str, Any]:
    surface = surface.strip()
    entity_type = entity_type.strip()
    if not surface:
        raise ValueError("surface is required")
    if not entity_type:
        raise ValueError("entity_type is required")
    normalized_key = _normalize_entity_key(entity_type, entity_key)
    resolved_shown_on = shown_on or _utcnow().date()
    expires_at = datetime.combine(
        resolved_shown_on + timedelta(days=EXPOSURE_RETENTION_DAYS),
        datetime.min.time(),
        tzinfo=timezone.utc,
    )

    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO user_recommendation_exposures (
                        user_id, surface, entity_type, entity_key, shown_on,
                        shown_count, expires_at, created_at, updated_at
                    )
                    VALUES (
                        :user_id, :surface, :entity_type, :entity_key, :shown_on,
                        1, :expires_at, NOW(), NOW()
                    )
                    ON CONFLICT (user_id, surface, entity_type, entity_key, shown_on)
                    DO UPDATE SET
                        shown_count = user_recommendation_exposures.shown_count + 1,
                        expires_at = EXCLUDED.expires_at,
                        updated_at = NOW()
                    RETURNING id, user_id, surface, entity_type, entity_key, shown_on,
                              shown_count, acted_at, expires_at, created_at, updated_at
                    """
                ),
                {
                    "user_id": user_id,
                    "surface": surface,
                    "entity_type": entity_type,
                    "entity_key": normalized_key,
                    "shown_on": resolved_shown_on,
                    "expires_at": expires_at,
                },
            )
            .mappings()
            .one()
        )
        cooldown_created = _maybe_create_ignored_cooldown(
            user_id=user_id,
            surface=surface,
            entity_type=entity_type,
            entity_key=normalized_key,
            shown_on=resolved_shown_on,
            session=session,
        )
        payload = dict(row)
        payload["cooldown_created"] = cooldown_created
        return payload


def delete_expired_recommendation_exposures(*, session=None) -> int:
    if session is None:
        with transaction_scope() as s:
            return delete_expired_recommendation_exposures(session=s)
    result = session.execute(
        text(
            """
            DELETE FROM user_recommendation_exposures
            WHERE expires_at IS NOT NULL
              AND expires_at < NOW()
            """
        )
    )
    return int(result.rowcount or 0)


__all__ = [
    "ACTED_ACTIONS",
    "NEGATIVE_HERO_ACTIONS",
    "delete_expired_recommendation_exposures",
    "has_active_recommendation_feedback",
    "record_recommendation_exposure",
    "record_recommendation_feedback",
]
