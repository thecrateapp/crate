from fastapi import APIRouter, Request

from crate.api.schemas.capabilities import (
    AccessTokenCapabilities,
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
from crate.smart_mix.versions import (
    API_CONTRACT_VERSION,
    PLANNER_IDENTIFIER,
    PROFILE_SCHEMA_VERSION,
)

router = APIRouter(prefix="/api", tags=["system"])

AUTOMATION_SCOPE = "vdj.automation.execute"


@router.get(
    "/capabilities",
    response_model=CapabilitiesResponse,
    summary="Get first-party client capabilities",
)
def get_capabilities(request: Request) -> CapabilitiesResponse:
    available = smart_mix_enabled()
    native_crossfade = available and android_native_crossfade_enabled()
    beatmatch = native_crossfade and android_beatmatch_enabled()
    vdj_available = vdj_enabled()
    vdj_smart_mix_assistant = vdj_available and available
    vdj_automation = vdj_smart_mix_assistant and vdj_automation_enabled()
    return CapabilitiesResponse(
        smart_mix=SmartMixCapabilities(
            available=available,
            planner_version=PLANNER_IDENTIFIER if available else None,
            android_native_crossfade=native_crossfade,
            android_beatmatch=beatmatch,
        ),
        vdj=VDJCapabilities(
            available=vdj_available,
            min_plugin_version="1.0.0",
            max_plugin_version="1.x",
            contract_version=API_CONTRACT_VERSION,
            profile_schema_version=PROFILE_SCHEMA_VERSION,
            planner_version=PLANNER_IDENTIFIER,
            online_source=vdj_available,
            smart_mix_assistant=vdj_smart_mix_assistant,
            automation=vdj_automation,
        ),
        access_token=_access_token_capabilities(request, vdj_automation),
    )


def _access_token_capabilities(
    request: Request, vdj_automation: bool
) -> AccessTokenCapabilities | None:
    user = getattr(request.state, "user", None)
    if not user or user.get("auth_type") != "access_token":
        return None
    scopes = list(user.get("scopes") or [])
    return AccessTokenCapabilities(
        scopes=scopes,
        automation=vdj_automation and AUTOMATION_SCOPE in scopes,
    )
