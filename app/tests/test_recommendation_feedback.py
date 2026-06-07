from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_recommendation_feedback_upserts_and_normalizes_entity_key(pg_db):
    from crate.db.repositories.recommendations import (
        has_active_recommendation_feedback,
        record_recommendation_feedback,
    )

    user = pg_db.create_user(f"feedback-user-{uuid4().hex}@test.com")

    first = record_recommendation_feedback(
        user_id=user["id"],
        surface="home.hero",
        entity_type="artist",
        entity_key="metallica",
        action="not_interested",
        reason="not_my_taste",
    )
    second = record_recommendation_feedback(
        user_id=user["id"],
        surface="home.hero",
        entity_type="artist",
        entity_key="artist:metallica",
        action="not_interested",
        reason="still_nope",
    )

    assert first["id"] == second["id"]
    assert second["entity_key"] == "artist:metallica"
    assert has_active_recommendation_feedback(
        user_id=user["id"],
        surface="home.hero",
        entity_type="artist",
        entity_key="metallica",
        actions=("not_interested",),
    )


def test_repeated_ignored_hero_exposure_creates_cooldown(pg_db):
    from crate.db.repositories.recommendations import (
        has_active_recommendation_feedback,
        record_recommendation_exposure,
    )

    user = pg_db.create_user(f"hero-exposure-{uuid4().hex}@test.com")
    today = date(2026, 6, 10)
    yesterday = today - timedelta(days=1)

    first = record_recommendation_exposure(
        user_id=user["id"],
        surface="home.hero",
        entity_type="artist",
        entity_key="artist:refused",
        shown_on=yesterday,
    )
    second = record_recommendation_exposure(
        user_id=user["id"],
        surface="home.hero",
        entity_type="artist",
        entity_key="artist:refused",
        shown_on=today,
    )

    assert first["cooldown_created"] is False
    assert second["cooldown_created"] is True
    assert has_active_recommendation_feedback(
        user_id=user["id"],
        surface="home.hero",
        entity_type="artist",
        entity_key="artist:refused",
        actions=("ignored_cooldown",),
    )


def test_acted_hero_feedback_prevents_ignored_cooldown(pg_db):
    from crate.db.repositories.recommendations import (
        has_active_recommendation_feedback,
        record_recommendation_exposure,
        record_recommendation_feedback,
    )

    user = pg_db.create_user(f"hero-acted-{uuid4().hex}@test.com")
    today = date(2026, 6, 10)
    yesterday = today - timedelta(days=1)

    record_recommendation_exposure(
        user_id=user["id"],
        surface="home.hero",
        entity_type="artist",
        entity_key="artist:minor-empires",
        shown_on=yesterday,
    )
    record_recommendation_feedback(
        user_id=user["id"],
        surface="home.hero",
        entity_type="artist",
        entity_key="artist:minor-empires",
        action="opened",
    )
    second = record_recommendation_exposure(
        user_id=user["id"],
        surface="home.hero",
        entity_type="artist",
        entity_key="artist:minor-empires",
        shown_on=today,
    )

    assert second["cooldown_created"] is False
    assert not has_active_recommendation_feedback(
        user_id=user["id"],
        surface="home.hero",
        entity_type="artist",
        entity_key="artist:minor-empires",
        actions=("ignored_cooldown",),
    )
