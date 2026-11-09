"""S3 query budget: one bounded statement per request, no library aggregates."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import event, text

from tests.conftest import PG_AVAILABLE
from tests.test_decks_library_api import (
    _album,
    _crate_member,
    _genre,
    _global_album,
    _global_track,
    _like,
    _moods,
    _play,
    _playlist,
    _profile,
    _tag_album,
    _track,
    _user,
)


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")

_KINDS = ("playlist", "crate", "genre", "mood", "recent", "likes")


@pytest.fixture
def seeded(pg_db, tmp_path: Path) -> dict:
    from crate.db.repositories.crates import add_crate_album, create_crate

    del pg_db
    me, friend = _user("budget-me"), _user("budget-friend")
    album = _album(tmp_path, "Budget")
    tracks = [_track(tmp_path, album, f"B{n}", number=n) for n in range(6)]
    _profile(tracks[0]["id"])
    playlist_id = _playlist("Budget", me, tracks=tracks)
    global_album = _global_album()
    for track in tracks[:3]:
        _global_track(global_album, local=track)
    crate_id = create_crate(owner_id=friend, name="Budget crate", is_collaborative=True)
    _crate_member(crate_id, me, friend)
    add_crate_album(crate_id, global_album, added_by=friend)
    genre = _genre("Budget genre")
    _tag_album(album, genre)
    now = datetime.now(timezone.utc)
    for index, track in enumerate(tracks):
        _moods(track, {"party": 0.9 - index / 10})
        _play(me, now - timedelta(minutes=index), track=track)
    for age, track in enumerate(tracks[3:]):
        _like(me, track, now - timedelta(days=age))
    return {
        "user_id": me,
        "containers": {
            "playlist": str(playlist_id),
            "crate": crate_id,
            "genre": str(genre),
            "mood": "party",
            "recent": "me",
            "likes": "me",
        },
    }


def _record_statements():
    from crate.db.engine import get_engine

    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", record)
    return statements, lambda: event.remove(engine, "before_cursor_execute", record)


def _single_statement(call) -> tuple[object, list[str]]:
    statements, stop = _record_statements()
    try:
        result = call()
    finally:
        stop()
    return result, statements


def test_single_query_per_page(seeded):
    from crate.db.queries.decks_library import (
        get_decks_container_tracks,
        get_decks_containers,
    )

    user_id = seeded["user_id"]
    tree, statements = _single_statement(lambda: get_decks_containers(user_id))
    assert tree
    assert len(statements) == 1, statements

    for kind, container_id in seeded["containers"].items():

        def page(after, kind=kind, container_id=container_id):
            return get_decks_container_tracks(
                kind, container_id, user_id=user_id, after=after, limit=2
            )

        first, statements = _single_statement(lambda: page(None))
        assert first is not None and len(first["tracks"]) == 2, kind
        assert first["next_after"], kind
        assert len(statements) == 1, (kind, statements)

        second, statements = _single_statement(lambda: page(first["next_after"]))
        assert second is not None and second["tracks"], kind
        assert {t["entity_uid"] for t in second["tracks"]}.isdisjoint(
            t["entity_uid"] for t in first["tracks"]
        ), kind
        assert len(statements) == 1, (kind, statements)


def _plan_nodes(plan: dict):
    yield plan
    for child in plan.get("Plans", []):
        yield from _plan_nodes(child)


def _explain(statement, params, *, analyze: bool = False) -> dict:
    from crate.db.tx import read_scope

    options = "ANALYZE, BUFFERS, FORMAT JSON" if analyze else "FORMAT JSON"
    with read_scope() as session:
        raw = session.execute(
            text(f"EXPLAIN ({options}) " + str(statement)), params
        ).scalar_one()
    return (json.loads(raw) if isinstance(raw, str) else raw)[0]["Plan"]


def _after_for(kind: str) -> list:
    stamp = datetime.now(timezone.utc).isoformat()
    return {
        "playlist": [1, 1],
        "crate": [0, 1, 1, 1],
        "genre": [1, 1, 1, 1],
        "mood": [0.7, 1],
        "recent": [stamp, 1],
        "likes": [stamp, 1],
    }[kind]


def _statements(user_id: int, containers: dict) -> list[tuple[str, object, dict]]:
    from crate.db.queries.decks_library import (
        decks_container_tracks_statement,
        decks_containers_statement,
    )

    statements = [("tree", *decks_containers_statement(user_id))]
    for kind, container_id in containers.items():
        for after in (None, _after_for(kind)):
            statements.append(
                (
                    f"{kind}:{'next' if after else 'first'}",
                    *decks_container_tracks_statement(
                        kind, container_id, user_id=user_id, after=after, limit=500
                    ),
                )
            )
    return statements


def test_no_aggregate_over_library_tracks(seeded):
    for name, statement, params in _statements(seeded["user_id"], seeded["containers"]):
        plan = _explain(statement, params)
        for node in _plan_nodes(plan):
            if node["Node Type"] != "Aggregate":
                continue
            scanned = {
                child.get("Relation Name")
                for child in _plan_nodes(node)
                if child is not node
            }
            assert "library_tracks" not in scanned, (name, node)


def _seed_synthetic_library(tmp_path: Path) -> dict:
    """10,000 tracks in 200 albums, with every container kind populated."""
    from crate.db.repositories.crates import add_crate_album, create_crate
    from crate.db.tx import transaction_scope

    me = _user("explain")
    root = str(tmp_path / uuid.uuid4().hex)
    genre = _genre("Explain genre")
    playlist_id = _playlist("Explain", me)
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO library_artists (name, entity_uid)
                VALUES ('Explain artist', gen_random_uuid())
                ON CONFLICT (name) DO NOTHING
                """
            )
        )
        session.execute(
            text(
                """
                INSERT INTO library_albums (artist, name, path, entity_uid, track_count)
                SELECT 'Explain artist', 'Explain ' || n, :root || '/album-' || n,
                       gen_random_uuid(), 50
                FROM generate_series(1, 200) AS n
                """
            ),
            {"root": root},
        )
        session.execute(
            text(
                """
                INSERT INTO library_tracks (
                    album_id, artist, album, filename, title, path, entity_uid,
                    duration, disc_number, track_number, size, mood_json
                )
                SELECT a.id, a.artist, a.name, n || '.flac', 'Synthetic ' || n,
                       a.path || '/' || n || '.flac', gen_random_uuid(), 200,
                       1, n, 1000,
                       jsonb_build_object(
                           'party', ((a.id * 50 + n) % 100) / 100.0,
                           'dark', ((a.id * 31 + n) % 100) / 100.0
                       )
                FROM library_albums a, generate_series(1, 50) AS n
                WHERE a.artist = 'Explain artist'
                """
            )
        )
        # A large genre: 30% of the albums.
        session.execute(
            text(
                """
                INSERT INTO album_genres (album_id, genre_id)
                SELECT a.id, :genre FROM library_albums a
                WHERE a.artist = 'Explain artist' AND a.id % 10 < 3
                """
            ),
            {"genre": genre},
        )
        session.execute(
            text(
                """
                INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
                SELECT :playlist_id, t.id, row_number() OVER (ORDER BY t.id), NOW()
                FROM library_tracks t
                WHERE t.artist = 'Explain artist'
                ORDER BY t.id
                LIMIT 600
                """
            ),
            {"playlist_id": playlist_id},
        )
        session.execute(
            text(
                """
                INSERT INTO user_liked_tracks (user_id, track_id, created_at)
                SELECT :user_id, t.id, NOW() - t.id * INTERVAL '1 second'
                FROM library_tracks t
                WHERE t.artist = 'Explain artist' AND t.id % 16 = 0
                """
            ),
            {"user_id": me},
        )
        session.execute(
            text(
                """
                INSERT INTO user_play_events (
                    user_id, track_id, track_entity_uid, started_at, ended_at,
                    created_at
                )
                SELECT :user_id, t.id, t.entity_uid,
                       NOW() - n * INTERVAL '4 minutes',
                       NOW() - n * INTERVAL '4 minutes' + INTERVAL '3 minutes',
                       NOW()
                FROM generate_series(1, 2500) AS n
                JOIN library_tracks t
                  ON t.track_number = 1 + n % 50
                 AND t.album_id = (
                     SELECT MIN(id) FROM library_albums
                     WHERE artist = 'Explain artist'
                 ) + n % 37
                """
            ),
            {"user_id": me},
        )
        session.execute(
            text(
                """
                INSERT INTO track_mix_profiles (
                    track_id, profile_version, profile_revision, analyzer,
                    analyzer_version, source_revision, quality, bpm,
                    key_camelot, global_energy, analyzed_at
                )
                SELECT t.id, 1, 'rev-' || t.id, 'crate-python', 'synthetic',
                       'source', 'full', 124, '8A', 0.5, NOW()
                FROM library_tracks t
                WHERE t.artist = 'Explain artist'
                """
            )
        )
    crate_id = create_crate(owner_id=me, name="Explain crate")
    with transaction_scope() as session:
        album_ids = (
            session.execute(
                text(
                    "SELECT id FROM library_albums WHERE artist = 'Explain artist' "
                    "ORDER BY id LIMIT 20"
                )
            )
            .scalars()
            .all()
        )
    for album_id in album_ids:
        global_album = _global_album()
        with transaction_scope() as session:
            session.execute(
                text(
                    """
                    INSERT INTO global_catalog_tracks (
                        global_track_uid, global_album_uid, global_artist_uid,
                        canonical_title, normalized_title, artist_name, album_name,
                        disc_number, track_number, duration_seconds, has_local,
                        has_remote, local_track_id, local_track_entity_uid
                    )
                    SELECT gen_random_uuid(), album.global_album_uid,
                           album.global_artist_uid, t.title, lower(t.title),
                           'Artist', 'Album', 1, t.track_number, 200, TRUE, FALSE,
                           t.id, t.entity_uid
                    FROM global_catalog_albums album, library_tracks t
                    WHERE album.global_album_uid = CAST(:album_uid AS uuid)
                      AND t.album_id = :album_id
                    """
                ),
                {"album_uid": global_album, "album_id": album_id},
            )
        add_crate_album(crate_id, global_album, added_by=me)
    with transaction_scope() as session:
        for table in (
            "library_albums",
            "library_tracks",
            "album_genres",
            "playlist_tracks",
            "global_catalog_tracks",
            "track_mix_profiles",
            "user_play_events",
            "user_liked_tracks",
        ):
            session.execute(text(f"ANALYZE {table}"))
    return {
        "user_id": me,
        "containers": {
            "playlist": str(playlist_id),
            "crate": crate_id,
            "genre": str(genre),
            "mood": "party",
            "recent": "me",
            "likes": "me",
        },
    }


def test_explain_uses_index(pg_db, tmp_path: Path):
    """No container page scans the library, first or next page, at 10,000 tracks."""
    del pg_db
    synthetic = _seed_synthetic_library(tmp_path)

    for name, statement, params in _statements(
        synthetic["user_id"], synthetic["containers"]
    ):
        plan = _explain(statement, params, analyze=True)
        scans = [
            node
            for node in _plan_nodes(plan)
            if node.get("Relation Name") == "library_tracks"
        ]
        if name != "tree":
            assert scans, (name, plan)
        else:
            # The library's track count comes from the albums' counts.
            assert not scans, (name, plan)
        assert all(node["Node Type"] != "Seq Scan" for node in scans), (name, plan)
