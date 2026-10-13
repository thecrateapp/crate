"""Health issues keep a stable identity, entity links and sticky dismissals."""

from __future__ import annotations

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _artist_and_album(session) -> tuple[int, int, str]:
    row = session.execute(
        text(
            """
            SELECT la.id AS artist_id, al.id AS album_id, la.name
            FROM library_albums al JOIN library_artists la ON la.name = al.artist
            ORDER BY al.id LIMIT 1
            """
        )
    ).one()
    return int(row.artist_id), int(row.album_id), row.name


def _seed_catalog():
    from tests.stats_history import seed_stats_library

    seed_stats_library()


def _issue(session, issue_id: int) -> dict:
    return dict(
        session.execute(
            text("SELECT * FROM health_issues WHERE id = :id"), {"id": issue_id}
        )
        .mappings()
        .one()
    )


def test_upsert_links_artist_and_album_and_refreshes_in_place(pg_db):
    from crate.db.health import upsert_health_issue
    from crate.db.tx import read_scope, transaction_scope

    _seed_catalog()
    with read_scope() as session:
        artist_id, album_id, artist = _artist_and_album(session)
    details = {"album_id": album_id, "album": "X", "title": "T", "count": 2}

    with transaction_scope() as session:
        first = upsert_health_issue(
            "duplicate_tracks", "medium", "a", details, session=session
        )
        again = upsert_health_issue(
            "duplicate_tracks", "high", "b", details, session=session
        )

    with read_scope() as session:
        stored = _issue(session, first)
    assert first == again
    assert stored["artist_id"] == artist_id
    assert stored["album_id"] == album_id
    assert stored["severity"] == "high"
    assert stored["description"] == "b"
    assert artist


def test_dismissed_issues_stay_dismissed_until_their_details_change(pg_db):
    from crate.db.health import dismiss_issue, upsert_health_issue

    details = {"artist": "Nobody", "album": "A", "count": 2}
    issue_id = upsert_health_issue("duplicate_albums", "medium", "dup", details)
    dismiss_issue(issue_id)

    assert upsert_health_issue("duplicate_albums", "medium", "dup", details) is None
    assert (
        upsert_health_issue(
            "duplicate_albums", "medium", "dup", {**details, "count": 3}
        )
        is not None
    )


def test_stale_resolution_uses_identity_and_cleanup_keeps_dismissals(pg_db):
    from crate.db.health import (
        cleanup_old_resolved,
        dismiss_issue,
        resolve_stale_issues,
        upsert_health_issue,
    )
    from crate.db.tx import read_scope, transaction_scope
    from crate.health_issue_text import health_issue_identity

    kept_details = {"artist": "Keep", "album": "A"}
    kept = upsert_health_issue("stale_albums", "medium", "same text", kept_details)
    gone = upsert_health_issue(
        "stale_albums", "medium", "same text", {"artist": "Gone"}
    )
    dismissed = upsert_health_issue(
        "stale_albums", "medium", "x", {"artist": "Dismissed"}
    )
    dismiss_issue(dismissed)

    resolve_stale_issues(
        {health_issue_identity("stale_albums", kept_details, "same text")},
        "stale_albums",
    )
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE health_issues SET resolved_at = now() - interval '90 days' "
                "WHERE status IN ('fixed', 'dismissed')"
            )
        )
    cleanup_old_resolved()

    with read_scope() as session:
        statuses = dict(
            session.execute(
                text("SELECT id, status FROM health_issues WHERE id = ANY(:ids)"),
                {"ids": [kept, gone, dismissed]},
            ).all()
        )
    assert statuses == {kept: "open", dismissed: "dismissed"}


def test_check_runs_and_dismiss_by_type(pg_db):
    from crate.db.health import upsert_health_issue
    from crate.db.queries.health_issues import (
        get_health_check_runs,
        get_open_issue_total,
    )
    from crate.db.repositories.health_issues import (
        dismiss_issues_by_type,
        record_health_check_runs,
    )

    upsert_health_issue("missing_cover", "low", "a", {"artist": "A", "album": "1"})
    upsert_health_issue("missing_cover", "low", "b", {"artist": "B", "album": "2"})
    record_health_check_runs({"missing_cover": 2, "stale_tracks": 0}, 1500)

    runs = get_health_check_runs()
    assert runs["missing_cover"]["issue_count"] == 2
    assert runs["stale_tracks"]["duration_ms"] == 1500
    assert get_open_issue_total() == 2
    assert dismiss_issues_by_type("missing_cover") == 2
    assert get_open_issue_total() == 0


def test_artist_browse_filters_artists_with_open_issues(pg_db, test_app):
    from crate.db.health import upsert_health_issue
    from crate.db.tx import read_scope

    _seed_catalog()
    with read_scope() as session:
        artist_id, album_id, artist = _artist_and_album(session)
    upsert_health_issue(
        "missing_cover", "low", "cover", {"artist": artist, "album": "x"}
    )

    flagged = test_app.get("/api/artists?has_issues=true&per_page=50").json()
    clean = test_app.get("/api/artists?has_issues=false&per_page=50").json()

    assert [item["name"] for item in flagged["items"]] == [artist]
    assert flagged["items"][0]["issue_count"] == 1
    assert flagged["items"][0]["has_issues"] is True
    assert artist not in [item["name"] for item in clean["items"]]
    assert all(item["issue_count"] == 0 for item in clean["items"])


def test_dismiss_type_endpoint_dismisses_instead_of_fixing(pg_db, test_app):
    from crate.db.health import upsert_health_issue
    from crate.db.tx import read_scope

    issue_id = upsert_health_issue("missing_cover", "low", "a", {"artist": "A"})

    response = test_app.post("/api/manage/health-issues/dismiss-type/missing_cover")

    assert response.status_code == 200
    with read_scope() as session:
        assert _issue(session, issue_id)["status"] == "dismissed"
