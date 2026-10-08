from __future__ import annotations

import crate.db.home_personalized_collections as home_collections
from crate.db.home_personalized_collections import get_home_playlist
from crate.db.queries import radio_seed_queries


def test_home_playlist_seed_reuses_caller_session(monkeypatch):
    session = object()
    calls: dict[str, object] = {}

    def fake_get_home_playlist(user_id, playlist_id, limit=40, *, session=None):
        calls["home"] = (user_id, playlist_id, limit, session)
        return {"name": "Home", "tracks": [{"track_id": 42}]}

    def fake_resolve(refs, *, session=None):
        calls["resolve"] = (refs, session)
        return [
            {
                "track_id": 42,
                "bliss_vector": [0.1, 0.2],
                "artist": "Artist",
                "title": "Title",
            }
        ]

    monkeypatch.setattr("crate.db.home.get_home_playlist", fake_get_home_playlist)
    monkeypatch.setattr(
        radio_seed_queries, "_get_track_seed_contexts_batch", fake_resolve
    )

    result = radio_seed_queries.get_home_playlist_seed_context(
        7, "mix-1", limit=1, session=session
    )

    assert result is not None
    assert calls["home"] == (7, "mix-1", 40, session)
    assert calls["resolve"] == (["42"], session)


def test_home_system_playlist_reuses_caller_session(monkeypatch):
    session = object()
    calls: dict[str, object] = {}

    def fake_get_playlist(playlist_id, *, session=None):
        calls["playlist"] = (playlist_id, session)
        return {"scope": "system", "is_active": True, "name": "Core"}

    def fake_get_playlist_tracks(playlist_id, *, session=None):
        calls["tracks"] = (playlist_id, session)
        return []

    monkeypatch.setattr(
        "crate.db.home_personalized_collections.get_playlist", fake_get_playlist
    )
    monkeypatch.setattr(
        "crate.db.home_personalized_collections.get_playlist_tracks",
        fake_get_playlist_tracks,
    )

    result = get_home_playlist(7, "system-playlist-12", session=session)

    assert result is not None
    assert calls["playlist"] == (12, session)
    assert calls["tracks"] == (12, session)


def test_home_mix_uses_caller_session_for_context(monkeypatch):
    session = object()
    calls: dict[str, object] = {}

    def fake_context(user_id, **kwargs):
        calls["context"] = (user_id, kwargs["session"])
        return {"interest_artists_lower": [], "top_genres_lower": []}

    monkeypatch.setattr(home_collections, "get_cached_home_context", fake_context)
    monkeypatch.setattr(
        home_collections,
        "recent_releases_from_context",
        lambda _context: [],
    )
    monkeypatch.setattr(
        home_collections,
        "_build_mix_rows",
        lambda *_args, **_kwargs: ("", "", []),
    )
    monkeypatch.setattr(
        home_collections, "_global_home_track_rows", lambda *_args, **_kwargs: []
    )

    assert home_collections.get_home_mix(7, "mix-1", session=session) is None
    assert calls["context"] == (7, session)
