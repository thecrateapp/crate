from __future__ import annotations

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
