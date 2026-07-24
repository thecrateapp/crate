"""Database claims and state transitions for scrobble dispatch."""

from __future__ import annotations

from sqlalchemy import text

from crate.db.tx import transaction_scope


def claim_scrobble_dispatch(event_id: int) -> tuple[str, dict | None]:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO user_scrobble_dispatches (event_id)
                VALUES (:event_id)
                ON CONFLICT (event_id) DO NOTHING
                """
            ),
            {"event_id": event_id},
        )
        row = (
            session.execute(
                text(
                    """
                    UPDATE user_scrobble_dispatches dispatch
                    SET status = 'processing',
                        attempts = dispatch.attempts + 1,
                        locked_at = NOW(),
                        updated_at = NOW(),
                        last_error = NULL
                    FROM user_play_events event
                    JOIN users user_account ON user_account.id = event.user_id
                    WHERE dispatch.event_id = :event_id
                      AND event.id = dispatch.event_id
                      AND (
                          dispatch.status IN ('pending', 'failed')
                          OR (
                              dispatch.status = 'processing'
                              AND dispatch.locked_at < NOW() - INTERVAL '5 minutes'
                          )
                      )
                    RETURNING event.user_id,
                              event.artist,
                              event.title,
                              event.album,
                              event.started_at,
                              event.content_origin,
                              user_account.remote_scrobbling_enabled
                    """
                ),
                {"event_id": event_id},
            )
            .mappings()
            .first()
        )
        if row is not None:
            return "claimed", dict(row)
        status = session.execute(
            text(
                "SELECT status FROM user_scrobble_dispatches WHERE event_id = :event_id"
            ),
            {"event_id": event_id},
        ).scalar_one_or_none()
        return str(status or "missing"), None


def finish_scrobble_dispatch(
    event_id: int, status: str, *, error: str | None = None
) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                UPDATE user_scrobble_dispatches
                SET status = :status,
                    last_error = :error,
                    locked_at = NULL,
                    updated_at = NOW(),
                    completed_at = CASE
                        WHEN :status IN ('completed', 'skipped') THEN NOW()
                        ELSE NULL
                    END
                WHERE event_id = :event_id
                  AND status = 'processing'
                """
            ),
            {"event_id": event_id, "status": status, "error": error},
        )


__all__ = ["claim_scrobble_dispatch", "finish_scrobble_dispatch"]
