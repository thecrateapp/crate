"""Tests for genres query modules."""

import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


class TestGenresShared:
    def test_invalid_genre_taxonomy_reason_none(self):
        from crate.db.queries.genres_shared import invalid_genre_taxonomy_reason

        assert invalid_genre_taxonomy_reason("") is None
        assert invalid_genre_taxonomy_reason(None) is None
        assert invalid_genre_taxonomy_reason("post-punk") is None

    def test_invalid_genre_taxonomy_reason_wikidata(self):
        from crate.db.queries.genres_shared import invalid_genre_taxonomy_reason

        assert invalid_genre_taxonomy_reason("wikidata") == "external-section-marker"
        assert (
            invalid_genre_taxonomy_reason("other-databases")
            == "external-section-marker"
        )

    def test_invalid_genre_taxonomy_reason_external_url(self):
        from crate.db.queries.genres_shared import invalid_genre_taxonomy_reason

        assert invalid_genre_taxonomy_reason("http-something") == "external-url"
        assert invalid_genre_taxonomy_reason("https-something") == "external-url"

    def test_invalid_genre_taxonomy_reason_wikidata_id(self):
        from crate.db.queries.genres_shared import invalid_genre_taxonomy_reason

        assert invalid_genre_taxonomy_reason("q123") == "wikidata-entity-id"

    def test_annotate_genre_mapping_mapped(self):
        from crate.db.queries.genres_shared import annotate_genre_mapping

        items = [{"slug": "post-punk", "canonical_slug": "post-punk"}]
        result = annotate_genre_mapping(items)
        assert result[0]["mapped"] is True
        assert result[0]["top_level_name"] is not None

    def test_annotate_genre_mapping_unmapped(self):
        from crate.db.queries.genres_shared import annotate_genre_mapping

        items = [{"slug": "unknown-genre-xyz", "canonical_slug": None}]
        result = annotate_genre_mapping(items)
        assert result[0]["mapped"] is False
        assert result[0]["top_level_name"] is None

    def test_annotate_eq_preset_with_gains(self):
        from crate.db.queries.genres_shared import annotate_eq_preset

        item = {
            "canonical_slug": "post-punk",
            "canonical_eq_gains": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0],
        }
        annotate_eq_preset(item)
        assert item["eq_gains"] == [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
        assert "eq_preset_resolved" in item
        assert "canonical_eq_gains" not in item

    def test_annotate_eq_preset_without_gains(self):
        from crate.db.queries.genres_shared import annotate_eq_preset

        item = {"canonical_slug": "post-punk", "canonical_eq_gains": None}
        annotate_eq_preset(item)
        assert item["eq_gains"] is None
        assert item["eq_preset_resolved"] is not None

    def test_get_genre_summary_by_slug_not_found(self, pg_db):
        from crate.db.queries.genres_shared import get_genre_summary_by_slug
        from crate.db.tx import read_scope

        with read_scope() as session:
            assert get_genre_summary_by_slug(session, "nonexistent-genre-xyz") is None

    def test_get_genre_summary_by_slug_found(self, pg_db):
        from crate.db.queries.genres_shared import get_genre_summary_by_slug
        from crate.db.tx import read_scope, transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO genres (name, slug) VALUES ('test-genre', 'test-genre') ON CONFLICT DO NOTHING"
                )
            )

        with read_scope() as session:
            result = get_genre_summary_by_slug(session, "test-genre")
            assert result is not None
            assert result["slug"] == "test-genre"

    def test_get_taxonomy_node_stats_empty_slugs(self, pg_db):
        from crate.db.queries.genres_shared import get_taxonomy_node_stats
        from crate.db.tx import read_scope

        with read_scope() as session:
            assert get_taxonomy_node_stats(session, []) == {}

    def test_get_taxonomy_node_stats_with_slugs(self, pg_db):
        from crate.db.queries.genres_shared import get_taxonomy_node_stats
        from crate.db.tx import read_scope

        with read_scope() as session:
            stats = get_taxonomy_node_stats(session, ["post-punk"])
            assert "post-punk" in stats
            assert "post-punk" in stats
            assert stats["post-punk"]["slug"] == "post-punk"

    def test_get_taxonomy_node_stats_unknown_slug_gets_fallback(self, pg_db):
        from crate.db.queries.genres_shared import get_taxonomy_node_stats
        from crate.db.tx import read_scope

        with read_scope() as session:
            stats = get_taxonomy_node_stats(session, ["nonexistent-genre-333"])
            assert "nonexistent-genre-333" in stats
            assert stats["nonexistent-genre-333"]["artist_count"] == 0


class TestGenresGraphRelated:
    def _setup_genre_data(self, pg_db):
        pg_db.upsert_artist({"name": "Genre Graph Artist"})
        pg_db.set_artist_genres("Genre Graph Artist", [("post-punk", 0.9, "test")])
        album_id = pg_db.upsert_album(
            {
                "artist": "Genre Graph Artist",
                "name": "Genre Graph Album",
                "path": "/music/Genre Graph Artist/Genre Graph Album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        with transaction_scope() as session:
            row = (
                session.execute(text("SELECT id FROM genres WHERE slug = 'post-punk'"))
                .mappings()
                .first()
            )
            genre_id = row["id"]
            session.execute(
                text(
                    "INSERT INTO album_genres (album_id, genre_id, weight) VALUES (:aid, :gid, :w)"
                ),
                {"aid": album_id, "gid": genre_id, "w": 0.8},
            )

    def test_get_genre_seed_artists_not_found(self, pg_db):
        from crate.db.queries.genres_graph_related import get_genre_seed_artists

        assert get_genre_seed_artists("nonexistent-genre-zzz") == []

    def test_get_genre_seed_artists_found(self, pg_db):
        from crate.db.queries.genres_graph_related import get_genre_seed_artists

        self._setup_genre_data(pg_db)
        artists = get_genre_seed_artists("post-punk")
        assert len(artists) >= 1
        assert "Genre Graph Artist" in [a["artist_name"] for a in artists]

    def test_get_genre_cooccurring_artist_slugs(self, pg_db):
        from crate.db.queries.genres_graph_related import (
            get_genre_cooccurring_artist_slugs,
        )

        self._setup_genre_data(pg_db)
        results = get_genre_cooccurring_artist_slugs("post-punk")
        assert isinstance(results, list)

    def test_get_genre_cooccurring_album_slugs(self, pg_db):
        from crate.db.queries.genres_graph_related import (
            get_genre_cooccurring_album_slugs,
        )

        self._setup_genre_data(pg_db)
        results = get_genre_cooccurring_album_slugs("post-punk")
        assert isinstance(results, list)


class TestGenresLibraryDetail:
    def _setup_genre_library_data(self, pg_db):
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "Detail Artist"})
        pg_db.set_artist_genres("Detail Artist", [("post-punk", 0.9, "test")])
        album_id = pg_db.upsert_album(
            {
                "artist": "Detail Artist",
                "name": "Detail Album",
                "path": "/music/Detail Artist/Detail Album",
                "track_count": 1,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        with transaction_scope() as session:
            row = (
                session.execute(text("SELECT id FROM genres WHERE slug = 'post-punk'"))
                .mappings()
                .first()
            )
            genre_id = row["id"]
            session.execute(
                text(
                    "INSERT INTO album_genres (album_id, genre_id, weight) VALUES (:aid, :gid, :w)"
                ),
                {"aid": album_id, "gid": genre_id, "w": 0.8},
            )
        return album_id

    def test_get_genre_detail_not_found(self, pg_db):
        from crate.db.queries.genres_library_detail import get_genre_detail

        assert get_genre_detail("nonexistent-genre-abc") is None

    def test_get_genre_detail_found(self, pg_db):
        from crate.db.queries.genres_library_detail import get_genre_detail

        self._setup_genre_library_data(pg_db)
        result = get_genre_detail("post-punk")
        assert result is not None
        assert result["slug"] == "post-punk"
        assert "artists" in result
        assert "albums" in result

    def test_get_genre_detail_with_artists(self, pg_db):
        from crate.db.queries.genres_library_detail import get_genre_detail

        self._setup_genre_library_data(pg_db)
        result = get_genre_detail("post-punk")
        assert len(result["artists"]) >= 1
        assert result["artists"][0]["artist_name"] == "Detail Artist"

    def test_get_artists_with_tags_empty(self, pg_db):
        from crate.db.queries.genres_library_detail import get_artists_with_tags

        result = get_artists_with_tags()
        assert isinstance(result, list)

    def test_get_artists_with_tags_with_data(self, pg_db):
        from crate.db.queries.genres_library_detail import get_artists_with_tags
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        pg_db.upsert_artist({"name": "Tagged Artist"})
        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE library_artists SET tags_json = :tags WHERE name = 'Tagged Artist'"
                ),
                {"tags": '["punk", "noise"]'},
            )

        result = get_artists_with_tags()
        assert any(r["name"] == "Tagged Artist" for r in result)

    def test_get_albums_with_genres_empty(self, pg_db):
        from crate.db.queries.genres_library_detail import get_albums_with_genres

        result = get_albums_with_genres()
        assert isinstance(result, list)

    def test_get_albums_with_genres_with_data(self, pg_db):
        from crate.db.queries.genres_library_detail import get_albums_with_genres

        self._setup_genre_library_data(pg_db)
        result = get_albums_with_genres()
        assert any(r["name"] == "Detail Album" for r in result)

    def test_get_artists_missing_genre_mapping(self, pg_db):
        from crate.db.queries.genres_library_detail import (
            get_artists_missing_genre_mapping,
        )

        result = get_artists_missing_genre_mapping()
        assert isinstance(result, list)

    def test_get_artist_album_genres_not_found(self, pg_db):
        from crate.db.queries.genres_library_detail import get_artist_album_genres

        assert get_artist_album_genres("Nobody Artist 999") == []

    def test_get_artist_album_genres_with_data(self, pg_db):
        from crate.db.queries.genres_library_detail import get_artist_album_genres

        self._setup_genre_library_data(pg_db)
        result = get_artist_album_genres("Detail Artist")
        assert len(result) >= 1
        assert result[0]["name"].lower() == "post-punk"


class TestGenresTaxonomyGraph:
    def test_load_genre_graph_edge_rows_with_data(self, pg_db):
        from crate.db.queries.genres_taxonomy_graph_edges import (
            load_genre_graph_edge_rows,
        )
        from crate.db.tx import read_scope

        with read_scope() as session:
            edges = load_genre_graph_edge_rows(session, "post-punk")
            assert isinstance(edges, list)

    def test_load_genre_graph_edge_rows_unknown_slug(self, pg_db):
        from crate.db.queries.genres_taxonomy_graph_edges import (
            load_genre_graph_edge_rows,
        )
        from crate.db.tx import read_scope

        with read_scope() as session:
            edges = load_genre_graph_edge_rows(session, "nonexistent-slug-999")
            assert edges == []

    def test_build_genre_graph_payload_basic(self):
        from crate.db.queries.genres_taxonomy_graph_nodes import (
            build_genre_graph_payload,
        )

        payload = build_genre_graph_payload(
            genre={
                "slug": "post-punk",
                "name": "Post-Punk",
                "artist_count": 10,
                "album_count": 5,
                "canonical_slug": "post-punk",
            },
            canonical_slug="post-punk",
            taxonomy_slugs=["noise-rock"],
            taxonomy_stats={
                "post-punk": {
                    "name": "Post-Punk",
                    "artist_count": 10,
                    "album_count": 5,
                    "description": "A genre",
                    "is_top_level": False,
                },
                "noise-rock": {
                    "name": "Noise Rock",
                    "artist_count": 3,
                    "album_count": 2,
                    "description": "",
                    "is_top_level": False,
                },
            },
            hierarchy_links=[],
            direct_relation_links=[
                {
                    "source": "taxonomy:post-punk",
                    "target": "taxonomy:noise-rock",
                    "relation_type": "influenced_by",
                },
            ],
        )
        assert "nodes" in payload
        assert "links" in payload
        assert "mapping" in payload
        assert len(payload["nodes"]) >= 1
        assert len(payload["links"]) >= 1

    def test_build_genre_graph_payload_with_library_alias(self):
        from crate.db.queries.genres_taxonomy_graph_nodes import (
            build_genre_graph_payload,
        )

        payload = build_genre_graph_payload(
            genre={
                "slug": "postpunk-alt",
                "name": "PostPunk Alt",
                "artist_count": 5,
                "album_count": 2,
                "canonical_slug": "post-punk",
            },
            canonical_slug="post-punk",
            taxonomy_slugs=["noise-rock"],
            taxonomy_stats={
                "post-punk": {
                    "name": "Post-Punk",
                    "artist_count": 15,
                    "album_count": 7,
                    "description": "A genre",
                    "is_top_level": False,
                },
                "noise-rock": {
                    "name": "Noise Rock",
                    "artist_count": 3,
                    "album_count": 2,
                    "description": "",
                    "is_top_level": False,
                },
            },
            hierarchy_links=[],
            direct_relation_links=[],
        )
        assert len(payload["nodes"]) == 3  # library alias + taxonomy center + neighbor
        assert any(n["kind"] == "library" for n in payload["nodes"])

    def test_get_genre_graph_not_found(self, pg_db):
        from crate.db.queries.genres_taxonomy_graph_query import get_genre_graph

        assert get_genre_graph("this-genre-should-not-exist-999") is None

    def test_get_genre_graph_found(self, pg_db):
        from crate.db.queries.genres_taxonomy_graph_query import get_genre_graph

        result = get_genre_graph("post-punk")
        assert result is not None
        assert "nodes" in result
        assert "links" in result
        assert "mapping" in result
