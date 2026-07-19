from __future__ import annotations

import importlib
import uuid

import pytest
from pydantic import ValidationError


def test_playback_prepare_body_is_strict_and_bounded():
    schemas = importlib.import_module("crate.api.schemas.federation")
    body_model = getattr(schemas, "FederatedPlaybackPrepareBody", None)

    assert body_model is not None

    peer_uid = uuid.uuid4()
    track_uid = uuid.uuid4()
    accepted = body_model.model_validate(
        {
            "requesting_node_uid": str(peer_uid),
            "delivery_policy": "balanced",
            "remote_entity_uids": [str(track_uid)],
        }
    )

    assert accepted.requesting_node_uid == peer_uid
    assert accepted.remote_entity_uids == [track_uid]

    with pytest.raises(ValidationError):
        body_model.model_validate(
            {
                "requesting_node_uid": str(peer_uid),
                "delivery_policy": "original",
                "remote_entity_uids": [str(track_uid)],
            }
        )
    with pytest.raises(ValidationError):
        body_model.model_validate(
            {
                "requesting_node_uid": str(peer_uid),
                "delivery_policy": "balanced",
                "remote_entity_uids": [str(track_uid)] * 3,
            }
        )
    with pytest.raises(ValidationError):
        body_model.model_validate(
            {
                "requesting_node_uid": str(peer_uid),
                "delivery_policy": "balanced",
                "remote_entity_uids": [str(track_uid)],
                "unexpected": True,
            }
        )


def test_playback_prepare_route_is_documented_without_stream_material(test_app):
    schema = test_app.get("/openapi.json").json()
    operation = schema["paths"]["/api/federation/v1/playback/prepare"]["post"]

    request_schema = operation["requestBody"]["content"]["application/json"]["schema"]
    response_schema = operation["responses"]["200"]["content"]["application/json"][
        "schema"
    ]

    assert request_schema["$ref"].endswith("FederatedPlaybackPrepareBody")
    assert response_schema["$ref"].endswith("FederatedPlaybackPrepareResponse")
    assert "stream_url" not in str(operation)
    assert "ticket" not in str(operation).lower()


def test_playback_prepare_is_covered_by_existing_stream_grants():
    from crate.federation.assertions import build_assertion, validate_assertion
    from crate.federation.contracts import CAPABILITY_ENDPOINTS

    operation = ("POST", "/api/federation/v1/playback/prepare")

    assert operation in CAPABILITY_ENDPOINTS["stream.proxy"]
    assert operation in CAPABILITY_ENDPOINTS["stream.transcoded"]

    assertion = build_assertion(
        issuer_node_uid="issuer",
        audience_node_uid="owner",
        subject_hash="subject",
        purpose="stream.ticket",
        capabilities=["federation.stream.play"],
    )
    accepted, reason = validate_assertion(
        assertion,
        expected_audience="owner",
        expected_purpose="stream.prepare",
    )

    assert not accepted
    assert reason == "purpose mismatch: expected stream.prepare, got stream.ticket"
