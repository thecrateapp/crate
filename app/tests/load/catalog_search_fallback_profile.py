#!/usr/bin/env python3
"""Production-shaped local search fallback capacity profile."""

from __future__ import annotations

import argparse
import json
import math
import os
import statistics
import time
import uuid
from pathlib import Path

from sqlalchemy import text

from crate.db.init_db import init_db
from crate.db.queries.browse_media_search import (
    _HYBRID_TRACKS_SQL,
    _search_params,
    search_all_hybrid,
)
from crate.db.tx import read_scope
from tests.load.federation_catalog_profile import _cleanup, _seed


def percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(float(value) for value in values)
    rank = max(1, math.ceil(max(0.0, min(1.0, quantile)) * len(ordered)))
    return ordered[rank - 1]


def evaluate_gate(profile: dict) -> list[str]:
    failures: list[str] = []
    if float(profile.get("p95_ms") or 0) > 300:
        failures.append("search fallback p95 exceeds 300 ms")
    if float(profile.get("p99_ms") or 0) >= 800:
        failures.append("search fallback p99 is not below 800 ms")
    if profile.get("errors"):
        failures.append("search fallback returned errors")
    if int(profile.get("invalid_payloads") or 0):
        failures.append("search fallback returned invalid payloads")
    return failures


def payload_is_valid(payload: object) -> bool:
    if not isinstance(payload, dict):
        return False
    return all(
        isinstance(payload.get(key), list) for key in ("artists", "albums", "tracks")
    )


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artists", type=int, default=1_000)
    parser.add_argument("--albums", type=int, default=10_000)
    parser.add_argument("--tracks", type=int, default=100_000)
    parser.add_argument("--rounds", type=int, default=12)
    parser.add_argument("--enforce-slo", action="store_true")
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def _queries(run_id: str) -> list[str]:
    return [
        "Federation Profile",
        f"Profile {run_id[:4]}",
        "Artist 99",
        "Track 999",
        "rack 999",
        "Ártist 42",
    ]


def _profile_search(run_id: str, rounds: int) -> dict:
    queries = _queries(run_id)
    for query in queries:
        search_all_hybrid(query, 20)

    latencies: list[float] = []
    errors: list[str] = []
    invalid_payloads = 0
    by_query: dict[str, list[float]] = {query: [] for query in queries}
    for round_index in range(max(1, rounds)):
        for query in (
            queries[round_index % len(queries) :]
            + queries[: round_index % len(queries)]
        ):
            started = time.perf_counter()
            try:
                payload = search_all_hybrid(query, 20)
                if not payload_is_valid(payload):
                    invalid_payloads += 1
            except Exception as exc:
                errors.append(type(exc).__name__)
            finally:
                elapsed_ms = (time.perf_counter() - started) * 1_000
                latencies.append(elapsed_ms)
                by_query[query].append(elapsed_ms)

    return {
        "samples": len(latencies),
        "p50_ms": statistics.median(latencies) if latencies else 0.0,
        "p95_ms": percentile(latencies, 0.95),
        "p99_ms": percentile(latencies, 0.99),
        "max_ms": max(latencies, default=0.0),
        "errors": errors,
        "invalid_payloads": invalid_payloads,
        "by_query": {
            query: {
                "p50_ms": statistics.median(values),
                "p95_ms": percentile(values, 0.95),
                "max_ms": max(values),
            }
            for query, values in by_query.items()
        },
    }


def _track_search_plan(query: str) -> dict:
    with read_scope() as session:
        plan = session.execute(
            text("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + str(_HYBRID_TRACKS_SQL)),
            _search_params(query, 20),
        ).scalar_one()[0]
    encoded = json.dumps(plan)
    return {
        "planning_ms": float(plan.get("Planning Time") or 0),
        "execution_ms": float(plan.get("Execution Time") or 0),
        "uses_fts_index": "idx_tracks_search_fts" in encoded,
        "uses_title_trigram": "idx_tracks_title_trgm" in encoded,
        "uses_artist_trigram": "idx_tracks_artist_trgm" in encoded,
        "has_track_seq_scan": (
            '"Node Type": "Seq Scan"' in encoded
            and '"Relation Name": "library_tracks"' in encoded
        ),
    }


def main() -> int:
    args = _arguments()
    if os.environ.get("CRATE_POSTGRES_DB") != "crate_test":
        raise SystemExit(
            "search capacity profile refuses to run outside CRATE_POSTGRES_DB=crate_test"
        )

    init_db()
    run_id = uuid.uuid4().hex[:10]
    try:
        _seed(run_id, args.artists, args.albums, args.tracks)
        profile = _profile_search(run_id, args.rounds)
        plans = {
            query: _track_search_plan(query)
            for query in ("Federation Profile", "Track 999", "rack 999")
        }
        failures = evaluate_gate(profile)
        result = {
            "fixture": {
                "artists": args.artists,
                "albums": args.albums,
                "tracks": args.tracks,
            },
            "python_local_search": profile,
            "track_query_plans": plans,
            "slo_failures": failures,
        }
        rendered = json.dumps(result, indent=2, sort_keys=True)
        print(rendered)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(rendered + "\n", encoding="utf-8")
        return 1 if args.enforce_slo and failures else 0
    finally:
        _cleanup(run_id)


if __name__ == "__main__":
    raise SystemExit(main())
