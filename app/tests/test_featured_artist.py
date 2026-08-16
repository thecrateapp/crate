from __future__ import annotations

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


def _artist_id() -> int:
    from crate.db.tx import read_scope

    with read_scope() as session:
        return int(
            session.execute(
                text("SELECT id FROM library_artists WHERE name = 'Featured Artist'")
            ).scalar_one()
        )


def _hero_profile(*, review_status: str = "approved", revision: str) -> dict:
    recipe = {
        "mode": "crop",
        "crop": {"x": 0, "y": 0, "width": 1800, "height": 900},
        "position_x": 0.5,
        "position_y": 0.5,
        "scale": 1,
        "gradient": 0.4,
    }
    return {
        "artist_id": _artist_id(),
        "provenance": "manual",
        "review_status": review_status,
        "source_width": 1800,
        "source_height": 900,
        "desktop_source_width": 1800,
        "desktop_source_height": 900,
        "mobile_source_width": 1800,
        "mobile_source_height": 900,
        "desktop_recipe": recipe,
        "mobile_recipe": recipe,
        "revision": revision,
    }


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_featured_artist_cannot_enable_without_ready_hero(pg_db):
    from crate.db.repositories.featured_artists import set_artist_featured

    pg_db.upsert_artist({"name": "Featured Artist"})

    result = set_artist_featured(_artist_id(), True)

    assert result == {
        "status": "rejected",
        "reason": "approved_hero_required",
        "featured_devices": (),
    }


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_featured_artist_activation_requires_only_one_ready_composition(pg_db):
    from crate.artist_hero_artwork import ARTIST_HERO_RENDER_VERSION
    from crate.db.repositories.artist_hero_artwork import upsert_artist_hero_artwork
    from crate.db.repositories.featured_artists import set_artist_featured
    from crate.db.tx import read_scope

    pg_db.upsert_artist({"name": "Featured Artist"})
    profile = _hero_profile(revision=f"{ARTIST_HERO_RENDER_VERSION}:fixture")
    profile["mobile_recipe"] = None
    upsert_artist_hero_artwork(**profile)

    result = set_artist_featured(_artist_id(), True)

    assert result == {
        "status": "updated",
        "is_featured": True,
        "featured_devices": ("desktop",),
    }
    with read_scope() as session:
        assert session.execute(
            text("SELECT is_featured FROM library_artists WHERE id = :id"),
            {"id": _artist_id()},
        ).scalar_one()


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_rejecting_the_last_ready_hero_clears_featured_state(pg_db):
    from crate.artist_hero_artwork import ARTIST_HERO_RENDER_VERSION
    from crate.db.repositories.artist_hero_artwork import (
        update_artist_hero_review_status,
        upsert_artist_hero_artwork,
    )
    from crate.db.repositories.featured_artists import set_artist_featured
    from crate.db.tx import read_scope

    pg_db.upsert_artist({"name": "Featured Artist"})
    upsert_artist_hero_artwork(
        **_hero_profile(revision=f"{ARTIST_HERO_RENDER_VERSION}:fixture")
    )
    assert set_artist_featured(_artist_id(), True)["is_featured"] is True

    assert update_artist_hero_review_status(_artist_id(), "rejected") is True

    with read_scope() as session:
        assert not session.execute(
            text("SELECT is_featured FROM library_artists WHERE id = :id"),
            {"id": _artist_id()},
        ).scalar_one()
