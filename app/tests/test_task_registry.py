from crate.api.permissions import ALL_CAPABILITIES
from crate.task_registry import (
    TASK_ACTIONS,
    TASK_CATEGORIES,
    TASK_TYPE_ICONS,
    TASK_TYPES,
    task_category,
    task_label,
)
from crate.worker import _HANDLER_GROUPS


def _handler_types() -> set[str]:
    return {task_type for _, _, types in _HANDLER_GROUPS for task_type in types}


def test_every_handler_type_has_a_catalog_entry():
    assert sorted(_handler_types() - set(TASK_TYPES)) == []


def test_catalog_has_no_types_without_a_handler():
    assert sorted(set(TASK_TYPES) - _handler_types()) == []
    assert sorted(set(TASK_TYPE_ICONS) - _handler_types()) == []


def test_every_type_uses_a_known_category():
    assert {info.category for info in TASK_TYPES.values()} <= set(TASK_CATEGORIES)


def test_actions_point_at_existing_routes_task_types_and_capabilities(test_app):
    routes = {
        (route.path, method)
        for route in test_app.app.routes
        for method in getattr(route, "methods", set()) or set()
    }
    ids = [action.id for action in TASK_ACTIONS]
    assert len(ids) == len(set(ids))
    for action in TASK_ACTIONS:
        assert (action.path, "POST") in routes, action.path
        assert action.task_type in TASK_TYPES, action.task_type
        assert action.capability in ALL_CAPABILITIES, action.capability


def test_unknown_types_fall_back_to_a_readable_label():
    assert task_label("repair_duplicate_tracks") == "Duplicate Track Cleanup"
    assert task_label("some_new_task") == "Some New Task"
    assert task_category("some_new_task") == "other"
