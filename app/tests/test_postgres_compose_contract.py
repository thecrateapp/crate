"""PostgreSQL on the project server has room for the shared memory of parallel queries."""

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def test_project_postgres_gets_more_shared_memory_than_the_docker_default():
    # Parallel queries keep dynamic shared memory in /dev/shm. With Docker's
    # 64 MB default, the Smart Mix coverage aggregate failed with "could not
    # resize shared memory segment" and stopped the v8 backfill (2026-11-09).
    services = yaml.safe_load((ROOT / "docker-compose.project.yaml").read_text())[
        "services"
    ]

    assert services["crate-postgres"]["shm_size"] == "1g"
