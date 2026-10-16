from crate.show_telemetry import record_show_metrics


def test_show_metrics_have_closed_names_bounds_and_no_source_data(monkeypatch):
    calls = []
    monkeypatch.setattr(
        "crate.metrics.record_later", lambda name, value: calls.append((name, value))
    )
    record_show_metrics(
        candidates=999,
        result={
            "execution": {
                "items": [
                    {"status": "created", "show_id": 7, "evidence": "SECRET"},
                    {"status": "attacker.SECRET"},
                ]
            }
        },
    )
    assert calls == [("shows.import.candidates", 200), ("shows.import.created", 1)]
