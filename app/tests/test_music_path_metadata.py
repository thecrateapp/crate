from copy import deepcopy
from importlib import import_module
from unittest.mock import MagicMock

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import event, text

from crate import music_paths as service
from crate.db.paths_service_reads import get_music_path, list_music_paths
from crate.db.repositories.paths import (
    create_music_path_record,
    update_music_path_tracks,
)
from crate.track_versions import track_song_identity


def _metadata(count, *, requested=None):
    requested = count if requested is None else requested
    return {
        "is_partial": count < requested,
        "generated_step_count": count,
        "warnings": [
            {"code": "insufficient_tracks", "expected": requested, "actual": count}
        ]
        if count < requested
        else [],
    }


def _report(path):
    return {
        key: path[key] for key in ("is_partial", "generated_step_count", "warnings")
    }


def _record(tracks, *, metadata=None, requested=None, session=None):
    return create_music_path_record(
        user_id=1,
        name="Saved journey",
        origin_type="track",
        origin_value=str(tracks[0]["track_id"]),
        origin_label=tracks[0]["title"],
        dest_type="track",
        dest_value=str(tracks[-1]["track_id"]),
        dest_label=tracks[-1]["title"],
        waypoints=[],
        step_count=requested if requested is not None else len(tracks),
        tracks=tracks,
        generation_metadata=metadata,
        session=session,
    )


def _forbid_planning(*args, **kwargs):
    raise AssertionError("Saved reads must not replan or load listening history")


@pytest.fixture
def saved_catalog(pg_db):
    from crate.db.tx import transaction_scope

    tracks = []
    with transaction_scope() as session:
        assert (
            session.execute(text("SELECT current_database()"))
            .scalar_one()
            .startswith("crate_test_case_")
        )
        for index in range(8):
            artist, album = f"Metadata Artist {index}", f"Metadata Album {index}"
            pg_db.upsert_artist({"name": artist}, session=session)
            album_id = pg_db.upsert_album(
                {
                    "artist": artist,
                    "name": album,
                    "path": f"/music/path-metadata/{index}",
                },
                session=session,
            )
            path = f"/music/path-metadata/{index}/song.flac"
            track_id = session.execute(
                text("""
                    INSERT INTO library_tracks
                        (album_id, artist, album, filename, title, path, duration, format)
                    VALUES (:album_id, :artist, :album, 'song.flac', :title, :path, 180, 'flac')
                    RETURNING id
                """),
                {
                    "album_id": album_id,
                    "artist": artist,
                    "album": album,
                    "title": f"Song {index}",
                    "path": path,
                },
            ).scalar_one()
            tracks.append(
                {
                    "track_id": track_id,
                    "artist": artist,
                    "album": album,
                    "album_id": album_id,
                    "title": f"Song {index}",
                    "path": path,
                    "progress": index / 7,
                    "step": index,
                    "playable": True,
                }
            )
    return tracks


def test_current_unavailability_preserves_saved_identity_order_and_generation_report(
    saved_catalog, monkeypatch
):
    from crate.db.engine import get_engine
    from crate.db.tx import transaction_scope

    metadata = _metadata(len(saved_catalog))
    row = _record(saved_catalog, metadata=metadata)
    assert row is not None
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET path='/music/.hidden/song.flac' WHERE id=:id"
            ),
            {"id": saved_catalog[1]["track_id"]},
        )
        session.execute(
            text("UPDATE library_albums SET path='/music/.hidden/album' WHERE id=:id"),
            {"id": saved_catalog[2]["album_id"]},
        )
        session.execute(
            text("UPDATE library_albums SET quarantined_at=NOW() WHERE id=:id"),
            {"id": saved_catalog[3]["album_id"]},
        )
        session.execute(
            text("UPDATE library_tracks SET artist='.crate-trash' WHERE id=:id"),
            {"id": saved_catalog[4]["track_id"]},
        )
        session.execute(
            text("DELETE FROM library_tracks WHERE id=:id"),
            {"id": saved_catalog[5]["track_id"]},
        )
        session.execute(
            text("UPDATE library_tracks SET path='' WHERE id=:id"),
            {"id": saved_catalog[6]["track_id"]},
        )
    for name in (
        "build_music_path_plan",
        "compute_scene_path",
        "compute_path",
        "history_for_candidates",
    ):
        monkeypatch.setattr(service, name, _forbid_planning)

    reads = []

    def observe(_conn, _cursor, statement, _params, _context, _many):
        if statement.lstrip().upper().startswith(("SELECT", "WITH")):
            reads.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", observe)
    try:
        saved = get_music_path(row["id"], 1)
    finally:
        event.remove(engine, "before_cursor_execute", observe)
    assert len(reads) == 1
    assert [track["track_id"] for track in saved["tracks"]] == [
        track["track_id"] for track in saved_catalog
    ]
    assert [track["playable"] for track in saved["tracks"]] == [
        True,
        False,
        False,
        False,
        False,
        False,
        False,
        True,
    ]
    assert _report(saved) == metadata
    replay = get_music_path(row["id"], 1)
    assert replay == saved
    assert _report(list_music_paths(1)[0]) == metadata
    assert list_music_paths(1)[0]["track_count"] == len(saved_catalog)
    assert get_music_path(row["id"], 2) is None
    assert list_music_paths(2) == []


@pytest.mark.parametrize("requested", [2, 5])
def test_legacy_metadata_default_derives_completeness_without_replanning_or_availability(
    saved_catalog, monkeypatch, requested
):
    from crate.db.tx import transaction_scope

    tracks = [saved_catalog[0], saved_catalog[-1]]
    row = _record(tracks, requested=requested)
    assert row is not None
    with transaction_scope() as session:
        stored = session.execute(
            text("SELECT generation_metadata FROM music_paths WHERE id=:id"),
            {"id": row["id"]},
        ).scalar_one()
        assert stored == {}
        session.execute(
            text("DELETE FROM library_tracks WHERE id = ANY(:ids)"),
            {"ids": [track["track_id"] for track in tracks]},
        )
    monkeypatch.setattr(service, "build_music_path_plan", _forbid_planning)
    monkeypatch.setattr(service, "history_for_candidates", _forbid_planning)

    saved = get_music_path(row["id"], 1)
    assert _report(saved) == _metadata(2, requested=requested)
    assert _report(list_music_paths(1)[0]) == _report(saved)
    assert [track["track_id"] for track in saved["tracks"]] == [
        track["track_id"] for track in tracks
    ]
    assert all(track["playable"] is False for track in saved["tracks"])


def test_preview_create_and_regenerate_keep_the_requested_length_and_persist_new_report(
    saved_catalog, monkeypatch
):
    short_tracks = [saved_catalog[0], saved_catalog[-1]]
    plan = {
        "origin_label": "Start",
        "dest_label": "Finish",
        "resolved_waypoints": [],
        "tracks": short_tracks,
        **_metadata(2, requested=8),
    }
    calls = []

    def build(*args, **kwargs):
        calls.append(deepcopy(kwargs))
        return deepcopy(plan)

    monkeypatch.setattr(service, "build_music_path_plan", build)
    preview = service.preview_music_path(
        "track",
        str(short_tracks[0]["track_id"]),
        "track",
        str(short_tracks[-1]["track_id"]),
        step_count=8,
        user_id=1,
    )
    assert _report(preview) == _metadata(2, requested=8)
    assert list_music_paths(1) == []
    created = service.create_music_path(
        1,
        "Short path",
        "track",
        str(short_tracks[0]["track_id"]),
        "track",
        str(short_tracks[-1]["track_id"]),
        step_count=8,
    )
    assert created["step_count"] == 8
    assert _report(created) == _metadata(2, requested=8)
    assert _report(get_music_path(created["id"], 1)) == _report(created)

    plan.update(tracks=saved_catalog, **_metadata(8))
    regenerated = service.regenerate_music_path(created["id"], 1)
    assert regenerated["step_count"] == 8
    assert _report(regenerated) == _metadata(8)
    assert [track["track_id"] for track in calls[-1]["previous_tracks"]] == [
        track["track_id"] for track in short_tracks
    ]
    assert _report(get_music_path(created["id"], 1)) == _metadata(8)
    assert _report(list_music_paths(1)[0]) == _metadata(8)
    count = len(calls)
    assert service.regenerate_music_path(created["id"], 2) is None
    assert len(calls) == count
    assert [
        track["track_id"] for track in get_music_path(created["id"], 1)["tracks"]
    ] == [track["track_id"] for track in saved_catalog]


def test_generation_metadata_migration_is_idempotent_and_restores_legacy_default(
    saved_catalog, monkeypatch
):
    from crate.db.engine import get_engine

    migration = import_module(
        "crate.db.migrations.versions.140_music_path_generation_metadata"
    )
    assert migration.revision == "140"
    assert migration.down_revision == "139"
    metadata = _metadata(8)
    row = _record(saved_catalog, metadata=metadata)
    with get_engine().connect() as connection:
        assert (
            connection.execute(text("SELECT current_database()"))
            .scalar_one()
            .startswith("crate_test_case_")
        )
        connection.rollback()
        context = MigrationContext.configure(connection)
        monkeypatch.setattr(migration, "op", Operations(context))
        with context.begin_transaction():
            migration.upgrade()
            migration.upgrade()
        assert (
            connection.execute(
                text("SELECT generation_metadata FROM music_paths WHERE id=:id"),
                {"id": row["id"]},
            ).scalar_one()
            == metadata
        )
        connection.rollback()
        with context.begin_transaction():
            migration.downgrade()
            migration.downgrade()
            migration.upgrade()
            migration.upgrade()
        restored = (
            connection.execute(
                text(
                    "SELECT generation_metadata, tracks, step_count FROM music_paths WHERE id=:id"
                ),
                {"id": row["id"]},
            )
            .mappings()
            .one()
        )
        assert restored["generation_metadata"] == {}
        assert restored["tracks"] == saved_catalog
        assert restored["step_count"] == 8
        definition = (
            connection.execute(
                text(
                    "SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='music_paths' AND column_name='generation_metadata'"
                )
            )
            .mappings()
            .one()
        )
        assert definition["data_type"] == "jsonb"
        assert definition["is_nullable"] == "NO"
        assert "'{}'::jsonb" in definition["column_default"]


def test_metadata_reads_and_writes_compose_without_committing_the_callers_session(
    saved_catalog,
):
    from sqlalchemy.orm import Session

    from crate.db.engine import get_engine
    from crate.db.queries.paths_store_queries import get_music_path_row

    with Session(get_engine()) as session:
        transaction = session.begin()
        recorded = MagicMock(wraps=session)
        created = _record(saved_catalog, metadata=_metadata(8), session=recorded)
        shortened = [saved_catalog[0], saved_catalog[-1]]
        metadata = _metadata(2, requested=8)
        assert update_music_path_tracks(
            created["id"], 1, shortened, generation_metadata=metadata, session=recorded
        )
        visible = get_music_path_row(created["id"], 1, session=recorded)
        assert visible["generation_metadata"] == metadata
        assert [track["track_id"] for track in visible["tracks"]] == [
            track["track_id"] for track in shortened
        ]
        recorded.commit.assert_not_called()
        recorded.rollback.assert_not_called()
        assert transaction.is_active
        transaction.rollback()
    assert get_music_path(created["id"], 1) is None


@pytest.mark.parametrize(
    "cooled_by", ["recent_family", "previous_family", "previous_id"]
)
def test_cached_refinement_revalidates_current_rotation_policy_without_another_model_call(
    monkeypatch, cooled_by
):
    from crate import music_paths_refinement as refinement
    from crate.db.paths_llm_refinement import (
        MusicPathLlmRefinementResponse,
        MusicPathReplacement,
    )

    def track(track_id, *, bpm=100.0, artist=None):
        return {
            "id": track_id,
            "title": f"Song {track_id}",
            "artist": artist or f"Artist {track_id}",
            "genre_slug": "punk",
            "bpm": bpm,
            "duration": 180,
            "membership_score": 0.9,
            "track_popularity_score": 0.7,
            "artist_popularity_score": 0.7,
        }

    tracks = [track(1), track(2, bpm=102.0), track(3)]
    candidate = track(4, artist="Current Performer")
    before = deepcopy(tracks), deepcopy(candidate)
    response = MusicPathLlmRefinementResponse(
        replacements=[
            MusicPathReplacement(
                target_track_id=2, replacement_track_id=4, confidence=0.99
            )
        ]
    )
    cache, model_calls = {}, []
    monkeypatch.setattr(
        refinement,
        "resolve_call",
        lambda *a, **k: {
            "context": {
                "mode": "profile",
                "provider": "test",
                "model_id": "test/model",
                "config_fingerprint": "fixed",
            }
        },
    )
    monkeypatch.setattr(refinement, "revalidate_call", lambda call: None)
    monkeypatch.setattr(refinement, "get_cache", lambda key, **kwargs: cache.get(key))
    monkeypatch.setattr(
        refinement,
        "set_cache",
        lambda key, value, **kwargs: cache.setdefault(key, value),
    )

    def generate(*args, **kwargs):
        model_calls.append(1)
        return response

    monkeypatch.setattr(refinement, "execute_structured", generate)
    inputs = {
        "origin_label": "Start",
        "dest_label": "Finish",
        "origin_type": "artist",
        "dest_type": "artist",
        "tracks": tracks,
        "candidates_by_genre": {"punk": [candidate]},
    }
    warm = refinement.refine_music_path_with_llm(**inputs, actor_id=1)
    assert [row["id"] for row in warm] == [1, 4, 3]
    policy = {}
    if cooled_by == "recent_family":
        policy["recent_song_keys"] = {track_song_identity(candidate)}
    elif cooled_by == "previous_family":
        policy["previous_song_keys"] = {track_song_identity(candidate)}
    else:
        policy["previous_track_ids"] = {candidate["id"]}
        policy["previous_song_keys"] = {
            track_song_identity({**candidate, "artist": "Old Album Owner"})
        }
    cooled = refinement.refine_music_path_with_llm(**inputs, actor_id=2, **policy)
    assert cooled == tracks
    assert len(cache) == 1
    assert model_calls == [1]
    assert before == (tracks, candidate)
