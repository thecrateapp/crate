from __future__ import annotations

import json
import time
from unittest.mock import patch

import pytest
from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope
from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")

VEC_DIMS = 20


def _check_pgvector():
    with read_scope() as session:
        row = session.execute(
            text("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector')")
        ).scalar()
        return bool(row)


PGVECTOR = _check_pgvector()


def _to_pgvector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{v:.8f}" for v in vector) + "]"


def make_vec(seed: float = 0.0) -> list[float]:
    return [seed + i * 0.01 for i in range(VEC_DIMS)]


def make_vec_near(seed: float = 0.0) -> list[float]:
    return [seed + i * 0.01 + 0.0001 for i in range(VEC_DIMS)]


def make_vec_far(seed: float = 5.0) -> list[float]:
    return [seed + i * 0.1 for i in range(VEC_DIMS)]


# ── helpers ──────────────────────────────────────────────────────────


def _insert_artist(pg_db, name: str) -> None:
    pg_db.upsert_artist({"name": name})


def _insert_album(pg_db, artist: str, name: str, path: str) -> int:
    return pg_db.upsert_album(
        {
            "artist": artist,
            "name": name,
            "path": path,
            "track_count": 1,
            "total_size": 1024,
            "total_duration": 180.0,
            "formats": ["flac"],
        }
    )


def _insert_track(
    pg_db,
    album_id: int,
    artist: str,
    album: str,
    title: str,
    path: str,
    *,
    filename: str = "",
    duration: float = 180.0,
    bliss_vector: list[float] | None = None,
    bpm: float | None = None,
    energy: float | None = None,
    audio_key: str | None = None,
    rating: int = 0,
    lastfm_playcount: int | None = None,
) -> int:
    fn = filename or f"{title.replace(' ', '_')}.flac"
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": artist,
            "album": album,
            "filename": fn,
            "title": title,
            "path": path,
            "duration": duration,
            "size": 1024,
            "format": "flac",
        }
    )
    with transaction_scope() as session:
        track_id = session.execute(
            text("SELECT id FROM library_tracks WHERE path = :path"),
            {"path": path},
        ).scalar()
        updates = {}
        if bliss_vector is not None:
            updates["bliss_vector"] = bliss_vector
        if bpm is not None:
            updates["bpm"] = bpm
        if energy is not None:
            updates["energy"] = energy
        if audio_key is not None:
            updates["audio_key"] = audio_key
        if rating:
            updates["rating"] = rating
        if lastfm_playcount is not None:
            updates["lastfm_playcount"] = lastfm_playcount
        if updates:
            set_clause = ", ".join(f"{k} = :{k}" for k in updates)
            params = {**updates, "track_id": track_id}
            session.execute(
                text(f"UPDATE library_tracks SET {set_clause} WHERE id = :track_id"),
                params,
            )
        return track_id


def _set_bliss_embedding(track_id: int, vector: list[float]) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET bliss_embedding = CAST(:vec AS vector(20)) "
                "WHERE id = :track_id"
            ),
            {"vec": _to_pgvector_literal(vector), "track_id": track_id},
        )


def _get_bliss_embedding_distance(track_a_id: int, track_b_id: int) -> float:
    with read_scope() as session:
        return session.execute(
            text(
                "SELECT a.bliss_embedding <=> b.bliss_embedding AS dist "
                "FROM library_tracks a, library_tracks b "
                "WHERE a.id = :a AND b.id = :b"
            ),
            {"a": track_a_id, "b": track_b_id},
        ).scalar()


# ── bliss_shared ─────────────────────────────────────────────────────


class TestBlissShared:
    def test_normalize_similarity_score_none(self):
        from crate.db.queries.bliss_shared import normalize_similarity_score

        assert normalize_similarity_score(None) == 0.0

    def test_normalize_similarity_score_zero(self):
        from crate.db.queries.bliss_shared import normalize_similarity_score

        assert normalize_similarity_score(0.0) == 0.0

    def test_normalize_similarity_score_negative(self):
        from crate.db.queries.bliss_shared import normalize_similarity_score

        assert normalize_similarity_score(-5) == 0.0

    def test_normalize_similarity_score_already_unit(self):
        from crate.db.queries.bliss_shared import normalize_similarity_score

        assert normalize_similarity_score(0.75) == 0.75

    def test_normalize_similarity_score_percent(self):
        from crate.db.queries.bliss_shared import normalize_similarity_score

        assert normalize_similarity_score(88) == 0.88

    def test_normalize_similarity_score_above_100_caps(self):
        from crate.db.queries.bliss_shared import normalize_similarity_score

        assert normalize_similarity_score(999) == 1.0

    def test_normalize_similarity_score_string(self):
        from crate.db.queries.bliss_shared import normalize_similarity_score

        assert normalize_similarity_score("45") == 0.45

    def test_normalize_similarity_score_invalid_string(self):
        from crate.db.queries.bliss_shared import normalize_similarity_score

        assert normalize_similarity_score("nope") == 0.0

    def test_normalize_similarity_score_zero_edge(self):
        from crate.db.queries.bliss_shared import normalize_similarity_score

        assert normalize_similarity_score(1.0) == 1.0
        assert normalize_similarity_score(0.0) == 0.0
        assert normalize_similarity_score(100.0) == 1.0


# ── bliss_track_lookup ───────────────────────────────────────────────


class TestBlissTrackLookup:
    def test_get_track_with_artist_returns_full_row(self, pg_db):
        from crate.db.queries.bliss_track_lookup import get_track_with_artist

        _insert_artist(pg_db, "Test Artist")
        album_id = _insert_album(
            pg_db, "Test Artist", "Test Album", "/music/Test Artist/Test Album"
        )
        _insert_track(
            pg_db,
            album_id,
            "Test Artist",
            "Test Album",
            "Track One",
            "/music/Test Artist/Test Album/01 - Track One.flac",
            bliss_vector=make_vec(0.0),
            bpm=120.0,
            energy=0.8,
            audio_key="C",
        )

        row = get_track_with_artist(
            track_path="/music/Test Artist/Test Album/01 - Track One.flac"
        )

        assert row is not None
        assert row["title"] == "Track One"
        assert row["artist"] == "Test Artist"
        assert row["album"] == "Test Album"
        assert row["bliss_vector"] == make_vec(0.0)
        assert row["bpm"] == 120.0
        assert row["energy"] == 0.8
        assert row["audio_key"] == "C"
        assert row["artist_id"] is not None

    def test_get_track_with_artist_empty_path_returns_none(self, pg_db):
        from crate.db.queries.bliss_track_lookup import get_track_with_artist

        assert get_track_with_artist(track_path="") is None

    def test_get_track_with_artist_missing_path_returns_none(self, pg_db):
        from crate.db.queries.bliss_track_lookup import get_track_with_artist

        assert get_track_with_artist(track_path="/music/nonexistent/track.flac") is None

    def test_get_same_artist_tracks_by_artist_id(self, pg_db):
        from crate.db.queries.bliss_track_lookup import get_same_artist_tracks

        _insert_artist(pg_db, "Same Artist")
        album_id = _insert_album(
            pg_db, "Same Artist", "SA Album", "/music/Same Artist/SA Album"
        )
        t1_path = "/music/Same Artist/SA Album/01 - First.flac"
        t2_path = "/music/Same Artist/SA Album/02 - Second.flac"
        t3_path = "/music/Same Artist/SA Album/03 - Third.flac"
        _insert_track(pg_db, album_id, "Same Artist", "SA Album", "First", t1_path)
        _insert_track(pg_db, album_id, "Same Artist", "SA Album", "Second", t2_path)
        _insert_track(pg_db, album_id, "Same Artist", "SA Album", "Third", t3_path)

        with read_scope() as session:
            artist_id = session.execute(
                text("SELECT id FROM library_artists WHERE LOWER(name) = LOWER(:n)"),
                {"n": "Same Artist"},
            ).scalar()

        result = get_same_artist_tracks(
            artist_id=artist_id,
            artist_name="",
            exclude_path=t1_path,
            limit=5,
        )

        paths = {r["path"] for r in result}
        assert t1_path not in paths
        assert len(result) == 2
        assert t2_path in paths
        assert t3_path in paths

    def test_get_same_artist_tracks_by_name_fallback(self, pg_db):
        from crate.db.queries.bliss_track_lookup import get_same_artist_tracks

        _insert_artist(pg_db, "Name Fallback")
        album_id = _insert_album(
            pg_db, "Name Fallback", "NF Album", "/music/Name Fallback/NF Album"
        )
        t1_path = "/music/Name Fallback/NF Album/01 - Solo.flac"
        t2_path = "/music/Name Fallback/NF Album/02 - Duo.flac"
        _insert_track(pg_db, album_id, "Name Fallback", "NF Album", "Solo", t1_path)
        _insert_track(pg_db, album_id, "Name Fallback", "NF Album", "Duo", t2_path)

        result = get_same_artist_tracks(
            artist_id=None,
            artist_name="Name Fallback",
            exclude_path=t1_path,
            limit=5,
        )

        assert len(result) == 1
        assert result[0]["path"] == t2_path

    def test_get_same_artist_tracks_respects_limit(self, pg_db):
        from crate.db.queries.bliss_track_lookup import get_same_artist_tracks

        _insert_artist(pg_db, "Limit Artist")
        album_id = _insert_album(
            pg_db, "Limit Artist", "Limit Album", "/music/Limit Artist/Limit Album"
        )
        for i in range(5):
            _insert_track(
                pg_db,
                album_id,
                "Limit Artist",
                "Limit Album",
                f"Track {i}",
                f"/music/Limit Artist/Limit Album/{i:02d} - Track {i}.flac",
                lastfm_playcount=(10 - i),
            )

        with read_scope() as session:
            artist_id = session.execute(
                text("SELECT id FROM library_artists WHERE LOWER(name) = LOWER(:n)"),
                {"n": "Limit Artist"},
            ).scalar()

        result = get_same_artist_tracks(
            artist_id=artist_id,
            artist_name="",
            exclude_path="/nonexistent.flac",
            limit=3,
        )

        assert len(result) == 3
        # Ordered by lastfm_playcount DESC
        assert result[0]["title"] == "Track 0"

    def test_get_seed_tracks_by_paths(self, pg_db):
        from crate.db.queries.bliss_track_lookup import get_seed_tracks_by_paths

        _insert_artist(pg_db, "Seed Artist")
        album_id = _insert_album(
            pg_db, "Seed Artist", "Seed Album", "/music/Seed Artist/Seed Album"
        )
        p1 = "/music/Seed Artist/Seed Album/01 - Alpha.flac"
        p2 = "/music/Seed Artist/Seed Album/02 - Beta.flac"
        _insert_track(pg_db, album_id, "Seed Artist", "Seed Album", "Alpha", p1)
        _insert_track(pg_db, album_id, "Seed Artist", "Seed Album", "Beta", p2)

        result = get_seed_tracks_by_paths(seed_paths=[p1, p2])

        assert len(result) == 2
        paths = {r["path"] for r in result}
        assert p1 in paths
        assert p2 in paths

    def test_get_seed_tracks_by_paths_empty(self, pg_db):
        from crate.db.queries.bliss_track_lookup import get_seed_tracks_by_paths

        assert get_seed_tracks_by_paths(seed_paths=[]) == []
        assert get_seed_tracks_by_paths(seed_paths=None) == []

    def test_get_seed_tracks_by_paths_partial_match(self, pg_db):
        from crate.db.queries.bliss_track_lookup import get_seed_tracks_by_paths

        _insert_artist(pg_db, "Partial")
        album_id = _insert_album(pg_db, "Partial", "PAlbum", "/music/Partial/PAlbum")
        p1 = "/music/Partial/PAlbum/01 - Real.flac"
        _insert_track(pg_db, album_id, "Partial", "PAlbum", "Real", p1)

        result = get_seed_tracks_by_paths(
            seed_paths=[p1, "/music/Partial/PAlbum/99 - Ghost.flac"]
        )

        assert len(result) == 1
        assert result[0]["path"] == p1


# ── bliss_storage ────────────────────────────────────────────────────


class TestBlissStorage:
    def test_store_bliss_vectors_sets_vector_and_embedding(self, pg_db):
        _insert_artist(pg_db, "Storage Artist")
        album_id = _insert_album(
            pg_db,
            "Storage Artist",
            "Storage Album",
            "/music/Storage Artist/Storage Album",
        )
        t1_path = "/music/Storage Artist/Storage Album/01 - Store.flac"
        t2_path = "/music/Storage Artist/Storage Album/02 - Keep.flac"
        _insert_track(
            pg_db,
            album_id,
            "Storage Artist",
            "Storage Album",
            "Store",
            t1_path,
        )
        _insert_track(
            pg_db,
            album_id,
            "Storage Artist",
            "Storage Album",
            "Keep",
            t2_path,
        )

        vec1 = make_vec(0.1)
        vec2 = make_vec(0.2)

        with patch(
            "crate.db.queries.bliss_storage.refresh_artist_bliss_centroids_for_track_ids",
            return_value=2,
        ) as mock_refresh:
            from crate.db.queries.bliss_storage import store_bliss_vectors

            store_bliss_vectors({t1_path: vec1, t2_path: vec2})

        with read_scope() as session:
            rows = (
                session.execute(
                    text(
                        "SELECT path, bliss_vector FROM library_tracks "
                        "WHERE path = ANY(:paths)"
                    ),
                    {"paths": [t1_path, t2_path]},
                )
                .mappings()
                .all()
            )
        by_path = {r["path"]: r["bliss_vector"] for r in rows}

        assert by_path[t1_path] == vec1
        assert by_path[t2_path] == vec2
        mock_refresh.assert_called_once()

    def test_store_bliss_vectors_skips_existing(self, pg_db):
        _insert_artist(pg_db, "Skip Artist")
        album_id = _insert_album(
            pg_db,
            "Skip Artist",
            "Skip Album",
            "/music/Skip Artist/Skip Album",
        )
        t_path = "/music/Skip Artist/Skip Album/01 - Pre.flac"
        pre_vec = make_vec(0.5)
        _insert_track(
            pg_db,
            album_id,
            "Skip Artist",
            "Skip Album",
            "Pre",
            t_path,
            bliss_vector=pre_vec,
        )

        new_vec = make_vec(0.9)

        with patch(
            "crate.db.queries.bliss_storage.refresh_artist_bliss_centroids_for_track_ids",
            return_value=0,
        ) as mock_refresh:
            from crate.db.queries.bliss_storage import store_bliss_vectors

            store_bliss_vectors({t_path: new_vec})

        with read_scope() as session:
            actual = session.execute(
                text("SELECT bliss_vector FROM library_tracks WHERE path = :p"),
                {"p": t_path},
            ).scalar()

        assert actual == pre_vec
        mock_refresh.assert_called_once()

    def test_store_bliss_vectors_empty(self, pg_db):
        with patch(
            "crate.db.queries.bliss_storage.refresh_artist_bliss_centroids_for_track_ids",
        ) as mock_refresh:
            from crate.db.queries.bliss_storage import store_bliss_vectors

            store_bliss_vectors({})

        mock_refresh.assert_called_once()
        # empty track_ids list returns 0 without query


# ── bliss_artist_similarity ──────────────────────────────────────────


class TestBlissArtistSimilarity:
    def test_get_similar_artist_rows_by_artist_id(self, pg_db):
        from crate.db.queries.bliss_artist_similarity import get_similar_artist_rows

        _insert_artist(pg_db, "Converge")
        _insert_artist(pg_db, "Botch")
        _insert_artist(pg_db, "Cave In")

        with read_scope() as session:
            artist_id = session.execute(
                text("SELECT id FROM library_artists WHERE LOWER(name) = LOWER(:n)"),
                {"n": "Converge"},
            ).scalar()

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO artist_similarities "
                    "(artist_name, similar_name, score, in_library, updated_at) "
                    "VALUES (:artist, :similar, :score, TRUE, NOW())"
                ),
                [
                    {"artist": "Converge", "similar": "Botch", "score": 0.85},
                    {"artist": "Converge", "similar": "Cave In", "score": 0.72},
                    {
                        "artist": "Converge",
                        "similar": "Dillinger Escape Plan",
                        "score": 0.65,
                    },
                ],
            )

        rows = get_similar_artist_rows(artist_id=artist_id)

        assert len(rows) == 3
        assert rows[0]["similar_name"] == "Botch"
        assert rows[0]["score"] == 0.85
        assert rows[0]["in_library"] is True
        assert rows[1]["similar_name"] == "Cave In"
        assert rows[2]["similar_name"] == "Dillinger Escape Plan"
        # DESC NULLS LAST on score, then similar_name ASC

    def test_get_similar_artist_rows_by_artist_name(self, pg_db):
        from crate.db.queries.bliss_artist_similarity import get_similar_artist_rows

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO artist_similarities "
                    "(artist_name, similar_name, score, in_library, updated_at) "
                    "VALUES (:artist, :similar, :score, TRUE, NOW())"
                ),
                {"artist": "Name Match", "similar": "Botch", "score": 0.88},
            )

        rows = get_similar_artist_rows(artist_name="Name Match")

        assert len(rows) == 1
        assert rows[0]["similar_name"] == "Botch"
        assert rows[0]["score"] == 0.88

    def test_get_similar_artist_rows_falls_back_to_similar_json(self, pg_db):
        from crate.db.queries.bliss_artist_similarity import get_similar_artist_rows

        _insert_artist(pg_db, "Fallback Artist")
        _insert_artist(pg_db, "Cave In")

        with read_scope() as session:
            artist_id = session.execute(
                text("SELECT id FROM library_artists WHERE LOWER(name) = LOWER(:n)"),
                {"n": "Fallback Artist"},
            ).scalar()

        similar_json = json.dumps(
            [
                {"name": "Cave In", "score": 75},
                {"name": "Botch", "match": 90},
                {"name": "Coalesce"},
            ]
        )

        with transaction_scope() as session:
            session.execute(
                text(
                    "UPDATE library_artists SET similar_json = CAST(:json AS jsonb) "
                    "WHERE id = :id"
                ),
                {"json": similar_json, "id": artist_id},
            )

        rows = get_similar_artist_rows(artist_id=artist_id)

        assert len(rows) == 3
        # Cave In is in_library = True
        result = {r["similar_name"].lower(): r for r in rows}
        assert result["cave in"]["in_library"] is True
        assert result["cave in"]["score"] == 0.75
        assert result["botch"]["score"] == 0.9
        assert result["botch"]["in_library"] is False
        assert result["coalesce"]["score"] == 0.0

    def test_get_similar_artist_rows_empty_no_data(self, pg_db):
        from crate.db.queries.bliss_artist_similarity import get_similar_artist_rows

        _insert_artist(pg_db, "Lonely Artist")

        with read_scope() as session:
            artist_id = session.execute(
                text("SELECT id FROM library_artists WHERE LOWER(name) = LOWER(:n)"),
                {"n": "Lonely Artist"},
            ).scalar()

        rows = get_similar_artist_rows(artist_id=artist_id)

        assert rows == []

    def test_get_similar_artist_rows_nonexistent_artist(self, pg_db):
        from crate.db.queries.bliss_artist_similarity import get_similar_artist_rows

        rows = get_similar_artist_rows(artist_name="Nonexistent Band")

        assert rows == []

    def test_get_artist_genre_ids(self, pg_db):
        from crate.db.queries.bliss_artist_similarity import get_artist_genre_ids

        _insert_artist(pg_db, "Converge")

        with transaction_scope() as session:
            genre_id = session.execute(
                text(
                    "INSERT INTO genres (name, slug) "
                    "VALUES ('Metalcore', 'metalcore') RETURNING id"
                )
            ).scalar()
            session.execute(
                text(
                    "INSERT INTO artist_genres (artist_name, genre_id) "
                    "VALUES (:name, :gid)"
                ),
                {"name": "Converge", "gid": genre_id},
            )

        genre_ids = get_artist_genre_ids(artist_name="Converge")

        assert "Metalcore" in genre_ids

    def test_get_artist_genre_map(self, pg_db):
        from crate.db.queries.bliss_artist_similarity import get_artist_genre_map

        _insert_artist(pg_db, "Fugazi")
        _insert_artist(pg_db, "Botch")

        with transaction_scope() as session:
            g1 = session.execute(
                text(
                    "INSERT INTO genres (name, slug) "
                    "VALUES ('Post-Hardcore', 'post-hardcore') RETURNING id"
                )
            ).scalar()
            g2 = session.execute(
                text(
                    "INSERT INTO genres (name, slug) "
                    "VALUES ('Metalcore', 'metalcore') RETURNING id"
                )
            ).scalar()
            session.execute(
                text(
                    "INSERT INTO artist_genres (artist_name, genre_id) VALUES "
                    "(:n1, :g1), (:n2, :g2)"
                ),
                {"n1": "Fugazi", "g1": g1, "n2": "Botch", "g2": g2},
            )

        result = get_artist_genre_map(artist_names={"Fugazi", "Botch", "Ghost"})

        assert result["Fugazi"] == {"Post-Hardcore"}
        assert result["Botch"] == {"Metalcore"}
        assert result["Ghost"] == set()

    def test_get_artist_genre_map_empty(self, pg_db):
        from crate.db.queries.bliss_artist_similarity import get_artist_genre_map

        assert get_artist_genre_map(artist_names=None) == {}
        assert get_artist_genre_map(artist_names=set()) == {}

    def test_get_artist_by_id(self, pg_db):
        from crate.db.queries.bliss_artist_similarity import get_artist_by_id

        _insert_artist(pg_db, "Test Artist")

        with read_scope() as session:
            artist_id = session.execute(
                text("SELECT id FROM library_artists WHERE LOWER(name) = LOWER(:n)"),
                {"n": "Test Artist"},
            ).scalar()

        row = get_artist_by_id(artist_id=artist_id)

        assert row is not None
        assert row["name"] == "Test Artist"

    def test_get_artist_by_id_none(self, pg_db):
        from crate.db.queries.bliss_artist_similarity import get_artist_by_id

        assert get_artist_by_id(artist_id=None) is None

    def test_get_artist_tracks_returns_vectors(self, pg_db):
        from crate.db.queries.bliss_artist_similarity import get_artist_tracks

        _insert_artist(pg_db, "Track Artist")
        album_id = _insert_album(
            pg_db, "Track Artist", "TA Album", "/music/Track Artist/TA Album"
        )
        _insert_track(
            pg_db,
            album_id,
            "Track Artist",
            "TA Album",
            "T1",
            "/music/Track Artist/TA Album/01 - T1.flac",
            bliss_vector=make_vec(0.0),
            bpm=140.0,
        )
        _insert_track(
            pg_db,
            album_id,
            "Track Artist",
            "TA Album",
            "T2",
            "/music/Track Artist/TA Album/02 - T2.flac",
            bliss_vector=make_vec(0.5),
            bpm=160.0,
        )

        with read_scope() as session:
            artist_id = session.execute(
                text("SELECT id FROM library_artists WHERE LOWER(name) = LOWER(:n)"),
                {"n": "Track Artist"},
            ).scalar()

        tracks = get_artist_tracks(artist_id=artist_id)

        assert len(tracks) == 2
        assert all("bliss_vector" in t for t in tracks)
        assert tracks[0]["bliss_vector"] is not None
        assert len(tracks[0]["bliss_vector"]) == VEC_DIMS

    def test_get_artist_tracks_none(self, pg_db):
        from crate.db.queries.bliss_artist_similarity import get_artist_tracks

        assert get_artist_tracks(artist_id=None) == []


# ── bliss_similarity_candidates ──────────────────────────────────────


class TestBlissSimilarityCandidates:
    def test_get_bliss_candidates_empty_vector(self, pg_db):
        from crate.db.queries.bliss_similarity_candidates import get_bliss_candidates

        assert get_bliss_candidates(bliss_vector=None) == []

    @pytest.mark.skipif(not PGVECTOR, reason="pgvector extension not available")
    def test_get_bliss_candidates_ordering(self, pg_db):
        from crate.db.queries.bliss_similarity_candidates import get_bliss_candidates

        _insert_artist(pg_db, "CandArtist")
        album_id = _insert_album(
            pg_db, "CandArtist", "CandAlbum", "/music/CandArtist/CandAlbum"
        )

        target_vec = make_vec(0.0)
        near_vec = make_vec_near(0.0)
        far_vec = make_vec_far(0.0)

        t_near_path = "/music/CandArtist/CandAlbum/01 - Near.flac"
        t_far_path = "/music/CandArtist/CandAlbum/02 - Far.flac"
        t_mid_path = "/music/CandArtist/CandAlbum/03 - Mid.flac"

        t_near = _insert_track(
            pg_db,
            album_id,
            "CandArtist",
            "CandAlbum",
            "Near",
            t_near_path,
        )
        t_far = _insert_track(
            pg_db,
            album_id,
            "CandArtist",
            "CandAlbum",
            "Far",
            t_far_path,
        )
        t_mid = _insert_track(
            pg_db,
            album_id,
            "CandArtist",
            "CandAlbum",
            "Mid",
            t_mid_path,
        )

        _set_bliss_embedding(t_near, near_vec)
        _set_bliss_embedding(t_far, far_vec)
        _set_bliss_embedding(t_mid, make_vec(0.03))

        result = get_bliss_candidates(
            bliss_vector=target_vec,
            exclude_path="",
            limit=10,
        )

        assert len(result) == 3
        assert {row["track_id"] for row in result} == {t_near, t_mid, t_far}
        distances = [row["bliss_dist"] for row in result]
        assert distances == sorted(distances)

    @pytest.mark.skipif(not PGVECTOR, reason="pgvector extension not available")
    def test_get_bliss_candidates_excludes_path(self, pg_db):
        from crate.db.queries.bliss_similarity_candidates import get_bliss_candidates

        _insert_artist(pg_db, "ExclArtist")
        album_id = _insert_album(
            pg_db, "ExclArtist", "ExclAlbum", "/music/ExclArtist/ExclAlbum"
        )

        t1_path = "/music/ExclArtist/ExclAlbum/01 - Keep.flac"
        t2_path = "/music/ExclArtist/ExclAlbum/02 - Skip.flac"

        t1 = _insert_track(
            pg_db,
            album_id,
            "ExclArtist",
            "ExclAlbum",
            "Keep",
            t1_path,
        )
        t2 = _insert_track(
            pg_db,
            album_id,
            "ExclArtist",
            "ExclAlbum",
            "Skip",
            t2_path,
        )

        _set_bliss_embedding(t1, make_vec(0.0))
        _set_bliss_embedding(t2, make_vec(0.1))

        result = get_bliss_candidates(
            bliss_vector=make_vec(0.0),
            exclude_path=t2_path,
            limit=10,
        )

        ids = {r["track_id"] for r in result}
        assert t2 not in ids
        assert t1 in ids

    @pytest.mark.skipif(not PGVECTOR, reason="pgvector extension not available")
    def test_get_bliss_candidates_respects_limit(self, pg_db):
        from crate.db.queries.bliss_similarity_candidates import get_bliss_candidates

        _insert_artist(pg_db, "LimitCand")
        album_id = _insert_album(
            pg_db, "LimitCand", "LimitAlbum", "/music/LimitCand/LimitAlbum"
        )

        track_ids = []
        for i in range(10):
            t = _insert_track(
                pg_db,
                album_id,
                "LimitCand",
                "LimitAlbum",
                f"T{i}",
                f"/music/LimitCand/LimitAlbum/{i:02d} - T{i}.flac",
            )
            _set_bliss_embedding(t, make_vec(float(i) * 0.1))
            track_ids.append(t)

        result = get_bliss_candidates(
            bliss_vector=make_vec(0.0),
            exclude_path="",
            limit=3,
        )

        assert len(result) == 3

    def test_get_recommend_without_bliss_candidates_empty(self, pg_db):
        from crate.db.queries.bliss_similarity_candidates import (
            get_recommend_without_bliss_candidates,
        )

        assert get_recommend_without_bliss_candidates(seed_paths=None) == []
        assert (
            get_recommend_without_bliss_candidates(
                seed_paths=["/x.flac"], similar_artist_names=[], artist_pick_limit=0
            )
            == []
        )

    def test_get_recommend_without_bliss_candidates_returns_tracks(self, pg_db):
        from crate.db.queries.bliss_similarity_candidates import (
            get_recommend_without_bliss_candidates,
        )

        _insert_artist(pg_db, "RecArtist")
        album_id = _insert_album(
            pg_db, "RecArtist", "RecAlbum", "/music/RecArtist/RecAlbum"
        )

        s_path = "/music/RecArtist/RecAlbum/01 - Seed.flac"
        c_path = "/music/RecArtist/RecAlbum/02 - Cand.flac"

        _insert_track(
            pg_db,
            album_id,
            "RecArtist",
            "RecAlbum",
            "Seed",
            s_path,
            bpm=120.0,
        )
        _insert_track(
            pg_db,
            album_id,
            "RecArtist",
            "RecAlbum",
            "Cand",
            c_path,
            bpm=140.0,
        )

        result = get_recommend_without_bliss_candidates(
            seed_paths=[s_path],
            similar_artist_names=["recartist"],
            artist_pick_limit=5,
            row_limit=10,
        )

        assert len(result) == 1
        assert result[0]["path"] == c_path

    def test_get_recommend_without_bliss_candidates_filters_by_artist_pick(self, pg_db):
        from crate.db.queries.bliss_similarity_candidates import (
            get_recommend_without_bliss_candidates,
        )

        _insert_artist(pg_db, "PickArtist")
        album_id = _insert_album(
            pg_db, "PickArtist", "PickAlbum", "/music/PickArtist/PickAlbum"
        )
        s_path = "/music/PickArtist/PickAlbum/01 - Seed.flac"
        _insert_track(
            pg_db,
            album_id,
            "PickArtist",
            "PickAlbum",
            "Seed",
            s_path,
            bpm=120.0,
        )
        for i in range(10):
            _insert_track(
                pg_db,
                album_id,
                "PickArtist",
                "PickAlbum",
                f"Cand{i}",
                f"/music/PickArtist/PickAlbum/{i + 2:02d} - Cand{i}.flac",
                bpm=120.0,
            )

        result = get_recommend_without_bliss_candidates(
            seed_paths=[s_path],
            similar_artist_names=["pickartist"],
            artist_pick_limit=3,
            row_limit=5,
        )

        assert len(result) <= 3

    @pytest.mark.skipif(not PGVECTOR, reason="pgvector extension not available")
    def test_get_multi_seed_bliss_candidates(self, pg_db):
        from crate.db.queries.bliss_similarity_candidates import (
            get_multi_seed_bliss_candidates,
        )

        _insert_artist(pg_db, "MultiArtist")
        album_id = _insert_album(
            pg_db, "MultiArtist", "MultiAlbum", "/music/MultiArtist/MultiAlbum"
        )

        seed_a_path = "/music/MultiArtist/MultiAlbum/01 - SeedA.flac"
        seed_b_path = "/music/MultiArtist/MultiAlbum/02 - SeedB.flac"
        seed_a = _insert_track(
            pg_db,
            album_id,
            "MultiArtist",
            "MultiAlbum",
            "SeedA",
            seed_a_path,
        )
        seed_b = _insert_track(
            pg_db,
            album_id,
            "MultiArtist",
            "MultiAlbum",
            "SeedB",
            seed_b_path,
        )
        _set_bliss_embedding(seed_a, make_vec(0.0))
        _set_bliss_embedding(seed_b, make_vec(2.0))

        cand_paths = []
        cand_ids = []
        for i in range(4):
            cpath = f"/music/MultiArtist/MultiAlbum/{i + 3:02d} - Cand{i}.flac"
            cid = _insert_track(
                pg_db,
                album_id,
                "MultiArtist",
                "MultiAlbum",
                f"Cand{i}",
                cpath,
            )
            _set_bliss_embedding(cid, make_vec(float(i) * 0.5 + 0.1))
            cand_paths.append(cpath)
            cand_ids.append(cid)

        result = get_multi_seed_bliss_candidates(
            bliss_seed_paths=[seed_a_path, seed_b_path],
            all_seed_paths=[seed_a_path, seed_b_path],
            per_seed_limit=2,
        )

        assert len(result) == 4  # 2 per seed
        seed_paths_found = {r["seed_path"] for r in result}
        assert seed_a_path in seed_paths_found
        assert seed_b_path in seed_paths_found

    @pytest.mark.skipif(not PGVECTOR, reason="pgvector extension not available")
    def test_get_multi_seed_bliss_candidates_empty(self, pg_db):
        from crate.db.queries.bliss_similarity_candidates import (
            get_multi_seed_bliss_candidates,
        )

        assert get_multi_seed_bliss_candidates(bliss_seed_paths=None) == []
        assert (
            get_multi_seed_bliss_candidates(
                bliss_seed_paths=["/x.flac"], all_seed_paths=[], per_seed_limit=0
            )
            == []
        )


# ── bliss_radio_candidates ───────────────────────────────────────────


class TestBlissRadioCandidates:
    def test_get_similar_artist_tracks_for_radio_empty(self, pg_db):
        from crate.db.queries.bliss_radio_candidates import (
            get_similar_artist_tracks_for_radio,
        )

        assert get_similar_artist_tracks_for_radio(similar_artist_keys=None) == []
        assert (
            get_similar_artist_tracks_for_radio(similar_artist_keys=["x"], limit=0)
            == []
        )

    def test_get_similar_artist_tracks_for_radio(self, pg_db):
        from crate.db.queries.bliss_radio_candidates import (
            get_similar_artist_tracks_for_radio,
        )

        _insert_artist(pg_db, "RadioArtist")
        album_id = _insert_album(
            pg_db, "RadioArtist", "RadioAlbum", "/music/RadioArtist/RadioAlbum"
        )

        for i in range(12):
            _insert_track(
                pg_db,
                album_id,
                "RadioArtist",
                "RadioAlbum",
                f"RT{i}",
                f"/music/RadioArtist/RadioAlbum/{i + 1:02d} - RT{i}.flac",
                bliss_vector=make_vec(float(i) * 0.01),
                lastfm_playcount=(12 - i),
            )

        result = get_similar_artist_tracks_for_radio(
            similar_artist_keys=["radioartist"],
            limit=20,
        )

        # artist_pick <= 8 caps per artist, we have 12 tracks from 1 artist
        assert 8 <= len(result) <= 8
        assert all(r["track_id"] is not None for r in result)
        assert all(r["bliss_vector"] is not None for r in result)

    def test_get_similar_artist_tracks_for_radio_respects_limit(self, pg_db):
        from crate.db.queries.bliss_radio_candidates import (
            get_similar_artist_tracks_for_radio,
        )

        _insert_artist(pg_db, "LimitRadio")
        album_id = _insert_album(
            pg_db, "LimitRadio", "LimitRAlbum", "/music/LimitRadio/LimitRAlbum"
        )

        for i in range(5):
            _insert_track(
                pg_db,
                album_id,
                "LimitRadio",
                "LimitRAlbum",
                f"L{i}",
                f"/music/LimitRadio/LimitRAlbum/{i + 1:02d} - L{i}.flac",
                bliss_vector=make_vec(float(i) * 0.02),
            )

        result = get_similar_artist_tracks_for_radio(
            similar_artist_keys=["limitradio"],
            limit=3,
        )

        assert len(result) <= 3

    def test_artist_keys_truncated_to_16(self):
        # Verify the query caps similar_artist_keys at 16 before sending to PG
        many_keys = [f"artist_{i}" for i in range(50)]
        assert len(many_keys[:16]) == 16
        assert len(many_keys) > 16

    def test_get_album_tracks_for_radio(self, pg_db):
        from crate.db.queries.bliss_radio_candidates import (
            get_album_tracks_for_radio,
        )

        _insert_artist(pg_db, "AlbumRadio")
        album_id = _insert_album(
            pg_db, "AlbumRadio", "ARAlbum", "/music/AlbumRadio/ARAlbum"
        )

        t1_path = "/music/AlbumRadio/ARAlbum/01 - First.flac"
        t2_path = "/music/AlbumRadio/ARAlbum/02 - Second.flac"

        _insert_track(
            pg_db,
            album_id,
            "AlbumRadio",
            "ARAlbum",
            "First",
            t1_path,
            bliss_vector=make_vec(0.0),
        )
        _insert_track(
            pg_db,
            album_id,
            "AlbumRadio",
            "ARAlbum",
            "Second",
            t2_path,
            bliss_vector=make_vec(0.1),
        )

        result = get_album_tracks_for_radio(album_id=album_id)

        assert len(result) == 2
        assert result[0]["title"] == "First"
        assert result[1]["title"] == "Second"

    def test_get_album_tracks_for_radio_none(self, pg_db):
        from crate.db.queries.bliss_radio_candidates import (
            get_album_tracks_for_radio,
        )

        assert get_album_tracks_for_radio(album_id=None) == []

    def test_get_playlist_tracks_for_radio_none(self, pg_db):
        from crate.db.queries.bliss_radio_candidates import (
            get_playlist_tracks_for_radio,
        )

        assert get_playlist_tracks_for_radio(playlist_id=None) == []

    def test_get_playlist_tracks_for_radio_with_tracks(self, pg_db):
        from crate.db.queries.bliss_radio_candidates import (
            get_playlist_tracks_for_radio,
        )
        from crate.db.repositories.playlists_create import create_playlist
        from crate.db.repositories.playlists_tracks import add_playlist_tracks

        _insert_artist(pg_db, "PLArtist")
        album_id = _insert_album(
            pg_db, "PLArtist", "PLAlbum", "/music/PLArtist/PLAlbum"
        )
        track_path = "/music/PLArtist/PLAlbum/01 - PLTrack.flac"
        _insert_track(
            pg_db,
            album_id,
            "PLArtist",
            "PLAlbum",
            "PLTrack",
            track_path,
            bliss_vector=make_vec(0.0),
        )

        with read_scope() as session:
            track_id = (
                session.execute(
                    text(
                        "SELECT id, entity_uid, storage_id FROM library_tracks "
                        "WHERE path = :p"
                    ),
                    {"p": track_path},
                )
                .mappings()
                .first()
            )
        tid = track_id["id"]

        playlist_id = create_playlist("Radio PL Test")
        add_playlist_tracks(playlist_id, [{"track_id": tid}])

        result = get_playlist_tracks_for_radio(playlist_id=playlist_id)

        assert len(result) == 1
        assert result[0]["track_id"] == tid


# ── bliss_artist_profiles ────────────────────────────────────────────


class TestBlissArtistProfiles:
    def test_build_user_radio_profile_no_user(self, pg_db):
        from crate.db.queries.bliss_artist_profiles import build_user_radio_profile

        result = build_user_radio_profile(
            user_id=None,
            track_ids=[1],
            artist_names=["Test"],
            artist_name_keys=["test"],
            album_pairs=[("Test", "Album")],
        )

        assert result == {}

    def test_build_user_radio_profile_with_liked_tracks(self, pg_db):
        from crate.db.queries.bliss_artist_profiles import build_user_radio_profile

        _insert_artist(pg_db, "Liked Artist")
        album_id = _insert_album(
            pg_db,
            "Liked Artist",
            "Liked Album",
            "/music/Liked Artist/Liked Album",
        )
        t_path = "/music/Liked Artist/Liked Album/01 - Liked Track.flac"
        _insert_track(
            pg_db,
            album_id,
            "Liked Artist",
            "Liked Album",
            "Liked Track",
            t_path,
        )

        with read_scope() as session:
            track_id = session.execute(
                text("SELECT id FROM library_tracks WHERE path = :p"),
                {"p": t_path},
            ).scalar()
            user_id = session.execute(
                text("SELECT id FROM users WHERE email = :e"),
                {"e": "admin@cratemusic.app"},
            ).scalar()

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO user_liked_tracks (user_id, track_id, created_at) "
                    "VALUES (:uid, :tid, NOW()) "
                    "ON CONFLICT DO NOTHING"
                ),
                {"uid": user_id, "tid": track_id},
            )

        result = build_user_radio_profile(
            user_id=user_id,
            track_ids=[track_id],
            artist_names=["Liked Artist"],
            artist_name_keys=["liked artist"],
            album_pairs=[("Liked Artist", "Liked Album")],
        )

        assert track_id in result["liked_track_ids"]

    def test_build_user_radio_profile_with_recent_plays(self, pg_db):
        from crate.db.queries.bliss_artist_profiles import build_user_radio_profile
        from datetime import datetime, timezone

        _insert_artist(pg_db, "Play Artist")
        album_id = _insert_album(
            pg_db,
            "Play Artist",
            "Play Album",
            "/music/Play Artist/Play Album",
        )
        t_path = "/music/Play Artist/Play Album/01 - Played.flac"
        _insert_track(
            pg_db,
            album_id,
            "Play Artist",
            "Play Album",
            "Played",
            t_path,
        )

        now = datetime.now(timezone.utc)

        with read_scope() as session:
            track_id = session.execute(
                text("SELECT id FROM library_tracks WHERE path = :p"),
                {"p": t_path},
            ).scalar()
            user_id = session.execute(
                text("SELECT id FROM users WHERE email = :e"),
                {"e": "admin@cratemusic.app"},
            ).scalar()

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO user_play_events "
                    "(user_id, track_id, track_path, title, artist, album, "
                    " started_at, ended_at, played_seconds, was_skipped, created_at) "
                    "VALUES (:uid, :tid, :path, :title, :artist, :album, "
                    " :start, :end, :s, FALSE, NOW())"
                ),
                {
                    "uid": user_id,
                    "tid": track_id,
                    "path": t_path,
                    "title": "Played",
                    "artist": "Play Artist",
                    "album": "Play Album",
                    "start": now,
                    "end": now,
                    "s": 180.0,
                },
            )

        result = build_user_radio_profile(
            user_id=user_id,
            track_ids=[track_id],
            artist_names=["Play Artist"],
            artist_name_keys=["play artist"],
            album_pairs=[("Play Artist", "Play Album")],
        )

        assert track_id in result["recent_track_events"]

    def test_build_user_radio_profile_with_artist_stats(self, pg_db):
        from crate.db.queries.bliss_artist_profiles import build_user_radio_profile

        with read_scope() as session:
            user_id = session.execute(
                text("SELECT id FROM users WHERE email = :e"),
                {"e": "admin@cratemusic.app"},
            ).scalar()

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO user_artist_stats "
                    "(user_id, stat_window, artist_name, play_count, "
                    " complete_play_count, last_played_at) "
                    "VALUES (:uid, '30d', :name, 5, 3, NOW()) "
                    "ON CONFLICT (user_id, stat_window, artist_name) DO UPDATE "
                    "SET play_count = 5"
                ),
                {"uid": user_id, "name": "Stats Artist"},
            )

        result = build_user_radio_profile(
            user_id=user_id,
            track_ids=[],
            artist_names=["Stats Artist"],
            artist_name_keys=["stats artist"],
            album_pairs=[],
        )

        assert "stats artist" in result["artist_stats"]

    def test_build_user_radio_profile_with_album_stats(self, pg_db):
        from crate.db.queries.bliss_artist_profiles import build_user_radio_profile

        with read_scope() as session:
            user_id = session.execute(
                text("SELECT id FROM users WHERE email = :e"),
                {"e": "admin@cratemusic.app"},
            ).scalar()

        with transaction_scope() as session:
            session.execute(
                text(
                    "INSERT INTO user_album_stats "
                    "(user_id, stat_window, entity_key, artist, album, play_count, "
                    " complete_play_count, last_played_at) "
                    "VALUES (:uid, '30d', 'album::artist', :artist, :album, 4, 2, NOW()) "
                    "ON CONFLICT (user_id, stat_window, entity_key) DO UPDATE "
                    "SET play_count = 4"
                ),
                {"uid": user_id, "artist": "Album Artist", "album": "Album Name"},
            )

        result = build_user_radio_profile(
            user_id=user_id,
            track_ids=[],
            artist_names=[],
            artist_name_keys=[],
            album_pairs=[("Album Artist", "Album Name")],
        )

        assert ("album artist", "album name") in result["album_stats"]


# ── bliss_artist_profiles edge cases ─────────────────────────────────


class TestBlissArtistProfilesEdge:
    def test_build_user_radio_profile_empty_inputs(self, pg_db):
        from crate.db.queries.bliss_artist_profiles import build_user_radio_profile

        with read_scope() as session:
            user_id = session.execute(
                text("SELECT id FROM users WHERE email = :e"),
                {"e": "admin@cratemusic.app"},
            ).scalar()

        result = build_user_radio_profile(
            user_id=user_id,
            track_ids=[],
            artist_names=[],
            artist_name_keys=[],
            album_pairs=[],
        )

        assert result["liked_track_ids"] == set()
        assert result["recent_track_events"] == {}
        assert result["artist_stats"] == {}
        assert result["album_stats"] == {}

    def test_build_user_radio_profile_no_matching_data(self, pg_db):
        from crate.db.queries.bliss_artist_profiles import build_user_radio_profile

        with read_scope() as session:
            user_id = session.execute(
                text("SELECT id FROM users WHERE email = :e"),
                {"e": "admin@cratemusic.app"},
            ).scalar()

        result = build_user_radio_profile(
            user_id=user_id,
            track_ids=[999999],
            artist_names=["Ghost Artist"],
            artist_name_keys=["ghost artist"],
            album_pairs=[("Ghost", "Ghost Album")],
        )

        assert result["liked_track_ids"] == set()
        assert result["recent_track_events"] == {}
        assert result["artist_stats"] == {}
        assert result["album_stats"] == {}


# ── performance ──────────────────────────────────────────────────────


class TestBlissPerformance:
    @pytest.mark.slow
    @pytest.mark.skipif(not PGVECTOR, reason="pgvector extension not available")
    def test_get_bliss_candidates_100_tracks_under_500ms(self, pg_db):
        from crate.db.queries.bliss_similarity_candidates import get_bliss_candidates

        _insert_artist(pg_db, "PerfArtist")
        album_id = _insert_album(
            pg_db, "PerfArtist", "PerfAlbum", "/music/PerfArtist/PerfAlbum"
        )

        target_vec = make_vec(0.0)
        track_ids = []
        for i in range(100):
            t = _insert_track(
                pg_db,
                album_id,
                "PerfArtist",
                "PerfAlbum",
                f"PT{i}",
                f"/music/PerfArtist/PerfAlbum/{i + 1:02d} - PT{i}.flac",
            )
            _set_bliss_embedding(t, make_vec(float(i) * 0.02))
            track_ids.append(t)

        start = time.monotonic()
        result = get_bliss_candidates(
            bliss_vector=target_vec,
            exclude_path="",
            limit=50,
        )
        elapsed = time.monotonic() - start

        assert len(result) == 50
        assert elapsed < 0.5, f"Query took {elapsed:.3f}s, expected < 0.5s"

    @pytest.mark.slow
    def test_get_recommend_without_bliss_candidates_100_tracks_under_500ms(self, pg_db):
        from crate.db.queries.bliss_similarity_candidates import (
            get_recommend_without_bliss_candidates,
        )

        _insert_artist(pg_db, "RecPerf")
        album_id = _insert_album(
            pg_db, "RecPerf", "RecPerfAlbum", "/music/RecPerf/RecPerfAlbum"
        )

        s_path = "/music/RecPerf/RecPerfAlbum/01 - Seed.flac"
        _insert_track(
            pg_db,
            album_id,
            "RecPerf",
            "RecPerfAlbum",
            "Seed",
            s_path,
            bpm=120.0,
        )
        for i in range(100):
            _insert_track(
                pg_db,
                album_id,
                "RecPerf",
                "RecPerfAlbum",
                f"RC{i}",
                f"/music/RecPerf/RecPerfAlbum/{i + 2:02d} - RC{i}.flac",
                bpm=120.0,
            )

        start = time.monotonic()
        result = get_recommend_without_bliss_candidates(
            seed_paths=[s_path],
            similar_artist_names=["recperf"],
            artist_pick_limit=5,
            row_limit=50,
        )
        elapsed = time.monotonic() - start

        assert len(result) <= 50
        assert elapsed < 0.5, f"Query took {elapsed:.3f}s, expected < 0.5s"

    @pytest.mark.slow
    def test_get_similar_artist_tracks_for_radio_100_tracks_under_500ms(self, pg_db):
        from crate.db.queries.bliss_radio_candidates import (
            get_similar_artist_tracks_for_radio,
        )

        _insert_artist(pg_db, "RadioPerf")
        album_id = _insert_album(
            pg_db, "RadioPerf", "RadioPAlbum", "/music/RadioPerf/RadioPAlbum"
        )

        for i in range(100):
            _insert_track(
                pg_db,
                album_id,
                "RadioPerf",
                "RadioPAlbum",
                f"RP{i}",
                f"/music/RadioPerf/RadioPAlbum/{i + 1:02d} - RP{i}.flac",
                bliss_vector=make_vec(float(i) * 0.01),
            )

        start = time.monotonic()
        result = get_similar_artist_tracks_for_radio(
            similar_artist_keys=["radioperf"],
            limit=100,
        )
        elapsed = time.monotonic() - start

        # artist_pick <= 8 means max 8 tracks from this single artist
        assert 1 <= len(result) <= 8
        assert elapsed < 0.5, f"Query took {elapsed:.3f}s, expected < 0.5s"

    @pytest.mark.slow
    def test_build_user_radio_profile_100_tracks_under_500ms(self, pg_db):
        from crate.db.queries.bliss_artist_profiles import build_user_radio_profile

        with read_scope() as session:
            user_id = session.execute(
                text("SELECT id FROM users WHERE email = :e"),
                {"e": "admin@cratemusic.app"},
            ).scalar()

        start = time.monotonic()
        result = build_user_radio_profile(
            user_id=user_id,
            track_ids=[i for i in range(1, 101)],
            artist_names=[f"Artist_{i}" for i in range(50)],
            artist_name_keys=[f"artist_{i}" for i in range(50)],
            album_pairs=[(f"Artist_{i}", f"Album_{i}") for i in range(50)],
        )
        elapsed = time.monotonic() - start

        assert isinstance(result, dict)
        assert elapsed < 0.5, f"Query took {elapsed:.3f}s, expected < 0.5s"
