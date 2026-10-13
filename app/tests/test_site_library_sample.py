from __future__ import annotations

import pytest

from crate.db.queries.site_library_sample import get_bliss_sample
from tests.conftest import PG_AVAILABLE
from tests.test_bliss_queries import (
    _insert_album,
    _insert_artist,
    _insert_track,
    make_vec,
)

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_get_bliss_sample_returns_only_tracks_with_vectors(pg_db):
    _insert_artist(pg_db, "Artist")
    album_id = _insert_album(pg_db, "Artist", "Album", "/music/a")
    _insert_track(
        pg_db,
        album_id,
        "Artist",
        "Album",
        "One",
        "/music/a/1.flac",
        bliss_vector=make_vec(0.1),
        bpm=120.0,
    )
    _insert_track(pg_db, album_id, "Artist", "Album", "Two", "/music/a/2.flac")

    rows = get_bliss_sample(limit=10, seed=0.5)

    assert [row["title"] for row in rows] == ["One"]
    assert len(rows[0]["bliss_vector"]) == 20


def test_get_bliss_sample_is_stable_for_a_seed(pg_db):
    _insert_artist(pg_db, "Artist")
    album_id = _insert_album(pg_db, "Artist", "Album", "/music/a")
    for i in range(30):
        _insert_track(
            pg_db,
            album_id,
            "Artist",
            "Album",
            f"T{i}",
            f"/music/a/{i}.flac",
            bliss_vector=make_vec(i / 10),
        )

    first = [row["track_id"] for row in get_bliss_sample(limit=10, seed=0.25)]
    second = [row["track_id"] for row in get_bliss_sample(limit=10, seed=0.25)]

    assert first == second
    assert len(first) == 10
