import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _seed_genre_playlist_fixture(pg_db):
    artist_name = "Genre Weight Band"
    pg_db.upsert_artist(
        {
            "name": artist_name,
            "album_count": 2,
            "track_count": 2,
            "total_size": 0,
            "formats": ["flac"],
        }
    )

    album_high_id = pg_db.upsert_album(
        {
            "artist": artist_name,
            "name": "Heavy Record",
            "path": "/music/genre-weight-band/heavy-record",
            "track_count": 1,
            "total_size": 0,
            "formats": ["flac"],
            "year": "2001",
        }
    )
    album_low_id = pg_db.upsert_album(
        {
            "artist": artist_name,
            "name": "Sideways Record",
            "path": "/music/genre-weight-band/sideways-record",
            "track_count": 1,
            "total_size": 0,
            "formats": ["flac"],
            "year": "2003",
        }
    )

    high_track_path = "/music/genre-weight-band/heavy-record/01-zulu-anthems.flac"
    low_track_path = "/music/genre-weight-band/sideways-record/01-alpha-whisper.flac"

    pg_db.upsert_track(
        {
            "album_id": album_high_id,
            "artist": artist_name,
            "album": "Heavy Record",
            "filename": "01-zulu-anthems.flac",
            "title": "Zulu Anthems",
            "track_number": 1,
            "format": "flac",
            "duration": 180,
            "size": 123,
            "path": high_track_path,
            "popularity_score": 0.2,
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_low_id,
            "artist": artist_name,
            "album": "Sideways Record",
            "filename": "01-alpha-whisper.flac",
            "title": "Alpha Whisper",
            "track_number": 1,
            "format": "flac",
            "duration": 180,
            "size": 123,
            "path": low_track_path,
            "popularity_score": 0.1,
        }
    )

    pg_db.set_artist_genres(
        artist_name,
        [
            ("metalcore", 0.35, "enrichment"),
            ("hardcore", 1.0, "enrichment"),
        ],
    )
    pg_db.set_album_genres(
        album_high_id,
        [
            ("metalcore", 1.0, "tags"),
            ("hardcore", 0.4, "tags"),
        ],
    )
    pg_db.set_album_genres(
        album_low_id,
        [
            ("hardcore", 1.0, "tags"),
        ],
    )

    high_track_id = pg_db.get_library_track_by_path(high_track_path)["id"]
    low_track_id = pg_db.get_library_track_by_path(low_track_path)["id"]

    return {
        "high_track_id": high_track_id,
        "low_track_id": low_track_id,
    }


def _seed_smart_playlist_artist(
    pg_db,
    *,
    artist_name: str,
    genre: str,
    track_count: int,
    popularity_start: float,
) -> list[int]:
    pg_db.upsert_artist(
        {
            "name": artist_name,
            "album_count": 1,
            "track_count": track_count,
            "total_size": 0,
            "formats": ["flac"],
        }
    )
    album_id = pg_db.upsert_album(
        {
            "artist": artist_name,
            "name": f"{artist_name} LP",
            "path": f"/music/{artist_name.lower().replace(' ', '-')}/lp",
            "track_count": track_count,
            "total_size": 0,
            "formats": ["flac"],
            "year": "2001",
        }
    )
    track_ids: list[int] = []
    for index in range(track_count):
        path = (
            f"/music/{artist_name.lower().replace(' ', '-')}/lp/"
            f"{index + 1:02d}-track-{index + 1}.flac"
        )
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": artist_name,
                "album": f"{artist_name} LP",
                "filename": f"{index + 1:02d}-track-{index + 1}.flac",
                "title": f"Track {index + 1}",
                "track_number": index + 1,
                "format": "flac",
                "duration": 180,
                "size": 123,
                "path": path,
                "genre": genre,
                "popularity_score": popularity_start - index * 0.01,
            }
        )
        track_ids.append(pg_db.get_library_track_by_path(path)["id"])
    return track_ids


def test_execute_smart_rules_prefers_higher_genre_weight(pg_db):
    from crate.db.playlists import execute_smart_rules

    seeded = _seed_genre_playlist_fixture(pg_db)

    results = execute_smart_rules(
        {
            "match": "all",
            "rules": [{"field": "genre", "op": "contains", "value": "metalcore"}],
            "limit": 10,
            "sort": "title",
        }
    )

    assert [track["id"] for track in results[:2]] == [
        seeded["high_track_id"],
        seeded["low_track_id"],
    ]


def test_generate_by_genre_prefers_direct_album_signal(pg_db):
    from crate.db.playlists import generate_by_genre

    seeded = _seed_genre_playlist_fixture(pg_db)

    results = generate_by_genre("metalcore", limit=10)

    assert results[:2] == [seeded["high_track_id"], seeded["low_track_id"]]


def test_execute_smart_rules_caps_genre_playlists_by_artist_by_default(pg_db):
    from collections import Counter

    from crate.db.playlists import execute_smart_rules

    _seed_smart_playlist_artist(
        pg_db,
        artist_name="Dominant Screamo Band",
        genre="screamo",
        track_count=6,
        popularity_start=1.0,
    )
    _seed_smart_playlist_artist(
        pg_db,
        artist_name="Second Screamo Band",
        genre="screamo",
        track_count=2,
        popularity_start=0.5,
    )
    _seed_smart_playlist_artist(
        pg_db,
        artist_name="Third Screamo Band",
        genre="screamo",
        track_count=2,
        popularity_start=0.4,
    )

    results = execute_smart_rules(
        {
            "match": "all",
            "rules": [{"field": "genre", "op": "contains", "value": "screamo"}],
            "limit": 6,
            "sort": "popularity",
        }
    )

    counts = Counter(track["artist"] for track in results)
    assert len(results) == 6
    assert max(counts.values()) == 2
    assert set(counts) == {
        "Dominant Screamo Band",
        "Second Screamo Band",
        "Third Screamo Band",
    }


def test_execute_smart_rules_backfills_with_related_genres_before_repeating_artists(
    pg_db, monkeypatch
):
    from collections import Counter

    from crate.db.playlists import execute_smart_rules

    _seed_smart_playlist_artist(
        pg_db,
        artist_name="Core Screamo One",
        genre="screamo",
        track_count=2,
        popularity_start=1.0,
    )
    _seed_smart_playlist_artist(
        pg_db,
        artist_name="Core Screamo Two",
        genre="screamo",
        track_count=2,
        popularity_start=0.9,
    )
    _seed_smart_playlist_artist(
        pg_db,
        artist_name="Adjacent Post Hardcore One",
        genre="post-hardcore",
        track_count=1,
        popularity_start=0.8,
    )
    _seed_smart_playlist_artist(
        pg_db,
        artist_name="Adjacent Post Hardcore Two",
        genre="post-hardcore",
        track_count=1,
        popularity_start=0.7,
    )
    monkeypatch.setattr(
        "crate.db.repositories.playlists_rule_engine_executor.get_related_genre_terms",
        lambda value, limit=16: ["screamo", "post-hardcore"],
    )

    results = execute_smart_rules(
        {
            "match": "all",
            "rules": [{"field": "genre", "op": "contains", "value": "screamo"}],
            "limit": 6,
            "sort": "popularity",
        }
    )

    counts = Counter(track["artist"] for track in results)
    assert len(results) == 6
    assert max(counts.values()) <= 2
    assert "Adjacent Post Hardcore One" in counts
    assert "Adjacent Post Hardcore Two" in counts
