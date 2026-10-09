import pytest

from tests.conftest import PG_AVAILABLE


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_task_event_tail_returns_the_latest_events_in_order(pg_db, monkeypatch):
    from sqlalchemy import text

    from crate.db import events
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO tasks (id, type, status, created_at, updated_at) "
                "VALUES ('tail-task', 'scan', 'running', NOW(), NOW())"
            )
        )
    monkeypatch.setattr(events, "_publish_to_redis", lambda *args, **kwargs: None)
    for index in range(8):
        events.emit_task_event("tail-task", "progress", {"step": index})

    head = events.get_task_events("tail-task", limit=3)
    tail = events.get_task_events("tail-task", limit=3, tail=True)

    assert [event["data"]["step"] for event in head] == [0, 1, 2]
    assert [event["data"]["step"] for event in tail] == [5, 6, 7]
    assert tail[0]["id"] < tail[1]["id"] < tail[2]["id"]
