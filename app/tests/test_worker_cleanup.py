from __future__ import annotations


def test_service_cleanup_prunes_expired_recommendation_exposures(monkeypatch):
    from crate import worker

    calls: list[str] = []

    monkeypatch.setattr(
        "crate.db.events.cleanup_old_events",
        lambda max_age_hours: calls.append(f"events:{max_age_hours}"),
    )
    monkeypatch.setattr(
        "crate.db.events.cleanup_old_tasks",
        lambda max_age_days: calls.append(f"tasks:{max_age_days}"),
    )
    monkeypatch.setattr(
        "crate.db.repositories.auth.cleanup_expired_sessions",
        lambda max_age_days, stale_age_days: calls.append(
            f"sessions:{max_age_days}:{stale_age_days}"
        ),
    )
    monkeypatch.setattr(
        "crate.db.repositories.auth.cleanup_ended_jam_rooms",
        lambda max_age_days: calls.append(f"jams:{max_age_days}"),
    )
    monkeypatch.setattr(
        "crate.db.repositories.recommendations.delete_expired_recommendation_exposures",
        lambda: calls.append("recommendation_exposures"),
    )
    monkeypatch.setattr(
        "crate.db.worker_logs.cleanup_old_logs",
        lambda max_age_days: calls.append(f"logs:{max_age_days}"),
    )

    worker._run_periodic_cleanup()

    assert "recommendation_exposures" in calls
