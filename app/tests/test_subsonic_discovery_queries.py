from contextlib import contextmanager

import pytest
from sqlalchemy import text

from crate.db.queries import subsonic_discovery
from tests.conftest import PG_AVAILABLE


class _Result:
    def __init__(self, rows=None):
        self.rows = rows or []

    def mappings(self):
        return self

    def all(self):
        return self.rows


class _Session:
    def __init__(self, rows=None):
        self.calls = []
        self.rows = rows or []

    def execute(self, statement, params=None):
        self.calls.append((str(statement), params or {}))
        return _Result(self.rows)


@pytest.fixture
def session(monkeypatch):
    fake_session = _Session()

    @contextmanager
    def fake_read_scope():
        yield fake_session

    monkeypatch.setattr(subsonic_discovery, "read_scope", fake_read_scope)
    return fake_session


def test_top_song_query_uses_stored_rank_signals_and_playable_local_rows(session):
    subsonic_discovery.get_top_songs_for_artist("artist-uid", limit=1000)

    statement, params = session.calls[0]
    assert "local_track.lastfm_top_rank ASC NULLS LAST" in statement
    assert "local_track.spotify_top_rank ASC NULLS LAST" in statement
    assert "local_track.lastfm_playcount DESC NULLS LAST" in statement
    assert "album.quarantined_at IS NULL" in statement
    assert "entity.has_local OR EXISTS" in statement
    assert params["artist_uid"] == "artist-uid"
    assert params["limit"] == 500
    assert params["entity_type"] == "track"


@pytest.mark.parametrize(
    ("kind", "column"),
    [
        ("artist", "entity.global_artist_uid"),
        ("album", "entity.global_album_uid"),
        ("track", "entity.global_track_uid"),
    ],
)
def test_bliss_seed_queries_only_select_the_requested_entity_scope(
    session, kind, column
):
    subsonic_discovery.get_discovery_seed_tracks(kind, "entity-uid")

    statement, params = session.calls[0]
    assert f"{column} = CAST(:entity_uid AS UUID)" in statement
    assert "local_track.bliss_vector IS NOT NULL" in statement
    assert "album.quarantined_at IS NULL" in statement
    assert params["entity_uid"] == "entity-uid"
    assert params["entity_type"] == "track"


def test_invalid_bliss_seed_kind_does_not_query(session):
    assert subsonic_discovery.get_discovery_seed_tracks("playlist", "any") == []
    assert session.calls == []


def test_bulk_global_track_lookup_preserves_local_ids(session):
    session.rows = [
        {"local_track_id": 12, "global_track_uid": "first"},
        {"local_track_id": 18, "global_track_uid": "second"},
    ]

    tracks = subsonic_discovery.get_global_tracks_by_local_ids([12, 18, 12])

    assert tracks == {
        12: {"local_track_id": 12, "global_track_uid": "first"},
        18: {"local_track_id": 18, "global_track_uid": "second"},
    }
    assert session.calls[0][1]["track_ids"] == [12, 18]


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_discovery_queries_read_ranked_tracks_and_bliss_seeds(pg_db):
    from crate.db.queries.bliss_similarity_candidates import get_bliss_candidates
    from crate.db.queries.subsonic_discovery import (
        get_discovery_seed_tracks,
        get_global_tracks_by_local_ids,
        get_top_songs_for_artist,
    )
    from crate.db.queries.subsonic_global import (
        get_global_artist_by_local_id,
    )
    from crate.db.tx import read_scope, transaction_scope
    from crate.federation.global_reconciliation import reconcile_local_catalog

    artist_name = "OpenSubsonic Discovery Fixture"
    pg_db.upsert_artist({"name": artist_name})
    album_id = pg_db.upsert_album(
        {
            "artist": artist_name,
            "name": "Signals",
            "path": f"/music/{artist_name}/Signals",
            "track_count": 2,
        }
    )
    for track_number, title in enumerate(("First", "Second"), start=1):
        pg_db.upsert_track(
            {
                "album_id": album_id,
                "artist": artist_name,
                "album": "Signals",
                "filename": f"{track_number:02d} - {title}.flac",
                "title": title,
                "path": f"/music/{artist_name}/Signals/{track_number:02d} - {title}.flac",
                "duration": 180.0,
                "format": "flac",
                "track_number": track_number,
            }
        )
    reconcile_local_catalog()

    vector = [0.1] * 20
    vector_literal = "[" + ",".join(str(value) for value in vector) + "]"
    with read_scope() as session:
        track_rows = (
            session.execute(
                text(
                    "SELECT id, title FROM library_tracks "
                    "WHERE artist = :artist ORDER BY track_number"
                ),
                {"artist": artist_name},
            )
            .mappings()
            .all()
        )
    track_ids = [int(row["id"]) for row in track_rows]
    with transaction_scope() as session:
        for rank, track_id in enumerate(track_ids, start=1):
            session.execute(
                text(
                    "UPDATE library_tracks SET lastfm_top_rank = :rank, "
                    "bliss_vector = :vector, "
                    "bliss_embedding = CAST(:vector_literal AS vector(20)) "
                    "WHERE id = :track_id"
                ),
                {
                    "rank": rank,
                    "vector": vector,
                    "vector_literal": vector_literal,
                    "track_id": track_id,
                },
            )

    with read_scope() as session:
        local_artist_id = int(
            session.execute(
                text("SELECT id FROM library_artists WHERE name = :artist"),
                {"artist": artist_name},
            ).scalar_one()
        )
    artist = get_global_artist_by_local_id(local_artist_id)
    assert artist is not None
    top_tracks = get_top_songs_for_artist(artist["global_artist_uid"], limit=10)
    assert [track["title"] for track in top_tracks] == ["First", "Second"]

    seeds = get_discovery_seed_tracks("artist", artist["global_artist_uid"])
    assert {int(seed["track_id"]) for seed in seeds} == set(track_ids)
    global_tracks = get_global_tracks_by_local_ids(track_ids)
    assert set(global_tracks) == set(track_ids)
    assert [global_tracks[track_id]["title"] for track_id in track_ids] == [
        "First",
        "Second",
    ]
    assert len({track["global_track_uid"] for track in global_tracks.values()}) == 2

    assert (
        get_bliss_candidates(
            bliss_vector=vector,
            exclude_paths=[str(seed["path"]) for seed in seeds],
            limit=10,
        )
        == []
    )
