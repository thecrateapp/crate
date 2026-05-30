from __future__ import annotations

import logging
import re

from crate.db.queries.genres_graph_related import (
    get_genre_cooccurring_album_slugs,
    get_genre_cooccurring_artist_slugs,
    get_genre_seed_artists,
)
from crate.db.queries.genres_library_catalog import list_unmapped_genres_for_inference
from crate.db.queries.genres_library_detail import get_genre_detail
from crate.db.queries.sound_intelligence import get_sound_intelligence_health
from crate.db.repositories.genres_taxonomy_edges import VALID_RELATION_TYPES
from crate.genre_taxonomy import get_genre_catalog

log = logging.getLogger(__name__)


def _normalize_slug(value: str) -> str:
    return re.sub(r"\s+", "-", (value or "").strip().lower())


def _seed_artist_names(slug: str) -> list[str]:
    try:
        return [
            str(row["artist_name"])
            for row in get_genre_seed_artists(slug)
            if row.get("artist_name")
        ][:16]
    except Exception:
        log.debug("Failed to load seed artists for %s", slug, exc_info=True)
        return []


def _raw_genre_evidence(slug: str) -> dict | None:
    try:
        detail = get_genre_detail(slug)
    except Exception:
        log.debug("Failed to load raw genre detail for %s", slug, exc_info=True)
        return None
    if not detail:
        return None

    artists = [
        str(row.get("artist_name") or "").strip()
        for row in detail.get("artists", [])[:16]
        if str(row.get("artist_name") or "").strip()
    ]
    albums = [
        f"{row.get('artist')} - {row.get('name')}"
        for row in detail.get("albums", [])[:10]
        if row.get("artist") and row.get("name")
    ]
    cooccurring: list[str] = []
    for loader in (
        get_genre_cooccurring_artist_slugs,
        get_genre_cooccurring_album_slugs,
    ):
        try:
            rows = loader(slug)
        except Exception:
            log.debug(
                "Failed to load co-occurring genres for %s via %s",
                slug,
                loader.__name__,
                exc_info=True,
            )
            continue
        for row in rows:
            target = _normalize_slug(str(row.get("canonical_slug") or ""))
            if target and target not in cooccurring:
                cooccurring.append(target)

    return {
        "name": str(detail.get("name") or slug),
        "description": detail.get("description"),
        "artist_count": int(detail.get("artist_count") or len(artists)),
        "album_count": int(detail.get("album_count") or len(albums)),
        "seed_artists": artists or _seed_artist_names(slug),
        "sample_albums": albums,
        "cooccurring_genres": cooccurring[:24],
    }


def _rank_candidate_targets(
    targets: list[dict],
    *,
    source_slug: str,
    cooccurring_genres: list[str],
) -> list[dict]:
    cooccurring = set(cooccurring_genres)
    source_tokens = set(source_slug.split("-"))

    def score(target: dict) -> tuple[int, int, str]:
        target_slug = str(target.get("slug") or "")
        target_tokens = set(target_slug.split("-"))
        return (
            0 if target_slug in cooccurring else 1,
            0 if source_tokens & target_tokens else 1,
            target_slug,
        )

    return sorted(targets, key=score)


def build_genre_taxonomy_node_proposal(slug: str) -> dict:
    canonical_slug = _normalize_slug(slug)
    catalog = get_genre_catalog()
    node = catalog.get(canonical_slug)
    raw_evidence = None if node else _raw_genre_evidence(canonical_slug)
    if not node and not raw_evidence:
        return {"ok": False, "reason": "unknown_node", "slug": canonical_slug}

    candidate_targets = [
        {
            "slug": target_slug,
            "name": str(meta.get("name") or target_slug),
            "top_level": bool(meta.get("top_level")),
        }
        for target_slug, meta in sorted(catalog.items())
        if target_slug != canonical_slug
    ]
    allowed_targets = {target["slug"] for target in candidate_targets}
    if node:
        source_kind = "taxonomy_node"
        genre_name = str(node.get("name") or canonical_slug)
        current_description = node.get("description") or None
        aliases = list(node.get("aliases") or [])
        current_relations = {
            "parent": list(node.get("parents") or []),
            "related": list(node.get("related") or []),
            "influenced_by": list(node.get("influenced_by") or []),
            "fusion_of": list(node.get("fusion_of") or []),
        }
        seed_artists = _seed_artist_names(canonical_slug)
        sample_albums: list[str] = []
        cooccurring_genres: list[str] = []
        artist_count = None
        album_count = None
    else:
        source_kind = "raw_genre"
        assert raw_evidence is not None
        genre_name = str(raw_evidence.get("name") or canonical_slug)
        current_description = None
        aliases = [genre_name, canonical_slug]
        current_relations = {
            "parent": [],
            "related": [],
            "influenced_by": [],
            "fusion_of": [],
        }
        seed_artists = list(raw_evidence.get("seed_artists") or [])
        sample_albums = list(raw_evidence.get("sample_albums") or [])
        cooccurring_genres = [
            slug
            for slug in raw_evidence.get("cooccurring_genres", [])
            if slug in allowed_targets
        ]
        artist_count = int(raw_evidence.get("artist_count") or 0)
        album_count = int(raw_evidence.get("album_count") or 0)
        candidate_targets = _rank_candidate_targets(
            candidate_targets,
            source_slug=canonical_slug,
            cooccurring_genres=cooccurring_genres,
        )

    from crate.llm.prompts.genre_taxonomy_node_proposal import (
        generate_genre_taxonomy_node_proposal,
    )

    response = generate_genre_taxonomy_node_proposal(
        genre_name=genre_name,
        slug=canonical_slug,
        source_kind=source_kind,
        current_description=current_description,
        current_relations=current_relations,
        aliases=aliases,
        seed_artists=seed_artists,
        sample_albums=sample_albums,
        cooccurring_genres=cooccurring_genres,
        artist_count=artist_count,
        album_count=album_count,
        candidate_targets=candidate_targets,
    )

    relation_proposals = []
    for suggestion in response.relations:
        relation_type = suggestion.relation_type
        if relation_type not in VALID_RELATION_TYPES:
            continue
        targets = []
        for target_slug in suggestion.target_slugs:
            normalized = _normalize_slug(target_slug)
            if normalized in allowed_targets and normalized not in targets:
                targets.append(normalized)
        if not targets:
            continue
        relation_proposals.append(
            {
                "relation_type": relation_type,
                "target_slugs": targets,
                "confidence": suggestion.confidence,
                "reasoning": suggestion.reasoning,
            }
        )

    description = re.sub(r"\s+", " ", (response.description or "").strip())
    aliases = [
        alias.strip()
        for alias in response.aliases
        if alias.strip() and len(alias.strip()) <= 80
    ]
    recommended_action = getattr(response, "recommended_action", "needs_review")
    if recommended_action not in {
        "create_node",
        "alias_existing",
        "delete_marginal",
        "needs_review",
    }:
        recommended_action = "needs_review"
    recommended_target_slug = _normalize_slug(
        str(getattr(response, "recommended_target_slug", "") or "")
    )
    if recommended_target_slug not in allowed_targets:
        recommended_target_slug = None

    return {
        "ok": True,
        "slug": canonical_slug,
        "name": genre_name,
        "source_kind": source_kind,
        "recommended_action": recommended_action,
        "recommended_target_slug": recommended_target_slug,
        "description": description,
        "aliases": list(dict.fromkeys(aliases))[:12],
        "relations": relation_proposals,
        "reasoning": response.reasoning,
        "current_relations": current_relations,
        "evidence": {
            "artist_count": artist_count,
            "album_count": album_count,
            "seed_artists": seed_artists[:16],
            "sample_albums": sample_albums[:10],
            "cooccurring_genres": cooccurring_genres[:24],
        },
    }


def _node_rebuild_candidates(limit: int) -> list[str]:
    catalog = get_genre_catalog()
    scored: list[tuple[int, str]] = []
    for slug, meta in catalog.items():
        score = 0
        if not meta.get("description"):
            score += 6
        if not meta.get("top_level") and not meta.get("parents"):
            score += 5
        if not meta.get("eq_gains"):
            score += 1
        if score <= 0:
            continue
        scored.append((score, slug))
    return [
        slug
        for _score, slug in sorted(scored, key=lambda item: (-item[0], item[1]))[:limit]
    ]


def build_genre_taxonomy_rebuild_proposal(
    *,
    alias_limit: int = 80,
    node_limit: int = 12,
    include_external: bool = True,
    aggressive: bool = True,
    progress_callback=None,
    event_callback=None,
) -> dict:
    """Build a review-only taxonomy rebuild proposal.

    This intentionally does not mutate taxonomy rows. It reuses the same
    evidence pipeline as the existing inference task, but returns candidate
    alias mappings and node-level AI diffs for a curator to review.
    """

    from crate.genre_taxonomy_inference import (
        _collect_external_evidence,
        _collect_local_evidence,
        infer_canonical_genre,
    )

    alias_limit = max(1, min(int(alias_limit or 80), 300))
    node_limit = max(0, min(int(node_limit or 12), 50))
    unmapped = list_unmapped_genres_for_inference(limit=alias_limit)
    node_slugs = _node_rebuild_candidates(node_limit)
    total = len(unmapped) + len(node_slugs)
    done = 0
    alias_proposals: list[dict] = []
    alias_unresolved: list[dict] = []
    node_proposals: list[dict] = []
    node_errors: list[dict] = []

    if progress_callback:
        progress_callback(
            {
                "phase": "collecting",
                "done": 0,
                "total": total,
                "alias_candidates": len(unmapped),
                "node_candidates": len(node_slugs),
            }
        )

    for item in unmapped:
        genre_slug = str(item.get("slug") or "")
        genre_name = str(item.get("name") or genre_slug)
        if event_callback:
            event_callback({"message": f"Proposing alias mapping for {genre_name}"})

        evidence = _collect_local_evidence(genre_slug, genre_name)
        if include_external and evidence.artists:
            evidence.external = _collect_external_evidence(evidence.artists)

        proposal = infer_canonical_genre(
            genre_name,
            cooccurring=evidence.cooccurring,
            external=evidence.external,
            family_hints=evidence.family_hints,
            aggressive=aggressive,
        )
        if proposal and proposal.get("canonical_slug"):
            alias_proposals.append(
                {
                    "alias_slug": genre_slug,
                    "alias_name": genre_name,
                    "target_slug": str(proposal["canonical_slug"]),
                    "confidence": float(proposal.get("confidence") or 0.0),
                    "mode": proposal.get("mode") or "unknown",
                    "reason": proposal.get("reason") or "",
                    "artists": evidence.artists[:6],
                }
            )
        else:
            alias_unresolved.append(
                {
                    "alias_slug": genre_slug,
                    "alias_name": genre_name,
                    "reason": (proposal or {}).get("reason")
                    or "No confident taxonomy target",
                    "artists": evidence.artists[:6],
                }
            )

        done += 1
        if progress_callback:
            progress_callback(
                {
                    "phase": "aliases",
                    "done": done,
                    "total": total,
                    "item": genre_name,
                }
            )

    for slug in node_slugs:
        if event_callback:
            event_callback({"message": f"Building node proposal for {slug}"})
        try:
            proposal = build_genre_taxonomy_node_proposal(slug)
            if proposal.get("ok"):
                node_proposals.append(proposal)
            else:
                node_errors.append(
                    {
                        "slug": slug,
                        "reason": proposal.get("reason") or "proposal_failed",
                    }
                )
        except Exception as exc:
            log.warning(
                "Taxonomy rebuild node proposal failed for %s", slug, exc_info=True
            )
            node_errors.append({"slug": slug, "reason": str(exc)})

        done += 1
        if progress_callback:
            progress_callback(
                {
                    "phase": "nodes",
                    "done": done,
                    "total": total,
                    "item": slug,
                }
            )

    health = get_sound_intelligence_health()
    return {
        "ok": True,
        "applied": False,
        "summary": {
            "alias_candidates": len(unmapped),
            "alias_proposals": len(alias_proposals),
            "alias_unresolved": len(alias_unresolved),
            "node_candidates": len(node_slugs),
            "node_proposals": len(node_proposals),
            "node_errors": len(node_errors),
        },
        "health": health,
        "alias_proposals": alias_proposals,
        "alias_unresolved": alias_unresolved,
        "node_proposals": node_proposals,
        "node_errors": node_errors,
    }


__all__ = [
    "build_genre_taxonomy_node_proposal",
    "build_genre_taxonomy_rebuild_proposal",
]
