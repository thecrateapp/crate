"""Version and readiness evidence for the public MCP tool contract."""

import hashlib
import json
from importlib.metadata import version
from functools import lru_cache

from mcp_types.version import HANDSHAKE_PROTOCOL_VERSIONS, MODERN_PROTOCOL_VERSIONS

CONTRACT_VERSION = "1.1.0"


def contract_metadata() -> dict:
    return {
        "version": CONTRACT_VERSION,
        "sdk_version": version("mcp"),
        "protocol_versions": list(
            HANDSHAKE_PROTOCOL_VERSIONS + MODERN_PROTOCOL_VERSIONS
        ),
        "compatibility": "additive_within_major",
        "deprecations": [],
    }


@lru_cache(maxsize=128)
def schema_fingerprint(model) -> str:
    encoded = json.dumps(
        model.model_json_schema(), sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(encoded.encode()).hexdigest()


def export_contract() -> dict:
    from crate.mcp.tools import ACTION_CATALOG, CATALOG
    from crate.mcp.schemas import DiagnosticOutput
    from crate.agent_access import SCOPE_CAPABILITIES

    return {
        **contract_metadata(),
        "scopes": dict(sorted(SCOPE_CAPABILITIES.items())),
        "output_schema": DiagnosticOutput.model_json_schema(),
        "tools": [
            {
                "name": name,
                "contract_version": CONTRACT_VERSION,
                "description": description,
                "base_grant": grant,
                "read_only": name not in ACTION_CATALOG,
                "input_schema": model.model_json_schema(),
                "input_schema_sha256": schema_fingerprint(model),
            }
            for name, (model, grant, description) in sorted(
                (CATALOG | ACTION_CATALOG).items()
            )
        ],
        "authorization": "base_grant is not the complete variant/target authorization; use get_operation_catalog and exact plans. Discovery grants no permission.",
    }


def worker_readiness() -> dict:
    from crate.agent_diagnostics import get_instance_status
    from crate.worker import _HANDLER_GROUPS

    try:
        worker = get_instance_status()["data"]["worker"]
        ready = worker["availability"] == "available"
    except Exception:  # noqa: BLE001 — unavailable evidence must not imply readiness.
        ready = False
    registered = {
        name for _module, _attribute, names in _HANDLER_GROUPS for name in names
    }
    missing = [] if ready else ["fresh_worker_evidence"]
    if (
        not {"agent_maintenance", "agent_control", "health_check", "repair"}
        <= registered
    ):
        missing.append("worker_handler_registration")
    return {
        "status": "unavailable" if missing else "evidence_available",
        "missing": missing,
        "checked_in_worker": [
            "current_authority",
            "target_preconditions",
            "approval_if_required",
            "provider_and_filesystem_dependencies",
            "runtime_admission",
        ],
        "interpretation": "Persisted worker evidence, not a live probe or a guarantee of target readiness.",
    }


if __name__ == "__main__":
    print(json.dumps(export_contract(), indent=2, sort_keys=True))
