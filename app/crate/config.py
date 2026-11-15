import os
import yaml


def _env_enabled(name: str, *, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def load_config(path=None):
    if path is None:
        path = os.environ.get("CRATE_CONFIG", "/app/config.yaml")

    with open(path) as f:
        config = yaml.safe_load(f)

    return config


def get_redis_url() -> str:
    """Return the backward-compatible disposable cache Redis URL."""
    return get_cache_redis_url()


def get_cache_redis_url() -> str:
    """Return the disposable cache/metrics/pub-sub Redis URL.

    Falls back to an unauthenticated localhost URL for local development.
    ``REDIS_URL`` remains supported for single-Redis deployments.
    """
    return os.environ.get("REDIS_CACHE_URL") or os.environ.get(
        "REDIS_URL", "redis://localhost:6379/0"
    )


def get_durable_redis_url() -> str:
    """Return the durable broker/domain-event/coordination Redis URL."""
    return os.environ.get("REDIS_DURABLE_URL") or os.environ.get(
        "REDIS_URL", "redis://localhost:6379/0"
    )


def smart_mix_enabled() -> bool:
    return _env_enabled("CRATE_SMART_MIX_ENABLED")


def radio_rotation_enabled() -> bool:
    return _env_enabled("CRATE_RADIO_ROTATION_ENABLED", default=True)


def transition_fit_enabled() -> bool:
    return _env_enabled("CRATE_TRANSITION_FIT_ENABLED", default=True)


def android_native_crossfade_enabled() -> bool:
    return _env_enabled("CRATE_ANDROID_NATIVE_CROSSFADE_ENABLED")


def android_beatmatch_enabled() -> bool:
    return _env_enabled("CRATE_ANDROID_BEATMATCH_ENABLED")


def android_bass_handoff_enabled() -> bool:
    return _env_enabled("CRATE_ANDROID_BASS_HANDOFF_ENABLED")


def decks_beatmatch_enabled() -> bool:
    """Crate Decks' Smart Mix beatmatch switch (S5); independent of Android's.

    On by default (Diego, 2026-11-15); it still needs CRATE_SMART_MIX_ENABLED.
    """
    return _env_enabled("CRATE_DECKS_BEATMATCH_ENABLED", default=True)


def decks_bass_handoff_enabled() -> bool:
    """Crate Decks' bass handoff switch (S5); independent of Android's.

    On by default (Diego, 2026-11-15); it still needs Decks' beatmatch.
    """
    return _env_enabled("CRATE_DECKS_BASS_HANDOFF_ENABLED", default=True)


def listen_smart_mix_v3_enabled() -> bool:
    """Whether /api/capabilities recommends smart-mix-v3 to Listen (default v2)."""
    return _env_enabled("CRATE_LISTEN_SMART_MIX_V3_ENABLED")


def vdj_enabled() -> bool:
    return _env_enabled("CRATE_VDJ_ENABLED")


def vdj_automation_enabled() -> bool:
    return _env_enabled("CRATE_VDJ_AUTOMATION_ENABLED")
