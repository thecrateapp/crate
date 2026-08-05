"""Contracts for durable Jam Room worker tasks."""


def test_prime_auto_dj_handler_uses_the_current_room(monkeypatch):
    from crate.worker_handlers.jam import _handle_prime_jam_auto_dj

    room = {"id": "room-1", "queue_mode": "auto_dj"}
    calls: list[dict] = []

    monkeypatch.setattr("crate.db.jam.get_jam_room", lambda room_id: room)
    monkeypatch.setattr(
        "crate.jam_auto_dj.ensure_auto_dj_room",
        lambda current_room: calls.append(current_room) or True,
    )

    assert _handle_prime_jam_auto_dj("task-1", {"room_id": "room-1"}, {}) == {
        "status": "completed",
        "room_id": "room-1",
        "changed": True,
    }
    assert calls == [room]


def test_prime_auto_dj_handler_skips_missing_or_non_auto_rooms(monkeypatch):
    from crate.worker_handlers.jam import _handle_prime_jam_auto_dj

    monkeypatch.setattr("crate.db.jam.get_jam_room", lambda room_id: None)
    assert _handle_prime_jam_auto_dj("task-1", {"room_id": "missing"}, {}) == {
        "status": "skipped",
        "reason": "room_not_found",
    }

    monkeypatch.setattr(
        "crate.db.jam.get_jam_room",
        lambda room_id: {"id": room_id, "queue_mode": "manual"},
    )
    assert _handle_prime_jam_auto_dj("task-1", {"room_id": "manual"}, {}) == {
        "status": "skipped",
        "reason": "not_auto_dj",
    }
