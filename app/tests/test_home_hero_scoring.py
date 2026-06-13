from __future__ import annotations

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


def test_home_hero_builder_records_debug_contributions(monkeypatch):
    from crate.db import home_builder_discovery_queries as queries
    from crate.db.home_hero_scoring import HOME_HERO_SCORE_VERSION

    monkeypatch.setattr(
        queries,
        "get_home_hero_rows",
        lambda **_: [
            _hero_row("Low Match", listeners=9_000_000, genre_hits=0, similar_hits=0),
            _hero_row("Good Match", listeners=90_000, genre_hits=2, similar_hits=1),
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
    assert heroes[0]["name"] == "Good Match"
    assert diagnostics["hero"]["score_version"] == HOME_HERO_SCORE_VERSION
    assert diagnostics["hero"]["candidate_pool_size"] == 2
    assert diagnostics["hero"]["selected_count"] == 2
    assert diagnostics["hero"]["candidates"][0]["name"] == "Good Match"
    assert diagnostics["hero"]["candidates"][0]["top_contributions"]
