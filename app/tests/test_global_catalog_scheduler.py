def test_global_catalog_scheduler_defaults_are_registered():
    from crate.scheduler import DEFAULT_SCHEDULES

    assert DEFAULT_SCHEDULES["global_catalog_reconcile_incremental"] == 300
    assert DEFAULT_SCHEDULES["global_catalog_reconcile_full"] == 43200


def test_should_run_respects_disable_by_zero(monkeypatch):
    from crate import scheduler

    monkeypatch.setattr(scheduler, "get_setting", lambda key: None)
    monkeypatch.setattr(scheduler, "list_tasks", lambda **kwargs: [])

    assert (
        scheduler.should_run(
            "global_catalog_reconcile_incremental",
            {"global_catalog_reconcile_incremental": 0},
        )
        is False
    )


def test_scheduler_runs_federation_tasks_without_an_instance_mode():
    from crate import scheduler

    assert scheduler._scheduled_task_enabled("federation_health_poll") is True
    assert scheduler._scheduled_task_enabled("federation_sync_catalog") is True


def test_scheduler_runs_global_catalog_tasks_without_a_feature_gate():
    from crate import scheduler

    assert scheduler._scheduled_task_enabled("global_catalog_reconcile_incremental") is True
    assert scheduler._scheduled_task_enabled("global_catalog_reconcile_full") is True


def test_full_global_reconciliation_is_skipped_while_library_pipeline_running(
    monkeypatch,
):
    from crate import scheduler

    monkeypatch.setattr(scheduler, "get_setting", lambda key: None)

    def fake_list_tasks(status: str, task_type: str, limit: int = 1):
        if status == "running" and task_type == "library_pipeline":
            return [{"id": "task-library"}]
        return []

    monkeypatch.setattr(scheduler, "list_tasks", fake_list_tasks)

    assert (
        scheduler.should_run(
            "global_catalog_reconcile_full",
            {"global_catalog_reconcile_full": 43200},
        )
        is False
    )


def test_scheduler_uses_stable_jitter_for_global_catalog_tasks(monkeypatch):
    from crate import scheduler

    monkeypatch.setattr(scheduler, "local_node_uid", lambda: "node-a")

    first = scheduler.schedule_jitter_seconds("global_catalog_reconcile_full", 43200)
    second = scheduler.schedule_jitter_seconds("global_catalog_reconcile_full", 43200)

    assert first == second
    assert 0 <= first <= 3600
