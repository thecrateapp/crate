from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import random
import uuid

from sqlalchemy import text

from crate.db.tx import read_scope, transaction_scope


def create_subscription(
    *,
    url: str,
    trusted_keys: list[dict],
    refresh_interval_seconds: int = 3600,
    created_by: int | None = None,
) -> dict:
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO federation_directory_subscriptions (
                        subscription_uid, url, trusted_keys_json,
                        refresh_interval_seconds, created_by
                    ) VALUES (
                        CAST(:uid AS uuid), :url, CAST(:keys AS jsonb),
                        :interval, :created_by
                    )
                    RETURNING *
                    """
                ),
                {
                    "uid": str(uuid.uuid4()),
                    "url": url,
                    "keys": json.dumps(trusted_keys),
                    "interval": refresh_interval_seconds,
                    "created_by": created_by,
                },
            )
            .mappings()
            .one()
        )
        return dict(row)


def get_subscription(subscription_uid: str) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT * FROM federation_directory_subscriptions
                    WHERE subscription_uid = CAST(:uid AS uuid)
                    """
                ),
                {"uid": subscription_uid},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def list_subscriptions(*, include_candidates: bool = True) -> list[dict]:
    with read_scope() as session:
        subscriptions = [
            dict(row)
            for row in session.execute(
                text(
                    """
                    SELECT subscription.*,
                           COUNT(candidate.id)::INTEGER AS candidate_count,
                           COUNT(candidate.id) FILTER (
                               WHERE candidate.state = 'stale'
                           )::INTEGER AS stale_candidate_count
                    FROM federation_directory_subscriptions subscription
                    LEFT JOIN federation_directory_candidates candidate
                      ON candidate.subscription_id = subscription.id
                    GROUP BY subscription.id
                    ORDER BY subscription.created_at ASC
                    """
                )
            )
            .mappings()
            .all()
        ]
        if not include_candidates:
            return subscriptions
        for subscription in subscriptions:
            subscription["candidates"] = [
                dict(row)
                for row in session.execute(
                    text(
                        """
                        SELECT candidate.*,
                               peer.trust_state AS peer_trust_state,
                               peer.api_base_url AS peer_api_base_url,
                               peer.active_key_id AS peer_active_key_id
                        FROM federation_directory_candidates candidate
                        LEFT JOIN federation_nodes peer
                          ON peer.node_uid = candidate.node_uid
                        WHERE candidate.subscription_id = :subscription_id
                        ORDER BY candidate.state, candidate.display_name NULLS LAST,
                                 candidate.node_uid
                        """
                    ),
                    {"subscription_id": subscription["id"]},
                )
                .mappings()
                .all()
            ]
        return subscriptions


def get_candidate(candidate_id: int) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT candidate.*, subscription.subscription_uid,
                           peer.trust_state AS peer_trust_state
                    FROM federation_directory_candidates candidate
                    JOIN federation_directory_subscriptions subscription
                      ON subscription.id = candidate.subscription_id
                    LEFT JOIN federation_nodes peer
                      ON peer.node_uid = candidate.node_uid
                    WHERE candidate.id = :candidate_id
                    """
                ),
                {"candidate_id": candidate_id},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def list_due_subscriptions(limit: int = 50) -> list[dict]:
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT *
                FROM federation_directory_subscriptions subscription
                WHERE subscription.state IN ('active', 'error')
                  AND (subscription.retry_after IS NULL OR subscription.retry_after <= NOW())
                  AND (
                      subscription.last_attempt_at IS NULL
                      OR subscription.last_attempt_at
                         + subscription.refresh_interval_seconds * INTERVAL '1 second'
                         <= NOW()
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM federation_directory_refresh_runs run
                      WHERE run.subscription_id = subscription.id
                        AND run.status = 'running'
                  )
                ORDER BY subscription.last_attempt_at ASC NULLS FIRST
                LIMIT :limit
                """
            ),
            {"limit": limit},
        ).mappings()
        return [dict(row) for row in rows]


def set_subscription_state(subscription_uid: str, state: str) -> dict | None:
    if state not in {"active", "paused"}:
        raise ValueError("Invalid directory subscription state")
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    UPDATE federation_directory_subscriptions
                    SET state = :state,
                        retry_after = CASE WHEN :state = 'active' THEN NULL ELSE retry_after END,
                        updated_at = NOW()
                    WHERE subscription_uid = CAST(:uid AS uuid)
                    RETURNING *
                    """
                ),
                {"uid": subscription_uid, "state": state},
            )
            .mappings()
            .first()
        )
        return dict(row) if row else None


def delete_subscription(subscription_uid: str) -> bool:
    with transaction_scope() as session:
        deleted = session.execute(
            text(
                """
                DELETE FROM federation_directory_subscriptions
                WHERE subscription_uid = CAST(:uid AS uuid)
                RETURNING id
                """
            ),
            {"uid": subscription_uid},
        ).scalar_one_or_none()
        return deleted is not None


def claim_refresh(subscription_id: int) -> dict | None:
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO federation_directory_refresh_runs (
                        run_uid, subscription_id
                    )
                    SELECT CAST(:run_uid AS uuid), subscription.id
                    FROM federation_directory_subscriptions subscription
                    WHERE subscription.id = :subscription_id
                      AND subscription.state IN ('active', 'error')
                    ON CONFLICT (subscription_id) WHERE status = 'running'
                    DO NOTHING
                    RETURNING *
                    """
                ),
                {
                    "run_uid": str(uuid.uuid4()),
                    "subscription_id": subscription_id,
                },
            )
            .mappings()
            .first()
        )
        if row is not None:
            session.execute(
                text(
                    """
                    UPDATE federation_directory_subscriptions
                    SET last_attempt_at = NOW(), updated_at = NOW()
                    WHERE id = :subscription_id
                    """
                ),
                {"subscription_id": subscription_id},
            )
        return dict(row) if row else None


def finish_refresh(
    run_uid: str,
    *,
    status: str,
    http_status: int | None = None,
    signing_key_id: str | None = None,
    candidates_seen: int = 0,
    candidates_changed: int = 0,
    etag: str | None = None,
    last_modified: str | None = None,
    error_code: str | None = None,
    error_detail: str | None = None,
) -> None:
    if status not in {"succeeded", "not_modified", "failed"}:
        raise ValueError("Invalid directory refresh status")
    with transaction_scope() as session:
        run = (
            session.execute(
                text(
                    """
                    UPDATE federation_directory_refresh_runs
                    SET status = :status,
                        http_status = :http_status,
                        signing_key_id = :signing_key_id,
                        candidates_seen = :candidates_seen,
                        candidates_changed = :candidates_changed,
                        error_code = :error_code,
                        error_detail = :error_detail,
                        completed_at = NOW()
                    WHERE run_uid = CAST(:run_uid AS uuid)
                      AND status = 'running'
                    RETURNING subscription_id
                    """
                ),
                {
                    "run_uid": run_uid,
                    "status": status,
                    "http_status": http_status,
                    "signing_key_id": signing_key_id,
                    "candidates_seen": candidates_seen,
                    "candidates_changed": candidates_changed,
                    "error_code": error_code,
                    "error_detail": (error_detail or "")[:1000] or None,
                },
            )
            .mappings()
            .first()
        )
        if run is None:
            return
        subscription_id = run["subscription_id"]
        if status in {"succeeded", "not_modified"}:
            session.execute(
                text(
                    """
                    UPDATE federation_directory_subscriptions
                    SET state = 'active',
                        etag = COALESCE(:etag, etag),
                        last_modified = COALESCE(:last_modified, last_modified),
                        consecutive_failures = 0,
                        retry_after = NULL,
                        last_success_at = NOW(),
                        last_error_code = NULL,
                        last_error_detail = NULL,
                        updated_at = NOW()
                    WHERE id = :subscription_id
                    """
                ),
                {
                    "subscription_id": subscription_id,
                    "etag": etag,
                    "last_modified": last_modified,
                },
            )
            return

        failures = (
            session.execute(
                text(
                    """
                SELECT consecutive_failures, refresh_interval_seconds
                FROM federation_directory_subscriptions
                WHERE id = :subscription_id
                """
                ),
                {"subscription_id": subscription_id},
            )
            .mappings()
            .one()
        )
        next_failures = int(failures["consecutive_failures"]) + 1
        base = int(failures["refresh_interval_seconds"])
        delay = min(21600, base * (2 ** min(next_failures - 1, 5)))
        retry_after = datetime.now(timezone.utc) + timedelta(
            seconds=delay + random.uniform(0, min(60, delay * 0.1))
        )
        session.execute(
            text(
                """
                UPDATE federation_directory_subscriptions
                SET state = 'error',
                    consecutive_failures = :failures,
                    retry_after = :retry_after,
                    last_error_code = :error_code,
                    last_error_detail = :error_detail,
                    updated_at = NOW()
                WHERE id = :subscription_id
                """
            ),
            {
                "subscription_id": subscription_id,
                "failures": next_failures,
                "retry_after": retry_after,
                "error_code": error_code,
                "error_detail": (error_detail or "")[:1000] or None,
            },
        )


def upsert_candidate(
    *,
    subscription_id: int,
    node_uid: str,
    descriptor_url: str,
    descriptor_digest: str,
    display_name: str | None,
    advertised_key_id: str | None,
    metadata: dict | None = None,
) -> dict:
    with transaction_scope() as session:
        candidate_metadata = dict(metadata or {})
        advertised_api_base_url = candidate_metadata.get("api_base_url")
        peer = (
            session.execute(
                text(
                    """
                    SELECT trust_state, api_base_url, active_key_id
                    FROM federation_nodes
                    WHERE node_uid = CAST(:node_uid AS uuid)
                    """
                ),
                {"node_uid": node_uid},
            )
            .mappings()
            .first()
        )
        existing = (
            session.execute(
                text(
                    """
                    SELECT * FROM federation_directory_candidates
                    WHERE subscription_id = :subscription_id
                      AND node_uid = CAST(:node_uid AS uuid)
                    """
                ),
                {"subscription_id": subscription_id, "node_uid": node_uid},
            )
            .mappings()
            .first()
        )
        changed = bool(
            existing
            and (
                existing["descriptor_url"] != descriptor_url
                or existing["descriptor_digest"] != descriptor_digest
                or existing["advertised_key_id"] != advertised_key_id
            )
        )
        if peer and peer["trust_state"] == "approved":
            changed = (
                changed
                or peer["active_key_id"] != advertised_key_id
                or (
                    bool(advertised_api_base_url)
                    and peer["api_base_url"] != advertised_api_base_url
                )
            )
        state = "changed" if changed else "pending"
        if existing and existing["state"] == "ignored":
            state = "ignored"
        if peer and peer["trust_state"] == "approved" and changed:
            candidate_metadata["approved_peer_diff"] = {
                "api_base_url": {
                    "current": peer["api_base_url"],
                    "advertised": advertised_api_base_url,
                },
                "active_key_id": {
                    "current": peer["active_key_id"],
                    "advertised": advertised_key_id,
                },
            }
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO federation_directory_candidates (
                        subscription_id, node_uid, descriptor_url,
                        descriptor_digest, display_name, advertised_key_id,
                        state, metadata_json
                    ) VALUES (
                        :subscription_id, CAST(:node_uid AS uuid), :descriptor_url,
                        :descriptor_digest, :display_name, :advertised_key_id,
                        :state, CAST(:metadata AS jsonb)
                    )
                    ON CONFLICT (subscription_id, node_uid) DO UPDATE SET
                        descriptor_url = EXCLUDED.descriptor_url,
                        descriptor_digest = EXCLUDED.descriptor_digest,
                        display_name = EXCLUDED.display_name,
                        advertised_key_id = EXCLUDED.advertised_key_id,
                        state = EXCLUDED.state,
                        metadata_json = EXCLUDED.metadata_json,
                        last_seen_at = NOW(),
                        stale_at = NULL
                    RETURNING *
                    """
                ),
                {
                    "subscription_id": subscription_id,
                    "node_uid": node_uid,
                    "descriptor_url": descriptor_url,
                    "descriptor_digest": descriptor_digest,
                    "display_name": display_name,
                    "advertised_key_id": advertised_key_id,
                    "state": state,
                    "metadata": json.dumps(candidate_metadata),
                },
            )
            .mappings()
            .one()
        )
        return dict(row)


def mark_unseen_candidates_stale(
    subscription_id: int, seen_node_uids: list[str]
) -> int:
    with transaction_scope() as session:
        result = session.execute(
            text(
                """
                UPDATE federation_directory_candidates
                SET state = 'stale', stale_at = NOW()
                WHERE subscription_id = :subscription_id
                  AND state <> 'ignored'
                  AND NOT (node_uid = ANY(CAST(:seen AS uuid[])))
                """
            ),
            {"subscription_id": subscription_id, "seen": seen_node_uids},
        )
        return int(getattr(result, "rowcount", 0) or 0)
