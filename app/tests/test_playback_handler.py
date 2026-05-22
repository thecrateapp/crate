from unittest.mock import MagicMock

from crate.worker_handlers.playback import (
    PLAYBACK_TASK_HANDLERS,
    _handle_prepare_stream_variant,
    _max_concurrent_transcodes,
    get_stream_transcode_runtime,
    prune_stream_transcode_slots,
    _acquire_slot,
    _release_slot,
)


class TestHandlerRegistration:
    def test_playback_task_handlers_registers_prepare_stream_variant(self):
        assert "prepare_stream_variant" in PLAYBACK_TASK_HANDLERS
        assert (
            PLAYBACK_TASK_HANDLERS["prepare_stream_variant"]
            is _handle_prepare_stream_variant
        )

    def test_playback_task_handlers_has_no_other_keys(self):
        assert set(PLAYBACK_TASK_HANDLERS.keys()) == {"prepare_stream_variant"}


class TestMaxConcurrentTranscodes:
    def test_returns_default_when_no_config(self, monkeypatch):
        monkeypatch.delenv("CRATE_STREAM_TRANSCODE_MAX_CONCURRENT", raising=False)
        monkeypatch.setattr(
            "crate.worker_handlers.playback.get_setting",
            lambda key, default: default,
        )
        assert _max_concurrent_transcodes({}) == 1

    def test_returns_config_value(self):
        assert _max_concurrent_transcodes({"stream_transcode_max_concurrent": 3}) == 3

    def test_clamps_to_max_4(self):
        assert _max_concurrent_transcodes({"stream_transcode_max_concurrent": 10}) == 4

    def test_clamps_to_min_1(self):
        assert _max_concurrent_transcodes({"stream_transcode_max_concurrent": 0}) == 1
        assert _max_concurrent_transcodes({"stream_transcode_max_concurrent": -1}) == 1

    def test_returns_1_for_invalid_value(self):
        assert (
            _max_concurrent_transcodes({"stream_transcode_max_concurrent": "bad"}) == 1
        )

    def test_env_var_overrides_config(self, monkeypatch):
        monkeypatch.setenv("CRATE_STREAM_TRANSCODE_MAX_CONCURRENT", "2")
        assert _max_concurrent_transcodes({"stream_transcode_max_concurrent": 1}) == 2

    def test_setting_overrides_env(self, monkeypatch):
        monkeypatch.setenv("CRATE_STREAM_TRANSCODE_MAX_CONCURRENT", "2")
        monkeypatch.setattr(
            "crate.worker_handlers.playback.get_setting",
            lambda key, default: "3",
        )
        assert _max_concurrent_transcodes({}) == 3


class TestPruneStreamTranscodeSlots:
    def test_does_nothing_when_redis_none(self, monkeypatch):
        monkeypatch.setattr("crate.worker_handlers.playback.get_redis", lambda: None)
        prune_stream_transcode_slots()

    def test_removes_expired_slots(self, monkeypatch):
        redis = MagicMock()
        monkeypatch.setattr("crate.worker_handlers.playback.get_redis", lambda: redis)
        prune_stream_transcode_slots()
        redis.zremrangebyscore.assert_called_once()

    def test_suppresses_redis_exception(self, monkeypatch):
        redis = MagicMock()
        redis.zremrangebyscore.side_effect = RuntimeError("boom")
        monkeypatch.setattr("crate.worker_handlers.playback.get_redis", lambda: redis)
        prune_stream_transcode_slots()


class TestGetStreamTranscodeRuntime:
    def test_returns_zero_when_redis_none(self, monkeypatch):
        monkeypatch.setattr("crate.worker_handlers.playback.get_redis", lambda: None)
        result = get_stream_transcode_runtime({})
        assert result["active"] == 0
        assert result["slots"] == []
        assert result["limit"] == 1

    def test_returns_active_count(self, monkeypatch):
        redis = MagicMock()
        redis.zcard.return_value = 2
        redis.zrange.return_value = []
        monkeypatch.setattr("crate.worker_handlers.playback.get_redis", lambda: redis)
        result = get_stream_transcode_runtime({"stream_transcode_max_concurrent": 4})
        assert result["active"] == 2
        assert result["limit"] == 4

    def test_parses_slot_entries(self, monkeypatch):
        redis = MagicMock()
        redis.zcard.return_value = 1
        redis.zrange.return_value = [(b"task-1", 1715800000.0)]
        monkeypatch.setattr("crate.worker_handlers.playback.get_redis", lambda: redis)
        result = get_stream_transcode_runtime({})
        assert result["slots"] == [{"task_id": "task-1", "started_at": 1715800000.0}]

    def test_handles_string_task_ids(self, monkeypatch):
        redis = MagicMock()
        redis.zcard.return_value = 1
        redis.zrange.return_value = [("task-str", 1715800000.0)]
        monkeypatch.setattr("crate.worker_handlers.playback.get_redis", lambda: redis)
        result = get_stream_transcode_runtime({})
        assert result["slots"] == [{"task_id": "task-str", "started_at": 1715800000.0}]


class TestAcquireSlot:
    def test_returns_true_when_redis_none(self, monkeypatch):
        monkeypatch.setattr("crate.worker_handlers.playback.get_redis", lambda: None)
        assert _acquire_slot("task-1", 2) is True

    def test_acquires_slot_via_lua_script(self, monkeypatch):
        redis = MagicMock()
        redis.eval.return_value = 1
        monkeypatch.setattr("crate.worker_handlers.playback.get_redis", lambda: redis)
        monkeypatch.setattr(
            "crate.worker_handlers.playback._TRANSCODE_SLOT_WAIT_SECONDS", 600
        )
        monkeypatch.setattr("time.sleep", lambda s: None)
        assert _acquire_slot("task-1", 2) is True

    def test_returns_false_when_slot_not_acquired(self, monkeypatch):
        redis = MagicMock()
        redis.eval.return_value = 0
        monkeypatch.setattr("crate.worker_handlers.playback.get_redis", lambda: redis)
        monkeypatch.setattr(
            "crate.worker_handlers.playback._TRANSCODE_SLOT_WAIT_SECONDS", 0
        )
        assert _acquire_slot("task-1", 2) is False


class TestReleaseSlot:
    def test_does_nothing_when_redis_none(self, monkeypatch):
        monkeypatch.setattr("crate.worker_handlers.playback.get_redis", lambda: None)
        _release_slot("task-1")

    def test_removes_slot(self, monkeypatch):
        redis = MagicMock()
        monkeypatch.setattr("crate.worker_handlers.playback.get_redis", lambda: redis)
        _release_slot("task-1")
        redis.zrem.assert_called_once()

    def test_suppresses_exception(self, monkeypatch):
        redis = MagicMock()
        redis.zrem.side_effect = RuntimeError("boom")
        monkeypatch.setattr("crate.worker_handlers.playback.get_redis", lambda: redis)
        _release_slot("task-1")


class TestPrepareStreamVariant:
    def test_raises_on_missing_cache_key(self):
        try:
            _handle_prepare_stream_variant("task-1", {}, {})
        except ValueError as exc:
            assert "cache_key is required" in str(exc)
        else:
            raise AssertionError("Expected ValueError")

    def test_raises_on_empty_cache_key(self):
        try:
            _handle_prepare_stream_variant("task-1", {"cache_key": "  "}, {})
        except ValueError as exc:
            assert "cache_key is required" in str(exc)
        else:
            raise AssertionError("Expected ValueError")

    def test_successful_transcode(self, monkeypatch):
        emitted_events: list[tuple] = []
        emitted_progress: list = []

        monkeypatch.setattr(
            "crate.worker_handlers.playback.emit_task_event",
            lambda task_id, event_type, payload: emitted_events.append(
                (task_id, event_type, payload)
            ),
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback.emit_progress",
            lambda task_id, progress: emitted_progress.append((task_id, progress)),
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback.mark_variant_running",
            lambda cache_key, task_id: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback.transcode_variant",
            lambda cache_key: {
                "id": 42,
                "bytes": 1234567,
                "relative_path": "transcodes/test.m3u8",
                "preset": "hls_256",
            },
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback._acquire_slot",
            lambda task_id, limit: True,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback._release_slot",
            lambda task_id: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback._max_concurrent_transcodes",
            lambda config: 2,
        )

        result = _handle_prepare_stream_variant("task-1", {"cache_key": "abc123"}, {})

        assert result["cache_key"] == "abc123"
        assert result["variant_id"] == 42
        assert result["bytes"] == 1234567
        assert result["relative_path"] == "transcodes/test.m3u8"
        assert any(e[1] == "info" for e in emitted_events)
        assert len(emitted_progress) >= 2

    def test_transcode_failure_releases_slot_and_raises(self, monkeypatch):
        released: list[str] = []

        monkeypatch.setattr(
            "crate.worker_handlers.playback.emit_task_event",
            lambda *args, **kwargs: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback.emit_progress",
            lambda *args, **kwargs: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback.mark_variant_running",
            lambda cache_key, task_id: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback.transcode_variant",
            lambda cache_key: (_ for _ in ()).throw(RuntimeError("ffmpeg crash")),
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback._acquire_slot",
            lambda task_id, limit: True,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback._release_slot",
            lambda task_id: released.append(task_id),
        )

        try:
            _handle_prepare_stream_variant("task-1", {"cache_key": "abc123"}, {})
        except RuntimeError as exc:
            assert "ffmpeg crash" in str(exc)
            assert released == ["task-1"]
        else:
            raise AssertionError("Expected RuntimeError")

    def test_slot_acquisition_timeout_raises(self, monkeypatch):
        monkeypatch.setattr(
            "crate.worker_handlers.playback.emit_task_event",
            lambda *args, **kwargs: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback.emit_progress",
            lambda *args, **kwargs: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback._acquire_slot",
            lambda task_id, limit: False,
        )

        try:
            _handle_prepare_stream_variant("task-1", {"cache_key": "abc123"}, {})
        except RuntimeError as exc:
            assert "Timed out" in str(exc)
        else:
            raise AssertionError("Expected RuntimeError")

    def test_always_releases_slot_even_on_success(self, monkeypatch):
        released: list[str] = []

        monkeypatch.setattr(
            "crate.worker_handlers.playback.emit_task_event",
            lambda *args, **kwargs: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback.emit_progress",
            lambda *args, **kwargs: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback.mark_variant_running",
            lambda cache_key, task_id: None,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback.transcode_variant",
            lambda cache_key: {"id": 1, "bytes": 100, "relative_path": "t/test.m3u8"},
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback._acquire_slot",
            lambda task_id, limit: True,
        )
        monkeypatch.setattr(
            "crate.worker_handlers.playback._release_slot",
            lambda task_id: released.append(task_id),
        )

        _handle_prepare_stream_variant("task-1", {"cache_key": "abc123"}, {})
        assert released == ["task-1"]
