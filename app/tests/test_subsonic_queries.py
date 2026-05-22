"""Tests for Subsonic API query modules.

Covers all query functions in:
- subsonic_artist_album_queries.py
- subsonic_search_queries.py
- subsonic_track_queries.py
- subsonic_user_queries.py
"""

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _make_artist(pg_db, name: str) -> str:
    """Insert an artist and return the artist_id."""
    from crate.db.tx import transaction_scope

    pg_db.upsert_artist({"name": name})
    with transaction_scope() as session:
        row = (
            session.execute(
                text("SELECT id FROM library_artists WHERE name = :name"),
                {"name": name},
            )
            .mappings()
            .first()
        )
    return row["id"]


def _make_album(pg_db, artist: str, album_name: str, **kwargs) -> int:
    """Insert an album and return the album_id."""
    path = kwargs.pop("path", f"/music/{artist}/{album_name}")
    data = {
        "artist": artist,
        "name": album_name,
        "path": path,
        "track_count": kwargs.pop("track_count", 0),
        "total_size": kwargs.pop("total_size", 0),
        "total_duration": kwargs.pop("total_duration", 0.0),
        "formats": kwargs.pop("formats", ["flac"]),
        **kwargs,
    }
    album_id = pg_db.upsert_album(data)
    return album_id


def _make_track(
    pg_db, album_id: int, artist: str, album: str, title: str, **kwargs
) -> int:
    """Insert a track and return the track_id."""
    from crate.db.tx import transaction_scope

    filename = kwargs.pop("filename", f"{title.replace(' ', '_')}.flac")
    data = {
        "album_id": album_id,
        "artist": artist,
        "album": album,
        "filename": filename,
        "title": title,
        "path": kwargs.pop("path", f"/music/{artist}/{album}/{filename}"),
        "duration": kwargs.pop("duration", 180.0),
        "size": kwargs.pop("size", 1024),
        "format": kwargs.pop("format", "flac"),
        **kwargs,
    }
    pg_db.upsert_track(data)
    with transaction_scope() as session:
        row = (
            session.execute(
                text("SELECT id FROM library_tracks WHERE path = :path"),
                {"path": data["path"]},
            )
            .mappings()
            .first()
        )
    return row["id"]


# ── Artist/Album queries ─────────────────────────────────────────────


class TestGetAllArtistsSorted:
    def test_returns_artists_sorted_by_name(self, pg_db):
        from crate.db.queries.subsonic_artist_album_queries import (
            get_all_artists_sorted,
        )

        _make_artist(pg_db, "Zebra")
        _make_artist(pg_db, "Apple")
        _make_artist(pg_db, "Mango")

        result = get_all_artists_sorted()

        names = [r["name"] for r in result]
        # seeded admin is not an artist
        test_names = [n for n in names if n in ("Apple", "Mango", "Zebra")]
        assert test_names == ["Apple", "Mango", "Zebra"]
        assert all(
            "id" in r and "album_count" in r and "listeners" in r for r in result
        )

    def test_empty_library_returns_empty_list(self, pg_db):
        from crate.db.queries.subsonic_artist_album_queries import (
            get_all_artists_sorted,
        )

        result = get_all_artists_sorted()
        assert result == []


class TestGetArtistById:
    def test_returns_correct_artist(self, pg_db):
        from crate.db.queries.subsonic_artist_album_queries import get_artist_by_id

        artist_id = _make_artist(pg_db, "Test Artist")
        result = get_artist_by_id(artist_id)

        assert result is not None
        assert result["name"] == "Test Artist"
        assert result["id"] == artist_id

    def test_nonexistent_artist_returns_none(self, pg_db):
        from crate.db.queries.subsonic_artist_album_queries import get_artist_by_id

        result = get_artist_by_id(99999)
        assert result is None

    def test_returns_only_id_and_name(self, pg_db):
        from crate.db.queries.subsonic_artist_album_queries import get_artist_by_id

        artist_id = _make_artist(pg_db, "Minimal Artist")
        result = get_artist_by_id(artist_id)

        assert set(result.keys()) == {"id", "name"}


class TestGetAlbumsByArtistName:
    def test_returns_albums_sorted_by_year_desc_nulls_last(self, pg_db):
        from crate.db.queries.subsonic_artist_album_queries import (
            get_albums_by_artist_name,
        )

        _make_artist(pg_db, "Band X")
        _make_album(pg_db, "Band X", "Older Album", year="2020", track_count=5)
        _make_album(pg_db, "Band X", "Newer Album", year="2024", track_count=8)
        _make_album(pg_db, "Band X", "Unknown Year", track_count=3)  # no year

        result = get_albums_by_artist_name("Band X")

        names = [r["name"] for r in result]
        assert names == ["Newer Album", "Older Album", "Unknown Year"]

    def test_returns_expected_fields(self, pg_db):
        from crate.db.queries.subsonic_artist_album_queries import (
            get_albums_by_artist_name,
        )

        _make_artist(pg_db, "Band Y")
        _make_album(
            pg_db,
            "Band Y",
            "Album One",
            year="2023",
            track_count=10,
            total_duration=2400.0,
        )

        result = get_albums_by_artist_name("Band Y")
        assert len(result) == 1

        album = result[0]
        assert set(album.keys()) == {
            "id",
            "name",
            "year",
            "track_count",
            "has_cover",
            "duration",
        }

    def test_artist_with_no_albums_returns_empty(self, pg_db):
        from crate.db.queries.subsonic_artist_album_queries import (
            get_albums_by_artist_name,
        )

        _make_artist(pg_db, "Lonely Artist")
        result = get_albums_by_artist_name("Lonely Artist")
        assert result == []

    def test_nonexistent_artist_returns_empty(self, pg_db):
        from crate.db.queries.subsonic_artist_album_queries import (
            get_albums_by_artist_name,
        )

        result = get_albums_by_artist_name("Ghost Band")
        assert result == []


class TestGetAlbumWithArtist:
    def test_returns_album_with_artist_id(self, pg_db):
        from crate.db.queries.subsonic_artist_album_queries import get_album_with_artist

        artist_id = _make_artist(pg_db, "Album Artist")
        album_id = _make_album(
            pg_db, "Album Artist", "Test Album", year="2023", track_count=6
        )

        result = get_album_with_artist(album_id)
        assert result is not None
        assert result["name"] == "Test Album"
        assert result["artist"] == "Album Artist"
        assert result["artist_id"] == artist_id
        assert "id" in result
        assert "year" in result
        assert "track_count" in result
        assert "has_cover" in result
        assert "duration" in result

    def test_nonexistent_album_returns_none(self, pg_db):
        from crate.db.queries.subsonic_artist_album_queries import get_album_with_artist

        result = get_album_with_artist(99999)
        assert result is None

    def test_artist_id_populated_via_left_join(self, pg_db):
        from crate.db.queries.subsonic_artist_album_queries import get_album_with_artist

        artist_id = _make_artist(pg_db, "Join Test Artist")
        album_id = _make_album(pg_db, "Join Test Artist", "Join Test Album")

        result = get_album_with_artist(album_id)
        assert result is not None
        assert result["name"] == "Join Test Album"
        assert result["artist"] == "Join Test Artist"
        assert result["artist_id"] == artist_id


class TestGetAlbumList:
    def test_respects_limit(self, pg_db):
        from crate.db.queries.subsonic_artist_album_queries import get_album_list

        _make_artist(pg_db, "List Artist")
        for i in range(5):
            _make_album(pg_db, "List Artist", f"Album {i}")

        result = get_album_list(order="a.name", size=3, offset=0)
        assert len(result) == 3

    def test_respects_offset(self, pg_db):
        from crate.db.queries.subsonic_artist_album_queries import get_album_list

        _make_artist(pg_db, "Offset Artist")
        for i in range(5):
            _make_album(pg_db, "Offset Artist", f"Album {i:02d}")

        page1 = get_album_list(order="a.name", size=3, offset=0)
        page2 = get_album_list(order="a.name", size=3, offset=3)

        assert len(page1) == 3
        assert len(page2) == 2
        # pages should not overlap
        p1_ids = {r["id"] for r in page1}
        p2_ids = {r["id"] for r in page2}
        assert p1_ids.isdisjoint(p2_ids)

    def test_offset_beyond_end_returns_empty(self, pg_db):
        from crate.db.queries.subsonic_artist_album_queries import get_album_list

        _make_artist(pg_db, "Big Artist")
        for i in range(2):
            _make_album(pg_db, "Big Artist", f"Album {i}")

        result = get_album_list(order="a.name", size=10, offset=100)
        assert result == []

    def test_returns_artist_id_for_each_album(self, pg_db):
        from crate.db.queries.subsonic_artist_album_queries import get_album_list

        artist_id = _make_artist(pg_db, "Join Artist")
        _make_album(pg_db, "Join Artist", "Join Album", year="2023")

        result = get_album_list(order="a.name", size=10, offset=0)
        assert len(result) >= 1
        album = next(r for r in result if r["name"] == "Join Album")
        assert album["artist_id"] == artist_id


# ── Search queries ───────────────────────────────────────────────────


class TestSearchArtists:
    def test_matches_partial_name(self, pg_db):
        from crate.db.queries.subsonic_search_queries import search_artists

        _make_artist(pg_db, "Metallica")
        _make_artist(pg_db, "The Beatles")
        _make_artist(pg_db, "Megadeth")

        result = search_artists(query="%etal%", limit=10)
        names = {r["name"] for r in result}
        assert names == {"Metallica"}

    def test_case_insensitive_match(self, pg_db):
        from crate.db.queries.subsonic_search_queries import search_artists

        _make_artist(pg_db, "METALLICA")
        result = search_artists(query="%metallica%", limit=10)
        assert len(result) == 1
        assert result[0]["name"] == "METALLICA"

    def test_limit_behavior(self, pg_db):
        from crate.db.queries.subsonic_search_queries import search_artists

        for i in range(10):
            _make_artist(pg_db, f"Band {i:02d}")

        result = search_artists(query="%Band%", limit=3)
        assert len(result) == 3

    def test_no_match_returns_empty(self, pg_db):
        from crate.db.queries.subsonic_search_queries import search_artists

        _make_artist(pg_db, "Radiohead")
        result = search_artists(query="%Nonexistent%", limit=10)
        assert result == []

    def test_returns_id_and_name(self, pg_db):
        from crate.db.queries.subsonic_search_queries import search_artists

        _make_artist(pg_db, "Search Me")
        result = search_artists(query="%Search Me%", limit=1)

        assert len(result) == 1
        assert set(result[0].keys()) == {"id", "name"}


class TestSearchAlbums:
    def test_matches_album_name(self, pg_db):
        from crate.db.queries.subsonic_search_queries import search_albums

        _make_artist(pg_db, "Rush")
        _make_album(pg_db, "Rush", "Moving Pictures", year="1981")
        _make_album(pg_db, "Rush", "Signals", year="1982")

        result = search_albums(query="%Moving%", limit=10)
        assert len(result) == 1
        assert result[0]["name"] == "Moving Pictures"

    def test_includes_artist_id(self, pg_db):
        from crate.db.queries.subsonic_search_queries import search_albums

        artist_id = _make_artist(pg_db, "Pink Floyd")
        _make_album(pg_db, "Pink Floyd", "The Wall", year="1979")

        result = search_albums(query="%Wall%", limit=10)
        assert len(result) == 1
        assert result[0]["artist_id"] == artist_id
        assert result[0]["artist"] == "Pink Floyd"

    def test_case_insensitive(self, pg_db):
        from crate.db.queries.subsonic_search_queries import search_albums

        _make_artist(pg_db, "Test Artist")
        _make_album(pg_db, "Test Artist", "LOUD ALBUM")

        result = search_albums(query="%loud%", limit=10)
        assert len(result) == 1

    def test_limit_respected(self, pg_db):
        from crate.db.queries.subsonic_search_queries import search_albums

        _make_artist(pg_db, "Match Artist")
        for i in range(5):
            _make_album(pg_db, "Match Artist", f"Match Album {i}")

        result = search_albums(query="%Match%", limit=2)
        assert len(result) == 2

    def test_no_match_returns_empty(self, pg_db):
        from crate.db.queries.subsonic_search_queries import search_albums

        _make_artist(pg_db, "Coldplay")
        _make_album(pg_db, "Coldplay", "Parachutes")

        result = search_albums(query="%Ghost Album%", limit=10)
        assert result == []


class TestSearchTracks:
    def test_matches_by_title(self, pg_db):
        from crate.db.queries.subsonic_search_queries import search_tracks

        _make_artist(pg_db, "Track Artist")
        album_id = _make_album(pg_db, "Track Artist", "Track Album")
        _make_track(pg_db, album_id, "Track Artist", "Track Album", "Yellow Submarine")
        _make_track(pg_db, album_id, "Track Artist", "Track Album", "Help")

        result = search_tracks(query="%Submarine%", limit=10)
        assert len(result) == 1
        assert result[0]["title"] == "Yellow Submarine"

    def test_matches_by_artist_name(self, pg_db):
        from crate.db.queries.subsonic_search_queries import search_tracks

        _make_artist(pg_db, "Fleetwood Mac")
        album_id = _make_album(pg_db, "Fleetwood Mac", "Rumours")
        _make_track(pg_db, album_id, "Fleetwood Mac", "Rumours", "Dreams")

        result = search_tracks(query="%Fleetwood%", limit=10)
        assert len(result) == 1
        assert result[0]["artist"] == "Fleetwood Mac"

    def test_matches_either_title_or_artist(self, pg_db):
        from crate.db.queries.subsonic_search_queries import search_tracks

        _make_artist(pg_db, "Deftones")
        album1 = _make_album(pg_db, "Deftones", "White Pony")
        _make_track(pg_db, album1, "Deftones", "White Pony", "Change")

        _make_artist(pg_db, "Smashing Pumpkins")
        album2 = _make_album(pg_db, "Smashing Pumpkins", "Siamese Dream")
        _make_track(pg_db, album2, "Smashing Pumpkins", "Siamese Dream", "Mayonaise")

        result = search_tracks(query="%Pumpkins%", limit=10)
        assert len(result) == 1
        assert result[0]["artist"] == "Smashing Pumpkins"

    def test_limit_behavior(self, pg_db):
        from crate.db.queries.subsonic_search_queries import search_tracks

        _make_artist(pg_db, "Match All")
        album = _make_album(pg_db, "Match All", "Match Album")
        for i in range(5):
            _make_track(pg_db, album, "Match All", "Match Album", f"Match Track {i}")

        result = search_tracks(query="%Match Track%", limit=3)
        assert len(result) == 3

    def test_no_match_returns_empty(self, pg_db):
        from crate.db.queries.subsonic_search_queries import search_tracks

        _make_artist(pg_db, "Quiet")
        album = _make_album(pg_db, "Quiet", "Silence")
        _make_track(pg_db, album, "Quiet", "Silence", "Hush")

        result = search_tracks(query="%Thunder%", limit=10)
        assert result == []

    def test_returns_album_and_artist_join_fields(self, pg_db):
        from crate.db.queries.subsonic_search_queries import search_tracks

        artist_id = _make_artist(pg_db, "Join Band")
        album_id = _make_album(pg_db, "Join Band", "Join Album")
        _make_track(
            pg_db,
            album_id,
            "Join Band",
            "Join Album",
            "Join Track",
            format="mp3",
            bitrate=320,
        )

        result = search_tracks(query="%Join Track%", limit=1)
        assert len(result) == 1

        track = result[0]
        assert track["album_id"] == album_id
        assert track["artist_id"] == artist_id
        assert track["format"] == "mp3"
        assert track["bitrate"] == 320
        assert "has_cover" in track
        assert "duration" in track


# ── Track queries ────────────────────────────────────────────────────


class TestGetTracksByAlbumId:
    def test_returns_tracks_ordered_by_disc_then_track(self, pg_db):
        from crate.db.queries.subsonic_track_queries import get_tracks_by_album_id

        _make_artist(pg_db, "Track Order Artist")
        album_id = _make_album(pg_db, "Track Order Artist", "Sorted Album")
        _make_track(
            pg_db,
            album_id,
            "Track Order Artist",
            "Sorted Album",
            "Track B",
            disc_number=1,
            track_number=2,
        )
        _make_track(
            pg_db,
            album_id,
            "Track Order Artist",
            "Sorted Album",
            "Track A",
            disc_number=1,
            track_number=1,
        )
        _make_track(
            pg_db,
            album_id,
            "Track Order Artist",
            "Sorted Album",
            "Disc 2 Track",
            disc_number=2,
            track_number=1,
        )

        result = get_tracks_by_album_id(album_id)
        assert len(result) == 3
        assert [r["title"] for r in result] == ["Track A", "Track B", "Disc 2 Track"]

    def test_defaults_disc_to_1_and_track_to_0(self, pg_db):
        from crate.db.queries.subsonic_track_queries import get_tracks_by_album_id

        _make_artist(pg_db, "Defaults Artist")
        album_id = _make_album(pg_db, "Defaults Artist", "Defaults Album")
        _make_track(pg_db, album_id, "Defaults Artist", "Defaults Album", "No Numbers")

        result = get_tracks_by_album_id(album_id)
        assert len(result) == 1
        assert result[0]["disc"] == 1
        assert result[0]["track"] == 0
        assert result[0]["title"] == "No Numbers"

    def test_album_with_no_tracks_returns_empty(self, pg_db):
        from crate.db.queries.subsonic_track_queries import get_tracks_by_album_id

        _make_artist(pg_db, "Empty Album Artist")
        album_id = _make_album(pg_db, "Empty Album Artist", "Empty Album")

        result = get_tracks_by_album_id(album_id)
        assert result == []

    def test_nonexistent_album_returns_empty(self, pg_db):
        from crate.db.queries.subsonic_track_queries import get_tracks_by_album_id

        result = get_tracks_by_album_id(99999)
        assert result == []

    def test_returns_expected_fields(self, pg_db):
        from crate.db.queries.subsonic_track_queries import get_tracks_by_album_id

        _make_artist(pg_db, "Fields Artist")
        album_id = _make_album(pg_db, "Fields Artist", "Fields Album")
        _make_track(
            pg_db,
            album_id,
            "Fields Artist",
            "Fields Album",
            "Fields Track",
            format="flac",
            bitrate=1411,
            sample_rate=44100,
        )

        result = get_tracks_by_album_id(album_id)
        assert len(result) == 1

        track = result[0]
        expected_keys = {
            "id",
            "title",
            "artist",
            "album",
            "path",
            "duration",
            "track",
            "disc",
            "format",
            "bitrate",
            "sample_rate",
        }
        assert set(track.keys()) == expected_keys
        assert track["format"] == "flac"
        assert track["bitrate"] == 1411
        assert track["sample_rate"] == 44100


class TestGetTrackFull:
    def test_returns_full_track_with_album_and_artist(self, pg_db):
        from crate.db.queries.subsonic_track_queries import get_track_full

        artist_id = _make_artist(pg_db, "Full Artist")
        album_id = _make_album(
            pg_db, "Full Artist", "Full Album", year="2023", total_duration=360.0
        )
        track_id = _make_track(
            pg_db,
            album_id,
            "Full Artist",
            "Full Album",
            "Full Track",
            track_number=3,
            disc_number=1,
            format="flac",
            bitrate=1411,
        )

        result = get_track_full(track_id)
        assert result is not None
        assert result["title"] == "Full Track"
        assert result["artist"] == "Full Artist"
        assert result["album"] == "Full Album"
        assert result["album_id"] == album_id
        assert result["artist_id"] == artist_id
        assert result["has_cover"] is not None
        assert result["year"] == "2023"
        assert result["track_number"] == 3
        assert result["disc_number"] == 1
        assert result["format"] == "flac"
        assert result["bitrate"] == 1411

    def test_nonexistent_track_returns_none(self, pg_db):
        from crate.db.queries.subsonic_track_queries import get_track_full

        result = get_track_full(99999)
        assert result is None

    def test_track_without_album_still_returns_data(self, pg_db):
        from crate.db.queries.subsonic_track_queries import get_track_full
        from crate.db.tx import transaction_scope

        _make_artist(pg_db, "Orphan Track Artist")
        track_path = "/music/Orphan Track Artist/orphan.flac"
        pg_db.upsert_track(
            {
                "album_id": None,
                "artist": "Orphan Track Artist",
                "album": "Unknown Album",
                "filename": "orphan.flac",
                "title": "Orphan Track",
                "path": track_path,
                "duration": 200.0,
                "size": 2048,
                "format": "mp3",
            }
        )

        with transaction_scope() as session:
            row = (
                session.execute(
                    text("SELECT id FROM library_tracks WHERE path = :path"),
                    {"path": track_path},
                )
                .mappings()
                .first()
            )
        track_id = row["id"]

        result = get_track_full(track_id)
        assert result is not None
        assert result["title"] == "Orphan Track"
        assert result["album_id"] is None
        assert result["has_cover"] is None


class TestGetTrackPathAndFormat:
    def test_returns_path_and_format(self, pg_db):
        from crate.db.queries.subsonic_track_queries import get_track_path_and_format

        _make_artist(pg_db, "Path Artist")
        album_id = _make_album(pg_db, "Path Artist", "Path Album")
        track_id = _make_track(
            pg_db, album_id, "Path Artist", "Path Album", "Path Track", format="mp3"
        )

        result = get_track_path_and_format(track_id)
        assert result is not None
        assert set(result.keys()) == {"path", "format"}
        assert result["format"] == "mp3"
        assert result["path"].endswith("Path_Track.flac")

    def test_nonexistent_track_returns_none(self, pg_db):
        from crate.db.queries.subsonic_track_queries import get_track_path_and_format

        result = get_track_path_and_format(99999)
        assert result is None


class TestGetTrackBasic:
    def test_returns_basic_fields(self, pg_db):
        from crate.db.queries.subsonic_track_queries import get_track_basic

        _make_artist(pg_db, "Basic Artist")
        album_id = _make_album(pg_db, "Basic Artist", "Basic Album")
        track_id = _make_track(
            pg_db, album_id, "Basic Artist", "Basic Album", "Basic Track"
        )

        result = get_track_basic(track_id)
        assert result is not None
        assert set(result.keys()) == {"title", "artist", "album"}
        assert result["title"] == "Basic Track"
        assert result["artist"] == "Basic Artist"
        assert result["album"] == "Basic Album"

    def test_nonexistent_track_returns_none(self, pg_db):
        from crate.db.queries.subsonic_track_queries import get_track_basic

        result = get_track_basic(99999)
        assert result is None


class TestGetRandomTracks:
    def test_returns_requested_count(self, pg_db):
        from crate.db.queries.subsonic_track_queries import get_random_tracks

        _make_artist(pg_db, "Random Artist")
        album_id = _make_album(pg_db, "Random Artist", "Random Album")
        for i in range(10):
            _make_track(
                pg_db, album_id, "Random Artist", "Random Album", f"Random Track {i}"
            )

        result = get_random_tracks(size=5)
        assert len(result) == 5

    def test_empty_library_returns_empty(self, pg_db):
        from crate.db.queries.subsonic_track_queries import get_random_tracks

        result = get_random_tracks(size=10)
        assert result == []

    def test_size_exceeds_library_returns_all(self, pg_db):
        from crate.db.queries.subsonic_track_queries import get_random_tracks

        _make_artist(pg_db, "Small Lib Artist")
        album_id = _make_album(pg_db, "Small Lib Artist", "Small Lib Album")
        for i in range(3):
            _make_track(
                pg_db, album_id, "Small Lib Artist", "Small Lib Album", f"Small {i}"
            )

        result = get_random_tracks(size=50)
        assert len(result) == 3

    def test_returns_full_track_data_with_joins(self, pg_db):
        from crate.db.queries.subsonic_track_queries import get_random_tracks

        artist_id = _make_artist(pg_db, "Join Random Artist")
        album_id = _make_album(
            pg_db, "Join Random Artist", "Join Random Album", year="1999"
        )
        _make_track(
            pg_db, album_id, "Join Random Artist", "Join Random Album", "Solo Track"
        )

        result = get_random_tracks(size=1)
        assert len(result) == 1

        track = result[0]
        assert track["album_id"] == album_id
        assert track["artist_id"] == artist_id
        assert track["year"] == "1999"
        assert "has_cover" in track
        assert "title" in track
        assert "artist" in track
        assert "album" in track
        assert "duration" in track
        assert "format" in track
        assert "bitrate" in track
        assert "track_number" in track
        assert "disc_number" in track


# ── User queries ─────────────────────────────────────────────────────


class TestGetUserByUsername:
    def test_returns_seeded_admin_user(self, pg_db):
        from crate.db.queries.subsonic_user_queries import get_user_by_username

        result = get_user_by_username("admin")
        assert result is not None
        assert result["email"] == "admin@cratemusic.app"
        assert result["role"] == "admin"
        assert result["username"] == "admin"

    def test_returns_all_user_fields(self, pg_db):
        from crate.db.queries.subsonic_user_queries import get_user_by_username

        result = get_user_by_username("admin")
        assert result is not None
        assert "password_hash" in result
        assert "subsonic_token" in result
        assert "created_at" in result

    def test_nonexistent_user_returns_none(self, pg_db):
        from crate.db.queries.subsonic_user_queries import get_user_by_username

        result = get_user_by_username("ghost_user_999")
        assert result is None

    def test_case_sensitive_username_match(self, pg_db):
        from crate.db.queries.subsonic_user_queries import get_user_by_username

        result = get_user_by_username("Admin")
        assert result is None  # "Admin" != "admin"
