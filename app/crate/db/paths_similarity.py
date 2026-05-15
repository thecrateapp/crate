"""Similarity and graph loaders for Music Paths."""

from __future__ import annotations

import logging
from collections.abc import Callable
from functools import lru_cache

from crate.db.queries.paths import (
    load_artist_genres,
    load_artist_similarity_graph,
    load_shared_members_graph,
)
from crate.genre_taxonomy import (
    get_genre_ancestor_slugs,
    get_related_genre_terms,
    get_static_genre_ancestor_slugs,
    resolve_genre_slug,
    resolve_static_genre_slug,
    slugify_genre,
)

log = logging.getLogger(__name__)


def _load_artist_similarity_graph(*, session=None) -> dict[str, dict[str, float]]:
    return load_artist_similarity_graph(session=session)


def _load_shared_members_graph(*, session=None) -> dict[str, set[str]]:
    graph = load_shared_members_graph(session=session)
    log.info("Shared members graph: %d artists connected", len(graph))
    return graph


def _load_artist_genres(*, session=None) -> dict[str, dict[str, float]]:
    return load_artist_genres(session=session)


def _genre_cache_key(genres: dict[str, float]) -> tuple[tuple[str, float], ...]:
    return tuple(
        sorted(
            (str(raw_genre), float(raw_weight or 0.0))
            for raw_genre, raw_weight in (genres or {}).items()
        )
    )


@lru_cache(maxsize=4096)
def _expand_genre_weight_items(
    items: tuple[tuple[str, float], ...],
) -> tuple[tuple[str, float], ...]:
    expanded: dict[str, float] = {}
    for raw_genre, weight in items:
        if weight <= 0:
            continue
        canonical_slug = resolve_genre_slug(raw_genre) or slugify_genre(raw_genre)
        if not canonical_slug:
            continue
        ancestors = get_genre_ancestor_slugs(canonical_slug, include_self=True) or [
            canonical_slug
        ]
        for index, slug in enumerate(ancestors):
            weighted = weight if index == 0 else weight * 0.65
            expanded[slug] = max(expanded.get(slug, 0.0), weighted)
        for related_term in get_related_genre_terms(
            canonical_slug, limit=12, max_depth=1
        ):
            related_slug = resolve_genre_slug(related_term) or slugify_genre(
                related_term
            )
            if related_slug and related_slug not in expanded:
                expanded[related_slug] = weight * 0.35
    return tuple(sorted(expanded.items()))


def _expand_genre_weights(genres: dict[str, float]) -> dict[str, float]:
    return dict(_expand_genre_weight_items(_genre_cache_key(genres)))


@lru_cache(maxsize=4096)
def _expand_genre_weight_items_for_radio(
    items: tuple[tuple[str, float], ...],
) -> tuple[tuple[str, float], ...]:
    expanded: dict[str, float] = {}
    for raw_genre, weight in items:
        if weight <= 0:
            continue
        canonical_slug = resolve_static_genre_slug(raw_genre) or slugify_genre(
            raw_genre
        )
        if not canonical_slug:
            continue
        ancestors = get_static_genre_ancestor_slugs(
            canonical_slug, include_self=True
        ) or [canonical_slug]
        for index, slug in enumerate(ancestors):
            weighted = weight if index == 0 else weight * 0.65
            expanded[slug] = max(expanded.get(slug, 0.0), weighted)
    return tuple(sorted(expanded.items()))


def _expand_genre_weights_for_radio(genres: dict[str, float]) -> dict[str, float]:
    return dict(_expand_genre_weight_items_for_radio(_genre_cache_key(genres)))


def _genre_jaccard(
    candidate_genres: dict[str, float], target_genres: dict[str, float]
) -> float:
    if not candidate_genres or not target_genres:
        return 0.0
    shared_keys = set(candidate_genres.keys()) & set(target_genres.keys())
    if not shared_keys:
        return 0.0
    all_keys = set(candidate_genres.keys()) | set(target_genres.keys())
    intersection = sum(
        min(candidate_genres[key], target_genres[key]) for key in shared_keys
    )
    union = sum(
        max(candidate_genres.get(key, 0.0), target_genres.get(key, 0.0))
        for key in all_keys
    )
    return intersection / union if union > 0 else 0.0


def make_radio_genre_overlap_scorer(
    genre_map: dict[str, dict[str, float]],
    target_artists: list[str],
) -> Callable[[str, list[str], dict[str, dict[str, float]]], float]:
    """Build a batch-local genre overlap scorer for shaped radio.

    The full Music Paths scorer expands related genres for each unique
    artist. That is good for one-off path building, but radio ranks the
    same candidate pool repeatedly while building a batch. For this hot
    path we pre-expand ancestors once per artist and compare against the
    fixed seed context.
    """
    expanded_cache: dict[str, dict[str, float]] = {}

    def expanded_for(artist_name: str) -> dict[str, float]:
        key = artist_name.lower()
        if key not in expanded_cache:
            expanded_cache[key] = _expand_genre_weights_for_radio(
                genre_map.get(key, {})
            )
        return expanded_cache[key]

    target_genre_sets = [expanded_for(artist) for artist in target_artists]

    def score(
        candidate_artist: str,
        _target_artists: list[str],
        _genre_map: dict[str, dict[str, float]],
    ) -> float:
        candidate_genres = expanded_for(candidate_artist)
        if not candidate_genres or not target_genre_sets:
            return 0.0
        return max(
            (
                _genre_jaccard(candidate_genres, target_genres)
                for target_genres in target_genre_sets
            ),
            default=0.0,
        )

    return score


def _artist_affinity(
    candidate_artist: str,
    context_artists: list[str],
    sim_graph: dict[str, dict[str, float]],
    member_graph: dict[str, set[str]],
) -> float:
    """Return how connected ``candidate_artist`` is to the recent context artists."""
    candidate_lower = candidate_artist.lower()
    if not context_artists:
        return 0.0

    best = 0.0
    for context_artist in context_artists:
        context_lower = context_artist.lower()

        if candidate_lower in member_graph.get(context_lower, set()):
            return 0.95

        direct = sim_graph.get(context_lower, {}).get(candidate_lower, 0.0)
        if direct > best:
            best = direct

        if best < 0.5:
            context_sims = sim_graph.get(context_lower, {})
            candidate_sims = sim_graph.get(candidate_lower, {})
            shared = set(context_sims.keys()) & set(candidate_sims.keys())
            if shared:
                second_degree = (
                    max(
                        min(context_sims[item], candidate_sims[item]) for item in shared
                    )
                    * 0.5
                )
                if second_degree > best:
                    best = second_degree

    return min(best, 1.0)


def _genre_overlap(
    candidate_artist: str,
    target_artists: list[str],
    genre_map: dict[str, dict[str, float]],
) -> float:
    """Weighted Jaccard-like genre overlap between candidate and target artists."""
    candidate_genres = _expand_genre_weights(
        genre_map.get(candidate_artist.lower(), {})
    )
    if not candidate_genres or not target_artists:
        return 0.0

    best = 0.0
    for target_artist in target_artists:
        target_genres = _expand_genre_weights(genre_map.get(target_artist.lower(), {}))
        if not target_genres:
            continue
        jaccard = _genre_jaccard(candidate_genres, target_genres)
        if jaccard > best:
            best = jaccard
    return best


__all__ = [
    "_artist_affinity",
    "_genre_overlap",
    "_load_artist_genres",
    "_load_artist_similarity_graph",
    "_load_shared_members_graph",
    "make_radio_genre_overlap_scorer",
]
