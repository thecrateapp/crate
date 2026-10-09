"""Health issues — persistent issue tracking for library health."""

import json
from datetime import datetime, timezone

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope
from crate.health_issue_text import health_issue_identity


def upsert_health_issue(
    check_type: str,
    severity: str,
    description: str,
    details: dict | None = None,
    auto_fixable: bool = False,
    *,
    session=None,
) -> int | None:
    """Insert or refresh an open health issue keyed by its stable identity.

    Returns the issue id, or None when the same issue was dismissed before."""
    if session is None:
        with transaction_scope() as s:
            return upsert_health_issue(
                check_type, severity, description, details, auto_fixable, session=s
            )
    details = details or {}
    album_id = details.get("album_id")
    now = datetime.now(timezone.utc).isoformat()
    row = (
        session.execute(
            text("""
            INSERT INTO health_issues (
                check_type, severity, description, details_json, auto_fixable,
                status, created_at, identity_key, artist_id, album_id, last_seen_at
            )
            SELECT :check_type, :severity, :description, :details_json, :auto_fixable,
                   'open', :now, :identity_key,
                   COALESCE(
                       (SELECT id FROM library_artists WHERE name = :artist LIMIT 1),
                       (SELECT la.id FROM library_albums al
                        JOIN library_artists la ON la.name = al.artist
                        WHERE al.id = :album_id LIMIT 1)
                   ),
                   (SELECT id FROM library_albums WHERE id = :album_id),
                   :now
            WHERE NOT EXISTS (
                SELECT 1 FROM health_issues dismissed
                WHERE dismissed.check_type = :check_type
                  AND dismissed.identity_key = :identity_key
                  AND dismissed.status = 'dismissed'
            )
            ON CONFLICT (check_type, identity_key) WHERE status = 'open'
            DO UPDATE SET severity = EXCLUDED.severity,
                          description = EXCLUDED.description,
                          details_json = EXCLUDED.details_json,
                          auto_fixable = EXCLUDED.auto_fixable,
                          artist_id = EXCLUDED.artist_id,
                          album_id = EXCLUDED.album_id,
                          last_seen_at = EXCLUDED.last_seen_at
            RETURNING id
        """),
            {
                "check_type": check_type,
                "severity": severity,
                "description": description,
                "details_json": json.dumps(details, default=str),
                "auto_fixable": auto_fixable,
                "now": now,
                "identity_key": health_issue_identity(check_type, details, description),
                "artist": details.get("artist") or details.get("db_artist"),
                "album_id": album_id if isinstance(album_id, int) else None,
            },
        )
        .mappings()
        .first()
    )
    return row["id"] if row else None


def get_open_issues(check_type: str | None = None, limit: int = 500) -> list[dict]:
    """Get all open health issues, optionally filtered by type."""
    with read_scope() as session:
        if check_type:
            rows = (
                session.execute(
                    text(
                        "SELECT * FROM health_issues WHERE status = 'open' AND check_type = :check_type ORDER BY severity, created_at DESC LIMIT :lim"
                    ),
                    {"check_type": check_type, "lim": limit},
                )
                .mappings()
                .all()
            )
        else:
            rows = (
                session.execute(
                    text(
                        "SELECT * FROM health_issues WHERE status = 'open' ORDER BY severity, created_at DESC LIMIT :lim"
                    ),
                    {"lim": limit},
                )
                .mappings()
                .all()
            )
        return [dict(r) for r in rows]


def get_issue_counts() -> dict:
    """Get count of open issues grouped by check_type."""
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT check_type, COUNT(*) AS cnt FROM health_issues WHERE status = 'open' GROUP BY check_type ORDER BY cnt DESC"
                )
            )
            .mappings()
            .all()
        )
        return {r["check_type"]: r["cnt"] for r in rows}


def resolve_issue(issue_id: int, *, session=None):
    """Mark a single issue as fixed."""
    if session is None:
        with transaction_scope() as s:
            return resolve_issue(issue_id, session=s)
    now = datetime.now(timezone.utc).isoformat()
    session.execute(
        text(
            "UPDATE health_issues SET status = 'fixed', resolved_at = :now WHERE id = :id"
        ),
        {"now": now, "id": issue_id},
    )


def resolve_issues_by_type(check_type: str, *, session=None):
    """Mark all open issues of a given type as fixed (e.g. after a repair run)."""
    if session is None:
        with transaction_scope() as s:
            return resolve_issues_by_type(check_type, session=s)
    now = datetime.now(timezone.utc).isoformat()
    session.execute(
        text(
            "UPDATE health_issues SET status = 'fixed', resolved_at = :now WHERE check_type = :check_type AND status = 'open'"
        ),
        {"now": now, "check_type": check_type},
    )


def dismiss_issue(issue_id: int, *, session=None):
    """Dismiss an issue (user decided it's not a problem)."""
    if session is None:
        with transaction_scope() as s:
            return dismiss_issue(issue_id, session=s)
    now = datetime.now(timezone.utc).isoformat()
    session.execute(
        text(
            "UPDATE health_issues SET status = 'dismissed', resolved_at = :now WHERE id = :id"
        ),
        {"now": now, "id": issue_id},
    )


def resolve_stale_issues(
    current_identities: set[str], check_type: str, *, session=None
):
    """Resolve open issues of a check_type that no longer appear in a fresh scan.
    This auto-cleans issues that were fixed externally."""
    if session is None:
        with transaction_scope() as s:
            return resolve_stale_issues(current_identities, check_type, session=s)
    rows = (
        session.execute(
            text(
                "SELECT id, identity_key FROM health_issues WHERE check_type = :check_type AND status = 'open'"
            ),
            {"check_type": check_type},
        )
        .mappings()
        .all()
    )
    for row in rows:
        if row["identity_key"] not in current_identities:
            resolve_issue(row["id"], session=session)


def resolve_stale_artist_issues(
    current_identities: set[str],
    check_type: str,
    artist_names: list[str] | set[str] | tuple[str, ...],
    *,
    session=None,
):
    """Resolve open artist-scoped issues that disappeared in a targeted scan."""
    artists = [str(name).strip() for name in artist_names if str(name).strip()]
    if not artists:
        return
    if session is None:
        with transaction_scope() as s:
            return resolve_stale_artist_issues(
                current_identities, check_type, artists, session=s
            )
    rows = (
        session.execute(
            text(
                """
            SELECT id, identity_key
            FROM health_issues
            WHERE check_type = :check_type
              AND status = 'open'
              AND (
                  details_json->>'artist' = ANY(:artists)
                  OR details_json->>'db_artist' = ANY(:artists)
              )
            """
            ),
            {"check_type": check_type, "artists": artists},
        )
        .mappings()
        .all()
    )
    for row in rows:
        if row["identity_key"] not in current_identities:
            resolve_issue(row["id"], session=session)


def cleanup_old_resolved(days: int = 30, *, session=None):
    """Delete fixed issues older than N days; dismissals are kept so they stay dismissed."""
    if session is None:
        with transaction_scope() as s:
            return cleanup_old_resolved(days, session=s)
    session.execute(
        text("""
        DELETE FROM health_issues
        WHERE status = 'fixed'
        AND resolved_at < NOW() - make_interval(days => :days)
    """),
        {"days": days},
    )


def get_artist_issues(artist_name: str) -> list[dict]:
    """Get open health issues related to a specific artist."""
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT * FROM health_issues WHERE status = 'open' "
                    "AND (details_json->>'artist' = :artist OR details_json->>'db_artist' = :artist) "
                    "ORDER BY severity, created_at DESC"
                ),
                {"artist": artist_name},
            )
            .mappings()
            .all()
        )
        return [dict(r) for r in rows]


def get_artist_issue_count(artist_name: str) -> int:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    "SELECT COUNT(*) AS cnt FROM health_issues WHERE status = 'open' "
                    "AND (details_json->>'artist' = :artist OR details_json->>'db_artist' = :artist)"
                ),
                {"artist": artist_name},
            )
            .mappings()
            .first()
        )
        return int(row["cnt"] or 0) if row is not None else 0


def get_all_artist_issue_counts() -> dict[str, int]:
    """Get issue counts grouped by artist for all open issues."""
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT details_json->>'artist' AS artist, COUNT(*) AS cnt "
                    "FROM health_issues WHERE status = 'open' AND details_json->>'artist' IS NOT NULL "
                    "GROUP BY details_json->>'artist'"
                )
            )
            .mappings()
            .all()
        )
        return {r["artist"]: r["cnt"] for r in rows}
