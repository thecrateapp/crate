from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(
            user={"id": 1, "email": "admin@cratemusic.app", "role": "admin"}
        )
    )


def test_admin_search_never_reads_the_canonical_catalog(monkeypatch):
    from crate.api import browse_media

    local_payload = {"artists": [], "albums": [], "tracks": []}
    monkeypatch.setattr(
        browse_media, "_require_auth", lambda request: request.state.user
    )
    monkeypatch.setattr(
        browse_media, "search_local_library", lambda query, limit: local_payload
    )
    monkeypatch.setattr(
        browse_media,
        "get_cache",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("legacy local cache queried")
        ),
    )

    assert (
        browse_media.api_search(_request(), q="Rival", scope="local") == local_payload
    )


def test_scope_auto_uses_the_canonical_catalog(monkeypatch):
    from crate.api import browse_media
    from crate.db.queries import global_catalog

    global_payload = {
        "artists": [{"name": "Rival Schools", "global_uid": "artist-1"}],
        "albums": [],
        "tracks": [],
    }
    cache_keys: list[str] = []
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


def test_scope_auto_never_falls_back_to_live_fanout(monkeypatch):
    from crate.api import browse_media
    from crate.db.queries import global_catalog

    global_payload = {
        "artists": [{"name": "Rival Schools"}],
        "albums": [],
        "tracks": [],
    }
    monkeypatch.setattr(global_catalog, "get_global_catalog_revision", lambda: "rev-2")
    monkeypatch.setattr(
        global_catalog,
        "search_global_catalog",
        lambda *args, **kwargs: global_payload,
    )
    monkeypatch.setattr(
        browse_media, "_require_auth", lambda request: request.state.user
    )
    monkeypatch.setattr(browse_media, "get_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(browse_media, "set_cache", lambda *args, **kwargs: None)
    monkeypatch.setattr(browse_media, "record_later", lambda *args, **kwargs: None)

    assert (
        browse_media.api_search(_request(), q="Rival", scope="auto") == global_payload
    )


def test_listen_runtime_uses_only_the_canonical_search_endpoint():
    runtime_files = (ROOT / "listen" / "src").rglob("*.ts*")
    matches = {
        str(path.relative_to(ROOT)): path.read_text(encoding="utf-8")
        for path in runtime_files
        if not path.name.endswith((".test.ts", ".test.tsx"))
        and "/api/search" in path.read_text(encoding="utf-8")
    }

    assert matches == {}
