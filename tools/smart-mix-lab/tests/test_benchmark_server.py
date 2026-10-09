from __future__ import annotations

import pytest

from benchmark_server import (
    UnsafeDatabaseError,
    check_isolated_dsn,
    measure,
    percentile,
    summarize,
)


@pytest.mark.parametrize(
    "dsn",
    [
        "postgresql://crate:crate@crate-postgres:5432/crate",
        "postgresql://crate:crate@localhost:5432/crate",
        "postgresql://crate:crate@95.216.3.27:5432/crate_test",
        "mysql://crate@localhost/crate_test",
    ],
)
def test_production_looking_databases_are_refused(dsn: str) -> None:
    with pytest.raises(UnsafeDatabaseError):
        check_isolated_dsn(dsn)


def test_loopback_test_database_is_accepted() -> None:
    env = check_isolated_dsn("postgresql://crate:secret@127.0.0.1:55432/crate_test")

    assert env == {
        "CRATE_POSTGRES_USER": "crate",
        "CRATE_POSTGRES_PASSWORD": "secret",
        "CRATE_POSTGRES_HOST": "127.0.0.1",
        "CRATE_POSTGRES_PORT": "55432",
        "CRATE_POSTGRES_DB": "crate_test",
    }


def test_explicit_override_allows_another_isolated_host() -> None:
    env = check_isolated_dsn(
        "postgresql://crate:crate@bench-db:5432/crate", allow_non_test=True
    )

    assert env["CRATE_POSTGRES_HOST"] == "bench-db"


def test_percentiles_use_nearest_rank() -> None:
    samples = [float(value) for value in range(1, 101)]

    assert percentile(samples, 0.5) == 51.0
    assert percentile(samples, 0.95) == 95.0
    assert summarize(samples)["samples"] == 100


def test_measure_runs_warmup_outside_the_samples() -> None:
    calls: list[int] = []

    samples = measure(calls.append, warmup=3, iterations=5, concurrency=2)

    assert len(samples) == 5
    assert sorted(calls) == list(range(8))
