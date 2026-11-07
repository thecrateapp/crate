"""openai_compatible inference: one bounded /chat/completions request whose body
follows the declared manifest. A fake local HTTP server stands in for the
provider; requests go through the real killable child process.
"""

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from crate.ai import transport
from crate.ai.contracts import AIConfigurationError, ProfileConfig

KEY = "sk-fake-provider-key-0001"
SCHEMA = {
    "type": "object",
    "properties": {"ok": {"type": "boolean"}},
    "required": ["ok"],
    "additionalProperties": False,
}
ANSWER = {
    "model": "reported-model",
    "choices": [
        {
            "message": {
                "role": "assistant",
                "content": '{"ok":true}',
                "reasoning_content": "private reasoning",
            }
        }
    ],
    "usage": {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15},
}


class FakeProvider:
    """A local OpenAI-compatible server that records requests and replays answers."""

    def __init__(self):
        self.requests = []
        self.reply = lambda handler: handler.json(200, ANSWER)
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def json(self, status, payload, headers=()):
                body = json.dumps(payload).encode()
                self.raw(status, body, headers)

            def raw(self, status, body, headers=()):
                self.send_response(status)
                for name, value in headers:
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                owner.requests.append(
                    {
                        "path": self.path,
                        "headers": dict(self.headers),
                        "body": json.loads(self.rfile.read(length)) if length else None,
                    }
                )
                owner.reply(self)

            do_GET = do_POST

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(
            target=lambda: self.server.serve_forever(poll_interval=0.01), daemon=True
        )

    @property
    def origin(self):
        return f"http://127.0.0.1:{self.server.server_port}"

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


@pytest.fixture
def provider():
    with FakeProvider() as fake:
        yield fake


def context(
    endpoint="http://127.0.0.1:1",
    *,
    template="custom",
    path_prefix="/v1",
    structured_output="json_schema",
    reasoning_control="none",
    **options,
):
    return {
        "provider": "openai_compatible",
        "model_id": "Qwen/Qwen3.8-27B",
        "endpoint": endpoint,
        "template": template,
        "path_prefix": path_prefix,
        "structured_output": structured_output,
        "reasoning_control": reasoning_control,
        "config": ProfileConfig(**options).model_dump(mode="json"),
    }


def generate(ctx, **kwargs):
    return transport.generate(
        ctx,
        api_key=kwargs.pop("api_key", KEY),
        prompt="synthetic prompt",
        system="system rules",
        response_schema=SCHEMA,
        **kwargs,
    )


def test_json_schema_request_body(provider):
    result = generate(context(provider.origin, path_prefix="/api/v1"))

    assert result.text == '{"ok":true}'
    assert result.reported_model == "reported-model"
    assert len(provider.requests) == 1
    request = provider.requests[0]
    assert request["path"] == "/api/v1/chat/completions"
    assert request["headers"]["Authorization"] == f"Bearer {KEY}"
    assert request["body"] == {
        "model": "Qwen/Qwen3.8-27B",
        "messages": [
            {
                "role": "system",
                "content": "system rules\n\nReturn only a JSON object.",
            },
            {"role": "user", "content": "synthetic prompt"},
        ],
        "stream": False,
        "max_tokens": 2048,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "crate_response", "schema": SCHEMA},
        },
    }


def test_json_object_fallback_body(provider):
    generate(
        context(
            provider.origin, structured_output="json_object", max_output_tokens=900
        ),
        api_key=None,
    )

    request = provider.requests[0]
    assert request["path"] == "/v1/chat/completions"
    assert "Authorization" not in request["headers"]
    body = request["body"]
    assert body["response_format"] == {"type": "json_object"}
    assert body["max_tokens"] == 900
    # Without schema support the schema travels in the system prompt.
    assert body["messages"][0] == {
        "role": "system",
        "content": "system rules\n\nReturn only a JSON object matching this schema:\n"
        + json.dumps(SCHEMA),
    }
    assert set(body) == {"model", "messages", "stream", "max_tokens", "response_format"}


@pytest.mark.parametrize(
    "template,control,reasoning,expected",
    [
        ("moonshot", "none", {"mode": "provider_default"}, {}),
        (
            "moonshot",
            "thinking",
            {"mode": "disabled"},
            {"thinking": {"type": "disabled"}},
        ),
        (
            "moonshot",
            "thinking",
            {"mode": "enabled"},
            {"thinking": {"type": "enabled"}},
        ),
        (
            "moonshot",
            "reasoning_effort",
            {"mode": "level", "level": "low"},
            {"reasoning_effort": "low"},
        ),
        (
            "dashscope_intl",
            "enable_thinking",
            {"mode": "disabled"},
            {"enable_thinking": False},
        ),
        (
            "dashscope_intl",
            "enable_thinking",
            {"mode": "enabled"},
            {"enable_thinking": True},
        ),
        (
            "openrouter",
            "reasoning",
            {"mode": "level", "level": "medium"},
            {"reasoning": {"effort": "medium"}},
        ),
        (
            "openrouter",
            "reasoning",
            {"mode": "disabled"},
            {"reasoning": {"enabled": False}},
        ),
        ("custom", "enable_thinking", {"mode": "disabled"}, {"enable_thinking": False}),
        (
            "custom",
            "reasoning_effort",
            {"mode": "level", "level": "high"},
            {"reasoning_effort": "high"},
        ),
    ],
)
def test_reasoning_controls_per_template(
    monkeypatch, template, control, reasoning, expected
):
    calls = []
    monkeypatch.setattr(
        transport, "_request_json", lambda **kwargs: calls.append(kwargs) or ANSWER
    )
    origins = {
        "moonshot": ("https://api.moonshot.ai", "/v1"),
        "dashscope_intl": (
            "https://dashscope-intl.aliyuncs.com",
            "/compatible-mode/v1",
        ),
        "openrouter": ("https://openrouter.ai", "/api/v1"),
        "custom": ("https://llm.example.test", "/v1"),
    }
    endpoint, prefix = origins[template]
    generate(
        context(
            endpoint,
            template=template,
            path_prefix=prefix,
            reasoning_control=control,
            reasoning=reasoning,
        )
    )

    assert len(calls) == 1
    call = calls[0]
    assert (call["endpoint"], call["path"]) == (endpoint, "/chat/completions")
    assert (call["template"], call["path_prefix"]) == (template, prefix)
    controls = {"thinking", "enable_thinking", "reasoning_effort", "reasoning"}
    assert {k: v for k, v in call["body"].items() if k in controls} == expected


@pytest.mark.parametrize(
    "template,control,reasoning,image",
    [
        # A control the template's API does not have.
        ("moonshot", "enable_thinking", {"mode": "disabled"}, False),
        ("dashscope_intl", "reasoning", {"mode": "disabled"}, False),
        ("custom", "reasoning", {"mode": "disabled"}, False),
        # A mode the declared control cannot express.
        ("moonshot", "reasoning_effort", {"mode": "disabled"}, False),
        ("dashscope_intl", "enable_thinking", {"mode": "level", "level": "low"}, False),
        ("moonshot", "none", {"mode": "enabled"}, False),
        ("openrouter", "reasoning", {"mode": "budget", "budget_tokens": 512}, False),
        # Text only.
        ("custom", "none", {"mode": "provider_default"}, True),
    ],
)
def test_unsupported_controls_never_call(
    monkeypatch, template, control, reasoning, image
):
    monkeypatch.setattr(
        transport, "_request_json", lambda **kwargs: pytest.fail("request sent")
    )
    with pytest.raises(AIConfigurationError) as error:
        generate(
            context(
                "https://llm.example.test",
                template=template,
                path_prefix="/v1",
                reasoning_control=control,
                reasoning=reasoning,
            ),
            **({"image": b"png", "media_type": "image/png"} if image else {}),
        )
    assert error.value.code == "AI_RESPONSE_INVALID"


def test_usage_normalised(provider):
    answers = iter(
        [
            # OpenAI, DashScope and OpenRouter: reasoning inside completion tokens.
            {
                **ANSWER,
                "usage": {
                    "prompt_tokens": 120,
                    "completion_tokens": 50,
                    "total_tokens": 170,
                    "prompt_tokens_details": {"cached_tokens": 40},
                    "completion_tokens_details": {"reasoning_tokens": 30},
                },
            },
            # Moonshot reports cached input at the top level.
            {
                **ANSWER,
                "usage": {
                    "prompt_tokens": 80,
                    "completion_tokens": 10,
                    "total_tokens": 90,
                    "cached_tokens": 64,
                },
            },
            {**ANSWER, "usage": None},
            {**ANSWER, "usage": {"prompt_tokens": 5, "completion_tokens": "many"}},
            {
                **ANSWER,
                "usage": {
                    "prompt_tokens": 5,
                    "completion_tokens": 1,
                    "prompt_tokens_details": {"cached_tokens": 9},
                },
            },
        ]
    )
    provider.reply = lambda handler: handler.json(200, next(answers))

    results = [generate(context(provider.origin)) for _ in range(5)]

    assert [result.usage for result in results] == [
        {
            "input_tokens": 120,
            "output_tokens": 20,
            "thought_tokens": 30,
            "cached_input_tokens": 40,
            "total_tokens": 170,
        },
        {
            "input_tokens": 80,
            "output_tokens": 10,
            "thought_tokens": None,
            "cached_input_tokens": 64,
            "total_tokens": 90,
        },
        None,
        None,
        None,
    ]
    assert all(result.text == '{"ok":true}' for result in results)
    assert all("private reasoning" not in repr(result) for result in results)


def test_no_redirect_follow(provider, caplog):
    with FakeProvider() as elsewhere:
        provider.reply = lambda handler: handler.raw(
            307,
            b"",
            [("Location", elsewhere.origin + "/v1/chat/completions")],
        )
        with pytest.raises(AIConfigurationError) as error:
            generate(context(provider.origin))

        assert error.value.code == "AI_PROVIDER_FAILED"
        assert len(provider.requests) == 1
        # The key never reaches the redirect target.
        assert elsewhere.requests == []
    assert KEY not in str(error.value) + caplog.text
    assert error.value.__cause__ is None


def test_response_cap_2mb(provider):
    oversized = b'{"pad":"' + b"x" * transport.MAX_RESPONSE_BYTES + b'"}'
    provider.reply = lambda handler: handler.raw(200, oversized)
    started = time.monotonic()

    with pytest.raises(AIConfigurationError) as error:
        generate(context(provider.origin))

    assert error.value.code == "AI_RESPONSE_INVALID"
    assert len(provider.requests) == 1
    assert time.monotonic() - started < 10

    near = json.dumps(
        {**ANSWER, "pad": "x" * (transport.MAX_RESPONSE_BYTES - 4096)}
    ).encode()
    assert len(near) <= transport.MAX_RESPONSE_BYTES
    provider.reply = lambda handler: handler.raw(200, near)
    assert generate(context(provider.origin)).text == '{"ok":true}'


def test_plain_http_needs_a_private_origin(monkeypatch):
    from crate.ai import discovery

    monkeypatch.setattr(
        transport.httpx, "Client", lambda **kwargs: pytest.fail("request sent")
    )

    monkeypatch.setattr(
        discovery.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", ("93.184.216.34", 8000))],
    )
    with pytest.raises(AIConfigurationError) as error:
        transport._http_json(
            "openai_compatible",
            "http://llm.example.test:8000",
            "/chat/completions",
            api_key=KEY,
            body={},
            timeout_seconds=5,
            template="custom",
            path_prefix="/v1",
        )
    assert error.value.code == "AI_ENDPOINT_INVALID"


def test_custom_origin_profile_runs_end_to_end(pg_db, provider):
    from crate.ai import configuration, runtime
    from crate.ai.discovery import discover_models
    from crate.db.repositories import ai_configuration as store

    entry = {
        "model_id": "Qwen/Qwen3.8-27B",
        "context_window": 32768,
        "max_output_tokens": 4096,
        "structured_output": "json_schema",
        "reasoning": "enable_thinking",
    }

    def reply(handler):
        if handler.path == "/v1/models":
            handler.json(200, {"data": [{"id": entry["model_id"]}]})
        else:
            handler.json(200, ANSWER)

    provider.reply = reply
    connection = configuration.create_connection(
        {
            "label": "Local vLLM",
            "provider": "openai_compatible",
            "template": "custom",
            "endpoint": provider.origin,
            "path_prefix": "/v1",
            "model_manifest": [entry],
            "confirm_custom_origin": True,
        },
        None,
    )
    row = configuration._connection(connection["id"])
    models = discover_models(
        "openai_compatible",
        api_key=None,
        endpoint=row["endpoint"],
        template=row["template"],
        path_prefix=row["path_prefix"],
        manifest=row["model_manifest"],
    )
    store.save_model_catalog(row["id"], models, "ready", row["revision"])
    profile = configuration.create_profile(
        {
            "label": "Local",
            "connection_id": row["id"],
            "model_id": entry["model_id"],
            "config": {"reasoning": {"mode": "disabled"}, "max_output_tokens": 512},
        },
        None,
    )

    context = configuration.resolve_profile(profile["id"], 1)
    assert {
        k: context[k]
        for k in (
            "provider",
            "endpoint",
            "template",
            "path_prefix",
            "structured_output",
            "reasoning_control",
        )
    } == {
        "provider": "openai_compatible",
        "endpoint": provider.origin,
        "template": "custom",
        "path_prefix": "/v1",
        "structured_output": "json_schema",
        "reasoning_control": "enable_thinking",
    }
    assert configuration.load_context_key(context) is None
    result = runtime.execute_probe(
        context,
        api_key=None,
        prompt='Return {"ok": true}.',
        response_schema=SCHEMA,
    )

    assert result["compatible"] is True
    assert [request["path"] for request in provider.requests] == [
        "/v1/models",
        "/v1/chat/completions",
    ]
    body = provider.requests[1]["body"]
    assert body["enable_thinking"] is False and body["max_tokens"] == 512
    # A new manifest changes the context, so a pinned call cannot run on it.
    configuration.patch_connection(
        row["id"],
        {"model_manifest": [{**entry, "structured_output": "json_object"}]},
        store.get_connection(row["id"])["revision"],
        None,
    )
    with pytest.raises(AIConfigurationError):
        configuration.revalidate_context(context)
