"""Exact repair plans operate on canonical persisted issues and frozen sources."""

import copy
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy import text

from crate import agent_repairs as repairs
from crate import agent_library_operations as operations
from crate.agent_diagnostics import DiagnosticError
from crate.db.health import upsert_health_issue
from crate.db.repositories.agent_credentials import create_credential, revoke_credential
from crate.db.repositories.agent_repairs import (
    apply_repair_item,
    read_repair_source,
    repair_source_version,
)
from crate.db.repositories.field_locks import lock_fields
from crate.db.repositories.tasks_updates import start_task
from crate.db.tx import read_scope, transaction_scope

from tests.test_agent_metadata import _flac
from tests.test_agent_repair_catalog_contract import MANUAL_CHECKS


def _authorize(effect=None):
    return effect() if effect is not None else None


def _one(sql, params=None):
    with read_scope() as session:
        return session.execute(text(sql), params or {}).scalar_one()


@pytest.fixture
def repair_world(pg_db, tmp_path, monkeypatch):
    monkeypatch.setattr("crate.db.repositories.tasks_mutations.dispatch_task", Mock())
    monkeypatch.setattr(
        "crate.db.repositories.tasks_shared.publish_tasks_surface_signal", Mock()
    )
    artist_uid, album_uid, track_uid = (str(uuid4()) for _ in range(3))
    directory = tmp_path / "Artist" / "Album"
    path = directory / "song.flac"
    with transaction_scope() as session:
        actor = session.execute(
            text("SELECT id FROM users ORDER BY id LIMIT 1")
        ).scalar_one()
        artist_id = session.execute(
            text(
                "INSERT INTO library_artists(name,entity_uid,folder_name,album_count,track_count,total_size,has_photo) VALUES ('Artist',CAST(:uid AS uuid),'Artist',1,1,100,0) RETURNING id"
            ),
            {"uid": artist_uid},
        ).scalar_one()
        album_id = session.execute(
            text(
                "INSERT INTO library_albums(artist,name,path,entity_uid,track_count,total_size,total_duration,formats_json) VALUES ('Artist','Album',:path,CAST(:uid AS uuid),1,100,180,'[\"flac\"]'::jsonb) RETURNING id"
            ),
            {"uid": album_uid, "path": str(directory)},
        ).scalar_one()
        track_id = session.execute(
            text(
                "INSERT INTO library_tracks(album_id,artist,album,filename,title,path,entity_uid,track_number,disc_number,duration,size,format) VALUES (:album,'Artist','Album','song.flac','Song',:path,CAST(:uid AS uuid),1,1,180,100,'flac') RETURNING id"
            ),
            {"album": album_id, "uid": track_uid, "path": str(path)},
        ).scalar_one()
    return {
        "root": tmp_path,
        "directory": directory,
        "path": path,
        "artist_uid": artist_uid,
        "artist_id": artist_id,
        "album_uid": album_uid,
        "album_id": album_id,
        "track_uid": track_uid,
        "track_id": track_id,
        "actor": actor,
        "config": {
            "library_path": str(tmp_path),
            "audio_extensions": [".flac", ".mp3"],
        },
    }


def _issue(world, check, **details):
    defaults = {"artist": "Artist", "artist_uid": world["artist_uid"]}
    if check in {"stale_tracks", "fk_orphan_tracks", "tag_mismatch"}:
        defaults["track_path"] = str(world["path"])
    if check in {"stale_albums", "fk_orphan_albums"}:
        defaults.update(path=str(world["directory"]), album_id=world["album_id"])
    issue_id = upsert_health_issue(
        check,
        "medium",
        "Canonical " + check,
        {**defaults, **details},
        auto_fixable=True,
    )
    assert issue_id is not None
    return issue_id


def _plan(world, *issues):
    return repairs.compile_operation(
        "repairs", {"issue_ids": list(issues)}, world["config"]
    )


def _apply(world, plan, *, authorize=_authorize):
    return repairs.apply_operation(
        "repairs",
        plan["execution"],
        world["config"],
        task_id="repair-test",
        authorize=authorize,
    )


@pytest.mark.parametrize(
    "parameters",
    [
        {"issue_ids": []},
        {"issue_ids": [0]},
        {"issue_ids": [True]},
        {"issue_ids": ["1"]},
        {"issue_ids": [1, 1]},
        {"issue_ids": list(range(1, 22))},
        {"issue_ids": [1], "issues": [{"action": "delete_artist"}]},
        {"issue_ids": [1], "path": "/outside"},
    ],
)
def test_invalid_repair_selection_is_rejected_before_loading_sources(
    monkeypatch, parameters
):
    source = Mock(side_effect=AssertionError("invalid selection reached database"))
    monkeypatch.setattr(repairs, "read_repair_source", source)
    with pytest.raises(ValueError):
        repairs.compile_operation("repairs", parameters, {})
    source.assert_not_called()


@pytest.mark.parametrize("check", sorted(MANUAL_CHECKS))
def test_manual_contracts_produce_complete_diagnostic_plans_without_effects(
    repair_world, check
):
    world = repair_world
    issue = _issue(world, check)
    plan = _plan(world, issue)
    assert plan["document"]["executable"] is False
    assert plan["document"]["targets"] == [
        {"entity_type": "library", "scope": "global", "diagnostic_only": True}
    ]
    change = plan["document"]["changes"][0]
    assert change["issue_id"] == issue
    assert change["check_type"] == check
    assert change["support"] == "manual" and change["reason"]
    assert change["scope"] == "global"
    with pytest.raises(ValueError, match="entire repair selection"):
        _apply(world, plan)
    assert _one("SELECT COUNT(*) FROM library_tracks") == 1
    assert (
        _one("SELECT status FROM health_issues WHERE id=:id", {"id": issue}) == "open"
    )


def test_a_manual_item_blocks_the_entire_mixed_selection(repair_world):
    world = repair_world
    automatic, manual = _issue(world, "stale_tracks"), _issue(world, "missing_cover")
    plan = _plan(world, automatic, manual)
    assert plan["document"]["executable"] is False
    assert len(plan["document"]["changes"]) == 2
    with pytest.raises(ValueError):
        _apply(world, plan)
    assert (
        _one(
            "SELECT COUNT(*) FROM library_tracks WHERE id=:id",
            {"id": world["track_id"]},
        )
        == 1
    )


@pytest.mark.parametrize(
    "check,table",
    [
        ("stale_tracks", "library_tracks"),
        ("stale_albums", "library_albums"),
        ("stale_artists", "library_artists"),
    ],
)
def test_stale_repairs_delete_only_frozen_rows_and_verify_the_issue(
    repair_world, check, table
):
    world = repair_world
    issue = _issue(world, check)
    plan = _plan(world, issue)
    assert plan["document"]["executable"] is True
    assert plan["document"]["risk"] == "destructive"
    assert plan["document"]["impact"]["audio_deleted"] is False
    assert plan["document"]["changes"][0]["deleted_targets"]

    result = _apply(world, plan)

    assert result["execution"]["status"] == "completed"
    assert result["verification"]["status"] == "passed"
    assert _one(f"SELECT COUNT(*) FROM {table}") == 0
    assert (
        _one("SELECT status FROM health_issues WHERE id=:id", {"id": issue}) == "fixed"
    )
    assert (
        _one(
            "SELECT COUNT(*) FROM audit_log WHERE action='planned_library_repair' AND task_id='repair-test'"
        )
        == 1
    )
    assert (
        _one(
            "SELECT COUNT(*) FROM domain_event_outbox WHERE subject_key=:key",
            {"key": f"repair:{issue}"},
        )
        == 1
    )
    if check == "stale_tracks":
        assert (
            _one(
                "SELECT track_count FROM library_albums WHERE id=:id",
                {"id": world["album_id"]},
            )
            == 0
        )
        assert (
            _one(
                "SELECT track_count FROM library_artists WHERE id=:id",
                {"id": world["artist_id"]},
            )
            == 0
        )


def test_absent_path_evidence_is_rechecked_before_a_stale_track_delete(repair_world):
    world = repair_world
    issue = _issue(world, "stale_tracks")
    plan = _plan(world, issue)
    world["path"].parent.mkdir(parents=True)
    world["path"].write_bytes(b"file appeared")

    result = _apply(world, plan)

    assert result["execution"]["status"] != "completed"
    assert result["execution"]["items"][0]["code"] == "SOURCE_CHANGED"
    assert (
        _one(
            "SELECT COUNT(*) FROM library_tracks WHERE id=:id",
            {"id": world["track_id"]},
        )
        == 1
    )
    assert world["path"].read_bytes() == b"file appeared"
    assert (
        _one("SELECT status FROM health_issues WHERE id=:id", {"id": issue}) == "open"
    )


@pytest.mark.parametrize("mutation", ["track", "issue", "lock", "history"])
def test_database_source_changes_conflict_before_the_filesystem_callback(
    repair_world, mutation
):
    world = repair_world
    issue = _issue(world, "stale_tracks")
    item = _plan(world, issue)["execution"]["items"][0]
    with transaction_scope() as session:
        if mutation == "track":
            session.execute(
                text("UPDATE library_tracks SET title='Concurrent title' WHERE id=:id"),
                {"id": world["track_id"]},
            )
        elif mutation == "issue":
            session.execute(
                text(
                    "UPDATE health_issues SET description='Changed issue evidence' WHERE id=:id"
                ),
                {"id": issue},
            )
        elif mutation == "lock":
            lock_fields(
                entity_type="track",
                entity_id=world["track_id"],
                field_names=["title"],
                session=session,
            )
        else:
            session.execute(
                text(
                    "INSERT INTO play_history(user_id,track_id,track_path,played_at) VALUES (:user,:track,:path,NOW())"
                ),
                {
                    "user": world["actor"],
                    "track": world["track_id"],
                    "path": str(world["path"]),
                },
            )
    effect = Mock(
        side_effect=AssertionError("source conflict reached filesystem effects")
    )
    result = apply_repair_item(item, check_files=effect, task_id="db-conflict")
    assert result == {"status": "conflict", "code": "SOURCE_CHANGED"}
    effect.assert_not_called()
    assert (
        _one(
            "SELECT COUNT(*) FROM library_tracks WHERE id=:id",
            {"id": world["track_id"]},
        )
        == 1
    )


def test_zombie_artist_must_still_have_no_membership_at_apply(repair_world):
    world = repair_world
    with transaction_scope() as session:
        session.execute(
            text("DELETE FROM library_albums WHERE id=:id"), {"id": world["album_id"]}
        )
    issue = _issue(world, "zombie_artists")
    plan = _plan(world, issue)
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_albums(artist,name,path,entity_uid) VALUES ('Artist','New album',:path,CAST(:uid AS uuid))"
            ),
            {"path": str(world["root"] / "new"), "uid": str(uuid4())},
        )
    result = _apply(world, plan)
    assert result["execution"]["status"] != "completed"
    assert (
        _one(
            "SELECT COUNT(*) FROM library_artists WHERE id=:id",
            {"id": world["artist_id"]},
        )
        == 1
    )


def test_empty_zombie_artist_is_deleted_without_any_filesystem_effect(repair_world):
    world = repair_world
    with transaction_scope() as session:
        session.execute(
            text("DELETE FROM library_albums WHERE id=:id"), {"id": world["album_id"]}
        )
    issue = _issue(world, "zombie_artists")
    result = _apply(world, _plan(world, issue))
    assert result["verification"]["status"] == "passed"
    assert (
        _one(
            "SELECT COUNT(*) FROM library_artists WHERE id=:id",
            {"id": world["artist_id"]},
        )
        == 0
    )


def test_fk_orphan_track_delete_uses_current_missing_album_evidence(repair_world):
    world = repair_world
    with transaction_scope() as session:
        session.execute(
            text(
                "ALTER TABLE library_tracks DROP CONSTRAINT library_tracks_album_id_fkey"
            )
        )
        session.execute(
            text("UPDATE library_tracks SET album_id=999999 WHERE id=:id"),
            {"id": world["track_id"]},
        )
    issue = _issue(world, "fk_orphan_tracks")
    plan = _plan(world, issue)
    assert plan["document"]["executable"] is True
    result = _apply(world, plan)
    assert result["verification"]["status"] == "passed"
    assert (
        _one(
            "SELECT COUNT(*) FROM library_tracks WHERE id=:id",
            {"id": world["track_id"]},
        )
        == 0
    )


@pytest.mark.parametrize("canonical", [True, False])
def test_fk_orphan_album_freezes_reassign_or_delete_and_refreshes_canonical_summary(
    repair_world, canonical
):
    world = repair_world
    with transaction_scope() as session:
        session.execute(
            text(
                "ALTER TABLE library_albums DROP CONSTRAINT library_albums_artist_fkey"
            )
        )
        session.execute(
            text("UPDATE library_albums SET artist=:name WHERE id=:id"),
            {"id": world["album_id"], "name": "artist" if canonical else "Missing"},
        )
        session.execute(
            text(
                "UPDATE library_artists SET album_count=0,track_count=0,total_size=0 WHERE id=:id"
            ),
            {"id": world["artist_id"]},
        )
    issue = _issue(world, "fk_orphan_albums")
    plan = _plan(world, issue)
    assert plan["document"]["executable"] is True
    assert plan["document"]["changes"][0]["action"] == (
        "reassign_album" if canonical else "delete_album"
    )
    result = _apply(world, plan)
    assert result["verification"]["status"] == "passed"
    if canonical:
        assert (
            _one(
                "SELECT artist FROM library_albums WHERE id=:id",
                {"id": world["album_id"]},
            )
            == "Artist"
        )
        assert (
            _one(
                "SELECT album_count FROM library_artists WHERE id=:id",
                {"id": world["artist_id"]},
            )
            == 1
        )
        assert (
            _one(
                "SELECT track_count FROM library_artists WHERE id=:id",
                {"id": world["artist_id"]},
            )
            == 1
        )
    else:
        assert (
            _one(
                "SELECT COUNT(*) FROM library_albums WHERE id=:id",
                {"id": world["album_id"]},
            )
            == 0
        )
        assert (
            _one(
                "SELECT COUNT(*) FROM library_tracks WHERE id=:id",
                {"id": world["track_id"]},
            )
            == 0
        )


def test_photo_repair_uses_uid_evidence_and_rejects_a_changed_photo(repair_world):
    world = repair_world
    folder = world["root"] / "Artist"
    folder.mkdir()
    photo = folder / "artist.jpg"
    photo.write_bytes(b"photo-one")
    issue = _issue(world, "has_photo_desync", artist="Wrong client display name")
    with transaction_scope() as session:
        session.execute(
            text("UPDATE health_issues SET artist_id=:artist WHERE id=:id"),
            {"artist": world["artist_id"], "id": issue},
        )
    plan = _plan(world, issue)
    assert plan["execution"]["items"][0]["photo"]["artist_uid"] == world["artist_uid"]
    photo.write_bytes(b"photo-two")
    result = _apply(world, plan)
    assert result["execution"]["status"] != "completed"
    assert (
        _one(
            "SELECT has_photo FROM library_artists WHERE id=:id",
            {"id": world["artist_id"]},
        )
        == 0
    )


def test_photo_repair_verifies_the_new_database_flag_without_modifying_image(
    repair_world,
):
    world = repair_world
    photo = world["root"] / "Artist" / "artist.jpg"
    photo.parent.mkdir()
    photo.write_bytes(b"photo")
    issue = _issue(world, "has_photo_desync")
    result = _apply(world, _plan(world, issue))
    assert result["verification"]["status"] == "passed"
    assert (
        _one(
            "SELECT has_photo FROM library_artists WHERE id=:id",
            {"id": world["artist_id"]},
        )
        == 1
    )
    assert photo.read_bytes() == b"photo"
    assert (
        _one("SELECT status FROM health_issues WHERE id=:id", {"id": issue}) == "fixed"
    )


@pytest.mark.parametrize("locked", [True, False])
def test_tag_mismatch_uses_current_audio_tags_and_preserves_a_manual_artist_lock(
    repair_world, locked
):
    world = repair_world
    _flac(world["path"], title="Song", albumartist="Fresh tagged artist")
    issue = _issue(world, "tag_mismatch", tag_artist="Old issue tag")
    if locked:
        lock_fields(
            entity_type="track", entity_id=world["track_id"], field_names=["artist"]
        )
    plan = _plan(world, issue)
    assert plan["document"]["executable"] is (not locked)
    if locked:
        assert "locked" in plan["document"]["changes"][0]["reason"]
    else:
        assert plan["document"]["changes"][0]["new_artist"] == "Fresh tagged artist"
        original = world["path"].read_bytes()
        result = _apply(world, plan)
        assert result["verification"]["status"] == "passed"
        assert (
            _one(
                "SELECT artist FROM library_tracks WHERE id=:id",
                {"id": world["track_id"]},
            )
            == "Fresh tagged artist"
        )
        assert world["path"].read_bytes() == original


def _duplicate_track(world):
    world["directory"].mkdir(parents=True)
    world["path"].write_bytes(b"identical audio")
    path = world["directory"] / "song.mp3"
    path.write_bytes(b"identical audio")
    uid = str(uuid4())
    with transaction_scope() as session:
        track_id = session.execute(
            text(
                "INSERT INTO library_tracks(album_id,artist,album,filename,title,path,entity_uid,track_number,disc_number,duration,size,format) VALUES (:album,'Artist','Album',:filename,'Song',:path,CAST(:uid AS uuid),1,1,180,15,'mp3') RETURNING id"
            ),
            {
                "album": world["album_id"],
                "path": str(path),
                "filename": path.name,
                "uid": uid,
            },
        ).scalar_one()
    return {"id": track_id, "uid": uid, "path": path}


def test_duplicate_tracks_freeze_keep_drop_and_preserve_audio_in_verified_quarantine(
    repair_world,
):
    world = repair_world
    duplicate = _duplicate_track(world)
    issue = _issue(
        world, "duplicate_tracks", paths=[str(world["path"]), str(duplicate["path"])]
    )
    plan = _plan(world, issue)
    item = plan["execution"]["items"][0]
    assert item["keep_uids"] == [world["track_uid"]]
    assert item["drop_ids"] == [duplicate["id"]]
    assert plan["document"]["risk"] == "destructive"
    assert plan["document"]["impact"]["audio_deleted"] is False
    original = duplicate["path"].read_bytes()

    result = _apply(world, plan)

    assert result["verification"]["status"] == "passed"
    destination = Path(item["moves"][0]["destination"])
    assert destination.read_bytes() == original
    assert destination.is_relative_to(world["root"] / ".crate-trash" / "agent-repairs")
    assert not duplicate["path"].exists()
    assert world["path"].read_bytes() == original
    assert (
        _one(
            "SELECT COUNT(*) FROM library_tracks WHERE id=:id", {"id": duplicate["id"]}
        )
        == 0
    )
    assert (
        _one(
            "SELECT track_count FROM library_albums WHERE id=:id",
            {"id": world["album_id"]},
        )
        == 1
    )
    replay = _apply(world, plan)
    assert replay["execution"]["status"] != "completed"
    assert destination.read_bytes() == original
    assert (
        _one("SELECT COUNT(*) FROM audit_log WHERE action='planned_library_repair'")
        == 1
    )


def test_changed_duplicate_audio_cannot_be_quarantined_under_an_old_plan(repair_world):
    world = repair_world
    duplicate = _duplicate_track(world)
    issue = _issue(
        world, "duplicate_tracks", paths=[str(world["path"]), str(duplicate["path"])]
    )
    plan = _plan(world, issue)
    duplicate["path"].write_bytes(b"a changed recording")
    result = _apply(world, plan)
    assert result["execution"]["status"] != "completed"
    assert duplicate["path"].read_bytes() == b"a changed recording"
    assert _one("SELECT COUNT(*) FROM library_tracks") == 2
    assert not Path(plan["execution"]["items"][0]["moves"][0]["destination"]).exists()


def test_non_equivalent_duplicate_recordings_require_manual_review_even_with_same_cached_fingerprint(
    repair_world,
):
    world = repair_world
    duplicate = _duplicate_track(world)
    duplicate["path"].write_bytes(b"different recording")
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET audio_fingerprint='stale-cached-fingerprint' WHERE album_id=:id"
            ),
            {"id": world["album_id"]},
        )
    issue = _issue(
        world, "duplicate_tracks", paths=[str(world["path"]), str(duplicate["path"])]
    )
    plan = _plan(world, issue)
    assert plan["document"]["executable"] is False
    assert "equivalence" in plan["document"]["changes"][0]["reason"]


def test_shadow_tracks_require_a_verified_canonical_copy_and_quarantine_malformed_rows(
    repair_world,
):
    world = repair_world
    world["directory"].mkdir(parents=True)
    world["path"].write_bytes(b"identical audio")
    shadow_path = world["root"] / "Artist" / "loose.mp3"
    shadow_path.write_bytes(b"identical audio")
    shadow_uid = str(uuid4())
    with transaction_scope() as session:
        shadow = session.execute(
            text(
                "INSERT INTO library_tracks(album_id,artist,album,filename,title,path,entity_uid,track_number,duration,format) VALUES (:album,'Artist','Album','loose.mp3',NULL,:path,CAST(:uid AS uuid),NULL,0,'mp3') RETURNING id"
            ),
            {"album": world["album_id"], "path": str(shadow_path), "uid": shadow_uid},
        ).scalar_one()
    issue = _issue(
        world,
        "shadow_quality_tracks",
        paths=[str(shadow_path)],
        canonical_album_path=str(world["directory"]),
    )
    plan = _plan(world, issue)
    assert plan["document"]["executable"] is True
    item = plan["execution"]["items"][0]
    assert item["drop_ids"] == [shadow]
    assert item["keep_uids"] == [world["track_uid"]]
    result = _apply(world, plan)
    assert result["verification"]["status"] == "passed"
    assert Path(item["moves"][0]["destination"]).read_bytes() == b"identical audio"
    assert world["path"].read_bytes() == b"identical audio"


def test_modern_duplicate_albums_quarantine_database_rows_and_preserve_every_file(
    repair_world,
):
    world = repair_world
    duplicate_path = world["root"] / "Artist" / "album-copy"
    duplicate_path.mkdir(parents=True)
    original = duplicate_path / "audio.mp3"
    original.write_bytes(b"keep this audio")
    with transaction_scope() as session:
        duplicate = session.execute(
            text(
                "INSERT INTO library_albums(artist,name,path,entity_uid,track_count,total_size,total_duration,formats_json) VALUES ('Artist','album',:path,CAST(:uid AS uuid),1,10,180,'[\"mp3\"]'::jsonb) RETURNING id"
            ),
            {"uid": str(uuid4()), "path": str(duplicate_path)},
        ).scalar_one()
    issue = _issue(
        world,
        "duplicate_albums",
        copies=[{"album_id": world["album_id"]}, {"album_id": duplicate}],
    )
    plan = _plan(world, issue)
    assert plan["execution"]["items"][0]["keep_uid"] == world["album_uid"]
    result = _apply(world, plan)
    assert result["verification"]["status"] == "passed"
    assert (
        _one(
            "SELECT quarantined_at IS NOT NULL FROM library_albums WHERE id=:id",
            {"id": duplicate},
        )
        is True
    )
    assert (
        _one(
            "SELECT quarantined_at IS NULL FROM library_albums WHERE id=:id",
            {"id": world["album_id"]},
        )
        is True
    )
    assert (
        _one(
            "SELECT album_count FROM library_artists WHERE id=:id",
            {"id": world["artist_id"]},
        )
        == 1
    )
    assert original.read_bytes() == b"keep this audio"


def test_legacy_duplicate_album_folders_are_described_as_manual_without_merging(
    repair_world,
):
    world = repair_world
    issue = _issue(world, "duplicate_albums", paths=["Artist/Album", "Artist/Copy"])
    plan = _plan(world, issue)
    assert plan["document"]["executable"] is False
    assert plan["document"]["changes"][0]["support"] == "manual"
    assert plan["document"]["changes"][0]["reason"]


def test_destructive_plan_declares_exact_like_and_history_losses_and_verifies_them(
    repair_world,
):
    world = repair_world
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO user_liked_tracks(user_id,track_id,created_at) VALUES (:user,:track,NOW())"
            ),
            {"user": world["actor"], "track": world["track_id"]},
        )
        history = session.execute(
            text(
                "INSERT INTO play_history(user_id,track_id,track_entity_uid,track_path,played_at) VALUES (:user,:track,CAST(:uid AS uuid),:path,NOW()) RETURNING id"
            ),
            {
                "user": world["actor"],
                "track": world["track_id"],
                "uid": world["track_uid"],
                "path": str(world["path"]),
            },
        ).scalar_one()
    issue = _issue(world, "stale_tracks")
    plan = _plan(world, issue)
    relations = {
        row["relation"]: row
        for row in plan["document"]["changes"][0]["dependent_relations"]
    }
    likes, plays = relations["user_liked_tracks"], relations["play_history"]
    assert likes["on_delete"] == "c"
    assert likes["rows"][0]["keys"] == {
        "user_id": world["actor"],
        "track_id": world["track_id"],
    }
    assert plays["on_delete"] == "n"
    assert plays["rows"][0]["keys"]["id"] == history
    assert all(
        len(row["source_hash"]) == 64
        for relation in relations.values()
        for row in relation["rows"]
    )
    result = _apply(world, plan)
    assert result["verification"]["status"] == "passed"
    assert (
        _one(
            "SELECT COUNT(*) FROM user_liked_tracks WHERE track_id=:id",
            {"id": world["track_id"]},
        )
        == 0
    )
    assert (
        _one("SELECT track_id IS NULL FROM play_history WHERE id=:id", {"id": history})
        is True
    )
    assert (
        _one(
            "SELECT track_entity_uid::text FROM play_history WHERE id=:id",
            {"id": history},
        )
        == world["track_uid"]
    )


def test_quarantine_partial_filesystem_failure_preserves_audio_and_uncommitted_database_rows(
    repair_world, monkeypatch
):
    world = repair_world
    duplicate = _duplicate_track(world)
    issue = _issue(
        world, "duplicate_tracks", paths=[str(world["path"]), str(duplicate["path"])]
    )
    plan = _plan(world, issue)

    def fail_link(*args, **kwargs):
        raise OSError("quarantine storage unavailable")

    monkeypatch.setattr(repairs.os, "link", fail_link)
    result = _apply(world, plan)
    assert result["execution"]["status"] == "partial"
    assert result["verification"]["status"] == "manual_reconciliation_required"
    assert duplicate["path"].read_bytes() == b"identical audio"
    assert world["path"].read_bytes() == b"identical audio"
    assert _one("SELECT COUNT(*) FROM library_tracks") == 2
    assert (
        _one("SELECT status FROM health_issues WHERE id=:id", {"id": issue}) == "open"
    )


def test_revocation_between_items_keeps_completed_effect_and_stops_remaining_item(
    repair_world,
):
    world = repair_world
    other_uid = str(uuid4())
    other_path = world["root"] / "Other" / "Other album" / "missing.mp3"
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_artists(name,entity_uid,folder_name) VALUES ('Other',CAST(:uid AS uuid),'Other')"
            ),
            {"uid": other_uid},
        )
        album = session.execute(
            text(
                "INSERT INTO library_albums(artist,name,path,entity_uid) VALUES ('Other','Other album',:path,CAST(:uid AS uuid)) RETURNING id"
            ),
            {"path": str(other_path.parent), "uid": str(uuid4())},
        ).scalar_one()
        other = session.execute(
            text(
                "INSERT INTO library_tracks(album_id,artist,album,filename,title,path,entity_uid) VALUES (:album,'Other','Other album','missing.mp3','Missing',:path,CAST(:uid AS uuid)) RETURNING id"
            ),
            {"album": album, "path": str(other_path), "uid": str(uuid4())},
        ).scalar_one()
    first = _issue(world, "stale_tracks")
    second = upsert_health_issue(
        "stale_tracks",
        "medium",
        "Missing other track",
        {"artist": "Other", "artist_uid": other_uid, "track_path": str(other_path)},
        auto_fixable=True,
    )
    plan = _plan(world, first, second)

    class Revoked(RuntimeError):
        pass

    def authorize(effect=None):
        if (
            _one("SELECT status FROM health_issues WHERE id=:id", {"id": first})
            == "fixed"
        ):
            raise Revoked()
        return effect() if effect is not None else None

    with pytest.raises(Revoked):
        _apply(world, plan, authorize=authorize)
    assert (
        _one("SELECT status FROM health_issues WHERE id=:id", {"id": first}) == "fixed"
    )
    assert (
        _one("SELECT status FROM health_issues WHERE id=:id", {"id": second}) == "open"
    )
    assert _one("SELECT COUNT(*) FROM library_tracks WHERE id=:id", {"id": other}) == 1


def test_source_version_binds_dependent_row_content_not_just_counts():
    source = {
        "issue": {"id": 1},
        "dependents": [{"table": "play_history", "rows": [{"id": 7, "track_id": 3}]}],
    }
    version = repair_source_version(source)
    changed = copy.deepcopy(source)
    changed["dependents"][0]["rows"][0]["id"] = 8
    assert repair_source_version(changed) != version


@pytest.mark.parametrize("state", ["missing", "fixed"])
def test_missing_or_closed_canonical_issue_is_rejected(
    repair_world, monkeypatch, state
):
    issue = _issue(repair_world, "stale_tracks")
    with transaction_scope() as session:
        session.execute(
            text(
                "DELETE FROM health_issues WHERE id=:id"
                if state == "missing"
                else "UPDATE health_issues SET status='fixed' WHERE id=:id"
            ),
            {"id": issue},
        )
    with pytest.raises(ValueError, match="no longer open"):
        read_repair_source(issue)

    # Exercise the compiler's fallback with the real query and its completeness guard.
    fallback = Mock(wraps=repairs.get_open_repair_issues)
    monkeypatch.setattr(repairs, "get_open_repair_issues", fallback)
    with pytest.raises(ValueError, match="missing or no longer open"):
        _plan(repair_world, issue)
    fallback.assert_called_once_with([issue])
    assert _one("SELECT COUNT(*) FROM library_tracks") == 1
    assert _one("SELECT COUNT(*) FROM agent_repair_plans") == 0


@pytest.fixture
def repair_agent_world(repair_world, monkeypatch):
    monkeypatch.setenv("CRATE_MCP_ENABLED", "true")
    monkeypatch.setenv("CRATE_MCP_ACTIONS_ENABLED", "true")
    monkeypatch.setattr("crate.worker_handlers.is_cancelled", lambda _: False)
    credential = create_credential(
        "Repair regression agent",
        {"library.repair.run", "library.health.read"},
        datetime.now(UTC) + timedelta(hours=1),
    )
    return {**repair_world, "principal": credential.principal}


@pytest.mark.parametrize("state", ["missing", "fixed"])
def test_invalid_canonical_issue_preparation_records_source_conflict(
    repair_agent_world, state
):
    world = repair_agent_world
    issue = _issue(world, "stale_tracks")
    queued = operations.prepare_operation(
        world["principal"], "repairs", {"issue_ids": [issue]}, "invalid-issue"
    )["data"]
    # Close/remove the canonical issue after admission, before the real worker compiles it.
    with transaction_scope() as session:
        session.execute(
            text(
                "DELETE FROM health_issues WHERE id=:id"
                if state == "missing"
                else "UPDATE health_issues SET status='fixed' WHERE id=:id"
            ),
            {"id": issue},
        )
    start_task(queued["job_id"])

    result = operations.execute_operation_job(queued["job_id"], world["config"])

    assert result["execution"]["status"] == "conflict"
    assert result["execution"]["error_code"] == "SOURCE_CONFLICT"
    assert result["verification"]["status"] == "not_required"
    assert (
        _one(
            "SELECT result FROM agent_jobs WHERE task_id=:id", {"id": queued["job_id"]}
        )
        == result
    )
    assert _one("SELECT COUNT(*) FROM agent_repair_plans") == 0
    assert _one("SELECT COUNT(*) FROM library_tracks") == 1


@pytest.mark.parametrize("revocation", ["credential", "grant"])
def test_real_repair_authority_denial_inside_effect_boundary_propagates(
    repair_agent_world, monkeypatch, revocation
):
    world = repair_agent_world
    photo = world["root"] / "Artist" / "artist.jpg"
    photo.parent.mkdir()
    photo.write_bytes(b"unchanged approved photo")
    issue = _issue(world, "has_photo_desync")
    queued = operations.prepare_operation(
        world["principal"], "repairs", {"issue_ids": [issue]}, "prepare-photo"
    )["data"]
    start_task(queued["job_id"])
    prepared = operations.execute_operation_job(queued["job_id"], world["config"])
    assert prepared["execution"]["status"] == "prepared", prepared
    plan = prepared["plan"]
    assert plan["executable"] is True
    queued = operations.apply_operation(
        world["principal"],
        "repairs",
        plan["plan_id"],
        plan["plan_version"],
        "apply-photo",
    )["data"]
    start_task(queued["job_id"])
    real_apply = repairs.apply_operation
    boundaries, propagated = [], []
    effect = Mock(side_effect=AssertionError("repair ran without current authority"))
    monkeypatch.setattr(repairs, "apply_repair_item", effect)

    def apply_with_revocation(operation, execution, config, *, task_id, authorize):
        def revalidate(effect=None):
            if effect is not None:
                assert boundaries == ["precheck"]
                if revocation == "credential":
                    assert revoke_credential(world["principal"].credential_id)
                else:
                    with transaction_scope() as session:
                        session.execute(
                            text(
                                "UPDATE agent_principals SET grants=array_remove(grants,:grant) WHERE id=:id"
                            ),
                            {
                                "id": world["principal"].id,
                                "grant": "library.repair.run",
                            },
                        )
                boundaries.append("effect")
            result = authorize(effect)
            if effect is None:
                boundaries.append("precheck")
            return result

        try:
            return real_apply(
                operation, execution, config, task_id=task_id, authorize=revalidate
            )
        except DiagnosticError as error:
            propagated.append(error)
            raise

    monkeypatch.setattr(repairs, "apply_operation", apply_with_revocation)

    result = operations.execute_operation_job(queued["job_id"], world["config"])

    assert boundaries == ["precheck", "effect"]
    assert len(propagated) == 1 and propagated[0].code == "FORBIDDEN"
    assert result["execution"]["status"] == "failed"
    assert result["execution"]["error_code"] == "FORBIDDEN"
    assert result["verification"]["status"] == "not_required"
    effect.assert_not_called()
    assert (
        _one(
            "SELECT result FROM agent_jobs WHERE task_id=:id", {"id": queued["job_id"]}
        )
        == result
    )
    assert (
        _one(
            "SELECT details_json->'result' FROM audit_log "
            "WHERE action='agent.operation.finished' AND details_json->>'job_id'=:id",
            {"id": queued["job_id"]},
        )
        == result
    )
    assert (
        _one("SELECT COUNT(*) FROM audit_log WHERE action='planned_library_repair'")
        == 0
    )
    assert (
        _one(
            "SELECT has_photo FROM library_artists WHERE id=:id",
            {"id": world["artist_id"]},
        )
        == 0
    )
    assert (
        _one("SELECT status FROM health_issues WHERE id=:id", {"id": issue}) == "open"
    )
    assert photo.read_bytes() == b"unchanged approved photo"


def test_photo_postverification_failure_keeps_the_issue_open(repair_world, monkeypatch):
    world = repair_world
    photo = world["root"] / "Artist" / "artist.jpg"
    photo.parent.mkdir()
    photo.write_bytes(b"approved photo")
    issue = _issue(world, "has_photo_desync")
    plan = _plan(world, issue)
    observe = repairs.observe_artist_photo
    observations = 0

    def changed_after_write(*args, **kwargs):
        nonlocal observations
        observations += 1
        if observations == 2:
            photo.write_bytes(b"photo changed after the database effect")
        return observe(*args, **kwargs)

    monkeypatch.setattr(repairs, "observe_artist_photo", changed_after_write)

    result = _apply(world, plan)

    assert result["execution"]["status"] == "partial"
    assert result["verification"]["status"] == "manual_reconciliation_required"
    assert (
        _one("SELECT status FROM health_issues WHERE id=:id", {"id": issue}) == "open"
    )


def test_failure_after_one_quarantine_move_preserves_all_audio_and_reports_partial(
    repair_world, monkeypatch
):
    world = repair_world
    duplicate = _duplicate_track(world)
    third = world["directory"] / "song-third.mp3"
    third.write_bytes(b"identical audio")
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_tracks(album_id,artist,album,filename,title,path,entity_uid,track_number,disc_number,duration,size,format) VALUES (:album,'Artist','Album','song-third.mp3','Song',:path,CAST(:uid AS uuid),1,1,180,15,'mp3')"
            ),
            {"album": world["album_id"], "path": str(third), "uid": str(uuid4())},
        )
    issue = _issue(
        world,
        "duplicate_tracks",
        paths=[str(world["path"]), str(duplicate["path"]), str(third)],
    )
    plan = _plan(world, issue)
    moves = plan["execution"]["items"][0]["moves"]
    link = repairs.os.link
    linked = 0

    def fail_second_link(*args, **kwargs):
        nonlocal linked
        linked += 1
        if linked == 2:
            raise OSError("second quarantine move failed")
        return link(*args, **kwargs)

    monkeypatch.setattr(repairs.os, "link", fail_second_link)

    result = _apply(world, plan)

    assert result["execution"]["status"] == "partial"
    assert result["verification"]["status"] == "manual_reconciliation_required"
    assert Path(moves[0]["destination"]).read_bytes() == b"identical audio"
    assert not Path(moves[0]["source"]).exists()
    assert Path(moves[1]["source"]).read_bytes() == b"identical audio"
    assert not Path(moves[1]["destination"]).exists()
    assert world["path"].read_bytes() == b"identical audio"
    assert _one("SELECT COUNT(*) FROM library_tracks") == 3
    assert (
        _one("SELECT status FROM health_issues WHERE id=:id", {"id": issue}) == "open"
    )


def test_multiple_items_sharing_summary_rows_are_rejected_before_any_effect(
    repair_world,
):
    world = repair_world
    missing = world["directory"] / "missing.mp3"
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_tracks(album_id,artist,album,filename,title,path,entity_uid) VALUES (:album,'Artist','Album','missing.mp3','Missing',:path,CAST(:uid AS uuid))"
            ),
            {"album": world["album_id"], "path": str(missing), "uid": str(uuid4())},
        )
    first = _issue(world, "stale_tracks")
    second = _issue(world, "stale_tracks", track_path=str(missing))
    plan = _plan(world, first, second)
    assert plan["document"]["executable"] is False
    assert plan["document"]["impact"]["overlapping_scopes"] is True
    assert plan["execution"]["executable"] is False
    assert _one("SELECT COUNT(*) FROM library_tracks") == 2
    assert (
        _one(
            "SELECT COUNT(*) FROM health_issues WHERE id=ANY(:ids) AND status='open'",
            {"ids": [first, second]},
        )
        == 2
    )


def test_dependent_manifest_above_its_budget_never_produces_a_partial_delete_plan(
    repair_world,
):
    world = repair_world
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO play_history(user_id,track_id,track_path,played_at) SELECT :user,:track,:path,NOW() FROM generate_series(1,201)"
            ),
            {
                "user": world["actor"],
                "track": world["track_id"],
                "path": str(world["path"]),
            },
        )
    issue = _issue(world, "stale_tracks")
    with pytest.raises(ValueError, match="bounded manifest"):
        read_repair_source(issue)
    plan = _plan(world, issue)
    assert plan["document"]["executable"] is False
    assert "bounded manifest" in plan["document"]["changes"][0]["reason"]
    assert (
        _one(
            "SELECT COUNT(*) FROM library_tracks WHERE id=:id",
            {"id": world["track_id"]},
        )
        == 1
    )


def test_repair_quarantine_never_follows_a_symlink_in_its_destination(
    repair_world, tmp_path
):
    world = repair_world
    duplicate = _duplicate_track(world)
    outside = tmp_path / "outside-quarantine"
    outside.mkdir()
    (world["root"] / ".crate-trash").symlink_to(outside, target_is_directory=True)
    issue = _issue(
        world, "duplicate_tracks", paths=[str(world["path"]), str(duplicate["path"])]
    )

    plan = _plan(world, issue)

    assert plan["document"]["executable"] is False
    assert "Symbolic" in plan["document"]["changes"][0]["reason"]
    assert duplicate["path"].read_bytes() == b"identical audio"
    assert not list(outside.iterdir())


def test_repairs_for_two_distinct_artists_complete_as_one_bounded_batch(repair_world):
    world = repair_world
    other_uid = str(uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_artists(name,entity_uid,folder_name,has_photo) VALUES ('Other',CAST(:uid AS uuid),'Other',0)"
            ),
            {"uid": other_uid},
        )
    for name in ("Artist", "Other"):
        folder = world["root"] / name
        folder.mkdir(exist_ok=True)
        (folder / "artist.jpg").write_bytes(b"photo")
    first = _issue(world, "has_photo_desync")
    second = upsert_health_issue(
        "has_photo_desync",
        "low",
        "Photo flag differs",
        {"artist": "Other", "artist_uid": other_uid},
        auto_fixable=True,
    )
    plan = _plan(world, first, second)
    assert plan["document"]["executable"] is True
    assert plan["document"]["impact"]["overlapping_scopes"] is False

    result = _apply(world, plan)

    assert result["execution"]["status"] == "completed"
    assert _one("SELECT COUNT(*) FROM library_artists WHERE has_photo=1") == 2
    assert _one("SELECT COUNT(*) FROM health_issues WHERE status='fixed'") == 2
