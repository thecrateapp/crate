"""Identity-based, composable persistence for the artist photo flag."""

import json

from sqlalchemy import text

from crate.db.domain_events import append_domain_event
from crate.db.tx import optional_scope, read_scope
from crate.db.ui_snapshot_writes import mark_ui_snapshots_stale


def read_artist_photo(artist_uid: str, *, session=None) -> dict | None:
    def _read(current):
        row = (
            current.execute(
                text("""
                SELECT entity_uid::text AS artist_uid, name, folder_name, has_photo
                FROM library_artists WHERE entity_uid = CAST(:uid AS uuid)
            """),
                {"uid": artist_uid},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None

    if session is not None:
        return _read(session)
    with read_scope() as current:
        return _read(current)


def compare_and_set_artist_photo(
    artist_uid: str,
    *,
    expected_has_photo: bool,
    expected_name: str,
    expected_folder_name: str | None,
    has_photo: bool,
    session=None,
) -> str:
    with optional_scope(session) as current:
        row = (
            current.execute(
                text("""
                SELECT name, folder_name, has_photo
                FROM library_artists WHERE entity_uid = CAST(:uid AS uuid)
                FOR UPDATE
            """),
                {"uid": artist_uid},
            )
            .mappings()
            .first()
        )
        if row is None:
            return "not_found"
        if row["name"] != expected_name or row["folder_name"] != expected_folder_name:
            return "conflict"
        if bool(row["has_photo"]) == bool(has_photo):
            return "already_satisfied"
        if bool(row["has_photo"]) != bool(expected_has_photo):
            return "conflict"
        updated = current.execute(
            text("""
                UPDATE library_artists SET has_photo = :photo, updated_at = NOW()
                WHERE entity_uid = CAST(:uid AS uuid)
                  AND name = :name AND folder_name IS NOT DISTINCT FROM :folder
                  AND has_photo IS NOT DISTINCT FROM :expected
                RETURNING entity_uid
            """),
            {
                "uid": artist_uid,
                "name": expected_name,
                "folder": expected_folder_name,
                "expected": row["has_photo"],
                "photo": int(bool(has_photo)),
            },
        ).scalar_one_or_none()
        return "applied" if updated is not None else "conflict"


def apply_admin_artist_photo(observation: dict, *, task_id=None, session=None) -> str:
    with optional_scope(session) as current:
        outcome = compare_and_set_artist_photo(
            observation["artist_uid"],
            expected_has_photo=observation["db_has_photo"],
            expected_name=observation["name"],
            expected_folder_name=observation["folder_name"],
            has_photo=observation["fs_has_photo"],
            session=current,
        )
        if outcome == "applied":
            details = {
                "artist_uid": observation["artist_uid"],
                "before": observation["db_has_photo"],
                "after": observation["fs_has_photo"],
            }
            current.execute(
                text("""
                    INSERT INTO audit_log
                        (timestamp, action, target_type, target_name, details_json, task_id)
                    VALUES (NOW(), 'fix_has_photo', 'artist', :name, CAST(:details AS jsonb), :task_id)
                """),
                {
                    "name": observation["name"],
                    "details": json.dumps(details),
                    "task_id": task_id,
                },
            )
            mark_ui_snapshots_stale(scope="ops:health", session=current)
            scope = f"artist:{observation['artist_uid']}"
            append_domain_event(
                "ui.invalidate",
                {"scope": scope},
                scope="ui.invalidate",
                subject_key=scope,
                session=current,
            )
        return outcome


__all__ = [
    "apply_admin_artist_photo",
    "compare_and_set_artist_photo",
    "read_artist_photo",
]
