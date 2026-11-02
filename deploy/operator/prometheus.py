"""Fixed allowlist of Prometheus recording-rule reads for the supervisor."""

import math
import urllib.parse
from dataclasses import dataclass
from datetime import UTC, datetime

from .delivery import request_json, validate_url

TOOL = "prometheus_query"
TIMEOUT_SECONDS = 2
FRESH_SECONDS = 120


@dataclass(frozen=True)
class Query:
    selector: str
    aggregate: str
    sample: str | None = None
    minimum: float = 0

    @property
    def value_expression(self):
        return f"{self.aggregate}({self.selector})"

    @property
    def observed_expression(self):
        return f"min(timestamp({self.selector}))"

    @property
    def sample_expression(self):
        return f"sum({self.sample})" if self.sample else None


QUERIES = {
    "prometheus-up": Query('up{job="prometheus"}', "min"),
    "app-scrape-up-min": Query("crate:scrape_up:by_service", "min"),
    "app-scrape-age-max": Query("crate:scrape_age_seconds:by_service", "max"),
    "app-sample-limit-hit": Query("crate:scrape_sample_limit_hit:by_service", "max"),
    "queue-depth-max": Query("crate:worker_queue_depth:last2m", "max"),
    "queue-wait-p95-max": Query(
        "crate:worker_queue_wait_seconds:p95_15m",
        "max",
        "crate:worker_tasks:increase15m",
        20,
    ),
    "task-failure-ratio-max": Query(
        "crate:worker_task_failures:ratio15m",
        "max",
        "crate:worker_tasks:increase15m",
        20,
    ),
    "api-error-ratio": Query(
        "crate:api_request_errors:ratio5m",
        "max",
        "crate:api_requests:increase5m",
        50,
    ),
    "api-latency-p95-max": Query(
        "crate:api_request_latency_seconds:p95_5m",
        "max",
        "crate:api_requests:increase5m",
        50,
    ),
    "stream-p95-max": Query("crate:stream_latency_seconds:p95_5m", "max"),
    "playback-stalls-per-startup": Query(
        "crate:playback_stalls_per_startup:ratio15m",
        "max",
        "crate:playback_startup:increase15m",
        20,
    ),
    "playback-startup-p95-max": Query(
        "crate:playback_startup_seconds:p95_15m",
        "max",
        "crate:playback_startup:increase15m",
        20,
    ),
    "transcode-failure-ratio-max": Query(
        "crate:stream_transcode_failures:ratio15m",
        "max",
        "crate:stream_transcodes:increase15m",
        10,
    ),
}


def _single(answer):
    if not isinstance(answer, dict) or answer.get("status") != "success":
        return "query_rejected", None
    data = answer.get("data")
    if not isinstance(data, dict) or data.get("resultType") != "vector":
        return "query_rejected", None
    result = data.get("result")
    if not isinstance(result, list):
        return "query_rejected", None
    if not result:
        return "no_data", None
    if len(result) > 1:
        return "ambiguous", None
    sample = result[0].get("value") if isinstance(result[0], dict) else None
    try:
        value = float(sample[1])
    except (TypeError, ValueError, IndexError):
        return "invalid_value", None
    if not math.isfinite(value):
        return "invalid_value", None
    return None, value


class PrometheusReader:
    def __init__(self, url):
        self.endpoint = validate_url(url.rstrip("/") + "/api/v1/query")

    def _query(self, expression):
        code, answer = request_json(
            self.endpoint,
            payload=urllib.parse.urlencode({"query": expression}).encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=TIMEOUT_SECONDS,
        )
        return _single(answer) if code == 200 else ("query_rejected", None)

    def call(self, name, arguments):
        if (
            name != TOOL
            or set(arguments) != {"query"}
            or arguments["query"] not in QUERIES
        ):
            raise ValueError("Only allowlisted Prometheus queries are supported")
        query = QUERIES[arguments["query"]]
        source = {
            "schema_version": "1",
            "source": "prometheus",
            "availability": "unavailable",
            "freshness": {"fresh_seconds": FRESH_SECONDS},
            "data": {},
        }
        problem, observed = self._query(query.observed_expression)
        if problem:
            return {**source, "coverage": problem}
        source["observed_at"] = datetime.fromtimestamp(observed, UTC).isoformat()
        if query.sample is not None:
            problem, sample = self._query(query.sample_expression)
            if problem or sample < query.minimum:
                return {**source, "coverage": "insufficient_sample"}
        problem, value = self._query(query.value_expression)
        if problem:
            return {**source, "coverage": problem}
        return {
            **source,
            "availability": "available",
            "coverage": "complete",
            "data": {"value": value},
        }
