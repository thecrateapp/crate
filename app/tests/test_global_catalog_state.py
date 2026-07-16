import pytest

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


@pytest.mark.parametrize(
    ("state", "expected"),
    [
        ({"status": "cold", "last_full_reconcile_at": None}, "local-fallback"),
        (
            {"status": "backfilling", "last_full_reconcile_at": None},
            "local-fallback",
        ),
        ({"status": "failed", "last_full_reconcile_at": None}, "local-fallback"),
        ({"status": "ready", "last_full_reconcile_at": None}, "global-ready"),
        (
            {
                "status": "backfilling",
                "last_full_reconcile_at": "2026-07-15T20:00:00+00:00",
            },
            "global-refreshing",
        ),
        (
            {
                "status": "failed",
                "last_full_reconcile_at": "2026-07-15T20:00:00+00:00",
            },
            "global-degraded",
        ),
    ],
)
def test_catalog_serving_mode_separates_reads_from_reconciliation(state, expected):
    from crate.db.repositories.global_catalog_state import catalog_serving_mode

    assert catalog_serving_mode(state) == expected


@pytest.mark.parametrize(
    ("state", "expected"),
    [
        ({"status": "cold", "last_full_reconcile_at": None}, False),
        ({"status": "ready", "last_full_reconcile_at": None}, True),
        (
            {"status": "backfilling", "last_full_reconcile_at": "2026-07-15"},
            True,
        ),
        ({"status": "failed", "last_full_reconcile_at": "2026-07-15"}, True),
    ],
)
def test_catalog_serves_global_only_after_a_complete_reconciliation(state, expected):
    from crate.db.repositories.global_catalog_state import catalog_serves_global

    assert catalog_serves_global(state) is expected


def test_catalog_state_is_seeded_and_enforces_bootstrap_transitions(pg_db):
    from crate.db.repositories.global_catalog_state import (
        get_catalog_state,
        transition_catalog_state,
    )

    initial = get_catalog_state()

    assert initial["status"] == "cold"
    assert initial["generation"]

    with pytest.raises(ValueError, match="cold -> ready"):
        transition_catalog_state("ready")

    backfilling = transition_catalog_state("backfilling")
    ready = transition_catalog_state("ready")

    assert backfilling["status"] == "backfilling"
    assert ready["status"] == "ready"


def test_catalog_state_failure_keeps_diagnostics_until_next_bootstrap(pg_db):
    from crate.db.repositories.global_catalog_state import (
        get_catalog_state,
        transition_catalog_state,
    )

    transition_catalog_state("backfilling")
    failed = transition_catalog_state("failed", last_error="source cursor failed")

    assert failed["last_error"] == "source cursor failed"

    restarted = transition_catalog_state("backfilling")

    assert restarted["last_error"] is None
    assert get_catalog_state()["status"] == "backfilling"


def test_catalog_state_persists_structured_bootstrap_fields(pg_db):
    from crate.db.repositories.global_catalog_state import transition_catalog_state

    cursor = {"phase": "local", "cursor": {"entity_type": "album", "after_id": 7}}
    report = {"artists": 3, "albums": 5}

    state = transition_catalog_state(
        "backfilling",
        bootstrap_cursor_json=cursor,
        user_refs_backfill_report_json=report,
    )

    assert state["bootstrap_cursor_json"] == cursor
    assert state["user_refs_backfill_report_json"] == report
