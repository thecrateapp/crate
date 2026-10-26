"""Photo-flag repair observes only its artist and never writes image files."""

from pathlib import Path

import pytest
from crate.artist_photo import PhotoObservationError, observe_artist_photo
from crate.db.jobs.artist_photo import (
    apply_admin_artist_photo,
    compare_and_set_artist_photo,
    read_artist_photo,
)
from crate.db.tx import read_scope, transaction_scope
from crate.health_check import LibraryHealthCheck
from crate.repair import LibraryRepair
from sqlalchemy import text

UID = "10000000-0000-0000-0000-000000000001"
OTHER_UID = "10000000-0000-0000-0000-000000000002"


@pytest.fixture
def photo_artist(pg_db, tmp_path):
    with transaction_scope() as session:
        session.execute(
            text("""
            INSERT INTO library_artists (name, entity_uid, folder_name, has_photo)
            VALUES ('Echo', CAST(:uid AS uuid), 'echo', 0),
                   ('Untouched', CAST(:other AS uuid), 'untouched', 1)
        """),
            {"uid": UID, "other": OTHER_UID},
        )
    (tmp_path / "echo").mkdir()
    (tmp_path / "echo" / "artist.jpg").write_bytes(b"photo")
    return {"library_path": str(tmp_path)}


def _issue(config):
    observation = observe_artist_photo(config, UID)
    return {
        "check": "has_photo_desync",
        "auto_fixable": True,
        "details": {
            "artist": observation["name"],
            "artist_uid": UID,
            "folder_name": observation["folder_name"],
            "db_has_photo": observation["db_has_photo"],
            "fs_has_photo": observation["fs_has_photo"],
        },
    }


def _cas(observation, **overrides):
    values = {
        "expected_has_photo": observation["db_has_photo"],
        "expected_name": observation["name"],
        "expected_folder_name": observation["folder_name"],
        "has_photo": observation["fs_has_photo"],
    }
    values.update(overrides)
    return compare_and_set_artist_photo(UID, **values)


def test_observation_is_local_uid_scoped_and_fingerprint_excludes_db_flag(photo_artist):
    before = observe_artist_photo(photo_artist, UID)
    assert before["artist_uid"] == UID
    assert before["db_has_photo"] is False
    assert before["fs_has_photo"] is True
    assert len(before["filesystem_fingerprint"]) == 64
    assert before["observed_at"].endswith("+00:00")
    assert _cas(before) == "applied"
    assert (
        observe_artist_photo(photo_artist, UID)["filesystem_fingerprint"]
        == before["filesystem_fingerprint"]
    )
    assert read_artist_photo(OTHER_UID)["has_photo"] == 1
    assert _cas(before) == "already_satisfied"


def test_observation_detects_replaced_photo_and_renamed_artist(photo_artist):
    before = observe_artist_photo(photo_artist, UID)
    (Path(photo_artist["library_path"]) / "echo" / "artist.jpg").write_bytes(
        b"new image"
    )
    changed = observe_artist_photo(photo_artist, UID)
    assert changed["filesystem_fingerprint"] != before["filesystem_fingerprint"]
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_artists SET name='Renamed' WHERE entity_uid=CAST(:uid AS uuid)"
            ),
            {"uid": UID},
        )
    assert (
        observe_artist_photo(photo_artist, UID)["filesystem_fingerprint"]
        != changed["filesystem_fingerprint"]
    )
    assert _cas(changed) == "conflict"
    assert read_artist_photo(UID)["has_photo"] == 0


def test_photo_fingerprint_has_stable_filename_order(photo_artist, monkeypatch):
    folder = Path(photo_artist["library_path"]) / "echo"
    (folder / "artist.png").write_bytes(b"second image")
    monkeypatch.setattr("crate.artist_photo.PHOTO_NAMES", ["artist.jpg", "artist.png"])
    first = observe_artist_photo(photo_artist, UID)
    monkeypatch.setattr("crate.artist_photo.PHOTO_NAMES", ["artist.png", "artist.jpg"])
    assert (
        observe_artist_photo(photo_artist, UID)["filesystem_fingerprint"]
        == first["filesystem_fingerprint"]
    )


@pytest.mark.parametrize(
    "uid,code",
    [
        ("bad", "INVALID_ARGUMENT"),
        ("10000000-0000-0000-0000-000000000099", "ARTIST_NOT_FOUND"),
    ],
)
def test_observation_rejects_invalid_or_missing_artist(photo_artist, uid, code):
    with pytest.raises(PhotoObservationError) as error:
        observe_artist_photo(photo_artist, uid)
    assert error.value.code == code


def test_missing_directory_is_not_evidence_of_missing_photo(photo_artist):
    folder = Path(photo_artist["library_path"]) / "echo"
    (folder / "artist.jpg").unlink()
    folder.rmdir()
    with pytest.raises(PhotoObservationError) as error:
        observe_artist_photo(photo_artist, UID)
    assert error.value.code == "DIRECTORY_MISSING"
    assert read_artist_photo(UID)["has_photo"] == 0


@pytest.mark.parametrize("target", ["directory", "photo"])
def test_observation_rejects_symlinks_outside_library(photo_artist, tmp_path, target):
    outside = tmp_path.parent / f"outside-{tmp_path.name}"
    outside.mkdir(exist_ok=True)
    (outside / "artist.jpg").write_bytes(b"external")
    folder = tmp_path / "echo"
    (folder / "artist.jpg").unlink()
    if target == "directory":
        folder.rmdir()
        folder.symlink_to(outside, target_is_directory=True)
    else:
        (folder / "artist.jpg").symlink_to(outside / "artist.jpg")
    with pytest.raises(PhotoObservationError) as error:
        observe_artist_photo(photo_artist, UID)
    assert error.value.code == "PATH_UNSAFE"


def test_observation_reports_permission_errors_without_leaking_path(
    photo_artist, monkeypatch
):
    original_stat = Path.stat

    def denied(path, *args, **kwargs):
        if path.name == "artist.jpg":
            raise PermissionError("/private/secret")
        return original_stat(path, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", denied)
    with pytest.raises(PhotoObservationError) as error:
        observe_artist_photo(photo_artist, UID)
    assert error.value.code == "FILESYSTEM_UNAVAILABLE"
    assert "/private" not in str(error.value)


def test_cas_participates_in_caller_transaction_and_handles_deleted_artist(
    photo_artist,
):
    before = observe_artist_photo(photo_artist, UID)
    with pytest.raises(RuntimeError), transaction_scope() as session:
        assert _cas(before, session=session) == "applied"
        raise RuntimeError("roll back")
    assert read_artist_photo(UID)["has_photo"] == 0
    with transaction_scope() as session:
        session.execute(
            text("DELETE FROM library_artists WHERE entity_uid=CAST(:uid AS uuid)"),
            {"uid": UID},
        )
    assert _cas(before) == "not_found"
    assert read_artist_photo(UID) is None


def test_admin_dry_run_is_pure_and_apply_is_verified_and_audited(photo_artist):
    issue = _issue(photo_artist)
    repairer = LibraryRepair(photo_artist)
    before_files = (
        Path(photo_artist["library_path"]) / "echo" / "artist.jpg"
    ).read_bytes()
    preview = repairer.preview({"issues": [issue]})
    assert preview["executable"] == 1
    assert read_artist_photo(UID)["has_photo"] == 0
    result = repairer.repair({"issues": [issue]}, dry_run=False)
    action = result["actions"][0]
    assert action["applied"] and action["verified"]
    assert action["details"]["verification"] == "verified"
    assert read_artist_photo(UID)["has_photo"] == 1
    assert read_artist_photo(OTHER_UID)["has_photo"] == 1
    assert (
        Path(photo_artist["library_path"]) / "echo" / "artist.jpg"
    ).read_bytes() == before_files
    with read_scope() as session:
        details = session.execute(
            text("SELECT details_json FROM audit_log WHERE action='fix_has_photo'")
        ).scalar_one()
    assert details == {"artist_uid": UID, "before": False, "after": True}
    assert (
        repairer.repair({"issues": [issue]}, dry_run=False)["actions"][0]["details"][
            "status"
        ]
        == "already_satisfied"
    )


@pytest.mark.parametrize("change", ["rename", "delete", "photo", "folder"])
def test_admin_repair_rejects_stale_identity_or_photo(photo_artist, change):
    issue = _issue(photo_artist)
    if change == "photo":
        (Path(photo_artist["library_path"]) / "echo" / "artist.jpg").unlink()
    else:
        statement = {
            "rename": "UPDATE library_artists SET name='Renamed'",
            "folder": "UPDATE library_artists SET folder_name='other'",
            "delete": "DELETE FROM library_artists",
        }[change]
        with transaction_scope() as session:
            session.execute(
                text(statement + " WHERE entity_uid=CAST(:uid AS uuid)"), {"uid": UID}
            )
    result = LibraryRepair(photo_artist).repair({"issues": [issue]}, dry_run=False)
    assert not result["actions"][0]["applied"]
    assert result["actions"][0]["details"]["status"] in {"failed", "conflict"}
    assert result["resolved_ids"] == []


def test_admin_mutation_rolls_back_if_audit_fails(photo_artist, monkeypatch):
    from sqlalchemy.orm import Session

    observation = observe_artist_photo(photo_artist, UID)
    execute = Session.execute

    def fail_audit(session, statement, *args, **kwargs):
        if "INSERT INTO audit_log" in str(statement):
            raise RuntimeError("audit failed")
        return execute(session, statement, *args, **kwargs)

    monkeypatch.setattr(Session, "execute", fail_audit)
    with pytest.raises(RuntimeError, match="audit failed"):
        apply_admin_artist_photo(observation)
    assert read_artist_photo(UID)["has_photo"] == 0


def test_targeted_photo_check_does_not_touch_other_artist_or_global_run(
    photo_artist, monkeypatch
):
    def forbidden(*args, **kwargs):
        raise AssertionError("Global health query is forbidden")

    monkeypatch.setattr("crate.health_check.get_artists_with_photo", forbidden)
    checker = LibraryHealthCheck(photo_artist)
    report = checker.run_selected_for_artists(["has_photo_desync"], ["Echo"])
    assert len(report["issues"]) == 1
    assert report["issues"][0]["details"]["artist_uid"] == UID
    assert read_artist_photo(UID)["has_photo"] == 0
    from crate.db.queries.health import get_artists_with_photo

    rows = get_artists_with_photo()
    assert {str(row["entity_uid"]) for row in rows} == {UID, OTHER_UID}
    with read_scope() as session:
        assert (
            session.execute(
                text(
                    "SELECT count(*) FROM health_check_runs WHERE check_type='has_photo_desync'"
                )
            ).scalar_one()
            == 0
        )
        assert (
            session.execute(
                text(
                    "SELECT count(*) FROM health_issues WHERE details_json->>'artist'='Untouched'"
                )
            ).scalar_one()
            == 0
        )


def test_admin_keeps_issue_unresolved_when_photo_changes_during_write(
    photo_artist, monkeypatch
):
    issue = _issue(photo_artist)
    issue["id"] = 123
    apply = apply_admin_artist_photo

    def change_after_write(observation, **kwargs):
        outcome = apply(observation, **kwargs)
        (Path(photo_artist["library_path"]) / "echo" / "artist.jpg").unlink()
        return outcome

    monkeypatch.setattr("crate.repair.apply_admin_artist_photo", change_after_write)
    result = LibraryRepair(photo_artist).repair({"issues": [issue]}, dry_run=False)
    action = result["actions"][0]
    assert action["applied"] is True
    assert action["verified"] is False
    assert action["details"]["verification"] == "conflict"
    assert result["resolved_ids"] == []


def test_old_photo_issue_requires_recheck_instead_of_name_resolution(photo_artist):
    issue = _issue(photo_artist)
    del issue["details"]["artist_uid"]
    repairer = LibraryRepair(photo_artist)
    preview = repairer.preview({"issues": [issue]})
    assert preview["executable"] == 0
    result = repairer.repair({"issues": [issue]}, dry_run=False)
    assert result["actions"][0]["details"]["reason"] == "recheck_required"
    assert read_artist_photo(UID)["has_photo"] == 0
