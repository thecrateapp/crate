import asyncio
from types import SimpleNamespace

from crate.api import metrics_middleware
from crate.api.metrics_middleware import _classify_metric_target


def test_metrics_middleware_classifies_event_stream_as_stream():
    target = _classify_metric_target(
        "/api/admin/ops-stream",
        [(b"content-type", b"text/event-stream; charset=utf-8")],
    )

    assert target == "stream"


def test_metrics_middleware_classifies_json_api_as_api():
    target = _classify_metric_target(
        "/api/admin/ops-snapshot",
        [(b"content-type", b"application/json")],
    )

    assert target == "api"


def test_metrics_middleware_skips_media_streams():
    target = _classify_metric_target(
        "/api/stream/library/foo.flac",
        [(b"content-type", b"audio/flac")],
    )

    assert target is None


def _run_metrics_middleware(
    monkeypatch,
    *,
    path: str,
    route_path: str | None,
    method: str = "GET",
    status: int = 200,
    content_type: str = "application/xml",
):
    records = []
    monkeypatch.setattr(
        metrics_middleware,
        "record_later",
        lambda name, value, tags=None: records.append(("sample", name, value, tags)),
    )
    monkeypatch.setattr(
        metrics_middleware,
        "record_counter_later",
        lambda name, tags=None: records.append(("counter", name, tags)),
    )
    monkeypatch.setattr(
        metrics_middleware,
        "record_route_latency_later",
        lambda **kwargs: records.append(("route", kwargs)),
    )
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "query_string": b"p=do-not-record&apiKey=also-secret",
        "headers": [],
    }

    async def app(inner_scope, receive, send):
        if route_path:
            inner_scope["route"] = SimpleNamespace(path=route_path)
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [(b"content-type", content_type.encode())],
            }
        )
        await send({"type": "http.response.body", "body": b""})

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(_message):
        return None

    asyncio.run(metrics_middleware.MetricsMiddleware(app)(scope, receive, send))
    return records


def test_metrics_middleware_records_low_cardinality_opensubsonic_route(monkeypatch):
    records = _run_metrics_middleware(
        monkeypatch,
        path="/rest/getSong.view",
        route_path="/rest/getSong.view",
    )

    route_record = next(record for record in records if record[0] == "route")
    assert route_record[1] == {
        "method": "GET",
        "path": "/rest/getSong",
        "status": 200,
        "elapsed_ms": route_record[1]["elapsed_ms"],
        "target": "opensubsonic",
    }
    assert all("do-not-record" not in repr(record) for record in records)
    assert all("also-secret" not in repr(record) for record in records)


def test_metrics_middleware_collapses_unmatched_rest_paths(monkeypatch):
    records = _run_metrics_middleware(
        monkeypatch,
        path="/rest/untrusted-client-route-12345",
        route_path=None,
        status=404,
    )

    route_record = next(record for record in records if record[0] == "route")
    assert route_record[1]["path"] == "/rest/{unmatched}"
    assert route_record[1]["target"] == "opensubsonic"
    assert "untrusted-client-route-12345" not in repr(records)


def test_metrics_middleware_bounds_untrusted_opensubsonic_methods(monkeypatch):
    records = _run_metrics_middleware(
        monkeypatch,
        path="/rest/getArtists.view",
        route_path="/rest/getArtists.view",
        method="UNTRUSTED-VERB-12345",
    )

    route_record = next(record for record in records if record[0] == "route")
    assert route_record[1]["method"] == "OTHER"
    assert "UNTRUSTED-VERB-12345" not in repr(records)


def test_opensubsonic_requests_over_one_second_emit_the_slow_budget_counter(
    monkeypatch,
):
    monkeypatch.setattr(metrics_middleware, "_SLOW_REQUEST_MS", 0)

    records = _run_metrics_middleware(
        monkeypatch,
        path="/rest/getArtists",
        route_path="/rest/getArtists",
    )

    assert any(record[:2] == ("counter", "api.request.slow") for record in records)
