import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

from crate.recommendation_policy import canonical_key
from crate import radio_engine
from tests.recommendation_evaluation import generate_snapshot_batch


def _snapshot(name="citizen"):
    return json.loads(
        (
            Path(__file__).parent / "fixtures" / "recommendations" / f"{name}.json"
        ).read_text()
    )


def _history(tracks):
    return {
        canonical_key(track): {
            "last_significant_play_at": datetime(2026, 10, 27, 12, tzinfo=timezone.utc),
            "frequency": 1,
            "completed": 1,
        }
        for track in tracks
    }


def test_citizen_rotates_listened_songs_within_the_existing_seed_context(monkeypatch):
    snapshot = _snapshot()
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "false")
    before = generate_snapshot_batch(snapshot, session_id="baseline-a")
    recent = _history(before["tracks"])
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    after = generate_snapshot_batch(
        snapshot,
        session_id="baseline-b",
        reference_day="2026-10-29",
        recent_plays=recent,
    )
    before_keys = set(recent)
    after_keys = {canonical_key(track) for track in after["tracks"]}
    assert len(after["tracks"]) == 20
    assert len(after_keys - before_keys) >= 15
    assert after == generate_snapshot_batch(
        snapshot,
        session_id="baseline-b",
        reference_day="2026-10-29",
        recent_plays=recent,
    )


def test_generated_or_prefetched_tracks_do_not_count_as_listens(monkeypatch):
    snapshot = _snapshot()
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "false")
    original = generate_snapshot_batch(snapshot, session_id="baseline-a")
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    assert (
        generate_snapshot_batch(snapshot, session_id="baseline-a", recent_plays={})
        == original
    )


def test_disabled_flag_keeps_original_ranking_even_with_history(monkeypatch):
    snapshot = _snapshot()
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "false")
    original = generate_snapshot_batch(snapshot, session_id="baseline-a")
    assert (
        generate_snapshot_batch(
            snapshot,
            session_id="baseline-a",
            recent_plays=_history(snapshot["candidate_rows"]),
        )
        == original
    )


def test_all_cooled_candidates_recover_instead_of_emptying_the_queue(monkeypatch):
    snapshot = _snapshot()
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    result = generate_snapshot_batch(
        snapshot,
        session_id="baseline-a",
        recent_plays=_history(snapshot["candidate_rows"]),
    )
    assert len(result["tracks"]) == 20


def test_rotation_reuses_same_artist_when_only_the_song_was_listened(monkeypatch):
    snapshot = _snapshot()
    snapshot["batch_size"] = 1
    first = dict(
        snapshot["candidate_rows"][0],
        id=1001,
        artist="Citizen",
        title="Played",
        radio_source="similar",
    )
    second = dict(first, id=1002, title="Fresh")
    snapshot["candidate_rows"] = [first, second]
    snapshot["graphs"]["genres"]["citizen"] = {"post-hardcore": 1.0}
    snapshot["graphs"]["similarity"]["citizen"] = {"citizen": 1.0}
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    result = generate_snapshot_batch(
        snapshot, session_id="baseline-a", recent_plays=_history([first])
    )
    assert [track["title"] for track in result["tracks"]] == ["Fresh"]


def test_fresh_unrelated_genres_do_not_displace_coherent_cooled_songs(monkeypatch):
    snapshot = _snapshot()
    snapshot["batch_size"] = 1
    first = dict(
        snapshot["candidate_rows"][0],
        id=1001,
        artist="Citizen",
        title="Coherent",
        radio_source="similar",
    )
    second = dict(first, id=1002, title="Unrelated", artist="Techno Artist")
    snapshot["candidate_rows"] = [first, second]
    snapshot["graphs"]["genres"] = {
        "citizen": {"post-hardcore": 1.0},
        "techno artist": {"techno": 1.0},
    }
    snapshot["graphs"]["similarity"] = {"citizen": {"citizen": 1.0}}
    snapshot["graphs"]["shared_members"] = {}
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    result = generate_snapshot_batch(
        snapshot, session_id="baseline-a", recent_plays=_history([first])
    )
    assert [track["title"] for track in result["tracks"]] == ["Coherent"]


def test_global_catalog_radio_prefers_fresh_songs_of_the_same_seed_artist(monkeypatch):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    tracks = [
        {"global_track_uid": f"global-{i}", "artist": "Citizen", "title": title}
        for i, title in enumerate(("Listened", "Fresh", "Fresh (Live)", "Another"))
    ]
    monkeypatch.setattr(
        radio_engine, "history_for_candidates", lambda *a, **k: _history(tracks[:1])
    )
    session = {"user_id": 1, "global_tracks": tracks, "global_source_exhausted": True}
    result = radio_engine._generate_global_batch(session, count=2)
    assert [row["title"] for row in result] == ["Fresh", "Another"]


def test_global_buffer_protects_song_family_outside_the_loaded_candidate_pool(
    monkeypatch,
):
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    buffer_uid = "123e4567-e89b-12d3-a456-426614174042"
    monkeypatch.setattr(
        "crate.db.queries.radio_continuation.get_buffer_context",
        lambda refs: [
            {
                "track_id": None,
                "global_track_uid": buffer_uid,
                "artist": "Citizen",
                "title": "Song",
                "bliss_vector": None,
            }
        ],
    )
    session = {
        "radio_profile": "global_catalog",
        "global_source_exhausted": True,
        "global_tracks": [
            {
                "global_track_uid": "other-version",
                "artist": "Citizen",
                "title": "Song (Live)",
            },
            {"global_track_uid": "fresh", "artist": "Citizen", "title": "Fresh"},
        ],
    }
    radio_engine._apply_buffer_context(session, [buffer_uid])
    assert [
        row["title"] for row in radio_engine._generate_global_batch(session, 20)
    ] == ["Fresh"]


def test_real_event_history_drives_seeded_retrieval_and_rotation(pg_db, monkeypatch):
    from sqlalchemy import event, text
    from crate.db.tx import transaction_scope, read_scope

    pg_db.upsert_artist({"name": "Citizen"})
    album = pg_db.upsert_album(
        {"artist": "Citizen", "name": "Rotation", "path": "/music/rotation"}
    )
    with transaction_scope() as current:
        for title, seconds in (("Played", 30.0), ("Fresh", 18.77)):
            track = current.execute(
                text("""
                INSERT INTO library_tracks(album_id, artist, album, filename, title, path, duration, bliss_vector)
                VALUES (:album, 'Citizen', 'Rotation', :title, :title, :path, 180, CAST(:vector AS double precision[]))
                RETURNING id
            """),
                {
                    "album": album,
                    "title": title,
                    "path": f"/music/rotation/{title}.flac",
                    "vector": [0.2] * 20,
                },
            ).scalar_one()
            current.execute(
                text("""
                INSERT INTO user_play_events(user_id, client_event_id, track_id, artist, title,
                    started_at, ended_at, created_at, played_seconds, track_duration_seconds, was_completed)
                VALUES (1, :title, :track, 'Citizen', :title, '2026-10-27T12:00:00Z',
                    '2026-10-27T12:03:00Z', '2026-10-27T12:03:00Z', :seconds, 180, false)
            """),
                {"title": title, "track": track, "seconds": seconds},
            )
    snapshot = _snapshot()
    state = deepcopy(snapshot["initial_session"])
    state.update(
        user_id=1,
        seed_track_ids=[],
        seed_artists=["Citizen"],
        seed_vector=[0.2] * 20,
        current_target=[0.2] * 20,
        generation_seed=42,
    )
    graphs = snapshot["graphs"]
    monkeypatch.setattr(
        radio_engine,
        "_load_radio_graphs",
        lambda **k: (
            graphs["similarity"],
            graphs["genres"],
            {k: set(v) for k, v in graphs["shared_members"].items()},
        ),
    )
    now = datetime(2026, 10, 28, 12, tzinfo=timezone.utc)
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "false")
    assert (
        radio_engine._generate_batch(deepcopy(state), 1, now=now)[0]["title"]
        == "Played"
    )
    monkeypatch.setenv("CRATE_RADIO_ROTATION_ENABLED", "true")
    statements = []
    with read_scope() as current:
        connection = current.connection()

        def record(_conn, _cursor, statement, *_args):
            if statement.lstrip().upper().startswith(("SELECT", "WITH")):
                statements.append(statement)

        event.listen(connection, "before_cursor_execute", record)
        try:
            result = radio_engine._generate_batch(
                deepcopy(state), 1, db_session=current, now=now
            )
        finally:
            event.remove(connection, "before_cursor_execute", record)
    assert result[0]["title"] == "Fresh"
    assert (
        len(statements) <= 3
    )  # One more query resolves the active buffer on indexed requests.
