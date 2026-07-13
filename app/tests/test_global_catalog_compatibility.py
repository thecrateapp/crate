from types import SimpleNamespace


LOCAL_SEARCH_PAYLOAD = {
    "artists": [{"id": 1, "entity_uid": "artist-local-1", "name": "Rival Schools"}],
    "albums": [],
    "tracks": [],
}


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(
            user={"id": 1, "email": "listener@cratemusic.app", "role": "user"}
        )
    )


def test_search_scope_local_remains_an_explicit_legacy_query_scope(monkeypatch):
    from crate.api import browse_media

    monkeypatch.setattr(browse_media, "_require_auth", lambda request: request.state.user)
    monkeypatch.setattr(browse_media, "get_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(browse_media, "set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(browse_media, "record_later", lambda *args, **kwargs: None)
    monkeypatch.setattr(browse_media, "has_library_data", lambda: True)
    monkeypatch.setattr(
        browse_media, "search_all_hybrid", lambda query, limit: LOCAL_SEARCH_PAYLOAD
    )

    payload = browse_media.api_search(_request(), q="Rival", limit=10, scope="local")

    assert payload == LOCAL_SEARCH_PAYLOAD
