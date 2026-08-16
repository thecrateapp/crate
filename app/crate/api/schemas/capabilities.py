from pydantic import BaseModel


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


class CapabilitiesResponse(BaseModel):
    smart_mix: SmartMixCapabilities
    vdj: VDJCapabilities
