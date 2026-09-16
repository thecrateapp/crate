"""Subsonic and OpenSubsonic HTTP adapters."""

from fastapi import APIRouter

from crate.subsonic.capabilities import selected_engine

from . import legacy, system

_LEGACY_SYSTEM_PATHS = {
    "/rest/ping",
    "/rest/ping.view",
    "/rest/getLicense",
    "/rest/getLicense.view",
}


def create_subsonic_router(engine: str | None = None) -> APIRouter:
    """Select the legacy router or v1 system kernel plus legacy adapters."""
    selected = selected_engine(engine)
    if selected == "legacy":
        return legacy.router

    routes = [
        *system.router.routes,
        *(
            route
            for route in legacy.router.routes
            if getattr(route, "path", None) not in _LEGACY_SYSTEM_PATHS
        ),
    ]
    return APIRouter(routes=routes)


router = create_subsonic_router()

__all__ = ["create_subsonic_router", "router"]
