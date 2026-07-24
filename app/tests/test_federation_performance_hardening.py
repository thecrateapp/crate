from __future__ import annotations

import ast
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def _environment_keys(environment: dict[str, object] | list[str]) -> set[str]:
    if isinstance(environment, dict):
        return set(environment)
    return {entry.split("=", 1)[0] for entry in environment}


def test_global_catalog_casefold_lookup_indexes_are_migrated() -> None:
    migration = (
        ROOT / "app/crate/db/migrations/versions/075_global_catalog_lookup_indexes.py"
    ).read_text()

    assert 'revision = "075"' in migration
    assert 'down_revision = "074"' in migration
    assert "LOWER(canonical_name)" in migration
    assert "LOWER(artist_name), LOWER(canonical_name)" in migration


def test_materialized_search_preserves_kind_rank_in_both_read_planes() -> None:
    python_source = (ROOT / "app/crate/db/queries/global_catalog.py").read_text()
    go_source = (ROOT / "app/readplane/internal/catalog/global_store.go").read_text()

    expected = "ORDER BY projection_row, entity_type, kind_rank"
    assert expected in python_source
    assert expected in go_source


def test_home_rebuild_fetches_the_global_track_pool_once() -> None:
    source = (ROOT / "app/crate/db/home_personalized_discovery.py").read_text()
    module = ast.parse(source)
    function = next(
        node
        for node in module.body
        if isinstance(node, ast.FunctionDef)
        and node.name == "build_home_discovery_payload"
    )
    pool_calls = [
        node
        for node in ast.walk(function)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "_global_home_track_rows"
    ]
    recommended_call = next(
        node
        for node in ast.walk(function)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "_build_home_recommended_tracks"
    )

    assert len(pool_calls) == 1
    assert any(
        keyword.arg == "global_track_rows" for keyword in recommended_call.keywords
    )


def test_readplane_operational_thresholds_are_exposed_in_every_runtime() -> None:
    required = {
        "READPLANE_STATS_SNAPSHOT_MAX_AGE_SECONDS",
        "READPLANE_STATS_STALE_MAX_AGE_SECONDS",
        "READPLANE_SESSION_TOUCH_INTERVAL_SECONDS",
    }
    env_example = (ROOT / ".env.example").read_text()
    assert all(f"{key}=" in env_example for key in required)

    runtimes = {
        "docker-compose.yaml": ("crate-readplane",),
        "docker-compose.home.yaml": ("crate-readplane",),
        "docker-compose.readplane.dev.yaml": ("readplane",),
        "docker-compose.federation-dev.yaml": (
            "node-a-readplane",
            "node-b-readplane",
        ),
    }
    for compose_name, service_names in runtimes.items():
        compose = yaml.safe_load((ROOT / compose_name).read_text())
        for service_name in service_names:
            environment = compose["services"][service_name]["environment"]
            assert required <= _environment_keys(environment), (
                f"{compose_name}:{service_name} does not expose all readplane "
                "operational thresholds"
            )
