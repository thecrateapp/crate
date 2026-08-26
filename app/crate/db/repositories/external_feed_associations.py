"""Artist association workflows for external feed items."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import text

from crate.db.serialize import serialize_rows
from crate.db.tx import read_scope, transaction_scope
from crate.feeds.artist_association import rank_artist_association_candidates
from crate.llm.prompts.feed_artist_association import FeedArtistAssociationResponse


def _row(result: Any) -> dict[str, Any] | None:
    record = result.mappings().first()
    return dict(record) if record else None


def list_library_artists_for_feed_association(
    *, limit: int = 5000
) -> list[dict[str, Any]]:
    """Return the compact artist identity data used by the matcher."""
    bounded_limit = max(1, min(int(limit), 10000))
    with read_scope() as session:
        rows = session.execute(
            text(
                """
                SELECT id, name, slug, folder_name
                FROM library_artists
                WHERE id IS NOT NULL
                  AND NULLIF(BTRIM(name), '') IS NOT NULL
                ORDER BY id ASC
                LIMIT :limit
                """
            ),
            {"limit": bounded_limit},
        ).mappings()
        return serialize_rows(rows)


def associate_external_feed_item_deterministically(
    item_id: int,
    *,
    artists: Sequence[Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Apply only a unique, high-confidence association to a publisher item."""
    with read_scope() as session:
        item = _row(
            session.execute(
                text(
                    """
                    SELECT efi.*, efs.source_kind
                    FROM external_feed_items efi
                    JOIN external_feed_sources efs ON efs.id = efi.source_id
                    WHERE efi.id = :item_id
                      AND efi.state = 'active'
                    """
                ),
                {"item_id": int(item_id)},
            )
        )
    if item is None:
        raise ValueError("External feed item not found")
    if item["source_kind"] != "publisher_rss":
        return {
            "item_id": int(item_id),
            "candidates": [],
            "auto_candidate": None,
            "requires_review": False,
            "applied": False,
            "already_associated": item.get("artist_id") is not None,
        }
    if item.get("artist_id") is not None:
        return {
            "item_id": int(item_id),
            "candidates": [],
            "auto_candidate": None,
            "requires_review": False,
            "applied": False,
            "already_associated": True,
        }

    ranked = rank_artist_association_candidates(
        item=item,
        artists=artists
        if artists is not None
        else list_library_artists_for_feed_association(),
    )
    auto_candidate = ranked.get("auto_candidate")
    applied = False
    if auto_candidate is not None:
        with transaction_scope() as session:
            updated = _row(
                session.execute(
                    text(
                        """
                        UPDATE external_feed_items
                        SET artist_id = :artist_id,
                            artist_association_method = :association_method,
                            artist_association_confidence = :confidence,
                            artist_associated_at = NOW(),
                            artist_associated_by_user_id = NULL,
                            updated_at = NOW()
                        WHERE id = :item_id
                          AND state = 'active'
                          AND artist_id IS NULL
                          AND content_hash = :content_hash
                        RETURNING id
                        """
                    ),
                    {
                        "item_id": int(item_id),
                        "artist_id": int(auto_candidate["artist_id"]),
                        "association_method": auto_candidate["association_method"],
                        "confidence": float(auto_candidate["confidence"]),
                        "content_hash": item["content_hash"],
                    },
                )
            )
            applied = updated is not None

    return {
        **ranked,
        "item_id": int(item_id),
        "applied": applied,
        "already_associated": False,
    }


def apply_external_feed_artist_association(
    session: Any,
    *,
    enrichment_id: int,
    applied_by_user_id: int,
) -> dict[str, Any]:
    """Apply an accepted association proposal in the review transaction."""
    row = _row(
        session.execute(
            text(
                """
                SELECT
                    efe.*,
                    efi.state AS item_state,
                    efi.artist_id AS item_artist_id,
                    efi.content_hash AS current_content_hash
                FROM external_feed_enrichments efe
                JOIN external_feed_items efi ON efi.id = efe.item_id
                WHERE efe.id = :enrichment_id
                FOR UPDATE OF efe, efi
                """
            ),
            {"enrichment_id": int(enrichment_id)},
        )
    )
    if row is None:
        raise ValueError("Artist association proposal not found")
    if row["operation"] != "associate_artist":
        raise ValueError("Only artist association proposals can be applied")
    if row["status"] != "ready":
        raise ValueError("Artist association proposal is not ready")
    if row["review_status"] != "accepted":
        raise ValueError("Artist association proposal must be accepted first")
    if row["item_state"] != "active":
        raise ValueError("External feed item is no longer active")
    if row["source_content_hash"] != row["current_content_hash"]:
        raise ValueError(
            "Artist association proposal is stale because the source changed"
        )

    try:
        result = dict(row.get("result_json") or {})
        proposal = FeedArtistAssociationResponse.model_validate(result)
    except ValueError as exc:
        raise ValueError("Artist association proposal has an invalid result") from exc

    if proposal.artist_id is None:
        return {
            "enrichment_id": int(enrichment_id),
            "associated": False,
            "already_associated": False,
        }

    candidates = result.get("candidates")
    if not isinstance(candidates, list) or not any(
        isinstance(candidate, Mapping)
        and candidate.get("artist_id") is not None
        and int(candidate["artist_id"]) == proposal.artist_id
        for candidate in candidates
    ):
        raise ValueError("Artist association proposal selected an unknown candidate")

    if row.get("item_artist_id") is not None:
        if int(row["item_artist_id"]) == proposal.artist_id:
            return {
                "enrichment_id": int(enrichment_id),
                "artist_id": proposal.artist_id,
                "associated": True,
                "already_associated": True,
            }
        raise ValueError("External feed item is already associated with another artist")

    artist_exists = session.execute(
        text("SELECT 1 FROM library_artists WHERE id = :artist_id"),
        {"artist_id": proposal.artist_id},
    ).scalar_one_or_none()
    if artist_exists is None:
        raise ValueError("Selected artist no longer exists")

    session.execute(
        text(
            """
            UPDATE external_feed_items
            SET artist_id = :artist_id,
                artist_association_method = 'ai_review',
                artist_association_confidence = :confidence,
                artist_associated_at = NOW(),
                artist_associated_by_user_id = :user_id,
                updated_at = NOW()
            WHERE id = :item_id
              AND artist_id IS NULL
            """
        ),
        {
            "item_id": int(row["item_id"]),
            "artist_id": proposal.artist_id,
            "confidence": proposal.confidence,
            "user_id": int(applied_by_user_id),
        },
    )
    return {
        "enrichment_id": int(enrichment_id),
        "artist_id": proposal.artist_id,
        "associated": True,
        "already_associated": False,
    }


__all__ = [
    "apply_external_feed_artist_association",
    "associate_external_feed_item_deterministically",
    "list_library_artists_for_feed_association",
]
