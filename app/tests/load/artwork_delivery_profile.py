from __future__ import annotations

import argparse

from media_profile_common import profile, request_once, write_report


def artwork_slo_failures(report: dict, expected_requests: int) -> list[str]:
    warm = report["warm"]
    failures = []
    if warm["statuses"] != {"200": expected_requests}:
        failures.append("warm artwork responses were not all HTTP 200")
    if warm["ttfb_p95_ms"] > 50:
        failures.append("warm artwork p95 TTFB exceeded 50 ms")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--token", default="")
    parser.add_argument("--concurrency", type=int, default=50)
    parser.add_argument("--requests", type=int, default=100)
    parser.add_argument(
        "--output", default=".artifacts/benchmarks/artwork-delivery.json"
    )
    parser.add_argument("--enforce-slo", action="store_true")
    args = parser.parse_args()
    headers = {"Authorization": f"Bearer {args.token}"} if args.token else {}
    report = {
        "schema_version": 1,
        "kind": "artwork",
        "cold": request_once(args.url, headers),
        "warm": profile(
            args.url,
            concurrency=args.concurrency,
            requests=args.requests,
            headers=headers,
        ),
    }
    write_report(args.output, report)
    if args.enforce_slo and artwork_slo_failures(report, args.requests):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
