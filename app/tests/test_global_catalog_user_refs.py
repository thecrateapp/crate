import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _seed_global_artist_and_album(pg_db):
    from crate.db.tx import transaction_scope

    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    local_artist_uid = str(uuid.uuid4())
    local_album_uid = str(uuid.uuid4())

    artist_id = pg_db.upsert_artist(
        {
            "name": "High Vis",
            "entity_uid": local_artist_uid,
            "has_photo": 1,
        }
    )
    pg_db.upsert_album(
        {
            "artist": "High Vis",
            "name": "Blending",
            "path": "/music/High Vis/Blending",
            "entity_uid": local_album_uid,
            "year": "2022",
            "track_count": 10,
            "total_duration": 1800,
            "has_cover": 1,
        }
    )

    with transaction_scope() as session:
        artist_id = session.execute(
            text("SELECT id FROM library_artists WHERE name = 'High Vis' LIMIT 1")
        ).scalar_one()
        local_album_id = session.execute(
            text("SELECT id FROM library_albums WHERE name = 'Blending' LIMIT 1")
        ).scalar_one()

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO global_catalog_artists
                    (
                        global_artist_uid,
                        canonical_name,
                        sort_name,
                        normalized_name,
                        local_artist_id,
                        local_artist_entity_uid,
                        has_local,
                        has_remote,
                        has_photo
                    )
                VALUES
                    (
                        :artist_uid,
                        'High Vis',
                        'High Vis',
                        'high vis',
                        :artist_id,
                        :local_artist_uid,
                        true,
                        true,
                        true
                    )
                """
            ),
            {
                "artist_uid": artist_uid,
                "artist_id": artist_id,
                "local_artist_uid": local_artist_uid,
            },
        )
        session.execute(
            text(
                """
                INSERT INTO global_catalog_albums
                    (
                        global_album_uid,
                        global_artist_uid,
                        canonical_name,
                        normalized_name,
                        artist_name,
                        year,
                        track_count,
                        total_duration_seconds,
                        local_album_id,
                        local_album_entity_uid,
                        has_local,
                        has_remote,
                        has_cover
                    )
                VALUES
                    (
                        :album_uid,
                        :artist_uid,
                        'Blending',
                        'blending',
                        'High Vis',
                        '2022',
                        10,
                        1800,
                        :album_id,
                        :local_album_uid,
                        true,
                        true,
                        true
                    )
                """
            ),
            {
                "album_uid": album_uid,
                "artist_uid": artist_uid,
                "album_id": local_album_id,
                "local_album_uid": local_album_uid,
            },
        )
    return artist_uid, album_uid


def test_backfill_legacy_library_refs_projects_resolved_local_entities(pg_db):
    from crate.db.repositories.global_user_library import (
        backfill_legacy_user_library_refs,
        get_user_global_library_counts,
        list_user_global_album_saves,
        list_user_global_artist_follows,
    )
    from crate.db.repositories.global_catalog_state import get_catalog_state
    from crate.db.tx import transaction_scope

    artist_uid, album_uid = _seed_global_artist_and_album(pg_db)
    with transaction_scope() as session:
        album_id = session.execute(
            text("SELECT id FROM library_albums WHERE name = 'Blending' LIMIT 1")
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO user_follows (user_id, artist_name, created_at)
                VALUES (1, 'High Vis', '2026-07-13T10:00:00+00:00')
                """
            )
        )
        session.execute(
            text(
                """
                INSERT INTO user_saved_albums (user_id, album_id, created_at)
                VALUES (1, :album_id, '2026-07-13T10:00:00+00:00')
                """
            ),
            {"album_id": album_id},
        )

    assert backfill_legacy_user_library_refs() == {
        "artist_follows": 1,
        "album_saves": 1,
    }
    assert get_user_global_library_counts(1)["followed_artists"] == 1
    assert get_user_global_library_counts(1)["saved_albums"] == 1
    assert [row["global_artist_uid"] for row in list_user_global_artist_follows(1)] == [
        artist_uid
    ]
    assert [row["global_album_uid"] for row in list_user_global_album_saves(1)] == [
        album_uid
    ]
    assert get_catalog_state()["user_refs_backfilled_at"] is not None

    assert backfill_legacy_user_library_refs() == {
        "artist_follows": 0,
        "album_saves": 0,
    }


def test_global_artist_follow_dual_writes_local_follow(pg_db):
    from crate.db.repositories.global_user_library import (
        follow_global_artist,
        is_global_artist_followed,
    )
    from crate.db.queries.user_library_library import is_following

    artist_uid, _album_uid = _seed_global_artist_and_album(pg_db)

    added = follow_global_artist(1, artist_uid)

    assert added is True
    assert is_global_artist_followed(1, artist_uid) is True
    assert is_following(1, "High Vis") is True


def test_user_global_library_counts_include_remote_only_refs(pg_db):
    from crate.db.repositories.global_user_library import (
        follow_global_artist,
        get_user_global_library_counts,
        list_user_global_album_saves,
        list_user_global_artist_follows,
        save_global_album,
    )
    from crate.db.tx import transaction_scope

    local_artist_uid, local_album_uid = _seed_global_artist_and_album(pg_db)
    remote_artist_uid = str(uuid.uuid4())
    remote_album_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO global_catalog_artists
                    (global_artist_uid, canonical_name, sort_name, normalized_name, has_remote)
                VALUES
                    (:artist_uid, 'Rival Schools', 'Rival Schools', 'rival schools', true)
                """
            ),
            {"artist_uid": remote_artist_uid},
        )
        session.execute(
            text(
                """
                INSERT INTO global_catalog_albums
                    (
                        global_album_uid,
                        global_artist_uid,
                        canonical_name,
                        normalized_name,
                        artist_name,
                        has_remote
                    )
                VALUES
                    (:album_uid, :artist_uid, 'Pedals', 'pedals', 'Rival Schools', true)
                """
            ),
            {"album_uid": remote_album_uid, "artist_uid": remote_artist_uid},
        )

    assert follow_global_artist(1, local_artist_uid) is True
    assert follow_global_artist(1, remote_artist_uid) is True
    assert save_global_album(1, local_album_uid) is True
    assert save_global_album(1, remote_album_uid) is True

    counts = get_user_global_library_counts(1)

    assert counts["followed_artists"] == 2
    assert counts["saved_albums"] == 2
    assert counts["liked_tracks"] == 0

    artists = list_user_global_artist_follows(1)
    albums = list_user_global_album_saves(1)
    assert any(
        artist["photo_url"] == f"/api/catalog/artists/{local_artist_uid}/photo"
        for artist in artists
    )
    assert any(
        album["cover_url"] == f"/api/catalog/albums/{local_album_uid}/cover"
        for album in albums
    )


def test_global_album_save_dual_writes_local_save(pg_db):
    from crate.db.queries.user_library_library import is_album_saved
    from crate.db.tx import transaction_scope
    from crate.db.repositories.global_user_library import (
        is_global_album_saved,
        save_global_album,
    )

    _artist_uid, album_uid = _seed_global_artist_and_album(pg_db)

    added = save_global_album(1, album_uid)

    assert added is True
    assert is_global_album_saved(1, album_uid) is True
    with transaction_scope() as session:
        local_album_id = session.execute(
            text("SELECT id FROM library_albums WHERE name = 'Blending' LIMIT 1")
        ).scalar_one()
    assert is_album_saved(1, local_album_id) is True


def test_remote_only_global_save_does_not_create_local_library_rows(pg_db):
    from crate.db.tx import transaction_scope
    from crate.db.repositories.global_user_library import save_global_album

    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO global_catalog_artists
                    (global_artist_uid, canonical_name, sort_name, normalized_name, has_remote)
                VALUES
                    (:artist_uid, 'Rival Schools', 'Rival Schools', 'rival schools', true)
                """
            ),
            {"artist_uid": artist_uid},
        )
        session.execute(
            text(
                """
                INSERT INTO global_catalog_albums
                    (
                        global_album_uid,
                        global_artist_uid,
                        canonical_name,
                        normalized_name,
                        artist_name,
                        has_remote
                    )
                VALUES
                    (:album_uid, :artist_uid, 'Pedals', 'pedals', 'Rival Schools', true)
                """
            ),
            {"album_uid": album_uid, "artist_uid": artist_uid},
        )

    assert save_global_album(1, album_uid) is True
    with transaction_scope() as session:
        local_album_count = session.execute(
            text("SELECT COUNT(*) FROM library_albums WHERE name = 'Pedals'")
        ).scalar_one()
    assert local_album_count == 0
