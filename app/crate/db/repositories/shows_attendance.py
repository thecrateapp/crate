from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import transaction_scope


def _rowcount(result: object) -> int:
    return int(getattr(result, "rowcount", 0) or 0)


def _canonical_id(session, show_id):
    # Hold redirect topology stable through the relation mutation. Consolidation
    # takes the exclusive counterpart before any show row locks.
    session.execute(
        text(
            "SELECT pg_advisory_xact_lock_shared(hashtextextended('show:redirects',0))"
        )
    )
    return session.execute(
        text("SELECT COALESCE(merged_into_id,id) FROM shows WHERE id=:id"),
        {"id": show_id},
    ).scalar_one()


def attend_show(user_id: int, show_id: int) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        show_id = _canonical_id(session, show_id)
        result = session.execute(
            text(
                """
                INSERT INTO user_show_attendance (user_id, show_id, created_at)
                VALUES (:user_id, :show_id, :now)
                ON CONFLICT DO NOTHING
                """
            ),
            {"user_id": user_id, "show_id": show_id, "now": now},
        )
    return bool(_rowcount(result))


def unattend_show(user_id: int, show_id: int) -> bool:
    with transaction_scope() as session:
        show_id = _canonical_id(session, show_id)
        result = session.execute(
            text(
                "DELETE FROM user_show_attendance WHERE user_id = :user_id AND show_id = :show_id"
            ),
            {"user_id": user_id, "show_id": show_id},
        )
    return bool(_rowcount(result))


def create_show_reminder(user_id: int, show_id: int, reminder_type: str) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    with transaction_scope() as session:
        show_id = _canonical_id(session, show_id)
        result = session.execute(
            text(
                """
                INSERT INTO user_show_reminders (user_id, show_id, reminder_type, created_at, triggered_at)
                VALUES (:user_id, :show_id, :reminder_type, :now, NULL)
                ON CONFLICT (user_id, show_id, reminder_type) DO NOTHING
                """
            ),
            {
                "user_id": user_id,
                "show_id": show_id,
                "reminder_type": reminder_type,
                "now": now,
            },
        )
    return bool(_rowcount(result))


__all__ = ["attend_show", "create_show_reminder", "unattend_show"]
