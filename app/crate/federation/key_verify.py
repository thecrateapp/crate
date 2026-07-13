"""Key material verification — detects missing keys when DB row exists."""

from __future__ import annotations

import logging
from pathlib import Path

from crate.db.repositories import federation as repo
from crate.federation.identity import is_valid_key_ref

log = logging.getLogger(__name__)


def _verify_key_material(
    private_key_ref: str,
    data_dir: str = "/data",
) -> bool:
    if not is_valid_key_ref(private_key_ref):
        return False

    root = Path(data_dir).resolve()
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
    ref = node.get("private_key_ref", "")
    if not ref:
        return False
    return not _verify_key_material(ref)
