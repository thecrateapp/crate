import os

from fastapi import APIRouter, Request

from crate.api.schemas.capabilities import (
    AccessTokenCapabilities,
    CapabilitiesResponse,
    DecksCapabilities,
    DecksFeature,
    SmartMixCapabilities,
    VDJCapabilities,
)
from crate.config import (
    android_bass_handoff_enabled,
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

# Crate Decks contract (D13). Bump DECKS_CONTRACT_VERSION on every incompatible
# change to S1-S7; each server phase appends its feature to _decks_features().
DECKS_CONTRACT_VERSION = 1
DECKS_MIN_CLIENT_VERSION = "0.1.0"


@router.get(
    "/capabilities",
    response_model=CapabilitiesResponse,
    summary="Get first-party client capabilities",
)
def get_capabilities(request: Request) -> CapabilitiesResponse:
    available = smart_mix_enabled()
    native_crossfade = available and android_native_crossfade_enabled()
    beatmatch = native_crossfade and android_beatmatch_enabled()
    bass_handoff = beatmatch and android_bass_handoff_enabled()
    vdj_available = vdj_enabled()
    vdj_smart_mix_assistant = vdj_available and available
    vdj_automation = vdj_smart_mix_assistant and vdj_automation_enabled()
    return CapabilitiesResponse(
        smart_mix=SmartMixCapabilities(
            available=available,
            planner_version=PLANNER_IDENTIFIER if available else None,
            android_native_crossfade=native_crossfade,
            android_beatmatch=beatmatch,
            android_bass_handoff=bass_handoff,
            android_long_beatmatch=beatmatch,
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
            listen_url=_listen_url(),
        ),
        decks=DecksCapabilities(
            available=True,
            min_client_version=DECKS_MIN_CLIENT_VERSION,
            contract_version=DECKS_CONTRACT_VERSION,
            features=_decks_features(),
        ),
        access_token=_access_token_capabilities(request, vdj_automation),
    )


def _decks_features() -> list[DecksFeature]:
    # None of the Decks-specific contracts (S3 library_cursor, S4
    # profiles_batch, S5 beatmatch/bass_handoff/long_beatmatch, S7 cues) is
    # served yet. Do not derive them from the Android Smart Mix flags.
    return []


def _listen_url() -> str | None:
    configured = os.environ.get("CRATE_LISTEN_PUBLIC_BASE_URL", "").strip()
    return configured.rstrip("/") or None


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
