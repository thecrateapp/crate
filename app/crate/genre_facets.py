"""Normalization rules for non-hierarchical genre descriptors."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping, Sequence
from typing import Any


GENRE_FACET_DIMENSIONS = frozenset(
    {
        "era",
        "instrumentation",
        "language",
        "mood",
        "origin",
        "rhythm",
        "scene",
        "sound",
        "vocals",
    }
)


def slugify_facet(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", (value or "").strip().lower())
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_value).strip("-")


def normalize_genre_facets(
    facets: Sequence[Mapping[str, Any]] | None,
) -> list[dict[str, str]]:
    """Validate and deduplicate facet assignments using dimension + normalized name."""

    normalized: dict[tuple[str, str], dict[str, str]] = {}
    for facet in facets or []:
        dimension = str(facet.get("dimension") or "").strip().lower()
        name = re.sub(r"\s+", " ", str(facet.get("name") or "").strip())
        if dimension not in GENRE_FACET_DIMENSIONS:
            raise ValueError(f"Unsupported genre facet dimension: {dimension}")
        slug = slugify_facet(name)
        if not slug or len(name) > 64 or len(slug) > 64:
            raise ValueError("Genre facet names must be between 1 and 64 characters")
        normalized[(dimension, slug)] = {
            "dimension": dimension,
            "slug": slug,
            "name": name,
        }
    if len(normalized) > 32:
        raise ValueError("A genre may have at most 32 facets")
    return sorted(
        normalized.values(), key=lambda item: (item["dimension"], item["slug"])
    )


__all__ = ["GENRE_FACET_DIMENSIONS", "normalize_genre_facets", "slugify_facet"]
