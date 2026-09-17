"""Subsonic and OpenSubsonic HTTP adapters."""

from fastapi import APIRouter

from crate.subsonic.capabilities import selected_engine

from . import legacy, media, system

_LEGACY_SYSTEM_PATHS = {
    "/rest/ping",
    "/rest/ping.view",
    "/rest/getLicense",
    "/rest/getLicense.view",
}
_LEGACY_MEDIA_PATHS = {
    "/rest/stream",
    "/rest/stream.view",
}


def create_subsonic_router(engine: str | None = None) -> APIRouter:
    """Select the legacy router or v1 system kernel plus legacy adapters."""
    selected = selected_engine(engine)
    legacy_routes = [
        route
        for route in legacy.router.routes
        if getattr(route, "path", None) not in _LEGACY_MEDIA_PATHS
    ]
    if selected == "legacy":
        return APIRouter(routes=[*legacy_routes, *media.router.routes])

    routes = [
        *system.router.routes,
        *(
            route
            for route in legacy_routes
            if getattr(route, "path", None) not in _LEGACY_SYSTEM_PATHS
        ),
        *media.router.routes,
    ]
    return APIRouter(routes=routes)


router = create_subsonic_router()

__all__ = ["create_subsonic_router", "router"]
