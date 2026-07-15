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
