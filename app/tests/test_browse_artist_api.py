from types import SimpleNamespace

from fastapi import Response
from fastapi.responses import JSONResponse


def _top_track_row(**overrides):
    row = {
        "id": 1,
        "title": "Track",
        "artist": "Example Artist",
        "artist_id": 10,
        "artist_slug": "example-artist",
        "album": "Album",
        "album_id": 20,
        "album_slug": "album",
        "duration": 180,
        "track_number": 1,
        "format": "FLAC",
    }
    row.update(overrides)
    return row


def test_top_tracks_fall_back_to_persisted_rank_signals_not_recent_album_order():
    from crate.api.browse_artist import _build_artist_top_tracks_payload

    rows = [
        _top_track_row(
            id=1,
            title="Current Single",
            year="2025",
            track_number=1,
            lastfm_top_rank=45,
            lastfm_playcount=3_800_000,
        ),
        _top_track_row(
            id=2,
            title="Catalog Favorite",
            year="2010",
            track_number=8,
            lastfm_top_rank=4,
            lastfm_playcount=29_000_000,
        ),
        _top_track_row(
            id=3,
            title="Unranked Album Closer",
            year="2025",
            track_number=11,
            lastfm_top_rank=None,
            lastfm_playcount=None,
        ),
    ]

    payload = _build_artist_top_tracks_payload(
        "Example Artist",
        count=10,
        lastfm_top=None,
        local_tracks=rows,
    )

    assert [track["title"] for track in payload] == [
        "Catalog Favorite",
        "Current Single",
    ]


def test_top_tracks_do_not_invent_rankings_without_track_level_signals():
    from crate.api.browse_artist import _build_artist_top_tracks_payload

    payload = _build_artist_top_tracks_payload(
        "Example Artist",
        count=10,
        lastfm_top=None,
        local_tracks=[
            _top_track_row(
                id=1,
                title="Album Track",
                year="2025",
                track_number=1,
            )
        ],
    )

    assert payload == []


def test_top_tracks_use_persisted_composite_popularity_when_source_ranks_are_missing():
    from crate.api.browse_artist import _build_artist_top_tracks_payload

    payload = _build_artist_top_tracks_payload(
        "Example Artist",
        count=10,
        lastfm_top=None,
        local_tracks=[
            _top_track_row(
                id=1,
                title="Lower Composite Score",
                popularity_score=0.41,
                popularity_confidence=0.8,
            ),
            _top_track_row(
                id=2,
                title="Higher Composite Score",
                popularity_score=0.93,
                popularity_confidence=0.9,
            ),
        ],
    )

    assert [track["title"] for track in payload] == [
        "Higher Composite Score",
        "Lower Composite Score",
    ]


def test_top_tracks_fallback_collapses_versions_and_prefers_studio_album_track():
    from crate.api.browse_artist import _build_artist_top_tracks_payload

    payload = _build_artist_top_tracks_payload(
        "Pantera",
        count=10,
        lastfm_top=None,
        local_tracks=[
            _top_track_row(
                id=1,
                title="Shattered (2010 Remaster)",
                artist="Pantera",
                album="Cowboys from Hell (Deluxe)",
                year="2010",
                lastfm_top_rank=22,
            ),
            _top_track_row(
                id=2,
                title="Shattered (Demo)",
                artist="Pantera",
                album="Cowboys from Hell (Deluxe)",
                year="2010",
                lastfm_top_rank=22,
            ),
            _top_track_row(
                id=3,
                title="Shattered",
                artist="Pantera",
                album="Cowboys from Hell",
                year="1990",
                lastfm_top_rank=22,
            ),
            _top_track_row(
                id=4,
                title="The Art of Shredding",
                artist="Pantera",
                album="Cowboys from Hell",
                year="1990",
                lastfm_top_rank=23,
            ),
        ],
    )

    assert [track["title"] for track in payload] == [
        "Shattered",
        "The Art of Shredding",
    ]


def test_top_tracks_preserve_only_variants_explicitly_ranked_by_lastfm():
    from crate.api.browse_artist import _build_artist_top_tracks_payload

    payload = _build_artist_top_tracks_payload(
        "Pantera",
        count=10,
        lastfm_top=[
            {"title": "Walk"},
            {"title": "Walk (Live at Dynamo Open Air 1998)"},
        ],
        local_tracks=[
            _top_track_row(
                id=1,
                title="Walk (2010 Remaster)",
                artist="Pantera",
                album="Vulgar Display of Power (Deluxe)",
                year="2012",
                lastfm_top_rank=1,
            ),
            _top_track_row(
                id=2,
                title="Walk",
                artist="Pantera",
                album="Vulgar Display of Power",
                year="1992",
                lastfm_top_rank=1,
            ),
            _top_track_row(
                id=3,
                title="Walk (Live at Dynamo Open Air 1998)",
                artist="Pantera",
                album="Live at Dynamo Open Air 1998",
                year="1998",
                lastfm_top_rank=40,
            ),
            _top_track_row(
                id=4,
                title="Walk (Demo)",
                artist="Pantera",
                album="Vulgar Display of Power (Deluxe)",
                year="2012",
                lastfm_top_rank=1,
            ),
        ],
    )

    assert [track["title"] for track in payload] == [
        "Walk",
        "Walk (Live at Dynamo Open Air 1998)",
    ]


def test_top_tracks_preview_is_prefix_of_view_all_ranking():
    from crate.api.browse_artist import _build_artist_top_tracks_payload

    rows = [
        _top_track_row(
            id=index,
            title=f"Track {index:02d}",
            track_number=index,
        )
        for index in range(1, 61)
    ]
    lastfm_top = [{"title": f"Track {index:02d}"} for index in range(60, 0, -1)]

    preview = _build_artist_top_tracks_payload(
        "Example Artist",
        count=5,
        lastfm_top=lastfm_top,
        local_tracks=rows,
    )
    view_all = _build_artist_top_tracks_payload(
        "Example Artist",
        count=50,
        lastfm_top=lastfm_top,
        local_tracks=rows,
    )

    assert preview == view_all[:5]


def test_artist_page_by_slug_falls_back_to_remote_global_catalog(monkeypatch):
    from crate.api import catalog_artist_compat

    expected = {
        "artist": {
            "global_artist_uid": "artist-global-1",
            "name": "High Vis",
        },
        "top_tracks": [{"title": "Choose To Lose"}],
    }
    monkeypatch.setattr(
        catalog_artist_compat, "_require_auth", lambda _request: {"id": 1}
    )
    monkeypatch.setattr(
        catalog_artist_compat, "get_library_artist_by_slug", lambda _slug: None
    )
    monkeypatch.setattr(
        catalog_artist_compat,
        "get_global_artist_page_by_public_slug",
        lambda slug: expected if slug == "high-vis" else None,
        raising=False,
    )
    hydrated = {**expected, "info": {"bio": "remote bio"}}
    monkeypatch.setattr(
        catalog_artist_compat,
        "_hydrate_public_page",
        lambda _request, _payload: hydrated,
        raising=False,
    )

    payload = catalog_artist_compat.api_artist_page_by_slug(
        SimpleNamespace(), "high-vis", 12, 12, "30d", 12
    )

    assert payload == hydrated


def test_artist_page_by_slug_adds_canonical_identity_to_local_payload(monkeypatch):
    from crate.api import catalog_artist_compat

    local_payload = {
        "artist": {
            "id": 7,
            "entity_uid": "local-artist-1",
            "slug": "high-vis",
            "name": "High Vis",
            "albums": [],
        },
        "top_tracks": [],
    }
    canonical_payload = {
        "artist": {
            "id": 7,
            "local_artist_entity_uid": "local-artist-1",
            "global_artist_uid": "global-artist-1",
            "global_uid": "global-artist-1",
            "availability": {"local": True, "remote": False},
        },
        "top_tracks": [],
    }
    monkeypatch.setattr(
        catalog_artist_compat, "_require_auth", lambda _request: {"id": 1}
    )
    monkeypatch.setattr(
        catalog_artist_compat,
        "get_library_artist_by_slug",
        lambda _slug: {"id": 7},
    )
    monkeypatch.setattr(
        catalog_artist_compat,
        "_build_artist_page_payload",
        lambda *_args, **_kwargs: local_payload,
    )
    monkeypatch.setattr(
        catalog_artist_compat,
        "get_global_artist_page_by_public_slug",
        lambda _slug: canonical_payload,
    )

    payload = catalog_artist_compat.api_artist_page_by_slug(
        SimpleNamespace(), "high-vis", 12, 12, "30d", 12
    )

    assert payload["artist"]["global_artist_uid"] == "global-artist-1"
    assert payload["artist"]["global_uid"] == "global-artist-1"
    assert payload["artist"]["availability"] == {
        "local": True,
        "remote": False,
    }


def test_artist_page_by_slug_preserves_local_builder_error_response(monkeypatch):
    from crate.api import catalog_artist_compat

    local_error = JSONResponse({"error": "invalid stats window"}, status_code=400)
    monkeypatch.setattr(
        catalog_artist_compat, "_require_auth", lambda _request: {"id": 1}
    )
    monkeypatch.setattr(
        catalog_artist_compat,
        "get_library_artist_by_slug",
        lambda _slug: {"id": 7},
    )
    monkeypatch.setattr(
        catalog_artist_compat,
        "_build_artist_page_payload",
        lambda *_args, **_kwargs: local_error,
    )
    monkeypatch.setattr(
        catalog_artist_compat,
        "get_global_artist_page_by_public_slug",
        lambda _slug: {
            "artist": {"global_artist_uid": "global-artist-1"},
        },
    )

    response = catalog_artist_compat.api_artist_page_by_slug(
        SimpleNamespace(), "high-vis", 12, 12, "invalid", 12
    )

    assert response is local_error


def test_artist_top_tracks_by_slug_falls_back_to_remote_global_catalog(monkeypatch):
    from crate.api import catalog_artist_compat

    expected = [{"title": "Choose To Lose"}]
    monkeypatch.setattr(
        catalog_artist_compat, "_require_auth", lambda _request: {"id": 1}
    )
    monkeypatch.setattr(
        catalog_artist_compat, "get_library_artist_by_slug", lambda _slug: None
    )
    monkeypatch.setattr(
        catalog_artist_compat,
        "get_global_artist_page_by_public_slug",
        lambda slug, **_kwargs: (
            {"top_tracks": expected} if slug == "high-vis" else None
        ),
        raising=False,
    )

    payload = catalog_artist_compat.api_artist_top_tracks_by_slug(
        SimpleNamespace(), "high-vis", 50
    )

    assert payload == expected


def test_artist_top_tracks_by_slug_adds_canonical_identity_and_honors_count(
    monkeypatch,
):
    from crate.api import catalog_artist_compat

    local_tracks = [
        {
            "id": "local-track-1",
            "track_id": 11,
            "track_entity_uid": "local-track-entity-1",
            "title": "Choose To Lose",
            "artist": "High Vis",
            "album": "No Sense No Feeling",
            "duration": 180,
            "track": 1,
        }
    ]
    canonical_tracks = [
        {
            "global_track_uid": "global-track-1",
            "globalTrackUid": "global-track-1",
            "local_track_id": 11,
            "local_track_entity_uid": "local-track-entity-1",
            "title": "Choose To Lose",
            "album": "No Sense No Feeling",
            "availability": {"local": True, "remote": True},
        }
    ]
    monkeypatch.setattr(
        catalog_artist_compat,
        "get_library_artist_by_slug",
        lambda _slug: {"id": 7},
    )
    monkeypatch.setattr(
        catalog_artist_compat,
        "api_artist_top_tracks",
        lambda *_args, **_kwargs: local_tracks,
    )
    captured = {}

    def get_canonical(_slug, *, top_tracks_limit=12):
        captured["limit"] = top_tracks_limit
        return {
            "artist": {"global_artist_uid": "global-artist-1"},
            "top_tracks": canonical_tracks,
        }

    monkeypatch.setattr(
        catalog_artist_compat,
        "get_global_artist_page_by_public_slug",
        get_canonical,
    )

    payload = catalog_artist_compat.api_artist_top_tracks_by_slug(
        SimpleNamespace(), "high-vis", 37
    )

    assert captured["limit"] == 37
    assert payload[0]["global_track_uid"] == "global-track-1"
    assert payload[0]["globalTrackUid"] == "global-track-1"
    assert payload[0]["availability"] == {"local": True, "remote": True}


def test_album_by_artist_slug_falls_back_to_remote_global_catalog(monkeypatch):
    from crate.api import browse_album

    expected = {
        "global_album_uid": "album-global-1",
        "artist": "High Vis",
        "name": "No Sense No Feeling",
        "tracks": [],
    }
    monkeypatch.setattr(browse_album, "get_library_artist_by_slug", lambda _slug: None)
    monkeypatch.setattr(
        browse_album,
        "get_global_album_detail_by_public_slugs",
        lambda artist_slug, album_slug: (
            expected
            if (artist_slug, album_slug) == ("high-vis", "no-sense-no-feeling")
            else None
        ),
        raising=False,
    )
    hydrated = {**expected, "genres": ["hardcore"]}
    monkeypatch.setattr(
        browse_album,
        "_hydrate_global_album_public_detail",
        lambda _request, _payload: hydrated,
        raising=False,
    )

    payload = browse_album.api_album_by_artist_slug(
        SimpleNamespace(), "high-vis", "no-sense-no-feeling"
    )

    assert payload == hydrated


def test_album_by_artist_slug_adds_canonical_identity_to_local_payload(monkeypatch):
    from crate.api import browse_album

    local_payload = {
        "id": 9,
        "entity_uid": "local-album-1",
        "artist": "High Vis",
        "name": "Blending",
        "tracks": [],
    }
    canonical_payload = {
        "id": 9,
        "local_album_entity_uid": "local-album-1",
        "global_album_uid": "global-album-1",
        "global_uid": "global-album-1",
        "global_artist_uid": "global-artist-1",
        "availability": {"local": True, "remote": False},
        "tracks": [],
    }
    monkeypatch.setattr(
        browse_album,
        "get_library_artist_by_slug",
        lambda _slug: {"id": 7, "name": "High Vis"},
    )
    monkeypatch.setattr(
        browse_album, "find_upcoming_release_by_artist_album_slug", lambda *_args: None
    )
    monkeypatch.setattr(
        browse_album,
        "get_library_albums",
        lambda _artist: [{"id": 9, "name": "Blending", "slug": "high-vis-blending"}],
    )
    monkeypatch.setattr(browse_album, "api_album", lambda *_args: local_payload)
    monkeypatch.setattr(
        browse_album,
        "get_global_album_detail_by_public_slugs",
        lambda *_args: canonical_payload,
    )

    payload = browse_album.api_album_by_artist_slug(
        SimpleNamespace(), "high-vis", "blending"
    )

    assert payload["global_album_uid"] == "global-album-1"
    assert payload["global_uid"] == "global-album-1"
    assert payload["global_artist_uid"] == "global-artist-1"


def test_human_slug_endpoints_serialize_remote_global_catalog(test_app, monkeypatch):
    from crate.api import browse_album, catalog_artist_compat

    artist_page = {
        "artist": {
            "id": None,
            "global_artist_uid": "artist-global-1",
            "slug": "high-vis",
            "name": "High Vis",
            "albums": [],
            "total_tracks": 1,
            "total_size_mb": 0,
            "primary_format": None,
            "genres": [],
            "issue_count": 0,
            "is_v2": False,
        },
        "info": {"similar": []},
        "top_tracks": [
            {
                "id": "track-global-1",
                "track_id": None,
                "title": "Choose To Lose",
                "artist": "High Vis",
                "album": "No Sense No Feeling",
                "duration": 190,
                "track": 1,
            }
        ],
        "shows": {"events": [], "configured": False, "source": "none"},
        "appears_on": [],
        "enrichment": {},
        "artist_hot_rank": None,
    }
    album = {
        "id": None,
        "global_album_uid": "album-global-1",
        "slug": "no-sense-no-feeling",
        "artist_slug": "high-vis",
        "artist": "High Vis",
        "name": "No Sense No Feeling",
        "display_name": "No Sense No Feeling",
        "path": "",
        "track_count": 1,
        "total_size_mb": 0,
        "total_length_sec": 190,
        "has_cover": False,
        "tracks": [
            {
                "id": "track-global-1",
                "filename": "Choose To Lose",
                "size_mb": 0,
                "length_sec": 190,
                "tags": {
                    "title": "Choose To Lose",
                    "artist": "High Vis",
                    "album": "No Sense No Feeling",
                },
                "path": "",
            }
        ],
    }
    monkeypatch.setattr(
        catalog_artist_compat, "get_library_artist_by_slug", lambda _slug: None
    )
    monkeypatch.setattr(
        catalog_artist_compat,
        "get_global_artist_page_by_public_slug",
        lambda slug, **_kwargs: artist_page if slug == "high-vis" else None,
    )
    monkeypatch.setattr(
        catalog_artist_compat,
        "_hydrate_public_page",
        lambda _request, payload: payload,
    )
    monkeypatch.setattr(browse_album, "get_library_artist_by_slug", lambda _slug: None)
    monkeypatch.setattr(
        browse_album,
        "get_global_album_detail_by_public_slugs",
        lambda artist_slug, album_slug: (
            album
            if (artist_slug, album_slug) == ("high-vis", "no-sense-no-feeling")
            else None
        ),
    )
    monkeypatch.setattr(
        browse_album,
        "_hydrate_global_album_public_detail",
        lambda _request, payload: payload,
    )

    artist_response = test_app.get("/api/artist-slugs/high-vis/page")
    top_tracks_response = test_app.get("/api/artist-slugs/high-vis/top-tracks")
    album_response = test_app.get(
        "/api/artist-slugs/high-vis/albums/no-sense-no-feeling"
    )

    assert artist_response.status_code == 200
    assert artist_response.json()["artist"]["global_artist_uid"] == "artist-global-1"
    assert top_tracks_response.status_code == 200
    assert top_tracks_response.json()[0]["id"] == "track-global-1"
    assert album_response.status_code == 200
    assert album_response.json()["global_album_uid"] == "album-global-1"


def test_api_artists_decade_filter_accepts_album_year_fallback(monkeypatch):
    from crate.api import browse_artist

    captured: dict = {}
    row = {
        "id": 7,
        "entity_uid": "11111111-1111-4111-8111-111111111111",
        "slug": "birds-in-row",
        "name": "Birds In Row",
        "album_count": 2,
        "track_count": 18,
        "total_size": 1024,
        "formats_json": ["flac"],
        "primary_format": "flac",
        "has_photo": True,
        "popularity": None,
        "popularity_score": None,
        "popularity_confidence": None,
    }

    monkeypatch.setattr(browse_artist, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(browse_artist, "has_library_data", lambda: True)
    monkeypatch.setattr(browse_artist, "get_all_artist_issue_counts", lambda: {})
    monkeypatch.setattr(
        browse_artist,
        "get_artists_count",
        lambda joins, where_sql, params: (
            captured.update({"where_sql": where_sql, "params": params}) or 1
        ),
    )
    monkeypatch.setattr(
        browse_artist,
        "get_artists_page",
        lambda *args, **kwargs: [row],
    )

    payload = browse_artist.api_artists(
        SimpleNamespace(),
        decade="2010s",
        per_page=60,
    )

    assert payload["total"] == 1
    assert "FROM library_albums decade_albums" in captured["where_sql"]
    assert captured["params"]["decade_start"] == 2010
    assert captured["params"]["decade_end"] == 2019


def test_catalog_artists_decade_filter_uses_global_catalog(monkeypatch):
    from crate.api import catalog

    captured: dict = {}

    monkeypatch.setattr(catalog, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(
        catalog,
        "get_catalog_state",
        lambda: {"status": "ready", "last_full_reconcile_at": "2026-07-15"},
    )
    monkeypatch.setattr(
        catalog,
        "get_global_decade_artists",
        lambda **kwargs: (
            captured.update(kwargs)
            or {
                "items": [
                    {
                        "id": None,
                        "entity_uid": None,
                        "global_artist_uid": "global-high-vis",
                        "name": "High Vis",
                        "albums": 2,
                        "tracks": 20,
                        "total_size_mb": 0,
                        "formats": [],
                        "primary_format": None,
                        "has_photo": True,
                        "has_issues": False,
                        "popularity": None,
                        "popularity_score": None,
                        "popularity_confidence": None,
                    }
                ],
                "total": 1,
                "page": 1,
                "per_page": 50,
            }
        ),
    )

    payload = catalog.catalog_artists_by_decade(
        SimpleNamespace(),
        Response(),
        decade="2020s",
        page=1,
        per_page=50,
    )

    assert captured == {
        "decade_start": 2020,
        "decade_end": 2029,
        "page": 1,
        "per_page": 50,
    }
    assert payload["items"][0]["name"] == "High Vis"
    assert payload["items"][0]["global_artist_uid"] == "global-high-vis"
