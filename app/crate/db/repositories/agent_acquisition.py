"""Owned source receipts and at-most-once transfer admission for reviewed plans."""

import json
from uuid import uuid4

from sqlalchemy import text

from crate.agent_access import authorization_context
from crate.agent_diagnostics import DiagnosticError
from crate.db.repositories import agent_requests as requests
from crate.db.tx import optional_scope


def save_receipts(principal, sources, *, session=None):
    with optional_scope(session) as current:
        requests._authorize(current, principal, {"library.acquisition.search"})
        requests._lock_principal(current, principal.id)
        count = current.execute(
            text(
                "SELECT count(*) FROM agent_acquisition_receipts WHERE principal_id=:id AND created_at>NOW()-INTERVAL '1 day'"
            ),
            {"id": principal.id},
        ).scalar_one()
        if count + len(sources) > 100:
            raise DiagnosticError(
                "LIMIT_EXCEEDED", "Daily acquisition receipt limit reached"
            )
        result = []
        for source in sources:
            receipt_id = str(uuid4())
            times = (
                current.execute(
                    text("""INSERT INTO agent_acquisition_receipts
                (id,principal_id,authorization_context,source,source_hash)
                VALUES(:id,:owner,CAST(:context AS jsonb),CAST(:source AS jsonb),:hash) RETURNING created_at,expires_at"""),
                    {
                        "id": receipt_id,
                        "owner": principal.id,
                        "context": json.dumps(authorization_context(principal)),
                        "source": json.dumps(source),
                        "hash": requests._hash(source),
                    },
                )
                .mappings()
                .one()
            )
            result.append(
                {
                    "receipt_id": receipt_id,
                    "source": source,
                    "source_hash": requests._hash(source),
                    "observed_at": times["created_at"].isoformat(),
                    "expires_at": times["expires_at"].isoformat(),
                    "valid_for_seconds": 900,
                }
            )
        current.execute(
            text("""INSERT INTO audit_log(timestamp,action,target_type,target_name,details_json)
            VALUES(NOW(),'agent.acquisition.searched','agent_principal',:principal,CAST(:details AS jsonb))"""),
            {
                "principal": principal.id,
                "details": json.dumps(
                    {
                        "principal_id": principal.id,
                        "credential_id": principal.credential_id,
                        **authorization_context(principal),
                        "receipt_ids": [row["receipt_id"] for row in result],
                        "result_count": len(result),
                    }
                ),
            },
        )
        return result


def read_receipt(principal, receipt_id, *, session=None):
    with optional_scope(session) as current:
        requests._authorize(current, principal, {"library.acquisition.write"})
        row = (
            current.execute(
                text("""SELECT *,expires_at>NOW() AS unexpired FROM agent_acquisition_receipts
            WHERE id=:id AND principal_id=:owner"""),
                {"id": requests._uuid(receipt_id), "owner": principal.id},
            )
            .mappings()
            .first()
        )
        if row is None or row["authorization_context"] != authorization_context(
            principal
        ):
            raise DiagnosticError(
                "NOT_FOUND", "Owned acquisition receipt is unavailable"
            )
        if not row["unexpired"] or requests._hash(row["source"]) != row["source_hash"]:
            raise DiagnosticError(
                "EVIDENCE_STALE", "Acquisition source receipt expired or changed"
            )
        return dict(row)


def target_state(artist_uid, release, *, session=None):
    with optional_scope(session) as current:
        row = (
            current.execute(
                text("""SELECT a.entity_uid::text AS artist_uid,a.name,a.folder_name,
            EXISTS(SELECT 1 FROM library_albums b WHERE b.artist=a.name AND lower(b.name)=lower(:release)) AS already_present
            FROM library_artists a WHERE a.entity_uid=:uid"""),
                {"uid": requests._uuid(artist_uid), "release": release},
            )
            .mappings()
            .first()
        )
        if row is None:
            raise DiagnosticError("NOT_FOUND", "Target library artist is unavailable")
        if row["already_present"]:
            raise DiagnosticError(
                "ALREADY_EXISTS",
                "Release already exists; acquisition cannot upgrade it",
            )
        return dict(row)


def reserve_transfer(task_id, receipt_id, source_hash, evidence, *, session=None):
    """Commit uncertainty BEFORE sending the external transfer request, never clear it."""
    with optional_scope(session) as current:
        inserted = current.execute(
            text("""INSERT INTO agent_acquisition_transfers(source_hash,task_id,receipt_id,evidence)
            VALUES(:hash,:task,:receipt,CAST(:evidence AS jsonb)) ON CONFLICT DO NOTHING RETURNING source_hash"""),
            {
                "hash": source_hash,
                "task": task_id,
                "receipt": receipt_id,
                "evidence": json.dumps(evidence),
            },
        ).scalar_one_or_none()
        if inserted is None:
            raise DiagnosticError(
                "RECONCILIATION_REQUIRED",
                "This exact selection has a previous transfer attempt; inspect it without redownloading",
            )


def record_transfer(task_id, state, evidence, *, session=None):
    with optional_scope(session) as current:
        current.execute(
            text("""UPDATE agent_acquisition_transfers SET state=:state,evidence=CAST(:evidence AS jsonb),updated_at=NOW()
            WHERE task_id=:task"""),
            {"task": task_id, "state": state, "evidence": json.dumps(evidence)},
        )


__all__ = [
    "read_receipt",
    "record_transfer",
    "reserve_transfer",
    "save_receipts",
    "target_state",
]


def owned_transfer(principal, source_job_id, *, session=None):
    with optional_scope(session) as current:
        requests._authorize(current, principal, {"library.acquisition.write"})
        row = (
            current.execute(
                text("""SELECT t.*,r.principal_id,r.authorization_context
            FROM agent_acquisition_transfers t JOIN agent_acquisition_receipts r ON r.id=t.receipt_id
            WHERE t.task_id=:task AND r.principal_id=:owner"""),
                {"task": source_job_id, "owner": principal.id},
            )
            .mappings()
            .first()
        )
        if row is None or row["authorization_context"] != authorization_context(
            principal
        ):
            raise DiagnosticError(
                "NOT_FOUND", "Owned acquisition transfer is unavailable"
            )
        return {"state": row["state"], "evidence": dict(row["evidence"])}


def publish_album(execution, publish_files, *, operator_task_id=None, session=None):
    """Serialize target identity, refuse merges, publish exact files, then index them."""
    from crate.db.domain_events import append_domain_event
    from crate.db.repositories.library_album_upserts import upsert_album
    from crate.db.repositories.library_track_upserts import upsert_track

    with optional_scope(session) as current:
        target = execution["target"]
        current.execute(
            text("SELECT name FROM library_artists WHERE entity_uid=:uid FOR UPDATE"),
            {"uid": target["artist_uid"]},
        ).scalar_one()
        if (
            target_state(
                target["artist_uid"], execution["album"]["name"], session=current
            )
            != target
        ):
            raise DiagnosticError(
                "EVIDENCE_STALE", "Target artist changed before publication"
            )
        album = execution["album"]
        tracks = execution["tracks"]
        occupied = current.execute(
            text("""SELECT EXISTS(SELECT 1 FROM library_albums WHERE entity_uid=:uid OR path=:path)
            OR EXISTS(SELECT 1 FROM library_tracks WHERE entity_uid=ANY(CAST(:uids AS uuid[])) OR path=ANY(:paths))"""),
            {
                "uid": album["entity_uid"],
                "path": album["path"],
                "uids": [t["entity_uid"] for t in tracks],
                "paths": [t["path"] for t in tracks],
            },
        ).scalar_one()
        if occupied:
            raise DiagnosticError(
                "ALREADY_EXISTS",
                "Publication would overwrite an existing library identity",
            )
        publish_files()
        album_id = upsert_album(album, session=current)
        for track in tracks:
            upsert_track(
                {**track, "album_id": album_id},
                strict_identity=True,
                operator_task_id=operator_task_id,
                session=current,
            )
        current.execute(
            text("""UPDATE library_artists SET album_count=COALESCE(album_count,0)+1,
            track_count=COALESCE(track_count,0)+:tracks,total_size=COALESCE(total_size,0)+:size WHERE entity_uid=:uid"""),
            {
                "tracks": len(tracks),
                "size": album["total_size"],
                "uid": target["artist_uid"],
            },
        )
        append_domain_event(
            "library.acquisition.completed",
            {
                "source": "soulseek",
                "album_uid": album["entity_uid"],
                "artist_uid": target["artist_uid"],
                "source_job_id": execution["source_job_id"],
                "moved": len(tracks),
            },
            scope="library.acquisition",
            subject_key=target["artist_uid"],
            session=current,
        )
        actual = list(
            current.execute(
                text("SELECT entity_uid::text FROM library_tracks WHERE album_id=:id"),
                {"id": album_id},
            ).scalars()
        )
        if set(actual) != {t["entity_uid"] for t in tracks}:
            raise DiagnosticError(
                "SOURCE_CONFLICT", "Publication index verification failed"
            )
        return {
            "album_uid": album["entity_uid"],
            "tracks": len(actual),
            "status": "published",
        }


__all__ += ["owned_transfer", "publish_album"]


def authorize_search(principal, *, session=None):
    with optional_scope(session) as current:
        requests._authorize(current, principal, {"library.acquisition.search"})


def execution_receipt(task_id, receipt_id, *, session=None):
    with optional_scope(session) as current:
        job = requests._execution_job(current, task_id)
        return read_receipt(
            requests._principal_for_job(job), receipt_id, session=current
        )


__all__ += ["authorize_search", "execution_receipt"]
