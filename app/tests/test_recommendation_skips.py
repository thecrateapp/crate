from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from crate.db.queries.recommendation_skips import get_early_skip_counts
from crate.db.tx import transaction_scope
from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")

UNTIL = datetime(2026, 11, 2, 14, 0, tzinfo=timezone.utc)
SINCE = UNTIL - timedelta(hours=24)


def _user() -> int:
    with transaction_scope() as session:
        return session.execute(
            text(
                "INSERT INTO users (email, username, created_at) "
                "VALUES ('skips@example.test', 'skips', :at) RETURNING id"
            ),
            {"at": SINCE},
        ).scalar_one()


def _play(user_id: int, at: datetime, source: str, played: float, skipped: bool):
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO user_play_events (user_id, started_at, ended_at, "
                "created_at, played_seconds, was_skipped, play_source_type) "
                "VALUES (:u, :at, :at, :at, :played, :skipped, :source)"
            ),
            {
                "u": user_id,
                "at": at,
                "played": played,
                "skipped": skipped,
                "source": source,
            },
        )


def test_early_skips_count_only_quick_skips_inside_the_window(pg_db):
    user = _user()
    inside = UNTIL - timedelta(hours=1)
    _play(user, inside, "radio", 12, True)
    _play(user, inside, "radio", 45, True)
    _play(user, inside, "radio", 200, False)
    _play(user, inside, "path", 29, True)
    _play(user, inside, "album", 5, True)
    _play(user, SINCE - timedelta(minutes=1), "radio", 3, True)
    _play(user, UNTIL, "radio", 3, True)

    counts = get_early_skip_counts(SINCE, UNTIL, early_seconds=30)

    assert counts == {
        "radio": {"delivered": 3, "early_skips": 1},
        "path": {"delivered": 1, "early_skips": 1},
    }


def test_a_surface_without_plays_reads_as_no_sample(pg_db):
    assert get_early_skip_counts(SINCE, UNTIL, early_seconds=30) == {
        "radio": {"delivered": 0, "early_skips": 0},
        "path": {"delivered": 0, "early_skips": 0},
    }
