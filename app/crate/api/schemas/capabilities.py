from pydantic import BaseModel, Field


class SmartMixCapabilities(BaseModel):
    available: bool
    planner_version: str | None
    android_native_crossfade: bool
    android_beatmatch: bool


class VDJCapabilities(BaseModel):
    available: bool
    min_plugin_version: str
    max_plugin_version: str
    contract_version: str
    profile_schema_version: int
    planner_version: str
    online_source: bool
    smart_mix_assistant: bool
    automation: bool


class AccessTokenCapabilities(BaseModel):
    scopes: list[str]
    automation: bool


class CapabilitiesResponse(BaseModel):
    smart_mix: SmartMixCapabilities
    vdj: VDJCapabilities
    access_token: AccessTokenCapabilities | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
