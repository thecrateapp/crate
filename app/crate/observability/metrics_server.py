"""Container-local Prometheus endpoint, opened only by the supervising process."""

from __future__ import annotations

import logging
import os
import sys
import time
from collections.abc import MutableMapping

log = logging.getLogger(__name__)

DEFAULT_DIRECTORY = "/tmp/crate-metrics"
DEFAULT_PORT = 9200


class SupervisorCollector:
    """Build identity and supervisor start, outside the per-process files."""

    def __init__(self, service: str, revision: str, started_at: float):
        self.service = service
        self.revision = revision
        self.started_at = started_at

    def collect(self):
        from prometheus_client.core import GaugeMetricFamily

        build = GaugeMetricFamily(
            "crate_build_info",
            "Crate build serving this container",
            labels=["service", "revision"],
        )
        build.add_metric([self.service, self.revision], 1.0)
        yield build
        yield GaugeMetricFamily(
            "crate_supervisor_start_time_seconds",
            "Start of the process that owns the metrics directory",
            value=self.started_at,
        )


def prepare(environ: MutableMapping[str, str] = os.environ) -> str | None:
    """Reset the shared directory once per container start, before any import."""
    if environ.get("CRATE_PROMETHEUS_METRICS") != "1":
        return None
    if "prometheus_client" in sys.modules:
        log.warning("prometheus_client imported before the metrics directory was set")
        return None
    directory = environ.get("PROMETHEUS_MULTIPROC_DIR") or DEFAULT_DIRECTORY
    os.makedirs(directory, exist_ok=True)
    for name in os.listdir(directory):
        if name.endswith(".db"):
            os.unlink(os.path.join(directory, name))
    environ["PROMETHEUS_MULTIPROC_DIR"] = directory
    return directory


def start(service: str, environ: MutableMapping[str, str] = os.environ):
    """Prepare the directory and serve it on the internal port; None when disabled."""
    directory = prepare(environ)
    if directory is None:
        return None
    from prometheus_client import CollectorRegistry, start_http_server
    from prometheus_client.multiprocess import MultiProcessCollector

    registry = CollectorRegistry(auto_describe=False)
    MultiProcessCollector(registry, path=directory)
    registry.register(
        SupervisorCollector(
            service,
            environ.get("CRATE_RELEASE_SHA", "").strip() or "unknown",
            time.time(),
        )
    )
    port = int(environ.get("CRATE_METRICS_PORT") or DEFAULT_PORT)
    server, _thread = start_http_server(
        port, addr=environ.get("CRATE_METRICS_ADDR") or "0.0.0.0", registry=registry
    )
    log.info("Prometheus metrics for %s on port %d", service, server.server_port)
    return server
