from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from crate.api.schemas.media import PlaybackWarmupRequest
from crate.db.repositories.streaming import list_recent_local_delivery_tracks
from crate.worker_handlers.playback import _handle_warmup_stream_variants


def test_recent_local_delivery_tracks_uses_a_bounded_recent_play_query(monkeypatch):
    executed: list[dict] = []

    class Session:
        def execute(self, _statement, params):
            executed.append(params)
            return SimpleNamespace(
                mappings=lambda: SimpleNamespace(
                    all=lambda: [{"id": 7, "path": "/music/track.flac"}]
                )
            )

    @contextmanager
    def scope():
        yield Session()

    monkeypatch.setattr("crate.db.repositories.streaming.read_scope", scope)

    assert list_recent_local_delivery_tracks(1000) == [
        {"id": 7, "path": "/music/track.flac"}
    ]
    assert executed == [{"limit": 100}]


def test_warmup_is_disabled_until_explicitly_enabled(monkeypatch):
    monkeypatch.setattr(
        "crate.worker_handlers.playback._playback_warmup_enabled", lambda: False
    )
    listed = []
    monkeypatch.setattr(
        "crate.worker_handlers.playback.list_recent_local_delivery_tracks",
        lambda _limit: listed.append(True) or [],
    )

    result = _handle_warmup_stream_variants("task-1", {}, {})

    assert result == {"status": "disabled", "enqueued": 0, "skipped": 0}
    assert listed == []


def test_warmup_bounds_recent_local_tracks_and_uses_lookahead_priority(monkeypatch):
    tracks = [
        {"id": 1, "path": "/music/one.flac", "size": 60},
        {"id": 2, "path": "/music/two.flac", "size": 60},
        {"id": 3, "path": "/music/three.flac", "size": 60},
    ]
    prepared: list[tuple[int, str, str]] = []
    monkeypatch.setattr(
        "crate.worker_handlers.playback._playback_warmup_enabled", lambda: True
    )
    monkeypatch.setattr(
        "crate.worker_handlers.playback._has_warmup_disk_headroom", lambda: True
    )
    monkeypatch.setattr(
        "crate.worker_handlers.playback.list_recent_local_delivery_tracks",
        lambda limit: tracks[:limit],
    )
    monkeypatch.setattr(
        "crate.worker_handlers.playback.prepare_playback",
        lambda track, policy, reason: (
            prepared.append((track["id"], policy, reason))
            or SimpleNamespace(preparing=True)
        ),
    )
    monkeypatch.setattr("crate.worker_handlers.playback.is_cancelled", lambda _: False)

    result = _handle_warmup_stream_variants(
        "task-1",
        {"limit": 3, "max_source_bytes": 100, "max_seconds": 30},
        {},
    )

    assert prepared == [(1, "balanced", "lookahead")]
    assert result == {"status": "completed", "enqueued": 1, "skipped": 2}


def test_warmup_only_requests_data_saver_when_enabled_and_within_budget(monkeypatch):
    tracks = [{"id": 1, "path": "/music/one.flac", "size": 40}]
    prepared: list[str] = []
    monkeypatch.setattr(
        "crate.worker_handlers.playback._playback_warmup_enabled", lambda: True
    )
    monkeypatch.setattr(
        "crate.worker_handlers.playback._has_warmup_disk_headroom", lambda: True
    )
    monkeypatch.setattr(
        "crate.worker_handlers.playback.list_recent_local_delivery_tracks",
        lambda _limit: tracks,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.playback.prepare_playback",
        lambda _track, policy, reason: (
            prepared.append(policy) or SimpleNamespace(preparing=True)
        ),
    )
    monkeypatch.setattr("crate.worker_handlers.playback.is_cancelled", lambda _: False)

    result = _handle_warmup_stream_variants(
        "task-1",
        {
            "limit": 1,
            "max_source_bytes": 100,
            "max_seconds": 30,
            "include_data_saver": True,
        },
        {},
    )

    assert prepared == ["balanced", "data_saver"]
    assert result == {"status": "completed", "enqueued": 2, "skipped": 0}


def test_admin_warmup_is_explicitly_enabled_and_deduplicated(monkeypatch):
    from crate.api.playback_admin import api_admin_playback_warmup

    monkeypatch.setattr(
        "crate.api.playback_admin._playback_warmup_enabled", lambda: True
    )
    monkeypatch.setattr(
        "crate.api.playback_admin._require_ops_health", lambda _request: {"id": 1}
    )
    monkeypatch.setattr(
        "crate.api.playback_admin.create_task_dedup", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr(
        "crate.api.playback_admin.find_active_task_by_type_params",
        lambda *_args, **_kwargs: "existing-task",
    )

    result = api_admin_playback_warmup(
        object(), PlaybackWarmupRequest(limit=3, max_source_bytes=100)
    )

    assert result == {
        "task_id": "existing-task",
        "status": "queued",
        "deduplicated": True,
    }


def test_admin_warmup_refuses_when_feature_is_not_enabled(monkeypatch):
    from crate.api.playback_admin import api_admin_playback_warmup

    monkeypatch.setattr(
        "crate.api.playback_admin._playback_warmup_enabled", lambda: False
    )
    monkeypatch.setattr(
        "crate.api.playback_admin._require_ops_health", lambda _request: {"id": 1}
    )

    with pytest.raises(HTTPException, match="Playback warmup is disabled") as exc:
        api_admin_playback_warmup(object(), PlaybackWarmupRequest())

    assert exc.value.status_code == 409
