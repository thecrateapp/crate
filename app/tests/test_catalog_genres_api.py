import uuid

import pytest

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_global_genre_detail_expands_core_parent_hierarchy_at_read_time(pg_db):
    from crate.db.queries.global_catalog import (
        get_global_genre_detail,
        list_global_catalog_genres,
    )
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources
    from crate.genre_taxonomy import core_genre_uid

    pg_db.upsert_artist({"name": "Hierarchy Artist", "entity_uid": str(uuid.uuid4())})
    pg_db.set_artist_genres("Hierarchy Artist", [("hardcore", 1.0, "test")])
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 1

    listed = list_global_catalog_genres()
    punk = next(item for item in listed if item["canonical_slug"] == "punk")
    detail = get_global_genre_detail("punk")

    assert punk["global_genre_uid"] == core_genre_uid("punk")
    assert punk["entity_count"] == 1
    assert detail["taxonomy"]["id"] == "crate-core"
    assert detail["artists"][0]["artist_name"] == "Hierarchy Artist"
    assert detail["artists"][0]["membership"] == "inherited"
    assert detail["artists"][0]["supporting_source_count"] == 1


def test_global_genre_detail_resolves_library_alias_to_canonical_genre(pg_db):
    from crate.db.queries.global_catalog import get_global_genre_detail
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources
    from crate.genre_taxonomy import core_genre_uid

    pg_db.upsert_artist({"name": "Alias Genre Artist", "entity_uid": str(uuid.uuid4())})
    pg_db.set_artist_genres("Alias Genre Artist", [("hardcore", 1.0, "test")])
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 1

    detail = get_global_genre_detail("hardcore")

    assert detail is not None
    assert detail["global_genre_uid"] == core_genre_uid("hardcore-punk")
    assert detail["canonical_slug"] == "hardcore-punk"
    assert detail["artists"][0]["artist_name"] == "Alias Genre Artist"


def test_global_genre_detail_keeps_visual_metadata_for_global_members(pg_db):
    from crate.db.queries.global_catalog import get_global_genre_detail
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources

    for name, genre in (
        ("Post Hardcore Visual Artist", "post-hardcore"),
        ("Emo Visual Artist", "emo"),
    ):
        pg_db.upsert_artist(
            {
                "name": name,
                "entity_uid": str(uuid.uuid4()),
                "has_photo": 1,
            }
        )
        pg_db.set_artist_genres(name, [(genre, 1.0, "test")])
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 2

    detail = get_global_genre_detail("post-hardcore")

    assert detail is not None
    assert detail["description"]
    assert any(
        artist["artist_name"] == "Post Hardcore Visual Artist"
        for artist in detail["artists"]
    )
    assert detail["cover_url"] is None

    emo = next(item for item in detail["related_genres"] if item["slug"] == "emo")
    assert emo["artist_count"] == 1
    assert emo["content_score"] == 3
    assert emo["cover_url"] is None
    assert emo["top_artist_global_uid"]
    assert emo["top_artist_id"] is not None
    assert emo["top_artist_photo_url"].startswith("/api/catalog/artists/")
    assert emo["top_artist_photo_url"].endswith("/photo?size=640&format=webp")
    assert all(item["content_score"] > 0 for item in detail["related_genres"])


def test_global_track_genre_reports_direct_memberships(pg_db):
    from crate.db.queries.global_catalog import get_global_track_genres
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources
    from crate.genre_taxonomy import core_genre_uid

    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    track_uid = str(uuid.uuid4())
    pg_db.upsert_artist({"name": "Track Genre Artist", "entity_uid": artist_uid})
    album_id = pg_db.upsert_album(
        {
            "artist": "Track Genre Artist",
            "name": "Track Genre Album",
            "entity_uid": album_uid,
            "path": "/music/Track Genre Artist/Track Genre Album",
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Track Genre Artist",
            "album": "Track Genre Album",
            "title": "Genre Track",
            "filename": "01-genre.flac",
            "entity_uid": track_uid,
            "path": "/music/Track Genre Artist/Track Genre Album/01-genre.flac",
            "genre": "hardcore",
        }
    )
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 3

    genres = get_global_track_genres(track_uid)

    assert genres["taxonomy"]["id"] == "crate-core"
    assert genres["genres"] == [
        {
            "global_genre_uid": core_genre_uid("hardcore-punk"),
            "canonical_slug": "hardcore-punk",
            "membership": "direct",
            "supporting_source_count": 1,
        }
    ]
