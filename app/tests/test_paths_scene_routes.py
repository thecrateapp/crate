from copy import deepcopy
from unittest.mock import Mock

import pytest

from crate.db import paths_scene
from crate.track_versions import track_song_identity


def _genre(*, parents=(), related=(), influenced_by=(), fusion_of=()):
    return {
        "parents": list(parents),
        "related": list(related),
        "influenced_by": list(influenced_by),
        "fusion_of": list(fusion_of),
    }


@pytest.fixture
def bridge_catalog():
    # Hierarchy and edges captured from the catalog on 2026-10-28.
    return {
        "punk": _genre(related=["japanoise"]),
        "punk-rock": _genre(parents=["punk"]),
        "new-wave": _genre(
            parents=["alternative", "rock"],
            related=["industrial"],
            influenced_by=["electronic", "punk-rock"],
        ),
        "electronic": _genre(),
        "industrial": _genre(
            parents=["electronic"],
            related=["japanoise", "new-wave"],
            influenced_by=["noise"],
        ),
        "japanoise": _genre(
            parents=["harsh-noise"],
            related=["experimental", "industrial", "noise", "punk"],
            influenced_by=["industrial", "punk"],
        ),
        "harsh-noise": _genre(parents=["noise"]),
        "noise": _genre(parents=["experimental"], related=["japanoise"]),
        "experimental": _genre(related=["japanoise"]),
        "alternative": _genre(parents=["rock"]),
        "rock": _genre(),
    }


@pytest.fixture(autouse=True)
def canonical_slugs_without_catalog_reads(monkeypatch):
    monkeypatch.setattr(paths_scene, "resolve_genre_slug", lambda value: value)


def _rename_catalog(catalog):
    names = {
        "punk": "source",
        "punk-rock": "source-child",
        "new-wave": "gentle-bridge",
        "electronic": "destination",
        "industrial": "a-return",
        "japanoise": "a-specialized-detour",
        "harsh-noise": "deep-child",
        "noise": "middle-child",
        "experimental": "other-root",
        "alternative": "related-child",
        "rock": "related-root",
    }
    return {
        names[slug]: {
            relation: [names[neighbor] for neighbor in neighbors]
            for relation, neighbors in meta.items()
        }
        for slug, meta in catalog.items()
    }, names


@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("renamed", [False, True])
def test_broad_journey_prefers_gradual_scene_over_specialized_cultural_shortcut(
    monkeypatch, bridge_catalog, reverse, renamed
):
    names = {slug: slug for slug in bridge_catalog}
    catalog = bridge_catalog
    if renamed:
        catalog, names = _rename_catalog(catalog)
    original = deepcopy(catalog)
    load_catalog = Mock(return_value=catalog)
    monkeypatch.setattr(paths_scene, "get_genre_catalog", load_catalog)
    expected = [names[slug] for slug in ["punk", "punk-rock", "new-wave", "electronic"]]
    if reverse:
        expected.reverse()

    route = paths_scene.build_scene_genre_route(expected[0], expected[-1])

    assert route == expected
    assert catalog == original
    load_catalog.assert_called_once_with()


@pytest.mark.parametrize("reverse", [False, True])
def test_specialized_scene_remains_a_valid_explicit_endpoint(
    monkeypatch, bridge_catalog, reverse
):
    monkeypatch.setattr(paths_scene, "get_genre_catalog", lambda: bridge_catalog)
    endpoints = ["punk", "japanoise"]
    if reverse:
        endpoints.reverse()

    route = paths_scene.build_scene_genre_route(*endpoints)

    assert [route[0], route[-1]] == endpoints
    assert len(route) == len(set(route))


def test_cultural_shortcut_remains_usable_without_a_gradual_alternative(
    monkeypatch, bridge_catalog
):
    catalog = {
        slug: meta
        for slug, meta in bridge_catalog.items()
        if slug not in {"punk-rock", "new-wave", "alternative", "rock"}
    }
    monkeypatch.setattr(paths_scene, "get_genre_catalog", lambda: catalog)

    route = paths_scene.build_scene_genre_route("punk", "electronic")

    assert [route[0], route[-1]] == ["punk", "electronic"]
    assert "japanoise" in route
    assert len(route) == len(set(route))


def _direct_bridge_catalog():
    return {
        "source": _genre(influenced_by=["a-historical"]),
        "destination": _genre(
            parents=["source"],
            related=["z-gradual"],
            influenced_by=["a-historical"],
        ),
        "a-historical": _genre(parents=["depth-two"]),
        "depth-two": _genre(parents=["depth-one"]),
        "depth-one": _genre(parents=["other-root"]),
        "other-root": _genre(),
        "z-gradual": _genre(parents=["source"], related=["destination"]),
    }


def test_inserted_bridge_prefers_specificity_continuity_before_historical_rank(
    monkeypatch,
):
    catalog = _direct_bridge_catalog()
    monkeypatch.setattr(paths_scene, "get_genre_catalog", lambda: catalog)

    assert paths_scene.build_scene_genre_route("source", "destination") == [
        "source",
        "z-gradual",
        "destination",
    ]


@pytest.mark.parametrize("has_historical_bridge", [False, True])
def test_inserted_bridge_ignores_unresolved_shared_links(
    monkeypatch, has_historical_bridge
):
    influences = ["historical"] if has_historical_bridge else []
    catalog = {
        "source": _genre(related=["missing"], influenced_by=influences),
        "destination": _genre(
            parents=["source"], related=["missing"], influenced_by=influences
        ),
    }
    if has_historical_bridge:
        catalog.update(
            {
                "historical": _genre(parents=["depth-two"]),
                "depth-two": _genre(parents=["depth-one"]),
                "depth-one": _genre(parents=["other-root"]),
                "other-root": _genre(),
            }
        )
    monkeypatch.setattr(paths_scene, "get_genre_catalog", lambda: catalog)

    route = paths_scene.build_scene_genre_route("source", "destination")

    assert route == ["source", *influences, "destination"]
    assert all(slug in catalog for slug in route)


@pytest.mark.parametrize("extra_deep_parent", [False, True])
def test_equal_specificity_keeps_historical_ranking_and_uses_shortest_parent_depth(
    monkeypatch, extra_deep_parent
):
    catalog = _direct_bridge_catalog()
    catalog["a-historical"]["parents"] = ["source"]
    if extra_deep_parent:
        catalog["a-historical"]["parents"].append("depth-two")
    monkeypatch.setattr(paths_scene, "get_genre_catalog", lambda: catalog)

    assert paths_scene.build_scene_genre_route("source", "destination") == [
        "source",
        "a-historical",
        "destination",
    ]


def test_scene_route_is_independent_of_catalog_insertion_order(
    monkeypatch, bridge_catalog
):
    monkeypatch.setattr(paths_scene, "get_genre_catalog", lambda: bridge_catalog)
    first = paths_scene.build_scene_genre_route("punk", "electronic")
    reverse_catalog = dict(reversed(list(bridge_catalog.items())))
    monkeypatch.setattr(paths_scene, "get_genre_catalog", lambda: reverse_catalog)

    assert paths_scene.build_scene_genre_route("punk", "electronic") == first


@pytest.mark.parametrize("renamed", [False, True])
def test_long_route_keeps_base_when_only_optional_scene_is_too_specialized(
    monkeypatch, bridge_catalog, renamed
):
    catalog = bridge_catalog
    names = {slug: slug for slug in catalog}
    if renamed:
        catalog, names = _rename_catalog(catalog)
    base = [names[slug] for slug in ["electronic", "new-wave", "punk-rock", "punk"]]
    original = deepcopy(catalog)
    load_catalog = Mock(return_value=catalog)
    monkeypatch.setattr(paths_scene, "get_genre_catalog", load_catalog)

    expanded = paths_scene._expand_genre_scene_route(base, step_count=100)

    assert expanded == base
    assert catalog == original
    load_catalog.assert_called_once_with()


@pytest.mark.parametrize(
    ("step_count", "expected_extras"), [(20, 0), (32, 2), (48, 3), (100, 3)]
)
def test_long_expansion_filters_deep_optional_scenes_before_applying_its_cap(
    monkeypatch, step_count, expected_extras
):
    base = ["source", "bridge", "electronic"]
    safe_scenes = ["house", "industrial", "techno", "trip-hop"]
    catalog = {
        "source": _genre(),
        "bridge": _genre(parents=["source"]),
        "electronic": _genre(related=["deep-related"]),
        "middle": _genre(parents=["electronic"]),
        "deep-related": _genre(parents=["middle"]),
        **{slug: _genre(parents=["electronic"]) for slug in safe_scenes},
    }
    monkeypatch.setattr(paths_scene, "get_genre_catalog", lambda: catalog)

    expanded = paths_scene._expand_genre_scene_route(base, step_count=step_count)

    assert "deep-related" not in expanded
    assert expanded[: len(base)] == base
    assert expanded[-1] == base[-1]
    if expected_extras:
        extras = expanded[len(base) : -1]
        assert len(extras) == expected_extras
        assert len(extras) == len(set(extras))
        assert set(extras) <= {*safe_scenes, "middle"}
    else:
        assert expanded == base


def test_long_expansion_keeps_a_requested_specialized_destination(
    monkeypatch, bridge_catalog
):
    base = ["punk", "industrial", "japanoise"]
    monkeypatch.setattr(paths_scene, "get_genre_catalog", lambda: bridge_catalog)

    expanded = paths_scene._expand_genre_scene_route(base, step_count=100)

    assert expanded[: len(base)] == base
    assert expanded[-1] == "japanoise"


def _scene_candidate(track_id, genre_slug):
    return {
        "id": track_id,
        "title": f"Journey song {track_id}",
        "artist": f"Performer {track_id}",
        "genre_slug": genre_slug,
        "artist_genre_slugs": [genre_slug],
        "membership_score": 1.0,
        "artist_popularity_score": 0.5,
        "track_popularity_score": 0.5,
        "duration": 180.0,
        "bpm": 120.0,
        "audio_key": "C",
        "audio_scale": "major",
        "energy": 0.4,
        "bliss_vector": [0.1] * 20,
    }


@pytest.mark.parametrize("builder", ["genre", "artist"])
@pytest.mark.parametrize(
    ("guide_count", "requested_steps"), [(6, 5), (120, 100), (6, 100)]
)
def test_scene_builders_fit_the_requested_budget_without_requiring_every_guide(
    builder, guide_count, requested_steps
):
    route = [f"scene-{index}" for index in range(guide_count)]
    rows_per_genre = (requested_steps + guide_count - 2) // (guide_count - 1) + 2
    candidates = {
        slug: [
            _scene_candidate(index * rows_per_genre + offset + 1, slug)
            for offset in range(rows_per_genre)
        ]
        for index, slug in enumerate(route)
    }
    original_route = list(route)
    original_candidates = deepcopy(candidates)
    if builder == "genre":
        tracks = paths_scene.build_scene_path_from_candidates(
            route, candidates, step_count=requested_steps
        )
    else:
        endpoint_candidates = {
            "origin": [candidates[route[0]][0]],
            "destination": [candidates[route[-1]][0]],
        }
        tracks = paths_scene.build_artist_scene_path_from_candidates(
            route, endpoint_candidates, candidates, step_count=requested_steps
        )
        assert tracks[0]["id"] == endpoint_candidates["origin"][0]["id"]
        assert tracks[-1]["id"] == endpoint_candidates["destination"][0]["id"]

    assert len(tracks) == requested_steps
    assert tracks[0]["genre_slug"] == route[0]
    assert tracks[-1]["genre_slug"] == route[-1]
    assert len({track["id"] for track in tracks}) == requested_steps
    assert len({track_song_identity(track) for track in tracks}) == requested_steps
    positions = {slug: index for index, slug in enumerate(route)}
    selected_positions = [positions[track["genre_slug"]] for track in tracks]
    assert selected_positions == sorted(selected_positions)
    assert route == original_route
    assert candidates == original_candidates


@pytest.mark.parametrize("step_count", [0, 5, 100])
def test_route_slot_budget_handles_empty_guides(step_count):
    assert paths_scene._expand_route_slots([], step_count) == []


@pytest.mark.parametrize("step_count", [-1, 0, 1])
def test_route_slot_budget_clamps_internal_single_slot_to_the_origin(step_count):
    assert paths_scene._expand_route_slots(
        ["origin", "guide", "destination"], step_count
    ) == ["origin"]


@pytest.mark.parametrize(
    ("catalog", "origin", "destination", "expected"),
    [
        (
            {},
            "missing-source",
            "missing-destination",
            ["missing-source", "missing-destination"],
        ),
        (
            {"source": _genre(), "destination": _genre()},
            "source",
            "destination",
            ["source", "destination"],
        ),
        ({}, "source", "source", ["source"]),
        ({}, "", "destination", []),
    ],
)
def test_missing_or_disconnected_taxonomy_keeps_existing_fallback(
    monkeypatch, catalog, origin, destination, expected
):
    monkeypatch.setattr(paths_scene, "get_genre_catalog", lambda: catalog)

    assert paths_scene.build_scene_genre_route(origin, destination) == expected


def test_rootless_cycles_terminate_without_revisiting_every_node(monkeypatch):
    catalog = {
        f"cycle-{index}": _genre(parents=[f"cycle-{(index + 1) % 80}"])
        for index in range(80)
    }
    catalog["destination"] = _genre()
    load_catalog = Mock(return_value=catalog)
    neighbors = Mock(wraps=paths_scene._genre_neighbors)
    monkeypatch.setattr(paths_scene, "get_genre_catalog", load_catalog)
    monkeypatch.setattr(paths_scene, "_genre_neighbors", neighbors)

    assert paths_scene.build_scene_genre_route("cycle-0", "destination") == [
        "cycle-0",
        "destination",
    ]
    assert neighbors.call_count <= len(catalog)
    load_catalog.assert_called_once_with()
