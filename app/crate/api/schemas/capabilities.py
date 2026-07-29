from pydantic import BaseModel


class SmartMixCapabilities(BaseModel):
    available: bool
    planner_version: str | None
    android_native_crossfade: bool
    android_beatmatch: bool


class CapabilitiesResponse(BaseModel):
    smart_mix: SmartMixCapabilities
