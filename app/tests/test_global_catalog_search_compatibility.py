from types import SimpleNamespace


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(
            user={"id": 1, "email": "listener@cratemusic.app", "role": "user"}
        )
    )


def test_scope_local_ignores_global_catalog_even_when_enabled(monkeypatch):
    from crate.api import browse_media
    from crate.db.queries import global_catalog
    from crate.federation import global_policy

    local_payload = {"artists": [], "albums": [], "tracks": []}

    monkeypatch.setattr(global_policy, "global_catalog_surface_enabled", lambda _: True)
    monkeypatch.setattr(
        global_catalog,
        "search_global_catalog",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("global used")),
    )
    monkeypatch.setattr(
        browse_media, "_require_auth", lambda request: request.state.user
    )
    monkeypatch.setattr(browse_media, "get_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(browse_media, "set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(browse_media, "record_later", lambda *args, **kwargs: None)
    monkeypatch.setattr(browse_media, "has_library_data", lambda: True)
    monkeypatch.setattr(
        browse_media, "search_all_hybrid", lambda q, limit: local_payload
    )

    assert (
        browse_media.api_search(_request(), q="Rival", scope="local") == local_payload
    )


def test_scope_auto_uses_global_catalog_when_search_surface_enabled(monkeypatch):
    from crate.api import browse_media
    from crate.db.queries import global_catalog
    from crate.federation import global_policy

    global_payload = {
        "artists": [{"name": "Rival Schools", "global_uid": "artist-1"}],
        "albums": [],
        "tracks": [],
    }
    cache_keys: list[str] = []

    monkeypatch.setattr(global_policy, "global_catalog_surface_enabled", lambda _: True)
    monkeypatch.setattr(global_catalog, "get_global_catalog_revision", lambda: "rev-1")
    monkeypatch.setattr(
        global_catalog,
        "search_global_catalog",
        lambda query, limit: global_payload,
    )
    monkeypatch.setattr(
        browse_media, "_require_auth", lambda request: request.state.user
    )
    monkeypatch.setattr(
        browse_media,
        "get_cache",
        lambda key, **kwargs: cache_keys.append(key) or None,
    )
    monkeypatch.setattr(browse_media, "set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(browse_media, "record_later", lambda *args, **kwargs: None)

    assert (
        browse_media.api_search(_request(), q="Rival", scope="auto") == global_payload
    )
    assert any(":global:rev-1" in key for key in cache_keys)


def test_scope_auto_keeps_federated_search_when_global_surface_disabled(monkeypatch):
    from crate.api import browse_media
    from crate.federation import global_policy, search_fanout

    federated_payload = {
        "artists": [{"name": "Rival Schools"}],
        "albums": [],
        "tracks": [],
    }
    metrics: list[tuple[str, int]] = []

    monkeypatch.setattr(
        global_policy, "global_catalog_surface_enabled", lambda _: False
    )
    monkeypatch.setattr(
        search_fanout,
        "federated_search",
        lambda **kwargs: federated_payload,
    )
    monkeypatch.setattr(
        "crate.db.repositories.federation.get_local_node",
        lambda: None,
    )
    monkeypatch.setattr(
        browse_media, "_require_auth", lambda request: request.state.user
    )
    monkeypatch.setattr(browse_media, "get_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(browse_media, "set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        browse_media,
        "record_later",
        lambda key, value: metrics.append((key, value)),
    )

    assert (
        browse_media.api_search(_request(), q="Rival", scope="auto")
        == federated_payload
    )
    assert metrics == [
        ("search.federated.results.artists", 1),
        ("search.federated.results.albums", 0),
        ("search.federated.results.tracks", 0),
    ]
