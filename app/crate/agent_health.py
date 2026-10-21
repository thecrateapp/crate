"""Explicit checks compile to reviewable scope and run only in workers."""

from uuid import UUID

from crate.db.jobs.artist_photo import read_artist_photo, with_artist_identity
from crate.health_check import ARTIST_SCOPED_CHECKS, LibraryHealthCheck
from crate.repair_catalog import REPAIR_CATALOG_BY_CHECK


def compile_operation(operation: str, parameters: dict, config: dict) -> dict:
    if operation not in {"health_check", "quality_check"} or set(parameters) - {
        "scope",
        "artist_uid",
        "check_types",
    }:
        raise ValueError("Unsupported health operation")
    scope = parameters.get("scope")
    if scope not in {"artist", "global"} or (
        operation == "quality_check" and scope != "global"
    ):
        raise ValueError("Select an explicit supported check scope")
    if operation == "quality_check" and set(parameters) != {"scope"}:
        raise ValueError("Quality checks accept only an explicit global scope")
    checks = [] if operation == "quality_check" else parameters.get("check_types")
    if (
        not isinstance(checks, list)
        or (operation == "health_check" and not checks)
        or len(checks) != len(set(checks))
        or any(c not in REPAIR_CATALOG_BY_CHECK for c in checks)
    ):
        raise ValueError("Select unique catalogued health checks")
    artist = None
    if scope == "artist":
        if not checks or not set(checks) <= set(ARTIST_SCOPED_CHECKS):
            raise ValueError("These checks do not support artist scope")
        uid = str(UUID(str(parameters.get("artist_uid"))))
        artist = read_artist_photo(uid)
        if artist is None:
            raise ValueError("Artist is not in the local library")
        target = {"entity_type": "artist", "entity_uid": uid, "name": artist["name"]}
    else:
        if parameters.get("artist_uid") is not None:
            raise ValueError("Global check cannot include an artist UID")
        target = {"entity_type": "library", "scope": "global"}
    return {
        "document": {
            "operation": operation,
            "targets": [target],
            "source_versions": {"artist": artist},
            "changes": [
                {
                    "action": "scan_metadata"
                    if operation == "quality_check"
                    else "persist_check_observations",
                    "scope": scope,
                    "checks": checks,
                    **({"entity_uid": artist["artist_uid"]} if artist else {}),
                }
            ],
            "impact": {
                "scope": scope,
                "filesystem_writes": False,
                "database": "quality_snapshot"
                if operation == "quality_check"
                else "health_issues_and_observations",
                "scans_audio_metadata": True,
            },
            "risk": "safe",
            "reversibility": "Fresh evidence replaces previous observations; no library files are changed.",
        },
        "execution": {"scope": scope, "artist": artist, "check_types": checks},
    }


def apply_operation(
    operation: str, execution: dict, config: dict, *, task_id: str, authorize
) -> dict:
    if operation == "quality_check":
        from crate.worker_handlers.quality import _handle_quality_check

        result = authorize(
            lambda: _handle_quality_check(task_id, {"scope": "global"}, config)
        )
        return {
            "execution": {"status": result["status"], "report": result},
            "verification": {
                "status": "verified" if result.get("published") else "conflict"
            },
        }
    artist = execution.get("artist")
    if artist and read_artist_photo(artist["artist_uid"]) != artist:
        raise ValueError("Artist identity changed after the check plan")
    checker = LibraryHealthCheck(config)

    def scan():
        def checkpoint(*args, **kwargs):
            authorize()

        if artist:
            artist_name = artist["name"]
            return with_artist_identity(
                artist,
                lambda: checker.run_selected_for_artists(
                    execution["check_types"],
                    [artist_name],
                    persist=True,
                    progress_callback=checkpoint,
                ),
            )
        return checker.run_selected(
            execution["check_types"], persist=True, progress_callback=checkpoint
        )

    report = authorize(scan)
    failed = report.get("failed_checks", [])
    return {
        "execution": {
            "status": "partial"
            if failed and report.get("completed_checks")
            else "failed"
            if failed
            else "completed",
            "issue_count": len(report.get("issues", [])),
            "checks": execution["check_types"],
            "failed_checks": failed,
        },
        "verification": {
            "status": "incomplete" if failed else "observed",
            "coverage": "artist" if artist else "global_check_specific",
        },
    }


__all__ = ["compile_operation", "apply_operation"]
