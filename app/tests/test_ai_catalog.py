"""Pure AI catalog contracts; no database or inference calls."""

import socket
import time
from unittest.mock import Mock

import httpx
import pytest
from pydantic import ValidationError

from crate.ai import discovery
from crate.ai.actions import ACTIONS, get_action, list_actions
from crate.ai.capabilities import model_capabilities, validate_profile
from crate.ai.contracts import (
    AIConfigurationError,
    ModelCapabilities,
    ProfileConfig,
    ReasoningConfig,
)
from crate.ai.discovery import discover_models, validate_endpoint


IDS = {
    "shows.extract.vision",
    "shows.extract.text",
    "shows.extract.ocr_text",
    "artwork.hero.analyze",
    "artists.bio.research",
    "genres.description.generate",
    "genres.taxonomy.propose",
    "genres.eq.propose",
    "playlists.description.generate",
    "music_paths.refine",
    "i18n.listen.draft",
}


def test_action_registry_is_closed_and_metadata_complete():
    assert set(ACTIONS) == IDS
    assert {row["id"] for row in list_actions()} == IDS
    for action_id in IDS:
        row = get_action(action_id).model_dump()
        assert all(
            row[key]
            for key in (
                "label",
                "group",
                "input",
                "permission",
                "location",
                "maxima",
                "description",
            )
        )
    assert get_action("shows.extract.vision").maxima.timeout_seconds == 90
    assert get_action("shows.extract.text").maxima.timeout_seconds == 45
    assert get_action("music_paths.refine").maxima.timeout_seconds == 8
    with pytest.raises(AIConfigurationError, match="Unknown action"):
        get_action("arbitrary.run")


def test_contracts_reject_extra_and_inconsistent_or_unbounded_values():
    for value in (
        {"kwargs": {}},
        {"timeout_seconds": 91},
        {"max_output_tokens": 16001},
        {"max_input_tokens": 131073},
        {"timeout_seconds": True},
    ):
        with pytest.raises(ValidationError):
            ProfileConfig(**value)
    for value in (
        {"mode": "level"},
        {"mode": "disabled", "level": "low"},
        {"mode": "budget", "budget_tokens": -1},
        {"mode": "provider_default", "budget_tokens": 1},
    ):
        with pytest.raises(ValidationError):
            ReasoningConfig(**value)
    with pytest.raises(ValidationError):
        ModelCapabilities(
            provider="gemini", model_id="https://evil/model", label="model"
        )


@pytest.mark.parametrize("level", ["low", "medium", "high"])
def test_gemini_38_accepts_only_documented_levels(level):
    model = model_capabilities("gemini", "gemini-3.8-flash")
    config = ProfileConfig(
        reasoning=ReasoningConfig(mode="level", level=level), image_detail="ultra_high"
    )
    assert validate_profile(config, model, "shows.extract.vision") == config
    for reasoning in (
        ReasoningConfig(mode="level", level="minimal"),
        ReasoningConfig(mode="disabled"),
    ):
        with pytest.raises(AIConfigurationError):
            validate_profile(ProfileConfig(reasoning=reasoning), model)


def test_gemini_25_native_budget_and_action_limits():
    model = model_capabilities("gemini", "gemini-2.5-flash")
    assert validate_profile(
        ProfileConfig(reasoning=ReasoningConfig(mode="budget", budget_tokens=1024)),
        model,
    )
    assert validate_profile(
        ProfileConfig(reasoning=ReasoningConfig(mode="disabled")), model
    )
    for config in (
        ProfileConfig(reasoning=ReasoningConfig(mode="level", level="low")),
        ProfileConfig(reasoning=ReasoningConfig(mode="budget", budget_tokens=24577)),
        ProfileConfig(timeout_seconds=46, max_output_tokens=2048),
        ProfileConfig(timeout_seconds=45, max_output_tokens=2049),
    ):
        with pytest.raises(AIConfigurationError):
            validate_profile(config, model, "genres.eq.propose")
    with pytest.raises(AIConfigurationError):
        validate_profile(ProfileConfig(image_detail="ultra_high"), model)


def deepseek_metadata(**overrides):
    return {
        "id": "deepseek-flash",
        "name": "DeepSeek Flash",
        "input_modalities": ["text", "image"],
        "output_modalities": ["text"],
        "context_window": 1048576,
        "max_output_tokens": 393216,
        "effort": {"supported_levels": ["low", "high", "max"], "default_level": "high"},
        **overrides,
    }


def test_deepseek_uses_real_metadata_without_friendly_name_inference():
    model = model_capabilities("deepseek", "deepseek-flash", deepseek_metadata())
    assert model.validated and model.structured_output
    assert model.reasoning_levels == ["low", "high", "max"]
    assert model.reasoning_disabled
    assert validate_profile(ProfileConfig(), model, "shows.extract.vision")
    with pytest.raises(AIConfigurationError):
        validate_profile(
            ProfileConfig(reasoning=ReasoningConfig(mode="level", level="medium")),
            model,
        )
    text_only = model_capabilities(
        "deepseek", "deepseek-flash", deepseek_metadata(input_modalities=["text"])
    )
    with pytest.raises(AIConfigurationError):
        validate_profile(ProfileConfig(), text_only, "shows.extract.vision")
    unknown = model_capabilities("gemini", "gemini-99-vision-ultra")
    assert not unknown.validated and unknown.input_modalities == []
    with pytest.raises(AIConfigurationError):
        validate_profile(ProfileConfig(), unknown)
    assert not model_capabilities("ollama", "vision:latest").validated


@pytest.mark.parametrize(
    "metadata",
    [
        deepseek_metadata(context_window="lots"),
        deepseek_metadata(effort={"supported_levels": ["x"] * 33}),
        deepseek_metadata(name="x" * 300),
    ],
)
def test_malformed_metadata_never_validates(metadata):
    with pytest.raises(AIConfigurationError):
        model_capabilities("deepseek", "deepseek-flash", metadata)


def test_gemini_discovery_pages_headers_and_manifest(monkeypatch):
    calls = []

    def request(provider, endpoint, path, **kwargs):
        calls.append((provider, endpoint, path, kwargs))
        if len(calls) == 1:
            return {
                "models": [
                    {
                        "name": "models/gemini-3.8-flash",
                        "displayName": "Gemini 3.8",
                        "supportedGenerationMethods": ["generateContent"],
                    }
                ],
                "nextPageToken": "page2",
            }
        return {"models": [{"name": "models/unknown-vision"}]}

    monkeypatch.setattr(discovery, "_request_json", request)
    result = discover_models("gemini", api_key="private-key")
    assert len(result) == 2 and result[0]["validated"] and not result[1]["validated"]
    assert calls[1][3]["params"]["pageToken"] == "page2"
    assert all(call[3]["api_key"] == "private-key" for call in calls)


def test_catalog_page_entry_and_ollama_show_bounds(monkeypatch):
    request = Mock(
        return_value={"models": [{"name": "models/unknown"}], "nextPageToken": "more"}
    )
    monkeypatch.setattr(discovery, "_request_json", request)
    discover_models("gemini", api_key="key")
    assert request.call_count == 10
    request.reset_mock()
    request.return_value = {"models": [{"name": f"model-{i}"} for i in range(600)]}
    assert len(discover_models("gemini", api_key="key")) == 500
    request.side_effect = lambda provider, endpoint, path, **kwargs: (
        {"models": [{"name": f"model-{i}"} for i in range(600)]}
        if path == "/api/tags"
        else {
            "capabilities": ["completion", "vision", "thinking"],
            "model_info": {
                "general.architecture": "llama",
                "llama.context_length": 8192,
            },
        }
    )
    request.reset_mock()
    models = discover_models("ollama", api_key=None, endpoint="http://127.0.0.1:11434")
    assert len(models) == 500 and request.call_count == 101
    assert models[0]["validated"] and models[0]["reasoning_levels"] == []
    assert not models[100]["validated"]


def test_catalog_rejects_malformed_and_stops_at_deadline(monkeypatch):
    monkeypatch.setattr(
        discovery, "_request_json", Mock(return_value={"models": "bad"})
    )
    with pytest.raises(AIConfigurationError):
        discover_models("gemini", api_key="key")
    ticks = iter([0, 0, 31])
    monkeypatch.setattr(discovery.time, "monotonic", lambda: next(ticks))
    request = Mock(return_value={"models": [], "nextPageToken": "next"})
    monkeypatch.setattr(discovery, "_request_json", request)
    with pytest.raises(AIConfigurationError) as exc:
        discover_models("gemini", api_key="key")
    assert exc.value.code == "AI_DISCOVERY_TIMEOUT" and request.call_count == 1


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://169.254.169.254",
        "http://[fe80::1]",
        "http://[::ffff:169.254.169.254]",
        "http://metadata.google.internal",
        "http://user:pass@localhost",
        "http://localhost?x=1",
        "http://localhost#fragment",
        "file:///tmp/a",
        "http://localhost/api",
        "http://0.0.0.0",
    ],
)
def test_unsafe_endpoint_rejected(endpoint):
    with pytest.raises(AIConfigurationError):
        validate_endpoint("ollama", endpoint)


def test_endpoints_cloud_fixed_private_allowed_and_dns_all_answers_checked(monkeypatch):
    assert validate_endpoint("gemini", None) is None
    assert (
        validate_endpoint("deepseek", "https://api.deepseek.com")
        == "https://api.deepseek.com"
    )
    assert (
        validate_endpoint("ollama", "http://127.0.0.1:11434/")
        == "http://127.0.0.1:11434"
    )
    assert (
        validate_endpoint("ollama", "https://10.0.0.5:11434")
        == "https://10.0.0.5:11434"
    )
    with pytest.raises(AIConfigurationError):
        validate_endpoint("gemini", "https://evil.test")
    monkeypatch.setattr(
        discovery.socket,
        "getaddrinfo",
        lambda *a, **kw: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.2", 11434)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("169.254.169.254", 11434)),
        ],
    )
    with pytest.raises(AIConfigurationError):
        discovery._http_json(
            "ollama", "http://ollama.local:11434", "/api/tags", api_key=None
        )


def test_http_pins_dns_host_sni_no_redirects_and_keys_per_call(monkeypatch):
    seen = []

    def handle(request):
        seen.append(request)
        return httpx.Response(200, json={"models": []})

    original = httpx.Client
    monkeypatch.setattr(
        discovery.httpx,
        "Client",
        lambda **kwargs: original(**kwargs, transport=httpx.MockTransport(handle)),
    )
    dns = Mock(
        return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", 11434))]
    )
    monkeypatch.setattr(discovery.socket, "getaddrinfo", dns)
    discovery._http_json(
        "ollama", "https://ollama.local:11434", "/api/tags", api_key=None
    )
    assert str(seen[0].url) == "https://10.0.0.5:11434/api/tags"
    assert seen[0].headers["host"] == "ollama.local:11434"
    assert seen[0].extensions["sni_hostname"] == "ollama.local"
    assert dns.call_count == 1
    discovery._http_json("gemini", None, "/v1beta/models", api_key="key-one")
    discovery._http_json("gemini", None, "/v1beta/models", api_key="key-two")
    assert seen[1].headers["x-goog-api-key"] == "key-one"
    assert seen[2].headers["x-goog-api-key"] == "key-two"


@pytest.mark.parametrize("kind", ["redirect", "error", "oversized", "timeout"])
def test_http_errors_bounded_and_secret_free(monkeypatch, kind):
    calls = []

    def handle(request):
        calls.append(request)
        if kind == "redirect":
            return httpx.Response(302, headers={"Location": "http://169.254.169.254"})
        if kind == "error":
            raise httpx.ConnectError("secret-key in unsafe upstream error")
        if kind == "oversized":
            return httpx.Response(
                200, content=b"x" * (discovery.MAX_RESPONSE_BYTES + 1)
            )
        raise httpx.ReadTimeout("secret-key")

    original = httpx.Client
    monkeypatch.setattr(
        discovery.httpx,
        "Client",
        lambda **kwargs: original(**kwargs, transport=httpx.MockTransport(handle)),
    )
    with pytest.raises(AIConfigurationError) as exc:
        discovery._http_json("gemini", None, "/v1beta/models", api_key="secret-key")
    assert len(calls) == 1 and "secret-key" not in str(exc.value)
    assert exc.value.__cause__ is None


def test_missing_key_and_unsupported_provider_do_not_call_network(monkeypatch):
    request = Mock()
    monkeypatch.setattr(discovery, "_request_json", request)
    for provider in ("gemini", "deepseek", "openai"):
        with pytest.raises(AIConfigurationError):
            discover_models(provider, api_key=None)
    request.assert_not_called()


def test_ollama_thinking_controls_come_from_show_values():
    metadata = {
        "capabilities": ["completion", "thinking"],
        "thinking": {"values": ["low", "medium", "high"], "default": "medium"},
    }
    model = model_capabilities("ollama", "whatever:latest", metadata)
    assert model.reasoning_levels == ["low", "medium", "high"]
    assert not model.reasoning_disabled
    assert validate_profile(
        ProfileConfig(reasoning=ReasoningConfig(mode="level", level="medium")), model
    )
    with pytest.raises(AIConfigurationError):
        validate_profile(
            ProfileConfig(reasoning=ReasoningConfig(mode="disabled")), model
        )
    toggle = model_capabilities(
        "ollama",
        "whatever:latest",
        {**metadata, "thinking": {"values": [True, False], "default": True}},
    )
    assert toggle.reasoning_disabled and toggle.reasoning_levels == []
    absent = model_capabilities(
        "ollama", "whatever:latest", {"capabilities": ["completion", "thinking"]}
    )
    assert not absent.reasoning_disabled and absent.reasoning_levels == []
    with pytest.raises(AIConfigurationError):
        model_capabilities(
            "ollama", "whatever", {**metadata, "thinking": {"values": [0]}}
        )


def test_oversized_entry_and_gemini_metadata_cannot_invent_capabilities(monkeypatch):
    monkeypatch.setattr(
        discovery,
        "_request_json",
        Mock(
            return_value={
                "models": [
                    {
                        "name": "models/unknown",
                        "description": "x" * discovery.MAX_ENTRY_BYTES,
                    }
                ]
            }
        ),
    )
    with pytest.raises(AIConfigurationError):
        discover_models("gemini", api_key="key")
    model = model_capabilities(
        "gemini",
        "unlisted",
        {
            "input_modalities": ["text", "image"],
            "validated": True,
            "reasoning_levels": ["high"],
        },
    )
    assert (
        not model.validated
        and model.reasoning_levels == []
        and model.input_modalities == []
    )


def test_discovery_subprocess_timeout_kills_and_reaps(monkeypatch):
    processes = []
    original = discovery.subprocess.Popen

    def capture(*args, **kwargs):
        # A real hanging process substitutes the DNS/network worker.
        process = original(
            [discovery.sys.executable, "-c", "import time; time.sleep(60)"], **kwargs
        )
        processes.append(process)
        return process

    monkeypatch.setattr(discovery.subprocess, "Popen", capture)
    monkeypatch.setattr(discovery, "REQUEST_SECONDS", 0.05)
    started = time.monotonic()
    with pytest.raises(AIConfigurationError) as exc:
        discovery._request_json(
            "ollama",
            "http://127.0.0.1:11434",
            "/api/tags",
            api_key=None,
            deadline=started + 30,
        )
    assert exc.value.code == "AI_DISCOVERY_TIMEOUT"
    assert time.monotonic() - started < 2
    assert processes[0].poll() is not None and processes[0].returncode < 0


def test_discovery_real_child_uses_local_catalog_and_rejects_redirects():
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from threading import Thread

    seen = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append(self.path)
            if self.path == "/api/tags":
                body = b'{"models": [{"name": "local-model"}]}'
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_response(302)
                self.send_header("Location", "http://169.254.169.254")
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
        result = discovery._request_json(
            "ollama",
            endpoint,
            "/api/tags",
            api_key=None,
            deadline=time.monotonic() + 30,
        )
        assert result == {"models": [{"name": "local-model"}]}
        with pytest.raises(AIConfigurationError) as exc:
            discovery._request_json(
                "ollama",
                endpoint,
                "/redirect",
                api_key=None,
                deadline=time.monotonic() + 30,
            )
        assert exc.value.code == "AI_DISCOVERY_HTTP"
        assert seen == ["/api/tags", "/redirect"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_action_locations_point_to_existing_admin_surfaces():
    assert get_action("shows.extract.vision").location == "/upcoming"
    assert get_action("artwork.hero.analyze").location == "/browse"
    assert get_action("artists.bio.research").location == "/browse"
    assert get_action("i18n.listen.draft").location == "/i18n"
    assert get_action("music_paths.refine").location == "/settings"


def test_discovery_process_start_failure_is_closed(monkeypatch):
    def unavailable(*args, **kwargs):
        raise OSError("private upstream details")

    monkeypatch.setattr(discovery.subprocess, "Popen", unavailable)
    with pytest.raises(AIConfigurationError) as exc:
        discovery._request_json(
            "gemini",
            None,
            "/v1beta/models",
            api_key="private-key",
            deadline=time.monotonic() + 30,
        )
    assert exc.value.code == "AI_DISCOVERY_FAILED"
    assert "private" not in str(exc.value)


def test_deepseek_discovery_normalizes_catalog_and_passes_exact_key(monkeypatch):
    request = Mock(return_value={"data": [deepseek_metadata()]})
    monkeypatch.setattr(discovery, "_request_json", request)
    result = discover_models("deepseek", api_key="exact-key")
    assert result[0]["model_id"] == "deepseek-flash"
    assert result[0]["reasoning_levels"] == ["low", "high", "max"]
    assert request.call_args.args[:3] == ("deepseek", None, "/models")
    assert request.call_args.kwargs["api_key"] == "exact-key"


@pytest.mark.parametrize(
    "provider,field,endpoint",
    [
        ("gemini", "models", None),
        ("deepseek", "data", None),
        ("ollama", "models", "http://127.0.0.1:11434"),
    ],
)
@pytest.mark.parametrize("payload", [{}, {"error": "unexpected provider error"}])
def test_discovery_requires_catalog_array(
    monkeypatch, provider, field, endpoint, payload
):
    monkeypatch.setattr(discovery, "_request_json", Mock(return_value=payload))
    with pytest.raises(AIConfigurationError) as exc:
        discover_models(provider, api_key="key", endpoint=endpoint)
    assert exc.value.code == "AI_CATALOG_INVALID"


@pytest.mark.parametrize(
    "provider,field,endpoint",
    [
        ("gemini", "models", None),
        ("deepseek", "data", None),
        ("ollama", "models", "http://127.0.0.1:11434"),
    ],
)
def test_discovery_accepts_explicit_empty_catalog(
    monkeypatch, provider, field, endpoint
):
    monkeypatch.setattr(discovery, "_request_json", Mock(return_value={field: []}))
    assert discover_models(provider, api_key="key", endpoint=endpoint) == []


@pytest.mark.parametrize("setup_seconds,expected_wait", [(3.0, 2.0), (6.0, None)])
def test_request_deadline_deducts_all_setup(monkeypatch, setup_seconds, expected_wait):
    now = [100.0]
    original_dumps = discovery.json.dumps
    original_tempfile = discovery.tempfile.TemporaryFile
    process = Mock(pid=12345)
    process.poll.return_value = None
    process.communicate.side_effect = discovery.subprocess.TimeoutExpired(
        "discovery", 5
    )

    def serialize(*args, **kwargs):
        now[0] += 0.5
        return original_dumps(*args, **kwargs)

    def tempfile(*args, **kwargs):
        now[0] += 0.5
        return original_tempfile(*args, **kwargs)

    def spawn(*args, **kwargs):
        now[0] += 1
        return process

    def limit(*args, **kwargs):
        now[0] += setup_seconds - 2

    monkeypatch.setattr(discovery.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(discovery.json, "dumps", serialize)
    monkeypatch.setattr(discovery.tempfile, "TemporaryFile", tempfile)
    monkeypatch.setattr(discovery.subprocess, "Popen", spawn)
    monkeypatch.setattr(discovery.resource, "prlimit", limit)
    with pytest.raises(AIConfigurationError) as exc:
        discovery._request_json(
            "gemini", None, "/v1beta/models", api_key="key", deadline=130
        )
    assert exc.value.code == "AI_DISCOVERY_TIMEOUT"
    if expected_wait is None:
        process.communicate.assert_not_called()
    else:
        assert process.communicate.call_args.kwargs["timeout"] == expected_wait
    process.kill.assert_called_once_with()
    process.wait.assert_called_once_with()
