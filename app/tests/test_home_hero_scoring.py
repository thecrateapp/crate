from __future__ import annotations

from datetime import date, timedelta

import pytest

from crate.db.home_debug import collect_home_debug


def _hero_row(
    name: str,
    *,
    listeners: int,
    genre_hits: int = 0,
    similar_hits: int = 0,
    recent_exposure_count: int = 0,
) -> dict:
    slug = name.lower().replace(" ", "-")
    return {
        "id": abs(hash(name)) % 10000,
        "slug": slug,
        "name": name,
        "listeners": listeners,
        "scrobbles": listeners * 10,
        "album_count": 3,
        "track_count": 24,
        "bio": f"{name} biography",
        "genre_hits": genre_hits,
        "similar_hits": similar_hits,
        "recent_exposure_count": recent_exposure_count,
    }


def test_home_hero_scorer_prioritizes_taste_over_global_popularity():
    from crate.db.home_hero_scoring import HOME_HERO_SCORE_VERSION, score_home_hero_rows

    rows = [
        _hero_row("Global Popular", listeners=10_000_000, genre_hits=0, similar_hits=0),
        _hero_row("Taste Match", listeners=80_000, genre_hits=2, similar_hits=1),
    ]

    scored = score_home_hero_rows(rows)

    assert scored[0]["name"] == "Taste Match"
    assert scored[0]["score_version"] == HOME_HERO_SCORE_VERSION
    assert scored[0]["score_contributions"][0]["reason"] in {
        "similar_artist_match",
        "genre_overlap",
    }


def test_home_hero_scorer_penalizes_recent_exposure():
    from crate.db.home_hero_scoring import score_home_hero_rows

    rows = [
        _hero_row(
            "Repeated Artist",
            listeners=90_000,
            genre_hits=2,
            similar_hits=1,
            recent_exposure_count=3,
        ),
        _hero_row("Fresh Artist", listeners=90_000, genre_hits=2, similar_hits=1),
    ]

    scored = score_home_hero_rows(rows)

    assert scored[0]["name"] == "Fresh Artist"
    assert any(
        contribution["reason"] == "recent_exposure_penalty"
        for contribution in scored[1]["score_contributions"]
    )


def test_home_hero_scorer_uses_user_taste_signals():
    from crate.db.home_hero_scoring import score_home_hero_rows

    rows = [
        _hero_row("Global Popular", listeners=10_000_000),
        {
            **_hero_row("Followed Match", listeners=10_000),
            "is_followed": True,
            "user_play_count": 12,
            "genre_hits": 2,
        },
    ]

    scored = score_home_hero_rows(rows)

    assert scored[0]["name"] == "Followed Match"
    reasons = {
        contribution["reason"] for contribution in scored[0]["score_contributions"]
    }
    assert {"followed_artist", "user_listening", "genre_overlap"} <= reasons


def test_home_hero_rotation_is_stable_per_day_but_varies_over_time():
    from crate.db.home_hero_scoring import rotate_home_hero_rows

    rows = [{"id": index, "name": f"Artist {index}"} for index in range(5)]
    first_day = date(2026, 8, 2)

    same_day = rotate_home_hero_rows(rows, user_id=7, day=first_day)
    repeated_same_day = rotate_home_hero_rows(rows, user_id=7, day=first_day)
    across_days = {
        rotate_home_hero_rows(
            rows,
            user_id=7,
            day=first_day + timedelta(days=offset),
        )[0]["name"]
        for offset in range(31)
    }

    assert same_day == repeated_same_day
    assert len(across_days) >= 2


def test_home_hero_builder_preserves_recent_arrival_order(monkeypatch):
    from crate.db import home_builder_discovery_queries as queries

    monkeypatch.setattr(
        queries,
        "get_home_hero_rows",
        lambda **_: [
            _hero_row("Newest Arrival", listeners=9_000, genre_hits=0),
            _hero_row("Older Popular Artist", listeners=9_000_000, genre_hits=0),
        ],
    )
    monkeypatch.setattr(
        queries,
        "get_artist_genres_map",
        lambda names: {name: ["hardcore", "mathcore"] for name in names},
    )

    with collect_home_debug() as diagnostics:
        heroes = queries.get_home_hero(
            7,
            followed_names_lower=[],
            similar_target_names_lower=["converge"],
            top_genres_lower=["hardcore"],
        )

    assert heroes is not None
    assert [hero["name"] for hero in heroes] == [
        "Newest Arrival",
        "Older Popular Artist",
    ]
    assert all("score" not in hero for hero in heroes)
    assert all(hero["artwork_provenance"] == "fallback" for hero in heroes)
    assert diagnostics["hero"]["selection_version"] == "home_just_landed_v2"
    assert diagnostics["hero"]["candidate_pool_size"] == 2
    assert diagnostics["hero"]["selected_count"] == 2
    assert diagnostics["hero"]["candidates"][0]["name"] == "Newest Arrival"
    assert "top_contributions" not in diagnostics["hero"]["candidates"][0]


def test_home_hero_builder_personalizes_a_larger_candidate_pool(monkeypatch):
    from crate.db import home_builder_discovery_queries as queries

    captured: dict = {}

    def get_rows(**kwargs):
        captured.update(kwargs)
        return [
            _hero_row("Global Popular", listeners=10_000_000),
            {
                **_hero_row("Followed Match", listeners=10_000),
                "is_followed": True,
                "user_play_count": 12,
                "genre_hits": 2,
            },
        ]

    monkeypatch.setattr(queries, "get_home_hero_rows", get_rows)
    monkeypatch.setattr(queries, "get_artist_genres_map", lambda _names: {})

    heroes = queries.get_home_hero(7, ["followed match"], [], ["hardcore"])

    assert captured["limit"] == 15
    assert heroes is not None
    assert heroes[0]["name"] == "Followed Match"
    assert len(heroes) == 2


def test_home_hero_builder_deduplicates_visible_artist_names(monkeypatch):
    from crate.db import home_builder_discovery_queries as queries

    first_dredg = _hero_row("Dredg", listeners=1_000)
    second_dredg = {
        **_hero_row("Dredg", listeners=900),
        "id": first_dredg["id"] + 1,
        "slug": "dredg-duplicate-record",
    }
    other = _hero_row("Other Artist", listeners=800)

    monkeypatch.setattr(
        queries,
        "get_home_hero_rows",
        lambda **_: [first_dredg, second_dredg, other],
    )
    monkeypatch.setattr(queries, "get_artist_genres_map", lambda _names: {})

    heroes = queries.get_home_hero(7, [], [], [])

    assert heroes is not None
    assert [hero["name"] for hero in heroes] == ["Dredg", "Other Artist"]


def test_home_hero_builder_preserves_artwork_provenance(monkeypatch):
    from crate.db import home_builder_discovery_queries as queries

    specific = _hero_row("Editorial Hero", listeners=1_000)
    specific["artwork_provenance"] = "specific"
    monkeypatch.setattr(queries, "get_home_hero_rows", lambda **_: [specific])
    monkeypatch.setattr(queries, "get_artist_genres_map", lambda _names: {})

    heroes = queries.get_home_hero(7, [], [], [])

    assert heroes is not None
    assert heroes[0]["artwork_provenance"] == "specific"


def test_home_hero_builder_exposes_fill_bounds_without_internal_recipe(monkeypatch):
    from crate.db import home_builder_discovery_queries as queries

    specific = _hero_row("Editorial Hero", listeners=1_000)
    specific.update(
        {
            "artwork_provenance": "specific",
            "_hero_source_width": 700,
            "_hero_source_height": 1000,
            "_hero_desktop_source_width": None,
            "_hero_desktop_source_height": None,
            "_hero_mobile_source_width": None,
            "_hero_mobile_source_height": None,
            "_hero_desktop_recipe": {
                "mode": "extend",
                "position_x": 0.5,
                "position_y": 0.5,
                "scale": 1.0,
                "rotation": 0,
            },
            "_hero_mobile_recipe": {
                "mode": "crop",
                "rotation": 0,
            },
        }
    )
    monkeypatch.setattr(queries, "get_home_hero_rows", lambda **_: [specific])
    monkeypatch.setattr(queries, "get_artist_genres_map", lambda _names: {})

    heroes = queries.get_home_hero(7, [], [], [])

    assert heroes is not None
    assert heroes[0]["desktop_artwork_bounds"] == pytest.approx(
        {"left": 0.0, "top": -1.262, "right": 1.0, "bottom": 2.262},
        abs=0.001,
    )
    assert heroes[0]["mobile_artwork_bounds"] == {
        "left": 0.0,
        "top": 0.0,
        "right": 1.0,
        "bottom": 1.0,
    }
    assert not any(key.startswith("_hero_") for key in heroes[0])
