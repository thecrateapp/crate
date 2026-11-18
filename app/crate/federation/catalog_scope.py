"""Catalog sharing scope: the one definition the API and workers both enforce."""

from __future__ import annotations

import hashlib
import json as _json
from typing import Any

from crate.db.repositories import federation as repo
from crate.federation.authorization import (
    AuthorizationDecision,
    authorize,
    user_scoped_grant_permits,
)


def catalog_share_policy() -> dict[str, Any]:
    node = repo.get_local_node()
    if not node:
        return {}
    raw_policy = node.get("policy_json") or {}
    if isinstance(raw_policy, str):
        try:
            return dict(_json.loads(raw_policy or "{}"))
        except ValueError:
            return {}
    return dict(raw_policy)


def catalog_scope_allows_item(item: dict[str, Any], scope: dict[str, Any]) -> bool:
    allowed_types = scope.get("allowed_entity_types") or []
    if allowed_types and item.get("entity_type") not in allowed_types:
        return False
    allowed_uids = scope.get("allowed_entity_uids") or []
    return not allowed_uids or item.get("remote_entity_uid") in allowed_uids


def catalog_policy_allows_item(item: dict[str, Any], policy: dict[str, Any]) -> bool:
    if not catalog_scope_allows_item(item, policy.get("_grant_scope") or {}):
        return False
    catalog_filter = policy.get("catalog_filter") or {}
    expected_scope = catalog_filter.get("share_scope")
    if expected_scope:
        item_scope = item.get("_share_scope") or item.get("share_scope") or "library"
        if item_scope != expected_scope:
            return False

    allowed_entity_uids = set(catalog_filter.get("entity_uids") or [])
    type_key = f"{item.get('entity_type')}_entity_uids"
    allowed_entity_uids.update(catalog_filter.get(type_key) or [])
    if allowed_entity_uids and item.get("remote_entity_uid") not in allowed_entity_uids:
        return False

    denied_entity_uids = set(catalog_filter.get("deny_entity_uids") or [])
    return item.get("remote_entity_uid") not in denied_entity_uids


def catalog_policy_allows_live_search(policy: dict[str, Any]) -> bool:
    catalog_filter = policy.get("catalog_filter") or {}
    expected_scope = catalog_filter.get("share_scope")
    return expected_scope in (None, "", "library")


def catalog_policy_for_grant(
    policy: dict[str, Any],
    decision: AuthorizationDecision | None,
    *,
    include_genres: bool,
    metadata_decision: AuthorizationDecision | None = None,
) -> dict[str, Any]:
    constraints = decision.constraints if decision is not None else None
    metadata_constraints = (
        metadata_decision.constraints if metadata_decision is not None else None
    )
    return {
        **policy,
        "_grant_scope": {
            "allowed_entity_types": sorted(constraints.allowed_entity_types)
            if constraints
            else [],
            "allowed_entity_uids": sorted(constraints.allowed_entity_uids)
            if constraints
            else [],
            "include_genres": include_genres,
        },
        "_genre_scope": {
            "allowed_entity_types": sorted(metadata_constraints.allowed_entity_types)
            if metadata_constraints
            else [],
            "allowed_entity_uids": sorted(metadata_constraints.allowed_entity_uids)
            if metadata_constraints
            else [],
        },
    }


def catalog_policy_params(policy: dict[str, Any]) -> dict[str, Any]:
    catalog_filter = policy.get("catalog_filter") or {}
    expected_scope = catalog_filter.get("share_scope")
    grant_scope = policy.get("_grant_scope") or {}
    genre_scope = policy.get("_genre_scope") or {}
    return {
        "share_allowed": expected_scope in (None, "", "library"),
        "allowed_entity_uids": sorted(
            str(value) for value in catalog_filter.get("entity_uids") or []
        ),
        "allowed_artist_uids": sorted(
            str(value) for value in catalog_filter.get("artist_entity_uids") or []
        ),
        "allowed_album_uids": sorted(
            str(value) for value in catalog_filter.get("album_entity_uids") or []
        ),
        "allowed_track_uids": sorted(
            str(value) for value in catalog_filter.get("track_entity_uids") or []
        ),
        "denied_entity_uids": sorted(
            str(value) for value in catalog_filter.get("deny_entity_uids") or []
        ),
        "grant_allowed_entity_types": sorted(
            grant_scope.get("allowed_entity_types") or []
        ),
        "grant_allowed_entity_uids": sorted(
            grant_scope.get("allowed_entity_uids") or []
        ),
        "grant_include_genres": bool(grant_scope.get("include_genres")),
        "genre_allowed_entity_types": sorted(
            genre_scope.get("allowed_entity_types") or []
        ),
        "genre_allowed_entity_uids": sorted(
            genre_scope.get("allowed_entity_uids") or []
        ),
    }


def catalog_scope_digest(policy: dict[str, Any]) -> str:
    """sha256 hex of the manifest policy params; the delta cursor binds to it."""
    return hashlib.sha256(
        _json.dumps(
            catalog_policy_params(policy),
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()


def peer_search_policy(peer: dict[str, Any]) -> dict[str, Any] | None:
    """Scope a peer may live-search under, or None when it may not search.

    Also None when a role or subject grant permits catalog.search: those users
    may see more than the node-level scope, so one summary would hide results.
    """
    grants = repo.get_peer_grants(str(peer["node_uid"]))
    decision = authorize(
        peer=peer,
        grants=grants,
        capability="catalog.search",
        subject_hash=None,
        roles=set(),
        observe=False,
    )
    if not decision.allowed:
        return None
    if user_scoped_grant_permits(
        grants, peer_uid=str(peer["node_uid"]), capability="catalog.search"
    ):
        return None
    policy = catalog_share_policy()
    if not catalog_policy_allows_live_search(policy):
        return None
    return catalog_policy_for_grant(policy, decision, include_genres=False)
