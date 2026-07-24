"""Key material verification — detects missing keys when DB row exists."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from crate.db.repositories import federation as repo
from crate.db.repositories import federation_trust as trust_repo
from crate.federation.identity import is_valid_key_ref

log = logging.getLogger(__name__)


def _verify_key_material(
    private_key_ref: str,
    data_dir: str | None = None,
) -> bool:
    if not is_valid_key_ref(private_key_ref):
        return False

    root = Path(data_dir or os.environ.get("DATA_DIR", "./data")).resolve()
    pem_path = (root / private_key_ref).resolve()
    try:
        pem_path.relative_to(root)
    except ValueError:
        return False

    return pem_path.exists() and pem_path.is_file() and pem_path.stat().st_size > 0


def _is_key_material_missing() -> bool:
    node = repo.get_local_node()
    if not node:
        return False
    active_key = trust_repo.get_active_local_key()
    if not active_key:
        return True
    ref = active_key.get("private_key_ref", "")
    if not ref:
        return True
    return not _verify_key_material(ref)


def get_key_material_health() -> dict[str, str]:
    if not repo.get_local_node():
        return {"status": "unconfigured", "reason": "local_node_missing"}
    active_key = trust_repo.get_active_local_key()
    if not active_key:
        return {"status": "degraded", "reason": "active_key_record_missing"}
    private_key_ref = str(active_key.get("private_key_ref") or "")
    if not private_key_ref or not _verify_key_material(private_key_ref):
        return {"status": "degraded", "reason": "private_key_material_missing"}
    return {"status": "ok", "reason": "ready"}
