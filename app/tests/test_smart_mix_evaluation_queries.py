from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from crate.db.queries.smart_mix_evaluation import (
    enforce_read_only_connections,
    get_pool_profile_states,
    sample_evaluation_seeds,
    session_is_read_only,
)
from crate.db.tx import transaction_scope


def test_read_only_connections_reject_writes(pg_db) -> None:
    del pg_db
    artist = f"Read Only {uuid.uuid4().hex}"
    assert session_is_read_only() is False

    enforce_read_only_connections()
    enforce_read_only_connections()

    assert session_is_read_only() is True
    with pytest.raises(DBAPIError, match="read-only transaction"):
        with transaction_scope() as session:
            session.execute(
                text("INSERT INTO library_artists (name) VALUES (:name)"),
                {"name": artist},
            )


def test_sample_evaluation_seeds_is_deterministic_and_skips_ineligible(
    pg_db,
) -> None:
    del pg_db
    tracks = _seed_library()

    first = sample_evaluation_seeds(sample_size=10, seed="sm0")
    again = sample_evaluation_seeds(sample_size=10, seed="sm0")
    other = sample_evaluation_seeds(sample_size=10, seed="another")
    limited = sample_evaluation_seeds(sample_size=2, seed="sm0")

    returned = {item.track_entity_uid for item in first}
    assert first == again
    assert returned == {
        tracks["track_genre"],
        tracks["album_genre"],
        tracks["album_tag"],
        tracks["artist_tag"],
        tracks["no_genre"],
    }
    assert {item.track_entity_uid for item in other} == returned
    assert [item.track_entity_uid for item in limited] == [
        item.track_entity_uid for item in first[:2]
    ]
    genres = {item.track_entity_uid: item.genre for item in first}
    assert genres[tracks["track_genre"]] == "Deep House"
    assert genres[tracks["album_genre"]] == "Techno"
    assert genres[tracks["album_tag"]] == "Drum and Bass"
    assert genres[tracks["artist_tag"]] == "Hip Hop"
    assert genres[tracks["no_genre"]] is None


def _seed_library() -> dict[str, str]:
    suffix = uuid.uuid4().hex
    artist = f"Evaluation {suffix}"
    tagged_artist = f"Tagged {suffix}"
    names = (
        "track_genre",
        "album_genre",
        "album_tag",
        "artist_tag",
        "no_genre",
        "stale_profile",
        "unavailable_profile",
        "no_path",
    )
    uids = {name: str(uuid.uuid4()) for name in names}
    with transaction_scope() as session:
        session.execute(
            text("INSERT INTO library_artists (name) VALUES (:artist), (:tagged)"),
            {"artist": artist, "tagged": tagged_artist},
        )
        genre_ids = {
            name: session.execute(
                text(
                    """
                    INSERT INTO genres (name, slug)
                    VALUES (:name, :slug)
                    RETURNING id
                    """
                ),
                {"name": name, "slug": f"{name.lower().replace(' ', '-')}-{suffix}"},
            ).scalar_one()
            for name in ("Drum and Bass", "Hip Hop", "Ambient")
        }
        session.execute(
            text(
                """
                INSERT INTO artist_genres (artist_name, genre_id, weight)
                VALUES (:artist, :hip_hop, 0.9), (:artist, :ambient, 0.1)
                """
            ),
            {
                "artist": tagged_artist,
                "hip_hop": genre_ids["Hip Hop"],
                "ambient": genre_ids["Ambient"],
            },
        )
        album_ids = {}
        for name in names:
            album_ids[name] = session.execute(
                text(
                    """
                    INSERT INTO library_albums (artist, name, path, genre)
                    VALUES (:artist, :name, :path, :genre)
                    RETURNING id
                    """
                ),
                {
                    "artist": tagged_artist if name == "artist_tag" else artist,
                    "name": name,
                    "path": f"/music/{suffix}/{name}",
                    "genre": "Techno" if name == "album_genre" else None,
                },
            ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO album_genres (album_id, genre_id, weight)
                VALUES (:album_id, :dnb, 1.0)
                """
            ),
            {"album_id": album_ids["album_tag"], "dnb": genre_ids["Drum and Bass"]},
        )
        for name in names:
            track_id = session.execute(
                text(
                    """
                    INSERT INTO library_tracks (
                        album_id, artist, album, filename, title, path,
                        entity_uid, duration, genre
                    )
                    VALUES (
                        :album_id, :artist, :album, :filename, :title, :path,
                        CAST(:entity_uid AS uuid), 200.0, :genre
                    )
                    RETURNING id
                    """
                ),
                {
                    "album_id": album_ids[name],
                    "artist": tagged_artist if name == "artist_tag" else artist,
                    "album": name,
                    "filename": f"{name}.flac",
                    "title": name,
                    "path": "" if name == "no_path" else f"/music/{suffix}/{name}.flac",
                    "entity_uid": uids[name],
                    "genre": "Deep House" if name == "track_genre" else None,
                },
            ).scalar_one()
            session.execute(
                text(
                    """
                    INSERT INTO track_mix_profiles (
                        track_id, profile_version, profile_revision, analyzer,
                        analyzer_version, source_revision, quality, bpm,
                        analyzed_at, source_stale_at
                    )
                    VALUES (
                        :track_id, 1, :revision, 'crate-rust',
                        'smart-mix-audio-v6', 'source', :quality, 124.0,
                        NOW(), CASE WHEN :stale THEN NOW() ELSE NULL END
                    )
                    """
                ),
                {
                    "track_id": track_id,
                    "revision": f"revision-{name}",
                    "quality": (
                        "unavailable" if name == "unavailable_profile" else "full"
                    ),
                    "stale": name == "stale_profile",
                },
            )
    return uids


def test_pool_profile_states_report_each_track_once(pg_db) -> None:
    del pg_db
    uids = _seed_library()
    with transaction_scope() as session:
        ids = dict(
            session.execute(
                text(
                    "SELECT entity_uid::text, id FROM library_tracks"
                    " WHERE entity_uid = ANY(CAST(:uids AS uuid[]))"
                ),
                {"uids": list(uids.values())},
            ).all()
        )
        session.execute(
            text(
                "UPDATE track_mix_profiles SET analyzer_version = 'smart-mix-audio-v7',"
                " phrases = CAST('[]' AS jsonb) WHERE track_id = :track_id"
            ),
            {"track_id": ids[uids["track_genre"]]},
        )
        orphan = session.execute(
            text(
                "INSERT INTO library_tracks (album_id, artist, album, filename, title,"
                " path, entity_uid, duration) SELECT album_id, artist, album,"
                " 'orphan.flac', 'orphan', path || '.orphan', CAST(:uid AS uuid), 1.0"
                " FROM library_tracks WHERE id = :track_id RETURNING id"
            ),
            {"uid": str(uuid.uuid4()), "track_id": ids[uids["track_genre"]]},
        ).scalar_one()
    wanted = [
        ids[uids["track_genre"]],
        ids[uids["stale_profile"]],
        ids[uids["unavailable_profile"]],
        orphan,
        orphan,
    ]

    rows = {row["track_id"]: row for row in get_pool_profile_states(wanted)}

    assert len(rows) == 4
    assert rows[ids[uids["track_genre"]]] == {
        "track_id": ids[uids["track_genre"]],
        "entity_uid": uids["track_genre"],
        "analyzer_version": "smart-mix-audio-v7",
        "quality": "full",
        "has_phrases": True,
        "stale": False,
    }
    assert rows[ids[uids["stale_profile"]]]["stale"] is True
    assert rows[ids[uids["unavailable_profile"]]]["quality"] == "unavailable"
    assert rows[orphan]["analyzer_version"] is None
    assert rows[orphan]["has_phrases"] is False
    assert get_pool_profile_states([]) == []
