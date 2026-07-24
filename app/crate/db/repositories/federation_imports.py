"""Federated import — explicit local availability of remote content.

Import is separate from playback and must be explicitly triggered. Uses the
existing worker import path. Records provenance including remote node and
approving user.

Phase 5: import policy, request approval, provenance, worker staging.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from datetime import datetime, timezone

from crate.db.tx import read_scope, transaction_scope

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
    global_album_uid: str | None = None,
) -> dict:
    """Create an import request. If requires_approval is True, admin approval needed."""
    from sqlalchemy import text

    request_id = str(uuid.uuid4())
    status = "awaiting_approval" if requires_approval else "approved"
    idempotency_input = ":".join(
        (
            str(requested_by_user_id or "system"),
            str(global_album_uid or remote_entity_uid),
            str(node_uid),
        )
    )
    idempotency_key = hashlib.sha256(idempotency_input.encode()).hexdigest()

    with transaction_scope() as s:
        s.execute(
            text(
                """
                INSERT INTO federation_import_requests
                    (request_id, node_uid, remote_entity_uid, entity_type,
                     title, status, requested_by_user_id, metadata_json,
                     idempotency_key, global_album_uid, cleanup_deadline)
                VALUES
                    (:rid, :nid, :reid, :etype, :title, :status, :uid, :meta,
                     :idempotency_key, CAST(:global_album_uid AS uuid),
                     NOW() + INTERVAL '24 hours')
                ON CONFLICT (idempotency_key) DO UPDATE SET
                    updated_at = NOW()
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
                "idempotency_key": idempotency_key,
                "global_album_uid": global_album_uid,
            },
        )

        row = (
            s.execute(
                text(
                    "SELECT * FROM federation_import_requests "
                    "WHERE idempotency_key = :idempotency_key"
                ),
                {"idempotency_key": idempotency_key},
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
        row = (
            s.execute(
                text(
                    "UPDATE federation_import_requests SET "
                    "status = 'approved', approved_by_user_id = :uid, "
                    "approved_at = :now, approval_metadata = jsonb_build_object("
                    "'approved_by_user_id', :uid, 'approved_at', :now), "
                    "updated_at = :now WHERE request_id = :rid "
                    "AND status = 'awaiting_approval' RETURNING *"
                ),
                {"rid": request_id, "uid": approved_by_user_id, "now": now},
            )
            .mappings()
            .first()
        )
        transitioned = row is not None
        if row is None:
            row = (
                s.execute(
                    text(
                        "SELECT * FROM federation_import_requests "
                        "WHERE request_id = :rid"
                    ),
                    {"rid": request_id},
                )
                .mappings()
                .first()
            )
        if row is None:
            return None
        result = dict(row)
        result["_approval_transitioned"] = transitioned
        return result


def update_import_request(
    request_id: str,
    *,
    status: str | None = None,
    metadata_patch: dict | None = None,
    manifest_digest: str | None = None,
    received_bytes: int | None = None,
    staging_relative_path: str | None = None,
    failure_reason: str | None = None,
) -> dict | None:
    from sqlalchemy import text

    assignments = []
    params: dict[str, object] = {"rid": request_id}
    if status is not None:
        assignments.append("status = :status")
        params["status"] = status
    if metadata_patch:
        assignments.append("metadata_json = metadata_json || CAST(:metadata AS jsonb)")
        params["metadata"] = json.dumps(metadata_patch)
    if manifest_digest is not None:
        assignments.append("manifest_digest = :manifest_digest")
        params["manifest_digest"] = manifest_digest
    if received_bytes is not None:
        assignments.append("received_bytes = :received_bytes")
        params["received_bytes"] = max(0, int(received_bytes))
    if staging_relative_path is not None:
        assignments.append("staging_relative_path = :staging_relative_path")
        params["staging_relative_path"] = staging_relative_path
    if failure_reason is not None:
        assignments.append("failure_reason = :failure_reason")
        params["failure_reason"] = failure_reason[:4000]
    if status == "completed":
        assignments.append("completed_at = NOW()")
    active_states = {"reserving", "downloading", "verifying", "importing"}
    lease_seconds = max(
        300,
        int(os.environ.get("CRATE_FEDERATION_IMPORT_LEASE_SECONDS", "18000")),
    )
    if status in active_states:
        assignments.append(
            "cleanup_deadline = NOW() + (:lease_seconds * INTERVAL '1 second')"
        )
        params["lease_seconds"] = lease_seconds
    elif received_bytes is not None:
        assignments.append(
            "cleanup_deadline = CASE WHEN status IN "
            "('reserving', 'downloading', 'verifying', 'importing') "
            "THEN NOW() + (:lease_seconds * INTERVAL '1 second') "
            "ELSE cleanup_deadline END"
        )
        params["lease_seconds"] = lease_seconds
    if not assignments:
        return get_import_request(request_id)

    with transaction_scope() as s:
        s.execute(
            text(
                "UPDATE federation_import_requests SET updated_at = NOW(), "
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
        row = (
            s.execute(
                text(
                    "UPDATE federation_import_requests SET status = 'cancelled', "
                    "denied_at = :now, reserved_bytes = 0, updated_at = :now "
                    "WHERE request_id = :rid "
                    "AND status NOT IN ('completed', 'cleaned') RETURNING *"
                ),
                {"rid": request_id, "now": now},
            )
            .mappings()
            .first()
        )
        if row is not None:
            return dict(row)
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


def record_import_provenance(
    album_id: int | None,
    node_uid: str,
    node_name: str,
    remote_entity_uid: str,
    imported_by_user_id: int | None = None,
    request_id: str | None = None,
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
        if request_id:
            s.execute(
                text(
                    "UPDATE federation_import_requests SET "
                    "metadata_json = metadata_json || CAST(:prov AS jsonb), "
                    "updated_at = NOW() WHERE request_id = CAST(:rid AS uuid)"
                ),
                {
                    "prov": json.dumps({"provenance": provenance}),
                    "rid": request_id,
                },
            )
        else:
            s.execute(
                text(
                    "UPDATE federation_import_requests SET "
                    "metadata_json = metadata_json || CAST(:prov AS jsonb), "
                    "updated_at = NOW() "
                    "WHERE node_uid = :nid AND remote_entity_uid = :reid "
                    "AND status IN ('approved', 'importing')"
                ),
                {
                    "prov": json.dumps({"provenance": provenance}),
                    "nid": node_uid,
                    "reid": remote_entity_uid,
                },
            )

        if album_id:
            album = (
                s.execute(
                    text(
                        """
                        SELECT entity_uid::text AS entity_uid, updated_at
                        FROM library_albums
                        WHERE id = :album_id
                        """
                    ),
                    {"album_id": album_id},
                )
                .mappings()
                .first()
            )
            if album and album.get("entity_uid"):
                from crate.db.repositories.global_catalog_dirty_sources import (
                    enqueue_local_dirty_source,
                )

                enqueue_local_dirty_source(
                    "album",
                    str(album["entity_uid"]),
                    "upsert",
                    source_revision=(
                        album["updated_at"].isoformat()
                        if album.get("updated_at")
                        else None
                    ),
                    session=s,
                )
