"""Human-readable labels, groups, access and presets for MCP permission scopes.

This module is the single source of truth for how the Admin presents
``ALLOWED_GRANTS``: a human label, a display group, whether granting it allows
reads or changes, and a small set of curated presets. It performs no
database access.
"""

from dataclasses import dataclass
from typing import Literal

from crate.agent_access import ALLOWED_GRANTS, SCOPE_CAPABILITIES

SCOPE_GROUPS: tuple[tuple[str, str], ...] = (
    ("library", "Library"),
    ("shows", "Shows"),
    ("editorial", "Editorial"),
    ("jobs", "Jobs and schedules"),
    ("instance", "Instance"),
)

_GROUP_ORDER = {
    group_id: index for index, (group_id, _label) in enumerate(SCOPE_GROUPS)
}


@dataclass(frozen=True)
class ScopeDetail:
    label: str
    group: str
    access: Literal["read", "change"]


def _group_for(scope: str) -> str:
    if scope.startswith("library."):
        return "library"
    if scope.startswith("curation.shows."):
        return "shows"
    if scope.startswith("editorial."):
        return "editorial"
    if scope.startswith("ops.jobs.") or scope.startswith("ops.schedules."):
        return "jobs"
    return "instance"


def _access_for(scope: str) -> Literal["read", "change"]:
    return "read" if scope.endswith((".read", ".search")) else "change"


_LABELS: dict[str, str] = {
    "library.health.read": "Inspect library health",
    "library.health.run": "Run selected library health checks",
    "library.repair.photo_flag": "Update an artist's photo flag",
    "library.quality.run": "Refresh library quality evidence",
    "library.repair.run": "Apply reviewed library repairs",
    "library.metadata.write": "Edit library metadata",
    "library.enrichment.run": "Enrich selected library metadata",
    "library.analysis.run": "Schedule track analysis",
    "library.sync.run": "Synchronize selected library albums",
    "library.metadata.export": "Export library metadata",
    "library.metadata.rehydrate": "Import portable metadata",
    "library.acquisition.search": "Search supported catalogs for missing releases",
    "library.acquisition.write": "Acquire and import approved releases",
    "ops.status.read": "Read instance status",
    "ops.jobs.read": "Read job history",
    "ops.jobs.retry": "Retry reviewed maintenance jobs",
    "ops.jobs.cancel_pending": "Cancel owned pending jobs",
    "ops.logs.read": "Read worker logs",
    "ops.audit.read": "Read sanitized audit history",
    "ops.jobs.cancel": "Request cooperative job cancellation",
    "ops.jobs.manage_instance": "Control reviewed Admin and scheduler jobs",
    "ops.schedules.read": "Read schedules and execution evidence",
    "ops.schedules.run": "Run reviewed scheduled maintenance",
    "ops.schedules.write": "Update reviewed schedule intervals",
    "ops.runtime.read": "Read runtime policy and worker adoption",
    "ops.runtime.write": "Update reviewed runtime policy",
    "curation.shows.read": "Read upcoming shows",
    "curation.shows.write": "Import reviewed shows",
    "editorial.read": "Read editorial playlists and selections",
    "editorial.prepare": "Prepare editorial playlist changes",
    "editorial.write": "Apply reviewed editorial playlist changes",
    "editorial.publish": "Change editorial playlist visibility",
}

SCOPE_DETAILS: dict[str, ScopeDetail] = {
    scope: ScopeDetail(
        label=_LABELS.get(scope, scope),
        group=_group_for(scope),
        access=_access_for(scope),
    )
    for scope in ALLOWED_GRANTS
}


@dataclass(frozen=True)
class ScopePreset:
    id: str
    label: str
    description: str
    scopes: tuple[str, ...]


_READ_ONLY_SCOPES: tuple[str, ...] = tuple(
    sorted(scope for scope, detail in SCOPE_DETAILS.items() if detail.access == "read")
)

_LIBRARY_MAINTAINER_SCOPES: tuple[str, ...] = tuple(
    sorted(scope for scope in ALLOWED_GRANTS if scope.startswith("library."))
) + (
    "ops.status.read",
    "ops.jobs.read",
    "ops.jobs.retry",
    "ops.jobs.cancel_pending",
)

_CRATE_AGENT_SCOPES: tuple[str, ...] = (
    "library.health.read",
    "ops.status.read",
    "ops.jobs.read",
    "ops.logs.read",
    "ops.audit.read",
    "ops.schedules.read",
    "ops.runtime.read",
)

_CRATE_OPERATOR_SCOPES: tuple[str, ...] = _CRATE_AGENT_SCOPES + (
    "library.health.run",
    "library.quality.run",
    "library.repair.run",
    "library.repair.photo_flag",
    "library.metadata.write",
    "library.metadata.export",
    "library.metadata.rehydrate",
    "library.enrichment.run",
    "library.analysis.run",
    "library.sync.run",
    "library.acquisition.search",
    "library.acquisition.write",
    "ops.jobs.retry",
    "ops.jobs.cancel",
    "ops.schedules.run",
    "ops.schedules.write",
    "ops.runtime.write",
    "curation.shows.read",
    "curation.shows.write",
    "editorial.read",
    "editorial.prepare",
    "editorial.write",
    "editorial.publish",
)

SCOPE_PRESETS: tuple[ScopePreset, ...] = (
    ScopePreset(
        id="read_only",
        label="Read only",
        description=(
            "Inspect library health, jobs, logs, schedules and shows. "
            "Cannot change anything."
        ),
        scopes=_READ_ONLY_SCOPES,
    ),
    ScopePreset(
        id="shows_curator",
        label="Shows curator",
        description="Read and import reviewed upcoming shows.",
        scopes=(
            "curation.shows.read",
            "curation.shows.write",
            "ops.status.read",
            "ops.jobs.read",
        ),
    ),
    ScopePreset(
        id="editorial_curator",
        label="Editorial curator",
        description="Prepare, apply and publish reviewed editorial playlists.",
        scopes=(
            "editorial.read",
            "editorial.prepare",
            "editorial.write",
            "editorial.publish",
            "ops.status.read",
            "ops.jobs.read",
        ),
    ),
    ScopePreset(
        id="library_maintainer",
        label="Library maintainer",
        description=(
            "Run checks, repairs, metadata, enrichment, analysis and sync on "
            "selected items."
        ),
        scopes=_LIBRARY_MAINTAINER_SCOPES,
    ),
    ScopePreset(
        id="crate_agent",
        label="Crate Agent (read only)",
        description=(
            "Exactly what Crate Agent uses: health, status, jobs, logs, audit, "
            "schedules and runtime policy. Cannot change anything."
        ),
        scopes=_CRATE_AGENT_SCOPES,
    ),
    ScopePreset(
        id="crate_operator",
        label="Crate Operator",
        description=(
            "Exactly what Crate Operator tools need, including reviewed changes. "
            "Requires actions to be enabled and human approval."
        ),
        scopes=_CRATE_OPERATOR_SCOPES,
    ),
)


def scope_catalog(capabilities: set[str]) -> list[dict]:
    """Describe every allowed grant for the Admin, given the caller's capabilities."""
    rows = []
    for scope in ALLOWED_GRANTS:
        detail = SCOPE_DETAILS.get(scope)
        label = detail.label if detail else scope
        group = detail.group if detail else "instance"
        access = detail.access if detail else _access_for(scope)
        capability = SCOPE_CAPABILITIES[scope]
        rows.append(
            {
                "scope": scope,
                "capability": capability,
                "can_grant": capability in capabilities,
                "label": label,
                "group": group,
                "access": access,
            }
        )
    rows.sort(
        key=lambda row: (
            _GROUP_ORDER.get(row["group"], len(SCOPE_GROUPS)),
            0 if row["access"] == "read" else 1,
            row["label"],
        )
    )
    return rows


__all__ = [
    "SCOPE_DETAILS",
    "SCOPE_GROUPS",
    "SCOPE_PRESETS",
    "ScopeDetail",
    "ScopePreset",
    "scope_catalog",
]
