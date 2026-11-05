"""PostgreSQL behaviour of the error inbox tables, repository and read queries."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import text

NOW = datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc)


def _row(external_id, **overrides):
    row = {
        "external_id": str(external_id),
        "short_id": f"CRATE-API-{external_id}",
        "project_slug": "crate-api",
        "service": "api",
        "title": "IntegrityError: duplicate key",
        "culprit": "library_pipeline",
        "level": "error",
        "status": "unresolved",
        "substatus": "ongoing",
        "sentry_priority": "high",
        "issue_category": "error",
        "events_total": 10,
        "users_total": 1,
        "events_24h": 2,
        "users_24h": 1,
        "first_seen": NOW - timedelta(days=3),
        "last_seen": NOW - timedelta(hours=1),
        "first_release": "crate-a",
        "last_release": "crate-b",
        "permalink": f"https://ninja-development.sentry.io/issues/{external_id}/",
        "crate_score": 40,
    }
    row.update(overrides)
    return row


def _scope():
    from crate.db.tx import transaction_scope

    return transaction_scope()


def _ids() -> dict[str, str]:
    with _scope() as session:
        rows = session.execute(
            text("SELECT external_id, id::text AS id FROM error_issues")
        ).all()
    return {row.external_id: row.id for row in rows}


def _column(issue_id: str, column: str):
    with _scope() as session:
        return session.execute(
            text(f"SELECT {column} FROM error_issues WHERE id = CAST(:id AS uuid)"),
            {"id": issue_id},
        ).scalar_one_or_none()


def _insert_triage(
    issue_id,
    digest_hash,
    *,
    severity="low",
    classification="bug",
    confidence=0.9,
    kind="triage",
    created_at=NOW,
):
    with _scope() as session:
        session.execute(
            text(
                """
                INSERT INTO error_issue_triage
                    (issue_id, kind, digest_hash, classification, severity, summary,
                     confidence, created_at)
                VALUES (CAST(:issue_id AS uuid), :kind, :digest_hash, :classification,
                        :severity, 'summary', :confidence, :created_at)
                """
            ),
            {
                "issue_id": issue_id,
                "kind": kind,
                "digest_hash": digest_hash,
                "classification": classification,
                "severity": severity,
                "confidence": confidence,
                "created_at": created_at,
            },
        )


def _digest(issue_id, digest_hash, *, service=None, crate_score=None):
    from crate.db.repositories.error_issues import set_digest

    return set_digest(
        issue_id,
        digest={"v": 1, "exceptions": [{"type": "IntegrityError"}]},
        digest_event_id="e" * 32,
        digest_hash=digest_hash,
        group_key="g" * 16,
        service=service,
        crate_score=crate_score,
    )


def test_upsert_is_idempotent(pg_db):
    from crate.db.repositories.error_issues import upsert_issues

    rows = [_row(1), _row(2)]

    assert upsert_issues(rows, synced_at=NOW) == 2
    assert upsert_issues(rows, synced_at=NOW) == 2
    assert upsert_issues([_row(1, events_24h=9, crate_score=55)], synced_at=NOW) == 1

    ids = _ids()
    assert sorted(ids) == ["1", "2"]
    assert _column(ids["1"], "events_24h") == 9
    assert _column(ids["1"], "crate_score") == 55
    assert _column(ids["1"], "synced_at") == NOW


def test_upsert_keeps_service_and_digest_from_a_previous_pass(pg_db):
    from crate.db.repositories.error_issues import upsert_issues

    upsert_issues([_row(1, service="crate-workers")], synced_at=NOW)
    issue_id = _ids()["1"]
    assert _digest(issue_id, "h1", service="worker-default", crate_score=50) is True

    upsert_issues([_row(1, service="crate-workers", crate_score=45)], synced_at=NOW)

    assert _column(issue_id, "service") == "worker-default"
    assert _column(issue_id, "digest_hash") == "h1"
    assert _column(issue_id, "crate_score") == 45


def test_upsert_tracks_when_an_issue_closed(pg_db):
    from crate.db.repositories.error_issues import upsert_issues

    later = NOW + timedelta(hours=2)
    upsert_issues([_row(1, status="resolved")], synced_at=NOW)
    issue_id = _ids()["1"]
    assert _column(issue_id, "closed_at") == NOW

    upsert_issues([_row(1, status="resolved")], synced_at=later)
    assert _column(issue_id, "closed_at") == NOW

    upsert_issues([_row(1, status="unresolved")], synced_at=later)
    assert _column(issue_id, "closed_at") is None


def test_mark_status_sets_closed_at(pg_db):
    from crate.db.repositories.error_issues import mark_status, upsert_issues

    upsert_issues([_row(1), _row(2)], synced_at=NOW)
    ids = _ids()

    changed = mark_status(
        [ids["1"]], "ignored", substatus="archived_until_escalating", at=NOW
    )

    assert changed == 1
    assert _column(ids["1"], "status") == "ignored"
    assert _column(ids["1"], "substatus") == "archived_until_escalating"
    assert _column(ids["1"], "closed_at") == NOW
    assert _column(ids["2"], "status") == "unresolved"

    mark_status([ids["1"]], "unresolved", at=NOW)
    assert _column(ids["1"], "closed_at") is None
    assert mark_status([], "resolved") == 0


def test_set_digest_and_get_issue(pg_db):
    from crate.db.queries.error_issues import get_issue
    from crate.db.repositories.error_issues import upsert_issues

    upsert_issues([_row(1)], synced_at=NOW)
    issue_id = _ids()["1"]
    _digest(issue_id, "h1")
    _insert_triage(issue_id, "h0", created_at=NOW - timedelta(hours=2))
    _insert_triage(issue_id, "h1", severity="high", created_at=NOW)

    issue = get_issue(issue_id)

    assert issue["short_id"] == "CRATE-API-1"
    assert issue["digest"] == {"v": 1, "exceptions": [{"type": "IntegrityError"}]}
    assert issue["digest_hash"] == "h1"
    assert issue["group_key"] == "g" * 16
    assert [triage["digest_hash"] for triage in issue["triages"]] == ["h1", "h0"]
    assert issue["triages"][0]["severity"] == "high"
    assert issue["critical"] is False
    assert get_issue("00000000-0000-0000-0000-000000000000") is None
    assert get_issue("not-a-uuid") is None


def test_record_fix_request(pg_db):
    from crate.db.queries.error_issues import get_issue
    from crate.db.repositories.error_issues import record_fix_request, upsert_issues

    user = pg_db.create_user("error-fixer@test.com")
    upsert_issues([_row(1)], synced_at=NOW)
    issue_id = _ids()["1"]

    assert record_fix_request(issue_id, user_id=user["id"], at=NOW) is True

    issue = get_issue(issue_id)
    assert issue["fix_requested_at"] == NOW
    assert issue["fix_requested_by"] == user["id"]
    # Without a display name the username shows ("requested by X").
    assert issue["fix_requested_by_name"] == user["username"]


def test_record_fix_request_cooldown_release_and_audit(pg_db):
    import json

    from crate.db.queries.error_issues import get_issue
    from crate.db.repositories.error_issues import (
        FIX_AUDIT_ACTION,
        audit_fix_request,
        record_fix_request,
        release_fix_request,
        upsert_issues,
    )

    first = pg_db.create_user("first-fixer@test.com", "Diego")
    second = pg_db.create_user("second-fixer@test.com")
    upsert_issues([_row(1)], synced_at=NOW)
    issue_id = _ids()["1"]
    day = timedelta(hours=24)

    assert record_fix_request(issue_id, user_id=first["id"], at=NOW, cooldown=day)
    # Within the window nobody else can claim the issue.
    later = NOW + timedelta(hours=23)
    assert not record_fix_request(
        issue_id, user_id=second["id"], at=later, cooldown=day
    )
    assert _column(issue_id, "fix_requested_by") == first["id"]

    # After it, a new claim wins; releasing it restores the previous request.
    next_day = NOW + timedelta(hours=25)
    assert record_fix_request(issue_id, user_id=second["id"], at=next_day, cooldown=day)
    assert release_fix_request(
        issue_id, requested_at=next_day, previous_at=NOW, previous_by=first["id"]
    )
    assert _column(issue_id, "fix_requested_at") == NOW
    assert _column(issue_id, "fix_requested_by") == first["id"]
    # A release only undoes its own claim.
    assert not release_fix_request(
        issue_id, requested_at=next_day, previous_at=None, previous_by=None
    )
    assert _column(issue_id, "fix_requested_at") == NOW
    missing = "00000000-0000-0000-0000-000000000000"
    assert not record_fix_request(missing, user_id=None, at=NOW, cooldown=day)

    assert audit_fix_request(
        issue_id,
        actor_id=first["id"],
        task_id="task-1",
        at=NOW,
        details={"issue_id": issue_id, "has_note": False},
    )
    assert not audit_fix_request(missing, actor_id=None, details={})
    with _scope() as session:
        audit = (
            session.execute(
                text(
                    "SELECT action, target_type, target_name, details_json, user_id, "
                    "task_id, timestamp FROM audit_log WHERE action = :action"
                ),
                {"action": FIX_AUDIT_ACTION},
            )
            .mappings()
            .one()
        )
    assert audit["target_type"] == "error_issue"
    assert audit["target_name"] == "CRATE-API-1"
    assert audit["user_id"] == first["id"]
    assert audit["task_id"] == "task-1"
    assert audit["details_json"] == {"issue_id": issue_id, "has_note": False}
    assert json.dumps(audit["details_json"]).find("IntegrityError") == -1
    assert get_issue(issue_id)["fix_requested_by"] == first["id"]
    assert get_issue(issue_id)["fix_requested_by_name"] == "Diego"


def test_purge_closed_cascades_triage(pg_db):
    from crate.db.repositories.error_issues import purge_closed, upsert_issues

    upsert_issues([_row(1, status="resolved")], synced_at=NOW - timedelta(days=40))
    upsert_issues([_row(2, status="ignored")], synced_at=NOW - timedelta(days=5))
    upsert_issues(
        [_row(3, last_seen=NOW - timedelta(days=80))],
        synced_at=NOW - timedelta(days=80),
    )
    ids = _ids()
    _insert_triage(ids["1"], "h1")

    assert purge_closed(older_than_days=30, now=NOW) == 1

    assert sorted(_ids()) == ["2", "3"]
    with _scope() as session:
        remaining = session.execute(
            text("SELECT count(*) FROM error_issue_triage")
        ).scalar_one()
    assert remaining == 0


def test_open_ids_not_in(pg_db):
    from crate.db.queries.error_issues import open_ids_not_in
    from crate.db.repositories.error_issues import upsert_issues

    upsert_issues([_row(1), _row(2)], synced_at=NOW)
    upsert_issues([_row(3)], synced_at=NOW - timedelta(hours=3))
    upsert_issues([_row(4, status="resolved")], synced_at=NOW)

    missing = open_ids_not_in(["1"])

    assert [row["external_id"] for row in missing] == ["3", "2"]
    assert set(missing[0]) == {"id", "external_id"}
    assert [row["external_id"] for row in open_ids_not_in(["1"], limit=1)] == ["3"]
    assert [row["external_id"] for row in open_ids_not_in([])] == ["3", "1", "2"]


def _seed_summary_fixture():
    from crate.db.repositories.error_issues import upsert_issues

    upsert_issues(
        [
            _row(
                1,
                service="readplane",
                crate_score=80,
                last_seen=NOW - timedelta(minutes=5),
            ),
            _row(2, service="api", crate_score=20, first_seen=NOW - timedelta(hours=2)),
            _row(3, service="api", crate_score=30, substatus="regressed"),
            _row(
                4,
                service="crate-listen",
                crate_score=25,
                last_seen=NOW - timedelta(days=2),
                substatus="regressed",
            ),
            _row(5, service="api", crate_score=90, status="resolved"),
        ],
        synced_at=NOW,
    )
    ids = _ids()
    _digest(ids["2"], "current")
    _insert_triage(
        ids["2"],
        "current",
        severity="critical",
        confidence=0.8,
        classification="infrastructure",
    )
    _digest(ids["3"], "new-digest")
    _insert_triage(ids["3"], "old-digest", severity="critical", confidence=0.9)
    return ids


def test_summary_counts(pg_db):
    from crate.db.queries.error_issues import summary

    ids = _seed_summary_fixture()

    result = summary(now=NOW)

    assert result["open"] == 4
    assert result["critical_open"] == 2
    assert result["new_24h"] == 1
    assert result["regressed_24h"] == 1
    assert result["last_synced_at"] == NOW
    assert result["services"] == [
        {"service": "api", "open": 2, "critical": 1, "new_24h": 1, "regressed_24h": 1},
        {
            "service": "readplane",
            "open": 1,
            "critical": 1,
            "new_24h": 0,
            "regressed_24h": 0,
        },
        {
            "service": "crate-listen",
            "open": 1,
            "critical": 0,
            "new_24h": 0,
            "regressed_24h": 0,
        },
    ]
    assert [item["id"] for item in result["top_critical"]] == [ids["1"], ids["2"]]
    assert set(result["top_critical"][0]) == {
        "id",
        "short_id",
        "title",
        "service",
        "crate_score",
    }


def test_summary_of_an_empty_inbox(pg_db):
    from crate.db.queries.error_issues import summary

    result = summary(now=NOW)

    assert result == {
        "open": 0,
        "critical_open": 0,
        "new_24h": 0,
        "regressed_24h": 0,
        "last_synced_at": None,
        "services": [],
        "top_critical": [],
    }


def test_list_issues_orders_critical_first_and_paginates(pg_db):
    from crate.db.queries.error_issues import list_issues

    ids = _seed_summary_fixture()

    first = list_issues(limit=2)
    second = list_issues(limit=2, cursor=first["next_cursor"])

    assert [item["id"] for item in first["items"]] == [ids["1"], ids["2"]]
    assert [item["critical"] for item in first["items"]] == [True, True]
    assert first["items"][1]["classification"] == "infrastructure"
    assert [item["id"] for item in second["items"]] == [ids["3"], ids["4"]]
    assert second["next_cursor"] is None
    assert second["items"][0]["classification"] is None


def test_list_issues_filters(pg_db):
    from crate.db.queries.error_issues import list_issues

    ids = _seed_summary_fixture()

    def listed(**filters):
        return [item["id"] for item in list_issues(**filters)["items"]]

    assert listed(service="api") == [ids["2"], ids["3"]]
    assert listed(critical_only=True) == [ids["1"], ids["2"]]
    assert listed(classification="infrastructure") == [ids["2"]]
    assert listed(status="resolved") == [ids["5"]]
    assert len(listed(status="all")) == 5
    assert listed(release="crate-zzz") == []
    assert len(listed(release="crate-b")) == 4


def test_untriaged_open_skips_triaged_digest(pg_db):
    from crate.db.queries.error_issues import untriaged_open
    from crate.db.repositories.error_issues import upsert_issues

    _seed_summary_fixture()
    upsert_issues([_row(6, crate_score=60)], synced_at=NOW)
    ids = _ids()
    _digest(ids["6"], "six")
    _digest(ids["1"], "one")

    rows = untriaged_open(limit=10)

    assert [row["id"] for row in rows] == [ids["1"], ids["6"], ids["3"]]
    assert rows[0]["digest_hash"] == "one"
    assert [row["id"] for row in untriaged_open(limit=1)] == [ids["1"]]


def test_sync_state(pg_db):
    from crate.db.queries.error_issues import sync_state
    from crate.db.repositories.error_issues import upsert_issues

    upsert_issues([_row(1), _row(2, status="resolved")], synced_at=NOW)
    ids = _ids()
    _digest(ids["1"], "h1", service="worker-fast")

    state = sync_state(["1", "2", "404", "1"])

    assert sorted(state) == ["1", "2"]
    assert state["1"] == {
        "id": ids["1"],
        "external_id": "1",
        "service": "worker-fast",
        "status": "unresolved",
        "last_seen": NOW - timedelta(hours=1),
        "digest_hash": "h1",
    }
    assert state["2"]["digest_hash"] is None
    assert state["2"]["status"] == "resolved"
    assert sync_state([]) == {}


def test_record_status_change_audits_in_the_same_transaction(pg_db):
    from crate.db.repositories.error_issues import (
        STATUS_AUDIT_ACTION,
        record_status_change,
        upsert_issues,
    )

    upsert_issues([_row(1)], synced_at=NOW)
    issue_id = _ids()["1"]

    assert record_status_change(
        issue_id,
        status="ignored",
        substatus="archived_until_escalating",
        actor_id=3,
        task_id="task-9",
        at=NOW,
    )
    assert (
        record_status_change(
            "00000000-0000-0000-0000-000000000001",
            status="resolved",
            actor_id=3,
        )
        is False
    )

    assert _column(issue_id, "status") == "ignored"
    assert _column(issue_id, "substatus") == "archived_until_escalating"
    assert _column(issue_id, "closed_at") == NOW
    with _scope() as session:
        rows = (
            session.execute(
                text(
                    "SELECT action, target_type, target_name, details_json, user_id, "
                    "task_id FROM audit_log WHERE target_type = 'error_issue'"
                )
            )
            .mappings()
            .all()
        )
    assert [dict(row) for row in rows] == [
        {
            "action": STATUS_AUDIT_ACTION,
            "target_type": "error_issue",
            "target_name": "CRATE-API-1",
            "details_json": {
                "issue_id": issue_id,
                "provider": "sentry",
                "external_id": "1",
                "from": {"status": "unresolved", "substatus": "ongoing"},
                "to": {"status": "ignored", "substatus": "archived_until_escalating"},
            },
            "user_id": 3,
            "task_id": "task-9",
        }
    ]


def test_record_status_change_rolls_back_with_the_caller(pg_db):
    from crate.db.repositories.error_issues import record_status_change, upsert_issues

    upsert_issues([_row(1)], synced_at=NOW)
    issue_id = _ids()["1"]

    try:
        with _scope() as session:
            record_status_change(
                issue_id, status="resolved", actor_id=1, session=session
            )
            raise RuntimeError("caller failed")
    except RuntimeError:
        pass

    assert _column(issue_id, "status") == "unresolved"
    with _scope() as session:
        count = session.execute(
            text("SELECT count(*) FROM audit_log WHERE target_type = 'error_issue'")
        ).scalar_one()
    assert count == 0
