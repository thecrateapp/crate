"""Single native inference request with a killable end-to-end deadline.

Credentials and source travel over a private child stdin, never argv or logs.
Native request options are pinned by the caller; no environment configuration,
transport retries, redirects, continuation or provider fallback are used.
"""

from __future__ import annotations

import base64
import json
import resource
import socket
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

import httpx

from crate.ai.contracts import AIConfigurationError, ProfileConfig
from crate.ai.discovery import _check_address, validate_endpoint

MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_REQUEST_BYTES = 32 * 1024 * 1024
_BASES = {
    "gemini": "https://generativelanguage.googleapis.com",
    "deepseek": "https://api.deepseek.com",
}
_CODES = {
    "AI_ENDPOINT_INVALID",
    "AI_PROVIDER_TIMEOUT",
    "AI_PROVIDER_FAILED",
    "AI_RESPONSE_INVALID",
}


@dataclass(frozen=True)
class NativeResponse:
    text: str
    usage: dict | None
    reported_model: str | None
    duration_ms: int


def _fail(code="AI_PROVIDER_FAILED"):
    return AIConfigurationError(code, "Provider request could not be completed")


def _http_json(provider, endpoint, path, *, api_key, body, timeout_seconds):
    endpoint = validate_endpoint(provider, endpoint)
    base = endpoint or _BASES[provider]
    headers = {"Accept": "application/json"}
    if provider == "gemini":
        headers["x-goog-api-key"] = api_key or ""
    elif api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    extensions: dict[str, Any] = {}
    if provider == "ollama":
        parsed = urlsplit(base)
        hostname = parsed.hostname or ""
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        answers = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
        addresses = list(
            dict.fromkeys(_check_address(str(answer[4][0])) for answer in answers)
        )
        if not addresses:
            raise _fail("AI_ENDPOINT_INVALID")
        address = addresses[0]
        host = f"[{address}]" if ":" in address else address
        headers["Host"] = parsed.netloc
        extensions["sni_hostname"] = hostname
        base = urlunsplit((parsed.scheme, f"{host}:{port}", "", "", ""))
    try:
        with httpx.Client(
            timeout=timeout_seconds, follow_redirects=False, trust_env=False
        ) as client:
            with client.stream(
                "POST", base + path, headers=headers, json=body, extensions=extensions
            ) as response:
                if response.status_code != 200:
                    raise _fail()
                data = bytearray()
                for chunk in response.iter_bytes(chunk_size=65536):
                    if len(data) + len(chunk) > MAX_RESPONSE_BYTES:
                        raise _fail("AI_RESPONSE_INVALID")
                    data.extend(chunk)
                result = json.loads(data)
                if not isinstance(result, dict):
                    raise _fail("AI_RESPONSE_INVALID")
                return result
    except AIConfigurationError:
        raise
    except httpx.TimeoutException:
        raise _fail("AI_PROVIDER_TIMEOUT") from None
    except Exception:
        raise _fail() from None


def _request_json(*, provider, endpoint, path, api_key, body, deadline):
    packet = json.dumps(
        {
            "provider": provider,
            "endpoint": endpoint,
            "path": path,
            "api_key": api_key,
            "body": body,
            "timeout_seconds": max(0.001, deadline - time.monotonic()),
        }
    ).encode()
    if len(packet) > MAX_REQUEST_BYTES:
        raise _fail("AI_RESPONSE_INVALID")
    with tempfile.TemporaryFile(mode="w+b") as output:
        try:
            process = subprocess.Popen(
                [sys.executable, "-m", "crate.ai.transport"],
                stdin=subprocess.PIPE,
                stdout=output,
                stderr=subprocess.DEVNULL,
            )
        except OSError:
            raise _fail() from None
        try:
            try:
                resource.prlimit(
                    process.pid,
                    resource.RLIMIT_FSIZE,
                    (MAX_RESPONSE_BYTES + 1024, MAX_RESPONSE_BYTES + 1024),
                )
            except ProcessLookupError:
                pass
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired("inference", 0)
            process.communicate(input=packet, timeout=remaining)
            if process.returncode:
                raise _fail()
            output.seek(0)
            encoded = output.read(MAX_RESPONSE_BYTES + 1025)
            if len(encoded) > MAX_RESPONSE_BYTES + 1024:
                raise _fail("AI_RESPONSE_INVALID")
            result = json.loads(encoded)
            if not isinstance(result, dict):
                raise _fail("AI_RESPONSE_INVALID")
            if result.get("error") in _CODES:
                raise _fail(result["error"])
            if not isinstance(result.get("result"), dict):
                raise _fail("AI_RESPONSE_INVALID")
            return result["result"]
        except AIConfigurationError:
            raise
        except subprocess.TimeoutExpired:
            raise _fail("AI_PROVIDER_TIMEOUT") from None
        except Exception:
            raise _fail() from None
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()


def _usage(provider, data):
    if provider == "gemini":
        native = data.get("usageMetadata", {})
        usage = {
            "input_tokens": native.get("promptTokenCount"),
            "output_tokens": native.get("candidatesTokenCount"),
            "thought_tokens": native.get("thoughtsTokenCount"),
            "cached_input_tokens": native.get("cachedContentTokenCount"),
            "total_tokens": native.get("totalTokenCount"),
        }
    elif provider == "deepseek":
        native = data.get("usage", {})
        thought = native.get("completion_tokens_details", {}).get("reasoning_tokens")
        output = native.get("completion_tokens")
        if type(output) is int and type(thought) is int:
            output -= thought
        usage = {
            "input_tokens": native.get("prompt_tokens"),
            "output_tokens": output,
            "thought_tokens": thought,
            "cached_input_tokens": native.get("prompt_cache_hit_tokens"),
            "total_tokens": native.get("total_tokens"),
        }
    else:
        # Ollama eval_count includes reasoning, but exposes no separate token count.
        # Keep the aggregate output count and leave thought_tokens unknown.
        usage = {
            "input_tokens": data.get("prompt_eval_count"),
            "output_tokens": data.get("eval_count"),
        }
    if any(
        type(usage.get(k)) is not int or usage[k] < 0
        for k in ("input_tokens", "output_tokens")
    ):
        return None
    if any(
        value is not None and (type(value) is not int or not 0 <= value <= 1000000000)
        for value in usage.values()
    ):
        return None
    if (usage.get("cached_input_tokens") or 0) > usage["input_tokens"]:
        return None
    return usage


def generate(
    context, *, api_key, prompt, response_schema, system="", image=None, media_type=None
) -> NativeResponse:
    """Translate pinned native controls, execute once and discard reasoning text."""
    started = time.monotonic()
    try:
        provider = context["provider"]
        model_id = context["model_id"]
        config = ProfileConfig.model_validate(context["config"])
        deadline = started + config.timeout_seconds
        reasoning = config.reasoning
        instruction = (
            (system + "\n\n" if system else "")
            + "Return only a JSON object matching this schema:\n"
            + json.dumps(response_schema)
        )
        encoded = base64.b64encode(image).decode() if image is not None else None
        if image is not None and (
            not image
            or media_type not in {"image/png", "image/jpeg", "image/webp", "image/gif"}
        ):
            raise _fail("AI_RESPONSE_INVALID")
        if provider == "gemini":
            parts: list[dict] = [{"text": prompt}]
            if encoded:
                part: dict[str, Any] = {
                    "inlineData": {"mimeType": media_type, "data": encoded}
                }
                if config.image_detail != "default":
                    part["mediaResolution"] = {
                        "level": "MEDIA_RESOLUTION_" + config.image_detail.upper()
                    }
                parts.append(part)
            generation: dict[str, Any] = {
                "responseMimeType": "application/json",
                "maxOutputTokens": config.max_output_tokens,
            }
            if reasoning.mode != "provider_default":
                generation["thinkingConfig"] = (
                    {"thinkingLevel": reasoning.level}
                    if reasoning.mode == "level"
                    else {
                        "thinkingBudget": 0
                        if reasoning.mode == "disabled"
                        else reasoning.budget_tokens
                    }
                )
            body = {
                "systemInstruction": {"parts": [{"text": instruction}]},
                "contents": [{"parts": parts}],
                "generationConfig": generation,
            }
            path = "/v1beta/models/" + quote(model_id, safe="") + ":generateContent"
        elif provider in {"deepseek", "ollama"}:
            if reasoning.mode == "budget" or config.image_detail != "default":
                raise _fail("AI_RESPONSE_INVALID")
            user: dict[str, Any] = {"role": "user", "content": prompt}
            if encoded:
                if provider == "ollama":
                    user["images"] = [encoded]
                else:
                    user["content"] = [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{media_type};base64,{encoded}"},
                        },
                    ]
            body = {
                "model": model_id,
                "messages": [{"role": "system", "content": instruction}, user],
                "stream": False,
            }
            if provider == "deepseek":
                path = "/chat/completions"
                body.update(
                    response_format={"type": "json_object"},
                    max_tokens=config.max_output_tokens,
                )
                if reasoning.mode != "provider_default":
                    body["thinking"] = {
                        "type": "disabled"
                        if reasoning.mode == "disabled"
                        else "enabled"
                    }
                if reasoning.mode == "level":
                    body["reasoning_effort"] = reasoning.level
            else:
                path = "/api/chat"
                body.update(
                    format=response_schema,
                    options={"num_predict": config.max_output_tokens},
                )
                if reasoning.mode != "provider_default":
                    body["think"] = (
                        False
                        if reasoning.mode == "disabled"
                        else True
                        if reasoning.mode == "enabled"
                        else reasoning.level
                    )
        else:
            raise _fail("AI_RESPONSE_INVALID")
        data = _request_json(
            provider=provider,
            endpoint=context.get("endpoint"),
            path=path,
            api_key=api_key,
            body=body,
            deadline=deadline,
        )
        if provider == "gemini":
            text = "".join(
                part["text"]
                for part in data["candidates"][0]["content"]["parts"]
                if "text" in part and not part.get("thought")
            )
        elif provider == "deepseek":
            text = data["choices"][0]["message"]["content"]
        else:
            text = data["message"]["content"]
        if not isinstance(text, str):
            raise _fail("AI_RESPONSE_INVALID")
        model = data.get("modelVersion" if provider == "gemini" else "model")
        if not isinstance(model, str) or not 1 <= len(model) <= 200:
            model = None
        return NativeResponse(
            text,
            _usage(provider, data),
            model,
            int((time.monotonic() - started) * 1000),
        )
    except AIConfigurationError:
        raise
    except Exception:
        raise _fail() from None


def generate_legacy(
    context, *, api_key, prompt, response_schema, system="", image=None, media_type=None
) -> NativeResponse:
    """Preserve native omitted options through explicitly injected old provider APIs."""
    started = time.monotonic()
    legacy_config = context if context["mode"] == "legacy" else context["config"]
    timeout = legacy_config.get("legacy_deadline_seconds")
    if timeout is None:
        raise AIConfigurationError(
            "AI_LEGACY_LIMITS_UNKNOWN", "Inherited native timeout is unknown"
        )
    body = {
        "context": context,
        "prompt": prompt,
        "schema": response_schema,
        "system": system,
        "image": base64.b64encode(image).decode() if image else None,
        "media_type": media_type,
    }
    data = _request_json(
        provider=context["provider"],
        endpoint=context.get("endpoint"),
        path="__legacy",
        api_key=api_key,
        body=body,
        deadline=started + timeout,
    )
    return NativeResponse(
        data["text"],
        data.get("usage"),
        data.get("reported_model"),
        int((time.monotonic() - started) * 1000),
    )


def _legacy_response(packet):
    from pydantic import BaseModel, ConfigDict
    from crate.llm import provider

    body = packet["body"]
    context = body["context"]
    options = context.get("legacy_options") or context["config"]["legacy_options"]
    captured = []

    class Response(BaseModel):
        model_config = ConfigDict(extra="allow")

        @classmethod
        def model_json_schema(cls, *args, **kwargs):
            return body["schema"]

    class HttpResponse:
        def __init__(self, data):
            self.data = data

        def raise_for_status(self):
            pass

        def json(self):
            return self.data

    def post(url, *, json, **kwargs):
        # The old function builds its exact native payload. The reviewed transport
        # supplies destination/key and enforces endpoint policy independently.
        data = _http_json(
            context["provider"],
            context.get("endpoint"),
            urlsplit(url).path,
            api_key=packet["api_key"],
            body=json,
            timeout_seconds=packet["timeout_seconds"],
        )
        captured.append(data)
        return HttpResponse(data)

    injected = {
        "api_key": packet["api_key"],
        "endpoint": context.get("endpoint"),
        "post": post,
    }
    kwargs = {
        "system": body["system"],
        "model": context.get("legacy_model") or context["config"]["legacy_model"],
        "timeout_seconds": options["timeout_seconds"],
        "max_tokens": options["max_tokens"],
        "private_response": True,
        "_injected": injected,
    }
    if body.get("image") is not None:
        result = provider.ask_image_structured(
            Response,
            body["prompt"],
            image=base64.b64decode(body["image"]),
            media_type=body["media_type"],
            image_detail=options["image_detail"],
            **kwargs,
        )
    else:
        result = provider.ask_structured(Response, body["prompt"], **kwargs)
    data = captured[0] if captured else {}
    model = data.get("modelVersion" if context["provider"] == "gemini" else "model")
    if not isinstance(model, str) or not 1 <= len(model) <= 200:
        model = None
    return {
        "text": result.model_dump_json(),
        "usage": _usage(context["provider"], data) if captured else None,
        "reported_model": model,
    }


def _main():
    try:
        packet = json.loads(sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1))
        result = (
            _legacy_response(packet)
            if packet["path"] == "__legacy"
            else _http_json(**packet)
        )
        sys.stdout.write(json.dumps({"result": result}))
    except AIConfigurationError as exc:
        sys.stdout.write(
            json.dumps(
                {"error": exc.code if exc.code in _CODES else "AI_PROVIDER_FAILED"}
            )
        )
    except Exception:
        sys.stdout.write(json.dumps({"error": "AI_PROVIDER_FAILED"}))


if __name__ == "__main__":
    _main()
