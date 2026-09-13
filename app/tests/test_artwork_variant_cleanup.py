from __future__ import annotations

import json
import os
import stat
import time
from io import BytesIO

import pytest
from PIL import Image


def _jpeg(color: str) -> bytes:
    output = BytesIO()
    Image.new("RGB", (256, 256), color=color).save(output, format="JPEG")
    return output.getvalue()


def test_cleanup_keeps_current_and_one_previous_revision(monkeypatch, tmp_path):
    from crate.artwork_maintenance import cleanup_artwork_variants
    from crate.artwork_materializer import materialize_artwork
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    asset = ArtworkAsset("album-cover", "album-entity")
    for color in ("red", "green", "blue"):
        materialize_artwork(asset, _jpeg(color))
        time.sleep(0.01)

    result = cleanup_artwork_variants(max_assets=10)

    revision_dirs = [
        path
        for path in artwork_asset_root(asset).iterdir()
        if path.is_dir() and not path.name.startswith(".")
    ]
    assert len(revision_dirs) == 2
    assert result["revisions_removed"] == 1


def test_cleanup_removes_only_expired_temporary_directories(monkeypatch, tmp_path):
    from crate.artwork_maintenance import cleanup_artwork_variants
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    root = artwork_asset_root(ArtworkAsset("artist-photo", "artist-entity"))
    old_temp = root / ".old.tmp"
    fresh_temp = root / ".fresh.tmp"
    old_temp.mkdir(parents=True)
    fresh_temp.mkdir()
    expired = time.time() - 90000
    os.utime(old_temp, (expired, expired))

    result = cleanup_artwork_variants(max_assets=10)

    assert old_temp.exists() is False
    assert fresh_temp.exists() is True
    assert result["temporary_removed"] == 1


def test_generic_cleanup_skips_artist_hero_roots_owned_by_hero_gc(
    monkeypatch, tmp_path
):
    from crate.artwork_maintenance import cleanup_artwork_variants
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    asset = ArtworkAsset("artist-hero", "artist-entity:desktop:revision-a")
    root = artwork_asset_root(asset)
    root.mkdir(parents=True)

    monkeypatch.setattr(
        "crate.artwork_maintenance.load_current_manifest",
        lambda _asset: (_ for _ in ()).throw(
            AssertionError("generic cleanup must not inspect artist hero roots")
        ),
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.cleanup_artist_hero_publications",
        lambda **_kwargs: {
            "artists_checked": 0,
            "revisions_removed": 0,
            "temporary_removed": 0,
            "orphan_revisions_removed": 0,
        },
    )

    result = cleanup_artwork_variants(max_assets=10)

    assert result["assets_checked"] == 0
    assert root.is_dir()


def test_artist_hero_cleanup_removes_legacy_variants_after_v2_activation(
    monkeypatch, tmp_path
):
    from crate.artwork_maintenance import cleanup_artist_hero_publications
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    legacy_root = artwork_asset_root(
        ArtworkAsset("artist-hero", "artist-entity:desktop")
    )
    legacy_root.mkdir(parents=True)
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_library_artist_by_entity_uid",
        lambda _entity_uid: {"id": 42, "entity_uid": "artist-entity"},
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_artist_hero_artwork",
        lambda _artist_id: {
            "desktop_enabled": True,
            "render_manifest": {
                "artifacts": {"desktop": {"render_revision": "renderer:revision-new"}}
            },
        },
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revisions",
        lambda _artist_id: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_manifest_history",
        lambda _artist_id: [],
    )

    cleanup_artist_hero_publications(max_artists=10)

    assert not legacy_root.exists()


def test_artist_hero_cleanup_keeps_the_active_legacy_variant(monkeypatch, tmp_path):
    from crate.artwork_maintenance import cleanup_artist_hero_publications
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    legacy_root = artwork_asset_root(
        ArtworkAsset("artist-hero", "artist-entity:desktop")
    )
    legacy_root.mkdir(parents=True)
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_library_artist_by_entity_uid",
        lambda _entity_uid: {"id": 42, "entity_uid": "artist-entity"},
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_artist_hero_artwork",
        lambda _artist_id: {"desktop_enabled": True},
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revisions",
        lambda _artist_id: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_manifest_history",
        lambda _artist_id: [],
    )

    result = cleanup_artist_hero_publications(max_artists=10)

    assert legacy_root.is_dir()
    assert result["artists_checked"] == 1


def test_artist_hero_cleanup_removes_a_legacy_variant_without_a_profile(
    monkeypatch, tmp_path
):
    from crate.artwork_maintenance import cleanup_artist_hero_publications
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    legacy_root = artwork_asset_root(
        ArtworkAsset("artist-hero", "artist-entity:desktop")
    )
    legacy_root.mkdir(parents=True)
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_library_artist_by_entity_uid",
        lambda _entity_uid: {"id": 42, "entity_uid": "artist-entity"},
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_artist_hero_artwork",
        lambda _artist_id: None,
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revisions",
        lambda _artist_id: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_manifest_history",
        lambda _artist_id: [],
    )

    cleanup_artist_hero_publications(max_artists=10)

    assert not legacy_root.exists()


def test_artist_hero_cleanup_removes_expired_materialization_temporaries(
    monkeypatch, tmp_path
):
    from crate.artwork_maintenance import cleanup_artist_hero_publications
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    materialization_root = artwork_asset_root(
        ArtworkAsset("artist-hero", "artist-entity:desktop:revision-a")
    )
    expired_directory = materialization_root / ".source-revision-crashed.tmp"
    expired_manifest = materialization_root / ".current-crashed.json.tmp"
    fresh_directory = materialization_root / ".source-revision-running.tmp"
    expired_directory.mkdir(parents=True)
    expired_manifest.write_text("{}", encoding="utf-8")
    fresh_directory.mkdir()
    expired = time.time() - 90000
    os.utime(expired_directory, (expired, expired))
    os.utime(expired_manifest, (expired, expired))
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_library_artist_by_entity_uid",
        lambda _entity_uid: {"id": 42, "entity_uid": "artist-entity"},
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_artist_hero_artwork",
        lambda _artist_id: {
            "desktop_enabled": True,
            "render_manifest": {
                "artifacts": {"desktop": {"render_revision": "revision-a"}}
            },
        },
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revisions",
        lambda _artist_id: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_manifest_history",
        lambda _artist_id: [],
    )

    result = cleanup_artist_hero_publications(max_artists=10)

    assert not expired_directory.exists()
    assert not expired_manifest.exists()
    assert fresh_directory.is_dir()
    assert result["temporary_removed"] == 2


def test_artist_hero_cleanup_removes_expired_library_temporaries(monkeypatch, tmp_path):
    from crate.artwork_maintenance import cleanup_artwork_variants

    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    library_root = tmp_path / "music"
    artist_root = library_root / "artist-entity"
    artist_root.mkdir(parents=True)
    expired_source = artist_root / ".artist-hero-source.jpg.crashed.tmp"
    expired_render = artist_root / ".artist-hero-desktop.webp.crashed.tmp"
    fresh_source = artist_root / ".artist-hero-source.jpg.running.tmp"
    expired_source.write_bytes(b"partial")
    expired_render.write_bytes(b"partial")
    fresh_source.write_bytes(b"partial")
    expired = time.time() - 90000
    os.utime(expired_source, (expired, expired))
    os.utime(expired_render, (expired, expired))
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [],
    )

    result = cleanup_artwork_variants(
        max_assets=10,
        library_root=library_root,
    )

    assert not expired_source.exists()
    assert not expired_render.exists()
    assert fresh_source.is_file()
    assert result["artist_hero_temporary_removed"] == 2


def test_artist_hero_cleanup_bounds_and_rotates_library_temporary_work(
    monkeypatch, tmp_path
):
    from crate.artwork_maintenance import cleanup_artist_hero_publications

    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    library_root = tmp_path / "music"
    temporary_paths = []
    for artist_name in ("artist-a", "artist-b", "artist-c"):
        artist_root = library_root / artist_name
        artist_root.mkdir(parents=True)
        temporary_path = artist_root / ".artist-hero-source.jpg.crashed.tmp"
        temporary_path.write_bytes(b"partial")
        expired = time.time() - 90000
        os.utime(temporary_path, (expired, expired))
        temporary_paths.append(temporary_path)
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [],
    )

    first = cleanup_artist_hero_publications(
        max_artists=1,
        library_root=library_root,
    )
    remaining_after_first = {path for path in temporary_paths if path.exists()}
    second = cleanup_artist_hero_publications(
        max_artists=1,
        library_root=library_root,
    )
    remaining_after_second = {path for path in temporary_paths if path.exists()}

    assert first["temporary_removed"] == 1
    assert second["temporary_removed"] == 1
    assert len(remaining_after_first) == 2
    assert len(remaining_after_second) == 1


def test_artist_hero_cleanup_rechecks_library_temporary_inside_writer_lock(
    monkeypatch, tmp_path
):
    from contextlib import contextmanager

    from crate.artwork_maintenance import cleanup_artist_hero_publications

    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    library_root = tmp_path / "music"
    artist_root = library_root / "artist-a"
    artist_root.mkdir(parents=True)
    temporary_path = artist_root / ".artist-hero-source.jpg.live.tmp"
    temporary_path.write_bytes(b"partial")
    expired = time.time() - 90000
    os.utime(temporary_path, (expired, expired))
    locked: list[object] = []

    @contextmanager
    def writer_lock(path):
        locked.append(path)
        os.utime(temporary_path, None)
        yield

    monkeypatch.setattr(
        "crate.artwork_maintenance.artist_hero_file_lock",
        writer_lock,
        raising=False,
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [],
    )

    result = cleanup_artist_hero_publications(
        max_artists=1,
        library_root=library_root,
    )

    assert temporary_path.is_file()
    assert result["temporary_removed"] == 0
    assert locked == [artist_root.resolve()]


def test_artist_hero_cleanup_bounds_and_rotates_materialization_queries(
    monkeypatch, tmp_path
):
    from crate.artwork_maintenance import cleanup_artist_hero_publications
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    for entity_uid in ("artist-a", "artist-b", "artist-c"):
        artwork_asset_root(ArtworkAsset("artist-hero", f"{entity_uid}:desktop")).mkdir(
            parents=True
        )
    queried: list[str] = []
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [],
    )

    def get_artist(entity_uid: str) -> dict:
        queried.append(entity_uid)
        return {"id": ord(entity_uid[-1]), "entity_uid": entity_uid}

    monkeypatch.setattr(
        "crate.artwork_maintenance.get_library_artist_by_entity_uid",
        get_artist,
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_artist_hero_artwork",
        lambda _artist_id: {
            "desktop_enabled": True,
            "render_manifest": {"artifacts": {}},
        },
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revisions",
        lambda _artist_id: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_manifest_history",
        lambda _artist_id: [],
    )

    cleanup_artist_hero_publications(max_artists=1)
    first_uids = set(queried)
    queried.clear()
    cleanup_artist_hero_publications(max_artists=1)
    second_uids = set(queried)

    assert len(first_uids) == 1
    assert len(second_uids) == 1
    assert first_uids.isdisjoint(second_uids)


def test_artist_hero_cleanup_does_not_starve_legacy_roots_when_history_is_full(
    monkeypatch, tmp_path
):
    from crate.artwork_maintenance import cleanup_artist_hero_publications
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    legacy_root = artwork_asset_root(
        ArtworkAsset("artist-hero", "legacy-artist:desktop")
    )
    legacy_root.mkdir(parents=True)
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [{"artist_id": 1, "entity_uid": "history-artist"}],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_library_artist_by_entity_uid",
        lambda entity_uid: {
            "id": 2 if entity_uid == "legacy-artist" else 1,
            "entity_uid": entity_uid,
        },
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_artist_hero_artwork",
        lambda artist_id: (
            {
                "desktop_enabled": True,
                "render_manifest": {
                    "artifacts": {"desktop": {"render_revision": "current-revision"}}
                },
            }
            if artist_id == 2
            else {}
        ),
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revisions",
        lambda _artist_id: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_manifest_history",
        lambda _artist_id: [],
    )

    cleanup_artist_hero_publications(max_artists=1)
    cleanup_artist_hero_publications(max_artists=1)

    assert not legacy_root.exists()


def test_cleanup_artist_hero_publications_keeps_active_previous_and_fresh_orphans(
    monkeypatch, tmp_path
):
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_asset,
        artist_hero_artifact_root,
    )
    from crate.artwork_maintenance import cleanup_artist_hero_publications
    from crate.artwork_variants import artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    current = ArtistHeroArtifactIdentity("artist-entity", "desktop", "current")
    previous = ArtistHeroArtifactIdentity("artist-entity", "desktop", "previous")
    stale = ArtistHeroArtifactIdentity("artist-entity", "desktop", "stale")
    orphan = ArtistHeroArtifactIdentity("artist-entity", "desktop", "orphan")
    for identity in (current, previous, stale, orphan):
        artist_hero_artifact_root(identity).mkdir(parents=True)
        artwork_asset_root(artist_hero_artifact_asset(identity)).mkdir(parents=True)

    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [
            {"artist_id": 42, "entity_uid": "artist-entity"},
        ],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_library_artist_by_entity_uid",
        lambda _entity_uid: {"id": 42, "entity_uid": "artist-entity"},
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_artist_hero_artwork",
        lambda _artist_id: {
            "render_manifest": {
                "artifacts": {
                    "desktop": {"render_revision": "current"},
                }
            }
        },
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revisions",
        lambda _artist_id: [
            {
                "composition": "desktop",
                "render_revision": "current",
                "created_at": "2026-09-08T12:00:00+00:00",
            },
            {
                "composition": "desktop",
                "render_revision": "previous",
                "created_at": "2026-09-07T12:00:00+00:00",
            },
            {
                "composition": "desktop",
                "render_revision": "stale",
                "created_at": "2026-09-06T12:00:00+00:00",
            },
        ],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_manifest_history",
        lambda _artist_id: [],
    )
    result = cleanup_artist_hero_publications(max_artists=10)

    assert not artist_hero_artifact_root(stale).exists()
    assert artist_hero_artifact_root(current).exists()
    assert artist_hero_artifact_root(previous).exists()
    assert artist_hero_artifact_root(orphan).exists()
    assert not artwork_asset_root(artist_hero_artifact_asset(stale)).exists()
    assert artwork_asset_root(artist_hero_artifact_asset(current)).exists()
    assert artwork_asset_root(artist_hero_artifact_asset(previous)).exists()
    assert artwork_asset_root(artist_hero_artifact_asset(orphan)).exists()
    assert result == {
        "artists_checked": 1,
        "orphan_revisions_removed": 0,
        "revisions_removed": 1,
        "temporary_removed": 0,
    }


def test_cleanup_artist_hero_publications_removes_expired_crash_orphans(
    monkeypatch, tmp_path
):
    from crate.artist_hero_publication import (
        ARTIST_HERO_PUBLICATION_PREFIX,
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_root,
    )
    from crate.artwork_maintenance import cleanup_artist_hero_publications

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    orphan = ArtistHeroArtifactIdentity("artist-orphan", "desktop", "orphan")
    orphan_root = artist_hero_artifact_root(orphan)
    orphan_root.mkdir(parents=True)
    staging = orphan_root.parent / ".desktop-crashed"
    staging.mkdir()
    expired = time.time() - 90000
    os.utime(orphan_root, (expired, expired))
    os.utime(staging, (expired, expired))

    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_library_artist_by_entity_uid",
        lambda entity_uid: (
            {"id": 42, "entity_uid": entity_uid}
            if entity_uid == "artist-orphan"
            else None
        ),
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_artist_hero_artwork",
        lambda _artist_id: {},
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revisions",
        lambda _artist_id: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_manifest_history",
        lambda _artist_id: [],
    )

    result = cleanup_artist_hero_publications(max_artists=10)

    assert not orphan_root.exists()
    assert not staging.exists()
    assert not (tmp_path / ARTIST_HERO_PUBLICATION_PREFIX / "artist-orphan").exists()
    assert result == {
        "artists_checked": 1,
        "orphan_revisions_removed": 1,
        "revisions_removed": 1,
        "temporary_removed": 1,
    }


def test_cleanup_removes_a_known_render_that_lost_manifest_cas(monkeypatch, tmp_path):
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_root,
    )
    from crate.artwork_maintenance import cleanup_artist_hero_publications
    from crate.db.repositories.artist_hero_artwork import artist_hero_manifest_id

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    identities = {
        revision: ArtistHeroArtifactIdentity("artist-entity", "desktop", revision)
        for revision in ("active-c", "orphan-b", "previous-a")
    }
    for identity in identities.values():
        artist_hero_artifact_root(identity).mkdir(parents=True)

    active_manifest = {
        "manifest_version": 1,
        "editorial_revision": "editorial-c",
        "artifacts": {"desktop": {"render_revision": "active-c"}},
    }
    previous_manifest = {
        "manifest_version": 1,
        "editorial_revision": "editorial-a",
        "artifacts": {"desktop": {"render_revision": "previous-a"}},
    }
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [{"artist_id": 42, "entity_uid": "artist-entity"}],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_library_artist_by_entity_uid",
        lambda _entity_uid: {"id": 42, "entity_uid": "artist-entity"},
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_artist_hero_artwork",
        lambda _artist_id: {"render_manifest": active_manifest},
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revisions",
        lambda _artist_id: [
            {
                "composition": "desktop",
                "render_revision": revision,
                "created_at": created_at,
            }
            for revision, created_at in (
                ("active-c", "2026-09-08T12:00:00+00:00"),
                ("orphan-b", "2026-09-08T11:30:00+00:00"),
                ("previous-a", "2026-09-08T11:00:00+00:00"),
            )
        ],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_manifest_history",
        lambda _artist_id: [
            {
                "manifest_id": artist_hero_manifest_id(active_manifest),
                "manifest": active_manifest,
                "created_at": "2026-09-08T12:00:00+00:00",
            },
            {
                "manifest_id": artist_hero_manifest_id(previous_manifest),
                "manifest": previous_manifest,
                "created_at": "2026-09-08T11:00:00+00:00",
            },
        ],
    )

    result = cleanup_artist_hero_publications(max_artists=10)

    assert artist_hero_artifact_root(identities["active-c"]).exists()
    assert artist_hero_artifact_root(identities["previous-a"]).exists()
    assert not artist_hero_artifact_root(identities["orphan-b"]).exists()
    assert result == {
        "artists_checked": 1,
        "orphan_revisions_removed": 0,
        "revisions_removed": 1,
        "temporary_removed": 0,
    }


def test_cleanup_artist_hero_publications_does_not_retain_disabled_compositions(
    monkeypatch, tmp_path
):
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_root,
    )
    from crate.artwork_maintenance import cleanup_artist_hero_publications

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    deleted = ArtistHeroArtifactIdentity("artist-entity", "desktop", "deleted")
    retained = ArtistHeroArtifactIdentity("artist-entity", "mobile", "retained")
    for identity in (deleted, retained):
        artist_hero_artifact_root(identity).mkdir(parents=True)

    active_manifest = {
        "manifest_version": 1,
        "editorial_revision": "editorial-2",
        "artifacts": {"mobile": {"render_revision": "retained"}},
    }
    previous_manifest = {
        "manifest_version": 1,
        "editorial_revision": "editorial-1",
        "artifacts": {
            "desktop": {"render_revision": "deleted"},
            "mobile": {"render_revision": "retained"},
        },
    }
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [{"artist_id": 42, "entity_uid": "artist-entity"}],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_library_artist_by_entity_uid",
        lambda _entity_uid: {"id": 42, "entity_uid": "artist-entity"},
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_artist_hero_artwork",
        lambda _artist_id: {
            "desktop_enabled": False,
            "mobile_enabled": True,
            "render_manifest": active_manifest,
        },
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revisions",
        lambda _artist_id: [
            {"composition": "desktop", "render_revision": "deleted"},
            {"composition": "mobile", "render_revision": "retained"},
        ],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_manifest_history",
        lambda _artist_id: [
            {
                "manifest_id": "active",
                "manifest": active_manifest,
                "previous_manifest": previous_manifest,
            },
            {"manifest_id": "previous", "manifest": previous_manifest},
        ],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.artist_hero_manifest_id", lambda _manifest: "active"
    )

    result = cleanup_artist_hero_publications(max_artists=10)

    assert not artist_hero_artifact_root(deleted).exists()
    assert artist_hero_artifact_root(retained).exists()
    assert result["revisions_removed"] == 1


def test_delete_artist_hero_storage_removes_publications_and_materializations(
    monkeypatch, tmp_path
):
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_asset,
        artist_hero_artifact_root,
        delete_artist_hero_storage,
    )
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    identity = ArtistHeroArtifactIdentity("artist-entity", "desktop", "revision-a")
    publication = artist_hero_artifact_root(identity)
    materialization = artwork_asset_root(artist_hero_artifact_asset(identity))
    unrelated = artwork_asset_root(ArtworkAsset("artist-hero", "other:desktop:rev"))
    publication.mkdir(parents=True)
    materialization.mkdir(parents=True)
    unrelated.mkdir(parents=True)

    result = delete_artist_hero_storage("artist-entity")

    assert result == {"materializations_removed": 1, "publication_roots_removed": 1}
    assert not publication.exists()
    assert not materialization.exists()
    assert unrelated.exists()


def test_delete_artist_hero_storage_does_not_follow_namespace_symlinks(
    monkeypatch, tmp_path
):
    from crate.artist_hero_publication import delete_artist_hero_storage

    cache_root = tmp_path / "cache"
    outside_root = tmp_path / "outside"
    publication_root = (
        outside_root
        / "publications"
        / "v1"
        / "artist-entity"
        / "desktop"
        / "revision-a"
    )
    materialization_root = (
        outside_root
        / "variants"
        / "v1"
        / "artist-hero"
        / "artist-entity:desktop:revision-a"
    )
    publication_root.mkdir(parents=True)
    materialization_root.mkdir(parents=True)
    cache_root.mkdir()
    (cache_root / "artist-hero-publications").symlink_to(
        outside_root / "publications", target_is_directory=True
    )
    (cache_root / "artwork-variants").symlink_to(
        outside_root / "variants", target_is_directory=True
    )
    monkeypatch.setenv("CACHE_DIR", str(cache_root))

    result = delete_artist_hero_storage("artist-entity")

    assert result == {"materializations_removed": 0, "publication_roots_removed": 0}
    assert publication_root.is_dir()
    assert materialization_root.is_dir()


def test_cleanup_artist_hero_publications_does_not_follow_namespace_symlinks(
    monkeypatch, tmp_path
):
    from crate.artwork_maintenance import cleanup_artist_hero_publications

    data_root = tmp_path / "data"
    cache_root = tmp_path / "cache"
    outside_root = tmp_path / "outside"
    publication_root = (
        outside_root
        / "publications"
        / "v1"
        / "artist-entity"
        / "desktop"
        / "revision-a"
    )
    materialization_root = (
        outside_root
        / "variants"
        / "v1"
        / "artist-hero"
        / "artist-entity:desktop:revision-a"
    )
    publication_root.mkdir(parents=True)
    materialization_root.mkdir(parents=True)
    data_root.mkdir()
    cache_root.mkdir()
    (cache_root / "artist-hero-publications").symlink_to(
        outside_root / "publications", target_is_directory=True
    )
    (cache_root / "artwork-variants").symlink_to(
        outside_root / "variants", target_is_directory=True
    )
    monkeypatch.setenv("DATA_DIR", str(data_root))
    monkeypatch.setenv("CACHE_DIR", str(cache_root))
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_library_artist_by_entity_uid",
        lambda _entity_uid: None,
    )

    result = cleanup_artist_hero_publications(max_artists=10)

    assert result == {
        "artists_checked": 0,
        "revisions_removed": 0,
        "temporary_removed": 0,
        "orphan_revisions_removed": 0,
    }
    assert publication_root.is_dir()
    assert materialization_root.is_dir()


def test_cleanup_cursor_rejects_lock_directory_symlink_escape(monkeypatch, tmp_path):
    from crate.artwork_maintenance import _rotating_name_batch

    data_root = tmp_path / "data"
    outside_root = tmp_path / "outside"
    data_root.mkdir()
    outside_root.mkdir()
    (data_root / ".crate-locks").symlink_to(outside_root, target_is_directory=True)
    monkeypatch.setenv("DATA_DIR", str(data_root))

    with pytest.raises(ValueError, match="outside the data root"):
        _rotating_name_batch({"artist-1"}, limit=1, cursor_name="test-lock")

    assert list(outside_root.iterdir()) == []


def test_cleanup_cursor_rejects_cursor_directory_symlink_escape(monkeypatch, tmp_path):
    from crate.artwork_maintenance import _rotating_name_batch

    data_root = tmp_path / "data"
    outside_root = tmp_path / "outside"
    data_root.mkdir()
    outside_root.mkdir()
    (data_root / ".crate-maintenance").symlink_to(
        outside_root, target_is_directory=True
    )
    monkeypatch.setenv("DATA_DIR", str(data_root))

    with pytest.raises(ValueError, match="outside the data root"):
        _rotating_name_batch({"artist-1"}, limit=1, cursor_name="test-cursor")

    assert list(outside_root.iterdir()) == []


def test_cleanup_artist_hero_publications_removes_expired_deleted_artist_storage(
    monkeypatch, tmp_path
):
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_asset,
        artist_hero_artifact_root,
    )
    from crate.artwork_maintenance import cleanup_artist_hero_publications
    from crate.artwork_variants import artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    identity = ArtistHeroArtifactIdentity(
        "deleted-artist-entity", "desktop", "revision-a"
    )
    publication = artist_hero_artifact_root(identity)
    materialization = artwork_asset_root(artist_hero_artifact_asset(identity))
    publication.mkdir(parents=True)
    materialization.mkdir(parents=True)
    expired = time.time() - 90000
    os.utime(publication.parents[1], (expired, expired))

    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_library_artist_by_entity_uid",
        lambda _entity_uid: None,
    )

    result = cleanup_artist_hero_publications(max_artists=10)

    assert not publication.exists()
    assert not materialization.exists()
    assert result["orphan_revisions_removed"] == 1


def test_cleanup_counts_materialization_only_deleted_artist_as_orphan(
    monkeypatch, tmp_path
):
    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_asset,
    )
    from crate.artwork_maintenance import cleanup_artist_hero_publications
    from crate.artwork_variants import artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    identity = ArtistHeroArtifactIdentity(
        "deleted-artist-entity", "desktop", "revision-a"
    )
    materialization = artwork_asset_root(artist_hero_artifact_asset(identity))
    materialization.mkdir(parents=True)
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_library_artist_by_entity_uid",
        lambda _entity_uid: None,
    )

    result = cleanup_artist_hero_publications(max_artists=10)

    assert not materialization.exists()
    assert result["revisions_removed"] == 1
    assert result["orphan_revisions_removed"] == 1


def test_cleanup_artist_hero_publications_tolerates_an_orphan_removed_while_waiting(
    monkeypatch, tmp_path
):
    from contextlib import contextmanager
    import shutil

    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_root,
    )
    from crate.artwork_maintenance import cleanup_artist_hero_publications

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    identity = ArtistHeroArtifactIdentity(
        "deleted-artist-entity", "desktop", "revision-a"
    )
    entity_root = artist_hero_artifact_root(identity).parents[1]
    artist_hero_artifact_root(identity).mkdir(parents=True)
    expired = time.time() - 90000
    os.utime(entity_root, (expired, expired))

    @contextmanager
    def publication_lock(_entity_uid):
        shutil.rmtree(entity_root)
        yield

    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_library_artist_by_entity_uid",
        lambda _entity_uid: None,
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.artist_hero_publication_lock",
        publication_lock,
    )

    result = cleanup_artist_hero_publications(max_artists=10)

    assert result["artists_checked"] == 1
    assert result["orphan_revisions_removed"] == 0


def test_cleanup_artist_hero_publications_preserves_a_recreated_artist(
    monkeypatch, tmp_path
):
    from contextlib import contextmanager

    from crate.artist_hero_publication import (
        ArtistHeroArtifactIdentity,
        artist_hero_artifact_root,
    )
    from crate.artwork_maintenance import cleanup_artist_hero_publications

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    identity = ArtistHeroArtifactIdentity(
        "recreated-artist-entity", "desktop", "revision-a"
    )
    publication = artist_hero_artifact_root(identity)
    publication.mkdir(parents=True)
    expired = time.time() - 90000
    os.utime(publication.parents[1], (expired, expired))
    lookups = iter(
        [
            None,
            {"id": 99, "entity_uid": "recreated-artist-entity"},
            {"id": 100, "entity_uid": "recreated-artist-entity"},
        ]
    )
    lock_keys: list[str] = []
    profile_artist_ids: list[int] = []

    @contextmanager
    def publication_lock(entity_uid):
        lock_keys.append(entity_uid)
        yield

    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revision_artists",
        lambda **_kwargs: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_library_artist_by_entity_uid",
        lambda _entity_uid: next(lookups),
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.artist_hero_publication_lock",
        publication_lock,
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.get_artist_hero_artwork",
        lambda artist_id: profile_artist_ids.append(artist_id) or {},
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_render_revisions",
        lambda _artist_id: [],
    )
    monkeypatch.setattr(
        "crate.artwork_maintenance.list_artist_hero_manifest_history",
        lambda _artist_id: [],
    )

    result = cleanup_artist_hero_publications(max_artists=10)

    assert publication.is_dir()
    assert result["orphan_revisions_removed"] == 0
    assert lock_keys == ["recreated-artist-entity", "recreated-artist-entity"]
    assert profile_artist_ids == [100]


def test_repair_manifest_permissions_makes_existing_assets_readplane_readable(
    monkeypatch, tmp_path
):
    from crate.artwork_maintenance import repair_artwork_manifest_permissions
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    root = artwork_asset_root(ArtworkAsset("album-cover", "album-entity"))
    root.mkdir(parents=True)
    manifest = root / "current.json"
    manifest.write_text("{}")
    manifest.chmod(0o600)

    result = repair_artwork_manifest_permissions(max_assets=10)

    assert result == {"assets_checked": 1, "permissions_repaired": 1}
    assert stat.S_IMODE(manifest.stat().st_mode) == 0o644


def test_integrity_sample_reports_invalid_manifests_and_missing_files(
    monkeypatch, tmp_path
):
    from crate.artwork_maintenance import inspect_artwork_variants
    from crate.artwork_variants import ArtworkAsset, artwork_asset_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    invalid_root = artwork_asset_root(ArtworkAsset("album-cover", "album-invalid"))
    invalid_root.mkdir(parents=True)
    (invalid_root / "current.json").write_text("not-json")
    missing_root = artwork_asset_root(ArtworkAsset("artist-photo", "artist-missing"))
    missing_root.mkdir(parents=True)
    (missing_root / "current.json").write_text(
        json.dumps(
            {
                "version": 1,
                "kind": "artist-photo",
                "entity_key": "artist-missing",
                "source_revision": "abc",
                "variants": {"128": "abc/128.webp"},
            }
        )
    )

    result = inspect_artwork_variants(max_assets=10)

    assert result["assets_checked"] == 2
    assert result["invalid_manifests"] == 1
    assert result["missing_variant_files"] == 1
    assert result["corrupt_assets"] == 2


def test_repair_handler_requeues_corrupt_assets(monkeypatch):
    from crate.artwork_variants import ArtworkAsset
    from crate.worker_handlers import artwork

    queued = []
    monkeypatch.setattr(
        artwork,
        "find_corrupt_artwork_assets",
        lambda **_kwargs: [ArtworkAsset("album-cover", "album-entity")],
    )
    monkeypatch.setattr(
        artwork,
        "queue_artwork_materialization",
        lambda asset, *, reason: queued.append((asset, reason)),
    )

    result = artwork._handle_repair_artwork_variants("task-1", {"max_assets": 100}, {})

    assert result == {"assets_checked": 100, "requeued": 1}
    assert queued == [(ArtworkAsset("album-cover", "album-entity"), "integrity-repair")]


def test_repair_handler_fixes_manifest_modes_and_marks_upgrade_complete(monkeypatch):
    from crate.worker_handlers import artwork

    completed = []
    monkeypatch.setattr(artwork, "find_corrupt_artwork_assets", lambda **_kwargs: [])
    monkeypatch.setattr(
        artwork,
        "repair_artwork_manifest_permissions",
        lambda **_kwargs: {"assets_checked": 42, "permissions_repaired": 41},
    )
    monkeypatch.setattr(
        "crate.db.cache_settings.set_setting",
        lambda key, value: completed.append((key, value)),
    )

    result = artwork._handle_repair_artwork_variants(
        "task-1",
        {"max_assets": 100_000, "repair_manifest_permissions": True},
        {},
    )

    assert result == {
        "assets_checked": 100_000,
        "requeued": 0,
        "manifest_assets_checked": 42,
        "permissions_repaired": 41,
    }
    assert completed == [("artwork_manifest_permissions_version", "1")]


def test_normal_health_uses_a_bounded_artwork_integrity_sample(monkeypatch):
    from crate import health_check

    calls = []
    monkeypatch.setattr(
        "crate.artwork_maintenance.inspect_artwork_variants",
        lambda *, max_assets: (
            calls.append(max_assets) or {"assets_checked": 17, "corrupt_assets": 0}
        ),
    )

    assert health_check.artwork_variant_health_sample() == {
        "assets_checked": 17,
        "corrupt_assets": 0,
    }
    assert calls == [100]


def test_artwork_cleanup_is_scheduled_as_bounded_maintenance():
    from crate.scheduler import DEFAULT_SCHEDULES

    assert DEFAULT_SCHEDULES["cleanup_artwork_variants"] == 172800
