from datetime import date, datetime, timedelta, timezone

from crate.api import admin_metrics


def _row(day, kpi, value, dims=None, sample=None):
    return {
        "day": day,
        "kpi": kpi,
        "dims": dims or {},
        "value": value,
        "sample": sample,
        "computed_at": datetime(2026, 11, 2, 14, 0, tzinfo=timezone.utc),
    }


def test_kpis_return_the_window_and_the_one_before_with_small_segments_hidden(
    test_app, monkeypatch
):
    requested = {}
    today = datetime.now(timezone.utc).date()

    def fake_rows(start: date, end: date):
        requested.update(start=start, end=end)
        return {
            "rows": [
                _row(today, "listening.plays", 120.0, sample=9),
                _row(
                    today,
                    "listening.plays_by_platform",
                    100.0,
                    {"platform": "android"},
                    7,
                ),
                _row(
                    today, "listening.plays_by_platform", 20.0, {"platform": "ios"}, 2
                ),
                _row(today, "acquisition.completed", 4.0, {"source": "soulseek"}),
            ],
            "computed_at": datetime(2026, 11, 2, 14, 0, tzinfo=timezone.utc),
        }

    monkeypatch.setattr(admin_metrics, "get_product_kpi_rows", fake_rows)

    response = test_app.get("/api/admin/kpis?days=7")

    assert response.status_code == 200
    body = response.json()
    assert requested == {"start": today - timedelta(days=13), "end": today}
    assert body["window_days"] == 7
    assert body["current_start"] == (today - timedelta(days=6)).isoformat()
    assert body["minimum_sample"] == 3
    series = {
        (item["kpi"], tuple(item["dims"].items())): item for item in body["series"]
    }
    assert series[("listening.plays", ())]["points"][0]["value"] == 120.0
    android = series[("listening.plays_by_platform", (("platform", "android"),))]
    ios = series[("listening.plays_by_platform", (("platform", "ios"),))]
    assert android["points"][0]["value"] == 100.0
    assert ios["points"][0] == {
        "day": today.isoformat(),
        "value": None,
        "sample": 2,
        "suppressed": True,
    }
    soulseek = series[("acquisition.completed", (("source", "soulseek"),))]
    assert soulseek["points"][0]["suppressed"] is False


def test_kpis_reject_windows_outside_the_supported_set(test_app, monkeypatch):
    monkeypatch.setattr(
        admin_metrics,
        "get_product_kpi_rows",
        lambda *_args: {"rows": [], "computed_at": None},
    )

    assert test_app.get("/api/admin/kpis?days=14").status_code == 422
    empty = test_app.get("/api/admin/kpis")
    assert empty.status_code == 200
    assert empty.json()["series"] == [] and empty.json()["computed_at"] is None
