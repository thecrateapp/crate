def test_radio_station_payload_splits_artist_and_genre_stations(monkeypatch):
    from crate.db.queries import radio_stations

    monkeypatch.setattr(
        radio_stations,
        "get_genre_radio_representatives",
        lambda slugs: {
            slug: {"slug": slug, "cover_path": "hardcore.webp", "album_id": 4}
            for slug in slugs
            if slug == "hardcore"
        },
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


def _genre_payload(monkeypatch, top_genres, representatives, *, limit=12):
    from crate.db.queries import radio_stations

    slugs = {
        "Psychedelic Rock": "psychedelic-rock",
        "Rock": "rock",
        "Hardcore Punk": "hardcore-punk",
        "Punk Rock": "punk",
        "Straight Edge": "straight-edge",
        "Dance-Rock": "dance-rock",
    }
    requested: list[list[str]] = []

    def lookup(slugs_wanted):
        requested.append(list(slugs_wanted))
        return {
            slug: {"slug": slug, **representatives[slug]}
            for slug in slugs_wanted
            if slug in representatives
        }

    monkeypatch.setattr(radio_stations, "resolve_genre_slug", slugs.get)
    monkeypatch.setattr(radio_stations, "get_genre_display_name", lambda slug: slug)
    monkeypatch.setattr(radio_stations, "get_genre_radio_representatives", lookup)
    monkeypatch.setattr(
        radio_stations, "list_global_collection_artists", lambda **_kwargs: []
    )
    payload = radio_stations.build_radio_stations_from_context(
        {"top_artists": [], "followed": [], "top_genres": top_genres},
        genre_limit=limit,
    )
    return payload["genre_stations"], requested


def test_genre_stations_split_compound_tags_and_sum_their_listening(monkeypatch):
    stations, requested = _genre_payload(
        monkeypatch,
        [
            {"genre_name": "Psychedelic Rock, Rock", "play_count": 16},
            {"genre_name": "Hardcore Punk, Punk Rock", "play_count": 4},
            {"genre_name": "Hardcore Punk", "play_count": 3},
            {"genre_name": "Straight Edge; Hardcore Punk", "play_count": 3},
        ],
        {
            "psychedelic-rock": {"cover_path": "psych.webp"},
            "rock": {"cover_path": "rock.webp"},
            "hardcore-punk": {"cover_path": "hc.webp"},
            "punk": {"cover_path": "punk.webp"},
            "straight-edge": {"cover_path": "sxe.webp"},
        },
    )

    assert [station["seed_value"] for station in stations] == [
        "psychedelic-rock",
        "rock",
        "hardcore-punk",
        "punk",
        "straight-edge",
    ]
    assert stations[2]["play_count"] == 10
    assert len(requested) == 1
    assert all("," not in slug and " " not in slug for slug in requested[0])


def test_genre_stations_skip_genres_without_artists(monkeypatch):
    stations, _ = _genre_payload(
        monkeypatch,
        [
            {"genre_name": "Hard Rock, Dance-Rock", "play_count": 2},
            {"genre_name": "Rock", "play_count": 1},
        ],
        {"rock": {"cover_path": "rock.webp"}},
    )

    assert [station["seed_value"] for station in stations] == ["rock"]


def test_genre_stations_without_a_cover_borrow_a_representative_album(monkeypatch):
    stations, _ = _genre_payload(
        monkeypatch,
        [{"genre_name": "Rock", "play_count": 5}],
        {
            "rock": {
                "cover_path": None,
                "album_id": 42,
                "album_entity_uid": "album-uid",
                "album_slug": "lobotomizer",
                "album_name": "Lobotomizer",
            }
        },
    )

    assert stations[0]["cover_url"] is None
    assert stations[0]["album_id"] == 42
    assert stations[0]["album_entity_uid"] == "album-uid"
    assert stations[0]["album_name"] == "Lobotomizer"


def test_genre_stations_with_a_cover_do_not_carry_an_album(monkeypatch):
    stations, _ = _genre_payload(
        monkeypatch,
        [{"genre_name": "Rock", "play_count": 5}],
        {"rock": {"cover_path": "rock.webp", "album_id": 42}},
    )

    assert stations[0]["cover_url"]
    assert "album_id" not in stations[0]


def test_genre_radio_representatives_pick_an_album_with_a_cover(pg_db):
    from sqlalchemy import text

    from crate.db.queries.radio_stations import get_genre_radio_representatives
    from crate.db.tx import transaction_scope

    pg_db.upsert_artist({"name": "Radio Grime Lead"})
    pg_db.upsert_artist({"name": "Radio Grime Support"})
    pg_db.set_artist_genres("Radio Grime Lead", [("grime", 0.9, "test")])
    pg_db.set_artist_genres("Radio Grime Support", [("grime", 0.4, "test")])
    pg_db.upsert_artist({"name": "Radio Lonely"})
    pg_db.upsert_album(
        {
            "artist": "Radio Grime Lead",
            "name": "No Cover Yet",
            "path": "/music/Radio Grime Lead/No Cover Yet",
            "track_count": 1,
        }
    )
    covered = pg_db.upsert_album(
        {
            "artist": "Radio Grime Support",
            "name": "Cosmonautica",
            "path": "/music/Radio Grime Support/Cosmonautica",
            "track_count": 1,
        }
    )
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET has_cover = 1 WHERE id = :id"),
            {"id": covered},
        )
        session.execute(
            text("INSERT INTO genres (name, slug) VALUES ('orphan', 'orphan')")
        )

    representatives = get_genre_radio_representatives(
        ["grime", "orphan", "not-a-genre"]
    )

    assert set(representatives) == {"grime"}
    assert representatives["grime"]["album_id"] == covered
    assert representatives["grime"]["album_name"] == "Cosmonautica"
    assert get_genre_radio_representatives([]) == {}
