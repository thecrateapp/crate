"""Read only bounded host evidence; operator identity comes from server configuration."""

import json
import os
import re
import time
from datetime import UTC, datetime
from pathlib import Path

from crate.agent_diagnostics import DiagnosticError

ROOT = Path("/run/crate-provenance")
SHA = re.compile(r"[a-f0-9]{40}")
HASH = re.compile(r"[a-f0-9]{64}")


def is_operator(principal_id):
    return str(principal_id) in os.environ.get(
        "CRATE_OPERATOR_PRINCIPAL_IDS", ""
    ).split(",")


def _read(name):
    with (ROOT / name).open("rb") as stream:
        raw = stream.read(65537)
    if len(raw) > 65536:
        raise ValueError("Oversized provenance")
    return json.loads(raw)


def _valid_identity(identity):
    if not isinstance(identity, dict) or set(identity) != {
        "instance_id",
        "release_sha",
        "context_sha256",
        "images",
    }:
        return False
    images = identity["images"]
    if not isinstance(images, dict) or not 1 <= len(images) <= 32:
        return False
    for service, item in images.items():
        if (
            not re.fullmatch(r"crate-[a-z-]{1,40}", service)
            or not isinstance(item, dict)
            or set(item) != {"reference", "source_sha", "image_id"}
            or not re.fullmatch(
                r"ghcr.io/thecrateapp/crate-[a-z-]+@sha256:[a-f0-9]{64}",
                item["reference"],
            )
            or not SHA.fullmatch(item["source_sha"])
            or not re.fullmatch(r"sha256:[a-f0-9]{64}", item["image_id"])
        ):
            return False
    return True


def current_identity():
    """Fresh observation of stable identity, never request time as freshness proof."""
    try:
        target, observation = _read("target.json"), _read("observation.json")
        marker = _read("deployment.json")
        active = _read("context.json")
        identity = observation["identity"]
        observed = observation["observed_at"]
        if (
            not _valid_identity(identity)
            or observation["state"] != "verified"
            or marker.get("state") != "verified"
            or marker.get("release_sha") != identity["release_sha"]
            or active.get("context_sha256") != identity["context_sha256"]
            or type(observed) not in (int, float)
            or not 0 <= time.time() - observed <= 90
            or identity["instance_id"] != os.environ.get("CRATE_AGENT_INSTANCE_ID")
            or identity["instance_id"] != target["instance_id"]
            or identity["release_sha"] != target["release_sha"]
            or identity["context_sha256"] != target["context_sha256"]
            or not SHA.fullmatch(identity["release_sha"])
            or not HASH.fullmatch(identity["context_sha256"])
            or not identity["images"]
            or identity["images"] != target["images"]
        ):
            raise ValueError("Unverified or changed identity")
        return identity
    except (OSError, ValueError, TypeError, KeyError):
        raise DiagnosticError(
            "EVIDENCE_STALE",
            "Current verified operator release/context/image evidence is unavailable or changed",
        ) from None


def capture(principal_id):
    return current_identity() if is_operator(principal_id) else None


def validate(principal_id, reviewed):
    # A durable bound plan remains protected even after its principal is removed
    # from configuration; adding a principal closes its old unbound plans too.
    if (reviewed is not None or is_operator(principal_id)) and (
        reviewed is None or reviewed != current_identity()
    ):
        raise DiagnosticError(
            "EVIDENCE_STALE",
            "Reviewed operator identity no longer matches the current verified target",
        )


def observation():
    try:
        identity = current_identity()
        return {
            "availability": "available",
            "observed_at": datetime.fromtimestamp(
                _read("observation.json")["observed_at"], UTC
            ).isoformat(),
            "identity": identity,
        }
    except (DiagnosticError, OSError, ValueError, TypeError, KeyError):
        return {"availability": "unavailable", "observed_at": None, "identity": None}
