"""Bounded, non-inference model discovery with explicit credentials.

Ollama is an explicitly configured administrator destination: private and loopback
addresses are allowed, but metadata/link-local addresses are not. DNS is resolved
once per request; the socket connects to the checked IP while Host and TLS SNI
retain the configured hostname. Proxies, redirects and transport retries are off.
A killed/reaped subprocess bounds DNS, connect, headers, body and parsing together.

An openai_compatible connection uses its template's fixed origin and path prefix,
or a confirmed custom origin that is pinned like Ollama's and must resolve only to
private addresses when it uses plain HTTP. Its catalog is the admin's manifest:
/models only confirms which declared IDs the provider still lists.
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

from crate.ai.capabilities import manifest_capabilities, model_capabilities
from crate.ai.contracts import (
    OPENAI_COMPATIBLE_PATH_PREFIXES,
    OPENAI_COMPATIBLE_TEMPLATES,
    AIConfigurationError,
)

MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_ENTRY_BYTES = 64 * 1024
MAX_MODELS = 500
MAX_PAGES = 10
MAX_OLLAMA_SHOW = 100
# /models of an OpenAI-compatible router lists every routed model; only IDs are read.
MAX_LISTED_MODELS = 5000
REQUEST_SECONDS = 5.0
DISCOVERY_SECONDS = 30.0
_BASES = {
    "gemini": "https://generativelanguage.googleapis.com",
    "deepseek": "https://api.deepseek.com",
}
# Cloud metadata services outside the link-local ranges: Alibaba, Oracle and
# the AWS IPv6 endpoint (a unique local address, so `is_private` admits it).
_METADATA_ADDRESSES = {"100.100.100.200", "192.0.0.192", "fd00:ec2::254"}
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
        or str(address) in _METADATA_ADDRESSES
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


def pin_origin(origin: str, *, private_only: bool = False) -> tuple[str, str, str]:
    """Resolve an admin-chosen origin once and connect to a checked address.

    Every DNS answer must pass `_check_address` (and be private when
    `private_only`); the request then goes to the first one, so a later lookup
    cannot move it. Returns the address-based base URL, the Host header and the
    TLS server name, both kept as configured.
    """
    parsed = urlsplit(origin)
    hostname = parsed.hostname or ""
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    answers = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    addresses = list(
        dict.fromkeys(_check_address(str(answer[4][0])) for answer in answers)
    )
    if not addresses:
        raise _error("AI_ENDPOINT_INVALID", "Endpoint has no permitted address")
    if private_only and not all(_is_private(address) for address in addresses):
        raise _error("AI_ENDPOINT_INVALID", "A public origin requires HTTPS")
    address = addresses[0]
    host = f"[{address}]" if ":" in address else address
    base = urlunsplit((parsed.scheme, f"{host}:{port}", "", "", ""))
    return base, parsed.netloc, hostname


def _is_private(raw: str) -> bool:
    address = ipaddress.ip_address(raw)
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return address.is_private or address.is_loopback


def validate_openai_compatible(
    template: str | None, endpoint: str | None, path_prefix: str | None
) -> tuple[str, str]:
    """Return the (origin, path prefix) an openai_compatible connection may use.

    A predefined template fixes both; restating them is accepted, anything else
    is not. A custom origin follows the Ollama address rules (no credentials,
    query, fragment or path; metadata and link-local addresses blocked), uses
    one of the predefined prefixes, and needs HTTPS unless its address is
    private. A host name is resolved and checked again at request time.
    """
    spec = OPENAI_COMPATIBLE_TEMPLATES.get(template) if template else None
    if spec is None:
        raise _error("AI_ENDPOINT_INVALID", "Unknown origin template")
    if spec.origin is not None and spec.path_prefix is not None:
        if (
            endpoint is not None
            and (not isinstance(endpoint, str) or endpoint.rstrip("/") != spec.origin)
        ) or (path_prefix is not None and path_prefix != spec.path_prefix):
            raise _error("AI_ENDPOINT_INVALID", "This template's origin is fixed")
        return spec.origin, spec.path_prefix
    if path_prefix not in OPENAI_COMPATIBLE_PATH_PREFIXES:
        raise _error("AI_ENDPOINT_INVALID", "Unsupported path prefix")
    if endpoint is None:
        raise _error("AI_ENDPOINT_INVALID", "A custom origin is required")
    origin = validate_endpoint("ollama", endpoint)
    assert origin is not None
    if origin.startswith("http://"):
        hostname = urlsplit(origin).hostname or ""
        try:
            private = _is_private(hostname)
        except ValueError:
            private = True  # A name: its resolved addresses are checked per request.
        if not private:
            raise _error("AI_ENDPOINT_INVALID", "A public origin requires HTTPS")
    return origin, path_prefix


def request_target(
    provider: str,
    endpoint: str | None,
    path: str,
    *,
    template: str | None = None,
    path_prefix: str | None = None,
) -> tuple[str, str, bool, bool]:
    """Validate a destination: (origin, path, pin it, private addresses only).

    Only openai_compatible has a template and a path prefix; every other
    provider rejects them, so its requests keep their fixed native paths.
    """
    if provider != "openai_compatible":
        if template is not None or path_prefix is not None:
            raise _error(
                "AI_ENDPOINT_INVALID", "Only OpenAI-compatible origins have a prefix"
            )
        endpoint = validate_endpoint(provider, endpoint)
        base = endpoint or _BASES[provider]
        return base, path, provider == "ollama", False
    origin, prefix = validate_openai_compatible(template, endpoint, path_prefix)
    custom = OPENAI_COMPATIBLE_TEMPLATES[template or ""].origin is None
    return origin, prefix + path, custom, custom and origin.startswith("http://")


def _http_json(
    provider: str,
    endpoint: str | None,
    path: str,
    *,
    api_key: str | None,
    params: dict | None = None,
    body: dict | None = None,
    template: str | None = None,
    path_prefix: str | None = None,
) -> dict:
    """One request inside the deadline subprocess (also exercised with fake HTTP)."""
    base, path, pinned, private_only = request_target(
        provider, endpoint, path, template=template, path_prefix=path_prefix
    )
    headers = {"Accept": "application/json"}
    if provider == "gemini":
        headers["x-goog-api-key"] = api_key or ""
    elif provider == "deepseek" or api_key:
        headers["Authorization"] = f"Bearer {api_key or ''}"
    extensions: dict[str, Any] = {}
    if pinned:
        base, headers["Host"], extensions["sni_hostname"] = pin_origin(
            base, private_only=private_only
        )
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
    template: str | None = None,
    path_prefix: str | None = None,
) -> dict:
    started = time.monotonic()
    request_deadline = min(deadline, started + REQUEST_SECONDS)
    if request_deadline <= started:
        raise _error("AI_DISCOVERY_TIMEOUT", "Provider discovery timed out")
    packet = json.dumps(
        {
            "provider": provider,
            "endpoint": endpoint,
            "path": path,
            "api_key": api_key,
            "params": params,
            "body": body,
            "template": template,
            "path_prefix": path_prefix,
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
            remaining = request_deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired("discovery", REQUEST_SECONDS)
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
    entries = payload.get(field)
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


def _listed_ids(payload: dict) -> set[str]:
    entries = payload.get("data")
    if not isinstance(entries, list) or len(entries) > MAX_LISTED_MODELS:
        raise _error("AI_CATALOG_INVALID", "Provider catalog is malformed")
    if any(
        not isinstance(entry, dict) or not isinstance(entry.get("id"), str)
        for entry in entries
    ):
        raise _error("AI_CATALOG_INVALID", "Provider model identifier is malformed")
    return {entry["id"] for entry in entries}


def discover_models(
    provider: str,
    *,
    api_key: str | None,
    endpoint: str | None = None,
    template: str | None = None,
    path_prefix: str | None = None,
    manifest: list[dict] | None = None,
) -> list[dict]:
    """Discover normalized capability JSON; never execute inference or use env keys."""
    from crate.ai.guard import require_ai_task

    require_ai_task("discover_models")
    if provider == "openai_compatible":
        endpoint, path_prefix = validate_openai_compatible(
            template, endpoint, path_prefix
        )
        if not manifest:
            raise _error("AI_CATALOG_INVALID", "Declare the provider's models")
    elif template is not None or path_prefix is not None or manifest is not None:
        raise _error(
            "AI_ENDPOINT_INVALID", "Only OpenAI-compatible origins have a manifest"
        )
    else:
        endpoint = validate_endpoint(provider, endpoint)
    if api_key is not None and (
        not isinstance(api_key, str)
        or not 1 <= len(api_key) <= 4096
        or any(ord(char) < 33 or ord(char) > 126 for char in api_key)
    ):
        raise _error("AI_CREDENTIAL_INVALID", "Invalid provider credential")
    if not api_key and (
        provider in _BASES
        or (
            provider == "openai_compatible"
            and OPENAI_COMPATIBLE_TEMPLATES[template or ""].requires_key
        )
    ):
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

    if provider == "openai_compatible":
        assert manifest is not None
        listed = _listed_ids(
            request("/models", template=template, path_prefix=path_prefix)
        )
        return [
            manifest_capabilities(entry, listed=entry["model_id"] in listed).model_dump(
                mode="json"
            )
            for entry in manifest
        ]
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
