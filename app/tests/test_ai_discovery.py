"""Discovery of openai_compatible origins: fixed or pinned destinations, path
prefixes only for that provider, and a catalog built from the declared manifest.

Network checks use httpx.MockTransport or a fake local HTTP server; no real
provider is called.
"""

import json
import socket
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from unittest.mock import Mock

import httpx
import pytest

from crate.ai import discovery
from crate.ai.capabilities import manifest_capabilities
from crate.ai.contracts import AIConfigurationError
from crate.ai.discovery import discover_models, validate_openai_compatible

KIMI = {
    "model_id": "kimi-k3.1-pro",
    "context_window": 262144,
    "max_output_tokens": 32768,
    "structured_output": "json_object",
    "reasoning": "reasoning_effort",
    "reasoning_levels": ["low", "high", "max"],
}
LOCAL = {
    "model_id": "Qwen/Qwen3.8-27B",
    "context_window": 32768,
    "max_output_tokens": 8192,
    "structured_output": "json_schema",
    "reasoning": "enable_thinking",
}


def answers(*addresses):
    return lambda *args, **kwargs: [
        (
            socket.AF_INET6 if ":" in address else socket.AF_INET,
            socket.SOCK_STREAM,
            6,
            "",
            (address, 8000),
        )
        for address in addresses
    ]


@pytest.fixture
def seen(monkeypatch):
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={"data": [{"id": "kimi-k3.1-pro"}]})

    original = httpx.Client
    monkeypatch.setattr(
        discovery.httpx,
        "Client",
        lambda **kwargs: original(**kwargs, transport=httpx.MockTransport(handle)),
    )
    return requests


def test_openai_compatible_rejects_metadata_ip(monkeypatch, seen):
    for endpoint in (
        "http://169.254.169.254",
        "http://[fd00:ec2::254]",
        "http://[::ffff:169.254.169.254]",
        "http://100.100.100.200",
        "http://metadata.google.internal",
        "https://instance-data.ec2.internal",
    ):
        with pytest.raises(AIConfigurationError) as error:
            validate_openai_compatible("custom", endpoint, "/v1")
        assert error.value.code == "AI_ENDPOINT_INVALID", endpoint

    # A name is checked again when it resolves: one metadata answer is enough
    # to refuse it, and the request never leaves.
    for resolved in (
        ("10.0.0.2", "169.254.169.254"),
        ("fd00:ec2::254",),
        ("fe80::1",),
        ("100.100.100.200",),
        ("0.0.0.0",),
    ):
        monkeypatch.setattr(discovery.socket, "getaddrinfo", answers(*resolved))
        for origin in ("https://llm.internal:8000", "http://llm.internal:8000"):
            with pytest.raises(AIConfigurationError) as error:
                discovery._http_json(
                    "openai_compatible",
                    origin,
                    "/models",
                    api_key="secret-key",
                    template="custom",
                    path_prefix="/v1",
                )
            assert error.value.code == "AI_ENDPOINT_INVALID", (origin, resolved)
    # Plain HTTP is only for private networks, also after resolution.
    monkeypatch.setattr(discovery.socket, "getaddrinfo", answers("10.0.0.2", "8.8.8.8"))
    with pytest.raises(AIConfigurationError) as error:
        discovery._http_json(
            "openai_compatible",
            "http://llm.internal:8000",
            "/models",
            api_key=None,
            template="custom",
            path_prefix="/v1",
        )
    assert error.value.code == "AI_ENDPOINT_INVALID"
    assert seen == []

    # A permitted name is pinned to its checked address with the configured
    # Host and TLS name; HTTPS may reach a public address.
    dns = Mock(side_effect=answers("8.8.8.8"))
    monkeypatch.setattr(discovery.socket, "getaddrinfo", dns)
    discovery._http_json(
        "openai_compatible",
        "https://llm.example.test:8000",
        "/models",
        api_key="secret-key",
        template="custom",
        path_prefix="/v1",
    )
    monkeypatch.setattr(discovery.socket, "getaddrinfo", answers("10.0.0.2"))
    discovery._http_json(
        "openai_compatible",
        "http://llm.internal:8000",
        "/models",
        api_key=None,
        template="custom",
        path_prefix="/compatible-mode/v1",
    )
    assert dns.call_count == 1
    assert [str(request.url) for request in seen] == [
        "https://8.8.8.8:8000/v1/models",
        "http://10.0.0.2:8000/compatible-mode/v1/models",
    ]
    assert seen[0].headers["host"] == "llm.example.test:8000"
    assert seen[0].extensions["sni_hostname"] == "llm.example.test"
    assert seen[0].headers["authorization"] == "Bearer secret-key"
    assert "authorization" not in seen[1].headers


def test_path_prefix_only_for_openai_compatible(monkeypatch, seen):
    resolve = Mock(side_effect=answers("10.0.0.5"))
    monkeypatch.setattr(discovery.socket, "getaddrinfo", resolve)
    for provider, endpoint, extra in (
        ("ollama", "http://10.0.0.5:11434", {"path_prefix": "/v1"}),
        ("ollama", "http://10.0.0.5:11434", {"template": "custom"}),
        ("deepseek", "https://api.deepseek.com", {"path_prefix": "/v1"}),
        ("gemini", None, {"template": "openrouter"}),
    ):
        with pytest.raises(AIConfigurationError) as error:
            discovery._http_json(
                provider, endpoint, "/api/tags", api_key="key", **extra
            )
        assert error.value.code == "AI_ENDPOINT_INVALID"
    request = Mock()
    monkeypatch.setattr(discovery, "_request_json", request)
    for extra in ({"path_prefix": "/v1"}, {"template": "custom"}, {"manifest": [KIMI]}):
        with pytest.raises(AIConfigurationError):
            discover_models(
                "ollama", api_key=None, endpoint="http://10.0.0.5:11434", **extra
            )
    request.assert_not_called()
    # Ollama addresses still carry no path.
    with pytest.raises(AIConfigurationError):
        discovery.validate_endpoint("ollama", "http://10.0.0.5:11434/v1")
    assert seen == [] and resolve.call_count == 0

    # Each template sends its own prefix; nothing else can be prepended.
    for template, prefix, url in (
        ("moonshot", None, "https://api.moonshot.ai/v1/models"),
        (
            "dashscope_intl",
            "/compatible-mode/v1",
            "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
        ),
        ("openrouter", None, "https://openrouter.ai/api/v1/models"),
        ("custom", "/api/v1", "https://10.0.0.5:8000/api/v1/models"),
    ):
        discovery._http_json(
            "openai_compatible",
            "https://10.0.0.5:8000" if template == "custom" else None,
            "/models",
            api_key="key",
            template=template,
            path_prefix=prefix,
        )
        assert str(seen[-1].url) == url
    # Only a custom origin is resolved and pinned; template hosts are fixed.
    assert resolve.call_count == 1
    for template, prefix in (
        ("moonshot", "/api/v1"),
        ("custom", "/internal"),
        ("custom", "/v1/../admin"),
        ("custom", None),
        (None, "/v1"),
    ):
        with pytest.raises(AIConfigurationError) as error:
            discovery._http_json(
                "openai_compatible",
                "https://10.0.0.5:8000",
                "/models",
                api_key="key",
                template=template,
                path_prefix=prefix,
            )
        assert error.value.code == "AI_ENDPOINT_INVALID"


def test_manifest_models_validated_when_the_provider_lists_them():
    listed = manifest_capabilities(KIMI, listed=True)
    assert listed.model_dump(mode="json") == {
        "provider": "openai_compatible",
        "model_id": "kimi-k3.1-pro",
        "label": "kimi-k3.1-pro",
        "input_modalities": ["text"],
        "structured_output": True,
        "reasoning_levels": ["low", "high", "max"],
        "reasoning_disabled": False,
        "reasoning_enabled": False,
        "thinking_budget_min": None,
        "thinking_budget_max": None,
        "max_output_tokens": 32768,
        "context_window": 262144,
        "validated": True,
        "source": "provider+manifest",
        "image_details": ["default"],
    }
    toggled = manifest_capabilities(LOCAL, listed=True)
    assert (toggled.reasoning_enabled, toggled.reasoning_disabled) == (True, True)
    assert toggled.reasoning_levels == []
    assert manifest_capabilities({**KIMI, "label": "Kimi K3.1"}, listed=True).label == (
        "Kimi K3.1"
    )
    missing = manifest_capabilities(KIMI, listed=False)
    assert (missing.validated, missing.source) == (False, "pending")
    with pytest.raises(AIConfigurationError) as error:
        manifest_capabilities({**KIMI, "structured_output": "none"}, listed=True)
    assert error.value.code == "AI_CATALOG_INVALID"


def test_openai_compatible_catalog_reads_models_through_the_real_child(monkeypatch):
    received = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            received.append((self.path, self.headers.get("Authorization")))
            if self.path == "/v1/models":
                body = json.dumps(
                    {"object": "list", "data": [{"id": "Qwen/Qwen3.8-27B"}]}
                ).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_response(302)
                self.send_header("Location", "http://169.254.169.254/latest")
                self.send_header("Content-Length", "0")
                self.end_headers()

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(
        target=lambda: server.serve_forever(poll_interval=0.01), daemon=True
    )
    thread.start()
    endpoint = f"http://127.0.0.1:{server.server_port}"
    try:
        models = discover_models(
            "openai_compatible",
            api_key="local-key",
            endpoint=endpoint,
            template="custom",
            path_prefix="/v1",
            manifest=[LOCAL, KIMI],
        )
        assert [(m["model_id"], m["validated"]) for m in models] == [
            ("Qwen/Qwen3.8-27B", True),
            ("kimi-k3.1-pro", False),
        ]
        assert received == [("/v1/models", "Bearer local-key")]
        # A redirect is a failure, never followed.
        with pytest.raises(AIConfigurationError) as error:
            discover_models(
                "openai_compatible",
                api_key=None,
                endpoint=endpoint,
                template="custom",
                path_prefix="/api/v1",
                manifest=[LOCAL],
            )
        assert error.value.code == "AI_DISCOVERY_HTTP"
        assert [path for path, _ in received] == ["/v1/models", "/api/v1/models"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    request = Mock()
    monkeypatch.setattr(discovery, "_request_json", request)
    # Cloud templates need a key, and every catalog needs a manifest.
    with pytest.raises(AIConfigurationError) as error:
        discover_models(
            "openai_compatible", api_key=None, template="moonshot", manifest=[KIMI]
        )
    assert error.value.code == "AI_CREDENTIAL_REQUIRED"
    with pytest.raises(AIConfigurationError):
        discover_models(
            "openai_compatible", api_key="key", template="moonshot", manifest=[]
        )
    request.assert_not_called()

    started = time.monotonic()
    request.side_effect = lambda *args, **kwargs: {"data": "not a list"}
    with pytest.raises(AIConfigurationError) as error:
        discover_models(
            "openai_compatible", api_key="key", template="moonshot", manifest=[KIMI]
        )
    assert error.value.code == "AI_CATALOG_INVALID"
    assert time.monotonic() - started < 5
