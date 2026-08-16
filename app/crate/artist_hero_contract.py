"""Canonical metadata shared by Artist Hero producers and consumers."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Literal

from crate.artist_hero_artwork import (
    ARTIST_HERO_RENDER_VERSION,
    DESKTOP_HERO_SIZE,
    MOBILE_HERO_SIZE,
    get_artist_hero_artwork_bounds,
)
from crate.utils import coerce_int

ARTIST_HERO_CONTRACT_VERSION = 1


def _canonical_json(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def artist_hero_recipe_hash(recipe: Mapping[str, object]) -> str:
    """Return a stable short hash for a normalized recipe."""

    return hashlib.sha256(_canonical_json(dict(recipe))).hexdigest()[:16]


def artist_hero_composition_view(
    *,
    artist_id: int,
    composition: Literal["desktop", "mobile"],
    recipe: Mapping[str, object],
    source_size: tuple[int, int],
    render_revision: str,
) -> dict[str, object]:
    size = DESKTOP_HERO_SIZE if composition == "desktop" else MOBILE_HERO_SIZE
    bounds = get_artist_hero_artwork_bounds(source_size, recipe, size)
    asset_path = (
        f"/api/artists/{artist_id}/hero?composition={composition}"
        f"&size={size[0]}&v={render_revision}"
    )
    return {
        "schema_version": ARTIST_HERO_CONTRACT_VERSION,
        "composition": composition,
        "render_revision": render_revision,
        "recipe_hash": artist_hero_recipe_hash(recipe),
        "width": size[0],
        "height": size[1],
        "bounds": bounds,
        "asset_path": asset_path,
    }


def artist_hero_composition_views(
    *,
    artist_id: int,
    desktop_recipe: Mapping[str, object],
    mobile_recipe: Mapping[str, object],
    desktop_source_size: tuple[int, int],
    mobile_source_size: tuple[int, int],
    render_revision: str,
) -> dict[str, dict[str, object]]:
    return {
        "desktop": artist_hero_composition_view(
            artist_id=artist_id,
            composition="desktop",
            recipe=desktop_recipe,
            source_size=desktop_source_size,
            render_revision=render_revision,
        ),
        "mobile": artist_hero_composition_view(
            artist_id=artist_id,
            composition="mobile",
            recipe=mobile_recipe,
            source_size=mobile_source_size,
            render_revision=render_revision,
        ),
    }


def artist_hero_profile_compositions(
    *, artist_id: int, profile: Mapping[str, object]
) -> dict[str, dict[str, object]]:
    """Build canonical views from the persisted profile row."""

    generic_size = (
        coerce_int(profile.get("source_width")),
        coerce_int(profile.get("source_height")),
    )
    desktop_size = (
        coerce_int(profile.get("desktop_source_width") or generic_size[0]),
        coerce_int(profile.get("desktop_source_height") or generic_size[1]),
    )
    mobile_size = (
        coerce_int(profile.get("mobile_source_width") or generic_size[0]),
        coerce_int(profile.get("mobile_source_height") or generic_size[1]),
    )
    revision = str(profile.get("revision") or "")
    desktop_recipe = profile.get("desktop_recipe")
    mobile_recipe = profile.get("mobile_recipe")
    if not revision:
        return {}

    compositions: dict[str, dict[str, object]] = {}
    for composition in ("desktop", "mobile"):
        recipe = desktop_recipe if composition == "desktop" else mobile_recipe
        source_size = desktop_size if composition == "desktop" else mobile_size
        # The flags were added after the original profile contract. Treat a
        # missing flag as enabled so existing rows remain compatible.
        if profile.get(f"{composition}_enabled", True) is False:
            continue
        if (
            not isinstance(recipe, Mapping)
            or source_size[0] <= 0
            or source_size[1] <= 0
        ):
            continue
        compositions[composition] = artist_hero_composition_view(
            artist_id=artist_id,
            composition=composition,
            recipe=recipe,
            source_size=source_size,
            render_revision=revision,
        )
    return compositions


def artist_hero_profile_ready_compositions(
    profile: Mapping[str, object],
) -> tuple[str, ...]:
    """Return canonical compositions that are eligible for Featured Artist."""

    if profile.get("provenance") != "manual":
        return ()
    if profile.get("review_status") != "approved":
        return ()
    if not str(profile.get("revision") or "").startswith(
        f"{ARTIST_HERO_RENDER_VERSION}:"
    ):
        return ()

    generic_size = (
        coerce_int(profile.get("source_width")),
        coerce_int(profile.get("source_height")),
    )
    ready: list[str] = []
    for composition in ("desktop", "mobile"):
        if profile.get(f"{composition}_enabled", True) is False:
            continue
        width = coerce_int(
            profile.get(f"{composition}_source_width") or generic_size[0]
        )
        height = coerce_int(
            profile.get(f"{composition}_source_height") or generic_size[1]
        )
        if (
            width > 0
            and height > 0
            and isinstance(profile.get(f"{composition}_recipe"), Mapping)
        ):
            ready.append(composition)
    return tuple(ready)


def artist_hero_profile_contract(
    *, artist_id: int, profile: Mapping[str, object]
) -> dict[str, object]:
    return {
        "schema_version": ARTIST_HERO_CONTRACT_VERSION,
        "render_version": ARTIST_HERO_RENDER_VERSION,
        "compositions": artist_hero_profile_compositions(
            artist_id=artist_id, profile=profile
        ),
    }
