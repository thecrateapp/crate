import pytest

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def test_local_dirty_source_coalesces_then_reopens_after_completion(pg_db):
    from crate.db.repositories.global_catalog_dirty_sources import (
        claim_dirty_sources,
        complete_dirty_source,
        enqueue_local_dirty_source,
    )
    from crate.db.tx import transaction_scope

    entity_uid = "f8690c59-78dc-4a31-b968-c712f902c472"
    with transaction_scope() as session:
        enqueue_local_dirty_source("track", entity_uid, "upsert", session=session)
        enqueue_local_dirty_source("track", entity_uid, "upsert", session=session)

    with transaction_scope() as session:
        claimed = claim_dirty_sources(10, session=session)

    assert len(claimed) == 1
    assert claimed[0]["operation"] == "upsert"

    with transaction_scope() as session:
        complete_dirty_source(int(claimed[0]["id"]), session=session)
        enqueue_local_dirty_source("track", entity_uid, "delete", session=session)

    with transaction_scope() as session:
        reopened = claim_dirty_sources(10, session=session)

    assert len(reopened) == 1
    assert reopened[0]["operation"] == "delete"


def test_claimed_dirty_source_is_not_claimed_twice_and_failure_keeps_error(pg_db):
    from crate.db.repositories.global_catalog_dirty_sources import (
        claim_dirty_sources,
        enqueue_federated_dirty_source,
        fail_dirty_source,
    )
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        enqueue_federated_dirty_source(
            "album",
            "7d4ba366-12bb-4240-a99a-3ff5e4d9ad4f",
            "peer-album-42",
            "upsert",
            session=session,
        )

    with transaction_scope() as session:
        first_claim = claim_dirty_sources(1, session=session)

    with transaction_scope() as session:
        second_claim = claim_dirty_sources(1, session=session)

    assert len(first_claim) == 1
    assert second_claim == []

    with transaction_scope() as session:
        fail_dirty_source(
            int(first_claim[0]["id"]), "peer manifest unavailable", session=session
        )

    with transaction_scope() as session:
        retried = claim_dirty_sources(1, session=session)

    assert len(retried) == 1
    assert retried[0]["last_error"] == "peer manifest unavailable"
