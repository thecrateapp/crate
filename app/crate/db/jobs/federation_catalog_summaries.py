"""Owner-side federation catalog summary writes (worker only)."""

from __future__ import annotations

from typing import cast

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from crate.db.tx import optional_scope

_UPSERT_SQL = text(
    """
    INSERT INTO federation_catalog_summaries
        (scope_digest, contract, params_json, bloom, artist_album_counts_json,
         entry_count, source_sequence, etag, built_at)
    VALUES
        (:scope_digest, :contract, :params_json, :bloom, :artist_album_counts_json,
         :entry_count, :source_sequence, :etag, NOW())
    ON CONFLICT (scope_digest) DO UPDATE SET
        contract = EXCLUDED.contract,
        params_json = EXCLUDED.params_json,
        bloom = EXCLUDED.bloom,
        artist_album_counts_json = EXCLUDED.artist_album_counts_json,
        entry_count = EXCLUDED.entry_count,
        source_sequence = EXCLUDED.source_sequence,
        etag = EXCLUDED.etag,
        built_at = NOW()
    """
).bindparams(
    bindparam("params_json", type_=JSONB),
    bindparam("artist_album_counts_json", type_=JSONB),
)


def upsert_catalog_summary(summary: dict, *, session: Session | None = None) -> None:
    """Insert or refresh the summary of one scope, keyed on `scope_digest`."""

    values = {
        "scope_digest": summary["scope_digest"],
        "contract": summary["contract"],
        "params_json": summary["params"],
        "bloom": bytes(summary["bloom"]),
        "artist_album_counts_json": summary["artist_album_counts"],
        "entry_count": int(summary["entry_count"]),
        "source_sequence": int(summary["source_sequence"]),
        "etag": summary["etag"],
    }

    def _impl(current: Session) -> None:
        current.execute(_UPSERT_SQL, values)

    with optional_scope(session) as current:
        _impl(current)


def delete_catalog_summaries_except(
    scope_digests: list[str], *, session: Session | None = None
) -> int:
    """Remove every summary whose scope is not listed; return the row count."""

    def _impl(current: Session) -> int:
        result = current.execute(
            text(
                "DELETE FROM federation_catalog_summaries "
                "WHERE NOT (scope_digest = ANY(:digests))"
            ),
            {"digests": list(scope_digests)},
        )
        return int(cast(CursorResult, result).rowcount or 0)

    with optional_scope(session) as current:
        return _impl(current)


__all__ = ["delete_catalog_summaries_except", "upsert_catalog_summary"]
