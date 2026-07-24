from __future__ import annotations

from pathlib import Path
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

ROOT = Path(__file__).resolve().parents[2]

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _insert_artist(session, uid: str, name: str) -> None:
    session.execute(
        text(
            """
            INSERT INTO global_catalog_artists (
                global_artist_uid, canonical_name, public_slug, sort_name,
                normalized_name
            )
            VALUES (CAST(:uid AS uuid), :name, :slug, :name, :normalized)
            """
        ),
        {
            "uid": uid,
            "name": name,
            "slug": name.lower().replace(" ", "-"),
            "normalized": name.lower(),
        },
    )


def test_artist_route_alias_survives_rename(pg_db):
    from crate.db.jobs.global_catalog_routes import claim_artist_public_slug
    from crate.db.queries.global_catalog import _global_artist_uid_by_public_slug
    from crate.db.tx import transaction_scope

    artist_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        _insert_artist(session, artist_uid, "High Vis")
        assert claim_artist_public_slug(session, artist_uid, "high-vis") == "high-vis"
        assert (
            claim_artist_public_slug(session, artist_uid, "high-visibility")
            == "high-visibility"
        )

    assert _global_artist_uid_by_public_slug("high-vis") == artist_uid
    assert _global_artist_uid_by_public_slug("high-visibility") == artist_uid


def test_artist_slug_collision_gets_stable_human_qualifier(pg_db):
    from crate.db.jobs.global_catalog_routes import claim_artist_public_slug
    from crate.db.tx import transaction_scope

    first_uid = str(uuid.uuid4())
    second_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        _insert_artist(session, first_uid, "High Vis")
        _insert_artist(session, second_uid, "High-Vis")
        assert claim_artist_public_slug(session, first_uid, "high-vis") == "high-vis"
        claimed = claim_artist_public_slug(session, second_uid, "high-vis")
        repeated = claim_artist_public_slug(session, second_uid, "high-vis")

    assert claimed == "high-vis-music"
    assert repeated == claimed
    assert second_uid not in claimed
    assert "global-" not in claimed


def test_album_alias_is_scoped_to_artist_and_survives_rename(pg_db):
    from crate.db.jobs.global_catalog_routes import (
        claim_album_public_slug,
        claim_artist_public_slug,
    )
    from crate.db.queries.global_catalog import get_global_album_detail_by_public_slugs
    from crate.db.tx import transaction_scope

    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        _insert_artist(session, artist_uid, "High Vis")
        claim_artist_public_slug(session, artist_uid, "high-vis")
        session.execute(
            text(
                """
                INSERT INTO global_catalog_albums (
                    global_album_uid, global_artist_uid, canonical_name,
                    normalized_name, artist_name, artist_slug, public_slug
                )
                VALUES (
                    CAST(:album_uid AS uuid), CAST(:artist_uid AS uuid),
                    'Blending', 'blending', 'High Vis', 'high-vis', 'blending'
                )
                """
            ),
            {"album_uid": album_uid, "artist_uid": artist_uid},
        )
        claim_album_public_slug(session, album_uid, artist_uid, "blending", year="2022")
        claim_album_public_slug(
            session,
            album_uid,
            artist_uid,
            "blending-remastered",
            year="2022",
        )

    old_route = get_global_album_detail_by_public_slugs("high-vis", "blending")
    new_route = get_global_album_detail_by_public_slugs(
        "high-vis", "blending-remastered"
    )
    assert old_route and old_route["global_album_uid"] == album_uid
    assert new_route and new_route["global_album_uid"] == album_uid


def test_route_alias_migration_is_reversible():
    source = (
        ROOT / "app/crate/db/migrations/versions/067a_global_catalog_route_aliases.py"
    ).read_text()
    assert 'revision = "067a"' in source
    assert 'down_revision = "067"' in source
    assert "global_catalog_artist_route_aliases" in source
    assert "global_catalog_album_route_aliases" in source
    assert "DROP TABLE IF EXISTS global_catalog_album_route_aliases" in source
