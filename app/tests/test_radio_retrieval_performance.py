"""PostgreSQL contracts for the optimized seeded radio candidate query."""

from collections import Counter

import pytest
from sqlalchemy import event, text

from crate.db.queries.paths_bliss_candidate_queries import (
    find_seeded_radio_candidate_rows,
)
from crate.db.tx import transaction_scope
from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


@pytest.fixture
def retrieval_catalog(pg_db):
    with transaction_scope() as session:
        ids = {}
        for artist in (
            "Seed",
            "SEED",
            "Similar",
            "Genre Name",
            "Genre Slug",
            "Excluded",
            "Other",
        ):
            session.execute(
                text(
                    "INSERT INTO library_artists (name, entity_uid) VALUES (:artist, gen_random_uuid())"
                ),
                {"artist": artist},
            )
            album_id = session.execute(
                text("""
                    INSERT INTO library_albums (artist, name, path, entity_uid)
                    VALUES (:artist, 'Album', :path, gen_random_uuid()) RETURNING id
                """),
                {"artist": artist, "path": f"/music/{artist}/Album"},
            ).scalar_one()
            ids[artist] = []
            for index in range(10):
                track_id = session.execute(
                    text("""
                        INSERT INTO library_tracks (
                            album_id, artist, album, filename, title, path, entity_uid,
                            duration, format, bitrate, sample_rate, bit_depth, year,
                            bpm, audio_key, audio_scale, energy, danceability, valence,
                            bliss_vector, bliss_embedding, lastfm_playcount, rating
                        ) VALUES (
                            :album_id, :artist, 'Album', :filename, :title, :path, gen_random_uuid(),
                            180, 'flac', 900, 44100, 16, '2001',
                            :bpm, 'A', 'minor', 0.8, 0.4, 0.3,
                            :vector, CAST(:embedding AS vector(20)), :plays, :rating
                        ) RETURNING id
                    """),
                    {
                        "album_id": album_id,
                        "artist": artist,
                        "filename": f"{index}.flac",
                        "title": f"Song {index}",
                        "path": f"/music/{artist}/Album/{index}.flac",
                        "bpm": 100 + index,
                        "vector": [0.1] * 20,
                        "embedding": None
                        if index == 0
                        else str([0.1] * 19 + [index / 10]),
                        "plays": None if index in (7, 9) else 100 - index // 2,
                        "rating": None if index == 7 else index % 2,
                    },
                ).scalar_one()
                ids[artist].append(track_id)
            # Invalid candidates outrank clean tracks: filtering after the cap
            # would lose eligible replacements.
            session.execute(
                text(
                    "UPDATE library_tracks SET path = :path, lastfm_playcount = 1000 WHERE id = :id"
                ),
                {"id": ids[artist][8], "path": f"/music/{artist}/.hidden/8.flac"},
            )
            session.execute(
                text(
                    "UPDATE library_tracks SET bliss_vector = NULL, lastfm_playcount = 2000 WHERE id = :id"
                ),
                {"id": ids[artist][9]},
            )
        for name, path, quarantined in (
            ("Quarantined", "/music/Seed/Quarantined", True),
            ("Hidden Album", "/music/Seed/.cache/Hidden", False),
            (".crate-trash", "/music/Seed/Trash", False),
        ):
            invalid_album = session.execute(
                text("""
                    INSERT INTO library_albums (artist, name, path, quarantined_at)
                    VALUES ('Seed', :name, :path, CASE WHEN :quarantined THEN NOW() END)
                    RETURNING id
                """),
                {"name": name, "path": path, "quarantined": quarantined},
            ).scalar_one()
            session.execute(
                text("""
                    INSERT INTO library_tracks (
                        album_id, artist, album, filename, title, path,
                        bliss_vector, lastfm_playcount
                    ) VALUES (
                        :album_id, 'Seed', :album, 'bad.flac', 'Unplayable', :path,
                        :vector, 10000
                    )
                """),
                {
                    "album_id": invalid_album,
                    "album": name,
                    "path": f"{path}/bad.flac",
                    "vector": [0.1] * 20,
                },
            )
        for field in ("artist", "album"):
            session.execute(
                text(f"""
                    INSERT INTO library_tracks (
                        album_id, artist, album, filename, title, path,
                        bliss_vector, lastfm_playcount
                    ) SELECT album_id, {"'.CrAtE-TrAsH'" if field == "artist" else "artist"},
                             {"'.CrAtE-TrAsH'" if field == "album" else "album"},
                             :filename, 'Unplayable', :path, bliss_vector, 10000
                      FROM library_tracks WHERE id = :id
                """),
                {
                    "filename": f"bad-{field}.flac",
                    "path": f"/music/Seed/Album/bad-{field}.flac",
                    "id": ids["Seed"][0],
                },
            )
        for artist, genre in (
            ("Genre Name", "Perf Genre"),
            ("Genre Slug", "Perf-Genre"),
            ("Excluded", "Perf Genre"),
        ):
            genre_id = session.execute(
                text(
                    "INSERT INTO genres (name, slug) VALUES (:name, :slug) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id"
                ),
                {
                    "name": genre,
                    "slug": genre.lower().replace(" ", "-")
                    + artist.replace(" ", "").lower(),
                },
            ).scalar_one()
            session.execute(
                text(
                    "INSERT INTO artist_genres (artist_name, genre_id, source, weight) VALUES (:artist, :genre, 'test', 1)"
                ),
                {"artist": artist, "genre": genre_id},
            )
        session.execute(
            text(
                "UPDATE genres SET name = 'Different Label', slug = 'perf-slug' WHERE id = (SELECT genre_id FROM artist_genres WHERE artist_name = 'Genre Slug')"
            )
        )
        yield session, ids


def _query(
    session, *, optimized=False, exclude_ids=None, limit=1120, artist_pick_multiplier=1
):
    return find_seeded_radio_candidate_rows(
        [0.1] * 20,
        exclude_ids or set(),
        seed_artists=[" Seed ", "seed"],
        similar_artist_keys=["seed", " SIMILAR "],
        seed_genres=[" PERF GENRE ", "perf-slug"],
        excluded_artist_keys=[" EXCLUDED "],
        limit=limit,
        optimized=optimized,
        artist_pick_multiplier=artist_pick_multiplier,
        session=session,
    )


def test_optimized_retrieval_preserves_rows_signals_and_artist_caps(retrieval_catalog):
    session, ids = retrieval_catalog
    legacy = _query(session)
    optimized = _query(session, optimized=True)

    assert {row["id"]: row for row in optimized} == {row["id"]: row for row in legacy}
    assert Counter(row["radio_source"] for row in optimized) == {
        "seed": 4,
        "similar": 6,
        "genre": 4,
    }
    assert Counter(row["artist"].lower() for row in optimized)["seed"] == 4
    assert all(row["artist"] not in ("Other", "Excluded") for row in optimized)
    assert all(row["id"] not in ids[row["artist"]][8:] for row in optimized)
    assert all(row["title"] != "Unplayable" for row in optimized)
    assert any(row["distance"] == 1.0 for row in optimized)


def test_optimized_retrieval_excludes_before_artist_caps(retrieval_catalog):
    session, _ = retrieval_catalog
    initial = _query(session)
    excluded = {row["id"] for row in initial}
    legacy = _query(session, exclude_ids=excluded)
    optimized = _query(session, optimized=True, exclude_ids=excluded)

    assert {row["id"]: row for row in optimized} == {row["id"]: row for row in legacy}
    assert not excluded.intersection(row["id"] for row in optimized)
    assert Counter(row["radio_source"] for row in optimized) == {
        "seed": 4,
        "similar": 2,
        "genre": 4,
    }


def test_optimized_retrieval_uses_one_select_and_stable_limit_ties(retrieval_catalog):
    session, _ = retrieval_catalog
    all_rows = _query(session)
    statements = []

    def record(_connection, _cursor, statement, *_args):
        if statement.lstrip().upper().startswith(("SELECT", "WITH")):
            statements.append(statement)

    connection = session.connection()
    event.listen(connection, "before_cursor_execute", record)
    try:
        rows = _query(session, optimized=True, limit=11)
    finally:
        event.remove(connection, "before_cursor_execute", record)

    expected = sorted(
        all_rows,
        key=lambda row: (
            row["radio_source_rank"],
            row["artist_pick"],
            row["distance"],
            row["id"],
        ),
    )
    assert rows == expected[:11]
    assert len(statements) == 1


def test_optimized_retrieval_expands_caps_after_excludes_and_playability(
    retrieval_catalog,
):
    session, ids = retrieval_catalog
    legacy = _query(session)
    expanded = _query(session, optimized=True, artist_pick_multiplier=2)
    assert {row["id"] for row in legacy} <= {row["id"] for row in expanded}
    assert Counter(row["radio_source"] for row in expanded) == {
        "seed": 8,
        "similar": 8,
        "genre": 8,
    }
    excluded = {row["id"] for row in legacy}
    replacements = _query(
        session, optimized=True, artist_pick_multiplier=2, exclude_ids=excluded
    )
    assert Counter(row["radio_source"] for row in replacements) == {
        "seed": 8,
        "similar": 2,
        "genre": 8,
    }
    assert not excluded.intersection(row["id"] for row in replacements)
    assert all(row["id"] not in ids[row["artist"]][8:] for row in replacements)
    assert all(row["title"] != "Unplayable" for row in replacements)
    assert all(row["artist_pick"] <= 8 for row in replacements)
    assert _query(session, artist_pick_multiplier=2) == legacy
    assert _query(session, optimized=True, artist_pick_multiplier=0) == _query(
        session, optimized=True
    )
    assert _query(session, optimized=True, artist_pick_multiplier=5) == _query(
        session, optimized=True, artist_pick_multiplier=4
    )
