"""Service orchestration and compatibility contracts for Music Paths."""

import ast
from pathlib import Path

import pytest

from crate import music_paths as service


@pytest.mark.parametrize("operation", ["create", "regenerate", "preview"])
def test_services_plan_with_owner_before_persistence(monkeypatch, operation):
    plans, writes = [], []
    path = dict(
        id=7,
        name="Path",
        origin=dict(type="artist", value="1"),
        destination=dict(type="genre", value="rock"),
        waypoints=[],
        step_count=5,
    )
    plan = dict(
        origin_label="Artist",
        dest_label="Rock",
        resolved_waypoints=[],
        tracks=[{"track_id": 9}],
    )
    monkeypatch.setattr(
        service, "build_music_path_plan", lambda *a, **k: plans.append(k) or plan
    )
    monkeypatch.setattr(service, "get_music_path", lambda *a, **k: path.copy())
    monkeypatch.setattr(
        service,
        "create_music_path_record",
        lambda **k: writes.append(k) or {"id": 7, "created_at": "today"},
    )
    monkeypatch.setattr(
        service,
        "update_music_path_tracks",
        lambda *a, **kwargs: writes.append(a) or True,
    )
    if operation == "create":
        from crate.db.paths_service_writes import create_music_path

        result = create_music_path(
            12, "Path", "artist", "1", "genre", "rock", step_count=5
        )
    elif operation == "regenerate":
        from crate.db.paths_service_writes import regenerate_music_path

        result = regenerate_music_path(7, 12)
    else:
        from crate.db.paths_service_writes import preview_music_path

        result = preview_music_path(
            "artist", "1", "genre", "rock", step_count=5, user_id=12
        )
    assert plans[0]["user_id"] == 12
    assert result["tracks"] == plan["tracks"]
    assert len(writes) == (0 if operation == "preview" else 1)


def test_waypoints_preserve_acoustic_fallback_and_skip_ai(monkeypatch):
    from crate.db.paths_service_planning import build_music_path_plan, resolve_waypoints

    monkeypatch.setattr(
        service,
        "compute_scene_path",
        lambda **k: pytest.fail("Scene path with waypoints"),
    )
    monkeypatch.setattr(
        service, "resolve_endpoint_label", lambda kind, value: value.title()
    )
    monkeypatch.setattr(
        service,
        "resolve_bliss_centroid",
        lambda kind, value: [1.0, 2.0] if value != "missing" else None,
    )
    monkeypatch.setattr(service, "load_endpoint_contexts", lambda endpoints: [])
    calls = []
    monkeypatch.setattr(
        service, "compute_path", lambda *a, **k: calls.append(a) or [{"track_id": 8}]
    )
    waypoints = [
        {"type": "genre", "value": "punk"},
        {"type": "genre", "value": "missing"},
    ]
    assert len(resolve_waypoints(waypoints)[0]) == 1
    result = build_music_path_plan(
        "genre", "rock", "genre", "folk", waypoints=waypoints
    )
    assert result["tracks"] == [{"track_id": 8}]
    assert result["resolved_waypoints"] == [
        {"type": "genre", "value": "punk", "label": "Punk"}
    ]
    assert calls[0][-1] == [[1.0, 2.0]]
    assert (
        build_music_path_plan("genre", "missing", "genre", "folk", waypoints=waypoints)
        is None
    )


def test_db_preparation_never_executes_ai_and_delegates_remain_thin():
    root = Path(__file__).resolve().parents[1] / "crate"
    source = (root / "db/paths_scene.py").read_text()
    tree = ast.parse(source)
    preparation = next(
        n
        for n in tree.body
        if isinstance(n, ast.FunctionDef) and n.name == "prepare_scene_path"
    )
    assert "refine_music_path_with_llm" not in source
    assert "compute_scene_path(" not in ast.get_source_segment(source, preparation)
    for filename in ["paths_service_planning.py", "paths_service_writes.py"]:
        tree = ast.parse((root / "db" / filename).read_text())
        for node in tree.body:
            if isinstance(node, ast.FunctionDef):
                assert len(node.body) == 2
                assert isinstance(node.body[0], ast.ImportFrom)
                assert node.body[0].module == "crate.music_paths"
                assert isinstance(node.body[1], ast.Return)


def test_legacy_refinement_delegate_forwards_actor_and_candidates(monkeypatch):
    from crate import music_paths_refinement
    from crate.db.paths_llm_refinement import refine_music_path_with_llm

    calls = []
    monkeypatch.setattr(
        music_paths_refinement,
        "refine_music_path_with_llm",
        lambda **k: calls.append(k) or k["tracks"],
    )
    tracks, candidates = [{"id": 1}], {"rock": [{"id": 2}]}
    assert (
        refine_music_path_with_llm(
            origin_label="Rock",
            dest_label="Punk",
            origin_type="genre",
            dest_type="genre",
            tracks=tracks,
            candidates_by_genre=candidates,
            actor_id=12,
        )
        is tracks
    )
    assert calls[0]["actor_id"] == 12
    assert calls[0]["candidates_by_genre"] is candidates
