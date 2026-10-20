"""Real PostgreSQL snapshot publication and worker-only quality scans."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import Mock

import pytest
from crate.db import analytics_quality_surface as surface
from crate.worker_handlers import quality as worker


def _payload(label="one", total=3):
    return {
        **surface.empty_quality_report(),
        "ready": True,
        "method": "metadata_heuristics_v1",
        "scanned_tracks": total,
        "audio_decode_verified": False,
        "low_bitrate_count": total,
        "low_bitrate": [{"file": f"{label}-{n}.mp3"} for n in range(total)],
    }


@pytest.fixture
def snapshot_events(monkeypatch):
    events = []
    monkeypatch.setattr(
        surface, "publish_snapshot_update", lambda *args: events.append(args)
    )
    monkeypatch.setattr(
        "crate.db.ui_snapshot_store.publish_snapshot_update",
        lambda *args: events.append(args),
    )
    return events


def test_empty_quality_report_does_not_claim_a_clean_completed_scan():
    report = surface.empty_quality_report(computing=True, task_id="quality-task")
    assert report["ready"] is False
    assert report["computing"] is True
    assert report["task_id"] == "quality-task"
    assert all(report[category] == [] for category in surface.QUALITY_CATEGORIES)


def test_first_scan_has_an_invalidatable_placeholder_and_publishes_after_commit(
    pg_db, snapshot_events
):
    del pg_db
    assert surface.read_quality_report_snapshot() is None
    observation = surface.begin_quality_report_scan()
    placeholder = surface.read_quality_report_snapshot()
    assert placeholder["invalidated_at"] is not None
    assert placeholder["summary"]["ready"] is False
    assert snapshot_events == []
    assert surface.complete_quality_report_scan(
        _payload(), observation=observation, generation_ms=19
    )
    record = surface.read_quality_report_snapshot(
        category="low_bitrate", offset=1, limit=1
    )
    assert record["version"] == observation["version"] + 1
    assert record["invalidated_at"] is None
    assert record["items"] == [{"file": "one-1.mp3"}]
    assert record["total"] == 3
    assert record["generation_ms"] == 19
    assert record["stale_after"] > record["built_at"]
    assert snapshot_events == [("analytics:quality", "global", record["version"])]


def test_snapshot_category_pages_do_not_load_or_return_other_category_arrays(
    pg_db, snapshot_events
):
    del pg_db
    payload = _payload(total=125)
    payload["corrupt"] = [{"file": "broken.flac", "confirmed_corruption": False}]
    saved = surface.save_quality_report_snapshot(payload, generation_ms=42)
    assert saved["ready"] is True
    assert saved["snapshot"]["generation_ms"] == 42
    assert (
        surface.get_cached_quality_report()["snapshot"]["version"]
        == saved["snapshot"]["version"]
    )
    summary = surface.read_quality_report_snapshot()
    assert summary["items"] == []
    assert summary["total"] == 0
    assert not any(
        category in summary["summary"] for category in surface.QUALITY_CATEGORIES
    )
    first = surface.read_quality_report_snapshot(category="low_bitrate", limit=100)
    last = surface.read_quality_report_snapshot(
        category="low_bitrate", offset=100, limit=100
    )
    assert len(first["items"]) == 100
    assert len(last["items"]) == 25
    assert first["total"] == last["total"] == 125
    assert first["summary"]["low_bitrate_count"] == 125
    assert snapshot_events


@pytest.mark.parametrize("existing_snapshot", [False, True])
def test_library_invalidation_during_scan_prevents_publication_including_first_build(
    pg_db, snapshot_events, existing_snapshot
):
    del pg_db
    if existing_snapshot:
        surface.save_quality_report_snapshot(_payload("original"))
    observation = surface.begin_quality_report_scan()
    assert surface.mark_quality_report_stale() == 1
    snapshot_events.clear()
    assert (
        surface.complete_quality_report_scan(
            _payload("stale-result"), observation=observation
        )
        is False
    )
    record = surface.read_quality_report_snapshot(category="low_bitrate")
    assert record["invalidated_at"] is not None
    assert record["version"] == observation["version"] + 1
    assert not any(item["file"].startswith("stale-result") for item in record["items"])
    assert surface.get_cached_quality_report() is None
    assert snapshot_events == []


def test_only_one_of_two_concurrent_refreshes_can_publish_the_same_observation(
    pg_db, snapshot_events
):
    del pg_db
    observation = surface.begin_quality_report_scan()
    barrier = Barrier(2)

    def publish(label):
        barrier.wait(timeout=10)
        return surface.complete_quality_report_scan(
            _payload(label), observation=observation
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(publish, ["first", "second"]))
    assert sorted(results) == [False, True]
    record = surface.read_quality_report_snapshot(category="low_bitrate")
    assert record["version"] == observation["version"] + 1
    assert len(snapshot_events) == 1
    assert {item["file"].split("-")[0] for item in record["items"]} in [
        {"first"},
        {"second"},
    ]


def test_newer_completed_refresh_cannot_be_overwritten_by_an_old_scan(
    pg_db, snapshot_events
):
    del pg_db
    old = surface.begin_quality_report_scan()
    assert surface.complete_quality_report_scan(_payload("new"), observation=old)
    assert (
        surface.complete_quality_report_scan(_payload("old"), observation=old) is False
    )
    record = surface.read_quality_report_snapshot(category="low_bitrate")
    assert all(item["file"].startswith("new-") for item in record["items"])
    assert len(snapshot_events) == 1


def test_invalidated_evidence_remains_readable_as_metadata_for_diagnostics(
    pg_db, snapshot_events
):
    del pg_db, snapshot_events
    surface.save_quality_report_snapshot(_payload())
    before = surface.read_quality_report_snapshot(category="low_bitrate", limit=1)
    surface.mark_quality_report_stale()
    invalidated = surface.read_quality_report_snapshot(category="low_bitrate", limit=1)
    assert invalidated["version"] == before["version"] + 1
    assert invalidated["built_at"] == before["built_at"]
    assert invalidated["invalidated_at"] is not None
    assert invalidated["items"] == before["items"]


@pytest.mark.parametrize(
    "arguments",
    [
        {"category": "arbitrary-jsonpath"},
        {"category": []},
        {"offset": True},
        {"offset": False},
        {"limit": True},
        {"limit": False},
        {"offset": -1},
        {"offset": 100001},
        {"limit": 0},
        {"limit": 101},
    ],
)
def test_invalid_snapshot_pagination_is_rejected_before_opening_a_session(
    monkeypatch, arguments
):
    session = Mock(side_effect=AssertionError("Invalid page reached database"))
    monkeypatch.setattr(surface, "read_scope", session)
    with pytest.raises(ValueError):
        surface.read_quality_report_snapshot(**arguments)
    session.assert_not_called()


@pytest.fixture
def quality_worker(monkeypatch):
    begin = Mock(return_value={"version": 2, "invalidated_at": None})
    complete = Mock(return_value=True)
    scanner = Mock(return_value=_payload())
    monkeypatch.setattr(worker, "begin_quality_report_scan", begin)
    monkeypatch.setattr(worker, "complete_quality_report_scan", complete)
    monkeypatch.setattr(worker, "quality_report", scanner)
    monkeypatch.setattr(worker, "audio_extensions", lambda: {".flac", ".mp3"})
    monkeypatch.setattr(worker, "is_cancelled", lambda task_id: False)
    return begin, complete, scanner


@pytest.mark.parametrize(
    "params", [{}, {"scope": ""}, {"scope": "artist"}, {"scope": None}]
)
def test_quality_worker_requires_explicit_global_scope_before_scan(
    quality_worker, params
):
    begin, complete, scanner = quality_worker
    result = worker._handle_quality_check("task", params, {"library_path": "/music"})
    assert "error" in result
    begin.assert_not_called()
    complete.assert_not_called()
    scanner.assert_not_called()


def test_quality_worker_requires_a_configured_library(quality_worker):
    begin, complete, scanner = quality_worker
    assert "error" in worker._handle_quality_check("task", {"scope": "global"}, {})
    begin.assert_not_called()
    scanner.assert_not_called()
    complete.assert_not_called()


@pytest.mark.parametrize("published", [True, False])
def test_quality_worker_reports_confirmed_snapshot_publication_or_conflict(
    quality_worker, published
):
    begin, complete, scanner = quality_worker
    complete.return_value = published
    result = worker._handle_quality_check(
        "task", {"scope": "global"}, {"library_path": "/music"}
    )
    assert result["published"] is published
    assert result["status"] == ("completed" if published else "conflict")
    assert result["verification"] == (
        "snapshot_persisted" if published else "library_changed_during_scan"
    )
    assert result["scanned_tracks"] == 3
    assert scanner.call_args.args[0].as_posix() == "/music"
    assert scanner.call_args.args[1] == {".flac", ".mp3"}
    assert callable(scanner.call_args.kwargs["cancelled"])
    complete.assert_called_once()
    assert complete.call_args.kwargs["observation"] == begin.return_value


def test_cancelled_quality_scan_never_publishes_a_partial_report(quality_worker):
    _, complete, scanner = quality_worker
    scanner.side_effect = worker.QualityScanCancelled()
    result = worker._handle_quality_check(
        "task", {"scope": "global"}, {"library_path": "/music"}
    )
    assert result == {"status": "cancelled", "published": False}
    complete.assert_not_called()


def test_cancellation_after_scan_before_publication_preserves_previous_snapshot(
    quality_worker, monkeypatch
):
    _, complete, _ = quality_worker
    monkeypatch.setattr(worker, "is_cancelled", lambda task_id: True)
    result = worker._handle_quality_check(
        "task", {"scope": "global"}, {"library_path": "/music"}
    )
    assert result == {"status": "cancelled", "published": False}
    complete.assert_not_called()


def test_unexpected_scan_failure_does_not_publish_or_claim_success(quality_worker):
    _, complete, scanner = quality_worker
    scanner.side_effect = OSError("library unavailable")
    with pytest.raises(OSError):
        worker._handle_quality_check(
            "task", {"scope": "global"}, {"library_path": "/music"}
        )
    complete.assert_not_called()


@pytest.mark.parametrize("cancel_at_end", [False, True])
def test_worker_throttles_per_track_cancellation_reads_and_rechecks_before_publish(
    quality_worker, monkeypatch, cancel_at_end
):
    _, complete, scanner = quality_worker
    clock = [100.0]
    checker = Mock(side_effect=[False, False, cancel_at_end])
    monkeypatch.setattr(worker.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(worker, "is_cancelled", checker)

    def scan(path, extensions, *, cancelled):
        for _ in range(100):
            assert cancelled() is False
        assert checker.call_count == 1
        clock[0] = 100.99
        for _ in range(100):
            assert cancelled() is False
        assert checker.call_count == 1
        clock[0] = 101.0
        for _ in range(100):
            assert cancelled() is False
        assert checker.call_count == 2
        return _payload()

    scanner.side_effect = scan
    result = worker._handle_quality_check(
        "task", {"scope": "global"}, {"library_path": "/music"}
    )
    assert checker.call_count == 3
    if cancel_at_end:
        assert result == {"status": "cancelled", "published": False}
        complete.assert_not_called()
    else:
        assert result["status"] == "completed"
        complete.assert_called_once()


def test_starting_real_library_task_invalidates_quality_in_the_same_transaction(
    pg_db, snapshot_events
):
    from crate.agent_quality import get_library_quality
    from crate.db.repositories import tasks
    from crate.db.tx import transaction_scope

    del snapshot_events
    surface.save_quality_report_snapshot(_payload())
    observation = surface.begin_quality_report_scan()
    task_id = tasks.create_task("update_track_tags", {}, dispatch=False)
    assert pg_db.get_task(task_id)["status"] == "pending"
    assert surface.read_quality_report_snapshot()["invalidated_at"] is None
    assert get_library_quality()["availability"] == "ready"
    with transaction_scope() as session:
        assert tasks.start_task(task_id, session=session)["status"] == "running"
        in_transaction = surface.read_quality_report_snapshot(session=session)
        assert in_transaction["invalidated_at"] is not None
        assert in_transaction["active_mutation"] is True
        assert surface.read_quality_report_snapshot()["invalidated_at"] is None
        assert pg_db.get_task(task_id)["status"] == "pending"
        assert (
            surface.complete_quality_report_scan(
                _payload("outdated"), observation=observation, session=session
            )
            is False
        )
    assert pg_db.get_task(task_id)["status"] == "running"
    assert (
        surface.complete_quality_report_scan(
            _payload("outdated"), observation=observation
        )
        is False
    )
    assert get_library_quality()["availability"] == "unavailable"


@pytest.mark.parametrize("existing_snapshot", [False, True])
def test_quality_begin_rejects_an_active_library_mutation_including_first_build(
    pg_db, snapshot_events, existing_snapshot
):
    from crate.db.repositories import tasks

    del pg_db, snapshot_events
    task_id = tasks.create_task("update_track_tags", {}, dispatch=False)
    assert tasks.start_task(task_id) is not None
    if existing_snapshot:
        surface.save_quality_report_snapshot(_payload())
    with pytest.raises(surface.QualityMutationInProgress):
        surface.begin_quality_report_scan()
    record = surface.read_quality_report_snapshot()
    if existing_snapshot:
        assert record["active_mutation"] is True
    else:
        assert record is None


@pytest.mark.parametrize("active_status", ["running", "delegated", "completing"])
def test_read_and_complete_guard_against_preexisting_active_mutation(
    pg_db, snapshot_events, active_status
):
    from crate.agent_quality import get_library_quality
    from crate.db.repositories import tasks

    del pg_db, snapshot_events
    task_id = tasks.create_task("update_track_tags", {}, dispatch=False)
    tasks.update_task(task_id, status=active_status)
    surface.save_quality_report_snapshot(_payload())
    record = surface.read_quality_report_snapshot()
    assert record["invalidated_at"] is None
    assert record["active_mutation"] is True
    assert (
        surface.complete_quality_report_scan(_payload("stale"), observation=record)
        is False
    )
    result = get_library_quality()
    assert result["availability"] == "unavailable"
    assert result["ready"] is False
    assert "mutation" in result["reason"]


@pytest.mark.parametrize(
    "task_type", ["health_check", "quality_check", "export_rich_metadata"]
)
def test_readonly_active_tasks_do_not_invalidate_or_block_quality(
    pg_db, snapshot_events, task_type
):
    from crate.agent_quality import get_library_quality
    from crate.db.repositories import tasks

    del pg_db, snapshot_events
    surface.save_quality_report_snapshot(_payload())
    task_id = tasks.create_task(task_type, {}, dispatch=False)
    assert tasks.start_task(task_id) is not None
    record = surface.read_quality_report_snapshot()
    assert record["invalidated_at"] is None
    assert record["active_mutation"] is False
    observation = surface.begin_quality_report_scan()
    assert surface.complete_quality_report_scan(
        _payload("new"), observation=observation
    )
    assert get_library_quality()["availability"] == "ready"


@pytest.mark.parametrize(
    "transition", ["completed", "failed", "cancelled", "worker_failure", "retry"]
)
def test_task_terminal_or_retry_transition_invalidates_quality_atomically(
    pg_db, snapshot_events, transition
):
    from crate.db.repositories import tasks
    from crate.db.tx import transaction_scope

    del snapshot_events
    task_type = "library_upload" if transition == "retry" else "update_track_tags"
    task_id = tasks.create_task(task_type, {}, dispatch=False)
    assert tasks.start_task(task_id) is not None
    surface.save_quality_report_snapshot(_payload())
    with transaction_scope() as session:
        if transition in {"retry", "worker_failure"}:
            result = tasks.fail_or_retry_task(task_id, "write failed", session=session)
            assert result == ("retrying" if transition == "retry" else "failed")
        else:
            tasks.update_task(task_id, status=transition, session=session)
        assert (
            surface.read_quality_report_snapshot(session=session)["invalidated_at"]
            is not None
        )
        assert surface.read_quality_report_snapshot()["invalidated_at"] is None
        assert pg_db.get_task(task_id)["status"] == "running"
    assert surface.read_quality_report_snapshot()["invalidated_at"] is not None
    assert pg_db.get_task(task_id)["status"] != "running"


@pytest.mark.parametrize("transition", ["start", "completed", "retry"])
def test_rolled_back_task_transition_preserves_task_and_quality_evidence(
    pg_db, snapshot_events, transition
):
    from crate.db.repositories import tasks
    from crate.db.tx import transaction_scope

    del snapshot_events
    task_type = "library_upload" if transition == "retry" else "update_track_tags"
    task_id = tasks.create_task(task_type, {}, dispatch=False)
    if transition != "start":
        tasks.start_task(task_id)
    original_status = pg_db.get_task(task_id)["status"]
    surface.save_quality_report_snapshot(_payload())
    before = surface.read_quality_report_snapshot()
    with pytest.raises(RuntimeError, match="Abort mutation"):
        with transaction_scope() as session:
            if transition == "start":
                tasks.start_task(task_id, session=session)
            elif transition == "retry":
                tasks.fail_or_retry_task(task_id, "write failed", session=session)
            else:
                tasks.update_task(task_id, status=transition, session=session)
            assert (
                surface.read_quality_report_snapshot(session=session)["invalidated_at"]
                is not None
            )
            raise RuntimeError("Abort mutation")
    after = surface.read_quality_report_snapshot()
    assert pg_db.get_task(task_id)["status"] == original_status
    assert after["invalidated_at"] is None
    assert after["version"] == before["version"]
    assert after["built_at"] == before["built_at"]


@pytest.mark.parametrize(
    "scopes", [("library",), ("artist:artist-uid",), ("album:album-uid",), ("*",)]
)
def test_persisted_library_invalidation_events_also_invalidate_quality(
    pg_db, snapshot_events, scopes
):
    from crate.db.cache_invalidation import persist_invalidation_events

    del pg_db, snapshot_events
    surface.save_quality_report_snapshot(_payload())
    observation = surface.begin_quality_report_scan()
    persist_invalidation_events(scopes)
    assert surface.read_quality_report_snapshot()["invalidated_at"] is not None
    assert (
        surface.complete_quality_report_scan(_payload("old"), observation=observation)
        is False
    )


@pytest.mark.parametrize(
    "scopes", [("home",), ("global_catalog",), ("home", "global_catalog")]
)
def test_unrelated_invalidation_events_leave_quality_evidence_usable(
    pg_db, snapshot_events, scopes
):
    from crate.db.cache_invalidation import persist_invalidation_events

    del pg_db, snapshot_events
    surface.save_quality_report_snapshot(_payload())
    observation = surface.begin_quality_report_scan()
    persist_invalidation_events(scopes)
    assert surface.read_quality_report_snapshot()["invalidated_at"] is None
    assert surface.complete_quality_report_scan(
        _payload("new"), observation=observation
    )


def test_worker_skips_scan_and_reports_conflict_when_a_library_mutation_is_active(
    quality_worker,
):
    begin, complete, scanner = quality_worker
    begin.side_effect = surface.QualityMutationInProgress("Library mutation is active")
    result = worker._handle_quality_check(
        "task", {"scope": "global"}, {"library_path": "/music"}
    )
    assert result["status"] == "conflict"
    assert result["published"] is False
    assert "mutation" in result["reason"]
    scanner.assert_not_called()
    complete.assert_not_called()


def test_repeated_invalidation_advances_cas_version_even_when_timestamps_are_identical(
    pg_db, snapshot_events, monkeypatch
):
    del pg_db, snapshot_events
    real_text = surface.text

    def frozen_clock_sql(statement):
        return real_text(
            statement.replace(
                "clock_timestamp()", "TIMESTAMPTZ '2026-10-16 12:00:00+00'"
            )
        )

    monkeypatch.setattr(surface, "text", frozen_clock_sql)
    surface.begin_quality_report_scan()
    assert surface.mark_quality_report_stale() == 1
    first = surface.begin_quality_report_scan()
    assert surface.mark_quality_report_stale() == 1
    second = surface.read_quality_report_snapshot()
    assert first["invalidated_at"] == second["invalidated_at"]
    assert second["version"] == first["version"] + 1
    assert (
        surface.complete_quality_report_scan(_payload("obsolete"), observation=first)
        is False
    )
