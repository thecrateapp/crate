"""MCP permission scopes resolve to human labels, groups, access and presets."""

import json
from pathlib import Path

import pytest

from crate.agent_access import ALLOWED_GRANTS
from crate.agent_scope_catalog import (
    _LABELS,
    SCOPE_DETAILS,
    SCOPE_GROUPS,
    SCOPE_PRESETS,
    scope_catalog,
)


def test_every_allowed_grant_has_details():
    # SCOPE_DETAILS is built from ALLOWED_GRANTS, so compare the label source:
    # a grant without a written label, or a label for a removed grant, fails.
    assert set(_LABELS) == set(ALLOWED_GRANTS)
    assert set(SCOPE_DETAILS) == set(ALLOWED_GRANTS)


def test_presets_only_use_allowed_grants_and_read_only_cannot_change():
    preset_ids = [preset.id for preset in SCOPE_PRESETS]
    assert len(preset_ids) == len(set(preset_ids))
    for preset in SCOPE_PRESETS:
        assert set(preset.scopes) <= set(ALLOWED_GRANTS)
        if preset.id == "read_only":
            assert preset.scopes
            for scope in preset.scopes:
                assert SCOPE_DETAILS[scope].access == "read"


def test_catalog_orders_by_group_then_read_before_change():
    catalog = scope_catalog(set())
    group_order = [group_id for group_id, _label in SCOPE_GROUPS]

    seen_groups: list[str] = []
    for row in catalog:
        if row["group"] not in seen_groups:
            seen_groups.append(row["group"])
    assert seen_groups == [group for group in group_order if group in seen_groups]

    library_rows = [row for row in catalog if row["group"] == "library"]
    accesses = [row["access"] for row in library_rows]
    first_change = next(
        (index for index, access in enumerate(accesses) if access == "change"), None
    )
    if first_change is not None:
        assert all(access == "read" for access in accesses[:first_change])
        assert all(access == "change" for access in accesses[first_change:])


def test_unknown_grant_falls_back_to_its_id(monkeypatch):
    from crate import agent_scope_catalog

    monkeypatch.setattr(
        agent_scope_catalog,
        "ALLOWED_GRANTS",
        frozenset(agent_scope_catalog.ALLOWED_GRANTS | {"ops.future.read"}),
    )
    monkeypatch.setattr(
        agent_scope_catalog,
        "SCOPE_CAPABILITIES",
        {
            **agent_scope_catalog.SCOPE_CAPABILITIES,
            "ops.future.read": "ops.health.view",
        },
    )

    catalog = agent_scope_catalog.scope_catalog(set())
    entry = next(row for row in catalog if row["scope"] == "ops.future.read")
    assert entry["label"] == "ops.future.read"
    assert entry["access"] == "read"


def test_can_grant_follows_capabilities():
    catalog = scope_catalog({"library.view"})
    by_scope = {row["scope"]: row for row in catalog}
    assert by_scope["library.health.read"]["can_grant"] is True
    assert by_scope["ops.logs.read"]["can_grant"] is False


def test_every_label_is_human_text():
    for scope, detail in SCOPE_DETAILS.items():
        assert detail.label
        assert detail.label != scope
    assert SCOPE_DETAILS["ops.jobs.cancel"].label == (
        "Request cooperative job cancellation"
    )
    assert SCOPE_DETAILS["ops.jobs.cancel_pending"].label == "Cancel owned pending jobs"
    assert "worker adoption" in SCOPE_DETAILS["ops.runtime.read"].label
    assert SCOPE_DETAILS["library.acquisition.search"].access == "read"
    assert SCOPE_DETAILS["library.acquisition.write"].access == "change"


ROOT = Path(__file__).resolve().parents[2]


def _agent_tools(config_name):
    config = json.loads((ROOT / "deploy/hermes" / config_name).read_text())
    return config["mcp_servers"]["crate"]["tools"]["include"]


def _agent_calls(config_name):
    calls = [(name, None) for name in _agent_tools(config_name)]
    if "read_diagnostics" in dict(calls):
        calls.append(("read_diagnostics", {"source": "worker_logs"}))
    if "preview_repairs" in dict(calls):
        calls.append(("preview_repairs", {"issue_ids": [1]}))
        calls.append(("preview_repairs", {}))
    return calls


def _principal(grants):
    from crate.agent_access import AgentPrincipal

    return AgentPrincipal(
        id="principal", credential_id="credential", name="crate-agent", grants=grants
    )


def _preset(preset_id):
    return next(preset for preset in SCOPE_PRESETS if preset.id == preset_id)


@pytest.mark.parametrize(
    ("preset_id", "config_name"),
    [
        ("crate_agent", "config.json"),
        ("crate_operator", "config.operator.json"),
    ],
)
def test_agent_presets_grant_exactly_what_their_tools_need(preset_id, config_name):
    from crate.mcp.tools import _allowed

    scopes = frozenset(_preset(preset_id).scopes)
    assert len(scopes) == len(_preset(preset_id).scopes)
    calls = _agent_calls(config_name)
    principal = _principal(scopes)
    assert [call for call in calls if not _allowed(principal, *call)] == []
    for scope in scopes:
        reduced = _principal(scopes - {scope})
        assert any(not _allowed(reduced, *call) for call in calls), scope


def test_crate_agent_preset_matches_the_documented_read_only_grants():
    from crate.mcp.tools import ACTION_CATALOG, CATALOG, _allowed

    preset = _preset("crate_agent")
    assert set(preset.scopes) == {
        "library.health.read",
        "ops.status.read",
        "ops.jobs.read",
        "ops.logs.read",
        "ops.audit.read",
        "ops.schedules.read",
        "ops.runtime.read",
    }
    principal = _principal(frozenset(preset.scopes))
    exposed = {name for name in CATALOG | ACTION_CATALOG if _allowed(principal, name)}
    assert exposed.isdisjoint(ACTION_CATALOG)
    assert set(_agent_tools("config.json")) <= exposed


def test_crate_operator_preset_excludes_tools_the_runtime_rejects():
    scopes = set(_preset("crate_operator").scopes)
    assert "ops.jobs.cancel_pending" not in scopes
    assert "ops.jobs.manage_instance" not in scopes
    assert set(_preset("crate_agent").scopes) <= scopes


def test_existing_presets_are_unchanged_and_agent_presets_follow_them():
    assert [preset.id for preset in SCOPE_PRESETS] == [
        "read_only",
        "shows_curator",
        "editorial_curator",
        "library_maintainer",
        "crate_agent",
        "crate_operator",
    ]
