"""Bounded, non-inference model discovery with explicit credentials.

Ollama is an explicitly configured administrator destination: private and loopback
addresses are allowed, but metadata/link-local addresses are not. DNS is resolved
once per request; the socket connects to the checked IP while Host and TLS SNI
retain the configured hostname. Proxies, redirects and transport retries are off.
A killed/reaped subprocess bounds DNS, connect, headers, body and parsing together.
"""

from __future__ import annotations

import ipaddress
import json
import resource
import socket
import subprocess
import sys
import tempfile
import time
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx

from crate.ai.capabilities import model_capabilities
from crate.ai.contracts import AIConfigurationError

MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_ENTRY_BYTES = 64 * 1024
MAX_MODELS = 500
MAX_PAGES = 10
MAX_OLLAMA_SHOW = 100
REQUEST_SECONDS = 5.0
DISCOVERY_SECONDS = 30.0
_BASES = {
    "gemini": "https://generativelanguage.googleapis.com",
    "deepseek": "https://api.deepseek.com",
}
_METADATA_HOSTS = {
    "metadata.google.internal",
    "metadata.goog",
    "instance-data",
    "instance-data.ec2.internal",
}


def _error(code: str, message: str) -> AIConfigurationError:
    return AIConfigurationError(code, message)


def _check_address(raw: str) -> str:
    address = ipaddress.ip_address(raw)
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped:
            address = address.ipv4_mapped
        elif address.sixtofour or address.teredo:
            raise _error("AI_ENDPOINT_INVALID", "Unsupported endpoint address")
    if (
        address.is_link_local
        or address.is_multicast
        or address.is_unspecified
        or (address.is_reserved and not address.is_loopback)
        or str(address) in {"100.100.100.200", "192.0.0.192"}
    ):
        raise _error("AI_ENDPOINT_INVALID", "Endpoint address is not allowed")
    return str(address)


def validate_endpoint(provider: str, endpoint: str | None) -> str | None:
    """Validate configuration syntax; request-time DNS validation pins the socket."""
    if provider not in {*_BASES, "ollama"}:
        raise _error("AI_PROVIDER_UNSUPPORTED", "Provider is not supported")
    if endpoint is None:
        if provider == "ollama":
            raise _error("AI_ENDPOINT_INVALID", "Ollama requires an explicit endpoint")
        return None
    if (
        not isinstance(endpoint, str)
        or len(endpoint) > 2048
        or any(ord(char) <= 32 for char in endpoint)
        or "\\" in endpoint
        or "%" in endpoint
    ):
        raise _error("AI_ENDPOINT_INVALID", "Invalid endpoint")
    try:
        parsed = urlsplit(endpoint)
        port = parsed.port
        hostname = (
            (parsed.hostname or "").rstrip(".").encode("idna").decode("ascii").lower()
        )
        if (
            parsed.scheme not in {"http", "https"}
            or not hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.path not in {"", "/"}
            or (port is not None and not 1 <= port <= 65535)
        ):
            raise ValueError("Invalid endpoint")
        if provider in _BASES:
            if endpoint.rstrip("/") != _BASES[provider]:
                raise ValueError("Cloud endpoint is fixed")
            return _BASES[provider]
        if hostname in _METADATA_HOSTS or hostname.endswith(
            ".metadata.google.internal"
        ):
            raise ValueError("Metadata endpoint")
        try:
            address = ipaddress.ip_address(hostname)
        except ValueError:
            address = None
        if address is not None:
            _check_address(str(address))
        elif ":" in hostname or any(
            not (char.isalnum() or char in ".-") for char in hostname
        ):
            raise ValueError("Invalid hostname")
        host = f"[{hostname}]" if ":" in hostname else hostname
        return f"{parsed.scheme}://{host}" + (f":{port}" if port is not None else "")
    except (ValueError, UnicodeError):
        raise _error("AI_ENDPOINT_INVALID", "Invalid or disallowed endpoint") from None


def _http_json(
    provider: str,
    endpoint: str | None,
    path: str,
    *,
    api_key: str | None,
    params: dict | None = None,
    body: dict | None = None,
) -> dict:
    """One request inside the deadline subprocess (also exercised with fake HTTP)."""
    endpoint = validate_endpoint(provider, endpoint)
    base = endpoint or _BASES[provider]
    headers = {"Accept": "application/json"}
    if provider == "gemini":
        headers["x-goog-api-key"] = api_key or ""
    elif provider == "deepseek" or api_key:
        headers["Authorization"] = f"Bearer {api_key or ''}"
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
            raise _error("AI_ENDPOINT_INVALID", "Endpoint has no permitted address")
        address = addresses[0]
        host = f"[{address}]" if ":" in address else address
        headers["Host"] = parsed.netloc
        extensions["sni_hostname"] = hostname
        base = urlunsplit((parsed.scheme, f"{host}:{port}", "", "", ""))
    try:
        with httpx.Client(
            timeout=REQUEST_SECONDS, follow_redirects=False, trust_env=False
        ) as client:
            with client.stream(
                "POST" if body is not None else "GET",
                base + path,
                headers=headers,
                params=params,
                json=body,
                extensions=extensions,
            ) as response:
                if response.status_code != 200:
                    raise _error("AI_DISCOVERY_HTTP", "Provider catalog request failed")
                data = bytearray()
                for chunk in response.iter_bytes(chunk_size=65536):
                    if len(data) + len(chunk) > MAX_RESPONSE_BYTES:
                        raise _error(
                            "AI_CATALOG_INVALID",
                            "Provider catalog exceeds the byte limit",
                        )
                    data.extend(chunk)
                result = json.loads(data)
                if not isinstance(result, dict):
                    raise _error("AI_CATALOG_INVALID", "Provider catalog is malformed")
                return result
    except AIConfigurationError:
        raise
    except httpx.TimeoutException:
        raise _error(
            "AI_DISCOVERY_TIMEOUT", "Provider catalog request timed out"
        ) from None
    except (httpx.HTTPError, OSError, ValueError, RecursionError):
        # Never chain network errors: URLs/headers/body may contain provider secrets.
        raise _error(
            "AI_DISCOVERY_FAILED", "Provider catalog could not be read"
        ) from None


def _request_json(
    provider: str,
    endpoint: str | None,
    path: str,
    *,
    api_key: str | None,
    deadline: float,
    params: dict | None = None,
    body: dict | None = None,
) -> dict:
    timeout = min(REQUEST_SECONDS, deadline - time.monotonic())
    if timeout <= 0:
        raise _error("AI_DISCOVERY_TIMEOUT", "Provider discovery timed out")
    packet = json.dumps(
        {
            "provider": provider,
            "endpoint": endpoint,
            "path": path,
            "api_key": api_key,
            "params": params,
            "body": body,
        }
    ).encode()
    if len(packet) > 16384:
        raise _error("AI_CATALOG_INVALID", "Catalog request exceeds the byte limit")
    with tempfile.TemporaryFile(mode="w+b") as output:
        try:
            process = subprocess.Popen(
                [sys.executable, "-m", "crate.ai.discovery"],
                stdin=subprocess.PIPE,
                stdout=output,
                stderr=subprocess.DEVNULL,
            )
        except OSError:
            raise _error(
                "AI_DISCOVERY_FAILED", "Provider catalog could not be read"
            ) from None
        try:
            try:
                resource.prlimit(
                    process.pid,
                    resource.RLIMIT_FSIZE,
                    (MAX_RESPONSE_BYTES + 1024, MAX_RESPONSE_BYTES + 1024),
                )
            except ProcessLookupError:
                pass
            remaining = min(timeout, deadline - time.monotonic())
            if remaining <= 0:
                raise subprocess.TimeoutExpired("discovery", timeout)
            process.communicate(input=packet, timeout=remaining)
            if process.returncode:
                raise _error(
                    "AI_DISCOVERY_FAILED", "Provider catalog could not be read"
                )
            output.seek(0)
            encoded = output.read(MAX_RESPONSE_BYTES + 1025)
            if len(encoded) > MAX_RESPONSE_BYTES + 1024:
                raise _error(
                    "AI_CATALOG_INVALID", "Provider catalog exceeds the byte limit"
                )
            result = json.loads(encoded)
            if not isinstance(result, dict):
                raise ValueError("Invalid worker response")
            if result.get("error") in {
                "AI_ENDPOINT_INVALID",
                "AI_DISCOVERY_TIMEOUT",
                "AI_CATALOG_INVALID",
                "AI_DISCOVERY_HTTP",
                "AI_DISCOVERY_FAILED",
            }:
                code = result["error"]
                raise _error(code, "Provider catalog could not be read")
            if not isinstance(result.get("result"), dict):
                raise ValueError("Invalid worker response")
            return result["result"]
        except AIConfigurationError:
            raise
        except subprocess.TimeoutExpired:
            raise _error(
                "AI_DISCOVERY_TIMEOUT", "Provider catalog request timed out"
            ) from None
        except (OSError, ValueError, RecursionError):
            raise _error(
                "AI_DISCOVERY_FAILED", "Provider catalog could not be read"
            ) from None
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()


def _entries(payload: dict, field: str) -> list[dict]:
    entries = payload.get(field, [])
    if not isinstance(entries, list):
        raise _error("AI_CATALOG_INVALID", "Provider catalog is malformed")
    bounded = entries[:MAX_MODELS]
    for entry in bounded:
        if (
            not isinstance(entry, dict)
            or len(json.dumps(entry).encode()) > MAX_ENTRY_BYTES
        ):
            raise _error(
                "AI_CATALOG_INVALID", "Provider catalog entry is malformed or oversized"
            )
    return bounded


def discover_models(
    provider: str, *, api_key: str | None, endpoint: str | None = None
) -> list[dict]:
    """Discover normalized capability JSON; never execute inference or use env keys."""
    endpoint = validate_endpoint(provider, endpoint)
    if api_key is not None and (
        not isinstance(api_key, str)
        or not 1 <= len(api_key) <= 4096
        or any(ord(char) < 33 or ord(char) > 126 for char in api_key)
    ):
        raise _error("AI_CREDENTIAL_INVALID", "Invalid provider credential")
    if provider in _BASES and not api_key:
        raise _error("AI_CREDENTIAL_REQUIRED", "Provider credential is required")
    deadline = time.monotonic() + DISCOVERY_SECONDS
    result: dict[str, dict] = {}
    scanned = 0

    def request(path, **kwargs):
        if time.monotonic() >= deadline:
            raise _error("AI_DISCOVERY_TIMEOUT", "Provider discovery timed out")
        return _request_json(
            provider, endpoint, path, api_key=api_key, deadline=deadline, **kwargs
        )

    if provider == "gemini":
        token = None
        for _page in range(MAX_PAGES):
            params: dict[str, Any] = {"pageSize": min(100, MAX_MODELS - scanned)}
            if token is not None:
                params["pageToken"] = token
            payload = request("/v1beta/models", params=params)
            for meta in _entries(payload, "models")[: MAX_MODELS - scanned]:
                scanned += 1
                name = meta.get("name")
                if not isinstance(name, str):
                    raise _error(
                        "AI_CATALOG_INVALID", "Provider model identifier is malformed"
                    )
                model_id = name.removeprefix("models/")
                result[model_id] = model_capabilities(
                    provider, model_id, meta
                ).model_dump(mode="json")
            token = payload.get("nextPageToken")
            if token is not None and (
                not isinstance(token, str) or not 1 <= len(token) <= 2048
            ):
                raise _error("AI_CATALOG_INVALID", "Provider page token is malformed")
            if not token or scanned >= MAX_MODELS:
                break
    elif provider == "deepseek":
        payload = request("/models")
        for meta in _entries(payload, "data"):
            model_id = meta.get("id")
            if not isinstance(model_id, str):
                raise _error(
                    "AI_CATALOG_INVALID", "Provider model identifier is malformed"
                )
            result[model_id] = model_capabilities(provider, model_id, meta).model_dump(
                mode="json"
            )
    else:
        payload = request("/api/tags")
        for index, meta in enumerate(_entries(payload, "models")):
            model_id = meta.get("name")
            if not isinstance(model_id, str):
                raise _error(
                    "AI_CATALOG_INVALID", "Provider model identifier is malformed"
                )
            # Validate ID before placing it into the show body.
            model = model_capabilities(provider, model_id)
            if index < MAX_OLLAMA_SHOW:
                details = request(
                    "/api/show", body={"model": model_id, "verbose": False}
                )
                model = model_capabilities(provider, model_id, details)
            result[model_id] = model.model_dump(mode="json")
    return list(result.values())


def _main() -> None:
    try:
        packet = json.loads(sys.stdin.buffer.read(16385))
        result = _http_json(**packet)
        sys.stdout.write(json.dumps({"result": result}))
    except AIConfigurationError as exc:
        sys.stdout.write(json.dumps({"error": exc.code}))
    except Exception:
        sys.stdout.write(json.dumps({"error": "AI_DISCOVERY_FAILED"}))


if __name__ == "__main__":
    _main()
