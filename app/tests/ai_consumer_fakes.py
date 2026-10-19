"""Provider-free pinned configuration for domain tests that mock generation."""

from crate.ai import configuration, runtime
from crate.ai.contracts import AIConfigurationError


def pin_actions(
    monkeypatch, *, model="test/model", provider="test", status="configured"
):
    contexts = {}

    def resolve(action_id, expected_fingerprint=None):
        context = contexts.setdefault(
            action_id,
            {
                "action_id": action_id,
                "model_id": model,
                "provider": provider,
                "config_fingerprint": "accepted:" + action_id,
                "legacy_options": {
                    "timeout_seconds": 90
                    if action_id == "shows.extract.vision"
                    else 45,
                    "max_tokens": 16000,
                },
            },
        )
        if (
            expected_fingerprint
            and expected_fingerprint != context["config_fingerprint"]
        ):
            raise AIConfigurationError("AI_CONTEXT_STALE", "Configuration changed")
        return dict(context)

    def revalidate(context):
        if context != resolve(context["action_id"]):
            raise AIConfigurationError("AI_CONTEXT_STALE", "Configuration changed")

    def available(action_id):
        context = resolve(action_id)
        return {
            "action_id": action_id,
            "available": True,
            "status": status,
            "model_id": context["model_id"],
            "provider": provider,
            "fingerprint": context["config_fingerprint"],
            "error_code": None,
        }

    monkeypatch.setattr(configuration, "resolve_action", resolve)
    monkeypatch.setattr(configuration, "revalidate_context", revalidate)
    monkeypatch.setattr(runtime, "action_availability", available)
    return contexts
