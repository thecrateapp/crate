"""Portable plans keep metadata imports and private export downloads bounded."""

from __future__ import annotations

import hashlib
import json
import os
import zipfile
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from starlette.applications import Starlette
from starlette.routing import Route

from crate import agent_library_operations as operations
from crate import agent_portability as portable
from crate.agent_access import ALLOWED_GRANTS, generate_token
from crate.agent_diagnostics import DiagnosticError
from crate.db.engine import get_engine
from crate.db.repositories.agent_artifacts import get_owned_artifact, register_artifact
from crate.db.repositories.agent_credentials import create_credential, revoke_credential
from crate.db.repositories.agent_metadata import metadata_state_version
from crate.db.repositories.agent_portability import (
    apply_portability_changes,
    read_portability_state,
)
from crate.db.repositories.field_locks import lock_fields
from crate.db.repositories.tasks_updates import start_task
from crate.db.tx import read_scope, transaction_scope
from crate.mcp.artifacts import ArtifactDownload

from tests.test_mcp_oauth_integration import _code, _exchange
from tests.test_mcp_oauth_integration import oauth_env as oauth_env  # noqa: PLC0414


def _authorize(effect=None):
    return effect() if effect is not None else None


@pytest.fixture
def portable_world(pg_db, tmp_path, monkeypatch):
    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_OAUTH_ENABLED", "false")
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: False)
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task", lambda *_: None
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks_shared.publish_tasks_surface_signal", lambda: None
    )
    library = tmp_path / "music"
    album = library / "Artist" / "Album"
    album.mkdir(parents=True)
    audio = album / "01.flac"
    audio.write_bytes(b"original audio bytes; exporting metadata must never open this")
    export = tmp_path / "exports"
    source = tmp_path / "imports"
    export.mkdir()
    source.mkdir()
    artist_uid, album_uid, track_uid = [str(uuid4()) for _ in range(3)]
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_artists(name,entity_uid) VALUES('Artist',CAST(:uid AS uuid))"
            ),
            {"uid": artist_uid},
        )
        album_id = session.execute(
            text(
                "INSERT INTO library_albums(artist,name,path,entity_uid,year,genre,updated_at) "
                "VALUES('Artist','Album',:path,CAST(:uid AS uuid),'1997',NULL,NOW()) RETURNING id"
            ),
            {"uid": album_uid, "path": str(album)},
        ).scalar_one()
        track_id = session.execute(
            text(
                "INSERT INTO library_tracks(album_id,artist,album,filename,title,path,entity_uid,year,track_number,bpm,updated_at) "
                "VALUES(:album,'Artist','Album','01.flac','Original title',:path,CAST(:uid AS uuid),'1997',1,123.0,NOW()) RETURNING id"
            ),
            {"uid": track_uid, "album": album_id, "path": str(audio)},
        ).scalar_one()
    issued = create_credential(
        "Portable agent", ALLOWED_GRANTS, datetime.now(UTC) + timedelta(days=1)
    )
    return {
        "artist_uid": artist_uid,
        "album_uid": album_uid,
        "album_id": album_id,
        "track_uid": track_uid,
        "track_id": track_id,
        "audio": audio,
        "export": export,
        "source": source,
        "principal": issued.principal,
        "token": issued.token,
        "config": {
            "library_path": str(library),
            "agent_metadata_presets": {
                "exports": {"root": str(export), "export": True},
                "imports": {"root": str(source), "rehydrate": True},
            },
        },
    }


def _payload(world, **overrides):
    return {
        "schema_version": 1,
        "album": {"entity_uid": world["album_uid"], "year": "2001", "genre": "ambient"},
        "tracks": [
            {
                "entity_uid": world["track_uid"],
                "relative_path": "01.flac",
                "title": "Imported title",
                "genre": "ambient",
                "track_number": 2,
                "bpm": 9.0,
            }
        ],
        **overrides,
    }


def _sidecar(world, payload=None):
    path = world["source"] / world["album_uid"] / ".crate" / "album.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload if payload is not None else _payload(world)))
    return path


def _compile_import(world, **overrides):
    return portable.compile_operation(
        "metadata_rehydrate",
        {
            "album_uids": [world["album_uid"]],
            "source_preset": "imports",
            **overrides,
        },
        world["config"],
    )


def _compile_export(world, **overrides):
    return portable.compile_operation(
        "metadata_export",
        {
            "album_uids": [world["album_uid"]],
            "destination_preset": "exports",
            **overrides,
        },
        world["config"],
    )


def _prepared(world, *, operation="metadata_export", key="prepare-export"):
    parameters = {
        "album_uids": [world["album_uid"]],
        "destination_preset"
        if operation == "metadata_export"
        else "source_preset": "exports"
        if operation == "metadata_export"
        else "imports",
    }
    accepted = operations.prepare_operation(
        world["principal"], operation, parameters, key
    )["data"]
    start_task(accepted["job_id"])
    result = operations.execute_operation_job(accepted["job_id"], world["config"])
    assert result["execution"]["status"] == "prepared", result
    return result["plan"]


def _run_export(world, *, before_effect=None):
    plan = _prepared(world)
    accepted = operations.apply_operation(
        world["principal"],
        "metadata_export",
        plan["plan_id"],
        plan["plan_version"],
        "apply-export",
    )["data"]
    start_task(accepted["job_id"])
    if before_effect:
        before_effect()
    result = operations.execute_operation_job(accepted["job_id"], world["config"])
    return accepted["job_id"], result


def _download_client(monkeypatch):
    monkeypatch.setattr("crate.mcp.artifacts.admission", lambda *_: nullcontext())
    monkeypatch.setenv("CRATE_MCP_ALLOWED_HOSTS", "localhost:8585")
    return TestClient(
        Starlette(
            routes=[
                Route(
                    "/mcp/artifacts/{artifact_id:uuid}",
                    ArtifactDownload(),
                    methods=["GET"],
                )
            ]
        ),
        base_url="http://localhost:8585",
    )


def test_export_roundtrip_contains_only_sidecars_and_stable_uids_and_replays_once(
    portable_world,
):
    world = portable_world
    audio_before = world["audio"].read_bytes()
    job, result = _run_export(world)
    assert result["execution"]["status"] == "completed", result
    assert result["verification"]["status"] == "passed"
    artifact = result["execution"]["artifacts"][0]
    record = get_owned_artifact(world["principal"], artifact["artifact_id"])
    archive_path = Path(record["path"])
    with zipfile.ZipFile(archive_path) as archive:
        assert archive.namelist() == [f"{world['album_uid']}/.crate/album.json"]
        payload = json.loads(archive.read(archive.namelist()[0]))
    assert payload["album"]["entity_uid"] == world["album_uid"]
    assert payload["tracks"][0]["entity_uid"] == world["track_uid"]
    assert payload["tracks"][0]["relative_path"] == "01.flac"
    assert "id" not in payload["album"]
    assert "path" not in payload["album"]
    assert "id" not in payload["tracks"][0]
    assert "path" not in payload["tracks"][0]
    assert payload["import_contract"]["computed_analysis"].startswith(
        "exported_evidence_only"
    )
    assert world["audio"].read_bytes() == audio_before
    assert not list(world["audio"].parent.glob(".crate/*"))
    raw = archive_path.read_bytes()
    assert record["sha256"] == artifact["sha256"] == hashlib.sha256(raw).hexdigest()
    assert record["byte_size"] == len(raw)
    assert archive_path.stat().st_mode & 0o777 == 0o600
    replay = operations.execute_operation_job(job, world["config"])
    assert replay == result
    assert archive_path.read_bytes() == raw
    with read_scope() as session:
        assert (
            session.execute(text("SELECT COUNT(*) FROM agent_artifacts")).scalar_one()
            == 1
        )


def test_export_refuses_existing_destination_without_overwriting(portable_world):
    world = portable_world
    plan = _compile_export(world)
    destination = world["export"] / plan["execution"]["export_id"]
    destination.mkdir()
    sentinel = destination / "metadata.zip"
    sentinel.write_bytes(b"existing unrelated archive")
    with pytest.raises(FileExistsError):
        portable.apply_operation(
            "metadata_export",
            plan["execution"],
            world["config"],
            task_id="job",
            authorize=_authorize,
        )
    assert sentinel.read_bytes() == b"existing unrelated archive"


def test_fill_missing_preserves_existing_values_and_imports_only_missing_fields(
    portable_world,
):
    world = portable_world
    sidecar = _sidecar(world)
    plan = _compile_import(world)
    assert plan["document"]["source_versions"]["sidecars"] == [
        {
            "album_uid": world["album_uid"],
            "sha256": hashlib.sha256(sidecar.read_bytes()).hexdigest(),
        }
    ]
    assert {change["field"] for change in plan["document"]["changes"]} == {"genre"}
    assert {conflict["field"] for conflict in plan["document"]["conflicts"]} == {
        "year",
        "title",
        "track_number",
    }
    audio_before = world["audio"].read_bytes()
    result = portable.apply_operation(
        "metadata_rehydrate",
        plan["execution"],
        world["config"],
        task_id="import-missing",
        authorize=_authorize,
    )
    assert result["execution"]["status"] == "completed"
    state = read_portability_state([world["album_uid"]])
    assert state["albums"][0]["year"] == "1997"
    assert state["albums"][0]["genre"] == "ambient"
    assert state["tracks"][0]["title"] == "Original title"
    assert state["tracks"][0]["genre"] == "ambient"
    assert state["tracks"][0]["bpm"] == 123
    assert world["audio"].read_bytes() == audio_before


def test_replace_unlocked_preserves_manual_locks_and_records_portable_import_provenance(
    portable_world,
):
    world = portable_world
    lock_fields(
        entity_type="track",
        entity_id=world["track_id"],
        field_names=["title"],
        source="manual_edit",
    )
    _sidecar(world)
    plan = _compile_import(world, conflict_policy="replace_unlocked")
    assert any(
        conflict["field"] == "title" and conflict["reason"] == "field_locked"
        for conflict in plan["document"]["conflicts"]
    )
    result = portable.apply_operation(
        "metadata_rehydrate",
        plan["execution"],
        world["config"],
        task_id="import-unlocked",
        authorize=_authorize,
    )
    assert result["verification"]["status"] == "passed"
    state = read_portability_state([world["album_uid"]])
    assert state["albums"][0]["year"] == "2001"
    assert state["tracks"][0]["track_number"] == 2
    assert state["tracks"][0]["title"] == "Original title"
    assert {(lock["field_name"], lock["source"]) for lock in state["locks"]} >= {
        ("title", "manual_edit"),
        ("genre", "portable_import"),
        ("year", "portable_import"),
    }
    with read_scope() as session:
        audit = session.execute(
            text("SELECT details_json FROM audit_log WHERE task_id='import-unlocked'")
        ).scalar_one()
        events = session.execute(
            text(
                "SELECT COUNT(*) FROM domain_event_outbox WHERE subject_key='portable_metadata'"
            )
        ).scalar_one()
        dirty = (
            session.execute(
                text("SELECT local_entity_uid::text FROM global_catalog_dirty_sources")
            )
            .scalars()
            .all()
        )
    assert audit["source"] == "portable_import"
    assert events == 1
    assert {world["album_uid"], world["track_uid"]} <= set(dirty)


@pytest.mark.parametrize(
    "mutation", ["database", "lock", "membership", "sidecar", "preset"]
)
def test_import_source_mutations_are_rejected_without_overwriting_current_metadata(
    portable_world, mutation
):
    world = portable_world
    sidecar = _sidecar(world)
    plan = _compile_import(world, conflict_policy="replace_unlocked")
    if mutation == "sidecar":
        payload = _payload(world)
        payload["tracks"][0]["title"] = "Different source"
        sidecar.write_text(json.dumps(payload))
    elif mutation == "preset":
        replacement = world["source"].parent / "different-imports"
        replacement.mkdir()
        world["config"]["agent_metadata_presets"]["imports"]["root"] = str(replacement)
    elif mutation == "lock":
        lock_fields(
            entity_type="track", entity_id=world["track_id"], field_names=["title"]
        )
    else:
        with transaction_scope() as session:
            if mutation == "database":
                session.execute(
                    text(
                        "UPDATE library_tracks SET title='Concurrent title' WHERE id=:id"
                    ),
                    {"id": world["track_id"]},
                )
            else:
                session.execute(
                    text(
                        "INSERT INTO library_tracks(album_id,artist,album,filename,path,entity_uid) VALUES(:album,'Artist','Album','02.flac',:path,gen_random_uuid())"
                    ),
                    {
                        "album": world["album_id"],
                        "path": str(world["audio"].with_name("02.flac")),
                    },
                )
    before = read_portability_state([world["album_uid"]])
    if mutation in {"sidecar", "preset"}:
        with pytest.raises(ValueError, match="changed"):
            portable.apply_operation(
                "metadata_rehydrate",
                plan["execution"],
                world["config"],
                task_id="stale",
                authorize=_authorize,
            )
    else:
        result = portable.apply_operation(
            "metadata_rehydrate",
            plan["execution"],
            world["config"],
            task_id="stale",
            authorize=_authorize,
        )
        assert result["execution"]["status"] == "conflict"
    assert read_portability_state([world["album_uid"]]) == before


@pytest.mark.parametrize(
    "field,value",
    [
        ("relative_path", "../escape.flac"),
        ("filename", "/private/escape.flac"),
        ("relative_path", "..\\escape.flac"),
        ("relative_path", "disc/../../escape.flac"),
    ],
)
def test_import_rejects_traversal_paths(portable_world, field, value):
    world = portable_world
    payload = _payload(world)
    payload["tracks"][0].pop("relative_path", None)
    payload["tracks"][0][field] = value
    _sidecar(world, payload)
    with pytest.raises(ValueError):
        _compile_import(world)


@pytest.mark.parametrize("kind", ["sidecar", "directory", "fifo", "oversize", "nan"])
def test_import_rejects_unsafe_or_unbounded_sources(portable_world, kind):
    world = portable_world
    sidecar = _sidecar(world)
    if kind in {"sidecar", "directory"}:
        outside = world["source"].parent / "outside"
        outside.mkdir()
        external = outside / "album.json"
        external.write_bytes(sidecar.read_bytes())
        sidecar.unlink()
        if kind == "sidecar":
            sidecar.symlink_to(external)
        else:
            sidecar.parent.rmdir()
            sidecar.parent.symlink_to(outside, target_is_directory=True)
    elif kind == "fifo":
        sidecar.unlink()
        os.mkfifo(sidecar)
    elif kind == "oversize":
        with sidecar.open("wb") as source:
            source.truncate(portable.MAX_ARTIFACT_BYTES + 1)
    else:
        payload = _payload(world)
        payload["tracks"][0]["bpm"] = float("nan")
        sidecar.write_text(json.dumps(payload))
    with pytest.raises((OSError, ValueError)):
        _compile_import(world)


@pytest.mark.parametrize(
    "mutation", ["wrong_album", "foreign_track", "duplicate_track"]
)
def test_import_uses_stable_local_uid_membership(portable_world, mutation):
    world = portable_world
    payload = _payload(world)
    if mutation == "wrong_album":
        payload["album"]["entity_uid"] = str(uuid4())
    elif mutation == "foreign_track":
        payload["tracks"][0]["entity_uid"] = str(uuid4())
    else:
        payload["tracks"].append(dict(payload["tracks"][0]))
    _sidecar(world, payload)
    with pytest.raises(ValueError):
        _compile_import(world)


@pytest.mark.parametrize(
    "parameters",
    [
        {"album_uids": [], "destination_preset": "exports"},
        {"album_uids": ["invalid"], "destination_preset": "exports"},
        {"album_uids": [str(uuid4())], "destination_preset": "unknown"},
        {
            "album_uids": [str(uuid4())],
            "destination_preset": "exports",
            "include_audio": True,
        },
        {"album_uids": [str(uuid4())], "destination_preset": "exports", "path": "/tmp"},
    ],
)
def test_export_parameters_are_closed_and_require_a_configured_preset(
    portable_world, parameters
):
    with pytest.raises((KeyError, TypeError, ValueError)):
        portable.compile_operation(
            "metadata_export", parameters, portable_world["config"]
        )


def test_repository_snapshot_is_bounded_and_uses_three_batched_queries(portable_world):
    world = portable_world
    with transaction_scope() as session:
        extra_uids = [str(uuid4()) for _ in range(19)]
        for index, uid in enumerate(extra_uids):
            session.execute(
                text(
                    "INSERT INTO library_albums(artist,name,path,entity_uid) VALUES('Artist',:name,:path,CAST(:uid AS uuid))"
                ),
                {
                    "name": f"Album {index}",
                    "path": str(world["audio"].parent.parent / f"Album {index}"),
                    "uid": uid,
                },
            )
    statements = []

    def observed(connection, cursor, statement, parameters, context, many):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", observed)
    try:
        with read_scope() as session:
            state = read_portability_state(
                [world["album_uid"], *extra_uids], session=session
            )
    finally:
        event.remove(engine, "before_cursor_execute", observed)
    assert len(state["albums"]) == 20
    assert len(statements) == 3
    for uids in ([], [world["album_uid"]] * 2, [str(uuid4()) for _ in range(21)]):
        with pytest.raises(ValueError):
            read_portability_state(uids)


def test_repository_rejects_excess_tracks_instead_of_truncating_targets(portable_world):
    world = portable_world
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_tracks(album_id,artist,album,filename,path,entity_uid) SELECT :album,'Artist','Album','track-'||n,:prefix||n,gen_random_uuid() FROM generate_series(1,100) n"
            ),
            {
                "album": world["album_id"],
                "prefix": str(world["audio"].parent / "extra-"),
            },
        )
    with pytest.raises(ValueError, match="100 tracks"):
        read_portability_state([world["album_uid"]])


def test_repository_import_can_roll_back_data_locks_audit_and_outbox_together(
    portable_world,
):
    world = portable_world
    before = read_portability_state([world["album_uid"]])
    changes = [
        {
            "entity_type": "track",
            "entity_uid": world["track_uid"],
            "field": "genre",
            "before": None,
            "after": "ambient",
        }
    ]
    with pytest.raises(RuntimeError):
        with transaction_scope() as session:
            result = apply_portability_changes(
                [world["album_uid"]],
                metadata_state_version(before),
                changes,
                task_id="rollback-import",
                session=session,
            )
            assert result["status"] == "completed"
            assert (
                read_portability_state([world["album_uid"]], session=session)["tracks"][
                    0
                ]["genre"]
                == "ambient"
            )
            raise RuntimeError("rollback")
    assert read_portability_state([world["album_uid"]]) == before
    with read_scope() as session:
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM audit_log WHERE task_id='rollback-import'")
            ).scalar_one()
            == 0
        )
        assert (
            session.execute(
                text(
                    "SELECT COUNT(*) FROM domain_event_outbox WHERE subject_key='portable_metadata'"
                )
            ).scalar_one()
            == 0
        )


def test_failed_export_is_partial_and_repeated_delivery_does_not_repeat_filesystem_effects(
    portable_world, monkeypatch
):
    world = portable_world
    writes = []

    def fail_archive(self, name, data, *args, **kwargs):
        writes.append(name)
        raise OSError("disk full")

    monkeypatch.setattr(zipfile.ZipFile, "writestr", fail_archive)
    job, result = _run_export(world)
    assert result["execution"]["status"] == "partial", result
    assert result["verification"]["status"] == "manual_reconciliation_required"
    replay = operations.execute_operation_job(job, world["config"])
    assert replay == result
    assert len(writes) == 1
    assert len(list(world["export"].glob("*/metadata.zip"))) == 1
    with read_scope() as session:
        assert (
            session.execute(text("SELECT COUNT(*) FROM agent_artifacts")).scalar_one()
            == 0
        )


@pytest.mark.parametrize(
    "mutation", ["owner", "context", "grant", "revoked", "expired", "unfinished"]
)
def test_artifacts_require_current_owner_context_permission_and_completed_unexpired_job(
    portable_world, mutation
):
    world = portable_world
    job, result = _run_export(world)
    assert result["execution"]["status"] == "completed", result
    artifact = result["execution"]["artifacts"][0]
    principal = world["principal"]
    if mutation == "owner":
        principal = create_credential(
            "Other owner",
            {"library.metadata.export"},
            datetime.now(UTC) + timedelta(days=1),
        ).principal
    elif mutation == "revoked":
        revoke_credential(principal.credential_id)
    else:
        with transaction_scope() as session:
            if mutation == "context":
                session.execute(
                    text(
                        "UPDATE agent_artifacts SET authorization_context='{}'::jsonb || jsonb_build_object('authorization_id','different') WHERE id=:id"
                    ),
                    {"id": artifact["artifact_id"]},
                )
            elif mutation == "grant":
                session.execute(
                    text(
                        "UPDATE agent_principals SET grants=ARRAY['library.health.read']::text[] WHERE id=:id"
                    ),
                    {"id": principal.id},
                )
            elif mutation == "expired":
                session.execute(
                    text(
                        "UPDATE agent_artifacts SET expires_at=NOW()-INTERVAL '1 second' WHERE id=:id"
                    ),
                    {"id": artifact["artifact_id"]},
                )
            else:
                session.execute(
                    text("UPDATE tasks SET status='running' WHERE id=:id"), {"id": job}
                )
    with pytest.raises(DiagnosticError) as error:
        get_owned_artifact(principal, artifact["artifact_id"])
    assert error.value.code in {"NOT_FOUND", "FORBIDDEN"}


def test_artifact_registration_rejects_jobs_from_other_operations(portable_world):
    world = portable_world
    accepted = operations.prepare_operation(
        world["principal"],
        "metadata_update",
        {"entity_uid": world["track_uid"]},
        "not-export",
    )["data"]
    start_task(accepted["job_id"])
    with pytest.raises(DiagnosticError, match="Only metadata exports"):
        register_artifact(
            accepted["job_id"],
            path="/tmp/private",
            filename="private.zip",
            sha256="0" * 64,
            byte_size=1,
        )


def test_artifact_download_verifies_digest_and_never_exposes_server_paths(
    portable_world, monkeypatch
):
    world = portable_world
    _, result = _run_export(world)
    assert result["execution"]["status"] == "completed", result
    artifact = result["execution"]["artifacts"][0]
    client = _download_client(monkeypatch)
    response = client.get(
        artifact["download_path"], headers={"Authorization": f"Bearer {world['token']}"}
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert hashlib.sha256(response.content).hexdigest() == artifact["sha256"]
    record = get_owned_artifact(world["principal"], artifact["artifact_id"])
    Path(record["path"]).write_bytes(b"tampered zip")
    response = client.get(
        artifact["download_path"], headers={"Authorization": f"Bearer {world['token']}"}
    )
    assert response.status_code == 403
    assert response.json() == {"error": "SOURCE_CHANGED"}
    assert str(world["export"]) not in response.text


@pytest.mark.parametrize("kind", ["file", "directory", "fifo", "oversize"])
def test_artifact_download_rejects_replaced_symlink_or_nonregular_sources(
    portable_world, monkeypatch, kind
):
    world = portable_world
    _, result = _run_export(world)
    artifact = result["execution"]["artifacts"][0]
    record = get_owned_artifact(world["principal"], artifact["artifact_id"])
    path = Path(record["path"])
    raw = path.read_bytes()
    path.unlink()
    if kind in {"file", "directory"}:
        outside = world["export"].parent / "external"
        outside.mkdir()
        external = outside / path.name
        external.write_bytes(raw)
        if kind == "file":
            path.symlink_to(external)
        else:
            for other in path.parent.iterdir():
                if other.is_dir():
                    import shutil

                    shutil.rmtree(other)
            path.parent.rmdir()
            path.parent.symlink_to(outside, target_is_directory=True)
    elif kind == "fifo":
        os.mkfifo(path)
    else:
        with path.open("wb") as source:
            source.truncate(portable.MAX_ARTIFACT_BYTES + 1)
    response = _download_client(monkeypatch).get(
        artifact["download_path"], headers={"Authorization": f"Bearer {world['token']}"}
    )
    assert response.status_code in {403, 409}
    assert response.json()["error"] in {"SOURCE_CHANGED", "ARTIFACT_UNAVAILABLE"}


@pytest.mark.parametrize(
    "headers,query",
    [
        ({}, ""),
        ({"Cookie": "crate_token=human"}, ""),
        ({"Remote-User": "owner@example.test"}, ""),
        ({}, "?token=machine"),
        ({"Authorization": "Bearer " + "crate_mcp_" + "A" * 43}, "?token=extra"),
        (
            {
                "Authorization": "Bearer " + "crate_mcp_" + "A" * 43,
                "Cookie": "crate_token=human",
            },
            "",
        ),
        (
            {
                "Authorization": "Bearer " + "crate_mcp_" + "A" * 43,
                "Remote-User": "owner@example.test",
            },
            "",
        ),
    ],
)
def test_download_requires_unmixed_bearer_credentials(monkeypatch, headers, query):
    resolver = Mock()
    monkeypatch.setattr("crate.mcp.auth.resolve_credential", resolver)
    response = _download_client(monkeypatch).get(
        f"/mcp/artifacts/{uuid4()}{query}", headers=headers
    )
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"
    resolver.assert_not_called()


def test_invalid_bearer_is_rejected_without_exposing_it(monkeypatch):
    token = generate_token()
    monkeypatch.setattr("crate.mcp.auth.resolve_credential", lambda _: None)
    response = _download_client(monkeypatch).get(
        f"/mcp/artifacts/{uuid4()}", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 401
    assert token not in response.text


@pytest.mark.parametrize(
    "headers",
    [{"Host": "attacker.example"}, {"Origin": "https://attacker.example"}],
)
def test_download_rejects_untrusted_transport_before_authentication(
    monkeypatch, headers
):
    resolver = Mock()
    monkeypatch.setattr("crate.mcp.auth.resolve_credential", resolver)
    response = _download_client(monkeypatch).get(
        f"/mcp/artifacts/{uuid4()}",
        headers={"Authorization": f"Bearer {generate_token()}", **headers},
    )
    assert response.status_code in {403, 421}
    resolver.assert_not_called()


def test_exported_sidecar_rehydrates_missing_metadata_without_importing_dsp_or_audio(
    portable_world,
):
    world = portable_world
    _, exported = _run_export(world)
    reference = exported["execution"]["artifacts"][0]
    record = get_owned_artifact(world["principal"], reference["artifact_id"])
    with zipfile.ZipFile(record["path"]) as archive:
        entry = archive.namelist()[0]
        source = world["source"] / entry
        source.parent.mkdir(parents=True)
        source.write_bytes(archive.read(entry))
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_albums SET year=NULL WHERE id=:id"),
            {"id": world["album_id"]},
        )
        session.execute(
            text(
                "UPDATE library_tracks SET title=NULL,year=NULL,track_number=NULL,bpm=77 WHERE id=:id"
            ),
            {"id": world["track_id"]},
        )
    plan = _compile_import(world)
    result = portable.apply_operation(
        "metadata_rehydrate",
        plan["execution"],
        world["config"],
        task_id="roundtrip-import",
        authorize=_authorize,
    )
    assert result["verification"]["status"] == "passed"
    state = read_portability_state([world["album_uid"]])
    assert state["albums"][0]["year"] == "1997"
    assert state["tracks"][0]["title"] == "Original title"
    assert state["tracks"][0]["track_number"] == 1
    assert state["tracks"][0]["bpm"] == 77
    assert world["audio"].read_bytes().startswith(b"original audio bytes")


def test_new_oauth_consent_for_same_principal_cannot_download_prior_grants_artifact(
    portable_world, oauth_env
):
    from crate.db.repositories import mcp_oauth as oauth_store

    world = portable_world
    scopes = {"library.metadata.export"}
    oauth_store.update_oauth_client("test-client", scopes=scopes)
    first_exchange = _exchange(_code(oauth_env, scope="library.metadata.export"))
    assert first_exchange[0] == 200, first_exchange
    first = oauth_store.resolve_oauth_access_token(first_exchange[1]["access_token"])[0]
    world["principal"] = first
    with transaction_scope() as session:
        session.execute(
            text("UPDATE agent_principals SET require_approval=FALSE WHERE id=:id"),
            {"id": first.id},
        )
    _, result = _run_export(world)
    assert result["execution"]["status"] == "completed", result
    artifact = result["execution"]["artifacts"][0]
    assert (
        str(get_owned_artifact(first, artifact["artifact_id"])["principal_id"])
        == first.id
    )
    second_exchange = _exchange(_code(oauth_env, scope="library.metadata.export"))
    assert second_exchange[0] == 200, second_exchange
    second = oauth_store.resolve_oauth_access_token(second_exchange[1]["access_token"])[
        0
    ]
    assert first.id == second.id
    assert first.authorization_id != second.authorization_id
    with pytest.raises(DiagnosticError) as error:
        get_owned_artifact(second, artifact["artifact_id"])
    assert error.value.code == "NOT_FOUND"
