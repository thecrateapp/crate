"""Pinned, privately validated structured calls with single-owner admission."""

from __future__ import annotations

import hashlib
import json
import time
from copy import deepcopy
from typing import TypeVar
from uuid import uuid4

from pydantic import BaseModel

from crate.ai import configuration, transport
from crate.ai.actions import get_action
from crate.ai.contracts import AIConfigurationError, ProfileConfig
from crate.db.repositories import ai_usage as usage

T = TypeVar("T", bound=BaseModel)


def _hash(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def context_fingerprint(context: dict) -> str:
    """Hash routing/options and optional prompt/schema identities without raw keys.

    Before acceptance use configuration's config_fingerprint for CAS. Domain cache
    keys may add prompt_fingerprint/schema_fingerprint to a copy of that context.
    Runtime adds both hashes to the admitted invocation identity automatically.
    """
    return _hash(context)


def action_availability(action_id: str) -> dict:
    """Read-only domain status; no materialization, provider call or credential data."""
    get_action(action_id)
    try:
        context = configuration.get_action_configuration(action_id)
        legacy = context["mode"] == "legacy"
        available = not context.get("legacy_compatibility_error")
        if legacy and context["provider"] != "ollama":
            from crate.llm.provider import get_provider_api_key

            available = available and bool(get_provider_api_key(context["provider"]))
        return {
            "action_id": action_id,
            "available": available,
            "status": "legacy" if legacy else "configured",
            "provider": context["provider"],
            "model_id": context["model_id"],
            "fingerprint": context["config_fingerprint"],
            "error_code": None
            if available
            else context.get("legacy_compatibility_error") or "AI_CREDENTIAL_REQUIRED",
        }
    except AIConfigurationError as error:
        return {
            "action_id": action_id,
            "available": False,
            "status": "unavailable",
            "provider": None,
            "model_id": None,
            "fingerprint": None,
            "error_code": error.code,
        }


def _parse(text):
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
    return json.loads(cleaned.strip())


def execute_probe(context, *, api_key, prompt, response_schema):
    """One exact-profile synthetic call. Operations owns its reservation/finish."""
    config = ProfileConfig.model_validate(context["config"])
    if (
        len((prompt + json.dumps(response_schema)).encode()) + 1024
        > config.max_input_tokens
    ):
        raise AIConfigurationError(
            "AI_INPUT_TOO_LARGE", "Synthetic input exceeds the profile allowance"
        )
    result = transport.generate(
        deepcopy(context),
        api_key=api_key,
        prompt=prompt,
        response_schema=response_schema,
    )
    try:
        data = _parse(result.text)
        compatible = (
            isinstance(data, dict) and set(data) == {"ok"} and data["ok"] is True
        )
    except (ValueError, TypeError):
        compatible = False
    return {
        "compatible": compatible,
        "usage": result.usage,
        "reported_model": result.reported_model,
    }


def execute_structured(
    action_id: str,
    response_model: type[T],
    prompt: str,
    *,
    system: str = "",
    image: bytes | None = None,
    media_type: str | None = None,
    expected_fingerprint: str | None = None,
    context: dict | None = None,
    actor_id: int | None = None,
    job_id: str | None = None,
    idempotency_key: str | None = None,
) -> T:
    """Admit once, execute the accepted immutable context, validate privately.

    Queue callers must resolve and persist context at acceptance, then pass that
    server-owned context plus stable job/idempotency identity at execution. No raw
    result is saved in activity; repeat claims fail instead of paying twice.
    """
    action = get_action(action_id)
    pinned = deepcopy(
        context
        if context is not None
        else configuration.resolve_action(action_id, expected_fingerprint)
    )
    if (
        pinned.get("action_id") != action_id
        or pinned.get("invocation_kind") != "action"
    ):
        raise AIConfigurationError("AI_CONTEXT_STALE", "Action context does not match")
    if expected_fingerprint is not None and expected_fingerprint != pinned.get(
        "config_fingerprint"
    ):
        raise AIConfigurationError(
            "AI_CONTEXT_STALE", "Configuration changed before execution"
        )
    legacy = (
        pinned["mode"] == "legacy"
        or pinned.get("config", {}).get("kind") == "legacy_snapshot"
    )
    schema = response_model.model_json_schema()
    if legacy:
        bounds = pinned.get("reservation_bounds") or {}
        if pinned["mode"] != "legacy" and not bounds:
            raise AIConfigurationError(
                "AI_LEGACY_LIMITS_UNKNOWN", "Inherited limits are unknown"
            )
        input_tokens, output_tokens = (
            bounds.get("input_tokens", 0),
            bounds.get("output_tokens", 0),
        )
    else:
        config = ProfileConfig.model_validate(pinned["config"])
        if (
            config.timeout_seconds > action.maxima.timeout_seconds
            or config.max_output_tokens > action.maxima.max_output_tokens
        ):
            raise AIConfigurationError(
                "AI_PROFILE_INCOMPATIBLE", "Profile exceeds action bounds"
            )
        input_tokens, output_tokens = config.max_input_tokens, config.max_output_tokens
        estimated_input = len((prompt + system + json.dumps(schema)).encode()) + 1024
        if action.input == "image":
            from io import BytesIO
            from PIL import Image

            try:
                with Image.open(BytesIO(image or b"")) as source:
                    pixels = source.width * source.height
                    if pixels > (action.maxima.max_image_pixels or 20000000):
                        raise ValueError("Image is too large")
            except Exception:
                raise AIConfigurationError(
                    "AI_INPUT_TOO_LARGE",
                    "Image is invalid or exceeds the action pixel limit",
                ) from None
            bound = pinned.get("image_token_bound")
            if bound is None:
                native_context = pinned.get("native_context_window")
                if native_context is None or native_context > input_tokens:
                    raise AIConfigurationError(
                        "AI_IMAGE_BOUND_UNKNOWN",
                        "Image token bounds are unavailable for this profile",
                    )
                estimated_input = native_context
            else:
                estimated_input += bound
        elif image is not None:
            raise AIConfigurationError(
                "AI_PROFILE_INCOMPATIBLE", "Action does not accept an image"
            )
        if estimated_input > input_tokens:
            raise AIConfigurationError(
                "AI_INPUT_TOO_LARGE", "Input exceeds the profile token allowance"
            )
    configuration.revalidate_context(pinned)
    api_key = configuration.load_context_key(pinned)
    admitted = deepcopy(pinned)
    admitted["prompt_fingerprint"] = _hash(
        [
            system,
            prompt,
            hashlib.sha256(image).hexdigest() if image else None,
            media_type,
        ]
    )
    admitted["schema_fingerprint"] = _hash(schema)
    admitted["config_fingerprint"] = context_fingerprint(admitted)
    key = idempotency_key or (f"job:{job_id}:{action_id}" if job_id else str(uuid4()))
    invocation = usage.reserve_invocation(
        admitted,
        idempotency_key=f"action:{actor_id}:{key}",
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        actor_id=actor_id,
        job_id=job_id,
    )
    if not invocation["claimed"]:
        raise AIConfigurationError(
            "AI_EXECUTION_ALREADY_ACCEPTED", "Execution was already accepted"
        )
    started = time.monotonic()
    status, code, result = "failed", "AI_PROVIDER_FAILED", None
    try:
        # Close the acceptance-to-network race; the loaded key remains pinned in memory.
        configuration.revalidate_context(pinned)
        call = transport.generate_legacy if legacy else transport.generate
        result = call(
            pinned,
            api_key=api_key,
            prompt=prompt,
            system=system,
            response_schema=schema,
            image=image,
            media_type=media_type,
        )
        try:
            data = _parse(result.text)
            try:
                value = response_model.model_validate(data)
            except Exception:
                if (
                    not legacy
                    or image is not None
                    or not isinstance(data, dict)
                    or not isinstance(data.get("properties"), dict)
                ):
                    raise
                flat = {}
                for key, item in data["properties"].items():
                    if isinstance(item, (list, str, int, float, bool)):
                        flat[key] = item
                    elif isinstance(item, dict) and len(item) == 1:
                        flat[key] = next(iter(item.values()))
                value = response_model.model_validate(flat)
        except Exception:
            raise AIConfigurationError(
                "AI_RESPONSE_INVALID", "Provider returned invalid structured data"
            ) from None
        # Domain services can stamp the actual model without rereading global config.
        object.__setattr__(
            value, "_ai_model_id", result.reported_model or pinned["model_id"]
        )
        status, code = "succeeded", None
        return value
    except AIConfigurationError as error:
        code = error.code
        status = "timeout" if code == "AI_PROVIDER_TIMEOUT" else "failed"
        raise
    except Exception:
        raise AIConfigurationError(
            "AI_PROVIDER_FAILED", "Provider request could not be completed"
        ) from None
    finally:
        usage.finish_invocation(
            invocation["id"],
            result.usage if result else None,
            status,
            error_code=code,
            duration_ms=int((time.monotonic() - started) * 1000),
            reported_model=result.reported_model if result else None,
        )
