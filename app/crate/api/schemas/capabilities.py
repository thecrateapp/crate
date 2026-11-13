from typing import Literal

from pydantic import BaseModel, Field

DecksFeature = Literal[
    "library_cursor",
    "profiles_batch",
    "beatmatch",
    "bass_handoff",
    "long_beatmatch",
    "cues",
    "stems",
    "stem_upload",
    "local_refinement",
]


class SmartMixAiAssistedCapabilities(BaseModel):
    """AI Assisted Mixing (SM3-D9): whether clients may ask for refinements."""

    available: bool
    provider_kind: Literal["local", "cloud"] | None = Field(
        description="local: the model runs on the operator's own server (Ollama)."
    )
    model_label: str | None = Field(description="Display text only.")
    prompt_version: str
    typical_latency_ms: int | None = Field(
        description=(
            "Median model latency of the refinements of the last 24 h, from the "
            "coverage snapshot; null without data."
        )
    )
    reason: (
        Literal["smart_mix_unavailable", "disabled", "no_model", "budget"] | None
    ) = None


class SmartMixStemsCapabilities(BaseModel):
    """Smart Mix Stems (STEM-D4): stem levels per phrase in full profiles.

    playlists: Smart Mix playlists can be turned on (/api/smart-mix/playlists), so the
    server queues their tracks for separation, and playlist responses carry smartMix.
    storage: the server keeps stem audio for Crate Decks to download.
    """

    available: bool
    playlists: bool
    storage: bool


class SmartMixCapabilities(BaseModel):
    available: bool
    planner_version: str | None
    planner_versions: list[str] = Field(
        description=(
            "Planners POST /api/playback/transition-plans accepts as plannerVersion; "
            "planner_version is the default. Empty while Smart Mix is off."
        )
    )
    structure: bool = Field(
        description=(
            "Whether most of the library has analyzed phrases, so smart-mix-v3 "
            "plans on them; read from the coverage snapshot, never computed per "
            "request."
        )
    )
    listen_planner_version: str | None = Field(
        description=(
            "Planner Listen's native engine asks for, in its plan batches and its "
            "background continuation: smart-mix-v3 with "
            "CRATE_LISTEN_SMART_MIX_V3_ENABLED, smart-mix-v2 otherwise. Always one "
            "of planner_versions; null while Smart Mix is off."
        )
    )
    android_native_crossfade: bool
    android_beatmatch: bool
    android_bass_handoff: bool
    android_long_beatmatch: bool
    ai_assisted: SmartMixAiAssistedCapabilities
    stems: SmartMixStemsCapabilities


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
    listen_url: str | None = Field(default=None, exclude_if=lambda value: value is None)


class DecksCapabilities(BaseModel):
    available: bool = Field(
        description="Whether this server accepts the Crate Decks desktop client."
    )
    min_client_version: str = Field(
        description="Oldest Crate Decks version (semver) this server supports."
    )
    contract_version: int = Field(
        description=(
            "Version of the Decks server contract. It is bumped on every "
            "incompatible change; additive changes only add features."
        )
    )
    features: list[DecksFeature] = Field(
        description=(
            "Decks server contracts this instance serves. Clients must ignore "
            "unknown values and degrade when a feature is missing."
        )
    )


class AccessTokenCapabilities(BaseModel):
    scopes: list[str]
    automation: bool


class FederationCapabilities(BaseModel):
    """Streamed federated search for Listen (FED1.5, FED-D18)."""

    search_stream: bool = Field(
        description=(
            "GET /api/catalog/search-stream is offered: local results at once, then "
            "remote results from direct peers within the window. When false, "
            "clients keep /api/catalog/search."
        )
    )
    results_contract: str = Field(
        description="The node-to-node result envelope this server reads and serves."
    )
    min_query_length: int = Field(
        description="Queries with fewer characters (spaces ignored) never fan out."
    )
    window_ms: int = Field(description="How long remote results may keep arriving.")


class CapabilitiesResponse(BaseModel):
    smart_mix: SmartMixCapabilities
    vdj: VDJCapabilities
    decks: DecksCapabilities
    federation: FederationCapabilities
    access_token: AccessTokenCapabilities | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
