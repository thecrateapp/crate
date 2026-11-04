"""Error tracking connection settings: validation, SSRF guard and token storage."""

from __future__ import annotations

import json

import pytest

from crate.error_inbox.config import (
    ErrorTrackingConfigError,
    load_config,
    load_sentry_token,
    parse_config,
    save_config,
    validate_base_url,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://sentry.io", "https://sentry.io"),
        ("https://US.Sentry.io/", "https://us.sentry.io"),
        ("https://de.sentry.io", "https://de.sentry.io"),
        ("https://sentry.home.lan", "https://sentry.home.lan"),
        ("https://192.168.1.10:9000", "https://192.168.1.10:9000"),
        ("https://[fd00::10]", "https://[fd00::10]"),
    ],
)
def test_accepts_cloud_and_self_hosted_base_urls(raw, expected):
    assert validate_base_url(raw) == expected


@pytest.mark.parametrize(
    "raw", ["http://sentry.io", "http://192.168.1.10:9000", "ftp://sentry.io"]
)
def test_rejects_http_base_url(raw):
    with pytest.raises(ErrorTrackingConfigError):
        validate_base_url(raw)


@pytest.mark.parametrize(
    "raw",
    [
        "https://169.254.169.254",
        "https://metadata.google.internal",
        "https://x.metadata.google.internal",
        "https://[fe80::1]",
        "https://100.100.100.200",
        "https://0.0.0.0",
    ],
)
def test_rejects_link_local_and_metadata(raw):
    with pytest.raises(ErrorTrackingConfigError):
        validate_base_url(raw)


@pytest.mark.parametrize(
    "raw",
    [
        "https://user:pass@sentry.io",
        "https://sentry.io/api/0",
        "https://sentry.io?x=1",
        "https://sentry.io#top",
        "https://sentry.io:70000",
        "https://sen try.io",
        "https://sentry.io%2f@evil.example",
    ],
)
def test_rejects_malformed_base_urls(raw):
    with pytest.raises(ErrorTrackingConfigError):
        validate_base_url(raw)


def test_parse_config_defaults_and_normalises():
    config = parse_config(
        {
            "organization": "ninja-development",
            "projects": ["crate-api", "crate-workers", "crate-api"],
            "environments": ["production"],
        }
    )

    assert config.provider == "sentry"
    assert config.base_url == "https://sentry.io"
    assert config.projects == ("crate-api", "crate-workers")
    assert config.environments == ("production",)
    assert config.triage.automatic is False
    assert config.triage.daily_max == 30
    assert config.fix is None
    assert config.secret_ref is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"provider": "glitchtip"},
        {"organization": ""},
        {"organization": "Ninja Development"},
        {"projects": ["crate api"]},
        {"projects": [f"p{index}" for index in range(51)]},
        {"environments": ["prod/eu"]},
        {"triage": {"daily_max": 501}},
        {"triage": {"automatic": "yes"}},
        {"fix": {"repository": "thecrateapp", "workflow": "error-autofix.yml"}},
        {"fix": {"repository": "thecrateapp/crate", "workflow": "../x.yml"}},
        {
            "fix": {
                "repository": "thecrateapp/crate",
                "workflow": "error-autofix.yml",
                "ref": "main..x",
            }
        },
    ],
)
def test_parse_config_rejects_invalid_values(overrides):
    payload = {"organization": "ninja-development", **overrides}

    with pytest.raises(ErrorTrackingConfigError):
        parse_config(payload)


def test_parse_config_keeps_fix_settings():
    config = parse_config(
        {
            "organization": "ninja-development",
            "fix": {"repository": "thecrateapp/crate", "workflow": "error-autofix.yml"},
        }
    )

    assert config.fix is not None
    assert config.fix.repository == "thecrateapp/crate"
    assert config.fix.ref == "main"
    assert config.fix.secret_ref is None


def _stored_settings():
    from crate.db.repositories.settings import get_setting

    raw = get_setting("error_tracking")
    return json.loads(raw) if raw else None


def test_load_config_is_none_when_unset(pg_db):
    assert load_config() is None


def test_token_never_in_settings(pg_db):
    config = save_config(
        {
            "organization": "ninja-development",
            "projects": ["crate-api"],
            "secret_ref": "forged",
        },
        sentry_token="sntrys_synthetic_token_value",
    )

    stored = _stored_settings()
    assert "sntrys_synthetic_token_value" not in json.dumps(stored)
    assert stored["secret_ref"] == config.secret_ref
    assert config.secret_ref != "forged"
    assert load_config() == config
    assert load_sentry_token(config) == "sntrys_synthetic_token_value"


def test_saving_without_token_keeps_the_stored_secret(pg_db):
    first = save_config(
        {"organization": "ninja-development"}, sentry_token="sntrys_one"
    )

    second = save_config(
        {"organization": "ninja-development", "projects": ["crate-api"]}
    )

    assert second.secret_ref == first.secret_ref
    assert second.projects == ("crate-api",)
    assert load_sentry_token(second) == "sntrys_one"


def test_token_rotation_revokes_the_previous_secret(pg_db):
    from crate.credentials import CredentialSecretError, load_secret

    first = save_config(
        {"organization": "ninja-development"}, sentry_token="sntrys_one"
    )
    second = save_config(
        {"organization": "ninja-development"}, sentry_token="sntrys_two"
    )

    assert second.secret_ref != first.secret_ref
    assert load_sentry_token(second) == "sntrys_two"
    with pytest.raises(CredentialSecretError):
        load_secret(first.secret_ref)


def test_load_sentry_token_without_secret_is_typed():
    config = parse_config({"organization": "ninja-development"})

    with pytest.raises(ErrorTrackingConfigError):
        load_sentry_token(config)
