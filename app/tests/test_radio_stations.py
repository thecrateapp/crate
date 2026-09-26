import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


def test_radio_station_payload_splits_artist_and_genre_stations(monkeypatch):
    from crate.db.queries import radio_stations

    monkeypatch.setattr(
        radio_stations,
        "get_genre_taxonomy_cover_path",
        lambda slug: "hardcore.webp" if slug == "hardcore" else None,
    )
    monkeypatch.setattr(
        radio_stations,
        "resolve_genre_slug",
        lambda value: "hardcore" if value == "Hardcore" else None,
    )
    monkeypatch.setattr(
        radio_stations,
        "get_genre_display_name",
        lambda slug: slug,
    )
    monkeypatch.setattr(
        radio_stations,
        "list_global_collection_artists",
        lambda **_kwargs: [],
    )

    payload = radio_stations.build_radio_stations_from_context(
        {
            "top_artists": [
                {
                    "artist_id": 3,
                    "artist_slug": "crate-trash",
                    "artist_name": ".crate-trash",
                    "play_count": 999,
                    "minutes_listened": 999,
                },
                {
                    "artist_id": 7,
                    "artist_slug": "converge",
                    "artist_name": "Converge",
                    "play_count": 44,
                    "minutes_listened": 180,
                },
            ],
            "followed": [
                {
                    "artist_id": 8,
                    "artist_slug": "crate-trash",
                    "artist_name": ".crate-trash",
                },
                {
                    "artist_id": 9,
                    "artist_slug": "botch",
                    "artist_name": "Botch",
                },
            ],
            "top_genres": [
                {
                    "genre_name": "Hardcore",
                    "play_count": 88,
                    "minutes_listened": 320,
                }
            ],
        },
        artist_limit=4,
        genre_limit=4,
    )

    assert [station["seed_type"] for station in payload["artist_stations"]] == [
        "artist",
        "artist",
    ]
    assert payload["artist_stations"][0]["seed_value"] == "7"
    assert payload["artist_stations"][0]["seed_label"] == "Converge"
    assert payload["artist_stations"][1]["seed_label"] == "Botch"

    assert payload["genre_stations"] == [
        {
            "type": "genre",
            "seed_type": "genre",
            "seed_value": "hardcore",
            "seed_label": "hardcore",
            "seed_subtitle": "Genre",
            "genre_slug": "hardcore",
            "genre_name": "hardcore",
            "cover_url": "/api/genres/hardcore/cover?size=640&format=webp",
            "title": "hardcore Radio",
            "subtitle": "",
            "play_count": 88,
            "minutes_listened": 320,
        }
    ]


def test_get_user_radio_stations_applies_fallback_to_builder_genre_stations(
    monkeypatch,
):
    from crate.db.queries import radio_stations

    context = {"top_genres": [{"genre_name": "Hardcore"}]}
    genre_stations = [{"type": "genre", "genre_slug": "hardcore", "cover_url": None}]
    payload = {"artist_stations": [], "genre_stations": genre_stations}
    context_calls = []

    def get_context(user_id, **kwargs):
        context_calls.append((user_id, kwargs))
        return context

    monkeypatch.setattr(radio_stations, "get_cached_home_context", get_context)
    monkeypatch.setattr(
        radio_stations,
        "build_radio_stations_from_context",
        lambda value: payload if value is context else pytest.fail("wrong context"),
    )
    monkeypatch.setattr(
        radio_stations,
        "_cached_genre_station_artwork_fallbacks",
        lambda: {"hardcore": "/api/artists/42/background?size=640&format=webp"},
    )

    result = radio_stations.get_user_radio_stations(7)

    assert result is payload
    assert context_calls == [
        (
            7,
            {
                "top_artist_limit": 24,
                "top_album_limit": 1,
                "top_genre_limit": 16,
            },
        )
    ]
    assert genre_stations[0]["cover_url"] == (
        "/api/artists/42/background?size=640&format=webp"
    )


def test_genre_stations_fall_back_to_top_artist_background(monkeypatch):
    from crate.db.queries import radio_stations

    class Result:
        def mappings(self):
            return self

        def all(self):
            return [{"genre_slug": "hardcore", "artist_id": 42}]

    class Session:
        def execute(self, *_args, **_kwargs):
            return Result()

    class ReadScope:
        def __enter__(self):
            return Session()

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(radio_stations, "read_scope", ReadScope)
    monkeypatch.setattr(
        radio_stations,
        "get_or_compute_home_cache",
        lambda _key, *, compute, **_kwargs: compute(),
    )
    stations = [
        {
            "type": "genre",
            "genre_name": "Hardcore",
            "genre_slug": "hardcore",
            "cover_url": None,
        },
        {"type": "artist", "genre_name": "Hardcore", "cover_url": None},
    ]

    radio_stations._add_genre_station_artwork_fallbacks(stations)

    assert stations[0]["cover_url"] == "/api/artists/42/background?size=640&format=webp"
    assert stations[1]["cover_url"] is None


def test_genre_station_artwork_fallback_skips_genres_with_covers(monkeypatch):
    from crate.db.queries import radio_stations

    def fail_if_queried():
        raise AssertionError("artwork lookup should be skipped")

    monkeypatch.setattr(radio_stations, "read_scope", fail_if_queried)
    stations = [{"type": "genre", "genre_name": "Hardcore", "cover_url": "/cover.webp"}]

    radio_stations._add_genre_station_artwork_fallbacks(stations)

    assert stations[0]["cover_url"] == "/cover.webp"


def test_genre_station_artwork_fallback_skips_missing_or_blank_slugs(monkeypatch):
    from crate.db.queries import radio_stations

    def fail_if_queried():
        raise AssertionError("artwork lookup should be skipped without a genre slug")

    monkeypatch.setattr(
        radio_stations, "_cached_genre_station_artwork_fallbacks", fail_if_queried
    )
    stations = [
        {"type": "genre", "genre_name": "Hardcore", "cover_url": None},
        {"type": "genre", "genre_slug": "  ", "cover_url": None},
    ]

    radio_stations._add_genre_station_artwork_fallbacks(stations)

    assert stations[0]["cover_url"] is None
    assert stations[1]["cover_url"] is None


def test_genre_station_artwork_fallback_failure_does_not_break_stations(
    monkeypatch, caplog
):
    from crate.db.queries import radio_stations

    def fail_lookup():
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(
        radio_stations, "_cached_genre_station_artwork_fallbacks", fail_lookup
    )
    stations = [
        {
            "type": "genre",
            "genre_name": "Hardcore",
            "genre_slug": "hardcore",
            "cover_url": None,
        }
    ]

    with caplog.at_level("WARNING", logger=radio_stations.__name__):
        radio_stations._add_genre_station_artwork_fallbacks(stations)

    assert stations[0]["cover_url"] is None
    assert "Failed to load genre station artwork fallbacks" in caplog.text


def test_genre_station_artwork_fallbacks_are_cached(monkeypatch):
    from crate.db.queries import radio_stations

    class Result:
        def mappings(self):
            return self

        def all(self):
            return [
                {"genre_slug": "hardcore", "artist_id": 42},
                {"genre_slug": "post-punk", "artist_id": 43},
                {"genre_slug": None, "artist_id": 44},
                {"genre_slug": "  ", "artist_id": 45},
            ]

    class Session:
        def execute(self, *_args, **_kwargs):
            return Result()

    class ReadScope:
        def __enter__(self):
            return Session()

        def __exit__(self, *_args):
            return False

    cache = {}
    cache_misses = []
    cache_calls = []

    def cached_compute(cache_key, *, compute, **_kwargs):
        cache_calls.append((cache_key, _kwargs))
        if cache_key not in cache:
            cache_misses.append(cache_key)
            cache[cache_key] = compute()
        return cache[cache_key]

    monkeypatch.setattr(radio_stations, "read_scope", ReadScope)
    monkeypatch.setattr(radio_stations, "get_or_compute_home_cache", cached_compute)

    for genre_slug, artist_id in [("hardcore", 42), ("post-punk", 43)]:
        stations = [
            {
                "type": "genre",
                "genre_name": genre_slug,
                "genre_slug": genre_slug,
                "cover_url": None,
            }
        ]
        radio_stations._add_genre_station_artwork_fallbacks(stations)
        assert stations[0]["cover_url"] == (
            f"/api/artists/{artist_id}/background?size=640&format=webp"
        )

    assert cache_misses == [radio_stations._GENRE_STATION_ARTWORK_CACHE_KEY]
    assert all(
        key == radio_stations._GENRE_STATION_ARTWORK_CACHE_KEY
        and kwargs == {"max_age_seconds": 600, "ttl": 600}
        for key, kwargs in cache_calls
    )


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_genre_station_artwork_fallback_query_uses_top_artist(pg_db, monkeypatch):
    from crate.db.queries import radio_stations
    from crate.db.tx import read_scope

    monkeypatch.setattr(
        radio_stations,
        "get_or_compute_home_cache",
        lambda _key, *, compute, **_kwargs: compute(),
    )

    lower_ranked_artist = "Radio Fallback Lower Ranked"
    preferred_artist = "Radio Fallback Preferred"
    genre_name = "integration radio fallback genre"
    pg_db.upsert_artist({"name": lower_ranked_artist})
    pg_db.upsert_artist({"name": preferred_artist})
    pg_db.set_artist_genres(lower_ranked_artist, [(genre_name, 0.8, "test")])
    pg_db.set_artist_genres(preferred_artist, [(genre_name, 0.95, "test")])

    with read_scope() as session:
        expected_artist_id = session.execute(
            text("SELECT id FROM library_artists WHERE name = :name"),
            {"name": preferred_artist},
        ).scalar_one()

    stations = [
        {
            "type": "genre",
            "genre_name": genre_name.upper(),
            "genre_slug": radio_stations.resolve_genre_slug(genre_name),
            "cover_url": None,
        }
    ]
    radio_stations._add_genre_station_artwork_fallbacks(stations)

    assert stations[0]["cover_url"] == (
        f"/api/artists/{expected_artist_id}/background?size=640&format=webp"
    )


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_genre_station_artwork_fallback_groups_case_insensitive_slugs(
    pg_db, monkeypatch
):
    from crate.db.queries import radio_stations
    from crate.db.tx import read_scope, transaction_scope

    monkeypatch.setattr(
        radio_stations,
        "get_or_compute_home_cache",
        lambda _key, *, compute, **_kwargs: compute(),
    )

    preferred_artist = "Casefold Genre Preferred Artist"
    lower_ranked_artist = "Casefold Genre Lower Ranked Artist"
    pg_db.upsert_artist({"name": preferred_artist})
    pg_db.upsert_artist({"name": lower_ranked_artist})
    with transaction_scope() as session:
        upper_slug_id = session.execute(
            text("INSERT INTO genres (name, slug) VALUES (:name, :slug) RETURNING id"),
            {"name": "Casefold Genre Upper", "slug": "CasefoldGenre"},
        ).scalar_one()
        lower_slug_id = session.execute(
            text("INSERT INTO genres (name, slug) VALUES (:name, :slug) RETURNING id"),
            {"name": "Casefold Genre Lower", "slug": "casefoldgenre"},
        ).scalar_one()
        session.execute(
            text(
                "INSERT INTO artist_genres (artist_name, genre_id, weight, source) "
                "VALUES (:artist_name, :genre_id, :weight, 'test')"
            ),
            [
                {
                    "artist_name": preferred_artist,
                    "genre_id": upper_slug_id,
                    "weight": 0.95,
                },
                {
                    "artist_name": lower_ranked_artist,
                    "genre_id": lower_slug_id,
                    "weight": 0.8,
                },
            ],
        )

    with read_scope() as session:
        expected_artist_id = session.execute(
            text("SELECT id FROM library_artists WHERE name = :name"),
            {"name": preferred_artist},
        ).scalar_one()

    stations = [
        {
            "type": "genre",
            "genre_slug": "casefoldgenre",
            "cover_url": None,
        }
    ]
    radio_stations._add_genre_station_artwork_fallbacks(stations)

    assert stations[0]["cover_url"] == (
        f"/api/artists/{expected_artist_id}/background?size=640&format=webp"
    )
