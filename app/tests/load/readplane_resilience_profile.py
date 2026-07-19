#!/usr/bin/env python3
"""Safe release profile for readplane latency and fallback behavior.

The profile is read-only. It exercises authenticated hot endpoints against a
running test stack and reports p50/p95/p99, readplane source, and errors. It
refuses non-local targets unless CRATE_ALLOW_REMOTE_LOAD_PROFILE=1 is explicit.
"""

from __future__ import annotations

import argparse
import json
import os
from statistics import median
from time import monotonic
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return ordered[index]


def validate_target(base_url: str) -> None:
    host = (urlparse(base_url).hostname or "").lower()
    local = host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".test")
    if not local and os.environ.get("CRATE_ALLOW_REMOTE_LOAD_PROFILE") != "1":
        raise SystemExit(
            "Refusing remote target; set CRATE_ALLOW_REMOTE_LOAD_PROFILE=1 explicitly"
        )


def run(base_url: str, token: str, iterations: int) -> dict:
    validate_target(base_url)
    routes = (
        "/api/catalog/search?q=high&limit=20",
        "/api/me/home/discovery",
        "/api/me/stats/dashboard",
    )
    latencies: list[float] = []
    sources: dict[str, int] = {}
    errors = 0
    for _ in range(max(1, iterations)):
        for route in routes:
            request = Request(
                base_url.rstrip("/") + route,
                headers={"Authorization": f"Bearer {token}"},
            )
            started = monotonic()
            try:
                with urlopen(request, timeout=15) as response:
                    response.read()
                    source = response.headers.get("X-Crate-Readplane", "unset")
                    sources[source] = sources.get(source, 0) + 1
            except Exception:
                errors += 1
            latencies.append((monotonic() - started) * 1000)
    return {
        "requests": len(latencies),
        "errors": errors,
        "latency_ms": {
            "p50": round(median(latencies), 2) if latencies else 0,
            "p95": round(percentile(latencies, 0.95), 2),
            "p99": round(percentile(latencies, 0.99), 2),
        },
        "route_sources": sources,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8585")
    parser.add_argument("--token", default=os.environ.get("CRATE_LOAD_TOKEN", ""))
    parser.add_argument("--iterations", type=int, default=20)
    args = parser.parse_args()
    if not args.token:
        raise SystemExit("--token or CRATE_LOAD_TOKEN is required")
    print(json.dumps(run(args.base_url, args.token, args.iterations), indent=2))


if __name__ == "__main__":
    main()
