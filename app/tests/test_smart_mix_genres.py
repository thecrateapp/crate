"""The genres the Smart Mix planner gates the stems layer on (STEM-G1)."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.smart_mix_genres import TrackGenres, get_track_genres
from crate.db.tx import transaction_scope
from crate.smart_mix.candidates import stems_gate_prior
from tests.sql_statements import recorded_statements
from tests.test_smart_mix_repository import _create_track


def _genre(session, name: str, slug: str) -> int:
    return session.execute(
        text("INSERT INTO genres (name, slug) VALUES (:name, :slug) RETURNING id"),
        {"name": name, "slug": slug},
    ).scalar_one()


def _tag_album(
    track_id: int, genres: tuple[tuple[str, str, float | None], ...]
) -> None:
    with transaction_scope() as session:
        album_id = session.execute(
            text("SELECT album_id FROM library_tracks WHERE id = :id"),
            {"id": track_id},
        ).scalar_one()
        for name, slug, weight in genres:
            session.execute(
                text(
                    "INSERT INTO album_genres (album_id, genre_id, weight) "
                    "VALUES (:album, :genre, :weight)"
                ),
                {
                    "album": album_id,
                    "genre": _genre(session, name, slug),
                    "weight": weight,
                },
            )


def _tag_artist(track_id: int, genres: tuple[tuple[str, str, float], ...]) -> None:
    with transaction_scope() as session:
        artist = session.execute(
            text("SELECT artist FROM library_tracks WHERE id = :id"), {"id": track_id}
        ).scalar_one()
        for name, slug, weight in genres:
            session.execute(
                text(
                    "INSERT INTO artist_genres (artist_name, genre_id, weight) "
                    "VALUES (:artist, :genre, :weight)"
                ),
                {
                    "artist": artist,
                    "genre": _genre(session, name, slug),
                    "weight": weight,
                },
            )


def test_track_genres_read_album_and_artist_genres_in_one_query(pg_db):
    del pg_db
    tagged_id, tagged = _create_track("tagged")
    artist_only_id, artist_only = _create_track("artist only")
    _untagged_id, untagged = _create_track("untagged")
    _tag_album(
        tagged_id,
        (("Drum and Bass", "drum-and-bass", 0.75), ("Jungle", "jungle", None)),
    )
    # Like Author & Punisher: no album genres, the artist's are industrial.
    _tag_artist(
        artist_only_id,
        (("Industrial", "industrial", 1.0), ("Drone", "drone", 0.88)),
    )

    with recorded_statements() as statements:
        genres = get_track_genres([tagged, artist_only, untagged, tagged])

    assert genres == {
        tagged: TrackGenres(album={"Drum and Bass": 0.75, "Jungle": 1.0}, artist={}),
        artist_only: TrackGenres(album={}, artist={"Industrial": 1.0, "Drone": 0.88}),
    }
    assert len(statements) == 1
    assert get_track_genres([]) == {}
    # What the gate reads: drum and bass 0.95 and jungle 0.85, weighted; the
    # industrial artist joins the beatmatch family; no genres, unknown.
    assert stems_gate_prior(genres[tagged].album, genres[tagged].artist) == round(
        (0.95 * 0.75 + 0.85 * 1.0) / 1.75, 4
    )
    assert (
        stems_gate_prior(genres[artist_only].album, genres[artist_only].artist) == 1.0
    )
    assert stems_gate_prior({}, {}) is None
