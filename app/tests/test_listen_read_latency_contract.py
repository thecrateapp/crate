from __future__ import annotations

import inspect


def test_cold_home_section_uses_discovery_fallback_without_sync_rebuild(monkeypatch):
    from crate.db import home_section_surface as surface

    queued: list[tuple[str, dict, str]] = []
    monkeypatch.setattr(surface, "get_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        surface,
        "get_cached_home_discovery",
        lambda _user_id: {
            "custom_mixes": [{"id": "daily-discovery", "name": "Daily Discovery"}]
        },
    )
    monkeypatch.setattr(
        surface,
        "get_home_section",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("cold request must not rebuild custom mixes")
        ),
    )
    monkeypatch.setattr(
        surface,
        "create_task_dedup",
        lambda task_type, params, dedup_key: queued.append(
            (task_type, params, dedup_key)
        ),
    )

    section = surface.get_cached_home_section(7, "custom-mixes", limit=42)

    assert section == {
        "id": "custom-mixes",
        "title": "Custom mixes",
        "subtitle": "Dynamic playlists shaped around your own listening profile.",
        "items": [{"id": "daily-discovery", "name": "Daily Discovery"}],
    }
    assert queued == [
        (
            "refresh_home_discovery_snapshot",
            {"user_id": 7, "include_sections": True},
            "home-discovery:7",
        )
    ]


def test_stale_home_section_is_served_while_refresh_is_queued(monkeypatch):
    from crate.db import home_section_surface as surface

    stale = {
        "id": "custom-mixes",
        "title": "Custom mixes",
        "subtitle": "Cached",
        "items": [{"id": "cached-mix"}],
    }
    ages: list[int] = []
    queued: list[str] = []

    def get_cache(_key: str, *, max_age_seconds: int):
        ages.append(max_age_seconds)
        return None if max_age_seconds == 300 else stale

    monkeypatch.setattr(surface, "get_cache", get_cache)
    monkeypatch.setattr(
        surface,
        "create_task_dedup",
        lambda _task_type, _params, dedup_key: queued.append(dedup_key),
    )
    monkeypatch.setattr(
        surface,
        "get_home_section",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("stale request must not rebuild synchronously")
        ),
    )

    section = surface.get_cached_home_section(7, "custom-mixes", limit=42)

    assert section == stale
    assert ages == [300, 3600]
    assert queued == ["home-discovery:7"]


def test_home_section_refresh_builds_and_caches_full_payload(monkeypatch):
    from crate.db import home_section_surface as surface

    expected = {
        "id": "custom-mixes",
        "title": "Custom mixes",
        "subtitle": "Full",
        "items": [{"id": "mix-1"}, {"id": "mix-2"}],
    }
    writes: list[tuple[str, dict, int]] = []
    monkeypatch.setattr(
        surface,
        "get_home_section",
        lambda user_id, section_id, limit: (
            expected
            if (user_id, section_id, limit) == (7, "custom-mixes", 42)
            else None
        ),
    )
    monkeypatch.setattr(
        surface,
        "set_cache",
        lambda key, value, ttl: writes.append((key, value, ttl)),
    )
    monkeypatch.setattr(surface.time, "time", lambda: 1234.0)

    section = surface.get_cached_home_section(7, "custom-mixes", limit=42, fresh=True)

    assert section == expected
    assert writes == [
        (
            "home_section:v5:global:7:custom-mixes:42",
            {
                "_home_section_cached_at": 1234.0,
                "_home_section_payload": expected,
            },
            3600,
        )
    ]


def test_genre_catalog_preaggregates_artist_and_album_counts():
    from crate.db.queries import genres_library_catalog

    source = inspect.getsource(genres_library_catalog.get_all_genres)

    assert "artist_counts AS" in source
    assert "album_counts AS" in source
    assert "COALESCE(ac.artist_count, 0)" in source
    assert "COALESCE(alc.album_count, 0)" in source


def test_genre_summary_does_not_rescan_every_library_track():
    from crate.db.queries import genres_shared

    source = inspect.getsource(genres_shared.get_genre_summary_by_slug)

    assert "library_tracks" not in source
    assert "SUM(COALESCE(a.track_count, 0))" in source


def test_related_genre_stats_preaggregate_memberships():
    from crate.db.queries import genres_shared

    source = inspect.getsource(genres_shared.get_taxonomy_node_stats)

    assert "taxonomy_artist_counts AS" in source
    assert "taxonomy_album_counts AS" in source
    assert "genre_artist_counts AS" in source
    assert "genre_album_counts AS" in source


def test_global_genre_augmentation_only_scans_remote_only_entities():
    from crate.db.queries import genres_library_detail

    source = inspect.getsource(genres_library_detail._augment_global_genre_entities)

    assert source.count("AND NOT a.has_local") >= 2


def test_play_history_limits_recent_events_before_metadata_joins():
    from crate.db.queries import user_library_history

    source = inspect.getsource(user_library_history.get_play_history_rows)

    assert "recent_events AS MATERIALIZED" in source
    assert "FROM recent_events upe" in source
    assert source.index("LIMIT :lim") < source.index("LEFT JOIN LATERAL")
