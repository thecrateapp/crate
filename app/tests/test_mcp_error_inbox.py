"""MCP error inbox tools: grant, closed inputs, sanitized output and no Sentry calls."""

from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import pytest
from pydantic import ValidationError

from crate import agent_error_inbox as tools
from crate.agent_diagnostics import DiagnosticError
from tests.test_error_inbox_api import (
    _row,
    insert_triage,
    record_sync,
    seed_issues,
    set_digest,
)
from tests.test_mcp_transport import _client
from tests.test_mcp_transport import (
    diagnostic_boundary as diagnostic_boundary,  # noqa: PLC0414
)
from tests.test_mcp_transport import transport_app as transport_app  # noqa: PLC0414

ERROR_TOOLS = {"get_error_summary", "list_error_issues", "get_error_issue"}
ISSUE_ID = "6f1d2c1e-6a7b-4f1a-9a55-0d6c2a1b3c4d"
EVENT_TEXT = "ValueError: leaked event text"


def _summary(**overrides):
    now = datetime.now(UTC)
    summary = {
        "configured": True,
        "open": 4,
        "critical_open": 1,
        "new_24h": 2,
        "regressed_24h": 1,
        "last_synced_at": now.isoformat(),
        "services": [
            {
                "service": "api",
                "open": 3,
                "critical": 1,
                "new_24h": 2,
                "regressed_24h": 1,
            }
        ],
        "top_critical": [
            {
                "id": ISSUE_ID,
                "short_id": "CRATE-API-1F",
                "title": EVENT_TEXT,
                "service": "api",
                "crate_score": 88,
            }
        ],
        "sync": {
            "status": "ok",
            "started_at": now.isoformat(),
            "finished_at": now.isoformat(),
            "last_success_at": now.isoformat(),
            "error_code": None,
            "counts": {"listed": 4},
            "truncated": {"full": False, "recent": False},
        },
    }
    summary.update(overrides)
    return summary


def _issue_row(**overrides):
    row = {
        "id": ISSUE_ID,
        "short_id": "CRATE-API-1F",
        "title": EVENT_TEXT,
        "culprit": "library_pipeline",
        "service": "api",
        "project_slug": "crate-api",
        "level": "error",
        "status": "unresolved",
        "substatus": "new",
        "issue_category": "error",
        "sentry_priority": "high",
        "events_24h": 3,
        "users_24h": 1,
        "events_total": 9,
        "users_total": 2,
        "first_seen": datetime.now(UTC),
        "last_seen": datetime.now(UTC),
        "first_release": "crate-a",
        "last_release": "crate-b",
        "crate_score": 88,
        "critical": True,
        "group_key": "g" * 16,
        "permalink": "https://ninja-development.sentry.io/issues/1/",
        "fix_requested_at": None,
        "synced_at": datetime.now(UTC),
        "classification": None,
        "severity": None,
        "digest": {"v": 1, "exceptions": [{"type": "ValueError", "value": "x"}]},
        "digest_hash": "h",
        "closed_at": None,
        "created_at": datetime.now(UTC),
        "triages": [],
    }
    row.update(overrides)
    return row


@pytest.fixture
def fake_inbox(monkeypatch):
    """Inbox reads served from memory; any Sentry client or task creation fails."""
    from crate.db.queries import error_issues

    reads = {
        "summary": Mock(return_value=_summary()),
        "list": Mock(return_value={"items": [_issue_row()], "next_cursor": None}),
        "get": Mock(return_value=_issue_row()),
        "short": Mock(return_value=_issue_row()),
    }
    monkeypatch.setattr(tools, "inbox_summary", reads["summary"])
    monkeypatch.setattr(error_issues, "list_issues", reads["list"])
    monkeypatch.setattr(error_issues, "get_issue", reads["get"])
    monkeypatch.setattr(error_issues, "get_issue_by_short_id", reads["short"])
    forbidden = Mock(side_effect=AssertionError("An MCP read reached Sentry or a task"))
    for path in (
        "crate.error_inbox.sentry_client.SentryClient.__init__",
        "crate.db.repositories.tasks.create_task",
        "crate.db.repositories.tasks.create_task_dedup",
    ):
        monkeypatch.setattr(path, forbidden)
    return reads, forbidden


CALLS = [
    ("get_error_summary", {}),
    ("list_error_issues", {"lane": "critical", "limit": 5}),
    ("get_error_issue", {"short_id": "CRATE-API-1F"}),
]


def test_error_tools_require_grant(transport_app, diagnostic_boundary, fake_inbox):
    app, tokens, principals = transport_app
    principals[tokens["all"]] = replace(
        principals[tokens["all"]], grants=frozenset({"ops.errors.read"})
    )
    reads, forbidden = fake_inbox

    async def run():
        async with app.router.lifespan_context(app):
            async with _client(app, tokens["ops"]) as client:
                listed = {tool.name for tool in (await client.list_tools()).tools}
                assert not listed & ERROR_TOOLS
                for name, arguments in CALLS:
                    result = await client.call_tool(name, arguments)
                    assert result.is_error
                    assert result.structured_content["error"]["code"] == "FORBIDDEN"
            async with _client(app, tokens["all"]) as client:
                catalog = {
                    tool.name: tool for tool in (await client.list_tools()).tools
                }
                assert set(catalog) == ERROR_TOOLS | {"get_operation_catalog"}
                for name in ERROR_TOOLS:
                    tool = catalog[name]
                    assert tool.annotations.read_only_hint
                    assert tool.annotations.idempotent_hint
                    assert not tool.annotations.destructive_hint
                    assert not tool.annotations.open_world_hint
                    assert tool.input_schema["additionalProperties"] is False
                for name, arguments in CALLS:
                    result = await client.call_tool(name, arguments)
                    assert not result.is_error, result.structured_content
                    assert result.structured_content["availability"] == "available"
                rejected = await client.call_tool(
                    "get_error_issue", {"short_id": "x", "issue_id": ISSUE_ID}
                )
                assert rejected.structured_content["error"]["code"] == (
                    "INVALID_ARGUMENT"
                )

    asyncio.run(run())
    reads["summary"].assert_called_once()
    reads["short"].assert_called_once_with("CRATE-API-1F")
    assert reads["list"].call_args.kwargs["critical_only"] is True
    forbidden.assert_not_called()
    # Every accepted read is audited like the other diagnostic tools.
    assert diagnostic_boundary[1].call_count == len(CALLS)


def test_error_summary_has_no_event_text(fake_inbox):
    result = tools.get_error_summary()

    encoded = json.dumps(result, default=str)
    assert EVENT_TEXT not in encoded
    assert '"title"' not in encoded
    inbox = result["data"]["sources"]["inbox"]
    assert inbox["availability"] == "available"
    assert inbox["data"]["critical_open"] == 1
    assert inbox["data"]["top_critical"] == [
        {"short_id": "CRATE-API-1F", "service": "api", "crate_score": 88}
    ]
    assert inbox["data"]["services"][0]["open"] == 3
    assert result["data"]["configured"] is True
    sync = result["data"]["sync"]
    assert set(sync) == {"status", "finished_at", "last_success_at", "error_code"}
    assert (sync["status"], sync["error_code"]) == ("ok", None)


@pytest.mark.parametrize(
    "summary,availability,reason",
    [
        (_summary(configured=False), "unavailable", "Error tracking is not configured"),
        (
            _summary(sync=None, last_synced_at=None),
            "unavailable",
            "No completed sync",
        ),
        (
            _summary(
                sync=None,
                last_synced_at=(datetime.now(UTC) - timedelta(hours=2)).isoformat(),
            ),
            "stale",
            "Historical observation",
        ),
    ],
)
def test_error_summary_reports_unknown_or_old_counts(
    fake_inbox, summary, availability, reason
):
    fake_inbox[0]["summary"].return_value = summary

    inbox = tools.get_error_summary()["data"]["sources"]["inbox"]

    assert inbox["availability"] == availability
    assert inbox["reason"] == reason
    if availability == "unavailable":
        assert inbox["data"] is None


def test_error_summary_hides_source_failures(monkeypatch):
    def broken():
        raise RuntimeError("postgresql://crate:secret@db/crate is down")

    monkeypatch.setattr(tools, "inbox_summary", broken)

    result = tools.get_error_summary()

    assert result["availability"] == "unavailable"
    assert "secret" not in json.dumps(result, default=str)
    assert result["data"]["sources"]["inbox"]["reason"] == (
        "Persisted evidence source failed"
    )


def test_error_inputs_are_closed():
    from crate.mcp.error_schemas import ErrorIssueInput, ErrorIssuesInput

    assert ErrorIssueInput(short_id="CRATE-API-1F").short_id == "CRATE-API-1F"
    for invalid in (
        {},
        {"issue_id": ISSUE_ID, "short_id": "CRATE-API-1F"},
        {"issue_id": "not-a-uuid"},
        {"short_id": "CRATE API"},
        {"short_id": "CRATE-API-1F", "refresh": True},
    ):
        with pytest.raises(ValidationError):
            ErrorIssueInput.model_validate(invalid)
    for invalid in (
        {"limit": 101},
        {"status": "open"},
        {"lane": "urgent"},
        {"classification": "flaky"},
        {"service": ""},
        {"sentry": True},
    ):
        with pytest.raises(ValidationError):
            ErrorIssuesInput.model_validate(invalid)


# -- PostgreSQL-backed reads -------------------------------------------------------


def test_list_error_issues_pages_with_a_bound_cursor(pg_db):
    ids = seed_issues(
        _row(1, crate_score=80), _row(2, crate_score=60), _row(3, crate_score=30)
    )

    first = tools.list_error_issues(limit=2)
    second = tools.list_error_issues(limit=2, cursor=first["next_cursor"])

    assert [row["id"] for row in first["data"]] == [ids["1"], ids["2"]]
    assert first["truncated"] is True
    assert [row["id"] for row in second["data"]] == [ids["3"]]
    assert second["next_cursor"] is None
    assert "permalink" not in first["data"][0]
    assert first["data"][0]["title"] == "IntegrityError number 1"
    with pytest.raises(DiagnosticError) as changed:
        tools.list_error_issues(limit=2, cursor=first["next_cursor"], service="api")
    assert changed.value.code == "INVALID_ARGUMENT"


def test_get_error_issue_by_id_or_short_id(pg_db):
    ids = seed_issues(_row(1))
    set_digest(ids["1"])
    for index in range(5):
        insert_triage(ids["1"], f"hash-{index}")
    record_sync()

    by_id = tools.get_error_issue(issue_id=ids["1"])
    by_short_id = tools.get_error_issue(short_id="crate-api-1")

    assert by_id["availability"] == "available"
    assert by_id["data"] == by_short_id["data"]
    assert by_id["data"]["digest"]["frames"][0]["function"] == "run"
    assert len(by_id["data"]["triages"]) == tools.MAX_TRIAGES
    assert by_id["truncated"] is True
    assert "permalink" not in by_id["data"]
    missing = tools.get_error_issue(short_id="CRATE-API-404")
    assert missing["availability"] == "unavailable"
    assert missing["reason"] == "Issue not found"


def test_error_grant_is_storable(pg_db):
    from crate.db.repositories import agent_credentials

    issued = agent_credentials.create_credential(
        "Error inbox reader",
        frozenset({"ops.errors.read"}),
        datetime.now(UTC) + timedelta(days=1),
    )

    assert agent_credentials.resolve_credential(issued.token).grants == {
        "ops.errors.read"
    }


def test_error_grant_maps_to_view_capability_and_agent_presets():
    from crate.agent_access import ALLOWED_GRANTS, PILOT_GRANTS, SCOPE_CAPABILITIES
    from crate.agent_scope_catalog import SCOPE_DETAILS, SCOPE_PRESETS
    from crate.api.permissions import ALL_CAPABILITIES

    assert "ops.errors.read" in ALLOWED_GRANTS
    assert "ops.errors.read" not in PILOT_GRANTS
    assert SCOPE_CAPABILITIES["ops.errors.read"] == "ops.errors.view"
    assert "ops.errors.view" in ALL_CAPABILITIES
    assert SCOPE_DETAILS["ops.errors.read"].access == "read"
    presets = {preset.id: set(preset.scopes) for preset in SCOPE_PRESETS}
    assert "ops.errors.read" in presets["crate_agent"]
    assert "ops.errors.read" in presets["crate_operator"]
    assert "ops.errors.read" in presets["read_only"]
