import json
from pathlib import Path

from crate.api.subsonic import create_subsonic_router
from crate.subsonic.capabilities import advertised_extensions


_DOC_PATH = Path(__file__).parents[2] / "docs" / "technical" / "opensubsonic.md"


def _marked_table(document: str, name: str) -> str:
    start = f"<!-- {name}:start -->"
    end = f"<!-- {name}:end -->"
    return document.split(start, 1)[1].split(end, 1)[0].strip()


def _endpoint_table() -> str:
    operations: dict[str, set[str]] = {}
    for route in create_subsonic_router("v1").routes:
        path = str(getattr(route, "path", ""))
        if not path.startswith("/rest/"):
            continue
        operation = path.removeprefix("/rest/").removesuffix(".view")
        methods = set(getattr(route, "methods", ()) or ()) & {"GET", "POST"}
        operations.setdefault(operation, set()).update(methods)

    rows = [
        (f"`{operation}`", ", ".join(sorted(methods)))
        for operation, methods in sorted(operations.items())
    ]
    operation_width = max(len("Operation"), *(len(operation) for operation, _ in rows))
    methods_width = max(len("Methods"), *(len(methods) for _, methods in rows))
    return "\n".join(
        [
            f"| {'Operation':<{operation_width}} | {'Methods':<{methods_width}} |",
            f"| {'-' * operation_width} | {'-' * methods_width} |",
            *[
                f"| {operation:<{operation_width}} | {methods:<{methods_width}} |"
                for operation, methods in rows
            ],
        ]
    )


def _extension_table() -> str:
    rows = [
        (f"`{extension['name']}`", ", ".join(map(str, extension["versions"])))
        for extension in advertised_extensions()
    ]
    extension_width = max(len("Extension"), *(len(name) for name, _ in rows))
    versions_width = max(len("Versions"), *(len(versions) for _, versions in rows))
    return "\n".join(
        [
            f"| {'Extension':<{extension_width}} | {'Versions':<{versions_width}} |",
            f"| {'-' * extension_width} | {'-' * versions_width} |",
            *[
                f"| {name:<{extension_width}} | {versions:<{versions_width}} |"
                for name, versions in rows
            ],
        ]
    )


def test_documented_v1_endpoints_match_the_registered_router() -> None:
    document = _DOC_PATH.read_text()

    assert _marked_table(document, "opensubsonic-endpoints") == _endpoint_table()


def test_documented_extensions_match_the_capability_registry() -> None:
    document = _DOC_PATH.read_text()

    assert _marked_table(document, "opensubsonic-extensions") == _extension_table()


def test_opensubsonic_contract_is_registered_in_the_docs_site() -> None:
    repo_root = Path(__file__).parents[2]
    manifest = json.loads((repo_root / "docs" / "manifest.json").read_text())
    source_path = "docs/technical/opensubsonic.md"

    assert any(entry["sourcePath"] == source_path for entry in manifest)
    content_module = (repo_root / "app" / "docs" / "src" / "content.ts").read_text()
    assert f'"{source_path}":' in content_module
