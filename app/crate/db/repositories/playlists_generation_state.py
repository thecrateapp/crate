"""Generation logging and status helpers for playlists."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import optional_scope


def log_generation_start(
    playlist_id: int, rules: dict | None, triggered_by: str = "manual"
) -> int:
    with optional_scope(None) as s:
        row = (
            s.execute(
                text(
                    """
                INSERT INTO playlist_generation_log (playlist_id, started_at, status, rule_snapshot_json, triggered_by)
                VALUES (:playlist_id, :started_at, 'running', :rule_snapshot_json, :triggered_by)
                RETURNING id
                """
                ),
                {
                    "playlist_id": playlist_id,
                    "started_at": datetime.now(timezone.utc).isoformat(),
                    "rule_snapshot_json": json.dumps(rules, default=str)
                    if rules
                    else None,
                    "triggered_by": triggered_by,
                },
            )
            .mappings()
            .first()
        )
        return row["id"] if row else 0


def log_generation_complete(log_id: int, track_count: int, duration_sec: int) -> None:
    with optional_scope(None) as s:
        s.execute(
            text(
                """
                UPDATE playlist_generation_log
                SET status = 'completed', completed_at = :completed_at, track_count = :track_count, duration_sec = :duration_sec
                WHERE id = :log_id
                """
            ),
            {
                "log_id": log_id,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "track_count": track_count,
                "duration_sec": duration_sec,
            },
        )


def log_generation_failed(log_id: int, error: str) -> None:
    with optional_scope(None) as s:
        s.execute(
            text(
                """
                UPDATE playlist_generation_log
                SET status = 'failed', completed_at = :completed_at, error = :error
                WHERE id = :log_id
                """
            ),
            {
                "log_id": log_id,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "error": error[:500],
            },
        )


def set_generation_status(
    playlist_id: int,
    status: str,
    error: str | None = None,
    *,
    expected_epoch: int | None = None,
    expected_revision: int | None = None,
) -> tuple[int, int] | None:
    updates = ["generation_status = :status", "updated_at = :now"]
    params: dict[str, object] = {
        "playlist_id": playlist_id,
        "status": status,
        "now": datetime.now(timezone.utc).isoformat(),
    }
    if status == "idle":
        updates.append("last_generated_at = :now")
        updates.append("generation_error = NULL")
    elif status == "failed" and error:
        updates.append("generation_error = :error")
        params["error"] = error[:500]
    if status == "running":
        updates.append("generation_epoch = generation_epoch + 1")
    if expected_epoch is not None:
        params["expected_epoch"] = expected_epoch
    if expected_revision is not None:
        params["expected_revision"] = expected_revision

    # SQL_SAFE: updates are built internally from hardcoded column assignments.
    with optional_scope(None) as s:
        row = s.execute(
            text(
                f"UPDATE playlists SET {', '.join(updates)} WHERE id = :playlist_id"
                + (
                    " AND generation_epoch = :expected_epoch"
                    if expected_epoch is not None
                    else ""
                )
                + (
                    " AND editorial_revision = :expected_revision"
                    if expected_revision is not None
                    else ""
                )
                + " RETURNING editorial_revision, generation_epoch"
            ),
            params,
        ).first()
        return (int(row[0]), int(row[1])) if row else None


def enqueue_system_playlist_generation(
    playlist_id: int,
    *,
    actor_user_id: int | None = None,
    triggered_by: str = "manual",
    expected_revision: int | None = None,
    expected_epoch: int | None = None,
    session=None,
) -> dict:
    """Deduplicate manual generation and status under one playlist row lock."""
    from crate.db.repositories.tasks_mutations import create_task_dedup

    with optional_scope(session) as current:
        playlist = (
            current.execute(
                text("""SELECT id,generation_mode,smart_rules_json,is_active,
                    auto_refresh_enabled,editorial_revision,generation_epoch
            FROM playlists WHERE id=:id AND scope='system' FOR UPDATE"""),
                {"id": playlist_id},
            )
            .mappings()
            .first()
        )
        if (
            playlist is None
            or playlist["generation_mode"] != "smart"
            or not playlist["smart_rules_json"]
        ):
            raise ValueError("Not a smart system playlist")
        if triggered_by == "scheduler" and (
            not playlist["is_active"] or not playlist["auto_refresh_enabled"]
        ):
            raise ValueError("Playlist is no longer eligible for automatic refresh")
        if (
            expected_revision is not None
            and playlist["editorial_revision"] != expected_revision
        ) or (
            expected_epoch is not None
            and playlist["generation_epoch"] != expected_epoch
        ):
            raise ValueError("Playlist changed before generation was enqueued")
        dedup_key = f"system-playlist:{playlist_id}"
        task_id = create_task_dedup(
            "generate_system_playlist",
            {
                "playlist_id": playlist_id,
                "triggered_by": triggered_by,
                "expected_revision": playlist["editorial_revision"],
                "expected_epoch": playlist["generation_epoch"] + 1,
            },
            dedup_key=dedup_key,
            session=current,
            origin="scheduler" if triggered_by == "scheduler" else "admin",
            actor_user_id=actor_user_id,
        )
        if task_id:
            current.execute(
                text("""UPDATE playlists SET generation_status='queued',
                generation_epoch=generation_epoch+1,updated_at=NOW() WHERE id=:id"""),
                {"id": playlist_id},
            )
            return {
                "task_id": task_id,
                "generation_status": "queued",
                "deduplicated": False,
            }
        row = (
            current.execute(
                text("""SELECT id,status FROM tasks WHERE type='generate_system_playlist'
            AND dedup_key=:key AND status IN ('pending','running','delegated','completing')
            ORDER BY created_at DESC LIMIT 1"""),
                {"key": dedup_key},
            )
            .mappings()
            .first()
        )
        if row is None:
            raise ValueError("Generation admission changed; retry")
        return {
            "task_id": row["id"],
            "generation_status": "queued"
            if row["status"] == "pending"
            else row["status"],
            "deduplicated": True,
        }


__all__ = [
    "log_generation_complete",
    "log_generation_failed",
    "log_generation_start",
    "set_generation_status",
    "enqueue_system_playlist_generation",
]
