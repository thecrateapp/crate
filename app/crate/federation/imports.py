"""Federated import — explicit local availability of remote content.

Import is separate from playback and must be explicitly triggered. Uses the
existing worker import path. Records provenance including remote node and
approving user.

Phase 5: import policy, request approval, provenance, worker staging.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

from crate.db.tx import transaction_scope, read_scope
from crate.federation.grants import preset_allows

log = logging.getLogger(__name__)


# ── Import request ────────────────────────────────────────────────────────


def create_import_request(
    node_uid: str,
    remote_entity_uid: str,
    entity_type: str,
    title: str,
    requested_by_user_id: int | None = None,
    metadata: dict | None = None,
    requires_approval: bool = True,
) -> dict:
    """Create an import request. If requires_approval is True, admin approval needed."""
    from sqlalchemy import text

    request_id = str(uuid.uuid4())
    status = "pending_approval" if requires_approval else "approved"

    with transaction_scope() as s:
        s.execute(
            text(
                """
                INSERT INTO federation_import_requests
                    (request_id, node_uid, remote_entity_uid, entity_type,
                     title, status, requested_by_user_id, metadata_json)
                VALUES
                    (:rid, :nid, :reid, :etype, :title, :status, :uid, :meta)
                """
            ),
            {
                "rid": request_id,
                "nid": node_uid,
                "reid": remote_entity_uid,
                "etype": entity_type,
                "title": title,
                "status": status,
                "uid": requested_by_user_id,
                "meta": json.dumps(metadata or {}),
            },
        )

        row = (
            s.execute(
                text(
                    "SELECT * FROM federation_import_requests WHERE request_id = :rid"
                ),
                {"rid": request_id},
            )
            .mappings()
            .one()
        )
        return dict(row)


def get_import_request(request_id: str) -> dict | None:
    from sqlalchemy import text

    with read_scope() as s:
        row = (
            s.execute(
                text(
                    "SELECT * FROM federation_import_requests WHERE request_id = :rid"
                ),
                {"rid": request_id},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def list_import_requests(
    node_uid: str | None = None,
    status: str | None = None,
) -> list[dict]:
    from sqlalchemy import text

    with read_scope() as s:
        conditions = []
        params = {}
        if node_uid:
            conditions.append("node_uid = :nid")
            params["nid"] = node_uid
        if status:
            conditions.append("status = :status")
            params["status"] = status
        where = ""
        if conditions:
            where = "WHERE " + " AND ".join(conditions)

        rows = (
            s.execute(
                text(
                    f"SELECT * FROM federation_import_requests {where} "
                    "ORDER BY created_at DESC"
                ),
                params,
            )
            .mappings()
            .all()
        )
        return [dict(r) for r in rows]


def approve_import_request(request_id: str, approved_by_user_id: int) -> dict | None:
    from sqlalchemy import text

    now = datetime.now(timezone.utc)
    with transaction_scope() as s:
        s.execute(
            text(
                "UPDATE federation_import_requests SET "
                "status = 'approved', approved_by_user_id = :uid, "
                "approved_at = :now WHERE request_id = :rid"
            ),
            {"rid": request_id, "uid": approved_by_user_id, "now": now},
        )
        return get_import_request(request_id)


def update_import_request(
    request_id: str,
    *,
    status: str | None = None,
    metadata_patch: dict | None = None,
) -> dict | None:
    from sqlalchemy import text

    assignments = []
    params = {"rid": request_id}
    if status is not None:
        assignments.append("status = :status")
        params["status"] = status
    if metadata_patch:
        assignments.append("metadata_json = metadata_json || :metadata::jsonb")
        params["metadata"] = json.dumps(metadata_patch)
    if not assignments:
        return get_import_request(request_id)

    with transaction_scope() as s:
        s.execute(
            text(
                "UPDATE federation_import_requests SET "
                + ", ".join(assignments)
                + " WHERE request_id = :rid"
            ),
            params,
        )
        row = (
            s.execute(
                text(
                    "SELECT * FROM federation_import_requests WHERE request_id = :rid"
                ),
                {"rid": request_id},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def deny_import_request(request_id: str) -> dict | None:
    from sqlalchemy import text

    now = datetime.now(timezone.utc)
    with transaction_scope() as s:
        s.execute(
            text(
                "UPDATE federation_import_requests SET status = 'denied', "
                "denied_at = :now WHERE request_id = :rid"
            ),
            {"rid": request_id, "now": now},
        )
        return get_import_request(request_id)


# ── Import policy ─────────────────────────────────────────────────────────


def can_request_import(
    peer: dict,
) -> tuple[bool, str | None]:
    preset = peer.get("default_grant_preset", "discovery")
    if not preset_allows(preset, "import.request"):
        return False, "peer does not have import.request grant"
    return True, None


def record_import_provenance(
    album_id: int,
    node_uid: str,
    node_name: str,
    remote_entity_uid: str,
    imported_by_user_id: int | None = None,
) -> None:
    """Record provenance after a successful import on the import request."""
    from sqlalchemy import text

    provenance = {
        "source": "crate_federation",
        "remote_node_uid": node_uid,
        "remote_node_name": node_name,
        "remote_entity_uid": remote_entity_uid,
        "imported_by_user_id": imported_by_user_id,
        "local_album_id": album_id,
        "imported_at": datetime.now(timezone.utc).isoformat(),
    }

    with transaction_scope() as s:
        s.execute(
            text(
                "UPDATE federation_import_requests SET "
                "metadata_json = metadata_json || :prov::jsonb, "
                "status = 'completed' "
                "WHERE node_uid = :nid AND remote_entity_uid = :reid "
                "AND status IN ('approved', 'queued', 'importing')"
            ),
            {
                "prov": json.dumps({"provenance": provenance}),
                "nid": node_uid,
                "reid": remote_entity_uid,
            },
        )
