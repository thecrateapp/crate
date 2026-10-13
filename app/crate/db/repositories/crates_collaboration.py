"""Owner-managed collaborators and copies for Crates."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.domain_events import append_domain_event
from crate.db.repositories.crates import create_crate
from crate.db.tx import optional_scope


def add_crate_collaborator(
    crate_id: str,
    user_id: int,
    *,
    added_by: int,
    session: Session | None = None,
) -> None:
    with optional_scope(session) as current:
        current.execute(
            text(
                """
                INSERT INTO crate_members (crate_id, user_id, invited_by)
                VALUES (CAST(:crate_id AS uuid), :user_id, :added_by)
                ON CONFLICT (crate_id, user_id) DO NOTHING
                """
            ),
            {"crate_id": crate_id, "user_id": user_id, "added_by": added_by},
        )
        current.execute(
            text(
                "UPDATE crates SET is_collaborative = TRUE "
                "WHERE id = CAST(:crate_id AS uuid)"
            ),
            {"crate_id": crate_id},
        )
        append_domain_event(
            "crate.collaborator_added",
            {"crate_id": crate_id, "user_id": user_id, "added_by": added_by},
            scope="crate",
            subject_key=crate_id,
            session=current,
        )


def copy_crate(source: dict, user_id: int, *, session: Session | None = None) -> str:
    with optional_scope(session) as current:
        new_id = create_crate(
            user_id,
            str(source.get("name") or "Crate"),
            description=str(source.get("description") or ""),
            visibility="private",
            is_ordered=bool(source.get("is_ordered", True)),
            sort_direction=str(source.get("sort_direction") or "asc"),
            loop_enabled=bool(source.get("loop_enabled", False)),
            session=current,
        )
        current.execute(
            text(
                """
                INSERT INTO crate_albums (crate_id, global_album_uid, position, added_by)
                SELECT CAST(:new_id AS uuid), global_album_uid, position, :user_id
                FROM crate_albums
                WHERE crate_id = CAST(:source_id AS uuid)
                ORDER BY position
                """
            ),
            {"new_id": new_id, "source_id": str(source["id"]), "user_id": user_id},
        )
        return new_id


__all__ = ["add_crate_collaborator", "copy_crate"]
