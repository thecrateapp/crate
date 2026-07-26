"""Read-only response-time profile for Listen's primary API surfaces."""

from __future__ import annotations

import argparse
import json
import math
import os
import ssl
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Sequence


@dataclass(frozen=True)
class RouteSpec:
    name: str
    path: str
    p95_budget_ms: int


@dataclass(frozen=True)
class ProbeSample:
    status: int
    elapsed_ms: float
    size_bytes: int
    source: str | None
    error: str | None = None


@dataclass(frozen=True)
class RouteResult:
    name: str
    path: str
    status: int
    median_ms: float
    p95_ms: float
    max_ms: float
    size_bytes: int
    source: str | None
    p95_budget_ms: int
    errors: tuple[str, ...]


@dataclass(frozen=True)
class Verdict:
    ok: bool
    failures: tuple[str, ...]


def build_route_specs(*, artist_slug: str, genre_slug: str) -> tuple[RouteSpec, ...]:
    artist = urllib.parse.quote(artist_slug.strip(), safe="")
    genre = urllib.parse.quote(genre_slug.strip(), safe="")
    search = urllib.parse.quote(artist_slug.replace("-", " ").strip())
    home_sections = (
        "recently-played",
        "custom-mixes",
        "suggested-albums",
        "recommended-tracks",
        "radio-stations",
        "favorite-artists",
        "core-tracks",
    )
    return (
        RouteSpec("home", "/api/me/home/discovery", 1_000),
        *(
            RouteSpec(
                f"home-{section}",
                f"/api/me/home/sections/{section}?limit=42",
                1_000,
            )
            for section in home_sections
        ),
        RouteSpec(
            "stats",
            "/api/me/stats/dashboard?window=30d&tracks_limit=12"
            "&artists_limit=10&albums_limit=12&genres_limit=10&replay_limit=36",
            1_000,
        ),
        RouteSpec("genres", "/api/genres", 1_500),
        RouteSpec(
            "genre-detail",
            f"/api/genres/{genre}?view=genre-detail-v5",
            1_500,
        ),
        RouteSpec(
            "artist-page",
            f"/api/artist-slugs/{artist}/page?top_tracks_count=50",
            1_000,
        ),
        RouteSpec(
            "artist-top-tracks",
            f"/api/artist-slugs/{artist}/top-tracks?count=50",
            1_000,
        ),
        RouteSpec(
            "catalog-search",
            f"/api/catalog/search?q={search}&limit=50",
            1_500,
        ),
        RouteSpec("followed-artists", "/api/catalog/me/artists", 1_000),
        RouteSpec("saved-albums", "/api/catalog/me/albums", 1_000),
        RouteSpec("history", "/api/me/history?limit=50", 1_000),
        RouteSpec("jam-rooms", "/api/jam/rooms", 1_000),
    )


def _percentile(values: Sequence[float], percentile: float) -> float:
    ordered = sorted(values)
    if not ordered:
        raise ValueError("at least one sample is required")
    index = max(0, math.ceil(len(ordered) * percentile) - 1)
    return ordered[index]


def aggregate_samples(spec: RouteSpec, samples: Sequence[ProbeSample]) -> RouteResult:
    if not samples:
        raise ValueError("at least one sample is required")
    elapsed = [sample.elapsed_ms for sample in samples]
    errors = tuple(dict.fromkeys(sample.error for sample in samples if sample.error))
    source = next(
        (sample.source for sample in reversed(samples) if sample.source), None
    )
    return RouteResult(
        name=spec.name,
        path=spec.path,
        status=samples[-1].status,
        median_ms=round(statistics.median(elapsed), 1),
        p95_ms=round(_percentile(elapsed, 0.95), 1),
        max_ms=round(max(elapsed), 1),
        size_bytes=samples[-1].size_bytes,
        source=source,
        p95_budget_ms=spec.p95_budget_ms,
        errors=errors,
    )


def evaluate_results(results: Sequence[RouteResult], *, enforce_slo: bool) -> Verdict:
    failures: list[str] = []
    for result in results:
        if result.status < 200 or result.status >= 300:
            detail = f" ({result.errors[0]})" if result.errors else ""
            failures.append(f"{result.name}: HTTP {result.status}{detail}")
            continue
        if result.errors:
            failures.append(f"{result.name}: {result.errors[0]}")
            continue
        if enforce_slo and result.p95_ms > result.p95_budget_ms:
            failures.append(
                f"{result.name}: p95 {result.p95_ms:.1f} ms exceeds "
                f"{result.p95_budget_ms} ms"
            )
    return Verdict(ok=not failures, failures=tuple(failures))


def _error_detail(payload: bytes) -> str | None:
    if not payload:
        return None
    try:
        parsed = json.loads(payload)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return payload.decode("utf-8", "replace").strip()[:160] or None
    if isinstance(parsed, dict):
        value = parsed.get("detail") or parsed.get("error")
        return str(value)[:160] if value else None
    return None


def request_once(
    *,
    base_url: str,
    spec: RouteSpec,
    token: str,
    timeout_seconds: float,
    ssl_context: ssl.SSLContext | None,
) -> ProbeSample:
    request = urllib.request.Request(
        base_url.rstrip("/") + spec.path,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "crate-listen-response-profile/1.0",
        },
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(
            request, timeout=timeout_seconds, context=ssl_context
        ) as response:
            payload = response.read()
            return ProbeSample(
                status=response.status,
                elapsed_ms=(time.perf_counter() - started) * 1_000,
                size_bytes=len(payload),
                source=response.headers.get("X-Crate-Readplane"),
            )
    except urllib.error.HTTPError as exc:
        payload = exc.read(2_048)
        return ProbeSample(
            status=exc.code,
            elapsed_ms=(time.perf_counter() - started) * 1_000,
            size_bytes=len(payload),
            source=exc.headers.get("X-Crate-Readplane"),
            error=_error_detail(payload),
        )
    except (OSError, TimeoutError) as exc:
        return ProbeSample(
            status=0,
            elapsed_ms=(time.perf_counter() - started) * 1_000,
            size_bytes=0,
            source=None,
            error=str(exc),
        )


def login(
    *,
    base_url: str,
    email: str,
    password: str,
    timeout_seconds: float,
    ssl_context: ssl.SSLContext | None,
) -> str:
    request = urllib.request.Request(
        base_url.rstrip("/") + "/api/auth/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "crate-listen-response-profile/1.0",
        },
    )
    try:
        with urllib.request.urlopen(
            request, timeout=timeout_seconds, context=ssl_context
        ) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        detail = _error_detail(exc.read(2_048)) or "login failed"
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    token = payload.get("token") if isinstance(payload, dict) else None
    if not token:
        raise RuntimeError("login response did not include a bearer token")
    return str(token)


def run_profile(
    *,
    base_url: str,
    specs: Sequence[RouteSpec],
    token: str,
    samples: int,
    warmups: int,
    timeout_seconds: float,
    ssl_context: ssl.SSLContext | None,
) -> list[RouteResult]:
    results: list[RouteResult] = []
    for spec in specs:
        for _ in range(warmups):
            request_once(
                base_url=base_url,
                spec=spec,
                token=token,
                timeout_seconds=timeout_seconds,
                ssl_context=ssl_context,
            )
        measured = [
            request_once(
                base_url=base_url,
                spec=spec,
                token=token,
                timeout_seconds=timeout_seconds,
                ssl_context=ssl_context,
            )
            for _ in range(samples)
        ]
        results.append(aggregate_samples(spec, measured))
    return results


def _print_results(results: Sequence[RouteResult], verdict: Verdict) -> None:
    print(
        f"{'route':28} {'http':>4} {'median':>9} {'p95':>9} "
        f"{'max':>9} {'KiB':>8} {'source':>9}"
    )
    for result in results:
        print(
            f"{result.name:28} {result.status:>4} "
            f"{result.median_ms:>8.1f}ms {result.p95_ms:>8.1f}ms "
            f"{result.max_ms:>8.1f}ms {result.size_bytes / 1024:>8.1f} "
            f"{result.source or '-':>9}"
        )
    if verdict.ok:
        print("\nListen response profile: PASS")
    else:
        print("\nListen response profile: FAIL")
        for failure in verdict.failures:
            print(f"- {failure}")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        default=os.getenv("CRATE_RESPONSE_BASE_URL", "http://localhost:8585"),
    )
    parser.add_argument("--token", default=os.getenv("CRATE_RESPONSE_TOKEN", ""))
    parser.add_argument("--email", default=os.getenv("CRATE_RESPONSE_EMAIL", ""))
    parser.add_argument("--password", default=os.getenv("CRATE_RESPONSE_PASSWORD", ""))
    parser.add_argument("--artist-slug", default="pantera")
    parser.add_argument("--genre-slug", default="death-metal")
    parser.add_argument("--samples", type=int, default=5)
    parser.add_argument("--warmups", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=20)
    parser.add_argument(
        "--output", default=".artifacts/benchmarks/listen-response.json"
    )
    parser.add_argument(
        "--report-only",
        action="store_true",
        help="report slow routes without failing their p95 budgets",
    )
    parser.add_argument("--skip-tls-verify", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.samples < 1:
        raise SystemExit("--samples must be at least 1")
    if args.warmups < 0:
        raise SystemExit("--warmups cannot be negative")
    ssl_context = ssl._create_unverified_context() if args.skip_tls_verify else None
    token = args.token.strip()
    if not token:
        if not args.email or not args.password:
            raise SystemExit(
                "set CRATE_RESPONSE_TOKEN or both CRATE_RESPONSE_EMAIL and "
                "CRATE_RESPONSE_PASSWORD"
            )
        try:
            token = login(
                base_url=args.base_url,
                email=args.email,
                password=args.password,
                timeout_seconds=args.timeout,
                ssl_context=ssl_context,
            )
        except RuntimeError as exc:
            raise SystemExit(f"authentication failed: {exc}") from exc
    specs = build_route_specs(artist_slug=args.artist_slug, genre_slug=args.genre_slug)
    results = run_profile(
        base_url=args.base_url,
        specs=specs,
        token=token,
        samples=args.samples,
        warmups=args.warmups,
        timeout_seconds=args.timeout,
        ssl_context=ssl_context,
    )
    enforce_slo = not args.report_only
    verdict = evaluate_results(results, enforce_slo=enforce_slo)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(
            {
                "base_url": args.base_url,
                "samples": args.samples,
                "warmups": args.warmups,
                "enforce_slo": enforce_slo,
                "ok": verdict.ok,
                "failures": verdict.failures,
                "routes": [asdict(result) for result in results],
            },
            indent=2,
        )
        + "\n"
    )
    _print_results(results, verdict)
    print(f"JSON: {output_path}")
    return 0 if verdict.ok else 1


if __name__ == "__main__":
    sys.exit(main())
