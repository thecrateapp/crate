from pydantic import BaseModel
import pytest
from crate.llm import provider


class Answer(BaseModel):
    value: str


@pytest.mark.parametrize(
    ("mode", "response_seconds", "succeeds"),
    [("vision", 65, True), ("vision", 95, False), ("text_llm", 65, False)],
)
def test_show_extractor_allows_slow_vision_but_bounds_each_single_request(
    monkeypatch, caplog, mode, response_seconds, succeeds
):
    import json
    from pathlib import Path
    from types import SimpleNamespace

    import requests
    from crate import show_extraction

    monkeypatch.setattr(
        provider,
        "get_config",
        lambda: {"model": "gemini/gemini-3.8-flash", "provider": "gemini"},
    )
    monkeypatch.setattr(provider, "get_provider_api_key", lambda _: "test-private-key")
    calls = []

    def post(url, **kwargs):
        calls.append(kwargs)
        if response_seconds > kwargs["timeout"]:
            raise requests.exceptions.ReadTimeout("private provider timeout")
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": json.dumps(
                                        {
                                            "candidates": [
                                                {
                                                    "item_id": "provider-label",
                                                    "artist_name": "External Band",
                                                    "date": "2027-03-02",
                                                    "evidence": "Tour 2027; 02.03 Madrid",
                                                }
                                            ],
                                            "coverage": "incomplete",
                                        }
                                    )
                                }
                            ]
                        },
                        "finishReason": "STOP",
                    }
                ]
            },
        )

    monkeypatch.setattr(provider.requests, "post", post)
    images = (
        [
            {
                "id": "poster",
                "sha256": "a" * 64,
                "content": (
                    Path(__file__).parent / "fixtures/shows/tour.png"
                ).read_bytes(),
            }
        ]
        if mode == "vision"
        else []
    )
    draft = show_extraction.extract_show_candidates(
        {"mode": mode, "raw_text": "Tour 2027; 02.03 Madrid"}, images
    )
    assert len(calls) == 1
    if succeeds:
        assert "error_code" not in draft
        image_part = calls[0]["json"]["contents"][0]["parts"][1]
        assert image_part["mediaResolution"] == {"level": "MEDIA_RESOLUTION_ULTRA_HIGH"}
        candidate = draft["candidates"][0]
        assert candidate["date"] == "2027-03-02"
        assert candidate["item_id"] != "provider-label"
        assert candidate["extractor_model"] == "gemini/gemini-3.8-flash"
        assert draft["sources"][-1]["read"] is True
    else:
        assert draft["error_code"] == "LLM_EXTRACTION_FAILED"
        assert "Tour 2027; 02.03 Madrid" in draft["raw_text"]
        if mode == "vision":
            assert draft["sources"][-1]["read"] is False
    assert "test-private-key" not in str(draft) + caplog.text
    assert "private provider timeout" not in str(draft) + caplog.text


@pytest.mark.parametrize("vision", [False, True])
def test_show_calls_have_one_bounded_request_without_private_response_logs(
    monkeypatch, caplog, vision
):
    calls = []

    def completion(**kwargs):
        calls.append(kwargs)
        from types import SimpleNamespace as S

        return S(choices=[S(message=S(content="private flyer invalid response"))])

    import sys
    from types import SimpleNamespace

    monkeypatch.setitem(sys.modules, "litellm", SimpleNamespace(completion=completion))
    function = provider.ask_image_structured if vision else provider.ask_structured
    extra = {"image": b"x", "media_type": "image/png"} if vision else {}
    with pytest.raises(ValueError):
        function(
            Answer,
            "flyer",
            model="openai/example",
            timeout_seconds=45,
            max_tokens=3000,
            private_response=True,
            **extra,
        )
    assert len(calls) == 1
    assert calls[0]["timeout"] == 45
    assert calls[0]["max_tokens"] == 3000
    assert calls[0]["num_retries"] == 0
    assert "private flyer" not in caplog.text


@pytest.mark.parametrize("vision", [False, True])
def test_selected_ollama_endpoint_is_frozen_for_the_explicit_model_call(
    monkeypatch, vision
):
    from types import SimpleNamespace as S

    calls = []
    monkeypatch.setattr(
        provider,
        "_get_ollama_url",
        lambda: (_ for _ in ()).throw(AssertionError("Endpoint was reloaded")),
    )

    def post(url, **kwargs):
        calls.append((url, kwargs))
        return S(
            raise_for_status=lambda: None,
            json=lambda: {"message": {"content": '{"value":"ok"}'}},
        )

    monkeypatch.setattr(provider.requests, "post", post)
    function = provider.ask_image_structured if vision else provider.ask_structured
    extra = {"image": b"x", "media_type": "image/png"} if vision else {}
    result = function(
        Answer,
        "synthetic",
        model="ollama_chat/test",
        ollama_url="http://selected-ollama",
        timeout_seconds=45,
        max_tokens=3000,
        private_response=True,
        **extra,
    )
    assert result.value == "ok"
    assert len(calls) == 1 and calls[0][0] == "http://selected-ollama/api/chat"
    assert calls[0][1]["json"]["model"] == "test"


@pytest.mark.parametrize(
    ("model", "detail", "error"),
    [
        ("gemini/gemini-2.5-flash", "ultra_high", "Gemini 3"),
        ("openai/example", "ultra_high", "Gemini 3"),
        ("ollama/test", "ultra_high", "Gemini 3"),
        ("gemini/gemini-3.8-flash", "arbitrary", "Unsupported image detail"),
    ],
)
def test_image_detail_rejects_unsupported_values_before_sending(
    monkeypatch, model, detail, error
):
    def forbidden(*args, **kwargs):
        raise AssertionError("Unsupported detail must not send a request")

    monkeypatch.setattr(provider.requests, "post", forbidden)
    monkeypatch.setattr(provider, "_litellm_chat", forbidden)
    with pytest.raises(ValueError, match=error):
        provider.ask_image_structured(
            Answer,
            "flyer",
            image=b"x",
            media_type="image/png",
            model=model,
            image_detail=detail,
        )


@pytest.mark.parametrize(
    "model", ["gemini/gemini-2.5-flash", "gemini/gemini-3.8-flash"]
)
def test_other_image_consumers_retain_the_provider_default_detail(monkeypatch, model):
    from types import SimpleNamespace

    calls = []

    def post(url, **kwargs):
        calls.append(kwargs)
        return SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {
                "candidates": [{"content": {"parts": [{"text": '{"value":"ok"}'}]}}]
            },
        )

    monkeypatch.setattr(provider.requests, "post", post)
    monkeypatch.setattr(provider, "get_provider_api_key", lambda _: "test-key")
    result = provider.ask_image_structured(
        Answer, "photo", image=b"x", media_type="image/jpeg", model=model
    )
    assert result.value == "ok" and len(calls) == 1
    image_part = calls[0]["json"]["contents"][0]["parts"][1]
    assert "mediaResolution" not in image_part
    assert "mediaResolution" not in calls[0]["json"]["generationConfig"]
