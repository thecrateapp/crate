from __future__ import annotations

from typing import Any

from sqlalchemy import text

from crate.db.tx import read_scope


def list_published_bundles(*, app: str, source_version: str) -> list[dict[str, Any]]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT DISTINCT ON (locale)
                        app,
                        locale,
                        source_locale,
                        source_version,
                        bundle_version,
                        published_at
                    FROM i18n_bundles
                    WHERE app = :app
                      AND source_version = :source_version
                      AND status = 'published'
                    ORDER BY locale, published_at DESC NULLS LAST, created_at DESC
                    """
                ),
                {"app": app, "source_version": source_version},
            )
            .mappings()
            .all()
        )
    return [dict(row) for row in rows]


def list_translation_requests(*, app: str) -> list[dict[str, Any]]:
    with read_scope() as session:
        rows = (
            session.execute(
                text(
                    """
                    SELECT
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
    return [dict(row) for row in rows]


def get_published_bundle(
    *, app: str, locale: str, source_version: str
) -> dict[str, Any] | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT
                        app,
                        locale,
                        source_locale,
                        source_version,
                        bundle_version,
                        messages_json
                    FROM i18n_bundles
                    WHERE app = :app
                      AND locale = :locale
                      AND source_version = :source_version
                      AND status = 'published'
                    ORDER BY published_at DESC NULLS LAST
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
    return dict(row) if row else None


def get_translation_bundle(bundle_id: str) -> dict[str, Any] | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    """
                    SELECT
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
                    FROM i18n_bundles
                    WHERE id = CAST(:bundle_id AS UUID)
                    """
                ),
                {"bundle_id": bundle_id},
            )
            .mappings()
            .first()
        )
    return dict(row) if row else None
