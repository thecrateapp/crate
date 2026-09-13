from __future__ import annotations

import json

import pytest

from tests.conftest import PG_AVAILABLE


def _manifest(editorial_revision: str, render_revision: str) -> dict:
    return {
        "manifest_version": 1,
        "editorial_revision": editorial_revision,
        "artifacts": {
            "desktop": {
                "renderer_version": "cover-fit-v4",
                "render_revision": render_revision,
                "source_fingerprint": f"sha256:{render_revision}",
                "recipe_hash": f"recipe:{render_revision}",
                "relative_path": (
                    "artist-hero-publications/v1/artist-42/desktop/"
                    f"{render_revision}/artifact.webp"
                ),
            }
        },
    }


def test_manifest_identity_is_stable_and_order_independent() -> None:
    from crate.db.repositories.artist_hero_artwork import (
        artist_hero_manifest_id,
    )

    first = _manifest("editorial-1", "artifact-a")
    reordered = {
        "artifacts": first["artifacts"],
        "editorial_revision": first["editorial_revision"],
        "manifest_version": first["manifest_version"],
    }

    assert artist_hero_manifest_id(first) == artist_hero_manifest_id(reordered)
    assert artist_hero_manifest_id(first) != artist_hero_manifest_id(
        _manifest("editorial-1", "artifact-b")
    )


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_manifest_history_persists_previous_and_uses_manifest_cas(pg_db) -> None:
    from crate.db.repositories.artist_hero_artwork import (
        compare_and_swap_artist_hero_manifest,
        get_artist_hero_artwork,
        get_artist_hero_manifest_history_entry,
        list_artist_hero_manifest_history,
        list_artist_hero_render_revisions,
        upsert_artist_hero_artwork,
    )
    from crate.db.tx import read_scope
    from sqlalchemy import text

    pg_db.upsert_artist({"name": "Manifest History Artist"})
    with read_scope() as session:
        artist_id = session.execute(
            text(
                "SELECT id FROM library_artists WHERE name = 'Manifest History Artist'"
            )
        ).scalar_one()

    base = {
        "artist_id": artist_id,
        "provenance": "manual",
        "review_status": "approved",
        "source_width": 1600,
        "source_height": 1000,
        "desktop_recipe": {"mode": "crop"},
        "mobile_recipe": {"mode": "crop"},
        "desktop_enabled": True,
        "mobile_enabled": False,
    }
    manifest_a = _manifest("editorial-1", "artifact-a")
    manifest_b = _manifest("editorial-1", "artifact-b")
    manifest_c = _manifest("editorial-1", "artifact-c")

    assert upsert_artist_hero_artwork(
        **base, revision="editorial-1", render_manifest=manifest_a
    )
    assert compare_and_swap_artist_hero_manifest(
        artist_id=artist_id,
        expected_revision="editorial-1",
        expected_manifest=manifest_a,
        render_manifest=manifest_b,
    )
    assert not compare_and_swap_artist_hero_manifest(
        artist_id=artist_id,
        expected_revision="editorial-1",
        expected_manifest=manifest_a,
        render_manifest=manifest_c,
    )

    profile = get_artist_hero_artwork(artist_id)
    assert profile is not None
    assert profile["render_manifest"] == manifest_b
    assert profile["review_status"] == "approved"
    assert profile["provenance"] == "manual"

    history = list_artist_hero_manifest_history(artist_id)
    assert [entry["manifest"] for entry in history] == [manifest_b, manifest_a]
    assert history[0]["previous_manifest"] == manifest_a
    assert (
        get_artist_hero_manifest_history_entry(
            artist_id=artist_id,
            manifest_id=history[0]["manifest_id"],
        )["manifest"]
        == manifest_b
    )
    assert (
        get_artist_hero_manifest_history_entry(
            artist_id=artist_id,
            manifest_id="sha256:missing",
        )
        is None
    )

    render_history = list_artist_hero_render_revisions(artist_id, composition="desktop")
    assert {entry["render_revision"] for entry in render_history} == {
        "artifact-a",
        "artifact-b",
        "artifact-c",
    }


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_profile_upsert_cas_covers_first_publish_and_active_manifest(pg_db) -> None:
    from crate.db.repositories.artist_hero_artwork import (
        get_artist_hero_artwork,
        list_artist_hero_render_revisions,
        upsert_artist_hero_artwork,
    )
    from crate.db.tx import read_scope
    from sqlalchemy import text

    pg_db.upsert_artist({"name": "Strict Profile CAS Artist"})
    with read_scope() as session:
        artist_id = session.execute(
            text(
                "SELECT id FROM library_artists "
                "WHERE name = 'Strict Profile CAS Artist'"
            )
        ).scalar_one()

    base = {
        "artist_id": artist_id,
        "provenance": "manual",
        "review_status": "approved",
        "source_width": 1600,
        "source_height": 1000,
        "desktop_recipe": {"mode": "crop"},
        "mobile_recipe": {"mode": "crop"},
        "desktop_enabled": True,
        "mobile_enabled": False,
    }
    manifest_a = _manifest("editorial-1", "artifact-a")
    manifest_b = _manifest("editorial-1", "artifact-b")
    manifest_c = _manifest("editorial-1", "artifact-c")

    assert upsert_artist_hero_artwork(
        **base,
        revision="editorial-1",
        render_manifest=manifest_a,
        expected_revision=None,
        expected_manifest=None,
    )
    assert not upsert_artist_hero_artwork(
        **base,
        revision="editorial-loser",
        render_manifest=_manifest("editorial-loser", "artifact-loser"),
        expected_revision=None,
        expected_manifest=None,
    )
    assert upsert_artist_hero_artwork(
        **base,
        revision="editorial-1",
        render_manifest=manifest_b,
        expected_revision="editorial-1",
        expected_manifest=manifest_a,
    )
    assert not upsert_artist_hero_artwork(
        **base,
        revision="editorial-1",
        render_manifest=manifest_c,
        expected_revision="editorial-1",
        expected_manifest=manifest_a,
    )
    assert get_artist_hero_artwork(artist_id)["render_manifest"] == manifest_b
    assert {
        entry["render_revision"]
        for entry in list_artist_hero_render_revisions(artist_id, composition="desktop")
    } == {"artifact-a", "artifact-b", "artifact-c", "artifact-loser"}


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_render_history_allows_reusing_artifact_across_editorial_revisions(
    pg_db,
) -> None:
    from crate.db.repositories.artist_hero_artwork import (
        list_artist_hero_render_revisions,
        upsert_artist_hero_artwork,
    )
    from crate.db.tx import read_scope
    from sqlalchemy import text

    pg_db.upsert_artist({"name": "Artifact Reuse Artist"})
    with read_scope() as session:
        artist_id = session.execute(
            text("SELECT id FROM library_artists WHERE name = 'Artifact Reuse Artist'")
        ).scalar_one()

    base = {
        "artist_id": artist_id,
        "provenance": "manual",
        "review_status": "approved",
        "source_width": 1600,
        "source_height": 1000,
        "desktop_recipe": {"mode": "crop"},
        "mobile_recipe": {"mode": "crop"},
        "desktop_enabled": True,
        "mobile_enabled": False,
    }

    assert upsert_artist_hero_artwork(
        **base,
        revision="editorial-1",
        render_manifest=_manifest("editorial-1", "artifact-a"),
    )
    assert upsert_artist_hero_artwork(
        **base,
        revision="editorial-2",
        render_manifest=_manifest("editorial-2", "artifact-a"),
    )

    history = list_artist_hero_render_revisions(artist_id, composition="desktop")
    assert len(history) == 1
    assert history[0]["render_revision"] == "artifact-a"
    assert history[0]["editorial_revision"] == "editorial-1"

    conflicting_manifest = _manifest("editorial-3", "artifact-a")
    conflicting_manifest["artifacts"]["desktop"]["recipe_hash"] = "recipe:other"
    with pytest.raises(ValueError, match="metadata conflict"):
        upsert_artist_hero_artwork(
            **base,
            revision="editorial-3",
            render_manifest=conflicting_manifest,
        )


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_manifest_rollback_rejects_a_stale_active_pointer(pg_db) -> None:
    from crate.db.repositories.artist_hero_artwork import (
        artist_hero_manifest_id,
        compare_and_swap_artist_hero_manifest,
        get_artist_hero_artwork,
        rollback_artist_hero_manifest,
        upsert_artist_hero_artwork,
    )
    from crate.db.tx import read_scope
    from sqlalchemy import text

    pg_db.upsert_artist({"name": "Manifest Rollback Artist"})
    with read_scope() as session:
        artist_id = session.execute(
            text(
                "SELECT id FROM library_artists WHERE name = 'Manifest Rollback Artist'"
            )
        ).scalar_one()

    base = {
        "artist_id": artist_id,
        "provenance": "manual",
        "review_status": "approved",
        "source_width": 1600,
        "source_height": 1000,
        "desktop_recipe": {"mode": "crop"},
        "mobile_recipe": {"mode": "crop"},
        "desktop_enabled": True,
        "mobile_enabled": False,
    }
    manifest_a = _manifest("editorial-1", "artifact-a")
    manifest_b = _manifest("editorial-1", "artifact-b")
    manifest_c = _manifest("editorial-1", "artifact-c")
    assert upsert_artist_hero_artwork(
        **base, revision="editorial-1", render_manifest=manifest_a
    )
    assert compare_and_swap_artist_hero_manifest(
        artist_id=artist_id,
        expected_revision="editorial-1",
        expected_manifest=manifest_a,
        render_manifest=manifest_b,
    )
    assert compare_and_swap_artist_hero_manifest(
        artist_id=artist_id,
        expected_revision="editorial-1",
        expected_manifest=manifest_b,
        render_manifest=manifest_c,
    )

    assert not rollback_artist_hero_manifest(
        artist_id=artist_id,
        expected_revision="editorial-1",
        expected_manifest=manifest_a,
        target_manifest_id=artist_hero_manifest_id(manifest_b),
    )
    assert rollback_artist_hero_manifest(
        artist_id=artist_id,
        expected_revision="editorial-1",
        expected_manifest=manifest_c,
        target_manifest_id=artist_hero_manifest_id(manifest_b),
    )
    assert get_artist_hero_artwork(artist_id)["render_manifest"] == manifest_b


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_manifest_rollback_rejects_a_target_from_another_editorial_revision(
    pg_db,
) -> None:
    from sqlalchemy import text

    from crate.db.repositories.artist_hero_artwork import (
        artist_hero_manifest_id,
        get_artist_hero_artwork,
        rollback_artist_hero_manifest,
        upsert_artist_hero_artwork,
    )
    from crate.db.tx import read_scope, transaction_scope

    pg_db.upsert_artist({"name": "Cross Revision Rollback Artist"})
    with read_scope() as session:
        artist_id = session.execute(
            text(
                "SELECT id FROM library_artists "
                "WHERE name = 'Cross Revision Rollback Artist'"
            )
        ).scalar_one()

    base = {
        "artist_id": artist_id,
        "provenance": "manual",
        "review_status": "approved",
        "source_width": 1600,
        "source_height": 1000,
        "desktop_recipe": {"mode": "crop"},
        "mobile_recipe": {"mode": "crop"},
        "desktop_enabled": True,
        "mobile_enabled": False,
    }
    current_manifest = _manifest("editorial-1", "artifact-a")
    foreign_manifest = _manifest("editorial-2", "artifact-b")
    assert upsert_artist_hero_artwork(
        **base, revision="editorial-1", render_manifest=current_manifest
    )
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO artist_hero_manifest_history (
                    manifest_id, artist_id, editorial_revision,
                    manifest, previous_manifest
                ) VALUES (
                    :manifest_id, :artist_id, :editorial_revision,
                    CAST(:manifest AS JSONB), NULL
                )
                """
            ),
            {
                "manifest_id": artist_hero_manifest_id(foreign_manifest),
                "artist_id": artist_id,
                "editorial_revision": "editorial-2",
                "manifest": json.dumps(foreign_manifest),
            },
        )

    assert not rollback_artist_hero_manifest(
        artist_id=artist_id,
        expected_revision="editorial-1",
        expected_manifest=current_manifest,
        target_manifest_id=artist_hero_manifest_id(foreign_manifest),
    )
    assert get_artist_hero_artwork(artist_id)["render_manifest"] == current_manifest
