from types import SimpleNamespace


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
        lambda joins, where_sql, params: captured.update(
            {"where_sql": where_sql, "params": params}
        )
        or 1,
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


def test_api_artists_decade_filter_uses_global_catalog_when_enabled(monkeypatch):
    from crate.api import browse_artist

    captured: dict = {}

    monkeypatch.setattr(browse_artist, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(browse_artist, "has_library_data", lambda: True)
    monkeypatch.setattr(
        browse_artist,
        "global_catalog_surface_enabled",
        lambda surface: surface == "explore",
    )
    monkeypatch.setattr(
        browse_artist,
        "get_global_decade_artists",
        lambda **kwargs: captured.update(kwargs)
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
        },
    )

    payload = browse_artist.api_artists(
        SimpleNamespace(),
        decade="2020s",
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
