import logging
import os

from fastapi import APIRouter, Request

from crate.api.schemas.capabilities import (
    AccessTokenCapabilities,
    CapabilitiesResponse,
    DecksCapabilities,
    DecksFeature,
    SmartMixAiAssistedCapabilities,
    SmartMixCapabilities,
    SmartMixStemsCapabilities,
    VDJCapabilities,
)
from crate.api.permissions import has_capability
from crate.config import (
    android_bass_handoff_enabled,
    android_beatmatch_enabled,
    android_native_crossfade_enabled,
    listen_smart_mix_v3_enabled,
    smart_mix_enabled,
    vdj_automation_enabled,
    vdj_enabled,
)
from crate.db.queries.smart_mix_admin import (
    get_smart_mix_refinement_latency_ms,
    get_smart_mix_structure_percent,
)
from crate.db.repositories.smart_mix_stems import stem_uploads_enabled
from crate.llm.prompts.smart_mix_transition import PROMPT_VERSION
from crate.smart_mix_ai import gate_reason, provider_kind, refinement_gate
from crate.db.cache_settings import get_setting
from crate.smart_mix.policy import PLANNER_POLICY_V3
from crate.smart_mix.stem_storage import configured_stems_directory
from crate.smart_mix.stems import (
    STEM_CONTRIBUTE_PERMISSION,
    STEM_QUOTA_SETTING,
    stem_quota_gib,
)
from crate.smart_mix.versions import (
    API_CONTRACT_VERSION,
    PLANNER_IDENTIFIER,
    PLANNER_IDENTIFIERS,
    PROFILE_SCHEMA_VERSION,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["system"])

# smart_mix.structure: share of the library's tracks whose current profile has
# phrases, from the coverage snapshot (refresh_smart_mix_coverage). After the v7
# backfill about four in five tracks get phrases; the rest are crossfade genres,
# 3/4 meters and tracks the analyzer could not segment.
SMART_MIX_STRUCTURE_MIN_PERCENT = 50.0

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
            planner_versions=list(PLANNER_IDENTIFIERS) if available else [],
            structure=available and _structure_available(),
            listen_planner_version=_listen_planner(available),
            android_native_crossfade=native_crossfade,
            android_beatmatch=beatmatch,
            android_bass_handoff=bass_handoff,
            android_long_beatmatch=beatmatch,
            ai_assisted=_ai_assisted(available),
            # Smart Mix playlists can be turned on (ST2.PR1); the server keeps
            # their stem files for Decks (ST2.PR3) unless the quota is 0 or the
            # API has no stems directory.
            stems=SmartMixStemsCapabilities(
                available=available,
                playlists=available,
                storage=available and _stem_storage_available(),
            ),
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
            features=_decks_features(request),
        ),
        access_token=_access_token_capabilities(request, vdj_automation),
    )


def _listen_planner(available: bool) -> str | None:
    """The planner Listen asks for: v3 behind its switch, v2 otherwise (LV-D3).

    planner_version and the VirtualDJ contract never move; only this field does.
    """
    if not available:
        return None
    if listen_smart_mix_v3_enabled():
        return PLANNER_POLICY_V3.identifier
    return PLANNER_IDENTIFIER


def _structure_available() -> bool:
    try:
        percent = get_smart_mix_structure_percent()
    except Exception:
        # Capabilities bootstrap every client: an unreadable snapshot only hides
        # the structure flag.
        log.warning("Smart Mix coverage snapshot unreadable", exc_info=True)
        return False
    return percent is not None and percent >= SMART_MIX_STRUCTURE_MIN_PERCENT


def _ai_assisted(smart_mix_available: bool) -> SmartMixAiAssistedCapabilities:
    """From the cached refinement gate and the coverage snapshot (SM3-D9)."""
    unavailable = SmartMixAiAssistedCapabilities(
        available=False,
        provider_kind=None,
        model_label=None,
        prompt_version=PROMPT_VERSION,
        typical_latency_ms=None,
        reason="smart_mix_unavailable",
    )
    if not smart_mix_available:
        return unavailable
    try:
        gate = refinement_gate()
        latency = get_smart_mix_refinement_latency_ms()
    except Exception:
        # Capabilities bootstrap every client: an unreadable gate hides the option.
        log.warning("Smart Mix AI gate unreadable", exc_info=True)
        return unavailable.model_copy(update={"reason": "no_model"})
    reason = gate_reason(gate)
    configured = gate.get("enabled") and gate.get("available")
    return SmartMixAiAssistedCapabilities(
        available=reason is None,
        provider_kind=provider_kind(gate.get("provider")) if configured else None,
        model_label=gate.get("model_id") if configured else None,
        prompt_version=PROMPT_VERSION,
        typical_latency_ms=latency,
        reason=reason,
    )


def _decks_features(request: Request) -> list[DecksFeature]:
    # Each feature is added by the server change that serves its contract: S3
    # library_cursor (/api/decks), S4 profiles_batch, S5
    # beatmatch/bass_handoff/long_beatmatch, S7 cues, Smart Mix Stems ST1
    # stems/stem_upload and ST3 local_refinement. S5 and S7 are not served yet.
    # Do not derive them from the Android Smart Mix flags.
    features: list[DecksFeature] = ["library_cursor", "profiles_batch", "stems"]
    if _may_upload_stems(request):
        features.append("stem_upload")
    # smart-mix-v3 serves the candidate menu and policy limits to the decks context.
    features.append("local_refinement")
    return features


def _stem_storage_available() -> bool:
    if configured_stems_directory() is None:
        return False
    try:
        return stem_quota_gib(get_setting(STEM_QUOTA_SETTING)) > 0
    except Exception:
        log.warning("Could not read the stem quota", exc_info=True)
        return False


def _may_upload_stems(request: Request) -> bool:
    """PUT /api/decks/tracks/{uid}/stem-analysis would accept this caller's upload."""
    user = getattr(request.state, "user", None)
    # Access tokens never reach /api/decks.
    if not user or user.get("auth_type") == "access_token":
        return False
    if not has_capability(user, STEM_CONTRIBUTE_PERMISSION):
        return False
    try:
        return stem_uploads_enabled()
    except Exception:
        # Capabilities bootstrap every client: an unreadable setting hides uploads.
        log.warning("Smart Mix stem upload setting unreadable", exc_info=True)
        return False


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
