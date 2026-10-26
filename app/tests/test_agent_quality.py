"""Quality reads paginate persisted, explicitly heuristic evidence without scans."""

import base64
import json
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import pytest
from crate import agent_quality
from crate.agent_diagnostics import DiagnosticError


def _record(*, stale=False, invalidated=False, version=3, items=None, total=3):
    now = datetime.now(UTC)
    return {
        "version": version,
        "built_at": now - timedelta(minutes=2),
        "stale_after": now + timedelta(hours=-1 if stale else 1),
        "invalidated_at": now if invalidated else None,
        "source_seq": 42,
        "generation_ms": 18,
        "summary": {
            "ready": True,
            "method": "metadata_heuristics_v1",
            "audio_decode_verified": False,
            "low_bitrate_count": total,
        },
        "items": items if items is not None else [{"file": "one.mp3"}],
        "total": total,
    }


def _cursor(**overrides):
    data = {"category": "low_bitrate", "offset": 1, "version": 3, **overrides}
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")


@pytest.mark.parametrize("stale,availability", [(False, "ready"), (True, "stale")])
def test_snapshot_age_is_explicit_and_does_not_claim_audio_verification(
    monkeypatch, stale, availability
):
    monkeypatch.setattr(
        agent_quality,
        "read_quality_report_snapshot",
        lambda **kwargs: _record(stale=stale),
    )
    result = agent_quality.get_library_quality(category="low_bitrate")
    assert result["availability"] == availability
    assert result["historical"] is stale
    assert result["method"] == "metadata_heuristics_v1"
    assert result["audio_decode_verified"] is False
    assert result["snapshot"]["source_seq"] == 42
    assert isinstance(result["snapshot"]["built_at"], str)


@pytest.mark.parametrize("record", [None, _record(invalidated=True)])
def test_missing_or_invalidated_evidence_is_unavailable_not_an_empty_clean_library(
    monkeypatch, record
):
    reader = Mock(return_value=record)
    monkeypatch.setattr(agent_quality, "read_quality_report_snapshot", reader)
    result = agent_quality.get_library_quality(category="corrupt")
    assert result["availability"] == "unavailable"
    assert result["ready"] is False
    assert result["items"] == []
    assert result["reason"]
    reader.assert_called_once_with(category="corrupt", offset=0, limit=50)


@pytest.mark.parametrize(
    "category", ["low_bitrate", "corrupt", "lossy_with_lossless", "mixed_format_albums"]
)
def test_category_pages_preserve_totals_and_bind_cursor_to_version(
    monkeypatch, category
):
    reader = Mock(
        side_effect=[
            _record(items=[{"file": "one.mp3"}], total=2),
            _record(items=[{"file": "two.mp3"}], total=2),
        ]
    )
    monkeypatch.setattr(agent_quality, "read_quality_report_snapshot", reader)
    first = agent_quality.get_library_quality(category=category, limit=1)
    second = agent_quality.get_library_quality(
        category=category, limit=1, cursor=first["next_cursor"]
    )
    assert first["total"] == second["total"] == 2
    assert first["items"] == first[category] == [{"file": "one.mp3"}]
    assert second["items"] == [{"file": "two.mp3"}]
    assert second["next_cursor"] is None
    assert reader.call_args_list[1].kwargs == {
        "category": category,
        "offset": 1,
        "limit": 1,
    }


def test_summary_does_not_request_any_category_evidence(monkeypatch):
    reader = Mock(return_value=_record(items=[], total=0))
    monkeypatch.setattr(agent_quality, "read_quality_report_snapshot", reader)
    result = agent_quality.get_library_quality()
    reader.assert_called_once_with(category=None, offset=0, limit=50)
    assert result["items"] == []
    assert result["next_cursor"] is None


@pytest.mark.parametrize("record", [None, _record(version=4)])
def test_disappeared_or_replaced_snapshot_invalidates_existing_cursor(
    monkeypatch, record
):
    monkeypatch.setattr(
        agent_quality, "read_quality_report_snapshot", lambda **kw: record
    )
    with pytest.raises(DiagnosticError) as exc:
        agent_quality.get_library_quality(category="low_bitrate", cursor=_cursor())
    assert exc.value.code == "CURSOR_STALE"


@pytest.mark.parametrize(
    "arguments",
    [
        {"category": "unknown"},
        {"category": []},
        {"category": ""},
        {"limit": 0},
        {"limit": 101},
        {"limit": True},
        {"limit": 1.5},
        {"cursor": "not-base64"},
        {"cursor": "W10"},
        {"cursor": "bnVsbA"},
        {"cursor": "e30"},
        {"cursor": "x" * 513},
        {"cursor": _cursor(category="corrupt")},
        {"cursor": _cursor(offset=-1)},
        {"cursor": _cursor(offset=100001)},
        {"cursor": _cursor(offset=True)},
        {"cursor": _cursor(version=0)},
        {"cursor": _cursor(version=True)},
    ],
)
def test_invalid_filters_and_cursors_fail_before_database_reads(monkeypatch, arguments):
    reader = Mock(side_effect=AssertionError("Unexpected database access"))
    monkeypatch.setattr(agent_quality, "read_quality_report_snapshot", reader)
    with pytest.raises(DiagnosticError) as exc:
        agent_quality.get_library_quality(**{"category": "low_bitrate", **arguments})
    assert exc.value.code == "INVALID_ARGUMENT"
    reader.assert_not_called()


@pytest.mark.parametrize("state", ["missing", "invalidated", "stale", "ready"])
def test_quality_http_reads_never_scan_or_enqueue_refresh(test_app, monkeypatch, state):
    from crate import quality
    from crate.db.repositories import tasks

    record = (
        None
        if state == "missing"
        else _record(
            invalidated=state == "invalidated",
            stale=state == "stale",
            items=[],
            total=0,
        )
    )
    monkeypatch.setattr(
        agent_quality, "read_quality_report_snapshot", lambda **kw: record
    )
    scanner = Mock(side_effect=AssertionError("HTTP must not scan audio"))
    enqueue = Mock(side_effect=AssertionError("Read must not schedule a global scan"))
    monkeypatch.setattr(quality, "quality_report", scanner)
    monkeypatch.setattr(tasks, "create_task", enqueue)
    monkeypatch.setattr(tasks, "create_task_dedup", enqueue)
    response = test_app.get("/api/quality")
    assert response.status_code == 200
    expected = "unavailable" if state in {"missing", "invalidated"} else state
    assert response.json()["availability"] == expected
    scanner.assert_not_called()
    enqueue.assert_not_called()


@pytest.mark.parametrize(
    "query", ["category=bad", "limit=0", "limit=101", "cursor=bad"]
)
def test_quality_http_rejects_invalid_pages(test_app, monkeypatch, query):
    monkeypatch.setattr(
        agent_quality, "read_quality_report_snapshot", lambda **kw: None
    )
    assert test_app.get(f"/api/quality?{query}").status_code == 422


def test_quality_http_maps_expired_cursor_to_conflict(test_app, monkeypatch):
    monkeypatch.setattr(
        agent_quality, "read_quality_report_snapshot", lambda **kw: None
    )
    response = test_app.get(f"/api/quality?category=low_bitrate&cursor={_cursor()}")
    assert response.status_code == 409


def test_quality_http_requires_authentication(test_app, monkeypatch):
    from crate.api import analytics
    from fastapi import HTTPException

    def deny(request):
        raise HTTPException(status_code=401, detail="Authentication required")

    reader = Mock(side_effect=AssertionError("Unauthorized access reached evidence"))
    monkeypatch.setattr(analytics, "_require_auth", deny)
    monkeypatch.setattr(agent_quality, "read_quality_report_snapshot", reader)
    assert test_app.get("/api/quality").status_code == 401
    reader.assert_not_called()
