from __future__ import annotations

import importlib.util
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _migration_module():
    path = (
        Path(__file__).resolve().parents[1]
        / "crate/db/migrations/versions/098_user_media_preferences.py"
    )
    assert path.is_file(), "migration 098 is missing"
    spec = importlib.util.spec_from_file_location("user_media_preferences_098", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_favorites_are_scoped_to_the_owner_and_idempotent(pg_db):
    from crate.db.queries.browse_media_favorites import list_favorites
    from crate.db.repositories.browse_media_favorites import (
        add_favorite,
        remove_favorite,
    )

    first_user = pg_db.create_user("preferences-first@test.com")
    second_user = pg_db.create_user("preferences-second@test.com")
    created_at = "2026-09-16T10:00:00Z"

    add_favorite(first_user["id"], "artist", "ga-111", created_at)
    add_favorite(first_user["id"], "artist", "ga-111", created_at)
    add_favorite(second_user["id"], "artist", "ga-111", created_at)

    first_favorites = list_favorites(first_user["id"])
    assert len(first_favorites) == 1
    assert (first_favorites[0]["item_type"], first_favorites[0]["item_id"]) == (
        "artist",
        "ga-111",
    )
    assert len(list_favorites(second_user["id"])) == 1

    remove_favorite(first_user["id"], "artist", "ga-111")
    assert list_favorites(first_user["id"]) == []
    assert len(list_favorites(second_user["id"])) == 1


def test_stars_round_trip_for_listen_and_open_subsonic(pg_db):
    from crate.subsonic.services.preferences import get_starred, star, unstar

    first_user = pg_db.create_user("stars-first@test.com")
    second_user = pg_db.create_user("stars-second@test.com")
    artist_name = "Shared Star Artist"
    pg_db.upsert_artist({"name": artist_name, "has_photo": 1})
    album_id = pg_db.upsert_album(
        {
            "artist": artist_name,
            "name": "Shared Star Album",
            "path": "/music/Shared Star Artist/Shared Star Album",
            "track_count": 1,
            "has_cover": 1,
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": artist_name,
            "album": "Shared Star Album",
            "filename": "01 Song.flac",
            "title": "Song",
            "path": "/music/Shared Star Artist/Shared Star Album/01 Song.flac",
            "duration": 180,
        }
    )
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        artist_id = int(
            session.execute(
                text("SELECT id FROM library_artists WHERE name = :name"),
                {"name": artist_name},
            ).scalar_one()
        )
        track_id = int(
            session.execute(
                text("SELECT id FROM library_tracks WHERE path = :path"),
                {"path": "/music/Shared Star Artist/Shared Star Album/01 Song.flac"},
            ).scalar_one()
        )

    references = (
        ("artist", f"ar-{artist_id}"),
        ("album", f"al-{album_id}"),
        ("song", str(track_id)),
    )
    for kind, identifier in references:
        assert star(first_user["id"], kind, identifier) is True
        assert star(first_user["id"], kind, identifier) is False
    assert star(second_user["id"], "artist", f"ar-{artist_id}") is True

    first_starred = get_starred(first_user["id"])
    assert first_starred["artist"][0]["id"] == f"ar-{artist_id}"
    assert first_starred["album"][0]["id"] == f"al-{album_id}"
    assert first_starred["song"][0]["id"] == str(track_id)
    assert first_starred["song"][0]["coverArt"] == f"al-{album_id}"
    assert get_starred(second_user["id"])["artist"][0]["id"] == f"ar-{artist_id}"

    assert unstar(first_user["id"], "artist", f"ar-{artist_id}") is True
    assert unstar(first_user["id"], "artist", f"ar-{artist_id}") is False
    assert get_starred(first_user["id"])["artist"] == []
    assert len(get_starred(second_user["id"])["artist"]) == 1


def test_track_ratings_are_per_user_and_never_mutate_library_metadata(pg_db):
    from crate.db.repositories.user_media_preferences import (
        get_track_rating,
        set_track_rating,
    )
    from crate.db.tx import transaction_scope

    first_user = pg_db.create_user("rating-first@test.com")
    second_user = pg_db.create_user("rating-second@test.com")
    pg_db.upsert_artist({"name": "Rating Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Rating Artist",
            "name": "Rating Album",
            "path": "/music/Rating Artist/Rating Album",
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Rating Artist",
            "album": "Rating Album",
            "filename": "01 Track.flac",
            "title": "Track",
            "path": "/music/Rating Artist/Rating Album/01 Track.flac",
            "duration": 180,
        }
    )
    with transaction_scope() as session:
        track_id = int(
            session.execute(
                text("SELECT id FROM library_tracks WHERE path = :path"),
                {"path": "/music/Rating Artist/Rating Album/01 Track.flac"},
            ).scalar_one()
        )
        session.execute(
            text("UPDATE library_tracks SET rating = 4 WHERE id = :track_id"),
            {"track_id": track_id},
        )

    set_track_rating(first_user["id"], track_id, 2)
    set_track_rating(second_user["id"], track_id, 5)
    assert get_track_rating(first_user["id"], track_id) == 2
    assert get_track_rating(second_user["id"], track_id) == 5

    set_track_rating(first_user["id"], track_id, 0)
    assert get_track_rating(first_user["id"], track_id) == 0
    with transaction_scope() as session:
        assert (
            session.execute(
                text("SELECT rating FROM library_tracks WHERE id = :track_id"),
                {"track_id": track_id},
            ).scalar_one()
            == 4
        )


def test_favorite_owner_backfill_is_deterministic_and_preserves_known_owners(pg_db):
    migration = _migration_module()
    from crate.db.tx import transaction_scope

    legacy_user = pg_db.create_user("legacy-preferences@test.com")
    with transaction_scope() as session:
        session.execute(
            text("ALTER TABLE favorites ALTER COLUMN user_id DROP NOT NULL")
        )
        session.execute(
            text(
                "INSERT INTO favorites (item_type, item_id, user_id, created_at) "
                "VALUES ('artist', 'owned', :user_id, NOW()), "
                "('artist', 'legacy', NULL, NOW())"
            ),
            {"user_id": legacy_user["id"]},
        )
        owner_id = migration.backfill_legacy_favorite_owners(session)
        rows = (
            session.execute(
                text("SELECT item_id, user_id FROM favorites ORDER BY item_id")
            )
            .mappings()
            .all()
        )

    assert owner_id == 1  # seeded admin is the deterministic legacy owner
    assert [(row["item_id"], row["user_id"]) for row in rows] == [
        ("legacy", 1),
        ("owned", legacy_user["id"]),
    ]


def test_native_and_subsonic_ratings_share_per_user_value(pg_db):
    from crate.subsonic.services.preferences import (
        get_rating,
        set_native_track_rating,
        set_rating,
    )
    from crate.db.tx import transaction_scope

    user = pg_db.create_user("shared-rating@test.com")
    pg_db.upsert_artist({"name": "Shared Rating Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Shared Rating Artist",
            "name": "Shared Rating Album",
            "path": "/music/Shared Rating Artist/Shared Rating Album",
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Shared Rating Artist",
            "album": "Shared Rating Album",
            "filename": "01 Rated.flac",
            "title": "Rated",
            "path": "/music/Shared Rating Artist/Shared Rating Album/01 Rated.flac",
            "duration": 180,
        }
    )
    with transaction_scope() as session:
        track_id = int(
            session.execute(
                text("SELECT id FROM library_tracks WHERE path = :path"),
                {
                    "path": "/music/Shared Rating Artist/Shared Rating Album/01 Rated.flac"
                },
            ).scalar_one()
        )

    assert set_rating(user["id"], str(track_id), 4) is True
    assert get_rating(user["id"], track_id) == 4
    assert set_native_track_rating(user["id"], track_id, 2) is True
    assert get_rating(user["id"], track_id) == 2


def test_rating_migrates_from_local_to_global_identity_without_duplicates(pg_db):
    from crate.db.repositories.user_media_preferences import set_track_rating
    from crate.db.tx import transaction_scope

    user = pg_db.create_user("rating-identity@test.com")
    artist_name = f"Rating Identity {uuid.uuid4()}"
    pg_db.upsert_artist({"name": artist_name})
    album_id = pg_db.upsert_album(
        {
            "artist": artist_name,
            "name": "Identity Album",
            "path": f"/music/{artist_name}/Identity Album",
        }
    )
    track_path = f"/music/{artist_name}/Identity Album/01 Track.flac"
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": artist_name,
            "album": "Identity Album",
            "filename": "01 Track.flac",
            "title": "Track",
            "path": track_path,
            "duration": 180,
        }
    )
    global_artist_uid = str(uuid.uuid4())
    global_track_uid = str(uuid.uuid4())

    with transaction_scope() as session:
        track_id = int(
            session.execute(
                text("SELECT id FROM library_tracks WHERE path = :path"),
                {"path": track_path},
            ).scalar_one()
        )
        session.execute(
            text(
                "INSERT INTO global_catalog_artists "
                "(global_artist_uid, canonical_name, sort_name, normalized_name) "
                "VALUES (CAST(:uid AS uuid), :name, :name, :name)"
            ),
            {"uid": global_artist_uid, "name": artist_name},
        )
        session.execute(
            text(
                "INSERT INTO user_track_ratings (user_id, track_id, rating) "
                "VALUES (:user_id, :track_id, 3)"
            ),
            {"user_id": user["id"], "track_id": track_id},
        )
        session.execute(
            text(
                "INSERT INTO global_catalog_tracks "
                "(global_track_uid, global_artist_uid, canonical_title, "
                "normalized_title, artist_name, local_track_id) VALUES "
                "(CAST(:track_uid AS uuid), CAST(:artist_uid AS uuid), 'Track', "
                "'track', :artist, :track_id)"
            ),
            {
                "track_uid": global_track_uid,
                "artist_uid": global_artist_uid,
                "artist": artist_name,
                "track_id": track_id,
            },
        )

    assert (
        set_track_rating(user["id"], track_id, 5, global_track_uid=global_track_uid)
        is True
    )
    with transaction_scope() as session:
        ratings = (
            session.execute(
                text(
                    "SELECT rating, global_track_uid::text FROM user_track_ratings "
                    "WHERE user_id = :user_id AND track_id = :track_id"
                ),
                {"user_id": user["id"], "track_id": track_id},
            )
            .mappings()
            .all()
        )

    assert [(row["rating"], row["global_track_uid"]) for row in ratings] == [
        (5, global_track_uid)
    ]
