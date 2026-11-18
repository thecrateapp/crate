"""Owner-side federation catalog summary reads."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from crate.db.tx import read_scope


def list_catalog_summary_heads(*, session: Session | None = None) -> list[dict]:
    """Return the identity of every summary: digest, contract, sequence, etag,
    and the format params a receiver validates (tokenizer, hash, min_prefix)."""

    def _impl(current: Session) -> list[dict]:
        rows = current.execute(
            text(
                """
                SELECT scope_digest, contract, source_sequence, etag,
                       params_json->>'tokenizer' AS tokenizer,
                       params_json->>'hash' AS hash,
                       params_json->'min_prefix' AS min_prefix
                FROM federation_catalog_summaries
                ORDER BY scope_digest
                """
            )
        ).mappings()
        return [dict(row) for row in rows]

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_catalog_summary(
    scope_digest: str, *, session: Session | None = None
) -> dict | None:
    """Return one scope's summary, with `bloom` as bytes, or None."""

    def _impl(current: Session) -> dict | None:
        row = (
            current.execute(
                text(
                    """
                    SELECT scope_digest, contract, params_json, bloom,
                           artist_album_counts_json, entry_count,
                           source_sequence, etag, built_at
                    FROM federation_catalog_summaries
                    WHERE scope_digest = :scope_digest
                    """
                ),
                {"scope_digest": scope_digest},
            )
            .mappings()
            .first()
        )
        if row is None:
            return None
        return {
            "scope_digest": row["scope_digest"],
            "contract": row["contract"],
            "params": row["params_json"],
            "bloom": bytes(row["bloom"]),
            "artist_album_counts": row["artist_album_counts_json"],
            "entry_count": row["entry_count"],
            "source_sequence": row["source_sequence"],
            "etag": row["etag"],
            "built_at": row["built_at"],
        }

    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = ["get_catalog_summary", "list_catalog_summary_heads"]
