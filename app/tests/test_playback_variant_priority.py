from __future__ import annotations

from crate.streaming.service import _create_variant_task_safely


def test_active_variant_preparation_uses_interactive_priority(monkeypatch):
    captured: dict = {}

    def fake_create_task(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return "task-active"

    monkeypatch.setattr("crate.streaming.service.create_task_dedup", fake_create_task)

    assert _create_variant_task_safely("cache-active", reason="active") == "task-active"
    assert captured["kwargs"]["priority"] == 0
    assert captured["kwargs"]["pool"] == "playback"


def test_lookahead_variant_preparation_uses_speculative_priority(monkeypatch):
    captured: dict = {}

    def fake_create_task(*args, **kwargs):
        captured["kwargs"] = kwargs
        return "task-lookahead"

    monkeypatch.setattr("crate.streaming.service.create_task_dedup", fake_create_task)

    assert (
        _create_variant_task_safely("cache-lookahead", reason="lookahead")
        == "task-lookahead"
    )
    assert captured["kwargs"]["priority"] == 2
    assert captured["kwargs"]["pool"] == "playback"
