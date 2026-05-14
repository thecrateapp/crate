import os
import yaml


def load_config(path=None):
    if path is None:
        path = os.environ.get("CRATE_CONFIG", "/app/config.yaml")

    with open(path) as f:
        config = yaml.safe_load(f)

    return config


def get_redis_url() -> str:
    """Return the Redis connection URL from the environment.

    Falls back to an unauthenticated localhost URL for local development.
    All Docker Compose environments must set REDIS_URL with auth.
    """
    return os.environ.get("REDIS_URL", "redis://localhost:6379/0")
