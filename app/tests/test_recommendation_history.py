from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import event, text

from crate.db.tx import read_scope, transaction_scope

NOW = datetime(2026, 10, 28, 12, tzinfo=timezone.utc)
SINCE = NOW - timedelta(days=7)


def _seed_song(*, title="Noah", artist="Birds In Row"):
    entity_uid, global_uid, artist_uid = (str(uuid4()) for _ in range(3))
    with transaction_scope() as session:
        track_id = session.execute(
            text(
                """
                INSERT INTO library_tracks
                    (entity_uid, artist, album, filename, title, path, duration)
                VALUES
                    (:entity_uid, :artist, 'History fixture', :filename, :title, :path, 180)
                RETURNING id
                """
            ),
            {
                "entity_uid": entity_uid,
                "artist": artist,
                "filename": f"{entity_uid}.flac",
                "title": title,
                "path": f"/music/history/{entity_uid}.flac",
            },
        ).scalar_one()
        session.execute(
            text(
                """
                INSERT INTO global_catalog_artists
                    (global_artist_uid, canonical_name, sort_name, normalized_name)
                VALUES (:uid, :artist, :artist, LOWER(:artist))
                """
            ),
            {"uid": artist_uid, "artist": artist},
        )
        session.execute(
            text(
                """
                INSERT INTO global_catalog_tracks
                    (global_track_uid, global_artist_uid, canonical_title,
                     normalized_title, artist_name, local_track_id, local_track_entity_uid)
                VALUES
                    (:uid, :artist_uid, :title, LOWER(:title), :artist, :track_id, :entity_uid)
                """
            ),
            {
                "uid": global_uid,
                "artist_uid": artist_uid,
                "title": title,
                "artist": artist,
                "track_id": track_id,
                "entity_uid": entity_uid,
            },
        )
    return {
        "id": track_id,
        "entity_uid": entity_uid,
        "global_track_uid": global_uid,
        "artist": artist,
        "title": title,
    }


def _events(*rows, session=None):
    defaults = {
        "user_id": 1,
        "track_id": None,
        "track_entity_uid": None,
        "global_track_uid": None,
        "artist": "Birds In Row",
        "title": "Noah",
        "ended_at": NOW - timedelta(days=1),
        "played_seconds": 30,
        "duration": 180,
        "completed": False,
        "skipped": False,
    }
    params = [{**defaults, "client_event_id": str(uuid4()), **row} for row in rows]
    statement = text(
        """
        INSERT INTO user_play_events
            (user_id, client_event_id, track_id, track_entity_uid, global_track_uid,
             artist, title, started_at, ended_at, created_at, played_seconds,
             track_duration_seconds, was_completed, was_skipped)
        VALUES
            (:user_id, :client_event_id, :track_id, CAST(:track_entity_uid AS uuid),
             CAST(:global_track_uid AS uuid), :artist, :title,
             :ended_at - INTERVAL '3 minutes', :ended_at, :ended_at, :played_seconds,
             :duration, :completed, :skipped)
        ON CONFLICT (user_id, client_event_id)
            WHERE client_event_id IS NOT NULL DO NOTHING
        """
    )
    if session is not None:
        session.execute(statement, params)
    else:
        with transaction_scope() as current:
            current.execute(statement, params)


def test_local_entity_global_and_metadata_families_share_recency(pg_db):
    from crate.db.queries.recommendation_history import history_for_candidates

    song = _seed_song()
    _events(
        {"track_id": song["id"], "artist": "obsolete", "title": "obsolete"},
        {"track_entity_uid": song["entity_uid"], "artist": None, "title": None},
        {
            "global_track_uid": song["global_track_uid"],
            "artist": "obsolete global metadata",
            "title": "obsolete global metadata",
            "ended_at": NOW - timedelta(hours=1),
            "completed": True,
        },
        {"artist": "BIRDS IN ROW", "title": "Noah - Live"},
        {"artist": "Birds In Row", "title": "Cathedrals"},
        {"artist": "Other Artist", "title": "Noah"},
    )

    expected = {
        ("birds in row", "noah"): {
            "last_significant_play_at": NOW - timedelta(hours=1),
            "frequency": 4,
            "completed": 1,
        }
    }
    for ref in (
        {"track_id": song["id"]},
        {"entity_uid": song["entity_uid"]},
        {"global_track_uid": song["global_track_uid"]},
        {"artist": "Birds In Row", "title": "Noah (Remastered)"},
        str(song["id"]),
        song["entity_uid"],
        song["global_track_uid"],
    ):
        assert history_for_candidates(1, [ref], SINCE, now=NOW) == expected


def test_brief_events_never_hide_a_significant_play_six_days_ago(pg_db):
    from crate.db.queries.recommendation_history import history_for_candidates

    song = _seed_song()
    significant = NOW - timedelta(days=6)
    _events({"track_id": song["id"], "ended_at": significant})
    _events(
        *[
            {
                "track_id": song["id"],
                "ended_at": NOW - timedelta(seconds=index + 1),
                "played_seconds": 18.77,
                "skipped": index % 2 == 0,
            }
            for index in range(501)
        ]
    )
    with read_scope() as session:
        assert (
            session.execute(text("SELECT COUNT(*) FROM user_track_daily")).scalar() == 0
        )

    assert history_for_candidates(1, [song], SINCE, now=NOW) == {
        ("birds in row", "noah"): {
            "last_significant_play_at": significant,
            "frequency": 1,
            "completed": 0,
        }
    }


def test_history_window_is_inclusive_utc_and_isolated_by_user(pg_db):
    from crate.db.queries.recommendation_history import history_for_candidates

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO users (id, email, password_hash, role, created_at)
                VALUES (88889, 'rotation-other@example.test', 'none', 'user', NOW())
                """
            )
        )
    _events(
        {"title": "At boundary", "ended_at": SINCE},
        {"title": "Too old", "ended_at": SINCE - timedelta(microseconds=1)},
        {"title": "Now", "ended_at": NOW},
        {"title": "Future", "ended_at": NOW + timedelta(microseconds=1)},
        {"title": "Other user", "user_id": 88889},
    )
    refs = [
        {"artist": "Birds In Row", "title": title}
        for title in ("At boundary", "Too old", "Now", "Future", "Other user")
    ]
    offset = timezone(timedelta(hours=2))
    result = history_for_candidates(
        1, refs, SINCE.astimezone(offset), now=NOW.astimezone(offset)
    )

    assert set(result) == {("birds in row", "at boundary"), ("birds in row", "now")}
    assert result[("birds in row", "at boundary")]["last_significant_play_at"] == SINCE
    assert result[("birds in row", "now")]["last_significant_play_at"] == NOW


def test_each_event_uses_seconds_or_completion_including_skips(pg_db):
    from crate.db.queries.recommendation_history import history_for_candidates

    _events(
        {"title": "Short", "played_seconds": 20, "duration": 40, "skipped": True},
        {"title": "Unknown", "played_seconds": 30, "duration": None},
        {"title": "Brief unknown", "played_seconds": 18.77, "duration": None},
        {
            "title": "Completed",
            "played_seconds": 0,
            "completed": True,
            "skipped": True,
        },
        {"title": "Missing signals", "played_seconds": 0, "duration": None},
        {"title": "Interrupted", "played_seconds": 30},
        {"title": "Combined brief", "played_seconds": 18.77},
        {"title": "Combined brief", "played_seconds": 18.77},
        {"title": "Invalid seconds", "played_seconds": float("nan")},
    )
    titles = [
        "Short",
        "Unknown",
        "Brief unknown",
        "Completed",
        "Missing signals",
        "Interrupted",
        "Combined brief",
        "Invalid seconds",
    ]
    result = history_for_candidates(
        1,
        [{"artist": "Birds In Row", "title": title} for title in titles],
        SINCE,
        now=NOW,
    )

    assert set(result) == {
        ("birds in row", title)
        for title in ("short", "unknown", "completed", "interrupted")
    }
    assert result[("birds in row", "completed")]["completed"] == 1
    assert result[("birds in row", "short")]["completed"] == 0


def test_duplicate_source_events_and_candidate_aliases_are_not_counted_twice(pg_db):
    from crate.db.queries.recommendation_history import history_for_candidates

    song = _seed_song()
    row = {"track_id": song["id"], "client_event_id": "same-client-event"}
    _events(row, row)

    result = history_for_candidates(
        1,
        [song, song, {"global_track_uid": song["global_track_uid"]}],
        SINCE,
        now=NOW,
    )

    assert result[("birds in row", "noah")]["frequency"] == 1


@pytest.mark.parametrize("preload_window", [False, True])
def test_history_reuses_the_callers_transaction_in_one_batched_query(
    pg_db, preload_window
):
    from crate.db.queries.recommendation_history import history_for_candidates

    songs = [_seed_song(title=f"Candidate {index}") for index in range(4)]
    with transaction_scope() as session:
        _events({"track_id": songs[0]["id"], "title": "Candidate 0"}, session=session)
        statements = []

        def capture_statement(_conn, _cursor, statement, _parameters, _context, _many):
            statements.append(statement)

        bind = session.get_bind()
        event.listen(bind, "before_cursor_execute", capture_statement)
        try:
            result = history_for_candidates(
                1, None if preload_window else songs, SINCE, now=NOW, session=session
            )
        finally:
            event.remove(bind, "before_cursor_execute", capture_statement)

        assert result[("birds in row", "candidate 0")]["frequency"] == 1
        assert len(statements) == 1
        assert session.in_transaction()


def test_none_preloads_all_significant_songs_for_only_the_requested_user(pg_db):
    from crate.db.queries.recommendation_history import history_for_candidates

    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO users (id, email, password_hash, role, created_at)
                VALUES (88889, 'rotation-preload-other@example.test', 'none', 'user', NOW())
                """
            )
        )
    _events(
        {"title": "Noah"},
        {"title": "Cathedrals - Live", "completed": True},
        {"title": "Other user", "user_id": 88889},
        {"title": "Brief", "played_seconds": 18.77},
        {"artist": None, "title": None},
    )

    all_songs = history_for_candidates(1, None, SINCE, now=NOW)
    filtered = history_for_candidates(
        1, [{"artist": "Birds In Row", "title": "Noah"}], SINCE, now=NOW
    )
    other_user = history_for_candidates(88889, None, SINCE, now=NOW)

    assert set(all_songs) == {("birds in row", "noah"), ("birds in row", "cathedrals")}
    assert filtered == {("birds in row", "noah"): all_songs[("birds in row", "noah")]}
    assert all_songs[("birds in row", "cathedrals")]["completed"] == 1
    assert set(other_user) == {("birds in row", "other user")}


def test_empty_candidates_do_not_open_a_database_scope(monkeypatch):
    from crate.db.queries import recommendation_history

    def fail_scope():
        pytest.fail("Empty candidates must not access the database")

    monkeypatch.setattr(recommendation_history, "read_scope", fail_scope)
    assert recommendation_history.history_for_candidates(1, [], SINCE, now=NOW) == {}


def test_candidate_ids_outside_positive_bigint_are_ignored_without_a_query(monkeypatch):
    from crate.db.queries import recommendation_history

    def fail_scope():
        pytest.fail("Unusable candidate IDs must not access the database")

    monkeypatch.setattr(recommendation_history, "read_scope", fail_scope)
    refs = [str(2**65), {"id": 2**65}, {"id": -1}, {"track_id": 0}]
    assert recommendation_history.history_for_candidates(1, refs, SINCE, now=NOW) == {}


def test_candidates_without_valid_ids_or_song_identity_do_not_query_events(monkeypatch):
    from crate.db.queries import recommendation_history

    def fail_scope():
        pytest.fail("Candidates without an identity must not query events")

    monkeypatch.setattr(recommendation_history, "read_scope", fail_scope)
    refs = [
        {"id": "bad", "entity_uid": "bad", "global_track_uid": "bad"},
        {"artist": "Birds In Row"},
        "unknown",
    ]
    assert recommendation_history.history_for_candidates(1, refs, SINCE, now=NOW) == {}


@pytest.fixture
def repeated_history_catalog(pg_db):
    songs = [
        _seed_song(title=f"Work Song {index}", artist="History Work Artist")
        for index in range(12)
    ]
    with transaction_scope() as session:
        session.execute(
            text("""
                INSERT INTO library_tracks
                    (entity_uid, artist, album, filename, title, path, duration)
                SELECT md5('history-work-local-' || n)::uuid, 'Unrelated Artist',
                       'Unrelated Album', n || '.flac', 'Unrelated Song ' || n,
                       '/music/history-work/' || n || '.flac', 180
                FROM generate_series(1, 8000) n
            """)
        )
        session.execute(
            text("""
                INSERT INTO global_catalog_tracks
                    (global_track_uid, global_artist_uid, canonical_title,
                     normalized_title, artist_name)
                SELECT md5('history-work-global-' || n)::uuid, source.global_artist_uid,
                       'Unrelated Song ' || n, 'unrelated song ' || n, 'Unrelated Artist'
                FROM generate_series(1, 8000) n
                CROSS JOIN global_catalog_tracks source
                WHERE source.global_track_uid = CAST(:global_uid AS uuid)
            """),
            {"global_uid": songs[0]["global_track_uid"]},
        )
        _events(
            *[
                {
                    "track_id": song["id"],
                    "track_entity_uid": song["entity_uid"],
                    "global_track_uid": song["global_track_uid"],
                    "artist": "Obsolete event artist",
                    "title": "Obsolete event title",
                    "ended_at": NOW - timedelta(minutes=repeat),
                    "completed": repeat % 3 == 0,
                }
                for song in songs
                for repeat in range(120)
            ],
            session=session,
        )
        for table in ("library_tracks", "global_catalog_tracks", "user_play_events"):
            session.execute(text(f"ANALYZE {table}"))
    return songs


@pytest.mark.parametrize("preload_window", [False, True], ids=["candidates", "preload"])
def test_history_catalog_work_is_bounded_by_distinct_references(
    repeated_history_catalog, preload_window
):
    from crate.db.queries.recommendation_history import history_for_candidates

    songs = repeated_history_catalog
    captured = []

    def capture(_conn, statement, _many, params, _options):
        captured.append((statement, params))

    with read_scope() as session:
        connection = session.connection()
        event.listen(connection, "before_execute", capture)
        try:
            result = history_for_candidates(
                1, None if preload_window else songs, SINCE, now=NOW, session=session
            )
        finally:
            event.remove(connection, "before_execute", capture)
        assert len(captured) == 1
        assert result == {
            ("history work artist", f"work song {index}"): {
                "last_significant_play_at": NOW,
                "frequency": 120,
                "completed": 40,
            }
            for index in range(len(songs))
        }
        statement, params = captured[0]
        plan = session.execute(
            text("EXPLAIN (ANALYZE, FORMAT JSON) " + str(statement)), params
        ).scalar_one()[0]["Plan"]

    scans = []
    pending = [plan]
    while pending:
        node = pending.pop()
        if node.get("Relation Name") in ("library_tracks", "global_catalog_tracks"):
            scans.append(node)
        pending.extend(node.get("Plans", []))
    assert scans
    catalog_work = sum(
        max(
            1,
            node["Actual Rows"]
            + node.get("Rows Removed by Filter", 0)
            + node.get("Rows Removed by Index Recheck", 0),
        )
        * node["Actual Loops"]
        for node in scans
    )
    # Several keyed access paths are allowed for each distinct ID/UID, not per play.
    distinct_references = 3 * len(songs)
    assert catalog_work <= 8 * distinct_references, [
        (
            node["Node Type"],
            node["Relation Name"],
            node["Actual Rows"],
            node["Actual Loops"],
        )
        for node in scans
    ]


def test_catalog_precedence_preserves_unicode_and_version_families(pg_db):
    from crate.db.queries.recommendation_history import history_for_candidates

    song = _seed_song(artist="Björk", title="L’Été")
    other = _seed_song(artist="Wrong Artist", title="Wrong Song")
    _events(
        {
            "track_id": song["id"],
            "track_entity_uid": other["entity_uid"],
            "global_track_uid": other["global_track_uid"],
            "artist": "Obsolete Artist",
            "title": "Obsolete Song",
        },
        {"artist": "BJÖRK", "title": "L'Été (Live)", "completed": True},
    )

    assert history_for_candidates(1, [song], SINCE, now=NOW) == {
        ("björk", "lété"): {
            "last_significant_play_at": NOW - timedelta(days=1),
            "frequency": 2,
            "completed": 1,
        }
    }
