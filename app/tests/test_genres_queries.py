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
        assert result["track_count"] == 1
        assert "artists" in result
        assert "albums" in result

    def test_get_genre_detail_with_artists(self, pg_db):
        from crate.db.queries.genres_library_detail import get_genre_detail

        self._setup_genre_library_data(pg_db)
        result = get_genre_detail("post-punk")
        assert len(result["artists"]) >= 1
        assert result["artists"][0]["artist_name"] == "Detail Artist"

    def test_get_genre_detail_includes_all_genre_artists_by_weight_then_popularity(
        self, pg_db
    ):
        from crate.db.queries.genres_library_detail import get_genre_detail

        self._setup_genre_library_data(pg_db)
        pg_db.upsert_artist({"name": "Secondary Detail Artist", "listeners": 999999})
        pg_db.upsert_artist({"name": "Weak Detail Artist", "listeners": 9999999})
        pg_db.set_artist_genres(
            "Secondary Detail Artist",
            [("experimental", 1.0, "test"), ("post-punk", 0.5, "test")],
        )
        pg_db.set_artist_genres(
            "Weak Detail Artist",
            [("experimental", 1.0, "test"), ("post-punk", 0.3, "test")],
        )
        pg_db.upsert_album(
            {
                "artist": "Secondary Detail Artist",
                "name": "Secondary Detail Album",
                "path": "/music/Secondary Detail Artist/Secondary Detail Album",
                "track_count": 7,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        pg_db.upsert_album(
            {
                "artist": "Weak Detail Artist",
                "name": "Weak Detail Album",
                "path": "/music/Weak Detail Artist/Weak Detail Album",
                "track_count": 7,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )

        result = get_genre_detail("post-punk")

        assert result is not None
        artist_names = [artist["artist_name"] for artist in result["artists"]]
        assert "Detail Artist" in artist_names
        assert "Weak Detail Artist" not in artist_names
        assert result["artists"][0]["artist_name"] == "Detail Artist"
        assert result["artists"][1]["artist_name"] == "Secondary Detail Artist"
        assert (
            result["artists"][0]["membership_score"]
            > result["artists"][1]["membership_score"]
        )
        assert result["artists"][0]["membership_tier"] == "core"
        assert result["artists"][1]["membership_tier"] == "adjacent"
        album_names = [album["name"] for album in result["albums"]]
        assert "Secondary Detail Album" not in album_names
        assert "Weak Detail Album" not in album_names
        assert result["artist_count"] == len(result["artists"])
        assert result["album_count"] == len(result["albums"])

    def test_get_genre_albums_use_album_membership_before_artist_fallback(self, pg_db):
        from crate.db.queries.genres_library_detail import get_genre_detail
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        self._setup_genre_library_data(pg_db)
        pg_db.upsert_artist({"name": "Indirect Popular Artist", "listeners": 999999})
        pg_db.set_artist_genres(
            "Indirect Popular Artist",
            [("post-punk", 0.9, "test")],
        )
        indirect_album_id = pg_db.upsert_album(
            {
                "artist": "Indirect Popular Artist",
                "name": "Huge Indirect Album",
                "path": "/music/Indirect Popular Artist/Huge Indirect Album",
                "track_count": 10,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        pg_db.upsert_artist({"name": "Direct Album Artist", "listeners": 10})
        pg_db.set_artist_genres(
            "Direct Album Artist",
            [("post-punk", 0.5, "test")],
        )
        direct_album_id = pg_db.upsert_album(
            {
                "artist": "Direct Album Artist",
                "name": "Essential Direct Album",
                "path": "/music/Direct Album Artist/Essential Direct Album",
                "track_count": 10,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )

        with transaction_scope() as session:
            genre_id = session.execute(
                text("SELECT id FROM genres WHERE slug = 'post-punk'")
            ).scalar_one()
            session.execute(
                text(
                    """
                    INSERT INTO album_genres (album_id, genre_id, weight, source)
                    VALUES (:album_id, :genre_id, 0.95, 'test')
                    """
                ),
                {"album_id": direct_album_id, "genre_id": genre_id},
            )
            session.execute(
                text("UPDATE library_albums SET popularity = 100 WHERE id = :album_id"),
                {"album_id": indirect_album_id},
            )

        result = get_genre_detail("post-punk")

        assert result is not None
        album_names = [album["name"] for album in result["albums"]]
        assert album_names.index("Essential Direct Album") < album_names.index(
            "Huge Indirect Album"
        )
        direct_album = next(
            album
            for album in result["albums"]
            if album["name"] == "Essential Direct Album"
        )
        assert direct_album["direct_genre_match"] is True
        assert direct_album["membership_tier"] == "core"
        assert direct_album["membership_score"] == 0.95

    def test_get_genre_albums_hide_weak_artist_fallback_without_direct_match(
        self, pg_db
    ):
        from crate.db.queries.genres_library_detail import get_genre_detail
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        self._setup_genre_library_data(pg_db)
        pg_db.upsert_artist({"name": "Weak Album Artist", "listeners": 999999})
        pg_db.set_artist_genres(
            "Weak Album Artist",
            [("experimental", 1.0, "test"), ("post-punk", 0.3, "test")],
        )
        weak_fallback_album_id = pg_db.upsert_album(
            {
                "artist": "Weak Album Artist",
                "name": "Weak Fallback Album",
                "path": "/music/Weak Album Artist/Weak Fallback Album",
                "track_count": 8,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        weak_direct_album_id = pg_db.upsert_album(
            {
                "artist": "Weak Album Artist",
                "name": "Weak Direct Album",
                "path": "/music/Weak Album Artist/Weak Direct Album",
                "track_count": 8,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )

        with transaction_scope() as session:
            genre_id = session.execute(
                text("SELECT id FROM genres WHERE slug = 'post-punk'")
            ).scalar_one()
            session.execute(
                text(
                    """
                    INSERT INTO album_genres (album_id, genre_id, weight, source)
                    VALUES (:album_id, :genre_id, 0.8, 'test')
                    """
                ),
                {"album_id": weak_direct_album_id, "genre_id": genre_id},
            )

        result = get_genre_detail("post-punk")

        assert result is not None
        album_names = [album["name"] for album in result["albums"]]
        assert "Weak Direct Album" in album_names
        assert "Weak Fallback Album" not in album_names
        assert weak_fallback_album_id is not None

    def test_get_genre_albums_ordered_by_popularity_not_artist(self, pg_db):
        from crate.db.queries.genres_library_detail import get_genre_detail
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        self._setup_genre_library_data(pg_db)
        pg_db.upsert_artist({"name": "Loud Listener Artist", "listeners": 999999})
        pg_db.set_artist_genres(
            "Loud Listener Artist",
            [("post-punk", 0.9, "test")],
        )
        top_album_id = pg_db.upsert_album(
            {
                "artist": "Loud Listener Artist",
                "name": "Single Loud Hit",
                "path": "/music/Loud Listener Artist/Single Loud Hit",
                "track_count": 4,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        low_album_a_id = pg_db.upsert_album(
            {
                "artist": "Detail Artist",
                "name": "Hidden Gem A",
                "path": "/music/Detail Artist/Hidden Gem A",
                "track_count": 7,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )
        low_album_b_id = pg_db.upsert_album(
            {
                "artist": "Detail Artist",
                "name": "Hidden Gem B",
                "path": "/music/Detail Artist/Hidden Gem B",
                "track_count": 5,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )

        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE library_albums SET popularity = :pop WHERE id = :album_id"
                ),
                {"pop": 20, "album_id": top_album_id},
            )
            session.execute(
                text(
                    "UPDATE library_albums SET popularity = :pop WHERE id = :album_id"
                ),
                {"pop": 100, "album_id": low_album_a_id},
            )
            session.execute(
                text(
                    "UPDATE library_albums SET popularity = :pop WHERE id = :album_id"
                ),
                {"pop": 90, "album_id": low_album_b_id},
            )

        result = get_genre_detail("post-punk")

        assert result is not None
        album_names = [album["name"] for album in result["albums"]]
        assert album_names[:4] == [
            "Detail Album",
            "Hidden Gem A",
            "Hidden Gem B",
            "Single Loud Hit",
        ]

    def test_get_genre_detail_uses_canonical_cover_for_alias(self, pg_db):
        from crate.db.queries.genres_library_detail import get_genre_detail
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        self._setup_genre_library_data(pg_db)
        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    INSERT INTO genre_taxonomy_nodes (slug, name, description, cover_path)
                    VALUES (
                        'post-punk-canonical',
                        'Post-Punk Canonical',
                        'Angular guitars and cold room pressure.',
                        'post-punk-canonical.webp'
                    )
                    ON CONFLICT (slug) DO UPDATE
                    SET description = EXCLUDED.description,
                        cover_path = EXCLUDED.cover_path
                    """
                )
            )
            session.execute(
                text(
                    """
                    INSERT INTO genre_taxonomy_aliases (alias_slug, alias_name, genre_id)
                    SELECT 'post-punk', 'post-punk', id
                    FROM genre_taxonomy_nodes
                    WHERE slug = 'post-punk-canonical'
                    ON CONFLICT (alias_slug) DO UPDATE
                    SET genre_id = EXCLUDED.genre_id
                    """
                )
            )

        result = get_genre_detail("post-punk")

        assert result is not None
        assert result["cover_url"] == (
            "/api/genres/post-punk-canonical/cover?size=640&format=webp"
        )

    def test_get_genre_detail_does_not_expand_canonical_alias_artists(self, pg_db):
        from crate.db.queries.genres_library_detail import get_genre_detail
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        self._setup_genre_library_data(pg_db)
        pg_db.upsert_artist({"name": "Alias Primary Artist", "listeners": 999999})
        pg_db.set_artist_genres(
            "Alias Primary Artist",
            [("post-punk-alias", 1.0, "test")],
        )
        pg_db.upsert_album(
            {
                "artist": "Alias Primary Artist",
                "name": "Alias Primary Album",
                "path": "/music/Alias Primary Artist/Alias Primary Album",
                "track_count": 5,
                "total_size": 1000,
                "total_duration": 180.0,
                "formats": ["flac"],
            }
        )

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    INSERT INTO genre_taxonomy_nodes (slug, name)
                    VALUES ('post-punk-canonical', 'Post-Punk Canonical')
                    ON CONFLICT (slug) DO NOTHING
                    """
                )
            )
            session.execute(
                text(
                    """
                    INSERT INTO genre_taxonomy_aliases (alias_slug, alias_name, genre_id)
                    SELECT alias_slug, alias_slug, tn.id
                    FROM genre_taxonomy_nodes tn
                    CROSS JOIN (
                        VALUES ('post-punk'), ('post-punk-alias')
                    ) AS aliases(alias_slug)
                    WHERE tn.slug = 'post-punk-canonical'
                    ON CONFLICT (alias_slug) DO UPDATE
                    SET genre_id = EXCLUDED.genre_id
                    """
                )
            )

        result = get_genre_detail("post-punk")

        assert result is not None
        assert "Detail Artist" in [
            artist["artist_name"] for artist in result["artists"]
        ]
        assert "Alias Primary Artist" not in [
            artist["artist_name"] for artist in result["artists"]
        ]
        assert "Alias Primary Album" not in [
            album["name"] for album in result["albums"]
        ]

    def test_get_genre_detail_includes_related_genres_ranked_by_library_content(
        self, pg_db
    ):
        from crate.db.queries.genres_library_detail import get_genre_detail

        self._setup_genre_library_data(pg_db)
        for index in range(3):
            artist_name = f"Gothic Detail Artist {index}"
            pg_db.upsert_artist(
                {
                    "name": artist_name,
                    "has_photo": 1 if index == 0 else 0,
                    "listeners": 1000 - index,
                }
            )
            pg_db.set_artist_genres(artist_name, [("gothic-rock", 0.9, "test")])
        pg_db.upsert_artist({"name": "New Wave Detail Artist"})
        pg_db.set_artist_genres("New Wave Detail Artist", [("new-wave", 0.9, "test")])

        result = get_genre_detail("post-punk")

        assert result is not None
        related = result["related_genres"]
        assert related[0]["slug"] == "gothic-rock"
        assert related[0]["relation_type"] == "related"
        assert related[0]["artist_count"] >= 3
        assert related[0]["top_artist_name"] == "Gothic Detail Artist 0"
        assert related[0]["top_artist_photo_url"].startswith("/api/artists/")
        assert related[0]["top_artist_photo_url"].endswith(
            "/photo?size=640&format=webp"
        )
        assert "new-wave" in [genre["slug"] for genre in related]

    def test_get_genre_upcoming_shows_uses_primary_genre_and_location(self, pg_db):
        from crate.db.queries.genres_library_detail import get_genre_upcoming_shows
        from crate.db.tx import transaction_scope
        from sqlalchemy import text

        self._setup_genre_library_data(pg_db)
        pg_db.upsert_artist({"name": "Secondary Detail Artist", "listeners": 999999})
        pg_db.upsert_artist({"name": "Weak Detail Artist", "listeners": 9999999})
        pg_db.set_artist_genres(
            "Secondary Detail Artist",
            [("experimental", 1.0, "test"), ("post-punk", 0.5, "test")],
        )
        pg_db.set_artist_genres(
            "Weak Detail Artist",
            [("experimental", 1.0, "test"), ("post-punk", 0.3, "test")],
        )

        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    INSERT INTO shows (
                        artist_name,
                        venue,
                        city,
                        country,
                        country_code,
                        latitude,
                        longitude,
                        date,
                        status,
                        source,
                        created_at,
                        updated_at
                    )
                    VALUES
                        ('Detail Artist', 'Near Room', 'Berlin', 'Germany', 'DE', 52.520, 13.405, CURRENT_DATE + INTERVAL '7 days', 'onsale', 'lastfm', NOW(), NOW()),
                        ('Detail Artist', 'Later Room', 'Berlin', 'Germany', 'DE', 52.520, 13.405, CURRENT_DATE + INTERVAL '14 days', 'onsale', 'lastfm', NOW(), NOW()),
                        ('Secondary Detail Artist', 'Wrong Room', 'Berlin', 'Germany', 'DE', 52.520, 13.405, CURRENT_DATE + INTERVAL '8 days', 'onsale', 'lastfm', NOW(), NOW()),
                        ('Weak Detail Artist', 'Weak Room', 'Berlin', 'Germany', 'DE', 52.520, 13.405, CURRENT_DATE + INTERVAL '9 days', 'onsale', 'lastfm', NOW(), NOW()),
                        ('Detail Artist', 'Far Room', 'Paris', 'France', 'FR', 48.8566, 2.3522, CURRENT_DATE + INTERVAL '6 days', 'onsale', 'lastfm', NOW(), NOW())
                    """
                )
            )

        shows = get_genre_upcoming_shows(
            "post-punk",
            latitude=52.52,
            longitude=13.405,
            radius_km=25,
            limit=5,
        )

        assert [show["artist_name"] for show in shows] == [
            "Detail Artist",
            "Secondary Detail Artist",
        ]
        assert shows[0]["venue"] == "Near Room"

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
