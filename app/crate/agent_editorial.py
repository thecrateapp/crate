"""Editorial MCP tools and the closed worker adapter for system playlists."""

from datetime import datetime, timezone

from crate.agent_diagnostics import DiagnosticError
from crate.api.public_urls import public_share_url
from crate.agent_library_operations import apply_operation as queue_apply
from crate.agent_library_operations import prepare_operation as queue_prepare
from crate.db.repositories.editorial_plans import (
    apply_editorial_execution,
    get_owned_editorial_execution,
    list_editorial_playlists,
    read_editorial_playlist,
    resolve_global_track_uids,
    resolve_track_uids,
    search_editorial_candidates,
    snapshot_system_playlist,
    validate_editorial_execution,
)
from crate.db.repositories.playlists_rule_engine_executor import execute_smart_rules
from crate.db.repositories.playlists_tracks import (
    _merge_preserved_and_generated,
    _track_identities_match,
)
from crate.mcp.editorial_schemas import EditorialPrepare
from crate.playlist_blueprints import build_playlist_blueprints
from crate.playlist_rule_contract import validate_smart_rules
from crate.db.repositories.playlists_rule_engine_config import (
    FIELD_COLUMNS,
    SORT_MAP,
    TEXT_FIELDS,
)


def _envelope(
    data: dict,
    *,
    source="agent_editorial",
    interpretation="Editorial evidence is private until an approved worker applies the exact plan.",
) -> dict:
    return {
        "schema_version": "1",
        "availability": "available",
        "source": source,
        "data": data,
        "interpretation": interpretation,
    }


def editorial_playlists_list(principal, *, limit=20, offset=0):
    data = list_editorial_playlists(limit=limit, offset=offset)
    for item in data["items"]:
        item["listen_url"] = (
            public_share_url(f"/curation/playlist/{item['id']}")
            if item["is_active"]
            else None
        )
    return _envelope(data)


def editorial_playlist_get(
    principal, *, playlist_id, section="tracks", limit=20, offset=0
):
    data = read_editorial_playlist(
        playlist_id, section=section, limit=limit, offset=offset
    )
    data["playlist"]["listen_url"] = (
        public_share_url(f"/curation/playlist/{playlist_id}")
        if data["playlist"]["is_active"]
        else None
    )
    return _envelope(data)


def editorial_options(principal, *, artist_name=None, genre_name=None):
    return _envelope(
        {
            "blueprints": build_playlist_blueprints(
                artist_name=artist_name, genre_name=genre_name
            ),
            "fields": {
                key: ["eq", "neq", "contains", "not_contains", "in"]
                if key in TEXT_FIELDS
                else ["eq", "neq", "gte", "lte", "between", "in"]
                for key in FIELD_COLUMNS
            },
            "sorts": sorted(SORT_MAP),
            "max_plan_tracks": 100,
            "generation_modes": ["static", "smart"],
        }
    )


def editorial_candidates_search(principal, *, query, limit=20):
    return _envelope(
        {"items": search_editorial_candidates(query, limit=limit)},
        interpretation="Candidates come from local library rows. Confirm a track UID before selection; no match does not imply a complete-library absence.",
    )


def editorial_plan_prepare(principal, *, idempotency_key, trace_id=None, **parameters):
    EditorialPrepare.model_validate({**parameters, "idempotency_key": idempotency_key})
    return queue_prepare(
        principal, "editorial_change", parameters, idempotency_key, trace_id=trace_id
    )


def _plan(principal, plan_id):
    return get_owned_editorial_execution(principal, plan_id)


def editorial_plan_get(principal, *, plan_id, limit=20, offset=0):
    from crate.db.repositories.agent_plans import get_owned_plan

    owned = get_owned_plan(principal, plan_id)
    if owned["operation"] != "editorial_change":
        raise DiagnosticError("NOT_FOUND", "Owned editorial plan was not found")
    selection = owned.pop("selection", [])
    # Generic plan metadata, approval state and full result remain available,
    # while the exact ordered selection is paginated for MCP transport.
    owned["selection_count"] = len(selection)
    owned["selection"] = selection[offset : offset + limit]
    owned["next_offset"] = offset + limit if offset + limit < len(selection) else None
    return _envelope(
        owned,
        interpretation="Review every page of the frozen ordered selection before approval. The plan is private and does not create a system playlist.",
    )


def editorial_plan_validate(principal, *, plan_id, limit=20, offset=0):
    plan = _plan(principal, plan_id)
    if plan["expires_at"] <= datetime.now(timezone.utc):
        raise DiagnosticError("PLAN_STALE", "Editorial plan expired")
    result = validate_editorial_execution(plan["execution"])
    return _envelope(
        {
            **result,
            "plan_id": plan_id,
            "plan_version": plan["version"],
            "kind": plan["document"]["kind"],
        },
        interpretation="Validation checks the current playlist revision, overrides and every selected track fingerprint. Apply rechecks inside the write transaction.",
    )


def _apply_plan(
    principal, plan_id, plan_version, idempotency_key, trace_id, *, publication
):
    plan = _plan(principal, plan_id)
    if plan["version"] != plan_version:
        raise DiagnosticError("PLAN_STALE", "Plan version changed")
    kind = plan["document"]["kind"]
    if (kind in {"create", "duplicate", "visibility"}) != publication:
        raise DiagnosticError(
            "INVALID_ARGUMENT", "Use the matching editorial apply or publication tool"
        )
    return queue_apply(
        principal,
        "editorial_change",
        plan_id,
        plan_version,
        idempotency_key,
        trace_id=trace_id,
    )


def editorial_plan_apply(
    principal, *, plan_id, plan_version, idempotency_key, trace_id=None
):
    return _apply_plan(
        principal, plan_id, plan_version, idempotency_key, trace_id, publication=False
    )


def editorial_publication_set(
    principal,
    *,
    idempotency_key,
    playlist_id=None,
    expected_revision=None,
    is_active=None,
    plan_id=None,
    plan_version=None,
    trace_id=None,
):
    if plan_id:
        return _apply_plan(
            principal,
            plan_id,
            plan_version,
            idempotency_key,
            trace_id,
            publication=True,
        )
    return queue_prepare(
        principal,
        "editorial_change",
        {
            "kind": "visibility",
            "playlist_id": playlist_id,
            "expected_revision": expected_revision,
            "is_active": is_active,
        },
        idempotency_key,
        trace_id=trace_id,
    )


def _resolved_selection(uids: list[str], *, source="manual", locked=True) -> list[dict]:
    resolved = resolve_track_uids(uids)
    if len(resolved) != len(uids):
        raise DiagnosticError(
            "INVALID_ARGUMENT",
            "One or more selected tracks are unavailable or ambiguous",
        )
    return [
        {
            **resolved[uid],
            "row_id": None,
            "position": index + 1,
            "track_id": resolved[uid]["id"],
            "source": source,
            "locked": locked,
            "available": True,
        }
        for index, uid in enumerate(uids)
    ]


def _existing_selection(rows: list[dict], *, duplicate=False) -> list[dict]:
    uids = [row["track_uid"] for row in rows if row.get("track_uid")]
    resolved = resolve_track_uids(list(set(uids)))
    global_uids = [
        row["global_track_uid"]
        for row in rows
        if row.get("global_track_uid") and row.get("track_uid") not in resolved
    ]
    global_resolved = resolve_global_track_uids(list(set(global_uids)))
    result = []
    for row in rows:
        uid = row.get("track_uid")
        item = {**row, "row_id": None if duplicate else row["row_id"]}
        if uid and uid in resolved:
            item["fingerprint"] = resolved[uid]["fingerprint"]
        global_uid = row.get("global_track_uid") if uid not in resolved else None
        if global_uid:
            if global_uid not in global_resolved:
                raise DiagnosticError(
                    "INVALID_ARGUMENT",
                    "Existing playlist has an unavailable global track",
                )
            global_track = global_resolved[global_uid]
            item.update(
                {
                    "track_uid": None,
                    "track_id": None,
                    "storage_id": None,
                    "path": None,
                    "title": global_track["canonical_title"],
                    "artist": global_track["artist_name"],
                    "album": global_track["album_name"],
                    "duration": global_track["duration_seconds"],
                    "global_fingerprint": global_track["fingerprint"],
                }
            )
        elif uid and uid not in resolved:
            raise DiagnosticError(
                "INVALID_ARGUMENT", "Existing playlist has an unavailable local track"
            )
        elif not uid:
            raise DiagnosticError(
                "INVALID_ARGUMENT", "Existing playlist row has no resolvable track UID"
            )
        result.append(item)
    return result


def compile_operation(
    operation: str, parameters: dict, config: dict, *, principal=None
) -> dict:
    if operation != "editorial_change":
        raise DiagnosticError("INVALID_ARGUMENT", "Unsupported editorial operation")
    if principal is None:
        raise DiagnosticError("INVALID_ARGUMENT", "Editorial plan requires a principal")
    kind = parameters.get("kind")
    if kind == "visibility":
        if (
            set(parameters) != {"kind", "playlist_id", "expected_revision", "is_active"}
            or type(parameters["is_active"]) is not bool
        ):
            raise DiagnosticError("INVALID_ARGUMENT", "Invalid publication request")
    else:
        EditorialPrepare.model_validate({**parameters, "idempotency_key": "worker"})
    state = (
        snapshot_system_playlist(parameters["playlist_id"])
        if parameters.get("playlist_id")
        else None
    )
    if state is None and kind != "create":
        raise DiagnosticError("NOT_FOUND", "System playlist was not found")
    source_state = (
        state if state is not None else {"playlist": {}, "tracks": [], "exclusions": []}
    )
    if (
        kind == "visibility"
        and source_state["playlist"]["editorial_revision"]
        != parameters["expected_revision"]
    ):
        raise DiagnosticError(
            "PLAN_STALE", "Playlist revision changed before publication preparation"
        )
    if (
        kind == "refresh_policy"
        and source_state["playlist"]["generation_mode"] != "smart"
    ):
        raise DiagnosticError(
            "INVALID_ARGUMENT", "Only smart playlists have refresh policy"
        )
    original = state["playlist"] if state else {}
    mode = (
        parameters.get("generation_mode") or original.get("generation_mode") or "static"
    )
    rules = (
        parameters.get("smart_rules")
        if parameters.get("smart_rules") is not None
        else original.get("smart_rules_json")
    )
    if parameters.get("smart_rules") is not None and mode != "smart":
        raise DiagnosticError(
            "INVALID_ARGUMENT", "Smart rules require smart generation mode"
        )
    if parameters.get("track_uids") is not None and mode == "smart":
        raise DiagnosticError(
            "INVALID_ARGUMENT", "Smart selection comes from rules and overrides"
        )
    if kind == "regenerate" and mode != "smart":
        raise DiagnosticError("INVALID_ARGUMENT", "Only smart playlists can regenerate")
    if mode == "smart" and kind not in {"visibility", "refresh_policy"}:
        if not isinstance(rules, dict) or not rules:
            raise DiagnosticError(
                "INVALID_ARGUMENT", "Smart playlist rules are required"
            )
        validate_smart_rules(rules)
        if int(rules.get("limit", 50)) > 100:
            raise DiagnosticError(
                "LIMIT_EXCEEDED", "Editorial plans support at most 100 tracks"
            )
    name = parameters.get("name") or original.get("name")
    description = parameters.get("description")
    if description is None:
        description = original.get("description") or ""
    exclusions = set(parameters.get("exclude_track_uids") or [])
    existing_exclusions = (
        {item["track_uid"] for item in source_state["exclusions"] if item["track_uid"]}
        if state
        else set()
    )
    if state and len(state["exclusions"]) > 100:
        raise DiagnosticError(
            "LIMIT_EXCEEDED", "Editorial plan cannot review more than 100 exclusions"
        )
    new_exclusions = sorted(exclusions - existing_exclusions)
    resolved_exclusions = resolve_track_uids(new_exclusions)
    if len(resolved_exclusions) != len(new_exclusions):
        raise DiagnosticError("INVALID_ARGUMENT", "An excluded track is unavailable")
    requested_exclusions = [
        *resolved_exclusions.values(),
        *[
            item
            for item in source_state["exclusions"]
            if item.get("track_uid") in exclusions
        ],
    ]
    if kind in {"visibility", "refresh_policy"}:
        selection = []
    elif kind == "refine":
        selection = [
            item
            for item in _existing_selection(source_state["tracks"])
            if not any(
                _track_identities_match(item, excluded)
                for excluded in requested_exclusions
            )
        ]
    elif kind == "duplicate":
        selection = _existing_selection(source_state["tracks"], duplicate=True)
    elif mode == "smart":
        if not isinstance(rules, dict):
            raise DiagnosticError(
                "INVALID_ARGUMENT", "Smart playlist rules are required"
            )
        candidates = execute_smart_rules(rules)
        if isinstance(candidates, int):
            candidates = []
        if any(not item.get("entity_uid") for item in candidates):
            raise DiagnosticError(
                "INVALID_ARGUMENT", "Smart rules selected a track without a local UID"
            )
        candidate_uids = [
            str(item["entity_uid"]) for item in candidates if item.get("entity_uid")
        ]
        generated = _resolved_selection(
            candidate_uids, source="generated", locked=False
        )
        preserved = (
            _existing_selection(
                [
                    row
                    for row in source_state["tracks"]
                    if row["source"] != "generated" or row["locked"]
                ]
            )
            if state and kind != "create"
            else []
        )
        if any(
            _track_identities_match(row, excluded)
            for row in preserved
            for excluded in requested_exclusions
        ):
            raise DiagnosticError(
                "INVALID_ARGUMENT", "A locked or manual track cannot be excluded"
            )
        blocked = [*source_state["exclusions"], *requested_exclusions, *preserved]
        generated = [
            row
            for row in generated
            if not any(_track_identities_match(row, existing) for existing in blocked)
        ]
        selection = _merge_preserved_and_generated(
            preserved,
            generated,
            target_count=max(len(preserved), int(rules.get("limit", 50))),
        )
    elif parameters.get("track_uids") is not None:
        selection = _resolved_selection(parameters["track_uids"])
        if state and kind != "duplicate":
            old_by_uid = {
                row["track_uid"]: row
                for row in _existing_selection(state["tracks"])
                if row.get("track_uid")
            }
            selection = [
                {
                    **item,
                    **{
                        key: old_by_uid[item["track_uid"]][key]
                        for key in ("row_id", "source", "locked")
                    },
                }
                if item["track_uid"] in old_by_uid
                else item
                for item in selection
            ]
    else:
        selection = _existing_selection(state["tracks"]) if state else []
    if state and kind not in {"visibility", "refresh_policy", "duplicate"}:
        retained = {item.get("row_id") for item in selection}
        if any(
            row["row_id"] not in retained
            for row in state["tracks"]
            if row["locked"] or row["source"] == "manual"
        ):
            raise DiagnosticError(
                "INVALID_ARGUMENT", "Manual and locked playlist rows must be retained"
            )
    if len(selection) > 100 or len(
        {item.get("track_uid") for item in selection if item.get("track_uid")}
    ) != len([item for item in selection if item.get("track_uid")]):
        raise DiagnosticError(
            "LIMIT_EXCEEDED", "Selection is too large or has duplicate track UIDs"
        )
    for index, item in enumerate(selection, 1):
        item["position"] = index
    if new_exclusions:
        if any(
            _track_identities_match(item, excluded)
            for item in selection
            for excluded in requested_exclusions
        ):
            raise DiagnosticError(
                "INVALID_ARGUMENT", "An excluded track remains selected"
            )
    execution = {
        "kind": kind,
        "playlist_id": None
        if kind in {"create", "duplicate"}
        else parameters.get("playlist_id"),
        "source_playlist_id": parameters.get("playlist_id")
        if kind == "duplicate"
        else None,
        "revision": original.get("editorial_revision"),
        "epoch": original.get("generation_epoch"),
        "state_hash": state["state_hash"] if state else None,
        "name": name,
        "description": description,
        "generation_mode": mode,
        "smart_rules": rules if mode == "smart" else None,
        "selection": selection,
        "new_exclusions": new_exclusions,
        "new_exclusion_fingerprints": {
            uid: resolved_exclusions[uid]["fingerprint"] for uid in new_exclusions
        },
        "copied_exclusions": source_state["exclusions"] if kind == "duplicate" else [],
        "is_active": True
        if kind in {"create", "duplicate"}
        else parameters.get("is_active", original.get("is_active")),
        "auto_refresh_enabled": parameters.get("auto_refresh_enabled"),
        "managed_by_user_id": getattr(principal, "actor_user_id", None),
        "actor_principal_id": principal.id,
    }
    planned_refresh = (
        bool(parameters["auto_refresh_enabled"])
        if kind == "refresh_policy"
        else False
        if kind in {"create", "duplicate"}
        or mode == "static"
        or original.get("generation_mode") == "static"
        else bool(original.get("auto_refresh_enabled"))
    )
    execution["planned_auto_refresh_enabled"] = planned_refresh
    if kind == "duplicate":
        # The source remains a CAS precondition even though the destination is new.
        execution["playlist_id"] = None
    target_name = (
        str(parameters["playlist_id"])
        if parameters.get("playlist_id")
        else "create:" + str(principal.id)[:32]
    )
    document = {
        "operation": "editorial_change",
        "kind": kind,
        "targets": [{"entity_type": "playlist", "name": target_name}],
        "changes": [
            {
                "field": "playlist",
                "targets": [{"entity_type": "playlist", "name": target_name}],
                "kind": kind,
                "name": name,
                "track_count": len(selection)
                if kind not in {"visibility", "refresh_policy"}
                else len(source_state["tracks"]),
                "description": description,
                "generation_mode": mode,
                "scope": original.get("scope", "system"),
                "visibility": original.get("visibility", "public")
                if kind not in {"create", "duplicate"}
                else "public",
                "is_active_before": original.get("is_active"),
                "is_active_after": execution["is_active"],
                "auto_refresh_before": original.get("auto_refresh_enabled"),
                "auto_refresh_after": planned_refresh,
            }
        ],
        "metadata": {
            "name": name,
            "description": description,
            "scope": original.get("scope", "system"),
            "visibility": original.get("visibility", "public")
            if kind not in {"create", "duplicate"}
            else "public",
            "generation_mode": mode,
            "is_active": execution["is_active"],
            "auto_refresh_enabled": planned_refresh,
        },
        "selection": [
            {
                key: item.get(key)
                for key in (
                    "row_id",
                    "track_uid",
                    "global_track_uid",
                    "title",
                    "artist",
                    "album",
                    "duration",
                    "position",
                    "source",
                    "locked",
                )
            }
            for item in selection
        ],
        "new_exclusions": new_exclusions,
        "existing_exclusions": [
            {"track_uid": row["track_uid"], "global_track_uid": row["global_track_uid"]}
            for row in source_state["exclusions"]
        ]
        if state
        else [],
        "copied_exclusions": [
            {"track_uid": row["track_uid"], "global_track_uid": row["global_track_uid"]}
            for row in source_state["exclusions"]
        ]
        if kind == "duplicate"
        else [],
        "smart_rules": rules if mode == "smart" else None,
        "source_revision": original.get("editorial_revision"),
        "generation_epoch": original.get("generation_epoch"),
        "impact": {
            "playlist_count": 1,
            "track_count": len(selection)
            if kind not in {"visibility", "refresh_policy"}
            else len(source_state["tracks"]),
            "duration_seconds": sum(
                float(item.get("duration") or 0) for item in selection
            ),
            "public_discovery": execution["is_active"],
            "notifications": False,
            "future_refresh_notifications": mode == "smart" and planned_refresh,
        },
        "risk": "high",
        "reversibility": "A later editorial plan can restore metadata and order; exclusions persist until explicitly reviewed.",
        "provenance": {
            "source": "local_library",
            "actor_principal_id": principal.id,
            "prepared_by": "crate_worker",
        },
    }
    return {"document": document, "execution": execution}


def apply_operation(
    operation: str, execution: dict, config: dict, *, task_id: str, authorize
) -> dict:
    if operation != "editorial_change":
        raise DiagnosticError("INVALID_ARGUMENT", "Unsupported editorial operation")
    applied = authorize(lambda: apply_editorial_execution(execution))
    return {
        "execution": {
            "status": "completed",
            **applied,
            "listen_url": public_share_url(
                f"/curation/playlist/{applied['playlist_id']}"
            )
            if applied["is_active"]
            else None,
        },
        "verification": {"status": "passed", "track_count": applied["track_count"]},
        "projection": {"status": "queued_by_domain_event"},
    }


__all__ = [
    "editorial_playlists_list",
    "editorial_playlist_get",
    "editorial_options",
    "editorial_candidates_search",
    "editorial_plan_prepare",
    "editorial_plan_get",
    "editorial_plan_validate",
    "editorial_plan_apply",
    "editorial_publication_set",
    "compile_operation",
    "apply_operation",
]
