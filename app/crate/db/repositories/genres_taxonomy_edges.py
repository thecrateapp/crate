from __future__ import annotations

import json

from sqlalchemy import text

from crate.db.tx import transaction_scope
from crate.genre_taxonomy import invalidate_runtime_taxonomy_cache_after_commit

VALID_RELATION_TYPES = {"parent", "related", "influenced_by", "fusion_of"}


def upsert_genre_taxonomy_edge(
    source_slug: str,
    target_slug: str,
    *,
    relation_type: str,
    weight: float | None = None,
    source: str = "manual",
    confidence: float = 1.0,
    evidence_json: dict | None = None,
    created_by: int | None = None,
    locked: bool = False,
    session=None,
) -> bool:
    source_slug = (source_slug or "").strip().lower()
    target_slug = (target_slug or "").strip().lower()
    relation_type = (relation_type or "").strip().lower()
    if not source_slug or not target_slug or source_slug == target_slug:
        return False
    if relation_type not in VALID_RELATION_TYPES:
        return False
    edge_weight = (
        weight if weight is not None else (0.7 if relation_type == "related" else 1.0)
    )
    confidence = max(0.0, min(1.0, float(confidence)))

    if session is None:
        with transaction_scope() as s:
            return upsert_genre_taxonomy_edge(
                source_slug,
                target_slug,
                relation_type=relation_type,
                weight=weight,
                source=source,
                confidence=confidence,
                evidence_json=evidence_json,
                created_by=created_by,
                locked=locked,
                session=s,
            )
    source_row = (
        session.execute(
            text("SELECT id FROM genre_taxonomy_nodes WHERE slug = :slug"),
            {"slug": source_slug},
        )
        .mappings()
        .first()
    )
    target_row = (
        session.execute(
            text("SELECT id FROM genre_taxonomy_nodes WHERE slug = :slug"),
            {"slug": target_slug},
        )
        .mappings()
        .first()
    )
    if not source_row or not target_row:
        return False
    session.execute(
        text(
            """
            INSERT INTO genre_taxonomy_edges (
                source_genre_id,
                target_genre_id,
                relation_type,
                weight,
                source,
                confidence,
                evidence_json,
                created_by,
                locked,
                updated_at
            )
            VALUES (
                :source_id,
                :target_id,
                :relation_type,
                :weight,
                :source,
                :confidence,
                CAST(:evidence_json AS JSONB),
                :created_by,
                :locked,
                now()
            )
            ON CONFLICT (source_genre_id, target_genre_id, relation_type) DO UPDATE
            SET
                weight = EXCLUDED.weight,
                source = :source,
                confidence = :confidence,
                evidence_json = CAST(:evidence_json AS JSONB),
                created_by = COALESCE(:created_by, genre_taxonomy_edges.created_by),
                locked = :locked,
                updated_at = now()
            """
        ),
        {
            "source_id": source_row["id"],
            "target_id": target_row["id"],
            "relation_type": relation_type,
            "weight": edge_weight,
            "source": (source or "manual").strip() or "manual",
            "confidence": confidence,
            "evidence_json": json.dumps(evidence_json) if evidence_json else None,
            "created_by": created_by,
            "locked": locked,
        },
    )

    invalidate_runtime_taxonomy_cache_after_commit(session)
    return True


def replace_genre_taxonomy_edges(
    source_slug: str,
    *,
    relation_type: str,
    target_slugs: list[str],
    created_by: int | None = None,
    source: str = "manual",
    session=None,
) -> dict:
    source_slug = (source_slug or "").strip().lower()
    relation_type = (relation_type or "").strip().lower()
    normalized_targets = []
    seen = set()
    for target_slug in target_slugs:
        normalized = (target_slug or "").strip().lower()
        if not normalized or normalized == source_slug or normalized in seen:
            continue
        normalized_targets.append(normalized)
        seen.add(normalized)

    if not source_slug or relation_type not in VALID_RELATION_TYPES:
        return {"updated": False, "added": [], "missing": normalized_targets}

    if session is None:
        with transaction_scope() as s:
            return replace_genre_taxonomy_edges(
                source_slug,
                relation_type=relation_type,
                target_slugs=normalized_targets,
                created_by=created_by,
                source=source,
                session=s,
            )

    source_row = (
        session.execute(
            text("SELECT id FROM genre_taxonomy_nodes WHERE slug = :slug"),
            {"slug": source_slug},
        )
        .mappings()
        .first()
    )
    if not source_row:
        return {"updated": False, "added": [], "missing": normalized_targets}

    target_rows = (
        session.execute(
            text(
                """
                SELECT slug
                FROM genre_taxonomy_nodes
                WHERE slug = ANY(:slugs)
                """
            ),
            {"slugs": normalized_targets},
        )
        .mappings()
        .all()
    )
    existing_targets = {str(row["slug"]) for row in target_rows}
    missing = [slug for slug in normalized_targets if slug not in existing_targets]

    session.execute(
        text(
            """
            DELETE FROM genre_taxonomy_edges
            WHERE source_genre_id = :source_id
              AND relation_type = :relation_type
              AND (locked IS NOT TRUE OR source = :source)
            """
        ),
        {
            "source_id": source_row["id"],
            "relation_type": relation_type,
            "source": (source or "manual").strip() or "manual",
        },
    )

    added = []
    for target_slug in normalized_targets:
        if target_slug not in existing_targets:
            continue
        if upsert_genre_taxonomy_edge(
            source_slug,
            target_slug,
            relation_type=relation_type,
            source=source,
            confidence=1.0,
            created_by=created_by,
            locked=True,
            session=session,
        ):
            added.append(target_slug)

    invalidate_runtime_taxonomy_cache_after_commit(session)
    return {"updated": True, "added": added, "missing": missing}


__all__ = [
    "VALID_RELATION_TYPES",
    "replace_genre_taxonomy_edges",
    "upsert_genre_taxonomy_edge",
]
