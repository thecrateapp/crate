"""Real PostgreSQL fixtures for the bounded agent command contract."""

from datetime import UTC, datetime, timedelta

import pytest
from crate.agent_access import ALLOWED_GRANTS
from crate.artist_photo import observe_artist_photo
from crate.db.repositories import agent_requests as requests
from crate.db.repositories.agent_credentials import create_credential
from crate.db.repositories.agent_repair_plans import preview_repair
from crate.db.repositories.tasks_updates import start_task
from crate.db.tx import read_scope, transaction_scope
from sqlalchemy import text

UID = "10000000-0000-0000-0000-000000000001"
OTHER_UID = "10000000-0000-0000-0000-000000000002"


@pytest.fixture
def command_world(pg_db, tmp_path, monkeypatch):
    from crate.db.repositories import tasks_mutations, tasks_shared

    dispatched = []
    monkeypatch.setattr(
        tasks_mutations,
        "dispatch_task",
        lambda kind, job: dispatched.append((kind, job)),
    )
    monkeypatch.setattr(tasks_shared, "publish_tasks_surface_signal", lambda: None)
    with transaction_scope() as session:
        session.execute(
            text("""
            INSERT INTO library_artists (name, entity_uid, folder_name, has_photo)
            VALUES ('Echo', :uid, 'echo', 0), ('Other', :other, 'other', 0)
        """),
            {"uid": UID, "other": OTHER_UID},
        )
    folder = tmp_path / "echo"
    folder.mkdir()
    (folder / "artist.jpg").write_bytes(b"photo")
    (tmp_path / "other").mkdir()
    issued = create_credential(
        "Command agent", ALLOWED_GRANTS, datetime.now(UTC) + timedelta(days=1)
    )
    return {
        "principal": issued.principal,
        "token": issued.token,
        "config": {"library_path": str(tmp_path)},
        "dispatched": dispatched,
        "folder": folder,
    }


def other_principal():
    return create_credential(
        "Second agent", ALLOWED_GRANTS, datetime.now(UTC) + timedelta(days=1)
    ).principal


def observed_plan(world):
    job = requests.accept_health_check(world["principal"], UID, "health")
    start_task(job["job_id"])
    result = requests.record_photo_observation(
        job["job_id"], observe_artist_photo(world["config"], UID)
    )
    plan = preview_repair(world["principal"], result["execution"]["issue_id"])
    return job, plan


def scalar(sql, values=None):
    with read_scope() as session:
        return session.execute(text(sql), values or {}).scalar_one()


def change(sql, values=None):
    with transaction_scope() as session:
        session.execute(text(sql), values or {})
