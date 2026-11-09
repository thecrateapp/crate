"""The album genres the Smart Mix planner gates the stems layer on (STEM-G1)."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.queries.smart_mix_genres import get_track_album_genres
from crate.db.tx import transaction_scope
from crate.smart_mix.transition_fit import genre_beatmatch_prior
from tests.sql_statements import recorded_statements
from tests.test_smart_mix_repository import _create_track


def _tag_album(track_id: int, genres: tuple[tuple[str, str, float | None], ...]) -> None:
    with transaction_scope() as session:
        album_id = session.execute(
            text("SELECT album_id FROM library_tracks WHERE id = :id"),
            {"id": track_id},
        ).scalar_one()
        for name, slug, weight in genres:
            genre_id = session.execute(
                text(
                    "INSERT INTO genres (name, slug) VALUES (:name, :slug) RETURNING id"
                ),
                {"name": name, "slug": slug},
            ).scalar_one()
            session.execute(
                text(
                    "INSERT INTO album_genres (album_id, genre_id, weight) "
                    "VALUES (:album, :genre, :weight)"
                ),
                {"album": album_id, "genre": genre_id, "weight": weight},
            )


def test_track_album_genres_carry_their_weights_in_one_query(pg_db):
    del pg_db
    tagged_id, tagged = _create_track("tagged")
    _untagged_id, untagged = _create_track("untagged")
    _tag_album(
        tagged_id,
        (("Drum and Bass", "drum-and-bass", 0.75), ("Jungle", "jungle", None)),
    )

    with recorded_statements() as statements:
        genres = get_track_album_genres([tagged, untagged, tagged])

    assert genres == {tagged: {"Drum and Bass": 0.75, "Jungle": 1.0}}
    assert len(statements) == 1
    assert get_track_album_genres([]) == {}
    # What the gate reads: drum and bass 0.95, jungle 0.85, weighted.
    assert genre_beatmatch_prior(genres[tagged]) == round(
        (0.95 * 0.75 + 0.85 * 1.0) / 1.75, 4
    )
    assert genre_beatmatch_prior(genres.get(untagged)) is None
