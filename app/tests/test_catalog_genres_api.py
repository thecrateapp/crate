import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_global_genre_surfaces_rank_members_by_score_and_share_top_artwork(pg_db):
    from crate.db.queries.global_catalog import (
        get_global_genre_detail,
        list_global_catalog_genres,
    )
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources

    pg_db.upsert_artist(
        {
            "name": "BLOCKHEADS",
            "entity_uid": "a830063d-44e2-56a4-a0d8-1918026587f7",
            "has_photo": 1,
            "listeners": 34_347,
        }
    )
    pg_db.upsert_artist(
        {
            "name": "Death",
            "entity_uid": "12f95d32-ccbb-58a2-b004-79b88ef7389b",
            "has_photo": 1,
            "listeners": 1_031_836,
        }
    )
    pg_db.set_artist_genres("BLOCKHEADS", [("death metal", 0.76, "test")])
    pg_db.set_artist_genres("Death", [("death metal", 1.0, "test")])
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 2

    detail = get_global_genre_detail("death-metal")
    summary = next(
        item
        for item in list_global_catalog_genres()
        if item["canonical_slug"] == "death-metal"
    )

    assert [artist["artist_name"] for artist in detail["artists"][:2]] == [
        "Death",
        "BLOCKHEADS",
    ]
    assert detail["artists"][0]["aggregate_score"] == 1.0
    assert detail["artists"][1]["aggregate_score"] == 0.76
    assert summary["top_artists"][:2] == ["Death", "BLOCKHEADS"]
    assert summary["top_artist_global_uid"] == detail["artists"][0]["global_artist_uid"]
    assert summary["cover_url"] == (
        f"/api/catalog/artists/{detail['artists'][0]['global_artist_uid']}"
        "/background?size=640&format=webp"
    )


def test_global_genre_summary_prefers_curated_cover_over_top_artist(pg_db):
    from crate.db.queries.global_catalog import list_global_catalog_genres
    from crate.db.tx import transaction_scope
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources

    pg_db.upsert_artist(
        {
            "name": "Covered Genre Artist",
            "entity_uid": str(uuid.uuid4()),
            "has_photo": 1,
        }
    )
    pg_db.set_artist_genres(
        "Covered Genre Artist",
        [("post-hardcore", 1.0, "test")],
    )
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 1
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE genre_taxonomy_nodes
                SET cover_path = 'post-hardcore.webp'
                WHERE taxonomy_id = 'crate-core'
                  AND slug = 'post-hardcore'
                """
            )
        )

    summary = next(
        item
        for item in list_global_catalog_genres()
        if item["canonical_slug"] == "post-hardcore"
    )

    assert summary["top_artists"] == ["Covered Genre Artist"]
    assert summary["cover_url"] == (
        "/api/genres/post-hardcore/cover?size=640&format=webp"
    )


def test_global_genre_detail_ranks_albums_by_membership_not_uuid(pg_db):
    from crate.db.queries.global_catalog import get_global_genre_detail
    from crate.db.tx import read_scope
    from crate.federation.global_reconciliation import reconcile_dirty_catalog_sources

    pg_db.upsert_artist(
        {
            "name": "Album Rank Artist",
            "entity_uid": str(uuid.uuid4()),
        }
    )
    album_ids = [
        pg_db.upsert_album(
            {
                "artist": "Album Rank Artist",
                "name": name,
                "entity_uid": str(uuid.uuid4()),
                "path": f"/music/Album Rank Artist/{name}",
            }
        )
        for name in ("Lower Membership", "Full Membership")
    ]
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 3
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT local_album_id, global_album_uid::text AS global_album_uid
                    FROM global_catalog_albums
                    WHERE local_album_id = ANY(:album_ids)
                    ORDER BY global_album_uid
                    """
                ),
                {"album_ids": album_ids},
            )
            .mappings()
            .all()
        )
    album_name_by_id = dict(zip(album_ids, ("Lower Membership", "Full Membership")))
    uuid_first_id = int(rows[0]["local_album_id"])
    uuid_last_id = int(rows[1]["local_album_id"])
    pg_db.set_album_genres(uuid_first_id, [("death metal", 0.70, "test")])
    pg_db.set_album_genres(uuid_last_id, [("death metal", 1.0, "test")])
    assert reconcile_dirty_catalog_sources(limit=10)["completed"] == 2

    detail = get_global_genre_detail("death-metal")
    ranked = [
        album
        for album in detail["albums"]
        if album["album_id"] in {uuid_first_id, uuid_last_id}
    ]

    assert [album["name"] for album in ranked] == [
        album_name_by_id[uuid_last_id],
        album_name_by_id[uuid_first_id],
    ]
    assert [album["aggregate_score"] for album in ranked] == [1.0, 0.7]


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
