from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope, transaction_scope


def _decode_messages(value: Any) -> dict[str, str]:
    if isinstance(value, dict):
        return {str(key): str(message) for key, message in value.items()}
    if isinstance(value, str):
        data = json.loads(value)
        if isinstance(data, dict):
            return {str(key): str(message) for key, message in data.items()}
    return {}


def _bundle_from_row(row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "app": row["app"],
        "locale": row["locale"],
        "sourceLocale": row["source_locale"],
        "sourceVersion": row["source_version"],
        "bundleVersion": row["bundle_version"],
        "status": row["status"],
        "messages": _decode_messages(row["messages_json"]),
        "createdAt": row["created_at"],
        "publishedAt": row["published_at"],
    }


def _request_from_row(row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "app": row["app"],
        "locale": row["locale"],
        "sourceVersion": row["source_version"],
        "client": row["client"],
        "reason": row["reason"],
        "status": row["status"],
        "taskId": str(row["task_id"]) if row["task_id"] else None,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def list_published_bundles(app: str, source_version: str) -> list[dict[str, Any]]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT DISTINCT ON (locale)
                      id, locale, bundle_version, published_at
                    FROM i18n_bundles
                    WHERE app = :app
                      AND source_version = :source_version
                      AND status = 'published'
                      AND published_at IS NOT NULL
                    ORDER BY locale, published_at DESC, created_at DESC
                    """
                ),
                {"app": app, "source_version": source_version},
            )
            .mappings()
            .all()
        )
    return [
        {
            "id": str(row["id"]),
            "locale": row["locale"],
            "bundleVersion": row["bundle_version"],
            "publishedAt": row["published_at"],
        }
        for row in rows
    ]


def get_published_bundle(
    app: str, locale: str, source_version: str
) -> dict[str, Any] | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT *
                    FROM i18n_bundles
                    WHERE app = :app
                      AND locale = :locale
                      AND source_version = :source_version
                      AND status = 'published'
                      AND published_at IS NOT NULL
                    ORDER BY published_at DESC, created_at DESC
                    LIMIT 1
                    """
                ),
                {
                    "app": app,
                    "locale": locale,
                    "source_version": source_version,
                },
            )
            .mappings()
            .first()
        )
    return _bundle_from_row(row) if row else None


def upsert_translation_request(
    *,
    app: str,
    locale: str,
    source_version: str,
    client: str | None,
    reason: str,
    status: str,
    task_id: str | None = None,
) -> tuple[dict[str, Any], bool]:
    request_id = str(uuid4())
    with transaction_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    INSERT INTO i18n_translation_requests (
                      id, app, locale, source_version, client, reason, status, task_id
                    )
                    VALUES (
                      :id, :app, :locale, :source_version,
                      :client, :reason, :status, CAST(:task_id AS uuid)
                    )
                    ON CONFLICT (app, locale, source_version) DO UPDATE SET
                      updated_at = i18n_translation_requests.updated_at
                    RETURNING *,
                      (xmax = 0) AS inserted
                    """
                ),
                {
                    "id": request_id,
                    "app": app,
                    "locale": locale,
                    "source_version": source_version,
                    "client": client,
                    "reason": reason,
                    "status": status,
                    "task_id": task_id,
                },
            )
            .mappings()
            .one()
        )
    return _request_from_row(row), bool(row["inserted"])


def list_translation_requests(app: str) -> list[dict[str, Any]]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT *
                    FROM i18n_translation_requests
                    WHERE app = :app
                    ORDER BY updated_at DESC, created_at DESC
                    """
                ),
                {"app": app},
            )
            .mappings()
            .all()
        )
    return [_request_from_row(row) for row in rows]


def get_bundle_for_review(app: str, bundle_id: str) -> dict[str, Any] | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT *
                    FROM i18n_bundles
                    WHERE app = :app AND id = CAST(:id AS uuid)
                    """
                ),
                {"app": app, "id": bundle_id},
            )
            .mappings()
            .first()
        )
    return _bundle_from_row(row) if row else None


def set_bundle_status(
    app: str,
    bundle_id: str,
    status: str,
    *,
    session: Session | None = None,
) -> dict[str, Any] | None:
    published_at_expr = "NOW()" if status == "published" else "NULL"

    def _impl(s: Session) -> dict[str, Any] | None:
        row = (
            s.execute(
                text(
                    f"""
                    UPDATE i18n_bundles
                    SET status = :status,
                        published_at = {published_at_expr}
                    WHERE app = :app AND id = CAST(:id AS uuid)
                    RETURNING *
                    """
                ),
                {"app": app, "id": bundle_id, "status": status},
            )
            .mappings()
            .first()
        )
        return _bundle_from_row(row) if row else None

    if session is not None:
        return _impl(session)
    with transaction_scope() as managed:
        return _impl(managed)
