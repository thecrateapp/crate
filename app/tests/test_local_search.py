def test_local_search_short_query_does_not_touch_storage(monkeypatch):
    from crate import local_search

    monkeypatch.setattr(
        local_search,
        "search_all_hybrid",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("DB called")),
        raising=False,
    )

    assert local_search.search_local_library(" x ", 20) == {
        "artists": [],
        "albums": [],
        "tracks": [],
    }


def test_local_search_uses_hybrid_database_query_and_bounded_limit(monkeypatch):
    from crate import local_search

    payload = {"artists": [{"name": "High Vis"}], "albums": [], "tracks": []}
    calls: list[tuple[str, int]] = []
    monkeypatch.setattr(local_search, "get_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(local_search, "set_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(local_search, "record_later", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(local_search, "has_library_data", lambda: True)
    monkeypatch.setattr(
        local_search,
        "search_all_hybrid",
        lambda query, limit: calls.append((query, limit)) or payload,
    )

    assert local_search.search_local_library(" High Vis ", 500) == payload
    assert calls == [("High Vis", 50)]


def test_local_search_preserves_filesystem_fallback_before_library_sync(monkeypatch):
    from crate import local_search

    payload = {
        "artists": [{"name": "High Vis"}],
        "albums": [{"name": "Blending"}],
        "tracks": [{"title": "must not leak"}],
    }
    monkeypatch.setattr(local_search, "get_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(local_search, "set_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(local_search, "record_later", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(local_search, "has_library_data", lambda: False)
    monkeypatch.setattr(local_search, "fs_search", lambda _query: payload)

    result = local_search.search_local_library("high", 20)

    assert result["artists"] == [{"name": "High Vis"}]
    assert result["albums"] == [{"name": "Blending"}]
    assert result["tracks"] == []


def test_local_search_cache_namespace_is_independent_from_global_catalog(monkeypatch):
    from crate import local_search

    keys: list[str] = []
    payload = {"artists": [], "albums": [], "tracks": []}
    monkeypatch.setattr(
        local_search,
        "get_cache",
        lambda key, **_kwargs: keys.append(key) or payload,
    )

    assert local_search.search_local_library("High Vis", 10) == payload
    assert keys == ["listen:search:local:v3:high vis:10"]


def test_hybrid_search_bounds_fts_and_trigram_candidates_before_ranking():
    from crate.db.queries import browse_media_search

    params = browse_media_search._search_params("High Vis", 20)
    sql_by_entity = (
        browse_media_search._HYBRID_ARTISTS_SQL,
        browse_media_search._HYBRID_ALBUMS_SQL,
        browse_media_search._HYBRID_TRACKS_SQL,
    )

    assert params["candidate_limit"] == 400
    for statement in sql_by_entity:
        sql = str(statement)
        assert "fts_candidates AS" in sql
        assert "substring_candidates AS" in sql
        assert sql.count("LIMIT :candidate_limit") == 2


def test_track_substring_candidates_use_the_indexed_denormalized_album_name():
    from crate.db.queries import browse_media_search

    sql = str(browse_media_search._HYBRID_TRACKS_SQL)

    assert "t.album ILIKE :substring" in sql
    assert "a.name ILIKE :substring" not in sql
