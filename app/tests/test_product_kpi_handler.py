from datetime import date, timedelta

from crate.worker_handlers import product_kpis


def _days(count: int) -> list[date]:
    return [date(2026, 1, 1) + timedelta(days=offset) for offset in range(count)]


def test_backfill_runs_in_month_sized_transactions(monkeypatch):
    calls: list[list[date]] = []
    monkeypatch.setattr(product_kpis, "product_kpi_days_due", lambda: _days(70))
    monkeypatch.setattr(product_kpis, "is_cancelled", lambda _task_id: False)
    monkeypatch.setattr(
        product_kpis,
        "compute_product_kpis",
        lambda days: calls.append(days) or len(days),
    )

    result = product_kpis._handle_compute_product_kpis("task-1", {}, {})

    assert [len(chunk) for chunk in calls] == [31, 31, 8]
    assert result == {
        "days": 70,
        "rows": 70,
        "first_day": "2026-01-01",
        "last_day": "2026-03-11",
    }


def test_cancellation_stops_between_chunks(monkeypatch):
    calls: list[list[date]] = []
    monkeypatch.setattr(product_kpis, "product_kpi_days_due", lambda: _days(70))
    monkeypatch.setattr(product_kpis, "is_cancelled", lambda _task_id: len(calls) == 1)
    monkeypatch.setattr(
        product_kpis,
        "compute_product_kpis",
        lambda days: calls.append(days) or len(days),
    )

    result = product_kpis._handle_compute_product_kpis("task-1", {}, {})

    assert result == {"status": "cancelled", "days": 31, "rows": 31}
    assert len(calls) == 1


def test_no_due_days_is_a_quiet_success(monkeypatch):
    monkeypatch.setattr(product_kpis, "product_kpi_days_due", lambda: [])

    result = product_kpis._handle_compute_product_kpis("task-1", {}, {})

    assert result == {"days": 0, "rows": 0, "first_day": None, "last_day": None}


def test_the_task_is_scheduled_hourly_on_the_maintenance_queue():
    from crate.actors import TASK_POOL_CONFIG
    from crate.scheduler import DEFAULT_SCHEDULES

    assert DEFAULT_SCHEDULES["compute_product_kpis"] == 3600
    assert TASK_POOL_CONFIG["compute_product_kpis"].queue == "maintenance"
