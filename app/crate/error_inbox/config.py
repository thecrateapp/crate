"""Error tracking connection settings (settings key `error_tracking`).

The base URL accepts Sentry's cloud hosts or an administrator-chosen HTTPS host for
self-hosted installs. Self-hosted hosts get the same guard as Ollama discovery:
private and loopback addresses are allowed, metadata and link-local ones are not,
and the client re-checks every resolved address before it connects.

`fix` configures Launch fix (E3): the GitHub repository, workflow file and ref that
`dispatch_error_fix` dispatches, and a fine-grained GitHub token stored like the
Sentry one. Both tokens live in `credential_secrets`; `settings` only keeps refs.
"""

from __future__ import annotations

import ipaddress
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from crate.ai.contracts import AIConfigurationError
from crate.ai.discovery import _METADATA_HOSTS, _check_address
from crate.credentials import CredentialSecretError, load_secret
from crate.db.repositories.error_tracking_settings import (
    GITHUB_TOKEN_SCOPE,
    SENTRY_TOKEN_SCOPE,
    read_error_tracking_settings,
    save_error_tracking_settings,
)

SENTRY_CLOUD_HOSTS = frozenset({"sentry.io", "us.sentry.io", "de.sentry.io"})
DEFAULT_BASE_URL = "https://sentry.io"
MAX_PROJECTS = 50
MAX_ENVIRONMENTS = 10
MAX_DAILY_TRIAGE = 500
MAX_TOKEN_LENGTH = 512
# Fine-grained personal access tokens: they can be limited to one repository and to
# Actions read and write. Classic tokens (`ghp_`) cannot, so they are refused.
GITHUB_TOKEN_PREFIX = "github_pat_"
GITHUB_WEB_ROOT = "https://github.com"
_SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,49}$")
_ENVIRONMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
_REPOSITORY = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")
_WORKFLOW = re.compile(r"^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}\.ya?ml$")
_REF = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_./-]{0,99}$")
_HOSTNAME = re.compile(r"^[a-z0-9.-]+$")


class ErrorTrackingConfigError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _invalid(message: str) -> ErrorTrackingConfigError:
    return ErrorTrackingConfigError("ERROR_TRACKING_INVALID", message)


@dataclass(frozen=True, slots=True)
class TriageSettings:
    automatic: bool = False
    daily_max: int = 30


@dataclass(frozen=True, slots=True)
class FixSettings:
    repository: str
    workflow: str
    ref: str = "main"
    secret_ref: str | None = None

    @property
    def has_token(self) -> bool:
        return bool(self.secret_ref)

    @property
    def actions_url(self) -> str:
        """The workflow's runs on GitHub, where a dispatched fix shows up."""
        return f"{GITHUB_WEB_ROOT}/{self.repository}/actions/workflows/{self.workflow}"


@dataclass(frozen=True, slots=True)
class ErrorTrackingConfig:
    organization: str
    provider: str = "sentry"
    base_url: str = DEFAULT_BASE_URL
    projects: tuple[str, ...] = ()
    environments: tuple[str, ...] = ()
    secret_ref: str | None = None
    triage: TriageSettings = field(default_factory=TriageSettings)
    fix: FixSettings | None = None

    @property
    def hostname(self) -> str:
        return urlsplit(self.base_url).hostname or ""

    @property
    def is_cloud(self) -> bool:
        return self.hostname in SENTRY_CLOUD_HOSTS

    @property
    def fix_ready(self) -> bool:
        """Launch fix is configured: repository, workflow and a stored GitHub token."""
        return self.fix is not None and self.fix.has_token

    def to_settings(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "base_url": self.base_url,
            "organization": self.organization,
            "projects": list(self.projects),
            "environments": list(self.environments),
            "secret_ref": self.secret_ref,
            "triage": {
                "automatic": self.triage.automatic,
                "daily_max": self.triage.daily_max,
            },
            "fix": None
            if self.fix is None
            else {
                "repository": self.fix.repository,
                "workflow": self.fix.workflow,
                "ref": self.fix.ref,
                "secret_ref": self.fix.secret_ref,
            },
        }


def check_resolved_address(raw: str) -> str:
    """Address check applied to every DNS answer before the client connects."""
    try:
        return _check_address(raw.split("%", 1)[0])
    except (AIConfigurationError, ValueError):
        raise _invalid("Sentry host resolves to a disallowed address") from None


def validate_base_url(raw: Any) -> str:
    if (
        not isinstance(raw, str)
        or not raw
        or len(raw) > 2048
        or any(ord(char) <= 32 for char in raw)
        or "\\" in raw
        or "%" in raw
    ):
        raise _invalid("Invalid Sentry URL")
    try:
        parsed = urlsplit(raw)
        port = parsed.port
        hostname = (
            (parsed.hostname or "").rstrip(".").encode("idna").decode("ascii").lower()
        )
    except (ValueError, UnicodeError):
        raise _invalid("Invalid Sentry URL") from None
    if parsed.scheme != "https":
        raise _invalid("The Sentry URL must use HTTPS")
    if (
        not hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise _invalid("The Sentry URL must be a bare https origin")
    if hostname in SENTRY_CLOUD_HOSTS:
        if port is not None:
            raise _invalid("Sentry cloud hosts do not take a port")
        return f"https://{hostname}"
    if hostname in _METADATA_HOSTS or hostname.endswith(".metadata.google.internal"):
        raise _invalid("Metadata endpoints are not allowed")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address is not None:
        check_resolved_address(str(address))
    elif not _HOSTNAME.match(hostname):
        raise _invalid("Invalid Sentry hostname")
    host = f"[{hostname}]" if ":" in hostname else hostname
    return f"https://{host}" + (f":{port}" if port is not None else "")


def _flag(value: Any, default: bool, name: str) -> bool:
    if value is None:
        return default
    if not isinstance(value, bool):
        raise _invalid(f"{name} must be true or false")
    return value


def _bounded_int(value: Any, default: int, low: int, high: int, name: str) -> int:
    if value is None:
        return default
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not low <= value <= high
    ):
        raise _invalid(f"{name} must be an integer between {low} and {high}")
    return value


def _names(
    value: Any, pattern: re.Pattern[str], limit: int, name: str
) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, (list, tuple)):
        raise _invalid(f"{name} must be a list")
    names: list[str] = []
    for item in value:
        if not isinstance(item, str) or not pattern.match(item):
            raise _invalid(f"Invalid entry in {name}")
        if item not in names:
            names.append(item)
    if len(names) > limit:
        raise _invalid(f"{name} accepts at most {limit} entries")
    return tuple(names)


def _optional_ref(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value or len(value) > 200:
        raise _invalid("Invalid secret reference")
    return value


def _fix(value: Any) -> FixSettings | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise _invalid("fix must be an object")
    repository = value.get("repository")
    workflow = value.get("workflow")
    ref = value.get("ref") or "main"
    if (
        not isinstance(repository, str)
        or not _REPOSITORY.match(repository)
        or any(part in {".", ".."} for part in repository.split("/"))
    ):
        raise _invalid("fix.repository must look like owner/name")
    if not isinstance(workflow, str) or not _WORKFLOW.match(workflow):
        raise _invalid("fix.workflow must be a workflow file name")
    if not isinstance(ref, str) or not _REF.match(ref) or ".." in ref:
        raise _invalid("Invalid fix.ref")
    return FixSettings(
        repository=repository,
        workflow=workflow,
        ref=ref,
        secret_ref=_optional_ref(value.get("secret_ref")),
    )


def parse_config(raw: Mapping[str, Any]) -> ErrorTrackingConfig:
    if not isinstance(raw, Mapping):
        raise _invalid("error_tracking must be an object")
    provider = raw.get("provider") or "sentry"
    if provider != "sentry":
        raise _invalid("Only Sentry is supported")
    organization = raw.get("organization")
    if not isinstance(organization, str) or not _SLUG.match(organization):
        raise _invalid("organization must be a Sentry organization slug")
    triage = raw.get("triage") or {}
    if not isinstance(triage, Mapping):
        raise _invalid("triage must be an object")
    return ErrorTrackingConfig(
        provider=provider,
        base_url=validate_base_url(raw.get("base_url") or DEFAULT_BASE_URL),
        organization=organization,
        projects=_names(raw.get("projects"), _SLUG, MAX_PROJECTS, "projects"),
        environments=_names(
            raw.get("environments"), _ENVIRONMENT, MAX_ENVIRONMENTS, "environments"
        ),
        secret_ref=_optional_ref(raw.get("secret_ref")),
        triage=TriageSettings(
            automatic=_flag(triage.get("automatic"), False, "triage.automatic"),
            daily_max=_bounded_int(
                triage.get("daily_max"), 30, 0, MAX_DAILY_TRIAGE, "triage.daily_max"
            ),
        ),
        fix=_fix(raw.get("fix")),
    )


def load_config(*, session=None) -> ErrorTrackingConfig | None:
    try:
        raw = read_error_tracking_settings(session=session)
    except ValueError:
        raise _invalid("Stored error tracking settings are corrupt") from None
    return None if raw is None else parse_config(raw)


def _token_shape_ok(token: Any) -> bool:
    return (
        isinstance(token, str)
        and bool(token)
        and len(token) <= MAX_TOKEN_LENGTH
        and not any(ord(char) <= 32 for char in token)
    )


def _validated_token(token: Any) -> str:
    if not _token_shape_ok(token):
        raise _invalid("Invalid Sentry token")
    return token


def _validated_github_token(token: Any) -> str:
    if not _token_shape_ok(token):
        raise _invalid("Invalid GitHub token")
    if not token.startswith(GITHUB_TOKEN_PREFIX):
        raise _invalid(
            "The GitHub token must be a fine-grained personal access token "
            f"({GITHUB_TOKEN_PREFIX}...)"
        )
    return token


def save_config(
    payload: Mapping[str, Any],
    *,
    sentry_token: str | None = None,
    github_token: str | None = None,
    session=None,
) -> ErrorTrackingConfig:
    """Validate and store settings. Secret refs in the payload are ignored.

    Without `fix` the stored GitHub token is revoked: turning Launch fix off leaves
    no credential behind.
    """
    if sentry_token is not None:
        sentry_token = _validated_token(sentry_token)
    if github_token is not None:
        github_token = _validated_github_token(github_token)
    candidate = parse_config({**payload, "secret_ref": None})
    if github_token is not None and candidate.fix is None:
        raise _invalid("A GitHub token needs the fix repository and workflow")
    stored = save_error_tracking_settings(
        candidate.to_settings(),
        sentry_token=sentry_token,
        github_token=github_token,
        session=session,
    )
    return parse_config(stored)


def load_sentry_token(config: ErrorTrackingConfig, *, session=None) -> str:
    if not config.secret_ref:
        raise ErrorTrackingConfigError(
            "ERROR_TRACKING_TOKEN_MISSING", "No Sentry token is configured"
        )
    try:
        payload = load_secret(
            config.secret_ref, scope=SENTRY_TOKEN_SCOPE, session=session
        )
    except CredentialSecretError:
        raise ErrorTrackingConfigError(
            "ERROR_TRACKING_TOKEN_UNAVAILABLE", "The Sentry token cannot be read"
        ) from None
    token = payload.get("token")
    if not isinstance(token, str) or not token:
        raise ErrorTrackingConfigError(
            "ERROR_TRACKING_TOKEN_UNAVAILABLE", "The Sentry token cannot be read"
        )
    return token


def load_github_token(config: ErrorTrackingConfig, *, session=None) -> str:
    """The fine-grained GitHub token of Launch fix; only `dispatch_error_fix` reads it."""
    if config.fix is None or not config.fix.secret_ref:
        raise ErrorTrackingConfigError(
            "ERROR_FIX_NOT_CONFIGURED", "Launch fix is not configured"
        )
    try:
        payload = load_secret(
            config.fix.secret_ref, scope=GITHUB_TOKEN_SCOPE, session=session
        )
    except CredentialSecretError:
        raise ErrorTrackingConfigError(
            "ERROR_FIX_TOKEN_UNAVAILABLE", "The GitHub token cannot be read"
        ) from None
    token = payload.get("token")
    if not isinstance(token, str) or not token:
        raise ErrorTrackingConfigError(
            "ERROR_FIX_TOKEN_UNAVAILABLE", "The GitHub token cannot be read"
        )
    return token


__all__ = [
    "DEFAULT_BASE_URL",
    "GITHUB_TOKEN_PREFIX",
    "SENTRY_CLOUD_HOSTS",
    "ErrorTrackingConfig",
    "ErrorTrackingConfigError",
    "FixSettings",
    "TriageSettings",
    "check_resolved_address",
    "load_config",
    "load_github_token",
    "load_sentry_token",
    "parse_config",
    "save_config",
    "validate_base_url",
]
