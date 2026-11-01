"""Bounded aggregate readings for the live Stack map. Counts only, no identities."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope

LISTENING_PRESENCE_SECONDS = 90


def count_listening_now(
    window_seconds: int = LISTENING_PRESENCE_SECONDS, *, session: Session | None = None
) -> int:
    """Devices reporting a playing state that also sent presence within the window."""

    def _impl(current: Session) -> int:
        return int(
            current.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM user_playback_device_states s
                    JOIN user_devices d
                      ON d.user_id = s.user_id
                     AND d.device_id = s.device_id
                    WHERE s.status = 'playing'
                      AND d.revoked_at IS NULL
                      AND d.last_seen_at > NOW() - make_interval(secs => :window)
                    """
                ),
                {"window": max(1, int(window_seconds))},
            ).scalar_one()
        )

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)
