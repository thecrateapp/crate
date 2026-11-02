from __future__ import annotations

import ast
from pathlib import Path
import re

import pytest

from crate.observability.http_metric_routes import HTTP_ROUTES
from crate.observability.metric_catalog import get_metric_definition


@pytest.mark.filterwarnings("ignore:Duplicate Operation ID.*:UserWarning")
def test_catalogue_covers_documented_http_route_templates(test_app):
    routes = {
        re.sub(r"\{[^{}]+\}", ":param", path)
        for path in test_app.app.openapi()["paths"]
        if path.startswith(("/api/", "/rest/"))
    }
    assert routes
    assert routes <= HTTP_ROUTES, sorted(routes - HTTP_ROUTES)


PRODUCERS = {
    "record",
    "record_later",
    "record_counter",
    "record_counter_later",
    "record_federation_metric",
}


def _producer_names(tree: ast.AST) -> list[tuple[int, str]]:
    """Literal or constant metric names passed to producers imported anywhere."""
    aliases, modules, constants = set(), set(), {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "crate.metrics":
            aliases.update(
                item.asname or item.name
                for item in node.names
                if item.name in PRODUCERS
            )
        if isinstance(node, ast.ImportFrom) and node.module == "crate":
            modules.update(
                item.asname or item.name
                for item in node.names
                if item.name == "metrics"
            )
        if isinstance(node, ast.Import):
            modules.update(
                item.asname or item.name
                for item in node.names
                if item.name == "crate.metrics"
            )
        if (
            isinstance(node, ast.Assign)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        ):
            constants.update(
                {
                    target.id: node.value.value
                    for target in node.targets
                    if isinstance(target, ast.Name)
                }
            )
    names = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not node.args:
            continue
        direct = isinstance(node.func, ast.Name) and node.func.id in aliases
        qualified = (
            isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id in modules
            and node.func.attr in PRODUCERS
        )
        if not direct and not qualified:
            continue
        argument = node.args[0]
        name = (
            argument.value
            if isinstance(argument, ast.Constant)
            else constants.get(argument.id)
            if isinstance(argument, ast.Name)
            else None
        )
        if isinstance(name, str):
            names.append((node.lineno, name))
    return names


def test_producer_scan_includes_imports_inside_functions():
    source = """
def handler():
    from crate.metrics import record_counter as count
    count("api.not.catalogued")

def other():
    from crate import metrics as m
    m.record("worker.not.catalogued", 1.0)
"""

    names = {name for _line, name in _producer_names(ast.parse(source))}

    assert names == {"api.not.catalogued", "worker.not.catalogued"}


def test_catalogue_covers_literal_and_constant_python_producers():
    missing, checked = [], set()
    for path in (Path(__file__).parents[1] / "crate").rglob("*.py"):
        for line, name in _producer_names(ast.parse(path.read_text())):
            checked.add(name)
            try:
                get_metric_definition(name)
            except ValueError:
                missing.append(
                    f"{path.relative_to(Path(__file__).parents[1])}:{line}: {name}"
                )
    assert len(checked) >= 40
    assert not missing, "\n".join(missing)
