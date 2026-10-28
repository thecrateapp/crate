from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import text


def _seed_track(
    pg_db,
    name: str,
    *,
    source: str | None,
    computed_at: str | None,
    fingerprint: str | None = "sample-fingerprint",
):
    from crate.db.tx import transaction_scope

    pg_db.upsert_artist({"name": "Recent fingerprint artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Recent fingerprint artist",
            "name": "Recent fingerprints",
            "path": "/music/recent-fingerprints",
        }
    )
    path = f"/music/recent-fingerprints/{name}.flac"
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Recent fingerprint artist",
            "album": "Recent fingerprints",
            "filename": f"{name}.flac",
            "title": name,
            "path": path,
            "duration": 180.0,
            "size": 1000,
            "format": "flac",
        }
    )
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET audio_fingerprint = :fingerprint, audio_fingerprint_source = :source, audio_fingerprint_computed_at = :computed_at WHERE path = :path"
            ),
            {
                "path": path,
                "source": source,
                "computed_at": computed_at,
                "fingerprint": fingerprint,
            },
        )


def test_recent_fingerprint_empty_library(pg_db):
    from crate.db.queries.management import get_last_fingerprinted_track

    assert get_last_fingerprinted_track() == {}


def test_recent_fingerprint_uses_successful_computation_time_and_source(pg_db):
    from crate.db.queries.management import get_last_fingerprinted_track

    _seed_track(
        pg_db, "Older", source="chromaprint-v1", computed_at="2026-10-17T08:00:00Z"
    )
    _seed_track(
        pg_db, "Latest", source="pcm16-md5-v1", computed_at="2026-10-18T08:00:00Z"
    )
    _seed_track(pg_db, "Undated", source="chromaprint-v1", computed_at=None)
    _seed_track(
        pg_db,
        "Missing",
        source=None,
        computed_at="2026-10-19T08:00:00Z",
        fingerprint=None,
    )
    _seed_track(
        pg_db, "Blank", source=None, computed_at="2026-10-20T08:00:00Z", fingerprint=""
    )
    assert get_last_fingerprinted_track() == {
        "title": "Latest",
        "artist": "Recent fingerprint artist",
        "album": "Recent fingerprints",
        "source": "pcm16-md5-v1",
        "updated_at": datetime(2026, 10, 18, 8, tzinfo=UTC),
    }


def test_recent_fingerprint_reuses_session_and_breaks_timestamp_ties(
    pg_db, monkeypatch
):
    from crate.db.queries import management
    from crate.db.tx import transaction_scope

    _seed_track(
        pg_db, "First", source="chromaprint-v1", computed_at="2026-10-18T08:00:00Z"
    )
    _seed_track(
        pg_db, "Second", source="chromaprint-v1", computed_at="2026-10-18T08:00:00Z"
    )
    monkeypatch.setattr(
        management, "read_scope", lambda: pytest.fail("must reuse caller session")
    )
    with transaction_scope() as session:
        result = management.get_last_fingerprinted_track(session=session)
    assert result["title"] == "Second"
    assert result["source"] == "chromaprint-v1"
    assert "audio_fingerprint" not in result


def test_worker_publishes_recent_fingerprint_with_existing_analysis(monkeypatch):
    from crate import worker
    from crate.db.queries import management

    recent = {
        "title": "Latest",
        "source": "chromaprint-v1",
        "updated_at": "2026-10-18T08:00:00Z",
    }
    published = []
    monkeypatch.setattr(
        "crate.analysis_daemon.get_analysis_status",
        lambda: {"total": 12, "analysis_done": 10},
    )
    monkeypatch.setattr(
        management, "get_last_analyzed_track", lambda: {"title": "Analyzed"}
    )
    monkeypatch.setattr(management, "get_last_bliss_track", lambda: {"title": "Bliss"})
    monkeypatch.setattr(management, "get_last_fingerprinted_track", lambda: recent)
    monkeypatch.setattr(
        "crate.db.ops_runtime.set_ops_runtime_state",
        lambda key, payload: published.append((key, payload)),
    )
    worker._refresh_analysis_runtime_state()
    assert published == [
        (
            "analysis_status",
            {
                "total": 12,
                "analysis_done": 10,
                "last_analyzed": {"title": "Analyzed"},
                "last_bliss": {"title": "Bliss"},
                "last_fingerprinted": recent,
            },
        )
    ]


def test_analysis_schema_round_trips_recent_fingerprint_and_defaults_old_payloads():
    from crate.api.schemas.management import AnalysisStatusResponse

    recent = {
        "title": "Latest",
        "artist": "Artist",
        "album": "Album",
        "source": "pcm16-md5-v1",
        "updated_at": "2026-10-18T08:00:00Z",
    }
    payload = AnalysisStatusResponse.model_validate(
        {"total": 1, "last_fingerprinted": recent}
    ).model_dump(mode="json")
    assert payload["last_fingerprinted"] == recent
    assert (
        AnalysisStatusResponse.model_validate({"total": 1}).last_fingerprinted.source
        is None
    )


def test_analysis_api_serves_recent_fingerprint_from_snapshot_without_querying(
    test_app, monkeypatch
):
    from crate.db.queries import management

    recent = {
        "title": "Latest",
        "artist": "Artist",
        "album": "Album",
        "source": "chromaprint-v1",
        "updated_at": "2026-10-18T08:00:00Z",
    }
    monkeypatch.setattr(
        "crate.api.management.get_cached_ops_snapshot",
        lambda: {"analysis": {"total": 1, "last_fingerprinted": recent}},
    )
    monkeypatch.setattr(
        management,
        "get_last_fingerprinted_track",
        lambda **kwargs: pytest.fail("HTTP must serve the precomputed snapshot"),
    )
    response = test_app.get("/api/manage/analysis-status")
    assert response.status_code == 200
    assert response.json()["last_fingerprinted"] == recent
