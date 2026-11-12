"""`federation` in /api/capabilities: streamed federated search (FED1.5, FED-D18)."""

from __future__ import annotations

import pytest

APPROVED_PEER = {
    "node_uid": "00000000-0000-0000-0000-00000000000b",
    "trust_state": "approved",
    "display_name": "Les Pedants",
}


@pytest.fixture
def federation(monkeypatch):
    from crate.api import capabilities

    state: dict = {"node": {"node_uid": "local"}, "peers": [APPROVED_PEER]}

    def local_node():
        if isinstance(state["node"], Exception):
            raise state["node"]
        return state["node"]

    monkeypatch.setattr(capabilities, "get_local_node", local_node)
    monkeypatch.setattr(
        capabilities, "list_peers", lambda trust_state=None: list(state["peers"])
    )
    monkeypatch.setattr(capabilities, "get_smart_mix_structure_percent", lambda: None)
    return state


def _federation(test_app) -> dict:
    response = test_app.get("/api/capabilities")
    assert response.status_code == 200
    return response.json()["federation"]


def test_a_node_with_a_searchable_peer_offers_the_stream(test_app, federation):
    assert _federation(test_app) == {
        "search_stream": True,
        "results_contract": "crate.federation.results/1",
        "min_query_length": 3,
        "window_ms": 2000,
    }


def test_without_peers_listen_keeps_the_canonical_search(test_app, federation):
    federation["peers"] = []

    assert _federation(test_app)["search_stream"] is False


def test_disabled_peers_do_not_count(test_app, federation):
    federation["peers"] = [{**APPROVED_PEER, "disabled_at": "2026-11-12T00:00:00Z"}]

    assert _federation(test_app)["search_stream"] is False


def test_without_a_local_node_there_is_no_network(test_app, federation):
    federation["node"] = None

    assert _federation(test_app)["search_stream"] is False


def test_an_unreadable_federation_state_hides_the_stream(test_app, federation):
    federation["node"] = RuntimeError("database down")

    assert _federation(test_app)["search_stream"] is False


def test_the_schema_documents_the_federation_block(test_app):
    schema = test_app.get("/openapi.json").json()["components"]["schemas"]

    assert set(schema["FederationCapabilities"]["required"]) == {
        "search_stream",
        "results_contract",
        "min_query_length",
        "window_ms",
    }
