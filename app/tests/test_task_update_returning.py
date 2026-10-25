from contextlib import contextmanager


def test_update_task_returns_the_full_row_only_for_status_changes(monkeypatch):
    from crate.db.repositories import tasks_updates

    statements: list[str] = []

    class Result:
        def mappings(self):
            return self

        def first(self):
            return {"id": "task-1", "type": "scan", "status": "running"}

    class Session:
        def execute(self, statement, _params=None):
            statements.append(str(statement))
            return Result()

    @contextmanager
    def scope(_session=None):
        yield Session()

    monkeypatch.setattr(tasks_updates, "optional_scope", scope)
    monkeypatch.setattr(
        tasks_updates, "_register_task_transition_signal", lambda *_args: None
    )

    tasks_updates.update_task(
        "task-1",
        progress="50%",
        dumps_fn=str,
        register_tasks_surface_signal_fn=lambda _session: None,
    )
    tasks_updates.update_task(
        "task-1",
        status="completed",
        dumps_fn=str,
        register_tasks_surface_signal_fn=lambda _session: None,
    )

    assert statements[0].endswith("RETURNING id")
    assert statements[1].endswith("RETURNING *")
