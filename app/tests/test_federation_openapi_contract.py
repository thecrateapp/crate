from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_advertised_protocol_capabilities_have_openapi_operations(test_app):
    from crate.federation.contracts import CAPABILITIES, CAPABILITY_ENDPOINTS

    schema = test_app.get("/openapi.json").json()

    assert set(CAPABILITY_ENDPOINTS) == set(CAPABILITIES)
    for capability, operations in CAPABILITY_ENDPOINTS.items():
        assert operations, f"{capability} has no contract operation"
        for method, path in operations:
            assert path in schema["paths"], f"{capability} documents missing {path}"
            assert method.lower() in schema["paths"][path], (
                f"{capability} documents missing {method} {path}"
            )


def test_federation_openapi_exposes_public_contract_but_not_service_identity(test_app):
    schema = test_app.get("/openapi.json").json()

    assert "/.well-known/crate-node" in schema["paths"]
    assert "/api/federation/v1/catalog/manifest" in schema["paths"]
    assert "/api/federation/v1/catalog/delta" in schema["paths"]
    assert "/api/federation/v1/stream-tickets" in schema["paths"]
    assert "/api/federation/v1/streams/{ticket_uid}" in schema["paths"]
    assert "/internal/federation/streams/authorize" not in schema["paths"]


def test_protocol_contract_no_longer_claims_global_user_features_are_out_of_scope():
    contract = (ROOT / "app/crate/federation/contracts.py").read_text()

    for stale_claim in (
        "Favorites/Likes:\n#   - Out of scope",
        "Remote tracks are not seedable",
        "Remote tracks are not included until a later product decision",
        "behavior matches today (local only)",
    ):
        assert stale_claim not in contract
