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
    "users.view",
    "users.manage",
    "roles.manage",
    "library.view",
    "library.metadata.write",
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


def get_user_capabilities(user: Mapping[str, Any] | None) -> set[str]:
    role = normalize_role(cast(str | None, (user or {}).get("role")))
    return set(ROLE_CAPABILITIES[role])


def has_capability(user: Mapping[str, Any] | None, capability: str) -> bool:
    if not user:
        return False
    role = normalize_role(cast(str | None, user.get("role")))
    return bool(_get_enforcer().enforce(f"role::{role}", capability))


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
    casbin = import_module("casbin")
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
