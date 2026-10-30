"""The album owner FK keeps case variants reachable without widening identity joins."""

from uuid import uuid4

import pytest
from sqlalchemy import event, text

from crate.db.queries.paths_bliss_candidate_queries import (
    find_seeded_radio_candidate_rows,
)
from crate.db.tx import transaction_scope


@pytest.fixture
def artist_case_catalog(pg_db, request):
    album_artist = request.param
    artist_uids = {name: str(uuid4()) for name in ("Citizen", "CITIZEN", "cItIzEn")}
    with transaction_scope() as session:
        # The exact owner row is required by library_albums.artist's FK.
        for name, entity_uid in artist_uids.items():
            session.execute(
                text(
                    "INSERT INTO library_artists (name, entity_uid) "
                    "VALUES (:name, CAST(:entity_uid AS uuid))"
                ),
                {"name": name, "entity_uid": entity_uid},
            )
        album_id = session.execute(
            text("""
                INSERT INTO library_albums (artist, name, path, entity_uid)
                VALUES (:artist, 'Case Album', '/music/case/album', gen_random_uuid())
                RETURNING id
            """),
            {"artist": album_artist},
        ).scalar_one()
        track_ids = []
        for index in range(8):
            track_ids.append(
                session.execute(
                    text("""
                        INSERT INTO library_tracks (
                            album_id, artist, album, filename, title, path, entity_uid,
                            duration, format, bitrate, sample_rate, bit_depth, year,
                            bpm, audio_key, audio_scale, energy, danceability, valence,
                            bliss_vector, bliss_embedding, lastfm_playcount, rating
                        ) VALUES (
                            :album_id, 'Citizen', 'Case Album', :filename, :title, :path,
                            gen_random_uuid(), 180, 'flac', 900, 44100, 16, '2001',
                            :bpm, 'A', 'minor', 0.8, 0.4, 0.3,
                            :vector, CAST(:embedding AS vector(20)), :plays, :rating
                        ) RETURNING id
                    """),
                    {
                        "album_id": album_id,
                        "filename": f"{index}.flac",
                        "title": f"Case Song {index}",
                        "path": f"/music/case/album/{index}.flac",
                        "bpm": 120 + index,
                        "vector": [0.1] * 20,
                        "embedding": None
                        if index == 0
                        else str([0.1] * 19 + [index / 10]),
                        "plays": 100 - index,
                        "rating": index % 2,
                    },
                ).scalar_one()
            )
        genre_id = session.execute(
            text("""
                INSERT INTO genres (name, slug)
                VALUES ('Case Artist Genre', 'case-artist-genre') RETURNING id
            """)
        ).scalar_one()
        session.execute(
            text("""
                INSERT INTO artist_genres (artist_name, genre_id, source, weight)
                VALUES ('Citizen', :genre_id, 'test', 1)
            """),
            {"genre_id": genre_id},
        )
        yield session, track_ids, artist_uids[album_artist]


def _query(session, source, *, optimized, limit=50):
    return find_seeded_radio_candidate_rows(
        [0.1] * 20,
        set(),
        seed_artists=[" Citizen "] if source == "seed" else None,
        similar_artist_keys=["cItIzEn"] if source == "similar" else None,
        seed_genres=[" CASE ARTIST GENRE "] if source == "genre" else None,
        limit=limit,
        optimized=optimized,
        session=session,
    )


@pytest.mark.parametrize("artist_case_catalog", ["cItIzEn"], indirect=True)
@pytest.mark.parametrize(
    "source,cap,rank", [("seed", 4, 0), ("similar", 6, 1), ("genre", 2, 2)]
)
def test_optimized_retrieval_keeps_mixed_case_album_owner_and_query_budget(
    artist_case_catalog, source, cap, rank
):
    """Both query plans retain the exact FK owner discovered through LOWER(name)."""
    session, track_ids, owner_uid = artist_case_catalog
    selects = []

    def record(_connection, _cursor, statement, *_args):
        if statement.lstrip().upper().startswith(("SELECT", "WITH")):
            selects.append(statement)

    connection = session.connection()
    event.listen(connection, "before_cursor_execute", record)
    try:
        legacy = _query(session, source, optimized=False)
        assert len(selects) == 1
        assert [row["id"] for row in legacy] == track_ids[:cap]
        assert all(row["radio_source"] == source for row in legacy)
        assert all(row["radio_source_rank"] == rank for row in legacy)
        assert all(row["artist_entity_uid"] == owner_uid for row in legacy)
        assert legacy[0]["distance"] == 1.0
        selects.clear()
        optimized = _query(session, source, optimized=True)
        assert len(selects) == 1
        assert optimized == legacy
        selects.clear()
        assert _query(session, source, optimized=True, limit=1) == legacy[:1]
        assert len(selects) == 1
    finally:
        event.remove(connection, "before_cursor_execute", record)


@pytest.mark.parametrize("artist_case_catalog", ["Citizen"], indirect=True)
def test_optimized_retrieval_does_not_duplicate_tracks_for_case_variant_artist_rows(
    artist_case_catalog,
):
    """Context case folding must preserve the exact final artist identity join."""
    session, track_ids, canonical_uid = artist_case_catalog

    rows = _query(session, "seed", optimized=True)

    assert [row["id"] for row in rows] == track_ids[:4]
    assert len({row["id"] for row in rows}) == len(rows)
    assert all(row["artist_entity_uid"] == canonical_uid for row in rows)
    assert rows == _query(session, "seed", optimized=False)
