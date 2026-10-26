from __future__ import annotations


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
