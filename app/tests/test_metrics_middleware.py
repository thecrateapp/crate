import asyncio
from types import SimpleNamespace

import pytest

from crate.api import metrics_middleware
from crate.api.metrics_middleware import _classify_metric_target


def test_normalize_path_preserves_the_complete_registered_route_template():
    assert (
        metrics_middleware._normalize_path(
            "/api/artists/123/radio", route_path="/api/artists/{artist_id}/radio"
        )
        == "/api/artists/{artist_id}/radio"
    )


def test_normalize_path_collapses_unregistered_api_paths_without_leaking_slugs():
    normalized = metrics_middleware._normalize_path(
        "/api/unregistered/SENSITIVE_SLUG", route_path=None
    )

    assert normalized == "/api/{unmatched}"
    assert "SENSITIVE_SLUG" not in normalized


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
    fail_after_start: bool = False,
    headers: list[tuple[bytes, bytes]] | None = None,
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
        "headers": headers or [],
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
        if fail_after_start:
            raise RuntimeError("Injected stream failure")
        await send({"type": "http.response.body", "body": b""})

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(_message):
        return None

    if fail_after_start:
        with pytest.raises(RuntimeError, match="Injected stream failure"):
            asyncio.run(metrics_middleware.MetricsMiddleware(app)(scope, receive, send))
    else:
        asyncio.run(metrics_middleware.MetricsMiddleware(app)(scope, receive, send))
    return records


@pytest.mark.parametrize("fail_after_start", [False, True])
def test_stream_concurrent_start_and_end_share_the_registered_route_identity(
    monkeypatch, fail_after_start
):
    monkeypatch.setattr(metrics_middleware, "_active_streams", 0)
    records = _run_metrics_middleware(
        monkeypatch,
        path="/api/events",
        route_path="/api/events",
        status=200,
        content_type="text/event-stream",
        fail_after_start=fail_after_start,
    )

    concurrent = [
        record for record in records if record[:2] == ("sample", "stream.concurrent")
    ]
    tags = {"method": "GET", "path": "/api/events", "status": "200"}
    assert concurrent == [
        ("sample", "stream.concurrent", 1.0, tags),
        ("sample", "stream.concurrent", 0.0, tags),
    ]


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


@pytest.mark.parametrize(
    ("path", "headers", "client"),
    [
        ("/api/me", [(b"x-crate-app", b"listen-web")], "listen-web"),
        ("/api/me", [(b"x-crate-app", b" LISTEN-ANDROID ")], "listen-android"),
        ("/api/me", [(b"x-crate-app", b"listen-ios")], "listen-ios"),
        ("/api/me", [(b"x-crate-app", b"listen-tauri")], "listen-desktop"),
        ("/api/admin/ops-snapshot", [(b"x-crate-client", b"admin-web")], "admin-web"),
        ("/rest/getSong.view", [], "subsonic"),
        (
            "/api/me",
            [(b"x-crate-app", b"listen-web"), (b"x-crate-readplane-fallback", b"1")],
            "readplane",
        ),
        ("/api/me", [(b"x-crate-app", b"someone-else")], "other"),
        ("/api/me", [], "other"),
    ],
)
def test_requests_record_a_closed_client_dimension(monkeypatch, path, headers, client):
    records = _run_metrics_middleware(
        monkeypatch,
        path=path,
        route_path=path,
        content_type="application/json",
        headers=headers,
    )

    assert ("counter", "api.request.client", {"client": client, "status": "200"}) in (
        records
    )


def test_event_streams_also_record_their_client(monkeypatch):
    monkeypatch.setattr(metrics_middleware, "_active_streams", 0)
    records = _run_metrics_middleware(
        monkeypatch,
        path="/api/admin/ops-stream",
        route_path="/api/admin/ops-stream",
        content_type="text/event-stream",
        headers=[(b"x-crate-client", b"admin-web")],
    )

    assert (
        "counter",
        "api.request.client",
        {"client": "admin-web", "status": "200"},
    ) in records


def test_client_family_is_closed_and_low_cardinality():
    from crate.observability.metric_catalog import canonical_metric

    known = canonical_metric(
        "api.request.client", {"client": "admin-web", "status": "503"}
    )
    unknown = canonical_metric(
        "api.request.client", {"client": "spoofed", "status": "200"}
    )

    assert dict(known.tags) == {"client": "admin-web", "status_class": "5xx"}
    assert dict(unknown.tags)["client"] == "other"
