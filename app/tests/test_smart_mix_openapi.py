from __future__ import annotations

import pytest


def test_smart_mix_openapi_exposes_typed_bounded_contracts(test_app) -> None:
    schema = test_app.get("/openapi.json").json()

    assert "/api/tracks/by-entity/{entity_uid}/mix-profile" in schema["paths"]
    assert "/api/playback/transition-plans" in schema["paths"]

    batch = schema["components"]["schemas"]["TransitionPlanBatchRequest"]
    edges = batch["properties"]["edges"]
    assert edges["minItems"] == 1
    assert edges["maxItems"] == 32

    context = schema["components"]["schemas"]["TransitionContextRequest"]
    assert context["properties"]["source"]["enum"] == [
        "album",
        "playlist",
        "radio",
        "shuffle",
        "infinite",
        "manual",
    ]

    plan = schema["components"]["schemas"]["TransitionPlanResponse"]
    assert plan["properties"]["mode"]["enum"] == [
        "gapless",
        "adaptive",
        "beatmatch",
    ]
    assert plan["properties"]["incomingTempoRatio"]["minimum"] == 0.94
    assert plan["properties"]["incomingTempoRatio"]["maximum"] == 1.06


@pytest.mark.parametrize("spec", ["/openapi.json", "/openapi-crate.json"])
def test_smart_mix_openapi_offers_planner_v3(test_app, spec: str) -> None:
    schema = test_app.get(spec).json()
    components = schema["components"]["schemas"]

    assert "/api/playback/transition-plans" in schema["paths"]
    batch = components["TransitionPlanBatchRequest"]
    assert batch["properties"]["plannerVersion"]["enum"] == [
        "smart-mix-v2",
        "smart-mix-v3",
    ]
    assert batch["properties"]["plannerVersion"]["default"] == "smart-mix-v2"
    assert "plannerVersion" not in batch.get("required", [])
    response = components["TransitionPlanBatchResponse"]
    assert response["properties"]["plannerVersion"]["enum"] == [
        "smart-mix-v2",
        "smart-mix-v3",
    ]
    plan = components["TransitionPlanResponse"]["properties"]
    assert "structureUsed" in plan
    context = components["TransitionContextRequest"]["properties"]
    history = context["setHistory"]["anyOf"][0]
    assert history["maxItems"] == 3
    entry = components["SetHistoryEntryRequest"]["properties"]
    assert set(entry) == {"mode", "durationBars", "deltaEnergy"}
    assert entry["deltaEnergy"]["minimum"] == -1.0
    assert entry["deltaEnergy"]["maximum"] == 1.0


@pytest.mark.parametrize("spec", ["/openapi-app.json", "/openapi-crate.json"])
def test_capabilities_openapi_lists_planners_and_structure(test_app, spec: str) -> None:
    schema = test_app.get(spec).json()

    assert "/api/capabilities" in schema["paths"]
    smart_mix = schema["components"]["schemas"]["SmartMixCapabilities"]
    assert smart_mix["properties"]["planner_versions"]["type"] == "array"
    assert smart_mix["properties"]["structure"]["type"] == "boolean"
    assert {"planner_versions", "structure"} <= set(smart_mix["required"])


@pytest.mark.parametrize("spec", ["/openapi.json", "/openapi-crate.json"])
def test_smart_mix_openapi_offers_ai_refinement(test_app, spec: str) -> None:
    components = test_app.get(spec).json()["components"]["schemas"]

    context = components["TransitionContextRequest"]["properties"]
    assert context["aiRefinement"]["default"] is False
    assert "aiRefinement" not in components["TransitionContextRequest"].get(
        "required", []
    )
    plan = components["TransitionPlanResponse"]["properties"]
    assert "refinement" in plan
    refinement = components["TransitionRefinementResponse"]["properties"]
    assert refinement["status"]["enum"] == ["ready", "pending", "unavailable"]
    reason_codes = refinement["reasonCode"]["anyOf"][0]["enum"]
    assert {"disabled", "no_model", "budget", "scope_missing", "rate_limited"} <= set(
        reason_codes
    )
    # The refined plan has the plan fields, without a nested refinement.
    refined = components["RefinedTransitionPlanResponse"]["properties"]
    assert "durationMs" in refined and "refinement" not in refined
