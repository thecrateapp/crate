from __future__ import annotations

import argparse

from media_profile_common import profile, write_report


def local_stream_slo_failures(report: dict, expected_requests: int) -> list[str]:
    baseline = report["fastapi"]
    native = report["readplane"]
    failures = []
    expected_statuses = {"206": expected_requests}
    if baseline["statuses"] != expected_statuses:
        failures.append("FastAPI baseline responses were not all HTTP 206")
    if native["statuses"] != expected_statuses:
        failures.append("readplane responses were not all HTTP 206")
    if native["bytes_total"] != baseline["bytes_total"]:
        failures.append("readplane and FastAPI transferred different byte counts")
    if (
        baseline["throughput_bytes_per_second"] > 0
        and native["throughput_bytes_per_second"]
        < baseline["throughput_bytes_per_second"]
    ):
        failures.append("readplane throughput regressed against FastAPI")
    if (
        baseline["ttfb_p95_ms"] > 0
        and native["ttfb_p95_ms"] > baseline["ttfb_p95_ms"] * 0.8
    ):
        failures.append("readplane p95 TTFB did not improve by at least 20 percent")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fastapi-url", required=True)
    parser.add_argument("--readplane-url", required=True)
    parser.add_argument("--token", default="")
    parser.add_argument("--concurrency", type=int, default=50)
    parser.add_argument("--requests", type=int, default=100)
    parser.add_argument(
        "--output", default=".artifacts/benchmarks/local-stream-delivery.json"
    )
    parser.add_argument("--enforce-slo", action="store_true")
    args = parser.parse_args()
    headers = {"Range": "bytes=0-65535"}
    if args.token:
        headers["Authorization"] = f"Bearer {args.token}"
    report = {
        "schema_version": 1,
        "kind": "local-stream",
        "fastapi": profile(
            args.fastapi_url,
            concurrency=args.concurrency,
            requests=args.requests,
            headers=headers,
        ),
        "readplane": profile(
            args.readplane_url,
            concurrency=args.concurrency,
            requests=args.requests,
            headers=headers,
        ),
    }
    write_report(args.output, report)
    if args.enforce_slo and local_stream_slo_failures(report, args.requests):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
