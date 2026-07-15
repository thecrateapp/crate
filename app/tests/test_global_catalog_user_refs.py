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
        "track_likes": 0,
        "playlist_tracks": 0,
        "playlist_track_exclusions": 0,
        "play_events": 0,
        "listening_stats_users": 0,
        "unresolved_artist_follows": 0,
        "unresolved_album_saves": 0,
        "unresolved_track_likes": 0,
        "unresolved_playlist_tracks": 0,
        "unresolved_playlist_track_exclusions": 0,
        "unresolved_play_events": 0,
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
        "track_likes": 0,
        "playlist_tracks": 0,
        "playlist_track_exclusions": 0,
        "play_events": 0,
        "listening_stats_users": 0,
        "unresolved_artist_follows": 0,
        "unresolved_album_saves": 0,
        "unresolved_track_likes": 0,
        "unresolved_playlist_tracks": 0,
        "unresolved_playlist_track_exclusions": 0,
        "unresolved_play_events": 0,
    }


def test_backfill_leaves_ambiguous_case_insensitive_artist_follow_unresolved(pg_db):
    from crate.db.repositories.global_user_library import (
        backfill_legacy_user_library_refs,
        get_user_global_library_counts,
        list_user_global_artist_follows,
    )
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.global_reconciliation import reconcile_local_catalog

    pg_db.upsert_artist({"name": "Foo", "entity_uid": str(uuid.uuid4())})
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO library_artists (name, entity_uid, updated_at)
                VALUES ('foo', :entity_uid, NOW())
                """
            ),
            {"entity_uid": str(uuid.uuid4())},
        )
    reconcile_local_catalog()
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO user_follows (user_id, artist_name, created_at)
                VALUES (1, 'FOO', NOW())
                """
            )
        )

    result = backfill_legacy_user_library_refs()

    with read_scope() as session:
        projected = session.execute(
            text("SELECT COUNT(*) FROM user_global_artist_follows WHERE user_id = 1")
        ).scalar_one()
    follows = list_user_global_artist_follows(1)
    assert projected == 0
    assert result["unresolved_artist_follows"] == 1
    assert len(follows) == 1
    assert follows[0]["artist_name"] == "FOO"
    assert get_user_global_library_counts(1)["followed_artists"] == 1


def test_user_reference_backfill_is_bounded_and_resumable_by_user(pg_db):
    from crate.db.repositories.global_user_library import (
        backfill_legacy_user_library_refs_batch,
    )
    from crate.db.tx import read_scope, transaction_scope

    artist_uid, _album_uid = _seed_global_artist_and_album(pg_db)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO users (id, email, password_hash, role, created_at)
                VALUES (2, 'second@example.com', 'hash', 'user', NOW())
                ON CONFLICT (id) DO NOTHING
                """
            )
        )
        session.execute(
            text(
                """
                INSERT INTO user_follows (user_id, artist_name, created_at)
                VALUES (1, 'High Vis', NOW()), (2, 'High Vis', NOW())
                """
            )
        )

    first = backfill_legacy_user_library_refs_batch(batch_size=1, cursor=None)
    second = backfill_legacy_user_library_refs_batch(
        batch_size=1, cursor=first["next_cursor"]
    )

    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT user_id, global_artist_uid::text AS global_artist_uid
                    FROM user_global_artist_follows
                    ORDER BY user_id
                    """
                )
            )
            .mappings()
            .all()
        )
    assert first["users_processed"] == 1
    assert first["completed"] is False
    assert second["users_processed"] == 1
    assert second["completed"] is True
    assert [dict(row) for row in rows] == [
        {"user_id": 1, "global_artist_uid": artist_uid},
        {"user_id": 2, "global_artist_uid": artist_uid},
    ]


def test_backfill_legacy_library_refs_projects_all_local_track_references(pg_db):
    from crate.db.repositories.global_user_library import (
        backfill_legacy_user_library_refs,
    )
    from crate.db.tx import transaction_scope

    artist_uid, album_uid = _seed_global_artist_and_album(pg_db)
    track_uid = str(uuid.uuid4())
    track_entity_uid = str(uuid.uuid4())
    pg_db.upsert_track(
        {
            "artist": "High Vis",
            "album": "Blending",
            "filename": "01 - Trauma Bonds.flac",
            "title": "Trauma Bonds",
            "path": "/music/High Vis/Blending/01 - Trauma Bonds.flac",
            "entity_uid": track_entity_uid,
            "duration": 180,
        }
    )

    with transaction_scope() as session:
        track_id = session.execute(
            text(
                """
                SELECT id
                FROM library_tracks
                WHERE entity_uid = CAST(:track_entity_uid AS uuid)
                """
            ),
            {"track_entity_uid": track_entity_uid},
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO global_catalog_tracks
                    (
                        global_track_uid,
                        global_album_uid,
                        global_artist_uid,
                        canonical_title,
                        normalized_title,
                        artist_name,
                        album_name,
                        duration_seconds,
                        local_track_id,
                        local_track_entity_uid,
                        has_local
                    )
                VALUES
                    (
                        :track_uid,
                        :album_uid,
                        :artist_uid,
                        'Trauma Bonds',
                        'trauma bonds',
                        'High Vis',
                        'Blending',
                        180,
                        :track_id,
                        :track_entity_uid,
                        true
                    )
                """
            ),
            {
                "track_uid": track_uid,
                "album_uid": album_uid,
                "artist_uid": artist_uid,
                "track_id": track_id,
                "track_entity_uid": track_entity_uid,
            },
        )
        playlist_id = session.execute(
            text(
                """
                INSERT INTO playlists (name, user_id, created_at, updated_at)
                VALUES ('Backfill', 1, NOW(), NOW())
                RETURNING id
                """
            )
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO playlist_tracks
                    (
                        playlist_id,
                        track_id,
                        track_entity_uid,
                        track_path,
                        title,
                        artist,
                        album,
                        duration,
                        position,
                        added_at
                    )
                VALUES
                    (
                        :playlist_id,
                        :track_id,
                        CAST(:track_entity_uid AS uuid),
                        '/music/High Vis/Blending/01 - Trauma Bonds.flac',
                        'Trauma Bonds',
                        'High Vis',
                        'Blending',
                        180,
                        1,
                        NOW()
                    )
                """
            ),
            {
                "playlist_id": playlist_id,
                "track_id": track_id,
                "track_entity_uid": track_entity_uid,
            },
        )
        session.execute(
            text(
                """
                INSERT INTO user_play_events
                    (
                        user_id,
                        track_id,
                        track_entity_uid,
                        started_at,
                        ended_at,
                        created_at
                    )
                VALUES
                    (
                        1,
                        :track_id,
                        CAST(:track_entity_uid AS uuid),
                        NOW(),
                        NOW(),
                        NOW()
                    )
                """
            ),
            {"track_id": track_id, "track_entity_uid": track_entity_uid},
        )
        session.execute(
            text(
                """
                INSERT INTO playlist_track_exclusions
                    (
                        playlist_id,
                        track_id,
                        track_entity_uid,
                        track_path,
                        created_at
                    )
                VALUES
                    (
                        :playlist_id,
                        :track_id,
                        CAST(:track_entity_uid AS uuid),
                        '/music/High Vis/Blending/01 - Trauma Bonds.flac',
                        NOW()
                    )
                """
            ),
            {
                "playlist_id": playlist_id,
                "track_id": track_id,
                "track_entity_uid": track_entity_uid,
            },
        )
        session.execute(
            text(
                """
                INSERT INTO user_track_stats
                    (user_id, stat_window, entity_key, track_id, track_entity_uid)
                VALUES
                    (
                        1,
                        'all_time',
                        :track_entity_uid,
                        :track_id,
                        CAST(:track_entity_uid AS uuid)
                    )
                """
            ),
            {"track_id": track_id, "track_entity_uid": track_entity_uid},
        )

    assert backfill_legacy_user_library_refs() == {
        "artist_follows": 0,
        "album_saves": 0,
        "track_likes": 0,
        "playlist_tracks": 1,
        "playlist_track_exclusions": 1,
        "play_events": 1,
        "listening_stats_users": 1,
        "unresolved_artist_follows": 0,
        "unresolved_album_saves": 0,
        "unresolved_track_likes": 0,
        "unresolved_playlist_tracks": 0,
        "unresolved_playlist_track_exclusions": 0,
        "unresolved_play_events": 0,
    }

    with transaction_scope() as session:
        assert (
            session.execute(
                text(
                    """
                SELECT global_track_uid::text
                FROM playlist_tracks
                WHERE playlist_id = :playlist_id
                """
                ),
                {"playlist_id": playlist_id},
            ).scalar_one()
            == track_uid
        )
        assert (
            session.execute(
                text("SELECT global_track_uid::text FROM user_play_events")
            ).scalar_one()
            == track_uid
        )
        assert (
            session.execute(
                text(
                    """
                SELECT global_track_uid::text
                FROM user_track_stats
                WHERE stat_window = 'all_time'
                """
                )
            ).scalar_one()
            == track_uid
        )
        assert (
            session.execute(
                text("SELECT global_track_uid::text FROM playlist_track_exclusions")
            ).scalar_one()
            == track_uid
        )

    assert backfill_legacy_user_library_refs() == {
        "artist_follows": 0,
        "album_saves": 0,
        "track_likes": 0,
        "playlist_tracks": 0,
        "playlist_track_exclusions": 0,
        "play_events": 0,
        "listening_stats_users": 0,
        "unresolved_artist_follows": 0,
        "unresolved_album_saves": 0,
        "unresolved_track_likes": 0,
        "unresolved_playlist_tracks": 0,
        "unresolved_playlist_track_exclusions": 0,
        "unresolved_play_events": 0,
    }


def test_unresolved_legacy_library_refs_remain_visible_to_the_user(pg_db):
    from crate.db.repositories.global_user_library import (
        backfill_legacy_user_library_refs,
        get_user_global_library_counts,
        list_user_global_artist_follows,
    )
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO user_follows (user_id, artist_name, created_at)
                VALUES (1, 'Historical Artist', '2026-07-13T10:00:00+00:00')
                """
            )
        )

    result = backfill_legacy_user_library_refs()

    assert result["unresolved_artist_follows"] == 1
    assert get_user_global_library_counts(1)["followed_artists"] == 1
    rows = list_user_global_artist_follows(1)
    assert len(rows) == 1
    assert rows[0]["created_at"] is not None
    assert {key: value for key, value in rows[0].items() if key != "created_at"} == {
        "global_artist_uid": None,
        "artist_name": "Historical Artist",
        "artist_id": None,
        "artist_entity_uid": None,
        "artist_slug": None,
        "album_count": 0,
        "track_count": 0,
        "has_photo": False,
        "photo_url": None,
    }


def test_legacy_library_writes_project_canonical_refs_without_waiting_for_backfill(
    pg_db,
):
    from crate.db.repositories.global_user_library import (
        get_user_global_library_counts,
    )
    from crate.db.repositories.user_library_preferences import follow_artist, save_album
    from crate.db.tx import transaction_scope

    artist_uid, album_uid = _seed_global_artist_and_album(pg_db)
    with transaction_scope() as session:
        album_id = int(
            session.execute(
                text("SELECT id FROM library_albums WHERE name = 'Blending' LIMIT 1")
            ).scalar_one()
        )

    assert follow_artist(1, "High Vis") is True
    assert save_album(1, album_id) is True

    with transaction_scope() as session:
        assert (
            session.execute(
                text(
                    """
                SELECT global_artist_uid::text
                FROM user_global_artist_follows
                WHERE user_id = 1
                """
                )
            ).scalar_one()
            == artist_uid
        )
        assert (
            session.execute(
                text(
                    """
                SELECT global_album_uid::text
                FROM user_global_album_saves
                WHERE user_id = 1
                """
                )
            ).scalar_one()
            == album_uid
        )
    assert get_user_global_library_counts(1) == {
        "followed_artists": 1,
        "saved_albums": 1,
        "liked_tracks": 0,
        "playlists": 0,
    }


def test_new_local_play_events_resolve_their_canonical_track_ref(pg_db, monkeypatch):
    from crate.db.repositories.user_library_playback_writes import record_play_event
    from crate.db.tx import transaction_scope

    artist_uid, album_uid = _seed_global_artist_and_album(pg_db)
    track_uid = str(uuid.uuid4())
    track_entity_uid = str(uuid.uuid4())
    pg_db.upsert_track(
        {
            "artist": "High Vis",
            "album": "Blending",
            "filename": "01 - Trauma Bonds.flac",
            "title": "Trauma Bonds",
            "path": "/music/High Vis/Blending/01 - Trauma Bonds.flac",
            "entity_uid": track_entity_uid,
            "duration": 180,
        }
    )
    with transaction_scope() as session:
        track_id = int(
            session.execute(
                text(
                    """
                    SELECT id FROM library_tracks
                    WHERE entity_uid = CAST(:track_entity_uid AS uuid)
                    """
                ),
                {"track_entity_uid": track_entity_uid},
            ).scalar_one()
        )
        session.execute(
            text(
                """
                INSERT INTO global_catalog_tracks (
                    global_track_uid, global_album_uid, global_artist_uid,
                    canonical_title, normalized_title, artist_name, album_name,
                    duration_seconds, local_track_id, local_track_entity_uid,
                    has_local, has_remote
                ) VALUES (
                    :track_uid, :album_uid, :artist_uid,
                    'Trauma Bonds', 'trauma bonds', 'High Vis', 'Blending',
                    180, :track_id, CAST(:track_entity_uid AS uuid), true, false
                )
                """
            ),
            {
                "track_uid": track_uid,
                "album_uid": album_uid,
                "artist_uid": artist_uid,
                "track_id": track_id,
                "track_entity_uid": track_entity_uid,
            },
        )
    monkeypatch.setattr(
        "crate.db.repositories.user_library_playback_writes._schedule_play_event_followups",
        lambda *_args, **_kwargs: None,
    )

    record_play_event(
        1,
        track_id=track_id,
        title="Trauma Bonds",
        artist="High Vis",
        album="Blending",
        started_at="2026-07-13T10:00:00+00:00",
        ended_at="2026-07-13T10:03:00+00:00",
        played_seconds=180,
        was_completed=True,
    )

    with transaction_scope() as session:
        assert (
            session.execute(
                text("SELECT global_track_uid::text FROM user_play_events")
            ).scalar_one()
            == track_uid
        )


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
    from crate.db.queries.user_library_library import (
        get_followed_artists,
        get_saved_albums,
        get_user_library_counts,
        is_following,
    )
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

    legacy_route_counts = get_user_library_counts(1)
    assert legacy_route_counts["followed_artists"] == 2
    assert legacy_route_counts["saved_albums"] == 2
    assert is_following(1, "Rival Schools") is True

    artists = list_user_global_artist_follows(1)
    albums = list_user_global_album_saves(1)
    assert {artist["artist_name"] for artist in get_followed_artists(1)} == {
        "High Vis",
        "Rival Schools",
    }
    assert {album["name"] for album in get_saved_albums(1)} == {
        "Blending",
        "Pedals",
    }
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
