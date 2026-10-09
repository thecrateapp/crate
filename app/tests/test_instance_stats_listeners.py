"""Crate Pulse top listeners ranking and the opt-out profile flag."""

from __future__ import annotations

from datetime import date
from unittest.mock import patch

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _user(session, username: str, **fields) -> int:
    columns = {"email": f"{username}@example.test", "username": username, **fields}
    names = ", ".join(columns)
    values = ", ".join(f":{name}" for name in columns)
    return session.execute(
        text(
            f"INSERT INTO users ({names}, created_at) "
            f"VALUES ({values}, now()) RETURNING id"
        ),
        columns,
    ).scalar_one()


def _listening(session, user_id: int, minutes: float, day: date) -> None:
    session.execute(
        text(
            """
            INSERT INTO user_daily_listening (user_id, day, play_count, minutes_listened)
            VALUES (:user_id, :day, :plays, :minutes)
            """
        ),
        {
            "user_id": user_id,
            "day": day,
            "plays": int(minutes // 4),
            "minutes": minutes,
        },
    )


def test_top_listeners_rank_listed_active_users_by_minutes(pg_db):
    from crate.db.queries.instance_stats_listeners import get_top_listeners
    from crate.db.queries.user_stats_periods import resolve_stats_period
    from crate.db.tx import read_scope, transaction_scope

    today = date.today()
    with transaction_scope() as session:
        heavy = _user(session, "heavy")
        light = _user(session, "light")
        hidden = _user(session, "hidden", pulse_listed=False)
        suspended = _user(session, "suspended", status="suspended")
        for user_id, minutes in [
            (heavy, 300),
            (light, 40),
            (hidden, 900),
            (suspended, 800),
        ]:
            _listening(session, user_id, minutes, today)

    with read_scope() as session:
        ranking = get_top_listeners(session, resolve_stats_period("UTC", window="30d"))

    assert [row["username"] for row in ranking] == ["heavy", "light"]
    assert ranking[0]["minutes"] == 300
    assert ranking[0]["active_days"] == 1


def test_profile_toggles_pulse_listing_and_refreshes_pulse(pg_db, test_app):
    assert test_app.get("/api/auth/me").json()["pulse_listed"] is True

    with patch("crate.api.auth.schedule_instance_stats_dashboard_refresh") as refresh:
        saved = test_app.put("/api/auth/profile", json={"pulse_listed": False})

    assert saved.status_code == 200
    refresh.assert_called_once()
    assert test_app.get("/api/auth/me").json()["pulse_listed"] is False
