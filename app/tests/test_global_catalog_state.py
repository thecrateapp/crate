import pytest

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


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
