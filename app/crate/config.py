import os
import yaml


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
