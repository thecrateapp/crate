from __future__ import annotations

from datetime import UTC, datetime
import json
from typing import Any
import uuid

from sqlalchemy import text

from crate.db.tx import transaction_scope


def upsert_translation_request(
    *,
    app: str,
    locale: str,
    source_version: str,
    client: str | None,
    reason: str,
) -> dict[str, Any]:
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO i18n_translation_requests (
                        id,
                        app,
                        locale,
                        source_version,
                        client,
                        reason,
                        status,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        :id,
                        :app,
                        :locale,
                        :source_version,
                        :client,
                        :reason,
                        'pending',
                        NOW(),
                        NOW()
                    )
                    ON CONFLICT (app, locale, source_version)
                    DO UPDATE SET
                        client = EXCLUDED.client,
                        reason = EXCLUDED.reason,
                        updated_at = NOW()
                    RETURNING
                        id,
                        app,
                        locale,
                        source_version,
                        client,
                        reason,
                        status,
                        created_at,
                        updated_at
                    """
                ),
                {
                    "id": uuid.uuid4(),
                    "app": app,
                    "locale": locale,
                    "source_version": source_version,
                    "client": client,
                    "reason": reason,
                },
            )
            .mappings()
            .one()
        )
    return dict(row)


def update_translation_request_status(
    *,
    app: str,
    locale: str,
    source_version: str,
    status: str,
    task_id: str | None = None,
) -> dict[str, Any] | None:
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    UPDATE i18n_translation_requests
                    SET
                        status = :status,
                        task_id = COALESCE(:task_id, task_id),
                        updated_at = NOW()
                    WHERE app = :app
                      AND locale = :locale
                      AND source_version = :source_version
                    RETURNING
                        id,
                        app,
                        locale,
                        source_version,
                        client,
                        reason,
                        status,
                        task_id,
                        created_at,
                        updated_at
                    """
                ),
                {
                    "app": app,
                    "locale": locale,
                    "source_version": source_version,
                    "status": status,
                    "task_id": task_id,
                },
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None


def insert_translation_bundle_draft(
    *,
    app: str,
    locale: str,
    source_locale: str,
    source_version: str,
    messages: dict[str, str],
    bundle_version: str | None = None,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    version = bundle_version or f"{now:%Y.%m.%d}.{uuid.uuid4().hex[:8]}"
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO i18n_bundles (
                        id,
                        app,
                        locale,
                        source_locale,
                        source_version,
                        bundle_version,
                        status,
                        messages_json,
                        created_at,
                        published_at
                    )
                    VALUES (
                        :id,
                        :app,
                        :locale,
                        :source_locale,
                        :source_version,
                        :bundle_version,
                        'needs_review',
                        CAST(:messages_json AS JSONB),
                        NOW(),
                        NULL
                    )
                    RETURNING
                        id,
                        app,
                        locale,
                        source_locale,
                        source_version,
                        bundle_version,
                        status,
                        messages_json,
                        created_at,
                        published_at
                    """
                ),
                {
                    "id": uuid.uuid4(),
                    "app": app,
                    "locale": locale,
                    "source_locale": source_locale,
                    "source_version": source_version,
                    "bundle_version": version,
                    "messages_json": json.dumps(messages),
                },
            )
            .mappings()
            .one()
        )
    return dict(row)


def update_translation_bundle_message(
    *, bundle_id: str, key: str, value: str
) -> dict[str, Any] | None:
    with transaction_scope() as session:
        target = (
            session.execute(
                text(
                    """
                    SELECT messages_json
                    FROM i18n_bundles
                    WHERE id = CAST(:bundle_id AS UUID)
                    FOR UPDATE
                    """
                ),
                {"bundle_id": bundle_id},
            )
            .mappings()
            .first()
        )
        if target is None:
            return None

        messages = dict(target["messages_json"] or {})
        messages[key] = value
        row = (
            session.execute(
                text(
                    """
                    UPDATE i18n_bundles
                    SET messages_json = CAST(:messages_json AS JSONB)
                    WHERE id = CAST(:bundle_id AS UUID)
                    RETURNING
                        id,
                        app,
                        locale,
                        source_locale,
                        source_version,
                        bundle_version,
                        status,
                        messages_json,
                        created_at,
                        published_at
                    """
                ),
                {
                    "bundle_id": bundle_id,
                    "messages_json": json.dumps(messages),
                },
            )
            .mappings()
            .one()
        )
    return dict(row)


def publish_translation_bundle(bundle_id: str) -> dict[str, Any] | None:
    with transaction_scope() as session:
        target = (
            session.execute(
                text(
                    """
                    SELECT id, app, locale, source_version
                    FROM i18n_bundles
                    WHERE id = CAST(:bundle_id AS UUID)
                    FOR UPDATE
                    """
                ),
                {"bundle_id": bundle_id},
            )
            .mappings()
            .first()
        )
        if target is None:
            return None

        session.execute(
            text(
                """
                UPDATE i18n_bundles
                SET status = 'superseded'
                WHERE app = :app
                  AND locale = :locale
                  AND source_version = :source_version
                  AND status = 'published'
                  AND id <> :id
                """
            ),
            {
                "app": target["app"],
                "locale": target["locale"],
                "source_version": target["source_version"],
                "id": target["id"],
            },
        )
        row = (
            session.execute(
                text(
                    """
                    UPDATE i18n_bundles
                    SET status = 'published',
                        published_at = NOW()
                    WHERE id = :id
                    RETURNING
                        id,
                        app,
                        locale,
                        source_locale,
                        source_version,
                        bundle_version,
                        status,
                        messages_json,
                        created_at,
                        published_at
                    """
                ),
                {"id": target["id"]},
            )
            .mappings()
            .one()
        )
    return dict(row)


def reject_translation_bundle(bundle_id: str) -> dict[str, Any] | None:
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    UPDATE i18n_bundles
                    SET status = 'rejected',
                        published_at = NULL
                    WHERE id = CAST(:bundle_id AS UUID)
                    RETURNING
                        id,
                        app,
                        locale,
                        source_locale,
                        source_version,
                        bundle_version,
                        status,
                        messages_json,
                        created_at,
                        published_at
                    """
                ),
                {"bundle_id": bundle_id},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None
