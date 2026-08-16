from fastapi import APIRouter

from crate.api.schemas.capabilities import (
    CapabilitiesResponse,
    SmartMixCapabilities,
    VDJCapabilities,
)
from crate.config import (
    android_beatmatch_enabled,
    android_native_crossfade_enabled,
    smart_mix_enabled,
    vdj_automation_enabled,
    vdj_enabled,
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
    vdj_available = vdj_enabled()
    vdj_smart_mix_assistant = vdj_available and available
    return CapabilitiesResponse(
        smart_mix=SmartMixCapabilities(
            available=available,
            planner_version="smart-mix-v1" if available else None,
            android_native_crossfade=native_crossfade,
            android_beatmatch=beatmatch,
        ),
        vdj=VDJCapabilities(
            available=vdj_available,
            min_plugin_version="1.0.0",
            max_plugin_version="1.x",
            contract_version="2026-08",
            profile_schema_version=1,
            planner_version="smart-mix-v1",
            online_source=vdj_available,
            smart_mix_assistant=vdj_smart_mix_assistant,
            automation=vdj_smart_mix_assistant and vdj_automation_enabled(),
        ),
    )
