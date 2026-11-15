"""analyze_playlist_stems: the server separates the tracks of Smart Mix playlists.

One task at a time claims one track's ``track_stem_jobs`` row, separates it, stores its
``stem-analysis/1`` and stem file, and comes back for the next. A fake graph stands in
for ``htdemucs-onnx-1`` (``test_smart_mix_separation_onnx`` runs the real one).
"""

from __future__ import annotations

import functools
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from sqlalchemy import text

from crate.db.repositories.playlists_tracks import add_playlist_tracks
from crate.db.repositories.smart_mix_playlists import set_smart_mix_playlist
from crate.db.repositories.smart_mix_stems import get_stem_analyses
from crate.db.tx import read_scope, transaction_scope
from crate.smart_mix import separation
from crate.smart_mix.source import smart_mix_source_revision
from crate.smart_mix.stems import STEM_TASK_TYPE
from crate.task_dedup_keys import SMART_MIX_STEMS_DEDUP_KEY
from crate.worker_handlers import RUN_AGAIN_AFTER_KEY
from crate.worker_handlers import smart_mix_stems as handler
from tests.test_smart_mix_backfill import _handler_harness, _running_campaign
from tests.test_smart_mix_playlists_repository import (
    _playlist,
    _profiled,
    _tracks,
    _user,
)

RATE = separation.SAMPLE_RATE


def _gain_graph(mix: np.ndarray, spec: np.ndarray):
    gains = np.array([1.0, 0.5, 0.25, 0.125], np.float32)
    wave = (mix[:, None] * gains[None, :, None, None]).astype(np.float32)
    spec_out = np.zeros(
        (1, 4, 4, separation.BINS, separation.SEGMENT_FRAMES), np.float32
    )
    return spec_out, wave


@pytest.fixture
def stems_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict:
    library = tmp_path / "music"
    root = tmp_path / "smart-mix-stems"
    library.mkdir()
    root.mkdir()
    monkeypatch.setenv("CRATE_STEMS_DIR", str(root))
    monkeypatch.setattr(separation, "separation_unavailable_reason", lambda: None)
    monkeypatch.setattr(
        separation,
        "separate",
        functools.partial(separation.separate, graph=_gain_graph),
    )
    monkeypatch.setattr("crate.smart_mix.beat_model.load_beat_model", lambda: None)
    from crate.resource_governor import ResourceDecision

    monkeypatch.setattr(
        "crate.resource_governor.should_defer_task",
        lambda task_type, params=None: ResourceDecision(allowed=True),
    )
    events: list[dict] = []
    monkeypatch.setattr(
        handler, "emit_task_event", lambda *_args, **kwargs: events.append(kwargs)
    )
    return {"library": library, "root": root, "config": {"library_path": str(library)}}


def _audio(library: Path, name: str, seconds: float = 3.0) -> Path:
    t = np.arange(int(seconds * RATE)) / RATE
    tone = 0.3 * np.sin(2 * np.pi * 220 * t)
    path = library / f"{name}.wav"
    sf.write(str(path), np.stack([tone, tone]).T, RATE, subtype="FLOAT")
    return path


def _at(track_id: int, path: Path, *, seconds: float = 3.0) -> None:
    """Point a track at a real file and give it a profile of that file."""
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET path = :path, duration = :seconds "
                "WHERE id = :id"
            ),
            {"path": str(path), "seconds": seconds, "id": track_id},
        )
    _profiled(track_id, smart_mix_source_revision(path))


def _jobs() -> dict[int, dict]:
    with read_scope() as session:
        return {
            row["track_id"]: dict(row)
            for row in session.execute(
                text(
                    "SELECT track_id, state, attempts, last_error, started_at, "
                    "finished_at FROM track_stem_jobs"
                )
            ).mappings()
        }


def _files() -> dict[int, dict]:
    with read_scope() as session:
        return {
            row["track_id"]: dict(row)
            for row in session.execute(
                text(
                    "SELECT track_id, path, bytes, separator_version, source_revision "
                    "FROM track_stem_files"
                )
            ).mappings()
        }


def _run(env: dict) -> dict:
    return handler._handle_analyze_playlist_stems("task-stems", {}, env["config"])


def _age_jobs(seconds: int, column: str = "finished_at") -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                f"UPDATE track_stem_jobs SET {column} = NOW() - "
                "make_interval(secs => :seconds)"
            ),
            {"seconds": seconds},
        )


def test_claims_pending_jobs_and_marks_them_ready_or_failed_with_attempts(
    pg_db, stems_env
) -> None:
    del pg_db
    library = stems_env["library"]
    good, broken = _tracks("stems-task", 2)
    _at(good, _audio(library, "good"))
    junk = library / "broken.flac"
    junk.write_bytes(b"not audio")
    _at(broken, junk)
    owner = _user("stems-task-owner")
    set_smart_mix_playlist(
        _playlist(owner, [good, broken]), user_id=owner, enabled=True
    )

    first = _run(stems_env)
    # One track per run; the next one is waiting.
    assert first[RUN_AGAIN_AFTER_KEY] == pytest.approx(1)
    jobs = _jobs()
    assert jobs[good]["state"] == "ready" and jobs[good]["finished_at"] is not None
    assert jobs[broken]["state"] == "pending"
    (analysis,) = get_stem_analyses([good])[good]
    assert analysis.producer == separation.SERVER_PRODUCER
    assert analysis.source_revision == smart_mix_source_revision(library / "good.wav")
    stored = _files()[good]
    assert stored["separator_version"] == "htdemucs-onnx-1"
    assert (stems_env["root"] / stored["path"]).stat().st_size == stored["bytes"] > 0

    second = _run(stems_env)
    assert second["state"] == "failed"
    jobs = _jobs()
    assert jobs[broken]["state"] == "failed"
    assert jobs[broken]["attempts"] == 1
    assert "decode" in jobs[broken]["last_error"]
    assert broken not in _files()
    # Nothing is left in the scratch directory either way.
    assert list((stems_env["root"] / ".scratch").iterdir()) == []

    # A failed track waits before its next attempt, and gets three in all.
    assert _run(stems_env) == {"status": "idle"}
    for attempts in (2, 3):
        _age_jobs(3 * 3600)
        assert _run(stems_env)["state"] == "failed"
        assert _jobs()[broken]["attempts"] == attempts
    _age_jobs(24 * 3600)
    assert _run(stems_env) == {"status": "idle"}
    assert _jobs()[good]["state"] == "ready"


def test_tracks_of_playlists_turned_off_are_not_claimed(pg_db, stems_env) -> None:
    del pg_db
    (track,) = _tracks("stems-off", 1)
    _at(track, _audio(stems_env["library"], "off"))
    owner = _user("stems-off-owner")
    playlist_id = _playlist(owner, [track])
    set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True)
    set_smart_mix_playlist(playlist_id, user_id=owner, enabled=False)

    assert _run(stems_env) == {"status": "idle"}
    assert _jobs()[track]["state"] == "pending"


def test_a_track_without_a_profile_gets_one_first(
    pg_db, stems_env, monkeypatch
) -> None:
    del pg_db
    (track,) = _tracks("stems-no-profile", 1)
    owner = _user("stems-no-profile-owner")
    set_smart_mix_playlist(_playlist(owner, [track]), user_id=owner, enabled=True)
    queued: list[tuple[str, dict, str]] = []
    monkeypatch.setattr(
        "crate.db.repositories.tasks.create_task_dedup",
        lambda task_type, params, *, dedup_key: (
            queued.append((task_type, params, dedup_key)) or "task-profile"
        ),
    )

    result = _run(stems_env)

    assert queued == [
        (
            "compute_smart_mix_profile",
            {"track_id": track},
            f"smart-mix-profile:{track}",
        )
    ]
    assert result[RUN_AGAIN_AFTER_KEY] == handler.PROFILE_WAIT_SECONDS
    assert "profile" in result["progress"]
    assert _jobs()[track]["state"] == "pending"


def test_an_interrupted_separation_counts_as_an_attempt(pg_db, stems_env) -> None:
    del pg_db
    (track,) = _tracks("stems-interrupted", 1)
    _at(track, _audio(stems_env["library"], "interrupted"))
    owner = _user("stems-interrupted-owner")
    set_smart_mix_playlist(_playlist(owner, [track]), user_id=owner, enabled=True)
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE track_stem_jobs SET state = 'analyzing', "
                "started_at = NOW() - INTERVAL '3 hours'"
            )
        )

    result = _run(stems_env)

    job = _jobs()[track]
    assert job["attempts"] == 1
    assert job["state"] == "failed"
    assert "stopped" in job["last_error"]
    assert result == {"status": "idle"}


def test_a_track_over_the_length_limit_fails_for_good(pg_db, stems_env) -> None:
    del pg_db
    (track,) = _tracks("stems-long", 1)
    _at(track, _audio(stems_env["library"], "long"), seconds=3600.0)
    owner = _user("stems-long-owner")
    set_smart_mix_playlist(_playlist(owner, [track]), user_id=owner, enabled=True)

    assert _run(stems_env)["state"] == "failed"

    job = _jobs()[track]
    assert job["attempts"] == handler.MAX_ATTEMPTS
    assert "20 minutes" in job["last_error"]
    _age_jobs(24 * 3600)
    assert _run(stems_env) == {"status": "idle"}


def test_a_file_that_changes_during_separation_stores_nothing(
    pg_db, stems_env, monkeypatch
) -> None:
    del pg_db
    (track,) = _tracks("stems-changed", 1)
    path = _audio(stems_env["library"], "changed")
    _at(track, path)
    owner = _user("stems-changed-owner")
    set_smart_mix_playlist(_playlist(owner, [track]), user_id=owner, enabled=True)
    real = separation.analyze_stems

    def analyse_then_replace(stems, **kwargs):
        analysis = real(stems, **kwargs)
        _audio(stems_env["library"], "changed", seconds=4.0)
        return analysis

    monkeypatch.setattr(separation, "analyze_stems", analyse_then_replace)

    assert _run(stems_env)["state"] == "failed"
    assert not get_stem_analyses([track]).get(track)
    assert _files() == {}
    assert "changed" in _jobs()[track]["last_error"]


def test_without_a_stems_directory_jobs_wait(pg_db, stems_env, monkeypatch) -> None:
    del pg_db
    (track,) = _tracks("stems-unavailable", 1)
    _at(track, _audio(stems_env["library"], "unavailable"))
    owner = _user("stems-unavailable-owner")
    set_smart_mix_playlist(_playlist(owner, [track]), user_id=owner, enabled=True)
    monkeypatch.delenv("CRATE_STEMS_DIR")

    result = _run(stems_env)

    assert result["status"] == "skipped"
    assert "CRATE_STEMS_DIR" in result["reason"]
    assert _jobs()[track]["state"] == "pending"
    assert handler.playlist_stem_work_pending(str(stems_env["library"])) is False


def _stem_tasks() -> list[dict]:
    with read_scope() as session:
        return [
            dict(row)
            for row in session.execute(
                text("SELECT type, status, dedup_key FROM tasks WHERE type = :type"),
                {"type": STEM_TASK_TYPE},
            ).mappings()
        ]


def test_turning_a_playlist_on_or_adding_tracks_wakes_one_task(pg_db) -> None:
    del pg_db
    first, second = _tracks("stems-wake", 2)
    owner = _user("stems-wake-owner")
    playlist_id = _playlist(owner, [first])

    set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True)
    set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True)
    add_playlist_tracks(playlist_id, [{"track_id": second}])

    assert _stem_tasks() == [
        {
            "type": STEM_TASK_TYPE,
            "status": "pending",
            "dedup_key": SMART_MIX_STEMS_DEDUP_KEY,
        }
    ]


def test_playlist_work_is_pending_only_while_a_job_can_be_claimed(
    pg_db, stems_env
) -> None:
    del pg_db
    library = str(stems_env["library"])
    (track,) = _tracks("stems-pending", 1)
    owner = _user("stems-pending-owner")
    playlist_id = _playlist(owner, [track])
    set_smart_mix_playlist(playlist_id, user_id=owner, enabled=True)
    # Waiting for a profile is not work the separation can take yet.
    assert handler.playlist_stem_work_pending(library) is False

    _at(track, _audio(stems_env["library"], "pending"))
    stem_jobs_queued = handler.queue_smart_mix_stem_jobs()
    assert stem_jobs_queued == 1
    assert handler.playlist_stem_work_pending(library) is True

    set_smart_mix_playlist(playlist_id, user_id=owner, enabled=False)
    assert handler.playlist_stem_work_pending(library) is False
    assert handler.playlist_stem_work_pending(None) is False


def test_playlist_work_runs_before_the_backfill_coordinator(monkeypatch) -> None:
    analysis, calls = _handler_harness(
        monkeypatch,
        campaigns=[_running_campaign()],
        in_flight=[0],
        claimed=[{"id": 5, "entity_uid": "uid-5", "claim_token": "token-5"}],
    )
    monkeypatch.setattr(handler, "playlist_stem_work_pending", lambda library: True)

    result = analysis._handle_backfill_smart_mix_profiles(
        "task-1", {}, {"library_path": "/music"}
    )

    assert result[RUN_AGAIN_AFTER_KEY] == handler.BACKFILL_WAIT_SECONDS
    assert result["progress"] == "Waiting for the stems of Smart Mix playlists"
    assert calls["claims"] == []
    # It makes sure the separation runs.
    assert calls["children"] == [(STEM_TASK_TYPE, {}, SMART_MIX_STEMS_DEDUP_KEY)]


def test_the_backfill_resumes_when_no_playlist_work_is_pending(monkeypatch) -> None:
    analysis, calls = _handler_harness(
        monkeypatch,
        campaigns=[_running_campaign()],
        in_flight=[0],
        claimed=[{"id": 5, "entity_uid": "uid-5", "claim_token": "token-5"}],
    )
    monkeypatch.setattr(handler, "playlist_stem_work_pending", lambda library: False)

    result = analysis._handle_backfill_smart_mix_profiles(
        "task-1", {}, {"library_path": "/music"}
    )

    assert result["claimed"] == 1
    assert len(calls["claims"]) == 1
    assert [child[0] for child in calls["children"]] == ["compute_smart_mix_profile"]
