from contextlib import contextmanager
import pytest

from crate.db.queries import subsonic_global
from tests.conftest import PG_AVAILABLE


class _QueryResult:
    def mappings(self):
        return self

    def all(self):
        return []

    def __iter__(self):
        return iter(())


class _ReadSession:
    def __init__(self):
        self.calls = []

    def execute(self, statement, params=None):
        self.calls.append((str(statement), params or {}))
        return _QueryResult()


@pytest.fixture
def session(monkeypatch):
    fake_session = _ReadSession()

    @contextmanager
    def fake_read_scope():
        yield fake_session

    monkeypatch.setattr(subsonic_global, "read_scope", fake_read_scope)
    return fake_session


@pytest.mark.parametrize(
    ("list_type", "order_fragment"),
    [
        ("random", "ORDER BY RANDOM()"),
        ("newest", "COALESCE(entity.year, '0') DESC"),
        ("highest", "AVG(NULLIF(rated_track.rating, 0))"),
        ("frequent", "COUNT(*)"),
        ("recent", "MAX(play.ended_at)"),
        ("alphabeticalByName", "entity.canonical_name ASC"),
        ("alphabeticalByArtist", "entity.artist_name ASC"),
        ("starred", "user_global_track_likes"),
        ("byYear", "entity.year DESC"),
        ("byGenre", "global_catalog_entity_genres"),
    ],
)
def test_album_list_strategies_use_explicit_ordering(
    list_type, order_fragment, session
):
    subsonic_global.list_global_albums(
        list_type,
        size=11,
        offset=4,
        from_year=2010 if list_type == "byYear" else None,
        to_year=2000 if list_type == "byYear" else None,
        genre="post-rock" if list_type == "byGenre" else None,
        user_id=9,
        music_folder_id="1",
    )

    statement, params = session.calls[0]
    assert order_fragment in statement
    assert "LIMIT :size OFFSET :offset" in statement
    assert params["size"] == 11
    assert params["offset"] == 4
    assert params["user_id"] == 9


def test_album_list_by_year_supports_reverse_chronological_range(session):
    subsonic_global.list_global_albums(
        "byYear", size=20, offset=0, from_year=2020, to_year=2010
    )

    statement, params = session.calls[0]
    assert "BETWEEN LEAST(CAST(:from_year AS INTEGER)" in statement
    assert "ORDER BY entity.year DESC" in statement
    assert params["from_year"] == 2020
    assert params["to_year"] == 2010


def test_album_list_rejects_unknown_strategy(session):
    with pytest.raises(ValueError, match="Unsupported OpenSubsonic album list type"):
        subsonic_global.list_global_albums("unknown", size=10, offset=0)
    assert session.calls == []


def test_random_songs_query_applies_filters_and_pagination(session):
    subsonic_global.get_random_global_tracks(
        7,
        genre="post-rock",
        from_year=2001,
        to_year=2008,
        music_folder_id="1",
    )

    statement, params = session.calls[0]
    assert "ORDER BY RANDOM()" in statement
    assert "LOWER(node.name) = LOWER(:genre)" in statement
    assert "album.year::integer" in statement
    assert params == {
        "entity_type": "track",
        "limit": 7,
        "genre": "post-rock",
        "from_year": 2001,
        "to_year": 2008,
        "music_folder_id": "1",
    }


def test_songs_by_genre_query_paginates_even_for_empty_result(session):
    assert (
        subsonic_global.get_global_tracks_by_genre(
            "post-rock", size=0, offset=3, music_folder_id="1"
        )
        == []
    )
    statement, params = session.calls[0]
    assert "WITH RECURSIVE genre_tree" in statement
    assert "LIMIT :size OFFSET :offset" in statement
    assert params["size"] == 0
    assert params["offset"] == 3
    assert params["music_folder_id"] == "1"


def test_search_query_escapes_unicode_terms_and_paginates_each_kind(session):
    subsonic_global.search_global_catalog(
        "Björk %_",
        artist_limit=3,
        artist_offset=2,
        album_limit=4,
        album_offset=5,
        track_limit=6,
        track_offset=7,
        music_folder_id="1",
    )

    assert len(session.calls) == 3
    for statement, params in session.calls:
        assert "ILIKE :pattern ESCAPE" in statement
        assert "entity.has_local" in statement
        assert params["pattern"] == "%Björk \\%\\_%"
        assert params["music_folder_id"] == "1"

    assert "LIMIT :limit OFFSET :offset" in session.calls[0][0]
    assert session.calls[0][1]["limit"] == 3
    assert session.calls[0][1]["offset"] == 2
    assert "LIMIT :limit OFFSET :offset" in session.calls[1][0]
    assert session.calls[1][1]["limit"] == 4
    assert session.calls[1][1]["offset"] == 5
    assert "LIMIT :limit OFFSET :offset" in session.calls[2][0]
    assert session.calls[2][1]["limit"] == 6
    assert session.calls[2][1]["offset"] == 7


def test_legacy_search_combines_artist_album_and_title_filters(session):
    subsonic_global.search_global_catalog(
        None,
        artist_limit=0,
        album_limit=0,
        track_limit=20,
        artist_query="Björk",
        album_query="Debut",
        song_query="Human Behaviour",
    )

    statement, params = session.calls[2]
    assert "entity.artist_name ILIKE :artist_pattern" in statement
    assert "AND entity.album_name ILIKE :album_pattern" in statement
    assert "AND entity.canonical_title ILIKE :song_pattern" in statement
    assert params["artist_pattern"] == "%Björk%"
    assert params["album_pattern"] == "%Debut%"
    assert params["song_pattern"] == "%Human Behaviour%"


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_search_query_executes_with_folder_and_newer_than_filters(pg_db):
    result = subsonic_global.search_global_catalog(
        "Björk",
        music_folder_id="1",
        newer_than_ms=1,
        include_track_total=True,
    )

    assert result == {"artists": [], "albums": [], "tracks": [], "track_total": 0}


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_browse_queries_execute_and_filter_catalog_rows(pg_db):
    for list_type in (
        "random",
        "newest",
        "highest",
        "frequent",
        "recent",
        "alphabeticalByName",
        "alphabeticalByArtist",
        "starred",
        "byYear",
        "byGenre",
    ):
        result = subsonic_global.list_global_albums(
            list_type,
            size=5,
            offset=0,
            from_year=2020 if list_type == "byYear" else None,
            to_year=2000 if list_type == "byYear" else None,
            genre="post-rock" if list_type == "byGenre" else None,
            user_id=1,
        )
        assert result == []

    assert (
        subsonic_global.get_global_tracks_by_genre("post-rock", size=5, offset=0) == []
    )
    assert (
        subsonic_global.get_random_global_tracks(
            5, genre="post-rock", from_year=2000, to_year=2020
        )
        == []
    )
    assert subsonic_global.get_random_global_tracks(5, from_year=2000) == []
    assert subsonic_global.get_global_catalog_last_modified() >= 0

    pg_db.upsert_artist({"name": "OpenSubsonic Browse Fixture"})
    album_id = pg_db.upsert_album(
        {
            "artist": "OpenSubsonic Browse Fixture",
            "name": "Browse Fixture Album",
            "path": "/music/OpenSubsonic Browse Fixture/Browse Fixture Album",
            "year": "2004",
            "track_count": 1,
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "OpenSubsonic Browse Fixture",
            "album": "Browse Fixture Album",
            "filename": "01 - Browse Fixture.flac",
            "title": "Browse Fixture",
            "path": "/music/OpenSubsonic Browse Fixture/Browse Fixture Album/01 - Browse Fixture.flac",
            "duration": 100,
            "format": "flac",
        }
    )
    from crate.federation.global_reconciliation import reconcile_local_catalog

    reconcile_local_catalog()

    by_year = subsonic_global.list_global_albums(
        "byYear", size=10, offset=0, from_year=2005, to_year=2000
    )
    assert [album["name"] for album in by_year] == ["Browse Fixture Album"]
    outside_range = subsonic_global.list_global_albums(
        "byYear", size=10, offset=0, from_year=1900, to_year=1901
    )
    assert outside_range == [], outside_range
    random_unfiltered = subsonic_global.get_random_global_tracks(10)
    assert len(random_unfiltered) == 1, random_unfiltered
    assert random_unfiltered[0]["year"] == "2004", random_unfiltered[0]
    assert len(subsonic_global.get_random_global_tracks(10, from_year=2000)) == 1
    assert subsonic_global.get_random_global_tracks(10, from_year=2005) == []
    assert subsonic_global.get_random_global_tracks(10, to_year=2003) == []
    assert subsonic_global.get_random_global_tracks(0) == []
