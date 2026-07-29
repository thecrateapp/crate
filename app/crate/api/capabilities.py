from fastapi import APIRouter

from crate.api.schemas.capabilities import CapabilitiesResponse
from crate.config import (
    android_beatmatch_enabled,
    android_native_crossfade_enabled,
    smart_mix_enabled,
)

router = APIRouter(prefix="/api", tags=["system"])


@router.get(
    "/capabilities",
    response_model=CapabilitiesResponse,
    summary="Get first-party client capabilities",
)
def get_capabilities() -> CapabilitiesResponse:
    available = smart_mix_enabled()
    native_crossfade = available and android_native_crossfade_enabled()
    beatmatch = native_crossfade and android_beatmatch_enabled()
    return CapabilitiesResponse(
        smart_mix={
            "available": available,
            "planner_version": "smart-mix-v1" if available else None,
            "android_native_crossfade": native_crossfade,
            "android_beatmatch": beatmatch,
        }
    )
