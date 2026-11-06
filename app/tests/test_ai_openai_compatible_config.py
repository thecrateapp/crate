"""openai_compatible connections: fixed template origins, confirmed custom
origins, a validated model manifest and encrypted keys (SM3-D7)."""

import json

import pytest
from cryptography.fernet import Fernet
from pydantic import ValidationError
from sqlalchemy import text

from crate.ai import configuration
from crate.ai.contracts import (
    OPENAI_COMPATIBLE_PATH_PREFIXES,
    OPENAI_COMPATIBLE_TEMPLATES,
    AIConfigurationError,
    ModelManifestEntry,
)
from crate.credentials import load_secret
from crate.db.repositories import ai_configuration as store
from crate.db.schema_sections.ai_openai_compatible_v153 import (
    V153_PATH_PREFIXES,
    V153_TEMPLATE_ORIGINS,
    V153_TEMPLATES,
)
from crate.db.tx import read_scope

KIMI = {
    "model_id": "kimi-k3.1-pro",
    "context_window": 262144,
    "max_output_tokens": 32768,
    "structured_output": "json_object",
    "reasoning": "reasoning_effort",
    "reasoning_levels": ["low", "high", "max"],
}
QWEN = {
    "model_id": "qwen3.6-plus",
    "context_window": 131072,
    "max_output_tokens": 16384,
    "structured_output": "json_schema",
    "reasoning": "enable_thinking",
}
ROUTED = {
    "model_id": "moonshotai/kimi-k3.1-pro",
    "context_window": 262144,
    "max_output_tokens": 32768,
    "structured_output": "json_schema",
    "reasoning": "reasoning",
    "reasoning_levels": ["low", "medium", "high"],
}
LOCAL = {
    "model_id": "Qwen/Qwen3.8-27B",
    "context_window": 32768,
    "max_output_tokens": 8192,
    "structured_output": "json_schema",
}
MANIFESTS = {
    "moonshot": [KIMI],
    "dashscope_intl": [QWEN],
    "openrouter": [ROUTED],
    "custom": [LOCAL],
}
TEMPLATE_ORIGINS = {
    "moonshot": ("https://api.moonshot.ai", "/v1"),
    "dashscope_intl": ("https://dashscope-intl.aliyuncs.com", "/compatible-mode/v1"),
    "openrouter": ("https://openrouter.ai", "/api/v1"),
}
CUSTOM = {
    "template": "custom",
    "endpoint": "https://llm.example.test",
    "path_prefix": "/v1",
    "model_manifest": [LOCAL],
}


def create(**overrides):
    return configuration.create_connection(
        {
            "label": "Kimi",
            "provider": "openai_compatible",
            "template": "moonshot",
            "model_manifest": [KIMI],
            **overrides,
        },
        None,
    )


def patch(row, **changes):
    return configuration.patch_connection(row["id"], changes, row["revision"], None)


def code(call, *args, **kwargs):
    with pytest.raises(AIConfigurationError) as error:
        call(*args, **kwargs)
    return error.value.code


@pytest.mark.parametrize("template", sorted(TEMPLATE_ORIGINS))
def test_template_origins_fixed(pg_db, template):
    origin, prefix = TEMPLATE_ORIGINS[template]
    assert (
        OPENAI_COMPATIBLE_TEMPLATES[template].origin,
        OPENAI_COMPATIBLE_TEMPLATES[template].path_prefix,
    ) == (origin, prefix)
    # The database pins the same origins (migration 153).
    assert V153_TEMPLATE_ORIGINS == TEMPLATE_ORIGINS
    assert set(V153_TEMPLATES) == set(OPENAI_COMPATIBLE_TEMPLATES)
    assert V153_PATH_PREFIXES == OPENAI_COMPATIBLE_PATH_PREFIXES
    manifest = MANIFESTS[template]

    row = create(template=template, model_manifest=manifest)
    assert (row["template"], row["endpoint"], row["path_prefix"]) == (
        template,
        origin,
        prefix,
    )
    # Restating the template's own origin is accepted and needs no confirmation.
    same = create(
        template=template,
        endpoint=origin + "/",
        path_prefix=prefix,
        model_manifest=manifest,
    )
    assert (same["endpoint"], same["path_prefix"]) == (origin, prefix)

    other_prefix = next(p for _, p in TEMPLATE_ORIGINS.values() if p != prefix)
    for endpoint, path_prefix in (
        ("https://evil.example.test", None),
        (origin.replace("https://", "http://"), None),
        (origin + ":8443", None),
        (origin, other_prefix),
    ):
        assert (
            code(
                create,
                template=template,
                endpoint=endpoint,
                path_prefix=path_prefix,
                model_manifest=manifest,
                confirm_custom_origin=True,
            )
            == "AI_ENDPOINT_INVALID"
        )
    # A predefined template keeps its origin and prefix after creation too.
    assert (
        code(
            patch, row, endpoint="https://evil.example.test", confirm_custom_origin=True
        )
        == "AI_ENDPOINT_INVALID"
    )
    assert code(patch, row, path_prefix=other_prefix) == "AI_ENDPOINT_INVALID"
    with pytest.raises(ValidationError):
        patch(row, template="custom")
    stored = store.get_connection(row["id"])
    assert (stored["endpoint"], stored["path_prefix"]) == (origin, prefix)


def test_custom_origin_requires_confirmation(pg_db):
    assert code(create, **CUSTOM) == "AI_ORIGIN_UNCONFIRMED"
    assert (
        code(create, **CUSTOM, confirm_custom_origin=False) == "AI_ORIGIN_UNCONFIRMED"
    )
    row = create(**CUSTOM, confirm_custom_origin=True)
    assert (row["template"], row["endpoint"], row["path_prefix"]) == (
        "custom",
        "https://llm.example.test",
        "/v1",
    )
    # A private origin may use plain HTTP; any other origin needs HTTPS.
    private = create(
        **{**CUSTOM, "endpoint": "http://10.0.0.5:8000/"}, confirm_custom_origin=True
    )
    assert private["endpoint"] == "http://10.0.0.5:8000"

    # Moving a custom origin asks again; other changes do not.
    assert (
        code(patch, row, endpoint="https://other.example.test")
        == "AI_ORIGIN_UNCONFIRMED"
    )
    moved = patch(
        row, endpoint="https://other.example.test", confirm_custom_origin=True
    )
    assert moved["endpoint"] == "https://other.example.test"
    renamed = patch(moved, label="Renamed", path_prefix="/api/v1")
    assert (renamed["label"], renamed["path_prefix"]) == ("Renamed", "/api/v1")

    for endpoint in (
        "http://169.254.169.254",
        "http://[fe80::1]:8000",
        "http://[::ffff:169.254.169.254]",
        "http://metadata.google.internal",
        "http://0.0.0.0:8000",
        "http://8.8.8.8:8000",
        "https://user:secret@llm.example.test",
        "https://llm.example.test/v1",
        "https://llm.example.test?x=1",
        "ftp://llm.example.test",
    ):
        assert (
            code(create, **{**CUSTOM, "endpoint": endpoint}, confirm_custom_origin=True)
            == "AI_ENDPOINT_INVALID"
        ), endpoint
    for path_prefix in (None, "/", "/admin", "/v1/../internal", "/v2"):
        assert (
            code(
                create,
                **{**CUSTOM, "path_prefix": path_prefix},
                confirm_custom_origin=True,
            )
            == "AI_ENDPOINT_INVALID"
        ), path_prefix
    # The confirmation is not a field of any other provider.
    assert (
        code(
            configuration.create_connection,
            {
                "label": "Local",
                "provider": "ollama",
                "endpoint": "http://10.0.0.5:11434",
                "confirm_custom_origin": True,
            },
            None,
        )
        == "AI_CONFIGURATION_INVALID"
    )


def test_manifest_validated(pg_db):
    row = create(model_manifest=[{**KIMI, "label": "Kimi K3.1 Pro"}])
    assert row["model_manifest"] == [
        {**KIMI, "label": "Kimi K3.1 Pro"},
    ]
    assert ModelManifestEntry.model_validate(LOCAL).model_dump(mode="json") == {
        **LOCAL,
        "label": None,
        "reasoning": "none",
        "reasoning_levels": [],
    }

    for entry in (
        {**KIMI, "model_id": "../models"},
        {**KIMI, "model_id": "https://evil.test/m"},
        {**KIMI, "max_output_tokens": KIMI["context_window"] + 1},
        {**KIMI, "structured_output": "none"},
        {k: v for k, v in KIMI.items() if k != "structured_output"},
        {**KIMI, "reasoning_levels": []},
        {**KIMI, "reasoning": "none"},
        {**KIMI, "reasoning_levels": ["low", "low"]},
        {**QWEN, "reasoning_levels": ["low"]},
        {**KIMI, "pricing": {"input": 1}},
        {**KIMI, "context_window": "262144"},
    ):
        with pytest.raises(ValidationError):
            ModelManifestEntry.model_validate(entry)
        with pytest.raises((ValidationError, AIConfigurationError)):
            create(model_manifest=[entry])

    assert code(create, model_manifest=[]) == "AI_MANIFEST_INVALID"
    assert code(create, model_manifest=[KIMI, KIMI]) == "AI_MANIFEST_INVALID"
    # Each template accepts only the reasoning controls its API has.
    assert code(create, model_manifest=[QWEN]) == "AI_MANIFEST_INVALID"
    assert (
        code(create, template="dashscope_intl", model_manifest=[KIMI])
        == "AI_MANIFEST_INVALID"
    )
    assert (
        code(
            create,
            **{**CUSTOM, "model_manifest": [ROUTED]},
            confirm_custom_origin=True,
        )
        == "AI_MANIFEST_INVALID"
    )
    with pytest.raises(ValidationError):
        create(model_manifest=[{**KIMI, "model_id": f"m{i}"} for i in range(51)])
    # Only openai_compatible connections have a manifest, template or prefix.
    for extra in (
        {"model_manifest": [KIMI]},
        {"template": "custom"},
        {"path_prefix": "/v1"},
    ):
        assert (
            code(
                configuration.create_connection,
                {
                    "label": "Local",
                    "provider": "ollama",
                    "endpoint": "http://10.0.0.5:11434",
                    **extra,
                },
                None,
            )
            == "AI_CONFIGURATION_INVALID"
        )

    # A new manifest drops the cached catalog, as a new origin does.
    store.save_model_catalog(
        row["id"],
        [
            {
                "provider": "openai_compatible",
                "model_id": KIMI["model_id"],
                "label": KIMI["model_id"],
            }
        ],
        "ready",
        row["revision"],
    )
    current = store.get_connection(row["id"])
    changed = configuration.patch_connection(
        row["id"],
        {"model_manifest": [{**KIMI, "model_id": "kimi-k3.2-pro"}]},
        current["revision"],
        None,
    )
    assert [m["model_id"] for m in changed["model_manifest"]] == ["kimi-k3.2-pro"]
    assert changed["model_catalog"] == [] and changed["catalog_status"] == "pending"
    assert code(patch, changed, model_manifest=[]) == "AI_MANIFEST_INVALID"
    # Models are declared in the manifest, not added one by one.
    assert (
        code(
            configuration.register_manual_model,
            changed["id"],
            "kimi-k3.3-pro",
            changed["revision"],
        )
        == "AI_CONFIGURATION_INVALID"
    )


def test_secret_stored_encrypted(pg_db, monkeypatch, caplog):
    monkeypatch.setenv("CRATE_CREDENTIAL_KEY", Fernet.generate_key().decode())
    key = "sk-moonshot-0123456789abcdefSECRET"
    row = create()
    assert row["has_key"] is False and row["source"] == "none"

    saved = configuration.set_credential(row["id"], key, row["revision"], None)

    assert saved["has_key"] is True and saved["source"] == "stored"
    assert key not in json.dumps(saved, default=str)
    assert "secret_ref" not in saved
    private = store.get_connection(row["id"], private=True)
    assert private["secret_source"] == "stored" and private["secret_ref"]
    assert key not in json.dumps(private, default=str)
    with read_scope() as session:
        ciphertext = session.execute(
            text("SELECT ciphertext FROM credential_secrets WHERE secret_ref = :ref"),
            {"ref": private["secret_ref"]},
        ).scalar_one()
        audit = session.execute(
            text("SELECT string_agg(details_json::text, ' ') FROM audit_log")
        ).scalar_one()
    assert key not in ciphertext and key[-8:] not in ciphertext
    assert key not in (audit or "")
    assert load_secret(private["secret_ref"], scope="ai") == {"api_key": key}
    snapshot = configuration.snapshot()
    assert key not in json.dumps(snapshot, default=str)
    assert key not in caplog.text
    # A key is required by the cloud templates and optional for a custom origin.
    assert configuration._has_credential(private) is True
    assert configuration._has_credential(store.get_connection(row["id"])) is True
    custom = create(**CUSTOM, confirm_custom_origin=True)
    assert configuration._has_credential(store.get_connection(custom["id"])) is True
    assert configuration._has_credential(store.get_connection(create()["id"])) is False


def test_moving_a_custom_origin_drops_its_key(pg_db, monkeypatch):
    # ai.config.manage can move an origin; only ai.credentials.manage may decide
    # which server receives a stored key, so a new destination starts keyless.
    monkeypatch.setenv("CRATE_CREDENTIAL_KEY", Fernet.generate_key().decode())
    row = create(**CUSTOM, confirm_custom_origin=True)
    row = configuration.set_credential(row["id"], "local-key", row["revision"], None)
    old_ref = store.get_connection(row["id"], private=True)["secret_ref"]

    kept = patch(row, path_prefix="/api/v1", label="Same server")
    assert kept["has_key"] is True
    assert load_secret(old_ref, scope="ai") == {"api_key": "local-key"}

    moved = patch(
        kept, endpoint="https://other.example.test", confirm_custom_origin=True
    )
    assert (moved["has_key"], moved["source"]) == (False, "none")
    private = store.get_connection(row["id"], private=True)
    assert private["secret_ref"] is None and private["secret_source"] == "none"
    with pytest.raises(Exception):
        load_secret(old_ref, scope="ai")
    # An unconfirmed move changes nothing, key included.
    again = configuration.set_credential(
        row["id"], "other-key", moved["revision"], None
    )
    assert (
        code(patch, again, endpoint="https://third.example.test")
        == "AI_ORIGIN_UNCONFIRMED"
    )
    assert store.get_connection(row["id"])["has_secret"] is True
