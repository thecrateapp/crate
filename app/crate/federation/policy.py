"""Federation transport defaults shared by peer operations."""

from __future__ import annotations

import os


DEFAULT_SEARCH_MODE = os.environ.get(
    "CRATE_FEDERATION_SEARCH_MODE", "local"
)  # local | auto | federated
DEFAULT_PEER_SEARCH_TIMEOUT_MS = int(
    os.environ.get("CRATE_FEDERATION_SEARCH_TIMEOUT_MS", "600")
)
DEFAULT_PEER_HEALTH_POLL_INTERVAL_S = int(
    os.environ.get("CRATE_FEDERATION_HEALTH_POLL_INTERVAL_S", "300")
)
