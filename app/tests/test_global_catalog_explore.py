import json
import uuid

import pytest
from sqlalchemy import text

import crate.db.queries.genres_library_detail as genres_library_detail
from tests.conftest import approve_federation_node, PG_AVAILABLE


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows


class _FakeSession:
    def execute(self, query, params):
        sql = str(query)
        if "FROM global_catalog_artists" in sql:
            return _Rows(
                [
                    {
                        "artist_name": "High Vis",
                        "artist_id": 7,
                        "global_artist_uid": "global-high-vis",
                        "artist_entity_uid": "local-high-vis",
                        "artist_slug": "high-vis",
                        "album_count": 2,
                        "track_count": 20,
                        "has_photo": True,
                        "listeners": 0,
                        "photo_url": "/api/catalog/artists/global-high-vis/photo",
                        "membership_score": 0.65,
                        "membership_tier": "adjacent",
                    },
                    {
                        "artist_name": "Rival Schools",
                        "artist_id": None,
                        "global_artist_uid": "global-rival-schools",
                        "artist_entity_uid": None,
                        "artist_slug": None,
                        "album_count": 1,
                        "track_count": 12,
                        "has_photo": True,
                        "listeners": 0,
                        "photo_url": "/api/catalog/artists/global-rival-schools/photo",
                        "membership_score": 0.65,
                        "membership_tier": "adjacent",
                    },
                ]
            )
        return _Rows(
            [
                {
                    "album_id": None,
                    "global_album_uid": "global-pedals",
                    "global_artist_uid": "global-rival-schools",
                    "album_entity_uid": None,
                    "album_slug": None,
                    "artist": "Rival Schools",
                    "artist_id": None,
                    "artist_entity_uid": None,
                    "artist_slug": None,
                    "name": "Pedals",
                    "year": "2011",
                    "track_count": 12,
                    "has_cover": True,
                    "cover_url": "/api/catalog/albums/global-pedals/cover",
                    "weight": 0.65,
                    "membership_score": 0.65,
                    "membership_tier": "adjacent",
                    "direct_genre_match": False,
                }
            ]
        )


def test_global_genre_augment_adds_global_entities_and_dedupes():
    genre = {
        "name": "Post-hardcore",
        "canonical_slug": "post-hardcore",
        "artists": [
            {
                "artist_name": "High Vis",
                "artist_id": 7,
                "album_count": 2,
                "track_count": 20,
                "has_photo": True,
                "listeners": 100,
            }
        ],
        "albums": [],
    }

    genres_library_detail._augment_global_genre_entities(_FakeSession(), genre)

    assert [artist["artist_name"] for artist in genre["artists"]] == [
        "High Vis",
        "Rival Schools",
    ]
    assert genre["artists"][1]["global_artist_uid"] == "global-rival-schools"
    assert genre["albums"][0]["global_album_uid"] == "global-pedals"


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_remote_only_genre_detail_resolves_global_entities(pg_db, monkeypatch):
    from crate.db.tx import transaction_scope
    from crate.federation.global_reconciliation import reconcile_remote_catalog

    node_uid = str(uuid.uuid4())
    artist_uid = str(uuid.uuid4())
    album_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        approve_federation_node(session, node_uid)
        for item in [
            {
                "remote_entity_uid": artist_uid,
                "entity_type": "artist",
                "title": "High Vis",
                "artist": None,
                "album": None,
                "year": None,
                "track_count": None,
                "raw_json": {
                    "genres": ["post-punk"],
                    "has_photo": True,
                    "facets": {"artist_photo": {"available": True}},
                },
            },
            {
                "remote_entity_uid": album_uid,
                "entity_type": "album",
                "title": "Guided Tour",
                "artist": "High Vis",
                "album": None,
                "year": "2024",
                "track_count": 11,
                "raw_json": {
                    "genres": ["post-punk"],
                    "has_cover": True,
                    "facets": {"album_artwork": {"available": True}},
                },
            },
        ]:
            session.execute(
                text(
                    """
                    INSERT INTO federation_catalog_items
                        (
                            node_uid,
                            remote_entity_uid,
                            entity_type,
                            title,
                            artist,
                            album,
                            year,
                            track_count,
                            remote_revision,
                            availability_json,
                            raw_json
                        )
                    VALUES
                        (
                            :node_uid,
                            :remote_entity_uid,
                            :entity_type,
                            :title,
                            :artist,
                            :album,
                            :year,
                            :track_count,
                            'rev-1',
                            :availability_json,
                            :raw_json
                        )
                    """
                ),
                {
                    "node_uid": node_uid,
                    "remote_entity_uid": item["remote_entity_uid"],
                    "entity_type": item["entity_type"],
                    "title": item["title"],
                    "artist": item["artist"],
                    "album": item["album"],
                    "year": item["year"],
                    "track_count": item["track_count"],
                    "availability_json": json.dumps({"catalog": True}),
                    "raw_json": json.dumps(item["raw_json"]),
                },
            )

    reconcile_remote_catalog()

    detail = genres_library_detail.get_genre_detail("post-punk")

    assert detail is not None
    assert detail["name"] == "post-punk"
    assert detail["artist_count"] == 1
    assert detail["album_count"] == 1
    assert detail["artists"][0]["artist_name"] == "High Vis"
    assert detail["albums"][0]["name"] == "Guided Tour"
    assert detail["albums"][0]["global_album_uid"]
