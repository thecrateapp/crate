from crate.release_types import classify_release


def test_release_type_uses_musicbrainz_primary_type():
    assert classify_release(primary_type="Album") == "album"
    assert classify_release(primary_type="EP") == "ep_single"
    assert classify_release(primary_type="Single") == "ep_single"


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
