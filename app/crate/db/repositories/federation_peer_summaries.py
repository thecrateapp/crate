"""Receiver-side storage of the summaries fetched from federation peers."""

from __future__ import annotations

from sqlalchemy import bindparam, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from crate.db.tx import optional_scope, read_scope

_UPSERT_SQL = text(
    """
    INSERT INTO federation_peer_summaries
        (node_uid, contract, params_json, bloom, artist_album_counts_json,
         source_sequence, etag, fetched_at)
    VALUES
        (CAST(:node_uid AS uuid), :contract, :params_json, :bloom,
         :artist_album_counts_json, :source_sequence, :etag, NOW())
    ON CONFLICT (node_uid) DO UPDATE SET
        contract = EXCLUDED.contract,
        params_json = EXCLUDED.params_json,
        bloom = EXCLUDED.bloom,
        artist_album_counts_json = EXCLUDED.artist_album_counts_json,
        source_sequence = EXCLUDED.source_sequence,
        etag = EXCLUDED.etag,
        fetched_at = NOW()
    """
).bindparams(
    bindparam("params_json", type_=JSONB),
    bindparam("artist_album_counts_json", type_=JSONB),
)


def upsert_peer_summary(
    node_uid: str,
    *,
    contract: str,
    params: dict,
    bloom: bytes,
    artist_album_counts: dict[str, int],
    source_sequence: int,
    etag: str,
    session: Session | None = None,
) -> None:
    """Insert or refresh the summary fetched from one peer."""

    values = {
        "node_uid": str(node_uid),
        "contract": contract,
        "params_json": params,
        "bloom": bytes(bloom),
        "artist_album_counts_json": artist_album_counts,
        "source_sequence": int(source_sequence),
        "etag": etag,
    }

    def _impl(current: Session) -> None:
        current.execute(_UPSERT_SQL, values)

    with optional_scope(session) as current:
        _impl(current)


def delete_peer_summary(node_uid: str, *, session: Session | None = None) -> None:
    def _impl(current: Session) -> None:
        current.execute(
            text(
                "DELETE FROM federation_peer_summaries "
                "WHERE node_uid = CAST(:node_uid AS uuid)"
            ),
            {"node_uid": str(node_uid)},
        )

    with optional_scope(session) as current:
        _impl(current)


def list_peer_summary_etags(
    node_uids: list[str], *, session: Session | None = None
) -> dict[str, str]:
    """Return `{node_uid: etag}` for the listed peers that have a summary."""

    def _impl(current: Session) -> dict[str, str]:
        rows = current.execute(
            text(
                """
                SELECT node_uid::text AS node_uid, etag
                FROM federation_peer_summaries
                WHERE node_uid = ANY(CAST(:uids AS uuid[]))
                """
            ),
            {"uids": [str(uid) for uid in node_uids]},
        ).mappings()
        return {row["node_uid"]: row["etag"] for row in rows}

    if not node_uids:
        return {}
    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


def get_peer_summaries(
    node_uids: list[str], *, session: Session | None = None
) -> list[dict]:
    """Return the stored summaries of the listed peers, `bloom` as bytes."""

    def _impl(current: Session) -> list[dict]:
        rows = current.execute(
            text(
                """
                SELECT node_uid::text AS node_uid, contract, params_json, bloom,
                       artist_album_counts_json, source_sequence, etag
                FROM federation_peer_summaries
                WHERE node_uid = ANY(CAST(:uids AS uuid[]))
                """
            ),
            {"uids": [str(uid) for uid in node_uids]},
        ).mappings()
        return [
            {
                "node_uid": row["node_uid"],
                "contract": row["contract"],
                "params": row["params_json"],
                "bloom": bytes(row["bloom"]),
                "artist_album_counts": row["artist_album_counts_json"],
                "source_sequence": row["source_sequence"],
                "etag": row["etag"],
            }
            for row in rows
        ]

    if not node_uids:
        return []
    if session is not None:
        return _impl(session)
    with read_scope() as current:
        return _impl(current)


__all__ = [
    "delete_peer_summary",
    "get_peer_summaries",
    "list_peer_summary_etags",
    "upsert_peer_summary",
]
