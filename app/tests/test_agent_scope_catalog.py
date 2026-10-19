"""MCP permission scopes resolve to human labels, groups, access and presets."""

from crate.agent_access import ALLOWED_GRANTS
from crate.agent_scope_catalog import (
    SCOPE_DETAILS,
    SCOPE_GROUPS,
    SCOPE_PRESETS,
    scope_catalog,
)


def test_every_allowed_grant_has_details():
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
