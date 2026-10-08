import re
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]


def _build_arg_value(args: object, name: str) -> str | None:
    if isinstance(args, dict):
        value = args.get(name)
        return value if isinstance(value, str) else None
    if isinstance(args, list):
        prefix = f"{name}="
        return next(
            (
                entry.removeprefix(prefix)
                for entry in args
                if isinstance(entry, str) and entry.startswith(prefix)
            ),
            None,
        )
    return None


def test_admin_vite_loads_environment_from_repository_root() -> None:
    config = (ROOT / "app/ui/vite.config.ts").read_text()

    assert re.search(
        r'envDir:\s*path\.resolve\(__dirname,\s*["\']\.\./\.\.["\']\)',
        config,
    )


def test_admin_image_exposes_carto_key_to_vite_build() -> None:
    dockerfile = (ROOT / "app/ui/Dockerfile").read_text()

    assert re.search(r"^ARG VITE_CARTO_API_KEY=$", dockerfile, re.MULTILINE)
    assert re.search(
        r"^\s*VITE_CARTO_API_KEY=\$VITE_CARTO_API_KEY(?:\s+\\)?$",
        dockerfile,
        re.MULTILINE,
    )


def test_admin_image_workflow_passes_carto_repository_variable() -> None:
    workflow = yaml.safe_load((ROOT / ".github/workflows/build-images.yml").read_text())
    build_step = next(
        step
        for step in workflow["jobs"]["build-ui"]["steps"]
        if step.get("id") == "build"
    )

    assert (
        "VITE_CARTO_API_KEY=${{ vars.VITE_CARTO_API_KEY }}"
        in build_step["with"]["build-args"]
    )


def test_admin_compose_build_passes_carto_key_as_build_arg() -> None:
    compose = yaml.safe_load((ROOT / "docker-compose.yaml").read_text())
    build_args = compose["services"]["crate-ui"]["build"].get("args")

    assert _build_arg_value(build_args, "VITE_CARTO_API_KEY") == (
        "${VITE_CARTO_API_KEY:-}"
    )
