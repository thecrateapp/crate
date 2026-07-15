"""Attributed genre assertions for the canonical global catalog."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy import text

from crate.genre_taxonomy import (
    CORE_TAXONOMY_ID,
    get_core_taxonomy_descriptor,
    slugify_genre,
)

_MAX_ASSERTION_WEIGHT = 1.0


def normalize_genre_assertions(assertions: Iterable[Any]) -> list[dict[str, Any]]:
    """Normalize typed or legacy source genre evidence without resolving it."""
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, str | None]] = set()
    for candidate in assertions:
        if isinstance(candidate, str):
            payload: dict[str, Any] = {"raw_label": candidate}
        elif isinstance(candidate, dict):
            payload = candidate
        else:
            continue

        raw_label = (
            str(
                payload.get("raw_label")
                or payload.get("label")
                or payload.get("name")
                or ""
            )
            .strip()
            .lower()
        )
        if not raw_label:
            continue
        genre_uid = (
            str(
                payload.get("global_genre_uid") or payload.get("genre_uid") or ""
            ).strip()
            or None
        )
        dedupe_key = (raw_label, genre_uid)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        taxonomy = payload.get("taxonomy")
        taxonomy = taxonomy if isinstance(taxonomy, dict) else {}
        normalized.append(
            {
                "raw_label": raw_label,
                "global_genre_uid": genre_uid,
                "taxonomy_id": str(
                    taxonomy.get("id") or payload.get("taxonomy_id") or CORE_TAXONOMY_ID
                ).strip()
                or CORE_TAXONOMY_ID,
                "taxonomy_version": str(
                    taxonomy.get("version") or payload.get("taxonomy_version") or ""
                ).strip()
                or None,
                "taxonomy_digest": str(
                    taxonomy.get("digest") or payload.get("taxonomy_digest") or ""
                ).strip()
                or None,
                "weight": _bounded(payload.get("weight"), default=1.0),
                "confidence": _bounded(payload.get("confidence"), default=1.0),
                "is_direct": bool(payload.get("is_direct", True)),
            }
        )
    return normalized


def project_source_genre_assertions(
    session,
    *,
    source_id: int,
    entity_type: str,
    global_entity_uid: str,
    source_kind: str,
    source_revision: str | None,
    assertions: Iterable[Any],
) -> None:
    """Replace one source's genre evidence and refresh just its entity aggregate."""
    session.execute(
        text(
            """
            UPDATE global_catalog_genre_assertions
            SET invalidated_at = NOW()
            WHERE source_id = :source_id
              AND invalidated_at IS NULL
            """
        ),
        {"source_id": source_id},
    )

    for assertion in normalize_genre_assertions(assertions):
        resolved = _resolve_assertion(
            session,
            assertion=assertion,
            source_kind=source_kind,
        )
        session.execute(
            text(
                """
                INSERT INTO global_catalog_genre_assertions (
                    source_id,
                    global_genre_uid,
                    taxonomy_id,
                    taxonomy_version,
                    taxonomy_digest,
                    raw_label,
                    mapping_method,
                    confidence,
                    weight,
                    is_direct,
                    source_revision
                )
                VALUES (
                    :source_id,
                    CAST(:global_genre_uid AS uuid),
                    :taxonomy_id,
                    :taxonomy_version,
                    :taxonomy_digest,
                    :raw_label,
                    :mapping_method,
                    :confidence,
                    :weight,
                    :is_direct,
                    :source_revision
                )
                """
            ),
            {
                "source_id": source_id,
                "global_genre_uid": resolved["global_genre_uid"],
                "taxonomy_id": assertion["taxonomy_id"],
                "taxonomy_version": assertion["taxonomy_version"],
                "taxonomy_digest": assertion["taxonomy_digest"],
                "raw_label": assertion["raw_label"],
                "mapping_method": resolved["mapping_method"],
                "confidence": assertion["confidence"],
                "weight": assertion["weight"],
                "is_direct": assertion["is_direct"],
                "source_revision": source_revision,
            },
        )

    recompute_entity_genre_memberships(
        session,
        entity_type=entity_type,
        global_entity_uid=global_entity_uid,
    )


def recompute_entity_genre_memberships(
    session,
    *,
    entity_type: str,
    global_entity_uid: str,
) -> None:
    """Rebuild only the direct genre rows for one canonical entity."""
    params = {
        "entity_type": entity_type,
        "global_entity_uid": global_entity_uid,
    }
    session.execute(
        text(
            """
            DELETE FROM global_catalog_entity_genres
            WHERE entity_type = :entity_type
              AND global_entity_uid = CAST(:global_entity_uid AS uuid)
            """
        ),
        params,
    )
    session.execute(
        text(
            """
            INSERT INTO global_catalog_entity_genres (
                entity_type,
                global_entity_uid,
                global_genre_uid,
                direct_score,
                aggregate_score,
                supporting_source_count,
                supporting_node_count,
                preferred_for_display,
                computed_at
            )
            SELECT
                source.entity_type,
                source.global_entity_uid,
                assertion.global_genre_uid,
                LEAST(
                    1.0,
                    SUM(
                        CASE WHEN assertion.is_direct
                            THEN assertion.weight * assertion.confidence
                            ELSE 0
                        END
                    )
                ) AS direct_score,
                LEAST(1.0, SUM(assertion.weight * assertion.confidence))
                    AS aggregate_score,
                COUNT(DISTINCT source.id)::integer AS supporting_source_count,
                COUNT(DISTINCT COALESCE(source.node_uid::text, 'local'))::integer
                    AS supporting_node_count,
                BOOL_OR(source.preferred_for_display) AS preferred_for_display,
                NOW()
            FROM global_catalog_genre_assertions assertion
            JOIN global_catalog_sources source ON source.id = assertion.source_id
            WHERE source.entity_type = :entity_type
              AND source.global_entity_uid = CAST(:global_entity_uid AS uuid)
              AND source.source_deleted_at IS NULL
              AND NOT source.source_stale
              AND assertion.invalidated_at IS NULL
              AND assertion.global_genre_uid IS NOT NULL
            GROUP BY source.entity_type, source.global_entity_uid, assertion.global_genre_uid
            """
        ),
        params,
    )


def refresh_global_catalog_genre_snapshots() -> None:
    """Publish matching taxonomy and global genre-list snapshots for Go reads."""
    from crate.db.queries.global_catalog import list_global_catalog_genres
    from crate.db.ui_snapshot_writes import upsert_ui_snapshot

    descriptor = get_core_taxonomy_descriptor()
    taxonomy = {
        "id": descriptor["taxonomy_id"],
        "version": descriptor["version"],
        "digest": descriptor["digest"],
    }
    upsert_ui_snapshot(
        "global-catalog-taxonomy",
        CORE_TAXONOMY_ID,
        {"taxonomy": taxonomy},
        stale_after_seconds=300,
    )
    upsert_ui_snapshot(
        "global-catalog-genres",
        CORE_TAXONOMY_ID,
        {
            "taxonomy": taxonomy,
            "items": list_global_catalog_genres(),
        },
        stale_after_seconds=300,
    )


def _resolve_assertion(
    session,
    *,
    assertion: dict[str, Any],
    source_kind: str,
) -> dict[str, str | None]:
    descriptor = get_core_taxonomy_descriptor()
    declared_core = _is_matching_core_descriptor(assertion, descriptor)
    declared_uid = assertion["global_genre_uid"]
    if declared_core and declared_uid and _core_genre_exists(session, declared_uid):
        return {
            "global_genre_uid": declared_uid,
            "mapping_method": "declared_core",
        }

    mapped_uid = _lookup_local_core_genre(session, assertion["raw_label"])
    if mapped_uid:
        return {
            "global_genre_uid": mapped_uid,
            "mapping_method": (
                "local_alias" if source_kind == "local" else "receiver_mapping"
            ),
        }
    return {"global_genre_uid": None, "mapping_method": "unmapped"}


def _is_matching_core_descriptor(
    assertion: dict[str, Any], descriptor: dict[str, Any]
) -> bool:
    return (
        assertion["taxonomy_id"] == descriptor["taxonomy_id"]
        and assertion["taxonomy_version"] == descriptor["version"]
        and assertion["taxonomy_digest"] == descriptor["digest"]
    )


def _core_genre_exists(session, global_genre_uid: str) -> bool:
    return bool(
        session.execute(
            text(
                """
                SELECT 1
                FROM genre_taxonomy_nodes
                WHERE taxonomy_id = :taxonomy_id
                  AND global_genre_uid = CAST(:global_genre_uid AS uuid)
                """
            ),
            {
                "taxonomy_id": CORE_TAXONOMY_ID,
                "global_genre_uid": global_genre_uid,
            },
        ).first()
    )


def _lookup_local_core_genre(session, raw_label: str) -> str | None:
    normalized_slug = slugify_genre(raw_label)
    if not normalized_slug:
        return None
    row = (
        session.execute(
            text(
                """
                SELECT node.global_genre_uid::text AS global_genre_uid
                FROM genre_taxonomy_nodes node
                LEFT JOIN genre_taxonomy_aliases alias ON alias.genre_id = node.id
                WHERE node.taxonomy_id = :taxonomy_id
                  AND (
                    node.slug = :normalized_slug
                    OR alias.alias_slug = :normalized_slug
                    OR alias.alias_name = :raw_label
                  )
                ORDER BY node.origin = 'core' DESC, node.id
                LIMIT 1
                """
            ),
            {
                "taxonomy_id": CORE_TAXONOMY_ID,
                "normalized_slug": normalized_slug,
                "raw_label": raw_label,
            },
        )
        .mappings()
        .first()
    )
    return str(row["global_genre_uid"]) if row else None


def _bounded(value: Any, *, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    return max(0.0, min(_MAX_ASSERTION_WEIGHT, parsed))
