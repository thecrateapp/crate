from __future__ import annotations


def test_backfill_uses_bounded_stable_pages_and_canonical_dedup(monkeypatch):
    from crate.worker_handlers import artwork

    page_calls = []
    created = []
    continued = []
    monkeypatch.setattr(
        artwork,
        "list_artwork_backfill_artists",
        lambda *, after_id, limit: (
            page_calls.append(("artists", after_id, limit))
            or [
                {"id": 11, "entity_uid": "artist-11"},
                {"id": 12, "entity_uid": "artist-12"},
            ]
        ),
    )
    monkeypatch.setattr(
        artwork,
        "list_artwork_backfill_albums",
        lambda *, after_id, limit: (
            page_calls.append(("albums", after_id, limit))
            or [{"id": 21, "entity_uid": "album-21"}]
        ),
    )
    monkeypatch.setattr(
        artwork,
        "queue_artwork_materialization",
        lambda asset, *, reason: (
            created.append((asset.kind, asset.entity_key, reason))
            or f"task-{len(created)}"
        ),
    )
    monkeypatch.setattr(
        artwork,
        "create_task_dedup",
        lambda task_type, params=None, dedup_key="", **_kwargs: continued.append(
            (task_type, params, dedup_key)
        ),
    )
    monkeypatch.setattr(artwork, "emit_progress", lambda *_args, **_kwargs: None)

    result = artwork._handle_backfill_artwork_variants(
        "backfill-1",
        {
            "after_artist_id": 10,
            "after_album_id": 20,
            "batch_size": 2,
            "include_genres": False,
        },
        {},
    )

    assert page_calls == [("artists", 10, 2), ("albums", 20, 2)]
    assert created == [
        ("artist-photo", "artist-11", "backfill"),
        ("artist-background", "artist-11", "backfill"),
        ("artist-photo", "artist-12", "backfill"),
        ("artist-background", "artist-12", "backfill"),
        ("album-cover", "album-21", "backfill"),
    ]
    assert continued == [
        (
            "backfill_artwork_variants",
            {
                "after_artist_id": 12,
                "after_album_id": 21,
                "batch_size": 2,
                "include_genres": False,
            },
            "artwork-backfill:12:21:2:0",
        )
    ]
    assert result["queued"] == 5
    assert result["next_queued"] is True


def test_backfill_defaults_to_one_hundred_and_finishes_short_pages(monkeypatch):
    from crate.worker_handlers import artwork

    calls = []
    monkeypatch.setattr(
        artwork,
        "list_artwork_backfill_artists",
        lambda *, after_id, limit: calls.append((after_id, limit)) or [],
    )
    monkeypatch.setattr(
        artwork,
        "list_artwork_backfill_albums",
        lambda *, after_id, limit: calls.append((after_id, limit)) or [],
    )
    monkeypatch.setattr(
        artwork,
        "queue_artwork_materialization",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("empty backfill must not enqueue artwork")
        ),
    )
    monkeypatch.setattr(
        artwork,
        "create_task_dedup",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("completed backfill must not enqueue another page")
        ),
    )
    monkeypatch.setattr(artwork, "emit_progress", lambda *_args, **_kwargs: None)
    completed = []
    monkeypatch.setattr(
        "crate.db.cache_settings.set_setting",
        lambda key, value: completed.append((key, value)),
    )

    result = artwork._handle_backfill_artwork_variants(
        "backfill-1", {"include_genres": False}, {}
    )

    assert calls == [(0, 100), (0, 100)]
    assert result == {
        "status": "completed",
        "artists_seen": 0,
        "albums_seen": 0,
        "genres_seen": 0,
        "queued": 0,
        "skipped_missing_identity": 0,
        "next_queued": False,
        "after_artist_id": 0,
        "after_album_id": 0,
    }
    assert completed == [("artwork_variants_backfill_version", "1")]


def test_backfill_skips_missing_identities_without_aborting(monkeypatch):
    from crate.worker_handlers import artwork

    created = []
    monkeypatch.setattr(
        artwork,
        "list_artwork_backfill_artists",
        lambda **_kwargs: [{"id": 1, "entity_uid": None}],
    )
    monkeypatch.setattr(
        artwork,
        "list_artwork_backfill_albums",
        lambda **_kwargs: [
            {"id": 1, "entity_uid": None},
            {"id": 2, "entity_uid": "album-2"},
        ],
    )
    monkeypatch.setattr(
        artwork,
        "queue_artwork_materialization",
        lambda asset, *, reason: created.append((asset.kind, asset.entity_key, reason)),
    )
    monkeypatch.setattr(artwork, "emit_progress", lambda *_args, **_kwargs: None)

    result = artwork._handle_backfill_artwork_variants(
        "backfill-1", {"batch_size": 100, "include_genres": False}, {}
    )

    assert result["skipped_missing_identity"] == 2
    assert result["queued"] == 1
    assert created == [("album-cover", "album-2", "backfill")]


def test_backfill_includes_curated_genre_covers_by_default(monkeypatch):
    from crate.worker_handlers import artwork

    queued = []
    monkeypatch.setattr(artwork, "list_artwork_backfill_artists", lambda **_kwargs: [])
    monkeypatch.setattr(artwork, "list_artwork_backfill_albums", lambda **_kwargs: [])
    monkeypatch.setattr(
        artwork,
        "list_artwork_backfill_genres",
        lambda *, after_slug, limit: [
            {"slug": "post-hardcore", "cover_path": "post-hardcore.jpg"}
        ],
    )
    monkeypatch.setattr(
        artwork,
        "queue_artwork_materialization",
        lambda asset, *, reason: queued.append((asset.kind, asset.entity_key, reason)),
    )
    monkeypatch.setattr(artwork, "emit_progress", lambda *_args, **_kwargs: None)

    result = artwork._handle_backfill_artwork_variants("backfill-1", {}, {})

    assert queued == [("genre-cover", "post-hardcore", "backfill")]
    assert result["genres_seen"] == 1


def test_backfill_is_resource_governed_and_uses_maintenance_queue():
    from crate.actors import TASK_POOL_CONFIG
    from crate.resource_governor import is_governed_task

    config = TASK_POOL_CONFIG["backfill_artwork_variants"]

    assert config.queue == "maintenance"
    assert config.priority == 3
    assert is_governed_task("backfill_artwork_variants") is True
    assert is_governed_task("materialize_artwork_variants") is True
