from tests.load.listen_response_profile import (
    ProbeSample,
    RouteSpec,
    aggregate_samples,
    build_route_specs,
    evaluate_results,
)


def test_build_route_specs_covers_listen_primary_read_surfaces():
    specs = build_route_specs(artist_slug="pantera", genre_slug="death-metal")

    assert {spec.name for spec in specs} == {
        "home",
        "home-recently-played",
        "home-custom-mixes",
        "home-suggested-albums",
        "home-recommended-tracks",
        "home-radio-stations",
        "home-favorite-artists",
        "home-core-tracks",
        "stats",
        "genres",
        "genre-detail",
        "artist-page",
        "artist-top-tracks",
        "catalog-search",
        "followed-artists",
        "saved-albums",
        "history",
        "jam-rooms",
    }
    assert all(spec.path.startswith("/api/") for spec in specs)
    assert next(spec for spec in specs if spec.name == "artist-page").path.startswith(
        "/api/artist-slugs/pantera/page"
    )
    assert next(spec for spec in specs if spec.name == "genre-detail").path.startswith(
        "/api/genres/death-metal"
    )


def test_aggregate_samples_reports_nearest_rank_p95_and_readplane_source():
    spec = RouteSpec("home", "/api/me/home/discovery", 500)
    samples = [
        ProbeSample(status=200, elapsed_ms=value, size_bytes=1024, source="hit")
        for value in (10, 20, 30, 40, 50)
    ]

    result = aggregate_samples(spec, samples)

    assert result.median_ms == 30
    assert result.p95_ms == 50
    assert result.max_ms == 50
    assert result.status == 200
    assert result.size_bytes == 1024
    assert result.source == "hit"
    assert result.errors == ()


def test_evaluate_results_fails_http_errors_and_slow_p95():
    fast = aggregate_samples(
        RouteSpec("home", "/api/me/home/discovery", 500),
        [ProbeSample(200, 100, 42, "hit")],
    )
    slow = aggregate_samples(
        RouteSpec("search", "/api/catalog/search?q=x", 500),
        [ProbeSample(200, 501, 42, "hit")],
    )
    failed = aggregate_samples(
        RouteSpec("history", "/api/me/history", 500),
        [ProbeSample(503, 12, 20, None, "catalog_warming")],
    )

    verdict = evaluate_results([fast, slow, failed], enforce_slo=True)

    assert verdict.ok is False
    assert verdict.failures == (
        "search: p95 501.0 ms exceeds 500 ms",
        "history: HTTP 503 (catalog_warming)",
    )


def test_evaluate_results_can_report_latency_without_enforcing_slo():
    slow = aggregate_samples(
        RouteSpec("search", "/api/catalog/search?q=x", 100),
        [ProbeSample(200, 500, 42, "hit")],
    )

    verdict = evaluate_results([slow], enforce_slo=False)

    assert verdict.ok is True
    assert verdict.failures == ()
