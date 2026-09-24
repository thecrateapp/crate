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


def test_genre_stations_fall_back_to_top_artist_background(monkeypatch):
    from crate.db.queries import radio_stations

    class Result:
        def mappings(self):
            return self

        def all(self):
            return [{"genre_name": "Hardcore", "artist_id": 42}]

    class Session:
        def execute(self, *_args, **_kwargs):
            return Result()

    class ReadScope:
        def __enter__(self):
            return Session()

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(radio_stations, "read_scope", ReadScope)
    stations = [
        {"type": "genre", "genre_name": "Hardcore", "cover_url": None},
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
