"""Runtime owns admission, pins context and never replays provider calls."""

from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor

import pytest
from pydantic import BaseModel

from crate.ai import runtime
from crate.ai.contracts import AIConfigurationError, ProfileConfig
from crate.ai.transport import NativeResponse


class Answer(BaseModel):
    ok: bool


def context(action="genres.eq.propose", model="model-one", key="key-one"):
    return {
        "mode": "configured",
        "invocation_kind": "action",
        "action_id": action,
        "connection_id": key,
        "model_id": model,
        "provider": "gemini",
        "endpoint": None,
        "config": ProfileConfig().model_dump(mode="json"),
        "config_fingerprint": "f" * 64,
    }


@pytest.fixture
def admitted(monkeypatch):
    finished = []
    monkeypatch.setattr(runtime.configuration, "revalidate_context", lambda ctx: None)
    monkeypatch.setattr(
        runtime.configuration, "load_context_key", lambda ctx: ctx["connection_id"]
    )
    monkeypatch.setattr(
        runtime.usage,
        "reserve_invocation",
        lambda *args, **kwargs: {"id": "invocation", "claimed": True},
    )
    monkeypatch.setattr(
        runtime.usage,
        "finish_invocation",
        lambda *args, **kwargs: finished.append((args, kwargs)),
    )
    return finished


def test_distinct_concurrent_contexts_are_pinned(monkeypatch, admitted):
    captured = []

    def generate(ctx, **kwargs):
        captured.append((ctx["model_id"], kwargs["api_key"]))
        return NativeResponse(
            '{"ok":true}', {"input_tokens": 5, "output_tokens": 4}, ctx["model_id"], 1
        )

    monkeypatch.setattr(runtime.transport, "generate", generate)
    contexts = [
        context(),
        context("playlists.description.generate", "model-two", "key-two"),
    ]
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(
                lambda ctx: runtime.execute_structured(
                    ctx["action_id"], Answer, "prompt", context=ctx
                ),
                contexts,
            )
        )
    assert all(result.ok for result in results)
    assert sorted(captured) == [("model-one", "key-one"), ("model-two", "key-two")]
    assert len(admitted) == 2


@pytest.mark.parametrize(
    "code", ["AI_DAILY_TOKEN_LIMIT", "AI_EXECUTION_ALREADY_ACCEPTED"]
)
def test_admission_prevents_provider_call(monkeypatch, admitted, code):
    def reserve(*args, **kwargs):
        if code == "AI_EXECUTION_ALREADY_ACCEPTED":
            return {"id": "old", "claimed": False}
        raise AIConfigurationError(code, "Quota exceeded")

    monkeypatch.setattr(runtime.usage, "reserve_invocation", reserve)
    monkeypatch.setattr(
        runtime.transport, "generate", lambda *args, **kwargs: pytest.fail("provider")
    )
    with pytest.raises(AIConfigurationError) as error:
        runtime.execute_structured(
            "genres.eq.propose", Answer, "prompt", context=context()
        )
    assert error.value.code == code
    assert admitted == []


def test_stale_before_call_and_inflight_context_not_reread(monkeypatch, admitted):
    original = context()

    def stale(ctx):
        raise AIConfigurationError("AI_CONTEXT_STALE", "Changed")

    monkeypatch.setattr(runtime.configuration, "load_context_key", stale)
    monkeypatch.setattr(
        runtime.transport, "generate", lambda *args, **kwargs: pytest.fail("provider")
    )
    with pytest.raises(AIConfigurationError):
        runtime.execute_structured(
            "genres.eq.propose", Answer, "prompt", context=original
        )
    monkeypatch.setattr(
        runtime.configuration, "load_context_key", lambda ctx: "key-one"
    )

    def generate(ctx, **kwargs):
        original["model_id"] = "changed"
        assert ctx["model_id"] == "model-one"
        monkeypatch.setattr(runtime.configuration, "revalidate_context", stale)
        return NativeResponse('{"ok":true}', None, "actual", 1)

    monkeypatch.setattr(runtime.transport, "generate", generate)
    assert runtime.execute_structured(
        "genres.eq.propose", Answer, "prompt", context=original
    ).ok


def test_invalid_response_is_private_and_finalizes_unknown(
    monkeypatch, admitted, caplog
):
    monkeypatch.setattr(
        runtime.transport,
        "generate",
        lambda *args, **kwargs: NativeResponse(
            "private-source secret-key", None, None, 2
        ),
    )
    with pytest.raises(AIConfigurationError) as error:
        runtime.execute_structured(
            "genres.eq.propose", Answer, "prompt", context=context()
        )
    assert error.value.code == "AI_RESPONSE_INVALID"
    assert "private-source" not in str(error.value) + caplog.text
    assert admitted[-1][0][2] == "failed"


def test_probe_exact_profile_one_call_without_admission(monkeypatch):
    calls = []
    monkeypatch.setattr(
        runtime.usage,
        "reserve_invocation",
        lambda *args, **kwargs: pytest.fail("double reserve"),
    )
    ctx = context()
    ctx["config"]["max_output_tokens"] = 7000

    def generate(c, **kwargs):
        calls.append((deepcopy(c), kwargs))
        return NativeResponse(
            '{"ok":true}', {"input_tokens": 3, "output_tokens": 4}, "actual", 2
        )

    monkeypatch.setattr(runtime.transport, "generate", generate)
    result = runtime.execute_probe(
        ctx, api_key="key", prompt="synthetic", response_schema={"type": "object"}
    )
    assert result == {
        "compatible": True,
        "usage": {"input_tokens": 3, "output_tokens": 4},
        "reported_model": "actual",
    }
    assert len(calls) == 1 and calls[0][0]["config"]["max_output_tokens"] == 7000


def test_disabled_availability_never_falls_back(monkeypatch):
    def disabled(*args, **kwargs):
        raise AIConfigurationError("AI_ACTION_DISABLED", "Disabled")

    monkeypatch.setattr(runtime.configuration, "get_action_configuration", disabled)
    result = runtime.action_availability("genres.eq.propose")
    assert result["available"] is False and result["error_code"] == "AI_ACTION_DISABLED"


def test_context_fingerprint_includes_prompt_schema_options():
    first = context()
    variants = [deepcopy(first) for _ in range(3)]
    variants[0]["prompt_fingerprint"] = "prompt-v2"
    variants[1]["schema_fingerprint"] = "schema-v2"
    variants[2]["config"]["max_output_tokens"] = 2000
    assert all(
        runtime.context_fingerprint(value) != runtime.context_fingerprint(first)
        for value in variants
    )


def test_vision_admission_uses_pixel_limits_and_manifest_not_compressed_bytes(
    monkeypatch, admitted
):
    from io import BytesIO
    from PIL import Image

    calls = []

    def generate(ctx, **kwargs):
        calls.append(kwargs)
        return NativeResponse('{"ok":true}', None, "actual", 1)

    monkeypatch.setattr(runtime.transport, "generate", generate)
    ctx = context("shows.extract.vision", "gemini-3.8-flash")
    ctx["config"]["image_detail"] = "ultra_high"
    ctx["image_token_bound"] = 4096
    output = BytesIO()
    Image.new("RGB", (4000, 5000)).save(output, format="PNG")
    poster = output.getvalue()
    assert runtime.execute_structured(
        ctx["action_id"],
        Answer,
        "poster",
        context=ctx,
        image=poster,
        media_type="image/png",
    ).ok
    assert len(calls) == 1
    ctx["config"]["max_input_tokens"] = 4096
    with pytest.raises(AIConfigurationError) as error:
        runtime.execute_structured(
            ctx["action_id"],
            Answer,
            "poster",
            context=ctx,
            image=poster,
            media_type="image/png",
        )
    assert error.value.code == "AI_INPUT_TOO_LARGE"
    ctx["config"]["max_input_tokens"] = 16384
    ctx["image_token_bound"] = None
    with pytest.raises(AIConfigurationError) as error:
        runtime.execute_structured(
            ctx["action_id"],
            Answer,
            "poster",
            context=ctx,
            image=poster,
            media_type="image/png",
        )
    assert error.value.code == "AI_IMAGE_BOUND_UNKNOWN"
    output = BytesIO()
    Image.new("RGB", (4001, 5000)).save(output, format="PNG")
    with pytest.raises(AIConfigurationError) as error:
        runtime.execute_structured(
            ctx["action_id"],
            Answer,
            "poster",
            context=ctx,
            image=output.getvalue(),
            media_type="image/png",
        )
    assert error.value.code == "AI_INPUT_TOO_LARGE"
    assert len(calls) == 1


def test_real_admission_probe_and_action_charge_and_replay(pg_db, monkeypatch):
    from sqlalchemy import text
    from crate.ai import operations
    from crate.ai.capabilities import model_capabilities
    from crate.db.repositories import ai_configuration as store
    from crate.db.tx import transaction_scope

    monkeypatch.setenv("GEMINI_API_KEY", "synthetic-key")
    conn = runtime.configuration.ensure_environment_connection("gemini")
    store.save_model_catalog(
        conn["id"],
        [model_capabilities("gemini", "gemini-2.5-flash").model_dump(mode="json")],
        "ready",
        1,
    )
    profile = runtime.configuration.create_profile(
        {
            "label": "Bounded",
            "connection_id": conn["id"],
            "model_id": "gemini-2.5-flash",
            "config": {},
        },
        None,
    )
    runtime.configuration.apply_bindings(
        [
            {
                "action_id": "genres.eq.propose",
                "profile_id": profile["id"],
                "profile_version": 1,
                "enabled": True,
                "expected_revision": 0,
            }
        ],
        None,
    )
    with transaction_scope() as session:
        session.execute(text("UPDATE ai_configuration_state SET active=TRUE"))
    calls = []

    def generate(ctx, **kwargs):
        calls.append((ctx, kwargs))
        return NativeResponse(
            '{"ok":true}',
            {
                "input_tokens": 20,
                "output_tokens": 4,
                "thought_tokens": 8,
                "cached_input_tokens": 5,
                "total_tokens": 32,
            },
            "actual-model",
            1,
        )

    monkeypatch.setattr(runtime.transport, "generate", generate)
    ctx = runtime.configuration.resolve_action("genres.eq.propose")
    answer = runtime.execute_structured(
        "genres.eq.propose", Answer, "synthetic", context=ctx, idempotency_key="once"
    )
    assert answer.ok and answer._ai_model_id == "actual-model"
    assert answer.model_dump() == {"ok": True}
    with pytest.raises(AIConfigurationError) as error:
        runtime.execute_structured(
            "genres.eq.propose",
            Answer,
            "synthetic",
            context=ctx,
            idempotency_key="once",
        )
    assert error.value.code == "AI_EXECUTION_ALREADY_ACCEPTED" and len(calls) == 1
    row = runtime.usage.list_invocations({})["items"][0]
    assert row["charged_tokens"] == 32 and row["usage_known"]
    assert "synthetic" not in str(row) and "actual-model" == row["reported_model"]
    probe = runtime.configuration.resolve_profile(profile["id"], 1)
    assert operations.run_probe(
        probe, actor_id=None, job_id="probe", idempotency_key="test"
    )["compatible"]
    assert operations.run_probe(
        probe, actor_id=None, job_id="probe", idempotency_key="test"
    ) == {"status": "duplicate"}
    assert len(calls) == 2
    assert runtime.usage.usage_summary()["totals"]["tokens"] == 64
    with transaction_scope() as session:
        session.execute(text("UPDATE ai_provider_connections SET daily_tokens=64"))
    with pytest.raises(AIConfigurationError) as error:
        runtime.execute_structured(
            "genres.eq.propose",
            Answer,
            "synthetic",
            context=ctx,
            idempotency_key="quota",
        )
    assert error.value.code == "AI_DAILY_TOKEN_LIMIT" and len(calls) == 2


def test_legacy_schema_echo_flattening_remains_compatible(monkeypatch, admitted):
    ctx = context()
    ctx["mode"] = "legacy"
    monkeypatch.setattr(
        runtime.transport,
        "generate_legacy",
        lambda *args, **kwargs: NativeResponse(
            '{"properties":{"ok":{"value":true}}}', None, None, 1
        ),
    )
    assert runtime.execute_structured(
        "genres.eq.propose", Answer, "prompt", context=ctx
    ).ok


def test_probe_input_budget_rejects_before_provider(monkeypatch):
    ctx = context()
    ctx["config"]["max_input_tokens"] = 1
    monkeypatch.setattr(
        runtime.transport, "generate", lambda *args, **kwargs: pytest.fail("provider")
    )
    with pytest.raises(AIConfigurationError) as error:
        runtime.execute_probe(
            ctx, api_key="key", prompt="synthetic", response_schema={}
        )
    assert error.value.code == "AI_INPUT_TOO_LARGE"


def test_key_revoked_between_revalidation_and_load_has_closed_error(monkeypatch):
    from crate.credentials import CredentialSecretError

    monkeypatch.setattr(runtime.configuration, "revalidate_context", lambda ctx: None)

    def revoked(*args, **kwargs):
        raise CredentialSecretError("private-key-storage-details")

    monkeypatch.setattr(runtime.configuration, "load_secret", revoked)
    with pytest.raises(AIConfigurationError) as error:
        runtime.configuration.load_context_key(
            {"credential_source": "stored", "credential_ref": "private"}
        )
    assert error.value.code == "AI_CREDENTIAL_UNAVAILABLE"
    assert "private" not in str(error.value)
