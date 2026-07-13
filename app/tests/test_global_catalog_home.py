import crate.db.home_builder_upcoming_artists as home_builder_upcoming_artists
import crate.db.home_builder_recent_activity as home_builder_recent_activity
import crate.db.home_builder_track_payloads as home_builder_track_payloads
import crate.db.home_personalized_discovery as home_personalized_discovery
import crate.db.queries.radio_stations as radio_stations


def test_recent_global_artists_remains_local_when_home_surface_disabled(monkeypatch):
    monkeypatch.setattr(
        home_builder_upcoming_artists,
        "global_catalog_surface_enabled",
        lambda surface: False,
    )
    monkeypatch.setattr(
        home_builder_upcoming_artists,
        "get_recent_global_artist_rows",
        lambda limit: [
            {
                "id": 7,
                "slug": "high-vis",
                "name": "High Vis",
                "album_count": 2,
                "track_count": 20,
                "has_photo": 1,
            }
        ],
    )

    assert home_builder_upcoming_artists._build_recent_global_artists(7) == [
        {
            "id": 7,
            "slug": "high-vis",
            "name": "High Vis",
            "album_count": 2,
            "track_count": 20,
            "has_photo": True,
        }
    ]


def test_recent_global_artists_uses_canonical_catalog_when_home_surface_enabled(
    monkeypatch,
):
    monkeypatch.setattr(
        home_builder_upcoming_artists,
        "global_catalog_surface_enabled",
        lambda surface: surface == "home",
    )
    monkeypatch.setattr(
        home_builder_upcoming_artists,
        "list_global_collection_artists",
        lambda limit: [
            {
                "artist_id": None,
                "global_artist_uid": "artist-global",
                "artist_entity_uid": None,
                "artist_slug": None,
                "artist_name": "Rival Schools",
                "album_count": 1,
                "track_count": 12,
                "has_photo": True,
                "photo_url": "/api/catalog/artists/artist-global/photo",
            }
        ],
    )

    assert home_builder_upcoming_artists._build_recent_global_artists(7) == [
        {
            "id": None,
            "global_artist_uid": "artist-global",
            "entity_uid": None,
            "slug": None,
            "name": "Rival Schools",
            "album_count": 1,
            "track_count": 12,
            "has_photo": True,
            "photo_url": "/api/catalog/artists/artist-global/photo",
        }
    ]


def test_home_suggested_albums_merges_global_catalog_and_dedupes(monkeypatch):
    monkeypatch.setattr(
        home_personalized_discovery,
        "_build_suggested_albums",
        lambda recent_releases, limit: [
            {
                "album_id": 9,
                "artist_name": "High Vis",
                "album_name": "Blending",
            },
            {
                "album_id": 10,
                "artist_name": "Fiddlehead",
                "album_name": "Death Is Nothing To Us",
            },
        ],
    )
    monkeypatch.setattr(
        home_personalized_discovery,
        "global_suggested_albums",
        lambda limit: [
            {
                "album_id": None,
                "global_album_uid": "global-blending",
                "global_artist_uid": "global-high-vis",
                "album_entity_uid": None,
                "slug": None,
                "artist_name": "High Vis",
                "artist_id": None,
                "artist_entity_uid": None,
                "artist_slug": None,
                "album_name": "Blending",
                "year": "2022",
                "cover_url": "/api/catalog/albums/global-blending/cover",
            },
            {
                "album_id": None,
                "global_album_uid": "global-pedals",
                "global_artist_uid": "global-rival-schools",
                "album_entity_uid": None,
                "slug": None,
                "artist_name": "Rival Schools",
                "artist_id": None,
                "artist_entity_uid": None,
                "artist_slug": None,
                "album_name": "Pedals",
                "year": "2011",
                "cover_url": "/api/catalog/albums/global-pedals/cover",
            },
        ],
    )

    albums = home_personalized_discovery._build_home_suggested_albums([], 3)

    assert [album["album_name"] for album in albums] == [
        "Blending",
        "Pedals",
        "Death Is Nothing To Us",
    ]
    assert albums[0]["global_album_uid"] == "global-blending"
    assert albums[1]["global_album_uid"] == "global-pedals"


def test_home_recently_played_preserves_global_catalog_routes(monkeypatch):
    monkeypatch.setattr(
        home_builder_recent_activity,
        "get_play_history",
        lambda user_id, limit: [
            {
                "title": "0151",
                "artist": "High Vis",
                "album": "Blending",
                "global_track_uid": "global-track",
                "global_artist_uid": "global-high-vis",
                "global_album_uid": "global-blending",
                "artist_id": None,
                "artist_entity_uid": None,
                "artist_slug": None,
                "album_id": None,
                "album_entity_uid": None,
                "album_slug": None,
                "played_at": "2026-07-11T10:00:00Z",
            }
        ],
    )
    monkeypatch.setattr(
        home_builder_recent_activity,
        "get_recent_playlist_rows_with_artwork",
        lambda user_id, limit: [],
    )

    items = home_builder_recent_activity.build_recently_played(7, limit=4)

    assert items == [
        {
            "type": "artist",
            "artist_id": None,
            "artist_entity_uid": None,
            "global_artist_uid": "global-high-vis",
            "artist_slug": None,
            "artist_name": "High Vis",
            "subtitle": "Artist",
            "played_at": "2026-07-11T10:00:00Z",
        },
        {
            "type": "album",
            "album_id": None,
            "album_entity_uid": None,
            "global_album_uid": "global-blending",
            "album_slug": None,
            "album_name": "Blending",
            "artist_name": "High Vis",
            "artist_id": None,
            "artist_entity_uid": None,
            "global_artist_uid": "global-high-vis",
            "artist_slug": None,
            "subtitle": "Album",
            "played_at": "2026-07-11T10:00:00Z",
        },
    ]


def test_home_track_payload_preserves_global_catalog_refs():
    payload = home_builder_track_payloads._track_payload(
        {
            "track_id": None,
            "global_track_uid": "global-track",
            "track_entity_uid": None,
            "track_path": "global-track",
            "title": "0151",
            "artist": "High Vis",
            "artist_id": None,
            "global_artist_uid": "global-high-vis",
            "artist_entity_uid": None,
            "artist_slug": None,
            "album": "Blending",
            "album_id": None,
            "global_album_uid": "global-blending",
            "album_entity_uid": None,
            "album_slug": None,
        }
    )

    assert payload["global_track_uid"] == "global-track"
    assert payload["global_artist_uid"] == "global-high-vis"
    assert payload["global_album_uid"] == "global-blending"


def test_home_artwork_preserves_global_catalog_refs():
    rows = [
        {
            "artist": "High Vis",
            "artist_id": None,
            "global_artist_uid": "global-high-vis",
            "artist_entity_uid": None,
            "artist_slug": None,
            "album": "Blending",
            "album_id": None,
            "global_album_uid": "global-blending",
            "album_entity_uid": None,
            "album_slug": None,
        }
    ]

    assert home_builder_track_payloads._artwork_tracks(rows) == [
        {
            "artist": "High Vis",
            "artist_id": None,
            "artist_entity_uid": None,
            "artist_slug": None,
            "album": "Blending",
            "album_id": None,
            "album_entity_uid": None,
            "album_slug": None,
            "global_artist_uid": "global-high-vis",
            "global_album_uid": "global-blending",
        }
    ]
    assert home_builder_track_payloads._artwork_artists(rows) == [
        {
            "artist_name": "High Vis",
            "artist_id": None,
            "artist_entity_uid": None,
            "artist_slug": None,
            "global_artist_uid": "global-high-vis",
        }
    ]


def test_radio_stations_use_global_catalog_when_surface_enabled(monkeypatch):
    monkeypatch.setattr(
        radio_stations,
        "global_catalog_surface_enabled",
        lambda surface: surface == "radio",
    )
    monkeypatch.setattr(
        radio_stations,
        "get_cached_home_context",
        lambda *_args, **_kwargs: {
            "top_genres": [],
            "top_artists": [
                {
                    "artist_id": None,
                    "global_artist_uid": "global-high-vis",
                    "artist_name": "High Vis",
                    "play_count": 9,
                    "minutes_listened": 31,
                }
            ],
            "followed": [],
        },
    )
    monkeypatch.setattr(
        radio_stations,
        "list_global_collection_artists",
        lambda limit: [
            {
                "artist_id": None,
                "global_artist_uid": "global-rival-schools",
                "artist_entity_uid": None,
                "artist_slug": None,
                "artist_name": "Rival Schools",
                "has_photo": True,
                "photo_url": "/api/catalog/artists/global-rival-schools/photo",
                "track_count": 12,
                "album_count": 1,
            }
        ],
    )

    payload = radio_stations.get_user_radio_stations(7)

    assert payload["artist_stations"] == [
        {
            "type": "artist",
            "seed_type": "artist",
            "seed_value": "global-high-vis",
            "seed_label": "High Vis",
            "seed_subtitle": "Artist",
            "artist_id": None,
            "global_artist_uid": "global-high-vis",
            "artist_entity_uid": None,
            "artist_slug": None,
            "artist_name": "High Vis",
            "title": "High Vis Radio",
            "subtitle": "",
            "play_count": 9,
            "minutes_listened": 31,
        },
        {
            "type": "artist",
            "seed_type": "artist",
            "seed_value": "global-rival-schools",
            "seed_label": "Rival Schools",
            "seed_subtitle": "Artist",
            "artist_id": None,
            "global_artist_uid": "global-rival-schools",
            "artist_entity_uid": None,
            "artist_slug": None,
            "artist_name": "Rival Schools",
            "title": "Rival Schools Radio",
            "subtitle": "",
            "play_count": 0,
            "minutes_listened": 0,
            "cover_url": "/api/catalog/artists/global-rival-schools/photo",
        },
    ]


def test_radio_stations_ignore_global_catalog_in_standalone(monkeypatch):
    monkeypatch.setattr(
        radio_stations,
        "global_catalog_surface_enabled",
        lambda _surface: False,
    )
    monkeypatch.setattr(
        radio_stations,
        "get_cached_home_context",
        lambda *_args, **_kwargs: {
            "top_genres": [],
            "top_artists": [
                {
                    "artist_id": None,
                    "global_artist_uid": "global-high-vis",
                    "artist_name": "High Vis",
                }
            ],
            "followed": [],
        },
    )
    monkeypatch.setattr(
        radio_stations,
        "list_global_collection_artists",
        lambda limit: [
            {
                "global_artist_uid": "global-rival-schools",
                "artist_name": "Rival Schools",
            }
        ],
    )

    payload = radio_stations.get_user_radio_stations(7)

    assert payload["artist_stations"] == []


def test_global_artist_core_home_playlist_returns_catalog_tracks(monkeypatch):
    from crate.db import home_personalized_collections

    monkeypatch.setattr(
        home_personalized_collections,
        "global_catalog_surface_enabled",
        lambda surface: surface == "home",
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "get_global_radio_seed_tracks",
        lambda seed_type, global_uid, **_: {
            "label": "High Vis",
            "tracks": [
                {
                    "track_id": None,
                    "global_track_uid": "global-track-1",
                    "global_artist_uid": global_uid,
                    "global_album_uid": "global-album-1",
                    "track_entity_uid": None,
                    "track_path": None,
                    "title": "0151",
                    "artist": "High Vis",
                    "artist_id": None,
                    "artist_entity_uid": None,
                    "artist_slug": None,
                    "album": "Blending",
                    "album_id": None,
                    "album_entity_uid": None,
                    "album_slug": None,
                    "duration": 181,
                }
            ],
        },
    )

    payload = home_personalized_collections.get_home_playlist(
        7,
        "core-tracks-global-artist-global-high-vis",
    )

    assert payload["id"] == "core-tracks-global-artist-global-high-vis"
    assert payload["tracks"][0]["global_track_uid"] == "global-track-1"
    assert payload["tracks"][0]["global_artist_uid"] == "global-high-vis"
    assert payload["artwork_tracks"][0]["global_album_uid"] == "global-album-1"


def test_global_artist_core_home_playlist_disabled_in_standalone(monkeypatch):
    from crate.db import home_personalized_collections

    monkeypatch.setattr(
        home_personalized_collections,
        "global_catalog_surface_enabled",
        lambda surface: False,
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "get_global_radio_seed_tracks",
        lambda *_, **__: (_ for _ in ()).throw(
            AssertionError("should not load global")
        ),
    )

    assert (
        home_personalized_collections.get_home_playlist(
            7,
            "core-tracks-global-artist-global-high-vis",
        )
        is None
    )


def test_home_recommended_tracks_endpoint_merges_global_tracks(monkeypatch):
    from crate.db import home_personalized_collections

    monkeypatch.setattr(
        home_personalized_collections,
        "get_cached_home_context",
        lambda *_args, **_kwargs: {
            "interest_artists_lower": ["high vis"],
            "top_artists": [{"global_artist_uid": "global-high-vis"}],
            "followed": [],
        },
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "recent_releases_from_context",
        lambda _ctx: [],
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "_build_recommended_tracks",
        lambda *_args, **_kwargs: [],
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "global_artist_uids_from_context",
        lambda _ctx: ["global-high-vis"],
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "global_recommended_track_rows",
        lambda _uids, **_kwargs: [
            {
                "track_id": None,
                "global_track_uid": "global-track-1",
                "global_artist_uid": "global-high-vis",
                "global_album_uid": "global-album-1",
                "track_entity_uid": None,
                "track_path": None,
                "title": "0151",
                "artist": "High Vis",
                "artist_id": None,
                "artist_entity_uid": None,
                "artist_slug": None,
                "album": "Blending",
                "album_id": None,
                "album_entity_uid": None,
                "album_slug": None,
                "duration": 181,
            }
        ],
    )

    payload = home_personalized_collections.get_home_recommended_tracks(7)

    assert payload[0]["global_track_uid"] == "global-track-1"
    assert payload[0]["global_artist_uid"] == "global-high-vis"
    assert payload[0]["global_album_uid"] == "global-album-1"


def test_home_suggested_albums_endpoint_merges_global_albums(monkeypatch):
    from crate.db import home_personalized_collections

    monkeypatch.setattr(
        home_personalized_collections,
        "get_cached_home_context",
        lambda *_args, **_kwargs: {},
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "recent_releases_from_context",
        lambda _ctx: [],
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "_build_suggested_albums",
        lambda _recent, _limit: [],
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "global_suggested_albums",
        lambda _limit: [
            {
                "global_album_uid": "global-album-1",
                "global_artist_uid": "global-high-vis",
                "artist_name": "High Vis",
                "album_name": "Blending",
            }
        ],
    )

    payload = home_personalized_collections.get_home_suggested_albums(7)

    assert payload[0]["global_album_uid"] == "global-album-1"
    assert payload[0]["global_artist_uid"] == "global-high-vis"


def test_home_custom_mixes_endpoint_uses_global_tracks_when_local_mix_is_empty(
    monkeypatch,
):
    from crate.db import home_builder_mix_generation, home_personalized_collections

    monkeypatch.setattr(
        home_personalized_collections,
        "get_cached_home_context",
        lambda *_args, **_kwargs: {
            "mix_seed_genres": [],
            "interest_artists_lower": ["high vis"],
            "top_genres_lower": [],
            "top_artists": [{"global_artist_uid": "global-high-vis"}],
            "followed": [],
        },
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "recent_releases_from_context",
        lambda _ctx: [],
    )
    monkeypatch.setattr(
        home_builder_mix_generation,
        "_build_mix_rows",
        lambda *_args, **_kwargs: ("Daily Discovery", "Fresh tracks.", []),
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "_build_mix_rows",
        lambda *_args, **_kwargs: ("Daily Discovery", "Fresh tracks.", []),
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "global_artist_uids_from_context",
        lambda _ctx: ["global-high-vis"],
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "global_recommended_track_rows",
        lambda _uids, **_kwargs: [
            {
                "track_id": None,
                "global_track_uid": "global-track-1",
                "global_artist_uid": "global-high-vis",
                "global_album_uid": "global-album-1",
                "track_entity_uid": None,
                "track_path": None,
                "title": "Guided Tour",
                "artist": "High Vis",
                "artist_id": None,
                "artist_entity_uid": None,
                "artist_slug": None,
                "album": "Guided Tour",
                "album_id": None,
                "album_entity_uid": None,
                "album_slug": None,
                "duration": 265,
            }
        ],
    )

    payload = home_personalized_collections.get_home_mixes(7)

    assert payload[0]["id"] == "daily-discovery"
    assert payload[0]["artwork_tracks"][0]["global_album_uid"] == "global-album-1"
    assert payload[0]["artwork_artists"][0]["global_artist_uid"] == "global-high-vis"


def test_home_custom_mix_detail_merges_global_tracks(monkeypatch):
    from crate.db import home_builder_mix_generation, home_personalized_collections

    monkeypatch.setattr(
        home_personalized_collections,
        "get_cached_home_context",
        lambda *_args, **_kwargs: {
            "interest_artists_lower": ["high vis"],
            "top_genres_lower": [],
            "top_artists": [{"global_artist_uid": "global-high-vis"}],
            "followed": [],
        },
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "recent_releases_from_context",
        lambda _ctx: [],
    )
    monkeypatch.setattr(
        home_builder_mix_generation,
        "_build_mix_rows",
        lambda *_args, **_kwargs: ("Daily Discovery", "Fresh tracks.", []),
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "_build_mix_rows",
        lambda *_args, **_kwargs: ("Daily Discovery", "Fresh tracks.", []),
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "global_artist_uids_from_context",
        lambda _ctx: ["global-high-vis"],
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "global_recommended_track_rows",
        lambda _uids, **_kwargs: [
            {
                "track_id": None,
                "global_track_uid": "global-track-1",
                "global_artist_uid": "global-high-vis",
                "global_album_uid": "global-album-1",
                "track_entity_uid": None,
                "track_path": None,
                "title": "Guided Tour",
                "artist": "High Vis",
                "artist_id": None,
                "artist_entity_uid": None,
                "artist_slug": None,
                "album": "Guided Tour",
                "album_id": None,
                "album_entity_uid": None,
                "album_slug": None,
                "duration": 265,
            }
        ],
    )

    payload = home_personalized_collections.get_home_mix(
        7, "daily-discovery", limit=8
    )

    assert payload is not None
    assert payload["tracks"][0]["global_track_uid"] == "global-track-1"
    assert payload["artwork_tracks"][0]["global_album_uid"] == "global-album-1"


def test_home_genre_custom_mix_detail_filters_global_tracks_by_direct_genre(
    monkeypatch,
):
    from crate.db import home_personalized_collections

    monkeypatch.setattr(
        home_personalized_collections,
        "get_cached_home_context",
        lambda *_args, **_kwargs: {
            "interest_artists_lower": ["birds in row"],
            "top_genres_lower": ["screamo"],
            "top_artists": [{"global_artist_uid": "global-high-vis"}],
            "followed": [],
        },
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "recent_releases_from_context",
        lambda _ctx: [],
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "_build_mix_rows",
        lambda *_args, **_kwargs: (
            "screamo mix",
            "Screamo tracks.",
            [
                {
                    "track_id": 10,
                    "track_entity_uid": "local-screamo-track",
                    "track_path": "/music/birds-in-row/local.flac",
                    "title": "Local Screamo Track",
                    "artist": "Birds In Row",
                    "artist_id": 1,
                    "artist_entity_uid": "local-birds",
                    "artist_slug": "birds-in-row",
                    "album": "Local Screamo Album",
                    "album_id": 2,
                    "album_entity_uid": "local-album",
                    "album_slug": "local-screamo-album",
                    "duration": 180,
                    "genres": ["screamo"],
                }
            ],
        ),
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "global_artist_uids_from_context",
        lambda _ctx: ["global-high-vis"],
    )
    monkeypatch.setattr(
        home_personalized_collections,
        "global_recommended_track_rows",
        lambda _uids, **_kwargs: [
            {
                "track_id": None,
                "global_track_uid": "global-high-vis-track",
                "global_artist_uid": "global-high-vis",
                "global_album_uid": "global-high-vis-album",
                "track_entity_uid": None,
                "track_path": None,
                "title": "Guided Tour",
                "artist": "High Vis",
                "artist_id": None,
                "artist_entity_uid": None,
                "artist_slug": None,
                "album": "Guided Tour",
                "album_id": None,
                "album_entity_uid": None,
                "album_slug": None,
                "duration": 265,
                "genres": ["hardcore punk"],
            },
            {
                "track_id": None,
                "global_track_uid": "global-screamo-track",
                "global_artist_uid": "global-screamo-artist",
                "global_album_uid": "global-screamo-album",
                "track_entity_uid": None,
                "track_path": None,
                "title": "Actual Screamo Track",
                "artist": "Screamo Artist",
                "artist_id": None,
                "artist_entity_uid": None,
                "artist_slug": None,
                "album": "Actual Screamo Album",
                "album_id": None,
                "album_entity_uid": None,
                "album_slug": None,
                "duration": 180,
                "genres": ["screamo"],
            },
        ],
    )

    payload = home_personalized_collections.get_home_mix(7, "genre-screamo", limit=8)

    assert payload is not None
    track_global_uids = {
        track.get("global_track_uid") for track in payload["tracks"] if track.get("global_track_uid")
    }
    assert "global-screamo-track" in track_global_uids
    assert "global-high-vis-track" not in track_global_uids


def test_genre_custom_mix_filters_global_tracks_by_direct_genre():
    from crate.db.home_builder_mix_generation import _build_custom_mix_summaries

    mixes = _build_custom_mix_summaries(
        7,
        mix_seed_genres=[{"slug": "screamo"}],
        interest_artists_lower=[],
        top_genres_lower=[],
        mix_count=3,
        precomputed_mixes={
            "daily-discovery": ("", "", []),
            "my-new-arrivals": ("", "", []),
            "genre-screamo": ("screamo mix", "Screamo tracks.", []),
        },
        global_track_rows=[
            {
                "track_id": None,
                "global_track_uid": "global-high-vis-track",
                "global_artist_uid": "global-high-vis",
                "global_album_uid": "global-high-vis-album",
                "track_entity_uid": None,
                "track_path": None,
                "title": "Guided Tour",
                "artist": "High Vis",
                "artist_id": None,
                "artist_entity_uid": None,
                "artist_slug": None,
                "album": "Guided Tour",
                "album_id": None,
                "album_entity_uid": None,
                "album_slug": None,
                "duration": 265,
                "genres": ["hardcore punk"],
            },
            {
                "track_id": None,
                "global_track_uid": "global-screamo-track",
                "global_artist_uid": "global-screamo-artist",
                "global_album_uid": "global-screamo-album",
                "track_entity_uid": None,
                "track_path": None,
                "title": "Actual Screamo Track",
                "artist": "Screamo Artist",
                "artist_id": None,
                "artist_entity_uid": None,
                "artist_slug": None,
                "album": "Actual Screamo Album",
                "album_id": None,
                "album_entity_uid": None,
                "album_slug": None,
                "duration": 180,
                "genres": ["screamo"],
            },
        ],
    )

    assert len(mixes) == 1
    assert mixes[0]["id"] == "genre-screamo"
    assert mixes[0]["artwork_tracks"] == [
        {
            "artist": "Screamo Artist",
            "artist_id": None,
            "artist_entity_uid": None,
            "artist_slug": None,
            "album": "Actual Screamo Album",
            "album_id": None,
            "album_entity_uid": None,
            "album_slug": None,
            "global_artist_uid": "global-screamo-artist",
            "global_album_uid": "global-screamo-album",
        }
    ]


def test_global_radio_track_payload_preserves_genres():
    from crate.db.queries.global_catalog import _global_radio_track_payload

    payload = _global_radio_track_payload(
        {
            "local_track_id": None,
            "global_track_uid": "global-track",
            "global_artist_uid": "global-artist",
            "global_album_uid": "global-album",
            "local_track_entity_uid": None,
            "canonical_title": "Actual Screamo Track",
            "artist_name": "Screamo Artist",
            "local_artist_id": None,
            "local_artist_entity_uid": None,
            "album_name": "Actual Screamo Album",
            "local_album_id": None,
            "local_album_entity_uid": None,
            "duration_seconds": 180,
            "year": "2026",
            "bpm": None,
            "audio_key": None,
            "audio_scale": None,
            "energy": None,
            "danceability": None,
            "valence": None,
            "bliss_vector": None,
            "availability_json": {},
            "has_local": False,
            "has_remote": True,
            "genres": ["screamo", "post-hardcore"],
        }
    )

    assert payload["genres"] == ["screamo", "post-hardcore"]
