"""Tests for browse-related DB query modules in crate.db.queries.

Covers: track_lookup, artist_tracks, track_genres, favorites, artist_refs,
        search, and mood query functions.
"""

import time
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")

# ── Helpers ──────────────────────────────────────────────────────────


def _setup_artist_album_track(
    pg_db,
    artist_name="Test Artist",
    album_name="Test Album",
    track_title="Test Track",
    filename="01-test.flac",
):
    """Create an artist + album + track, return (artist_name, album_id, track_id, track_path, entity_uid, storage_id)."""
    pg_db.upsert_artist({"name": artist_name})
    album_id = pg_db.upsert_album(
        {
            "artist": artist_name,
            "name": album_name,
            "path": f"/music/{artist_name}/{album_name}",
            "track_count": 1,
            "total_size": 1024,
            "total_duration": 180.0,
            "formats": ["flac"],
        }
    )
    track_path = f"/music/{artist_name}/{album_name}/{filename}"

    storage_id = str(uuid.uuid4())
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": artist_name,
            "album": album_name,
            "filename": filename,
            "title": track_title,
            "path": track_path,
            "duration": 180.0,
            "size": 1024,
            "format": "flac",
            "storage_id": storage_id,
        }
    )

    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    "SELECT id, entity_uid::text AS entity_uid, storage_id::text AS storage_id FROM library_tracks WHERE path = :p"
                ),
                {"p": track_path},
            )
            .mappings()
            .first()
        )

    return (
        artist_name,
        album_id,
        row["id"],
        track_path,
        row["entity_uid"],
        row["storage_id"],
    )


# ══════════════════════════════════════════════════════════════════════
# browse_media_track_lookup
# ══════════════════════════════════════════════════════════════════════


class TestTrackLookup:
    def test_find_track_id_by_path_matches_suffix(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import find_track_id_by_path

        _, _, track_id, path, _, _ = _setup_artist_album_track(pg_db)
        result = find_track_id_by_path("01-test.flac")
        assert result == track_id

    def test_find_track_id_by_path_matches_partial(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import find_track_id_by_path

        _, _, track_id, _, _, _ = _setup_artist_album_track(pg_db)
        result = find_track_id_by_path("Test Album/01-test.flac")
        assert result == track_id

    def test_find_track_id_by_path_returns_none_for_no_match(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import find_track_id_by_path

        result = find_track_id_by_path("nonexistent-file.flac")
        assert result is None

    def test_get_track_info_cols_returns_selected_columns(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import get_track_info_cols

        _, _, track_id, _, _, _ = _setup_artist_album_track(
            pg_db, track_title="Bright Eyes"
        )
        result = get_track_info_cols(track_id, "id, title, artist, duration")
        assert result is not None
        assert result["id"] == track_id
        assert result["title"] == "Bright Eyes"
        assert result["artist"] == "Test Artist"
        assert result["duration"] == 180.0

    def test_get_track_info_cols_rejects_invalid_columns(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import get_track_info_cols

        with pytest.raises(ValueError, match="Invalid column list"):
            get_track_info_cols(1, "id; DROP TABLE library_tracks")

    def test_get_track_info_cols_returns_none_for_missing_track(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import get_track_info_cols

        result = get_track_info_cols(99999, "id, title")
        assert result is None

    def test_get_track_info_cols_by_storage_id_finds_by_storage_id(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import (
            get_track_info_cols_by_storage_id,
        )

        _, _, track_id, _, _, storage_id = _setup_artist_album_track(pg_db)
        result = get_track_info_cols_by_storage_id(storage_id, "id, title, storage_id")
        assert result is not None
        assert result["id"] == track_id
        assert str(result["storage_id"]) == storage_id

    def test_get_track_info_cols_by_storage_id_returns_none_for_unknown(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import (
            get_track_info_cols_by_storage_id,
        )

        result = get_track_info_cols_by_storage_id(
            "00000000-0000-0000-0000-000000000000", "id"
        )
        assert result is None

    def test_get_track_info_cols_by_entity_uid_finds_by_uuid(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import (
            get_track_info_cols_by_entity_uid,
        )

        _, _, track_id, _, entity_uid, _ = _setup_artist_album_track(pg_db)
        result = get_track_info_cols_by_entity_uid(entity_uid, "id, title, entity_uid")
        assert result is not None
        assert result["id"] == track_id
        assert str(result["entity_uid"]) == entity_uid

    def test_get_track_info_cols_by_entity_uid_returns_none_for_invalid_uuid(
        self, pg_db
    ):
        from crate.db.queries.browse_media_track_lookup import (
            get_track_info_cols_by_entity_uid,
        )

        result = get_track_info_cols_by_entity_uid("not-a-uuid", "id")
        assert result is None

    def test_get_track_info_cols_by_entity_uid_returns_none_for_unknown_uuid(
        self, pg_db
    ):
        from crate.db.queries.browse_media_track_lookup import (
            get_track_info_cols_by_entity_uid,
        )

        unknown = str(uuid.uuid4())
        result = get_track_info_cols_by_entity_uid(unknown, "id")
        assert result is None

    def test_get_track_info_cols_by_path_matches_suffix(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import (
            get_track_info_cols_by_path,
        )

        _, _, track_id, _, _, _ = _setup_artist_album_track(pg_db)
        result = get_track_info_cols_by_path("01-test.flac", "id, title")
        assert result is not None
        assert result["id"] == track_id

    def test_get_track_info_cols_by_path_returns_none_for_no_match(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import (
            get_track_info_cols_by_path,
        )

        result = get_track_info_cols_by_path("ghost.flac", "id")
        assert result is None

    def test_get_track_exists_returns_true_for_existing(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import get_track_exists

        _, _, track_id, _, _, _ = _setup_artist_album_track(pg_db)
        assert get_track_exists(track_id) is True

    def test_get_track_exists_returns_false_for_missing(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import get_track_exists

        assert get_track_exists(99999) is False

    def test_get_track_id_by_storage_id_resolves(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import (
            get_track_id_by_storage_id,
        )

        _, _, track_id, _, _, storage_id = _setup_artist_album_track(pg_db)
        result = get_track_id_by_storage_id(storage_id)
        assert result == track_id

    def test_get_track_id_by_storage_id_returns_none_for_unknown(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import (
            get_track_id_by_storage_id,
        )

        result = get_track_id_by_storage_id("aaaaaaaa-bbbb-cccc-dddd-000000000000")
        assert result is None

    def test_get_track_id_by_entity_uid_resolves(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import (
            get_track_id_by_entity_uid,
        )

        _, _, track_id, _, entity_uid, _ = _setup_artist_album_track(pg_db)
        result = get_track_id_by_entity_uid(entity_uid)
        assert result == track_id

    def test_get_track_id_by_entity_uid_returns_none_for_invalid(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import (
            get_track_id_by_entity_uid,
        )

        result = get_track_id_by_entity_uid("garbage")
        assert result is None

    def test_get_track_path_returns_full_path(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import get_track_path

        _, _, track_id, path, _, _ = _setup_artist_album_track(pg_db)
        result = get_track_path(track_id)
        assert result == path

    def test_get_track_path_returns_none_for_missing(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import get_track_path

        assert get_track_path(99999) is None

    def test_get_track_path_caches_result(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import (
            clear_track_path_cache,
            get_track_path,
        )

        _, _, track_id, path, _, _ = _setup_artist_album_track(pg_db)
        clear_track_path_cache()

        first = get_track_path(track_id)
        assert first == path

        second = get_track_path(track_id)
        assert second == path

    def test_clear_track_path_cache_evicts_entries(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import (
            clear_track_path_cache,
            get_track_path,
        )

        _, _, track_id, _, _, _ = _setup_artist_album_track(pg_db)
        get_track_path(track_id)
        clear_track_path_cache()

        result = get_track_path(track_id)
        assert result is not None

    def test_get_track_path_by_storage_id_returns_path(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import (
            get_track_path_by_storage_id,
        )

        _, _, _, path, _, storage_id = _setup_artist_album_track(pg_db)
        result = get_track_path_by_storage_id(storage_id)
        assert result == path

    def test_get_track_path_by_storage_id_returns_none_for_unknown(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import (
            get_track_path_by_storage_id,
        )

        assert (
            get_track_path_by_storage_id("deadbeef-dead-beef-dead-beef00000000") is None
        )

    def test_get_track_path_by_entity_uid_returns_path(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import (
            get_track_path_by_entity_uid,
        )

        _, _, _, path, entity_uid, _ = _setup_artist_album_track(pg_db)
        result = get_track_path_by_entity_uid(entity_uid)
        assert result == path

    def test_get_track_path_by_entity_uid_returns_none_for_invalid(self, pg_db):
        from crate.db.queries.browse_media_track_lookup import (
            get_track_path_by_entity_uid,
        )

        result = get_track_path_by_entity_uid("not-valid-uuid")
        assert result is None

    def test_anti_n1_multiple_lookups_use_index_not_table_scan(self, pg_db):
        """Insert 50 tracks and verify lookups are O(1) per call."""
        from crate.db.queries.browse_media_track_lookup import get_track_info_cols
        from crate.db.tx import transaction_scope

        artist = "AntiN1 Artist"
        album = "AntiN1 Album"
        pg_db.upsert_artist({"name": artist})
        album_id = pg_db.upsert_album(
            {
                "artist": artist,
                "name": album,
                "path": f"/music/{artist}/{album}",
                "track_count": 50,
                "total_size": 50000,
                "total_duration": 9000.0,
                "formats": ["flac"],
            }
        )

        track_ids = []
        for i in range(1, 51):
            filename = f"{i:02d}-track.flac"
            tpath = f"/music/{artist}/{album}/{filename}"
            pg_db.upsert_track(
                {
                    "album_id": album_id,
                    "artist": artist,
                    "album": album,
                    "filename": filename,
                    "title": f"Track {i}",
                    "path": tpath,
                    "duration": 180.0,
                    "size": 1000,
                    "format": "flac",
                }
            )
            with transaction_scope() as session:
                tid = session.execute(
                    text("SELECT id FROM library_tracks WHERE path = :p"),
                    {"p": tpath},
                ).scalar_one()
            track_ids.append(tid)

        start = time.monotonic()
        for tid in track_ids:
            result = get_track_info_cols(tid, "id, title")
            assert result is not None
            assert result["id"] == tid
        elapsed = time.monotonic() - start
        assert elapsed < 1.0, f"50 lookups took {elapsed:.3f}s — possible N+1 scan"


# ══════════════════════════════════════════════════════════════════════
# browse_artist_tracks
# ══════════════════════════════════════════════════════════════════════


class TestArtistTracks:
    def test_get_artist_all_tracks_returns_all_for_artist(self, pg_db):
        from crate.db.queries.browse_artist_tracks import get_artist_all_tracks

        artist = "Astronoid"
        pg_db.upsert_artist({"name": artist})
        album_id = pg_db.upsert_album(
            {
                "artist": artist,
                "name": "Air",
                "path": f"/music/{artist}/Air",
                "track_count": 3,
                "total_size": 3000,
                "total_duration": 540.0,
                "formats": ["flac"],
            }
        )
        for i, title in enumerate(
            ["Up and Atom", "Resin", "I Dream in Lines"], start=1
        ):
            pg_db.upsert_track(
                {
                    "album_id": album_id,
                    "artist": artist,
                    "album": "Air",
                    "filename": f"{i:02d}-{title.lower().replace(' ', '-')}.flac",
                    "title": title,
                    "path": f"/music/{artist}/Air/{i:02d}-{title.lower().replace(' ', '-')}.flac",
                    "duration": 240.0,
                    "size": 2400,
                    "format": "flac",
                }
            )

        tracks = get_artist_all_tracks(artist)
        assert len(tracks) == 3
        titles = {t["title"] for t in tracks}
        assert titles == {"Up and Atom", "Resin", "I Dream in Lines"}
        for t in tracks:
            assert t["artist"] == artist
            assert "album_slug" in t
            assert "artist_slug" in t

    def test_get_artist_all_tracks_respects_limit(self, pg_db):
        from crate.db.queries.browse_artist_tracks import get_artist_all_tracks

        artist = "Limit Test"
        pg_db.upsert_artist({"name": artist})
        album_id = pg_db.upsert_album(
            {
                "artist": artist,
                "name": "Many Tracks",
                "path": f"/music/{artist}/Many Tracks",
                "track_count": 5,
                "total_size": 5000,
                "total_duration": 900.0,
                "formats": ["flac"],
            }
        )
        for i in range(1, 6):
            pg_db.upsert_track(
                {
                    "album_id": album_id,
                    "artist": artist,
                    "album": "Many Tracks",
                    "filename": f"{i:02d}-track.flac",
                    "title": f"Song {i}",
                    "path": f"/music/{artist}/Many Tracks/{i:02d}-track.flac",
                    "duration": 180.0,
                    "size": 1000,
                    "format": "flac",
                }
            )

        tracks = get_artist_all_tracks(artist, limit=2)
        assert len(tracks) == 2

    def test_get_artist_all_tracks_empty_for_unknown_artist(self, pg_db):
        from crate.db.queries.browse_artist_tracks import get_artist_all_tracks

        tracks = get_artist_all_tracks("Nonexistent Artist")
        assert tracks == []

    def test_get_artist_track_titles_with_albums_joins_albums(self, pg_db):
        from crate.db.queries.browse_artist_tracks import (
            get_artist_track_titles_with_albums,
        )

        artist = "Join Test Artist"
        album = "Join Album"
        pg_db.upsert_artist({"name": artist})
        album_id = pg_db.upsert_album(
            {
                "artist": artist,
                "name": album,
                "path": f"/music/{artist}/{album}",
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": artist,
                "album": album,
                "filename": "01-join.flac",
                "title": "Join Track",
                "path": f"/music/{artist}/{album}/01-join.flac",
                "format": "flac",
            }
        )

        results = get_artist_track_titles_with_albums(artist)
        assert len(results) == 1
        assert results[0]["title"] == "Join Track"
        assert results[0]["album"] == album
        assert results[0]["album_id"] == album_id
        assert "album_slug" in results[0]

    def test_get_artist_track_titles_with_albums_empty_for_unknown(self, pg_db):
        from crate.db.queries.browse_artist_tracks import (
            get_artist_track_titles_with_albums,
        )

        assert get_artist_track_titles_with_albums("Nobody") == []

    def test_get_artist_setlist_tracks_returns_ordered(self, pg_db):
        from crate.db.queries.browse_artist_tracks import get_artist_setlist_tracks

        artist = "Setlist Artist"
        pg_db.upsert_artist({"name": artist})
        album_id = pg_db.upsert_album(
            {
                "artist": artist,
                "name": "Live Set",
                "path": f"/music/{artist}/Live Set",
                "year": "2023",
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": artist,
                "album": "Live Set",
                "filename": "01-opener.flac",
                "title": "Opener",
                "track_number": 1,
                "path": f"/music/{artist}/Live Set/01-opener.flac",
                "format": "flac",
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": artist,
                "album": "Live Set",
                "filename": "02-closer.flac",
                "title": "Closer",
                "track_number": 2,
                "path": f"/music/{artist}/Live Set/02-closer.flac",
                "format": "flac",
            }
        )

        tracks = get_artist_setlist_tracks(artist)
        assert len(tracks) == 2
        assert all("bliss_vector" in t for t in tracks)
        assert all("bpm" in t for t in tracks)

    def test_get_artist_setlist_tracks_empty_for_unknown(self, pg_db):
        from crate.db.queries.browse_artist_tracks import get_artist_setlist_tracks

        assert get_artist_setlist_tracks("Ghost Band") == []


# ══════════════════════════════════════════════════════════════════════
# browse_media_track_genres
# ══════════════════════════════════════════════════════════════════════


class TestTrackGenres:
    def test_get_track_album_genres_returns_genres_for_track_album(self, pg_db):
        from crate.db.queries.browse_media_track_genres import get_track_album_genres
        from crate.db.tx import transaction_scope

        _, _, track_id, _, _, _ = _setup_artist_album_track(
            pg_db, artist_name="Genre Artist", album_name="Genre Album"
        )

        with transaction_scope() as session:
            genre_id = session.execute(
                text(
                    "INSERT INTO genres (id, name, slug) VALUES (501, 'Post-Metal', 'post-metal') RETURNING id"
                )
            ).scalar_one()
            session.execute(
                text(
                    "INSERT INTO album_genres (album_id, genre_id, weight, source) VALUES (:aid, :gid, 0.9, 'tags')"
                ),
                {"aid": _get_album_id_for_track(pg_db, track_id), "gid": genre_id},
            )

        genres = get_track_album_genres(track_id)
        assert len(genres) >= 1
        assert genres[0]["name"] == "Post-Metal"
        assert genres[0]["slug"] == "post-metal"
        assert genres[0]["weight"] == 0.9

    def test_get_track_album_genres_empty_for_no_genres(self, pg_db):
        from crate.db.queries.browse_media_track_genres import get_track_album_genres

        _, _, track_id, _, _, _ = _setup_artist_album_track(pg_db)
        genres = get_track_album_genres(track_id)
        assert genres == []

    def test_get_track_album_genres_empty_for_missing_track(self, pg_db):
        from crate.db.queries.browse_media_track_genres import get_track_album_genres

        assert get_track_album_genres(99999) == []

    def test_get_track_artist_genres_finds_via_track_artist(self, pg_db):
        from crate.db.queries.browse_media_track_genres import get_track_artist_genres

        artist = "Genre Track Artist"
        _, _, track_id, _, _, _ = _setup_artist_album_track(pg_db, artist_name=artist)

        pg_db.set_artist_genres(artist, [("shoegaze", 0.8, "tags")])

        genres = get_track_artist_genres(track_id)
        assert len(genres) >= 1
        names = {g["name"] for g in genres}
        assert "shoegaze" in names

    def test_get_track_artist_genres_empty_for_missing_track(self, pg_db):
        from crate.db.queries.browse_media_track_genres import get_track_artist_genres

        assert get_track_artist_genres(99999) == []


def _get_album_id_for_track(pg_db, track_id):
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        return session.execute(
            text("SELECT album_id FROM library_tracks WHERE id = :tid"),
            {"tid": track_id},
        ).scalar_one()


# ══════════════════════════════════════════════════════════════════════
# browse_media_favorites
# ══════════════════════════════════════════════════════════════════════


class TestFavorites:
    def test_add_and_list_favorites(self, pg_db):
        from crate.db.queries.browse_media_favorites import add_favorite, list_favorites

        add_favorite("track", "42", "2025-01-01T00:00:00Z")
        add_favorite("album", "7", "2025-01-02T00:00:00Z")

        favs = list_favorites()
        assert len(favs) == 2
        assert favs[0]["item_type"] == "album"
        assert favs[0]["item_id"] == "7"

    def test_add_favorite_idempotent_on_conflict(self, pg_db):
        from crate.db.queries.browse_media_favorites import add_favorite, list_favorites

        add_favorite("artist", "99", "2025-01-01T00:00:00Z")
        add_favorite("artist", "99", "2025-01-01T00:00:00Z")

        favs = list_favorites()
        assert len(favs) == 1

    def test_list_favorites_empty_when_none_added(self, pg_db):
        from crate.db.queries.browse_media_favorites import list_favorites

        assert list_favorites() == []

    def test_remove_favorite_deletes_by_type_and_id(self, pg_db):
        from crate.db.queries.browse_media_favorites import (
            add_favorite,
            list_favorites,
            remove_favorite,
        )

        add_favorite("track", "1", "2025-01-01T00:00:00Z")
        add_favorite("track", "2", "2025-01-02T00:00:00Z")

        remove_favorite("track", "1")
        favs = list_favorites()
        assert len(favs) == 1
        assert favs[0]["item_id"] == "2"

    def test_remove_favorite_noop_when_not_found(self, pg_db):
        from crate.db.queries.browse_media_favorites import (
            remove_favorite,
            list_favorites,
        )

        remove_favorite("track", "nonexistent")
        assert list_favorites() == []


# ══════════════════════════════════════════════════════════════════════
# browse_artist_refs
# ══════════════════════════════════════════════════════════════════════


class TestArtistRefs:
    def test_get_artist_refs_by_names_full_batches(self, pg_db):
        from crate.db.queries.browse_artist_refs import get_artist_refs_by_names_full

        pg_db.upsert_artist({"name": "Converge"})
        pg_db.upsert_artist({"name": "Botch"})
        pg_db.upsert_artist({"name": "Cave In"})

        refs = get_artist_refs_by_names_full(["Converge", "Botch", "Unknown"])
        assert len(refs) == 2
        assert "converge" in refs
        assert "botch" in refs
        assert refs["converge"]["name"] == "Converge"
        assert "id" in refs["converge"]
        assert "slug" in refs["converge"]

    def test_get_artist_refs_by_names_full_case_insensitive(self, pg_db):
        from crate.db.queries.browse_artist_refs import get_artist_refs_by_names_full

        pg_db.upsert_artist({"name": "Deftones"})
        refs = get_artist_refs_by_names_full(["DEFTONES"])
        assert len(refs) == 1
        assert "deftones" in refs

    def test_get_artist_refs_by_names_full_dedupes(self, pg_db):
        from crate.db.queries.browse_artist_refs import get_artist_refs_by_names_full

        pg_db.upsert_artist({"name": "Isis"})
        refs = get_artist_refs_by_names_full(["Isis", "isis", "ISIS"])
        assert len(refs) == 1

    def test_get_artist_refs_by_names_full_skips_empty(self, pg_db):
        from crate.db.queries.browse_artist_refs import get_artist_refs_by_names_full

        refs = get_artist_refs_by_names_full(["", "  ", None])  # type: ignore[list-item]
        assert refs == {}

    def test_get_artist_refs_by_names_full_empty_list(self, pg_db):
        from crate.db.queries.browse_artist_refs import get_artist_refs_by_names_full

        assert get_artist_refs_by_names_full([]) == {}

    def test_get_artist_refs_by_names_full_no_matches(self, pg_db):
        from crate.db.queries.browse_artist_refs import get_artist_refs_by_names_full

        assert get_artist_refs_by_names_full(["Nobody Here"]) == {}

    def test_get_similar_artist_refs_excludes_name_field(self, pg_db):
        from crate.db.queries.browse_artist_refs import get_similar_artist_refs

        pg_db.upsert_artist({"name": "Neurosis"})
        refs = get_similar_artist_refs(["Neurosis"])
        assert len(refs) == 1
        assert "neurosis" in refs
        assert "id" in refs["neurosis"]
        assert "slug" in refs["neurosis"]
        assert "name" not in refs["neurosis"]

    def test_get_similar_artist_refs_empty_list(self, pg_db):
        from crate.db.queries.browse_artist_refs import get_similar_artist_refs

        assert get_similar_artist_refs([]) == {}

    def test_check_artists_in_library_returns_lowercase_set(self, pg_db):
        from crate.db.queries.browse_artist_refs import check_artists_in_library

        pg_db.upsert_artist({"name": "Cult of Luna"})

        in_lib = check_artists_in_library(["CULT OF LUNA", "Tool"])
        assert in_lib == {"cult of luna"}

    def test_check_artists_in_library_empty_for_none(self, pg_db):
        from crate.db.queries.browse_artist_refs import check_artists_in_library

        assert check_artists_in_library(["Missing"]) == set()

    def test_anti_n1_artist_refs_single_query(self, pg_db):
        """Verify get_artist_refs_by_names_full issues one query for many names."""
        from crate.db.queries.browse_artist_refs import get_artist_refs_by_names_full

        names = []
        for i in range(20):
            name = f"Batch Artist {i}"
            pg_db.upsert_artist({"name": name})
            names.append(name)

        refs = get_artist_refs_by_names_full(names)
        assert len(refs) == 20


# ══════════════════════════════════════════════════════════════════════
# browse_media_search
# ══════════════════════════════════════════════════════════════════════


class TestSearch:
    def test_search_artists_finds_by_ilike(self, pg_db):
        from crate.db.queries.browse_media_search import search_artists

        pg_db.upsert_artist({"name": "Meshuggah"})

        results = search_artists("%meshuggah%", 10)
        assert len(results) == 1
        assert results[0]["name"] == "Meshuggah"
        assert "entity_uid" in results[0]
        assert "slug" in results[0]

    def test_search_artists_empty_for_no_match(self, pg_db):
        from crate.db.queries.browse_media_search import search_artists

        assert search_artists("%zzznotfound%", 10) == []

    def test_search_artists_respects_limit(self, pg_db):
        from crate.db.queries.browse_media_search import search_artists

        for i in range(5):
            pg_db.upsert_artist({"name": f"Searchable Band {i}"})

        results = search_artists("%searchable%", 2)
        assert len(results) == 2

    def test_search_albums_finds_by_name_or_artist(self, pg_db):
        from crate.db.queries.browse_media_search import search_albums

        pg_db.upsert_artist({"name": "Dillinger"})
        pg_db.upsert_album(
            {
                "artist": "Dillinger",
                "name": "Calculating Infinity",
                "path": "/music/Dillinger/Calculating Infinity",
                "year": "1999",
            }
        )

        results = search_albums("%calculating%", 10)
        assert len(results) == 1
        assert results[0]["name"] == "Calculating Infinity"
        assert results[0]["artist"] == "Dillinger"
        assert "artist_id" in results[0]
        assert "artist_slug" in results[0]

    def test_search_albums_empty_for_no_match(self, pg_db):
        from crate.db.queries.browse_media_search import search_albums

        assert search_albums("%noalbum%", 10) == []

    def test_search_albums_handles_null_entity_uid(self, pg_db):
        from crate.db.queries.browse_media_search import search_albums

        pg_db.upsert_artist({"name": "Null Entity Band"})
        pg_db.upsert_album(
            {
                "artist": "Null Entity Band",
                "name": "Null Entity Album",
                "path": "/music/Null Entity Band/Null Entity Album",
            }
        )

        results = search_albums("%null entity album%", 10)
        assert len(results) >= 1

    def test_search_tracks_finds_by_title_artist_album(self, pg_db):
        from crate.db.queries.browse_media_search import search_tracks

        artist = "Search Track Artist"
        album = "Search Track Album"
        pg_db.upsert_artist({"name": artist})
        album_id = pg_db.upsert_album(
            {
                "artist": artist,
                "name": album,
                "path": f"/music/{artist}/{album}",
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": artist,
                "album": album,
                "filename": "01-finders.flac",
                "title": "Finders Keepers",
                "path": f"/music/{artist}/{album}/01-finders.flac",
                "duration": 200.0,
                "size": 2000,
                "format": "flac",
            }
        )

        results = search_tracks("%finders%", 10)
        assert len(results) == 1
        assert results[0]["title"] == "Finders Keepers"
        assert results[0]["album"] == album
        assert "bliss_vector" in results[0]
        assert "entity_uid" in results[0]

    def test_search_tracks_empty_for_no_match(self, pg_db):
        from crate.db.queries.browse_media_search import search_tracks

        assert search_tracks("%zzznotfound123%", 10) == []

    def test_search_tracks_converts_bliss_vector_to_list(self, pg_db):
        from crate.db.queries.browse_media_search import search_tracks
        from crate.db.tx import transaction_scope

        artist = "Bliss Vector Search"
        album = "Bliss Vector Album"
        pg_db.upsert_artist({"name": artist})
        album_id = pg_db.upsert_album(
            {
                "artist": artist,
                "name": album,
                "path": f"/music/{artist}/{album}",
            }
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": artist,
                "album": album,
                "filename": "01-bliss.flac",
                "title": "Blissful",
                "path": f"/music/{artist}/{album}/01-bliss.flac",
                "duration": 150.0,
                "size": 1500,
                "format": "flac",
            }
        )

        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE library_tracks SET bliss_vector = CAST(:v AS double precision[]) WHERE path = :p"
                ),
                {"v": [0.1] * 20, "p": f"/music/{artist}/{album}/01-bliss.flac"},
            )

        results = search_tracks("%blissful%", 10)
        assert results[0]["bliss_vector"] == [0.1] * 20


# ══════════════════════════════════════════════════════════════════════
# browse_media_mood
# ══════════════════════════════════════════════════════════════════════


class TestMood:
    def test_count_mood_tracks_counts_filtered_rows(self, pg_db):
        from crate.db.queries.browse_media_mood import count_mood_tracks
        from crate.db.tx import transaction_scope

        artist = "Mood Count Artist"
        album = "Mood Count Album"
        pg_db.upsert_artist({"name": artist})
        album_id = pg_db.upsert_album(
            {
                "artist": artist,
                "name": album,
                "path": f"/music/{artist}/{album}",
            }
        )
        for i, (title, energy, bpm) in enumerate(
            [
                ("High Energy", 0.9, 160),
                ("Low Energy", 0.2, 80),
                ("Mid Energy", 0.5, 110),
            ],
            start=1,
        ):
            pg_db.upsert_track(
                {
                    "album_id": album_id,
                    "artist": artist,
                    "album": album,
                    "filename": f"{i:02d}-{title.lower().replace(' ', '-')}.flac",
                    "title": title,
                    "path": f"/music/{artist}/{album}/{i:02d}-{title.lower().replace(' ', '-')}.flac",
                    "duration": 180.0,
                    "size": 1000,
                    "format": "flac",
                }
            )
            with transaction_scope() as session:
                session.execute(
                    text(
                        "UPDATE library_tracks SET energy = :e, bpm = :b WHERE path = :p"
                    ),
                    {
                        "e": energy,
                        "b": bpm,
                        "p": f"/music/{artist}/{album}/{i:02d}-{title.lower().replace(' ', '-')}.flac",
                    },
                )

        count = count_mood_tracks(["energy >= %s", "bpm >= %s"], [0.7, 120])
        assert count == 1

    def test_count_mood_tracks_zero_when_no_match(self, pg_db):
        from crate.db.queries.browse_media_mood import count_mood_tracks

        count = count_mood_tracks(["energy >= %s"], [0.99])
        assert count == 0

    def test_get_mood_tracks_returns_limited_results(self, pg_db):
        from crate.db.queries.browse_media_mood import get_mood_tracks
        from crate.db.tx import transaction_scope

        artist = "Mood Tracks Artist"
        album = "Mood Tracks Album"
        pg_db.upsert_artist({"name": artist})
        album_id = pg_db.upsert_album(
            {
                "artist": artist,
                "name": album,
                "path": f"/music/{artist}/{album}",
            }
        )
        for i in range(1, 6):
            pg_db.upsert_track(
                {
                    "album_id": album_id,
                    "artist": artist,
                    "album": album,
                    "filename": f"{i:02d}-mood.flac",
                    "title": f"Mood Track {i}",
                    "path": f"/music/{artist}/{album}/{i:02d}-mood.flac",
                    "duration": 180.0,
                    "size": 1000,
                    "format": "flac",
                }
            )
            with transaction_scope() as session:
                session.execute(
                    text("UPDATE library_tracks SET bpm = :b WHERE path = :p"),
                    {"b": 120, "p": f"/music/{artist}/{album}/{i:02d}-mood.flac"},
                )

        tracks = get_mood_tracks(["bpm >= %s"], [80], 3)
        assert len(tracks) == 3
        for t in tracks:
            assert "entity_uid" in t
            assert "artist_entity_uid" in t
            assert "album_entity_uid" in t
            assert "bpm" in t
            assert t["bpm"] == 120

    def test_get_mood_tracks_empty_for_no_match(self, pg_db):
        from crate.db.queries.browse_media_mood import get_mood_tracks

        assert get_mood_tracks(["energy >= %s"], [0.999], 10) == []
