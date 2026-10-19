"""Native inference uses explicit credentials and one bounded request."""

import pytest

from crate.ai import transport
from crate.ai.contracts import AIConfigurationError, ProfileConfig


def context(provider="gemini", **options):
    return {
        "provider": provider,
        "model_id": "gemini-3.8-flash" if provider == "gemini" else "test-model",
        "endpoint": "http://localhost:11434" if provider == "ollama" else None,
        "config": ProfileConfig(**options).model_dump(mode="json"),
    }


def test_gemini_native_thinking_detail_and_usage(monkeypatch):
    calls = []

    def request(**kwargs):
        calls.append(kwargs)
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"thought": True, "text": "private reasoning"},
                            {"text": '{"ok":true}'},
                        ]
                    }
                }
            ],
            "modelVersion": "actual-model",
            "usageMetadata": {
                "promptTokenCount": 20,
                "candidatesTokenCount": 4,
                "thoughtsTokenCount": 8,
                "cachedContentTokenCount": 5,
                "totalTokenCount": 32,
            },
        }

    monkeypatch.setattr(transport, "_request_json", request)
    result = transport.generate(
        context(
            reasoning={"mode": "level", "level": "high"}, image_detail="ultra_high"
        ),
        api_key="pinned-secret",
        prompt="synthetic",
        system="system",
        response_schema={"type": "object"},
        image=b"image",
        media_type="image/png",
    )
    assert len(calls) == 1
    assert calls[0]["api_key"] == "pinned-secret"
    body = calls[0]["body"]
    assert body["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "high"}
    assert body["generationConfig"]["maxOutputTokens"] == 2048
    assert body["contents"][0]["parts"][1]["mediaResolution"] == {
        "level": "MEDIA_RESOLUTION_ULTRA_HIGH"
    }
    assert result.text == '{"ok":true}'
    assert result.reported_model == "actual-model"
    assert result.usage == {
        "input_tokens": 20,
        "output_tokens": 4,
        "thought_tokens": 8,
        "cached_input_tokens": 5,
        "total_tokens": 32,
    }


@pytest.mark.parametrize("provider", ["deepseek", "ollama"])
def test_native_thinking_and_no_reasoning_text(provider, monkeypatch):
    captured = []

    def request(**kwargs):
        captured.append(kwargs)
        if provider == "deepseek":
            return {
                "choices": [
                    {
                        "message": {
                            "content": '{"ok":true}',
                            "reasoning_content": "secret",
                        }
                    }
                ],
                "usage": {
                    "prompt_tokens": 20,
                    "completion_tokens": 12,
                    "completion_tokens_details": {"reasoning_tokens": 8},
                    "prompt_cache_hit_tokens": 5,
                    "total_tokens": 32,
                },
            }
        return {
            "message": {"content": '{"ok":true}', "thinking": "secret"},
            "prompt_eval_count": 20,
            "eval_count": 12,
        }

    monkeypatch.setattr(transport, "_request_json", request)
    result = transport.generate(
        context(provider, reasoning={"mode": "disabled"}),
        api_key="key",
        prompt="synthetic",
        response_schema={},
    )
    assert len(captured) == 1
    body = captured[0]["body"]
    assert result.text == '{"ok":true}'
    if provider == "deepseek":
        assert body["thinking"] == {"type": "disabled"}
        assert body["response_format"] == {"type": "json_object"}
        assert result.usage["output_tokens"] == 4
        assert result.usage["thought_tokens"] == 8
    else:
        assert body["think"] is False
        assert body["options"]["num_predict"] == 2048


def test_invalid_native_budget_never_calls(monkeypatch):
    monkeypatch.setattr(
        transport, "_request_json", lambda **kwargs: pytest.fail("request")
    )
    with pytest.raises(AIConfigurationError):
        transport.generate(
            context("ollama", reasoning={"mode": "budget", "budget_tokens": 8}),
            api_key=None,
            prompt="synthetic",
            response_schema={},
        )


def test_http_failure_is_closed_and_does_not_retry(monkeypatch):
    calls = []

    def request(**kwargs):
        calls.append(kwargs)
        raise RuntimeError("secret-key private-source")

    monkeypatch.setattr(transport, "_request_json", request)
    with pytest.raises(AIConfigurationError) as error:
        transport.generate(
            context(), api_key="secret-key", prompt="private-source", response_schema={}
        )
    assert len(calls) == 1
    assert "secret" not in str(error.value)
    assert error.value.__cause__ is None


def test_http_pins_dns_host_sni_and_keys_are_request_local(monkeypatch):
    import httpx

    seen = []
    options = []

    def handle(request):
        seen.append(request)
        return httpx.Response(200, json={"ok": True})

    original = httpx.Client

    def client(**kwargs):
        options.append(kwargs)
        return original(**kwargs, transport=httpx.MockTransport(handle))

    monkeypatch.setattr(transport.httpx, "Client", client)
    monkeypatch.setattr(
        transport.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", ("10.0.0.5", 11434))],
    )
    for key in ("key-one", "key-two"):
        assert transport._http_json(
            "ollama",
            "https://ollama.local:11434",
            "/api/chat",
            api_key=key,
            body={},
            timeout_seconds=45,
        ) == {"ok": True}
    assert str(seen[0].url) == "https://10.0.0.5:11434/api/chat"
    assert seen[0].headers["Host"] == "ollama.local:11434"
    assert seen[0].extensions["sni_hostname"] == "ollama.local"
    assert [request.headers["Authorization"] for request in seen] == [
        "Bearer key-one",
        "Bearer key-two",
    ]
    assert all(
        option["trust_env"] is False and option["follow_redirects"] is False
        for option in options
    )


@pytest.mark.parametrize("kind", ["redirect", "error", "oversized", "timeout"])
def test_http_errors_do_not_disclose_or_retry(monkeypatch, kind, caplog):
    import httpx

    calls = []

    def handle(request):
        calls.append(request)
        if kind == "redirect":
            return httpx.Response(302, headers={"Location": "http://169.254.169.254"})
        if kind == "error":
            raise httpx.ConnectError("secret-key private-source")
        if kind == "oversized":
            return httpx.Response(
                200, content=b"x" * (transport.MAX_RESPONSE_BYTES + 1)
            )
        raise httpx.ReadTimeout("secret-key private-source")

    original = httpx.Client
    monkeypatch.setattr(
        transport.httpx,
        "Client",
        lambda **kwargs: original(**kwargs, transport=httpx.MockTransport(handle)),
    )
    with pytest.raises(AIConfigurationError) as error:
        transport._http_json(
            "gemini",
            None,
            "/generate",
            api_key="secret-key",
            body={"prompt": "private-source"},
            timeout_seconds=45,
        )
    assert len(calls) == 1
    assert "secret-key" not in str(error.value) + caplog.text
    assert "private-source" not in str(error.value) + caplog.text


def test_deadline_includes_process_setup_and_reaps(monkeypatch):
    from unittest.mock import Mock

    now = [100.0]
    process = Mock()
    process.pid = 123
    process.poll.return_value = None
    process.communicate.side_effect = transport.subprocess.TimeoutExpired(
        "inference", 1
    )

    def spawn(*args, **kwargs):
        now[0] += 4
        return process

    monkeypatch.setattr(transport.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(transport.subprocess, "Popen", spawn)
    monkeypatch.setattr(transport.resource, "prlimit", lambda *args: None)
    with pytest.raises(AIConfigurationError, match="Provider request") as error:
        transport._request_json(
            provider="gemini",
            endpoint=None,
            path="/generate",
            api_key="key",
            body={},
            deadline=105,
        )
    assert error.value.code == "AI_PROVIDER_TIMEOUT"
    assert process.communicate.call_args.kwargs["timeout"] == 1
    process.kill.assert_called_once()
    process.wait.assert_called_once()


def test_real_local_ollama_child_and_slow_body_deadline():
    import json
    import threading
    import time
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    received = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            received.append(
                json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            )
            self.send_response(200)
            self.end_headers()
            if self.path == "/slow":
                try:
                    for _ in range(30):
                        self.wfile.write(b" ")
                        self.wfile.flush()
                        time.sleep(0.1)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            else:
                self.wfile.write(
                    b'{"message":{"content":"{}"},"prompt_eval_count":2,"eval_count":1}'
                )

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    endpoint = f"http://127.0.0.1:{server.server_port}"
    try:
        result = transport._request_json(
            provider="ollama",
            endpoint=endpoint,
            path="/api/chat",
            api_key=None,
            body={"model": "local-fake"},
            deadline=time.monotonic() + 5,
        )
        assert result["message"]["content"] == "{}"
        started = time.monotonic()
        with pytest.raises(AIConfigurationError) as error:
            transport._request_json(
                provider="ollama",
                endpoint=endpoint,
                path="/slow",
                api_key=None,
                body={},
                deadline=started + 1,
            )
        assert error.value.code == "AI_PROVIDER_TIMEOUT"
        assert time.monotonic() - started < 2
        assert len(received) == 2
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_ollama_explicit_boolean_enable(monkeypatch):
    captured = []

    def request(**kwargs):
        captured.append(kwargs)
        return {"message": {"content": "{}"}}

    monkeypatch.setattr(transport, "_request_json", request)
    transport.generate(
        context("ollama", reasoning={"mode": "enabled"}),
        api_key=None,
        prompt="synthetic",
        response_schema={},
    )
    assert captured[0]["body"]["think"] is True


@pytest.mark.parametrize(
    "provider,image",
    [("gemini", None), ("gemini", b"image"), ("ollama", None), ("deepseek", None)],
)
def test_legacy_exact_omitted_options_and_pinned_keys(provider, image, monkeypatch):
    import base64
    from crate.llm import provider as old

    monkeypatch.setattr(old, "_get_model", lambda: pytest.fail("global model"))
    monkeypatch.setattr(old, "_get_ollama_url", lambda: pytest.fail("global endpoint"))
    monkeypatch.setattr(
        old, "get_provider_api_key", lambda *args: pytest.fail("global key")
    )
    calls = []

    def http(native, endpoint, path, **kwargs):
        calls.append((native, endpoint, path, kwargs))
        if native == "gemini":
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {"thought": True, "text": "secret"},
                                {"text": '{"ok":true}'},
                            ]
                        }
                    }
                ]
            }
        if native == "deepseek":
            return {
                "choices": [
                    {
                        "message": {
                            "content": '{"ok":true}',
                            "reasoning_content": "secret",
                        }
                    }
                ]
            }
        return {"message": {"content": '{"ok":true}'}}

    monkeypatch.setattr(transport, "_http_json", http)
    ctx = {
        "mode": "legacy",
        "provider": provider,
        "legacy_model": provider + "/pinned-model",
        "model_id": "pinned-model",
        "endpoint": "http://localhost:11434" if provider == "ollama" else None,
        "legacy_options": {
            "timeout_seconds": None,
            "max_tokens": None,
            "image_detail": "default",
        },
    }
    result = transport._legacy_response(
        {
            "api_key": "pinned-key",
            "timeout_seconds": 300,
            "body": {
                "context": ctx,
                "prompt": "synthetic",
                "system": "",
                "schema": {"type": "object"},
                "image": base64.b64encode(image).decode() if image else None,
                "media_type": "image/png",
            },
        }
    )
    assert result["text"] == '{"ok":true}'
    assert len(calls) == 1 and calls[0][3]["api_key"] == "pinned-key"
    body = calls[0][3]["body"]
    assert "max_tokens" not in body and "options" not in body
    assert "maxOutputTokens" not in body.get("generationConfig", {})


def test_legacy_deadline_does_not_cap_ollama_to_new_profile(monkeypatch):
    seen = []
    monkeypatch.setattr(transport.time, "monotonic", lambda: 100)

    def request(**kwargs):
        seen.append(kwargs)
        return {"text": "{}", "usage": None, "reported_model": None}

    monkeypatch.setattr(transport, "_request_json", request)
    transport.generate_legacy(
        {"mode": "legacy", "provider": "ollama", "legacy_deadline_seconds": 300.0},
        api_key=None,
        prompt="synthetic",
        response_schema={},
    )
    assert seen[0]["deadline"] == 400


def test_unsupported_legacy_uses_explicit_key_and_no_retries(monkeypatch):
    import sys
    from types import SimpleNamespace
    from crate.llm import provider

    calls = []

    def completion(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"ok":true}'))]
        )

    monkeypatch.setitem(sys.modules, "litellm", SimpleNamespace(completion=completion))
    monkeypatch.setattr(
        provider, "get_provider_api_key", lambda *args: pytest.fail("global key")
    )
    ctx = {
        "mode": "legacy",
        "provider": "anthropic",
        "legacy_model": "anthropic/old-model",
        "model_id": "old-model",
        "endpoint": None,
        "legacy_options": {
            "timeout_seconds": None,
            "max_tokens": None,
            "image_detail": "default",
        },
    }
    result = transport._legacy_response(
        {
            "api_key": "pinned-key",
            "timeout_seconds": 300,
            "body": {
                "context": ctx,
                "prompt": "synthetic",
                "system": "",
                "schema": {"type": "object"},
                "image": None,
                "media_type": None,
            },
        }
    )
    assert result["usage"] is None and result["reported_model"] is None
    assert len(calls) == 1
    assert (
        calls[0]["model"] == "anthropic/old-model"
        and calls[0]["api_key"] == "pinned-key"
    )
    assert calls[0]["num_retries"] == 0
    assert "timeout" not in calls[0] and "max_tokens" not in calls[0]
