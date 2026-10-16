"""Explicit exact-revision consolidation; callers must authorize its reviewed plan."""

from sqlalchemy import text

from crate.db.repositories.show_invalidation import invalidate_show_views
from crate.db.tx import optional_scope


def consolidate_shows(
    canonical_id: int, duplicate_ids: list[int], revisions: dict, *, session=None
) -> dict:
    ids = sorted(set([canonical_id, *duplicate_ids]))
    if not duplicate_ids or len(ids) != len(duplicate_ids) + 1 or len(ids) > 10:
        return {
            "status": "invalid",
            "reason": "Choose one canonical show and distinct duplicates",
        }
    with optional_scope(session) as current:
        rows = (
            current.execute(
                text("SELECT * FROM shows WHERE id=ANY(:ids) ORDER BY id FOR UPDATE"),
                {"ids": ids},
            )
            .mappings()
            .all()
        )
        if len(rows) != len(ids) or any(
            row["merged_into_id"] or revisions.get(str(row["id"])) != row["revision"]
            for row in rows
        ):
            return {
                "status": "conflict",
                "matches": ids,
                "reason": "Consolidation selection changed",
            }
        params = {"canonical": canonical_id, "duplicates": duplicate_ids}
        current.execute(
            text("""INSERT INTO user_show_attendance(user_id,show_id,created_at)
            SELECT user_id,:canonical,min(created_at) FROM user_show_attendance
            WHERE show_id=ANY(:duplicates) GROUP BY user_id
            ON CONFLICT(user_id,show_id) DO UPDATE SET created_at=LEAST(user_show_attendance.created_at,EXCLUDED.created_at)"""),
            params,
        )
        current.execute(
            text("DELETE FROM user_show_attendance WHERE show_id=ANY(:duplicates)"),
            params,
        )
        current.execute(
            text("""INSERT INTO user_show_reminders(user_id,show_id,reminder_type,created_at,triggered_at)
            SELECT user_id,:canonical,reminder_type,min(created_at),min(triggered_at)
            FROM user_show_reminders WHERE show_id=ANY(:duplicates) GROUP BY user_id,reminder_type
            ON CONFLICT(user_id,show_id,reminder_type) DO UPDATE SET
            created_at=LEAST(user_show_reminders.created_at,EXCLUDED.created_at),
            triggered_at=LEAST(user_show_reminders.triggered_at,EXCLUDED.triggered_at)"""),
            params,
        )
        current.execute(
            text("DELETE FROM user_show_reminders WHERE show_id=ANY(:duplicates)"),
            params,
        )
        current.execute(
            text(
                "UPDATE show_source_aliases SET show_id=:canonical WHERE show_id=ANY(:duplicates)"
            ),
            params,
        )
        current.execute(
            text("""INSERT INTO show_sources(show_id,fingerprint,provider,actor,evidence,created_at)
            SELECT :canonical,fingerprint,provider,actor,evidence,created_at FROM show_sources WHERE show_id=ANY(:duplicates)
            ON CONFLICT DO NOTHING"""),
            params,
        )
        current.execute(
            text("DELETE FROM show_sources WHERE show_id=ANY(:duplicates)"), params
        )
        current.execute(
            text("""UPDATE shows SET merged_into_id=:canonical,archived_at=NOW(),identity_key=NULL,updated_at=NOW()
            WHERE id=ANY(:duplicates) OR merged_into_id=ANY(:duplicates)"""),
            params,
        )
        lineup = list(
            dict.fromkeys(
                name
                for row in rows
                for name in [row["artist_name"], *(row["lineup"] or [])]
            )
        )
        revision = current.execute(
            text(
                "UPDATE shows SET lineup=:lineup,updated_at=NOW() WHERE id=:canonical RETURNING revision"
            ),
            {**params, "lineup": lineup},
        ).scalar_one()
        invalidate_show_views(lineup, session=current)
        return {
            "status": "completed",
            "show_id": canonical_id,
            "merged_ids": duplicate_ids,
            "revision": revision,
        }


__all__ = ["consolidate_shows"]
