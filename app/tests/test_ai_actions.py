"""The closed AI action registry: ids, permissions, locations and limits."""

import re
from pathlib import Path

import pytest

from crate.ai.actions import ACTIONS, get_action, list_actions
from crate.ai.contracts import AIConfigurationError
from crate.api.permissions import ALL_CAPABILITIES
from crate.db.schema_sections.ai_action_smart_mix_refine_v151 import V151_ACTIONS_SQL

ADMIN_APP = Path(__file__).resolve().parents[1] / "ui" / "src" / "App.tsx"


@pytest.mark.parametrize(
    ("action_id", "timeout", "output"),
    [("ops.error.triage", 90, 8192), ("ops.error.investigate", 90, 16000)],
)
def test_error_actions_registered_with_limits(action_id, timeout, output):
    action = get_action(action_id)

    assert action.group == "ops"
    assert action.input == "text"
    assert action.permission == "ops.errors.manage"
    assert action.location == "/errors"
    assert action.maxima.timeout_seconds == timeout
    assert action.maxima.max_output_tokens == output
    assert action.maxima.max_image_pixels is None
    assert action.maxima.max_proposals is None
    assert action.maxima.max_selected is None
    assert action_id in {item["id"] for item in list_actions()}


def test_smart_mix_refine_action_registered_with_limits():
    action = get_action("smart_mix.transition.refine")

    assert action.group == "smart_mix"
    assert action.input == "text"
    # Granted with library.view (SM3-D10); the admin can narrow it per role.
    assert action.permission == "smart_mix.ai"
    # Its on/off switch (smart_mix_ai_enabled) lives in Settings.
    assert action.location == "/settings"
    assert action.maxima.timeout_seconds == 45
    assert action.maxima.max_output_tokens == 1024
    assert action.maxima.max_image_pixels is None
    assert action.maxima.max_proposals is None
    assert "smart_mix.transition.refine" in {item["id"] for item in list_actions()}


def test_every_action_permission_is_a_known_capability():
    assert {action.permission for action in ACTIONS.values()} <= set(ALL_CAPABILITIES)


def test_every_action_location_is_an_admin_route():
    routes = set(re.findall(r'path="([^"]+)"', ADMIN_APP.read_text()))
    for action in ACTIONS.values():
        assert action.location.lstrip("/") in routes, action.id


def test_registry_matches_the_database_action_checks():
    assert set(re.findall(r"'([^']+)'", V151_ACTIONS_SQL)) == set(ACTIONS)


def test_unknown_action_is_a_closed_error():
    with pytest.raises(AIConfigurationError) as error:
        get_action("ops.error.fix")
    assert error.value.code == "AI_ACTION_UNKNOWN"


def test_error_tasks_leave_room_for_a_whole_call():
    from crate.actors import TASK_POOL_CONFIG
    from crate.ai.requeue import AI_CALL_DEADLINE_MARGIN_SECONDS
    from crate.error_inbox.evidence import EVIDENCE_BUDGET_SECONDS

    triage = get_action("ops.error.triage").maxima.timeout_seconds
    investigate = get_action("ops.error.investigate").maxima.timeout_seconds

    # The task deadline caps every call at time limit minus the margin.
    assert (
        TASK_POOL_CONFIG["triage_error_issue"].time_limit_seconds
        >= triage + AI_CALL_DEADLINE_MARGIN_SECONDS
    )
    assert (
        TASK_POOL_CONFIG["investigate_error_issue"].time_limit_seconds
        >= EVIDENCE_BUDGET_SECONDS + investigate + AI_CALL_DEADLINE_MARGIN_SECONDS
    )
