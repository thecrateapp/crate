"""Live "listened today" counter, kept in Redis so it never waits for a refresh."""

from __future__ import annotations

import logging
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import text

from crate.db.cache_runtime import get_redis
from crate.db.tx import read_scope

_TTL_SECONDS = 48 * 3600
log = logging.getLogger(__name__)


def _key(user_id: int, day: date) -> str:
    return f"stats:today:{user_id}:{day.isoformat()}"


def add_listening_today(user_id: int, day: date, played_seconds: float) -> None:
    client = get_redis()
    if client is None:
        return
    try:
        key = _key(user_id, day)
        pipeline = client.pipeline(transaction=False)
        pipeline.hincrbyfloat(key, "minutes", max(0.0, float(played_seconds)) / 60.0)
        pipeline.hincrby(key, "plays", 1)
        pipeline.expire(key, _TTL_SECONDS)
        pipeline.execute()
    except Exception as exc:
        log.debug("Could not update today's listening counter: %s", exc)


def get_listening_today(user_id: int) -> dict:
    with read_scope() as session:
        timezone_name = (
            session.execute(
                text("SELECT NULLIF(timezone, '') FROM users WHERE id = :user_id"),
                {"user_id": user_id},
            ).scalar_one_or_none()
            or "UTC"
        )
        today = datetime.now(ZoneInfo(timezone_name)).date()
        counters = None
        client = get_redis()
        if client is not None:
            try:
                counters = client.hgetall(_key(user_id, today)) or None
            except Exception as exc:
                log.debug("Could not read today's listening counter: %s", exc)
        if counters is None:
            row = session.execute(
                text(
                    """
                    SELECT minutes_listened, play_count
                    FROM user_daily_listening
                    WHERE user_id = :user_id AND day = :day
                    """
                ),
                {"user_id": user_id, "day": today},
            ).first()
            counters = (
                {"minutes": row.minutes_listened, "plays": row.play_count}
                if row
                else {}
            )
    return {
        "day": today.isoformat(),
        "timezone": timezone_name,
        "minutes": round(float(counters.get("minutes") or 0), 1),
        "plays": int(float(counters.get("plays") or 0)),
    }


__all__ = ["add_listening_today", "get_listening_today"]
