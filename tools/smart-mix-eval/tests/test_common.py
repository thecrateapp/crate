from __future__ import annotations

from pathlib import Path

import pytest

from common import (
    REPO_ROOT,
    UnsafeDatabaseError,
    database_environment,
    describe_database,
    display_path,
    read_jsonl,
    write_jsonl,
)


def test_database_environment_accepts_loopback_and_refuses_remote() -> None:
    environment = database_environment("postgresql://crate:secret@localhost:5433/crate")

    assert environment == {
        "CRATE_POSTGRES_USER": "crate",
        "CRATE_POSTGRES_PASSWORD": "secret",
        "CRATE_POSTGRES_HOST": "localhost",
        "CRATE_POSTGRES_PORT": "5433",
        "CRATE_POSTGRES_DB": "crate",
    }
    with pytest.raises(UnsafeDatabaseError, match="not on this machine"):
        database_environment("postgresql://crate:secret@95.216.3.27:5432/crate")
    with pytest.raises(UnsafeDatabaseError, match="postgresql://"):
        database_environment("mysql://localhost/crate")
    with pytest.raises(UnsafeDatabaseError, match="name a database"):
        database_environment("postgresql://localhost:5433/")
    assert (
        database_environment(
            "postgresql://crate:x@db.internal/crate", allow_remote=True
        )["CRATE_POSTGRES_HOST"]
        == "db.internal"
    )


def test_describe_database_leaves_credentials_out() -> None:
    environment = database_environment("postgresql://crate:secret@127.0.0.1/crate")

    assert describe_database(environment) == {
        "host": "127.0.0.1",
        "port": "5432",
        "database": "crate",
    }


def test_display_path_is_relative_to_the_repository(tmp_path: Path) -> None:
    inside = REPO_ROOT / "tools" / "smart-mix-eval" / "README.md"

    assert display_path(inside) == "tools/smart-mix-eval/README.md"
    assert display_path(tmp_path / "x.jsonl") == str(tmp_path / "x.jsonl")


def test_jsonl_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "rows.jsonl"
    rows = [{"b": 1, "a": "x"}, {"a": "y"}]

    write_jsonl(path, rows)

    assert read_jsonl(path) == rows
    assert path.read_text().splitlines()[0] == '{"a": "x", "b": 1}'
