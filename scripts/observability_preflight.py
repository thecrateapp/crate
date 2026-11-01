#!/usr/bin/env python3
"""Validate explicit monitoring settings without reading the application .env."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

REQUIRED = ("OBS_DATA_DIR", "OBS_SECRETS_DIR", "OBS_APP_NETWORK", "CRATE_POSTGRES_DB")


def validate_start_environment(environment: dict[str, str], *, initialize_empty=False):
    missing = [name for name in REQUIRED if not environment.get(name, "").strip()]
    if missing:
        raise ValueError("Set explicit monitoring settings: " + ", ".join(missing))
    for name in ("OBS_DATA_DIR", "OBS_SECRETS_DIR"):
        if not Path(environment[name]).is_absolute() or Path(environment[name]) == Path(
            "/"
        ):
            raise ValueError(f"{name} must be an absolute non-root directory")
    root = Path(environment["OBS_DATA_DIR"])
    for name in ("prometheus", "grafana"):
        directory = root / name
        if not directory.is_dir():
            raise ValueError("Prepare both monitoring data directories before startup")
        if not initialize_empty:
            try:
                with os.scandir(directory) as entries:
                    empty = next(entries, None) is None
            except OSError as error:
                raise ValueError(
                    "Cannot inspect existing monitoring storage with this account"
                ) from error
            if empty:
                raise ValueError(
                    "Empty monitoring storage: preserve the old OBS_DATA_DIR, or explicitly use OBS_INITIALIZE_EMPTY=1 for a new installation"
                )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", required=True, type=Path)
    parser.add_argument("--project-dir", required=True, type=Path)
    parser.add_argument("--initialize-empty", action="store_true")
    parser.add_argument("compose", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    try:
        if args.env_file.resolve() == (args.project_dir / ".env").resolve():
            raise ValueError(
                "Use a dedicated monitoring environment, not the application .env"
            )
        command = args.compose[1:] if args.compose[:1] == ["--"] else args.compose
        if not command:
            raise ValueError("Missing monitoring Compose command")
        result = subprocess.run(
            [*command, "config", "--environment"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode:
            raise ValueError("Cannot resolve the monitoring environment")
        environment = {}
        for line in result.stdout.splitlines():
            key, separator, value = line.partition("=")
            if separator and key in REQUIRED:
                environment[key] = value
        validate_start_environment(environment, initialize_empty=args.initialize_empty)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(f"Monitoring preflight rejected: {error}", file=sys.stderr)
        return 1
    print("Monitoring preflight passed; explicit settings and storage checked")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
