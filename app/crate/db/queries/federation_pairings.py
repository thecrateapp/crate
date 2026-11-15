"""Safe, bounded pairing summaries for the federation administration surface."""

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope


def list_latest_pairings(
    *, limit: int = 200, session: Session | None = None
) -> list[dict]:
    """Latest per peer/direction, newest created first; never expose envelopes."""
    limit = min(max(int(limit), 1), 500)

    def _impl(current):
        rows = current.execute(
            text(
                """
                WITH latest AS (
                    SELECT DISTINCT ON (remote_node_uid, direction)
                        pairing_uid, remote_node_uid, direction, state,
                        expires_at, created_at
                    FROM federation_pairings
                    WHERE remote_node_uid IS NOT NULL
                    ORDER BY remote_node_uid, direction, created_at DESC, pairing_uid DESC
                )
                SELECT pairing_uid, remote_node_uid, direction, state, expires_at
                FROM latest
                ORDER BY created_at DESC, pairing_uid DESC
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings()
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["list_latest_pairings"]
