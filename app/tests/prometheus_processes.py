from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path

APP = Path(__file__).resolve().parents[1]

COLLECT = """
import json
from prometheus_client import CollectorRegistry
from prometheus_client.multiprocess import MultiProcessCollector

registry = CollectorRegistry(auto_describe=False)
MultiProcessCollector(registry)
samples = {}
for family in registry.collect():
    for sample in family.samples:
        key = sample.name + json.dumps(sample.labels, sort_keys=True)
        samples[key] = sample.value
print(json.dumps(samples))
"""


def child_env(directory: Path | None, **extra: str) -> dict[str, str]:
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in {"PROMETHEUS_MULTIPROC_DIR", "CRATE_PROMETHEUS_METRICS"}
    }
    env["PYTHONPATH"] = os.pathsep.join(path for path in sys.path if path)
    if directory is not None:
        env["PROMETHEUS_MULTIPROC_DIR"] = str(directory)
        env["CRATE_PROMETHEUS_METRICS"] = "1"
    env.update(extra)
    return env


def run_child(
    code: str, directory: Path | None, **extra: str
) -> subprocess.CompletedProcess:
    result = subprocess.run(
        [sys.executable, "-c", textwrap.dedent(code)],
        cwd=APP,
        env=child_env(directory, **extra),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    return result


def collect(directory: Path) -> dict[str, float]:
    return json.loads(run_child(COLLECT, directory).stdout)


def record_script(*observations: tuple[str, float, dict], exit_hard=False) -> str:
    lines = [
        "import os",
        "print(os.getpid(), flush=True)",
        "from crate.observability import prometheus",
        "from crate.observability.metric_catalog import canonical_metric",
    ]
    for name, value, tags in observations:
        lines.append(
            "prometheus.observe("
            f"canonical_metric({name!r}, {tags!r}), "
            f"{value!r} * canonical_metric({name!r}).definition.scale)"
        )
    if exit_hard:
        lines.append("os._exit(0)")
    return "\n".join(lines)
