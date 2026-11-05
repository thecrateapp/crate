"""The closed AI action registry: ids, permissions, locations and limits."""

import re
from pathlib import Path

import pytest

from crate.ai.actions import ACTIONS, get_action, list_actions
from crate.ai.contracts import AIConfigurationError
from crate.api.permissions import ALL_CAPABILITIES
from crate.db.schema_sections.ai_action_error_inbox_v145 import V145_ACTIONS_SQL

ADMIN_APP = Path(__file__).resolve().parents[1] / "ui" / "src" / "App.tsx"


@pytest.mark.parametrize(
    ("action_id", "timeout", "output"),
    [("ops.error.triage", 45, 2048), ("ops.error.investigate", 90, 4096)],
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


def test_every_action_permission_is_a_known_capability():
    assert {action.permission for action in ACTIONS.values()} <= set(ALL_CAPABILITIES)


def test_every_action_location_is_an_admin_route():
    routes = set(re.findall(r'path="([^"]+)"', ADMIN_APP.read_text()))
    for action in ACTIONS.values():
        assert action.location.lstrip("/") in routes, action.id


def test_registry_matches_the_database_action_checks():
    assert set(re.findall(r"'([^']+)'", V145_ACTIONS_SQL)) == set(ACTIONS)


def test_unknown_action_is_a_closed_error():
    with pytest.raises(AIConfigurationError) as error:
        get_action("ops.error.fix")
    assert error.value.code == "AI_ACTION_UNKNOWN"
