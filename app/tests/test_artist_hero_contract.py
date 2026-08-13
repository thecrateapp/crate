from crate.artist_hero_contract import (
    ARTIST_HERO_CONTRACT_VERSION,
    artist_hero_composition_view,
    artist_hero_recipe_hash,
)


def test_recipe_hash_is_stable_for_equivalent_recipe_mappings() -> None:
    first = {"mode": "extend", "position_x": 0.5, "crop": {"width": 10, "x": 0}}
    second = {"crop": {"x": 0, "width": 10}, "position_x": 0.5, "mode": "extend"}

    assert artist_hero_recipe_hash(first) == artist_hero_recipe_hash(second)


def test_composition_view_describes_the_canonical_render() -> None:
    recipe = {
        "mode": "extend",
        "crop": {"x": 0, "y": 0, "width": 2000, "height": 1000},
        "position_x": 0.5,
        "position_y": 0.5,
        "scale": 1.0,
    }

    view = artist_hero_composition_view(
        artist_id=42,
        composition="desktop",
        recipe=recipe,
        source_size=(2000, 1000),
        render_revision="cover-fit-v4:abc123",
    )

    assert view["schema_version"] == ARTIST_HERO_CONTRACT_VERSION
    assert view["composition"] == "desktop"
    assert view["width"] == 1480
    assert view["height"] == 600
    assert view["render_revision"] == "cover-fit-v4:abc123"
    assert len(view["recipe_hash"]) == 16
    assert view["asset_path"].startswith("/api/artists/42/hero?")
    assert set(view["bounds"]) == {"left", "top", "right", "bottom"}
