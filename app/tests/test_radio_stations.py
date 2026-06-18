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
