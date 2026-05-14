"""Tests for the distributed tracing skeleton middleware."""

import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.responses import PlainTextResponse

from crate.api.trace_middleware import (
    TraceMiddleware,
    _generate_trace_id,
    install_trace_id_log_record_factory,
)


@pytest.fixture
def trace_app():
    app = FastAPI()
    app.add_middleware(TraceMiddleware)

    @app.get("/test")
    def test_route():
        return PlainTextResponse("ok")

    @app.get("/sets-trace")
    def sets_trace_route():
        response = PlainTextResponse("ok")
        response.headers["X-Trace-ID"] = "downstream"
        return response

    return TestClient(app)


def test_trace_id_is_generated_when_header_missing(trace_app):
    response = trace_app.get("/test")
    assert response.status_code == 200
    trace_id = response.headers.get("X-Trace-ID")
    assert trace_id is not None
    assert len(trace_id) == 32  # 16 bytes hex


def test_trace_id_is_propagated_when_header_present(trace_app):
    existing_trace = "abc123def456"
    response = trace_app.get("/test", headers={"X-Trace-ID": existing_trace})
    assert response.status_code == 200
    assert response.headers.get("X-Trace-ID") == existing_trace


def test_trace_id_is_regenerated_when_header_is_invalid(trace_app):
    response = trace_app.get("/test", headers={"X-Trace-ID": "bad trace"})
    assert response.status_code == 200
    trace_id = response.headers.get("X-Trace-ID")
    assert trace_id is not None
    assert trace_id != "bad trace"
    assert len(trace_id) == 32


def test_trace_id_replaces_downstream_header(trace_app):
    response = trace_app.get("/sets-trace", headers={"X-Trace-ID": "upstream"})

    assert response.status_code == 200
    assert response.headers.get_list("X-Trace-ID") == ["upstream"]


def test_generate_trace_id_format():
    trace_id = _generate_trace_id()
    assert len(trace_id) == 32
    assert int(trace_id, 16) >= 0


def test_trace_log_record_factory_is_idempotent_and_sets_default_trace_id(monkeypatch):
    import crate.api.trace_middleware as tracing

    previous_factory = logging.getLogRecordFactory()
    monkeypatch.setattr(tracing, "_log_record_factory_installed", False)

    try:
        install_trace_id_log_record_factory()
        first_factory = logging.getLogRecordFactory()
        install_trace_id_log_record_factory()

        assert logging.getLogRecordFactory() is first_factory

        record = logging.getLogger("crate.test").makeRecord(
            "crate.test",
            logging.INFO,
            __file__,
            1,
            "message",
            (),
            None,
        )
        assert record.trace_id == "-"
    finally:
        logging.setLogRecordFactory(previous_factory)
