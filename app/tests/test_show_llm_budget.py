from pydantic import BaseModel
import pytest
from crate.llm import provider


class Answer(BaseModel):
    value: str


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
