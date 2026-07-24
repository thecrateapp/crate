from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * quantile))))
    return ordered[index]


def request_once(url: str, headers: dict[str, str]) -> dict:
    started = time.perf_counter()
    try:
        with urlopen(Request(url, headers=headers), timeout=30) as response:
            first = response.read(1)
            ttfb_ms = (time.perf_counter() - started) * 1000
            body = first + response.read()
            return {
                "status": response.status,
                "ttfb_ms": ttfb_ms,
                "duration_ms": (time.perf_counter() - started) * 1000,
                "bytes": len(body),
                "source": response.headers.get("X-Crate-Readplane")
                or response.headers.get("X-Crate-Artwork"),
                "content_range": response.headers.get("Content-Range"),
            }
    except HTTPError as exc:
        return {
            "status": exc.code,
            "ttfb_ms": (time.perf_counter() - started) * 1000,
            "duration_ms": (time.perf_counter() - started) * 1000,
            "bytes": len(exc.read()),
            "source": exc.headers.get("X-Crate-Readplane"),
            "content_range": exc.headers.get("Content-Range"),
        }


def profile(
    url: str, *, concurrency: int, requests: int, headers: dict[str, str]
) -> dict:
    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        samples = list(
            executor.map(lambda _: request_once(url, headers), range(requests))
        )
    elapsed_seconds = max(time.perf_counter() - started, 0.000001)
    bytes_total = sum(item["bytes"] for item in samples)
    return {
        "url": url,
        "concurrency": concurrency,
        "requests": requests,
        "statuses": {
            str(code): sum(item["status"] == code for item in samples)
            for code in sorted({item["status"] for item in samples})
        },
        "ttfb_p50_ms": round(
            percentile([item["ttfb_ms"] for item in samples], 0.50), 3
        ),
        "ttfb_p95_ms": round(
            percentile([item["ttfb_ms"] for item in samples], 0.95), 3
        ),
        "duration_p95_ms": round(
            percentile([item["duration_ms"] for item in samples], 0.95), 3
        ),
        "bytes_total": bytes_total,
        "elapsed_seconds": round(elapsed_seconds, 6),
        "throughput_bytes_per_second": round(bytes_total / elapsed_seconds, 3),
        "sources": sorted({str(item["source"] or "unknown") for item in samples}),
        "samples": samples,
    }


def write_report(path: str, report: dict) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
