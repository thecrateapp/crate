"""Auto-bootstrap federation identity on application startup.

Called during API startup. Ensures every Crate instance has a node identity
and signing key before federation endpoints can be used.
"""

from __future__ import annotations

import logging

from crate.db.repositories import federation as repo
from crate.db.repositories import federation_trust as trust_repo
from crate.federation.identity import (
    ensure_keys_dir,
    generate_ed25519_key_pair,
    generate_key_id,
    public_key_to_base64,
    store_private_key,
)

log = logging.getLogger(__name__)


def bootstrap_federation_identity(
    display_name: str | None = None,
    api_base_url: str | None = None,
    listen_base_url: str | None = None,
) -> dict:

    existing = repo.get_local_node()
    if existing:
        log.debug("Local node identity already exists: %s", existing["node_uid"])
        return existing

    ensure_keys_dir()
    key_id = generate_key_id()
    private_key, public_key = generate_ed25519_key_pair()
    store_private_key(key_id, private_key)

    public_key_b64 = public_key_to_base64(public_key)

    if not display_name:
        display_name = "Crate Node"

    node = repo.ensure_local_node(
        display_name=display_name,
        api_base_url=api_base_url or "",
        listen_base_url=listen_base_url,
        active_key_id=key_id,
        private_key_ref=f"federation/keys/{key_id}.pem",
    )

    trust_repo.upsert_local_key(
        node_uid=str(node["node_uid"]),
        key_id=key_id,
        public_key=public_key_b64,
        private_key_ref=f"federation/keys/{key_id}.pem",
        status="active",
    )

    repo.update_local_node(
        node["node_uid"],
        public_keys_json=[
            {
                "key_id": key_id,
                "algorithm": "ed25519",
                "public_key": public_key_b64,
                "status": "active",
                "not_before": None,
                "not_after": None,
            }
        ],
    )

    log.info(
        "Bootstrapped federation identity: node_uid=%s key_id=%s",
        node["node_uid"],
        key_id,
    )
    return node
