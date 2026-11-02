from __future__ import annotations

import pytest

from tests.prometheus_processes import run_child


def test_disabled_endpoint_opens_no_socket_or_thread_and_imports_no_client():
    result = run_child(
        """
        import os, sys, threading
        from crate import metrics
        from crate.observability.metrics_server import start

        metrics.record("api.request.count", 1.0)
        print(start("api", os.environ), threading.active_count(),
              "prometheus_client" in sys.modules)
        """,
        None,
    )

    assert result.stdout.split() == ["None", "1", "False"]


def test_endpoint_serves_isolated_registry_with_build_identity(tmp_path):
    pytest.importorskip("prometheus_client")
    result = run_child(
        """
        import os, urllib.request
        from crate.observability.metrics_server import start

        server = start("api", os.environ)
        import crate.db.cache_runtime
        from crate import metrics

        crate.db.cache_runtime.get_redis = lambda: None
        metrics.record("api.request.count", 1.0, {"method": "GET", "status": "200"})
        url = f"http://127.0.0.1:{server.server_port}/metrics"
        print(urllib.request.urlopen(url, timeout=5).read().decode())
        """,
        None,
        CRATE_PROMETHEUS_METRICS="1",
        PROMETHEUS_MULTIPROC_DIR=str(tmp_path),
        CRATE_METRICS_PORT="0",
        CRATE_METRICS_ADDR="127.0.0.1",
        CRATE_RELEASE_SHA="abc123",
    )
    body = result.stdout

    assert 'crate_build_info{revision="abc123",service="api"} 1.0' in body
    assert "crate_supervisor_start_time_seconds " in body
    assert (
        'crate_api_request_total{latency_class="",method="GET",'
        'status_class="2xx",target=""} 1.0'
    ) in body
    assert "process_cpu_seconds_total" not in body
    assert "python_gc_objects_collected_total" not in body


def test_supervisor_refuses_a_directory_set_after_the_client_was_imported(tmp_path):
    pytest.importorskip("prometheus_client")
    result = run_child(
        """
        import os
        import prometheus_client
        from crate.observability.metrics_server import start

        print(start("api", os.environ))
        """,
        None,
        CRATE_PROMETHEUS_METRICS="1",
        PROMETHEUS_MULTIPROC_DIR=str(tmp_path),
    )

    assert result.stdout.split() == ["None"]
