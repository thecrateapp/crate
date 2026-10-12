from crate.release_types import classify_release


def test_release_type_uses_musicbrainz_primary_type():
    assert classify_release(primary_type="Album") == "album"
    assert classify_release(primary_type="EP") == "ep_single"
    assert classify_release(primary_type="Single") == "ep_single"


def test_release_date_normalization_accepts_only_complete_iso_dates():
    from crate.release_dates import normalize_release_date

    assert normalize_release_date("2024-03-09") == "2024-03-09"
    assert normalize_release_date("2024-03") is None
    assert normalize_release_date("2024") is None
    assert normalize_release_date("not-a-date") is None


def test_release_metadata_backfill_invalidates_home_and_catalog_caches(monkeypatch):
    from crate.worker_handlers import enrichment

    scopes: list[tuple[str, ...]] = []
    monkeypatch.setattr(
        "crate.api.cache_events.broadcast_invalidation",
        lambda *values: scopes.append(tuple(values)),
    )

    enrichment._broadcast_release_metadata_invalidation()

    assert scopes == [("library", "home", "global_catalog")]


def test_release_type_secondary_types_override_primary_type():
    assert (
        classify_release(primary_type="Album", secondary_types=["Compilation"])
        == "compilation"
    )
    assert classify_release(primary_type="Album", secondary_types=["Live"]) == "live"
    assert classify_release(primary_type="Album", secondary_types=["Remix"]) == "other"
    assert classify_release(primary_type="Album", secondary_types=["DJ-mix"]) == "other"


def test_release_type_uses_conservative_fallbacks_without_metadata():
    assert classify_release(title="Live at Dynamo Open Air 1998") == "live"
    assert classify_release(title="Official Live: 101 Proof") == "live"
    assert classify_release(title="The Best of Pantera") == "compilation"
    assert classify_release(title="Walk EP") == "ep_single"
    assert classify_release(title="Standalone Song", track_count=1) == "ep_single"
    assert classify_release(title="Exalted Eagles", track_count=3) == "ep_single"
    assert classify_release(title="Untitled", track_count=0) == "album"
    assert classify_release(title="Four Songs", track_count=4) == "album"


def test_release_type_backfill_batches_release_groups_by_artist(monkeypatch):
    from crate.worker_handlers import enrichment

    fetched: list[str] = []
    persisted: list[dict] = []
    monkeypatch.setattr(
        "crate.musicbrainz_ext.get_artist_releases",
        lambda artist_mbid: (
            fetched.append(artist_mbid)
            or [
                {
                    "mbid": "rg-album",
                    "type": "Album",
                    "secondary_types": [],
                },
                {
                    "mbid": "rg-live",
                    "type": "Album",
                    "secondary_types": ["Live"],
                },
            ]
        ),
    )
    monkeypatch.setattr(
        enrichment,
        "persist_album_release_group_types",
        lambda updates: persisted.extend(updates) or len(updates),
    )

    updated_ids = enrichment._backfill_known_release_group_types(
        [
            {
                "id": 1,
                "artist_mbid": "artist-1",
                "musicbrainz_releasegroupid": "rg-album",
            },
            {
                "id": 2,
                "artist_mbid": "artist-1",
                "musicbrainz_releasegroupid": "rg-live",
            },
        ]
    )

    assert fetched == ["artist-1"]
    assert updated_ids == {1, 2}
    assert persisted == [
        {
            "id": 1,
            "release_group_primary_type": "Album",
            "release_group_secondary_types": [],
        },
        {
            "id": 2,
            "release_group_primary_type": "Album",
            "release_group_secondary_types": ["Live"],
        },
    ]


def test_release_group_backfill_persists_first_public_release_date(monkeypatch):
    from crate.worker_handlers import enrichment

    persisted: list[dict] = []
    monkeypatch.setattr(
        "crate.musicbrainz_ext.get_artist_releases",
        lambda _artist_mbid: [
            {
                "mbid": "rg-album",
                "type": "Album",
                "secondary_types": [],
                "first_release_date": "2024-03-09",
            }
        ],
    )
    monkeypatch.setattr(
        enrichment,
        "persist_album_release_group_types",
        lambda updates: persisted.extend(updates) or len(updates),
    )

    updated_ids = enrichment._backfill_known_release_group_types(
        [
            {
                "id": 3,
                "artist_mbid": "artist-1",
                "musicbrainz_releasegroupid": "rg-album",
            }
        ]
    )

    assert updated_ids == {3}
    assert persisted == [
        {
            "id": 3,
            "release_group_primary_type": "Album",
            "release_group_secondary_types": [],
            "release_date": "2024-03-09",
        }
    ]


def test_release_group_date_only_backfill_does_not_rewrite_type_metadata(monkeypatch):
    from crate.worker_handlers import enrichment

    persisted: list[dict] = []
    monkeypatch.setattr(
        "crate.musicbrainz_ext.get_artist_releases",
        lambda _artist_mbid: [
            {
                "mbid": "rg-album",
                "type": "Album",
                "secondary_types": ["Compilation"],
                "first_release_date": "2024-03-09",
            }
        ],
    )
    monkeypatch.setattr(
        enrichment,
        "persist_album_release_group_types",
        lambda updates: persisted.extend(updates) or len(updates),
    )

    updated_ids = enrichment._backfill_known_release_group_types(
        [
            {
                "id": 4,
                "artist_mbid": "artist-1",
                "musicbrainz_releasegroupid": "rg-album",
            }
        ],
        dates_only=True,
    )

    assert updated_ids == {4}
    assert persisted == [{"id": 4, "release_date": "2024-03-09"}]


def test_existing_release_type_backfill_only_persists_catalog_metadata(monkeypatch):
    from crate.worker_handlers import enrichment

    persisted: list[dict] = []
    monkeypatch.setattr(
        enrichment,
        "persist_album_release_group_types",
        lambda updates: persisted.extend(updates) or len(updates),
    )

    updated = enrichment._persist_existing_release_group_types(
        7,
        {
            "release_group_id": "rg-live",
            "release_group_primary_type": "Album",
            "release_group_secondary_types": ["Live"],
        },
    )

    assert updated is True
    assert persisted == [
        {
            "id": 7,
            "musicbrainz_releasegroupid": "rg-live",
            "release_group_primary_type": "Album",
            "release_group_secondary_types": ["Live"],
        }
    ]


def test_existing_release_backfill_persists_first_public_release_date(monkeypatch):
    from crate.worker_handlers import enrichment

    persisted: list[dict] = []
    monkeypatch.setattr(
        enrichment,
        "persist_album_release_group_types",
        lambda updates: persisted.extend(updates) or len(updates),
    )

    updated = enrichment._persist_existing_release_group_types(
        8,
        {
            "release_group_id": "rg-album",
            "first_release_date": "2024-03-09",
        },
    )

    assert updated is True
    assert persisted == [
        {
            "id": 8,
            "musicbrainz_releasegroupid": "rg-album",
            "release_group_primary_type": None,
            "release_group_secondary_types": [],
            "release_date": "2024-03-09",
        }
    ]


def test_release_type_backfill_detects_stale_short_form_match_for_album():
    from crate.worker_handlers.enrichment import _existing_release_is_incompatible

    assert _existing_release_is_incompatible(
        {"track_count": 11, "release_group_primary_type": "Single"},
        {"track_count": 1, "release_group_primary_type": "Single"},
    )

    assert not _existing_release_is_incompatible(
        {"track_count": 10, "release_group_primary_type": "Album"},
        {"track_count": 11, "release_group_primary_type": "Album"},
    )


def test_release_types_backfill_rematches_stale_short_form_release(monkeypatch):
    from crate.worker_handlers import enrichment

    album = {
        "id": 9,
        "artist": "Chelsea Wolfe",
        "name": "The Dark",
        "track_count": 11,
        "musicbrainz_albumid": "release-single",
        "musicbrainz_releasegroupid": "rg-single",
        "release_group_primary_type": "Single",
        "release_date": "2026-06-23",
    }
    persisted: list[dict] = []
    monkeypatch.setattr(
        enrichment, "get_albums_needing_release_metadata", lambda: [album]
    )
    monkeypatch.setattr(
        enrichment, "_backfill_known_release_group_types", lambda _albums: {9}
    )
    monkeypatch.setattr(enrichment, "get_library_tracks", lambda _album_id: [])
    monkeypatch.setattr(enrichment, "get_setting", lambda *_args, **_kwargs: "95")
    monkeypatch.setattr(enrichment, "is_cancelled", lambda _task_id: False)
    monkeypatch.setattr(enrichment, "emit_progress", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(enrichment, "emit_task_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        enrichment, "wait_for_provider_slot", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        "crate.matcher._get_release_detail",
        lambda _mbid: {
            "mbid": "release-single",
            "release_group_id": "rg-single",
            "release_group_primary_type": "Single",
            "release_group_secondary_types": [],
            "track_count": 1,
            "first_release_date": "2026-06-23",
        },
    )
    monkeypatch.setattr(
        enrichment,
        "_find_best_album_release",
        lambda *_args, **_kwargs: (
            {
                "mbid": "release-album",
                "release_group_id": "rg-album",
                "release_group_primary_type": "Album",
                "release_group_secondary_types": [],
                "first_release_date": "2026-08-21",
                "tracks": [],
            },
            98,
        ),
    )
    monkeypatch.setattr(
        enrichment,
        "_persist_album_release_mbids",
        lambda album_id, _tracks, release: persisted.append(
            {"id": album_id, "release": release}
        ),
    )
    monkeypatch.setattr(
        enrichment,
        "_persist_existing_release_group_types",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("stale short-form release must be rematched")
        ),
    )

    result = enrichment._handle_enrich_mbids("task-1", {"release_types_only": True}, {})

    assert result == {"enriched": 1, "skipped": 0, "failed": 0, "total": 1}
    assert persisted == [
        {
            "id": 9,
            "release": {
                "mbid": "release-album",
                "release_group_id": "rg-album",
                "release_group_primary_type": "Album",
                "release_group_secondary_types": [],
                "first_release_date": "2026-08-21",
                "tracks": [],
            },
        }
    ]


def test_release_group_type_persistence_updates_existing_album_metadata(pg_db):
    from crate.db.jobs.enrichment import persist_album_release_group_types

    pg_db.upsert_artist({"name": "Metadata Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Metadata Artist",
            "name": "Existing Release",
            "path": "/music/metadata-artist/existing-release",
        }
    )

    updated = persist_album_release_group_types(
        [
            {
                "id": album_id,
                "musicbrainz_releasegroupid": "rg-existing",
                "release_group_primary_type": "Album",
                "release_group_secondary_types": ["Compilation"],
            }
        ]
    )
    album = pg_db.get_library_album_by_id(album_id)

    assert updated == 1
    assert album["musicbrainz_releasegroupid"] == "rg-existing"
    assert album["release_group_primary_type"] == "Album"
    assert album["release_group_secondary_types"] == ["Compilation"]


def test_release_date_persistence_does_not_replace_an_existing_date(pg_db):
    from crate.db.jobs.enrichment import persist_album_release_group_types

    pg_db.upsert_artist({"name": "Release Date Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Release Date Artist",
            "name": "First Release",
            "path": "/music/release-date-artist/first-release",
            "release_date": "2020-01-02",
        }
    )

    persist_album_release_group_types(
        [
            {
                "id": album_id,
                "release_group_primary_type": "Album",
                "release_group_secondary_types": [],
                "release_date": "",
            }
        ]
    )

    album = pg_db.get_library_album_by_id(album_id)
    assert album["release_date"] == "2020-01-02"


def test_existing_mbid_backfill_never_runs_filesystem_auto_apply(monkeypatch, tmp_path):
    from crate.worker_handlers import enrichment

    monkeypatch.setattr(
        enrichment,
        "get_albums_needing_release_metadata",
        lambda: [
            {
                "id": 7,
                "artist": "Example Artist",
                "name": "Live Record",
                "path": str(tmp_path),
                "musicbrainz_albumid": "release-live",
                "musicbrainz_releasegroupid": None,
                "release_group_primary_type": None,
            },
            {
                "id": 8,
                "artist": "Unmatched Artist",
                "name": "Unmatched Release",
                "path": str(tmp_path / "unmatched"),
                "musicbrainz_albumid": None,
                "musicbrainz_releasegroupid": None,
                "release_group_primary_type": None,
            },
        ],
    )
    monkeypatch.setattr(
        enrichment, "_backfill_known_release_group_types", lambda _albums: set()
    )
    monkeypatch.setattr(enrichment, "is_cancelled", lambda _task_id: False)
    monkeypatch.setattr(enrichment, "emit_progress", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(enrichment, "emit_task_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        enrichment, "wait_for_provider_slot", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        "crate.matcher._get_release_detail",
        lambda _mbid: {
            "release_group_id": "rg-live",
            "release_group_primary_type": "Album",
            "release_group_secondary_types": ["Live"],
        },
    )
    monkeypatch.setattr(
        enrichment,
        "_persist_existing_release_group_types",
        lambda _album_id, _release: True,
    )
    monkeypatch.setattr(
        enrichment,
        "_auto_apply_album_release",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("metadata backfill must not touch the filesystem")
        ),
    )

    result = enrichment._handle_enrich_mbids("task-1", {"release_types_only": True}, {})

    assert result == {"enriched": 1, "skipped": 0, "failed": 0, "total": 1}


def test_release_detail_preserves_musicbrainz_release_group_types(monkeypatch):
    from crate import matcher

    monkeypatch.setattr(
        matcher.musicbrainzngs,
        "get_release_by_id",
        lambda *_args, **_kwargs: {
            "release": {
                "id": "release-1",
                "title": "Live Record",
                "release-group": {
                    "id": "rg-1",
                    "primary-type": "Album",
                    "secondary-type-list": ["Live"],
                    "first-release-date": "1998-04-11",
                },
                "medium-list": [],
            }
        },
    )

    release = matcher._get_release_detail("release-1")

    assert release is not None
    assert release["release_group_id"] == "rg-1"
    assert release["release_group_primary_type"] == "Album"
    assert release["release_group_secondary_types"] == ["Live"]
    assert release["first_release_date"] == "1998-04-11"


def test_artist_release_groups_include_all_primary_and_secondary_types(monkeypatch):
    from crate import musicbrainz_ext

    calls: list[dict] = []
    monkeypatch.setattr(musicbrainz_ext, "get_cache", lambda _key: None)
    monkeypatch.setattr(musicbrainz_ext, "set_cache", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        musicbrainz_ext, "wait_for_provider_slot", lambda *_args, **_kwargs: None
    )

    def browse_release_groups(**kwargs):
        calls.append(kwargs)
        return {
            "release-group-count": 2,
            "release-group-list": [
                {
                    "id": "rg-album",
                    "title": "Studio Album",
                    "primary-type": "Album",
                    "secondary-type-list": [],
                },
                {
                    "id": "rg-single",
                    "title": "Standalone Single",
                    "primary-type": "Single",
                    "secondary-type-list": ["Live"],
                },
            ],
        }

    monkeypatch.setattr(
        musicbrainz_ext.musicbrainzngs,
        "browse_release_groups",
        browse_release_groups,
    )

    releases = musicbrainz_ext.get_artist_releases("artist-1")

    assert "release_type" not in calls[0]
    assert [release["type"] for release in releases] == ["Album", "Single"]
    assert releases[1]["secondary_types"] == ["Live"]


def test_rematch_album_mbids_retries_a_bounded_batch_with_cooldown(monkeypatch):
    from crate.worker_handlers import enrichment

    albums = [{"id": index, "name": f"Album {index}"} for index in range(1, 61)]
    cache: dict[str, object] = {"album-mbid-rematch:1": True}
    matched: list[list[int]] = []
    broadcasts: list[bool] = []
    monkeypatch.setattr(enrichment, "get_albums_missing_release_group", lambda: albums)
    monkeypatch.setattr(enrichment, "get_cache", cache.get)
    monkeypatch.setattr(
        enrichment,
        "set_cache",
        lambda key, value, ttl=None: cache.__setitem__(key, value),
    )
    monkeypatch.setattr(
        enrichment,
        "_match_album_mbids",
        lambda task_id, batch, config: (
            matched.append([a["id"] for a in batch])
            or {"enriched": 2, "skipped": 0, "failed": 48, "total": len(batch)}
        ),
    )
    monkeypatch.setattr(
        enrichment,
        "_broadcast_release_metadata_invalidation",
        lambda: broadcasts.append(True),
    )

    result = enrichment._handle_rematch_album_mbids("rematch-1", {}, {})

    assert matched == [list(range(2, 2 + enrichment.ALBUM_MBID_REMATCH_BATCH))]
    assert all(f"album-mbid-rematch:{i}" in cache for i in matched[0])
    assert result["enriched"] == 2
    assert broadcasts == [True]


def test_rematch_album_mbids_keeps_albums_retryable_when_the_run_fails(monkeypatch):
    import pytest

    from crate.worker_handlers import enrichment

    cache: dict[str, object] = {}
    monkeypatch.setattr(
        enrichment,
        "get_albums_missing_release_group",
        lambda: [{"id": 7, "name": "Exalted Eagles"}],
    )
    monkeypatch.setattr(enrichment, "get_cache", cache.get)
    monkeypatch.setattr(
        enrichment,
        "set_cache",
        lambda key, value, ttl=None: cache.__setitem__(key, value),
    )

    def boom(task_id, batch, config):
        raise RuntimeError("MusicBrainz down")

    monkeypatch.setattr(enrichment, "_match_album_mbids", boom)

    with pytest.raises(RuntimeError):
        enrichment._handle_rematch_album_mbids("rematch-3", {}, {})

    assert cache == {}


def test_rematch_album_mbids_skips_invalidation_without_matches(monkeypatch):
    from crate.worker_handlers import enrichment

    broadcasts: list[bool] = []
    monkeypatch.setattr(enrichment, "get_albums_missing_release_group", lambda: [])
    monkeypatch.setattr(
        enrichment,
        "_match_album_mbids",
        lambda task_id, batch, config: {
            "enriched": 0,
            "skipped": 0,
            "failed": 0,
            "total": 0,
        },
    )
    monkeypatch.setattr(
        enrichment,
        "_broadcast_release_metadata_invalidation",
        lambda: broadcasts.append(True),
    )

    enrichment._handle_rematch_album_mbids("rematch-2", {}, {})

    assert broadcasts == []


def test_albums_missing_release_group_are_newest_first_and_skip_quarantine(pg_db):
    from sqlalchemy import text

    from crate.db.jobs.enrichment import get_albums_missing_release_group
    from crate.db.tx import transaction_scope

    def album(name: str, release_type: str | None = None) -> int:
        album_id = pg_db.upsert_album(
            {
                "artist": "Protomartyr",
                "name": name,
                "path": f"/music/protomartyr/{name}",
                "track_count": 3,
                "total_size": 1024,
                "total_duration": 600.0,
                "formats": ["flac"],
            }
        )
        if release_type:
            with transaction_scope() as session:
                session.execute(
                    text(
                        "UPDATE library_albums SET release_group_primary_type = :t "
                        "WHERE id = :id"
                    ),
                    {"t": release_type, "id": album_id},
                )
        return album_id

    pg_db.upsert_artist({"name": "Protomartyr"})
    older = album("Feed the Sewer")
    newer = album("Exalted Eagles")
    album("Hotel Usona", release_type="Album")
    quarantined = album("Quarantined Copy")
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET quarantined_at = now() WHERE id = :id"),
            {"id": quarantined},
        )

    ids = [row["id"] for row in get_albums_missing_release_group()]

    assert ids == [newer, older]
