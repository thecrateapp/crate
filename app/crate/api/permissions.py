from __future__ import annotations

from importlib import import_module
from threading import RLock
from typing import Any, Iterable, Mapping, cast

from fastapi import HTTPException, Request

ALL_CAPABILITIES: tuple[str, ...] = (
    "admin.access",
    "ops.health.view",
    "ops.logs.view",
    "ops.tasks.manage",
    "ops.runtime.manage",
    "settings.manage",
    "auth.manage",
    "audit.view",
    "users.view",
    "users.create",
    "users.manage",
    "users.status.manage",
    "users.password.manage",
    "users.sessions.manage",
    "users.delete",
    "roles.view",
    "roles.assign",
    "roles.manage",
    "library.view",
    "library.metadata.write",
    "library.analysis.manage",
    "library.maintenance.manage",
    "library.track.remove",
    "library.album.remove",
    "library.artist.remove",
    "library.files.delete",
    "library.repair.run",
    "library.import.manage",
    "library.bandcamp.manage",
    "library.tidal.manage",
    "curation.playlists.write",
    "curation.genres.write",
    "curation.shows.write",
    "curation.releases.write",
    "contributions.own.manage",
)

ROLE_CAPABILITIES: dict[str, tuple[str, ...]] = {
    "owner": ALL_CAPABILITIES,
    "admin": ALL_CAPABILITIES,
    "ops": (
        "ops.health.view",
        "ops.logs.view",
        "ops.tasks.manage",
        "ops.runtime.manage",
    ),
    "librarian": (
        "library.view",
        "library.metadata.write",
        "library.analysis.manage",
        "library.track.remove",
        "library.album.remove",
        "library.artist.remove",
        "library.files.delete",
        "library.repair.run",
        "library.import.manage",
        "library.bandcamp.manage",
        "library.tidal.manage",
    ),
    "curator": (
        "library.view",
        "curation.playlists.write",
        "curation.genres.write",
        "curation.shows.write",
        "curation.releases.write",
    ),
    "editor": (
        "library.view",
        "library.metadata.write",
    ),
    "contributor": (
        "library.view",
        "contributions.own.manage",
    ),
    "user": ("library.view",),
}

SUPPORTED_ROLES: tuple[str, ...] = tuple(ROLE_CAPABILITIES)

_MODEL = """
[request_definition]
r = sub, cap

[policy_definition]
p = sub, cap

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = (r.sub == p.sub || g(r.sub, p.sub)) && (p.cap == "*" || r.cap == p.cap)
"""

_enforcer_lock = RLock()
_enforcer: Any | None = None


class _SimpleCapabilityEnforcer:
    def __init__(self) -> None:
        self._policies: dict[str, set[str]] = {}

    def add_policy(self, subject: str, capability: str) -> None:
        self._policies.setdefault(subject, set()).add(capability)

    def enforce(self, subject: str, capability: str) -> bool:
        capabilities = self._policies.get(subject, set())
        return "*" in capabilities or capability in capabilities


def normalize_role(role: str | None) -> str:
    normalized = (role or "user").strip().lower()
    return normalized if normalized in ROLE_CAPABILITIES else "user"


def validate_role(role: str | None) -> str:
    normalized = (role or "user").strip().lower()
    if normalized not in ROLE_CAPABILITIES:
        supported = ", ".join(SUPPORTED_ROLES)
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported role '{role}'. Supported roles: {supported}.",
        )
    return normalized


def validate_roles(roles: Iterable[str | None] | None) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for role in roles or []:
        value = validate_role(role)
        if value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized or ["user"]


def get_user_roles(user: Mapping[str, Any] | None) -> tuple[str, ...]:
    if not user:
        return ("user",)
    raw_roles = user.get("roles")
    if isinstance(raw_roles, (list, tuple, set)):
        roles = [
            normalize_role(cast(str | None, role))
            for role in raw_roles
            if str(role or "").strip()
        ]
    else:
        roles = [normalize_role(cast(str | None, user.get("role")))]
    unique: list[str] = []
    seen: set[str] = set()
    for role in roles:
        if role in seen:
            continue
        seen.add(role)
        unique.append(role)
    return tuple(unique or ["user"])


def get_user_capabilities(user: Mapping[str, Any] | None) -> set[str]:
    capabilities: set[str] = set()
    for role in get_user_roles(user):
        capabilities.update(ROLE_CAPABILITIES[role])
    return capabilities


def has_capability(user: Mapping[str, Any] | None, capability: str) -> bool:
    if not user:
        return False
    return any(
        bool(_get_enforcer().enforce(f"role::{role}", capability))
        for role in get_user_roles(user)
    )


def require_permission(request: Request, capability: str) -> dict:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not has_capability(user, capability):
        raise HTTPException(status_code=403, detail="Permission denied")
    return user


def require_any_permission(request: Request, capabilities: Iterable[str]) -> dict:
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not any(has_capability(user, capability) for capability in capabilities):
        raise HTTPException(status_code=403, detail="Permission denied")
    return user


def _get_enforcer() -> Any:
    global _enforcer
    with _enforcer_lock:
        if _enforcer is None:
            _enforcer = _build_enforcer()
        return _enforcer


def _build_enforcer() -> Any:
    try:
        casbin = import_module("casbin")
    except ModuleNotFoundError:
        enforcer = _SimpleCapabilityEnforcer()
    else:
        model = casbin.Model()
        model.load_model_from_text(_MODEL)
        enforcer = casbin.Enforcer(model)
    for role, capabilities in ROLE_CAPABILITIES.items():
        subject = f"role::{role}"
        if role in {"owner", "admin"}:
            enforcer.add_policy(subject, "*")
            continue
        for capability in capabilities:
            enforcer.add_policy(subject, capability)
    return enforcer
