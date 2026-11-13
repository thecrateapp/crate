"""When remote search fans out (FED1.3, FED-D14)."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from crate.federation.search_fanout import FanoutSettings, decide_fanout

PEERS = [{"node_uid": "a"}, {"node_uid": "b"}]


def _decide(query="joy division", local_total=0, peers=PEERS, stale=frozenset()):
    return decide_fanout(
        query,
        local_total=local_total,
        peers=peers,
        stale_node_uids=lambda uids: {uid for uid in uids if uid in stale},
    )


def test_fans_out_when_local_results_are_under_k():
    decision = _decide(local_total=4)

    assert decision.reason == "few_local_results"
    assert [peer["node_uid"] for peer in decision.peers] == ["a", "b"]


def test_k_is_five():
    assert FanoutSettings().min_local_results == 5
    assert _decide(local_total=5).peers == []


def test_enough_local_results_do_not_fan_out():
    decision = _decide(local_total=12)

    assert decision.reason == "enough_local_results"
    assert decision.peers == []


def test_a_stale_replica_is_asked_even_with_enough_local_results():
    decision = _decide(local_total=12, stale={"b"})

    assert decision.reason == "stale_replica"
    assert [peer["node_uid"] for peer in decision.peers] == ["b"]


@pytest.mark.parametrize("query", ["", "jo", "  j  ", "a b"])
def test_short_queries_never_fan_out(query):
    decision = _decide(query=query, local_total=0)

    assert decision.reason == "query_too_short"
    assert decision.peers == []


def test_no_peers_means_no_fan_out():
    decision = _decide(peers=[])

    assert decision.reason == "no_peers"


def test_stale_lookup_is_skipped_when_k_already_decides():
    def explode(_uids):
        raise AssertionError("not needed")

    decision = decide_fanout(
        "joy division", local_total=0, peers=PEERS, stale_node_uids=explode
    )

    assert decision.reason == "few_local_results"


def test_stale_replica_lookup_reads_the_cursors(pg_db):
    del pg_db
    from crate.db.repositories.federation_catalog import stale_replica_node_uids
    from crate.db.tx import transaction_scope
    from tests.conftest import approve_federation_node

    fresh, stale, never_synced, no_cursor = (str(uuid.uuid4()) for _ in range(4))
    with transaction_scope() as session:
        for node_uid in (fresh, stale, never_synced, no_cursor):
            approve_federation_node(session, node_uid)
        session.execute(
            text(
                """
                INSERT INTO federation_catalog_cursors
                    (node_uid, full_sync_completed_at, last_delta_at)
                VALUES
                    (CAST(:fresh AS uuid), NOW() - INTERVAL '3 days', NOW() - INTERVAL '1 hour'),
                    (CAST(:stale AS uuid), NOW() - INTERVAL '3 days', NOW() - INTERVAL '30 hours'),
                    (CAST(:never AS uuid), NULL, NULL)
                """
            ),
            {"fresh": fresh, "stale": stale, "never": never_synced},
        )

    result = stale_replica_node_uids([fresh, stale, never_synced, no_cursor])

    # A peer without a replica is searched on demand under the k rule only;
    # FED2 summaries decide when such a peer is worth asking anyway.
    assert result == {stale}
    assert stale_replica_node_uids([]) == set()
