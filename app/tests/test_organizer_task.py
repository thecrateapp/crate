from pathlib import Path
from unittest.mock import patch

import pytest

from crate.organizer import organize_album
from crate.storage_layout import UnsafeMutationPathError
from crate.worker_handlers.management import _handle_organize_album

MANAGEMENT = "crate.worker_handlers.management"
TAGS = {
    "01.flac": {"title": "Intro", "tracknumber": "1"},
    "02.flac": {"title": "Outro", "tracknumber": "2"},
}


@pytest.fixture
def library(tmp_path: Path) -> Path:
    root = tmp_path / "music"
    album = root / "Artist" / "Album"
    album.mkdir(parents=True)
    for name in TAGS:
        (album / name).write_bytes(b"audio")
    return root


@pytest.fixture
def outside(tmp_path: Path) -> Path:
    victim = tmp_path / "victim"
    victim.mkdir()
    (victim / "keep.flac").write_bytes(b"audio")
    return victim


@pytest.fixture(autouse=True)
def fake_tags(monkeypatch):
    monkeypatch.setattr(
        "crate.organizer.read_tags",
        lambda path: TAGS.get(f"{Path(path).name[:2]}.flac", {}),
    )


@pytest.fixture
def worker_side_effects(monkeypatch):
    calls: dict[str, list] = {"events": [], "audit": [], "progress": []}
    monkeypatch.setattr(
        f"{MANAGEMENT}.emit_task_event",
        lambda *args, **_kwargs: calls["events"].append(args),
    )
    monkeypatch.setattr(
        f"{MANAGEMENT}.log_audit", lambda *args, **_kwargs: calls["audit"].append(args)
    )
    monkeypatch.setattr(
        f"{MANAGEMENT}.emit_progress",
        lambda _task_id, progress, **_kwargs: calls["progress"].append(
            (progress.done, progress.total)
        ),
    )
    monkeypatch.setattr(
        f"{MANAGEMENT}._broadcast_track_library_invalidation", lambda *_a: None
    )
    return calls


def _album_lookup(monkeypatch, path: Path | str) -> None:
    monkeypatch.setattr(
        f"{MANAGEMENT}.get_library_album_by_id",
        lambda album_id: {
            "id": album_id,
            "artist": "Artist",
            "name": "Album",
            "path": str(path),
        },
    )


def _names(directory: Path) -> list[str]:
    return sorted(child.name for child in directory.iterdir())


def test_worker_renames_tracks_inside_the_library(
    monkeypatch, library, worker_side_effects
):
    album = library / "Artist" / "Album"
    _album_lookup(monkeypatch, album)

    result = _handle_organize_album(
        "task-1",
        {"album_id": 7, "rename_folder": "Album (2001)", "actor_user_id": 3},
        {"library_path": str(library), "audio_extensions": [".flac"]},
    )

    renamed = library / "Artist" / "Album (2001)"
    assert result["renamed_tracks"] == 2
    assert result["folder_renamed"] == "Album (2001)"
    assert result["album_id"] == 7
    assert "error" not in result
    assert _names(renamed) == ["01 - Intro.flac", "02 - Outro.flac"]
    assert not album.exists()
    assert worker_side_effects["progress"] == [(1, 2), (2, 2)]
    assert worker_side_effects["audit"][0][0] == "organize_album"


def test_worker_second_run_changes_nothing(monkeypatch, library, worker_side_effects):
    album = library / "Artist" / "Album"
    _album_lookup(monkeypatch, album)
    config = {"library_path": str(library), "audio_extensions": [".flac"]}

    _handle_organize_album("task-1", {"album_id": 7}, config)
    result = _handle_organize_album("task-2", {"album_id": 7}, config)

    assert result["renamed_tracks"] == 0
    assert result["errors"] == []
    assert _names(album) == ["01 - Intro.flac", "02 - Outro.flac"]


@pytest.mark.parametrize("relative", ["", "Artist/.."])
def test_worker_refuses_the_library_root(
    monkeypatch, library, worker_side_effects, relative
):
    (library / "loose.flac").write_bytes(b"audio")
    _album_lookup(monkeypatch, library / relative if relative else library)

    result = _handle_organize_album(
        "task-1",
        {"album_id": 7, "rename_folder": "renamed"},
        {"library_path": str(library), "audio_extensions": [".flac"]},
    )

    assert "error" in result
    assert (library / "loose.flac").exists()
    assert library.is_dir()
    assert worker_side_effects["audit"] == []


def test_worker_refuses_albums_outside_the_library(
    monkeypatch, library, outside, worker_side_effects
):
    _album_lookup(monkeypatch, outside)

    result = _handle_organize_album(
        "task-1",
        {"album_id": 7, "rename_folder": "renamed"},
        {"library_path": str(library), "audio_extensions": [".flac"]},
    )

    assert "error" in result
    assert _names(outside) == ["keep.flac"]


def test_worker_refuses_symlinked_albums_that_leave_the_library(
    monkeypatch, library, outside, worker_side_effects
):
    link = library / "Artist" / "Linked"
    link.symlink_to(outside, target_is_directory=True)
    _album_lookup(monkeypatch, link)

    result = _handle_organize_album(
        "task-1",
        {"album_id": 7},
        {"library_path": str(library), "audio_extensions": [".flac"]},
    )

    assert "error" in result
    assert _names(outside) == ["keep.flac"]


def test_worker_reports_missing_album(monkeypatch, library, worker_side_effects):
    monkeypatch.setattr(f"{MANAGEMENT}.get_library_album_by_id", lambda _id: None)

    result = _handle_organize_album("task-1", {"album_id": 7}, {"library_path": "x"})

    assert result == {"error": "Album not found"}


def test_organize_album_skips_track_links_that_leave_the_roots(library, outside):
    album = library / "Artist" / "Album"
    (album / "03.flac").symlink_to(outside / "keep.flac")

    result = organize_album(album, {".flac"}, roots=(library,))

    assert result["renamed_tracks"] == 2
    assert [error["file"] for error in result["errors"]] == ["03.flac"]
    assert (album / "03.flac").is_symlink()


def test_organize_album_rejects_the_root_before_touching_anything(library):
    (library / "01.flac").write_bytes(b"audio")

    with pytest.raises(UnsafeMutationPathError):
        organize_album(library, {".flac"}, rename_folder="x", roots=(library,))

    assert (library / "01.flac").exists()


@pytest.fixture
def api_library(library):
    with patch("crate.api.organizer.library_path", return_value=library):
        yield library


def _api_album(path: Path | str):
    return patch(
        "crate.api.organizer.get_library_album_by_id",
        return_value={"id": 7, "artist": "Artist", "name": "Album", "path": str(path)},
    )


def test_apply_endpoint_queues_a_task_without_touching_files(test_app, api_library):
    album = api_library / "Artist" / "Album"
    with (
        _api_album(album),
        patch(
            "crate.api.organizer.create_task_dedup", return_value="task-1"
        ) as create_task,
        patch("crate.organizer.organize_album") as organize,
    ):
        response = test_app.post(
            "/api/organize/albums/7/apply",
            json={"pattern": "{track:02d} - {title}", "rename_folder": "New"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "task_id": "task-1",
        "status": "queued",
        "deduplicated": False,
    }
    create_task.assert_called_once_with(
        "library_album_organize",
        {
            "album_id": 7,
            "pattern": "{track:02d} - {title}",
            "rename_folder": "New",
            "actor_user_id": 1,
        },
        dedup_key="library_album_organize:7",
    )
    organize.assert_not_called()
    assert _names(album) == ["01.flac", "02.flac"]


def test_apply_endpoint_returns_the_running_task_when_deduplicated(
    test_app, api_library
):
    with (
        _api_album(api_library / "Artist" / "Album"),
        patch("crate.api.organizer.create_task_dedup", return_value=None),
        patch(
            "crate.api.organizer.find_active_task_by_type_params",
            return_value="task-0",
        ) as find_active,
    ):
        response = test_app.post("/api/organize/albums/7/apply", json={})

    assert response.status_code == 200
    assert response.json()["task_id"] == "task-0"
    assert response.json()["deduplicated"] is True
    assert find_active.call_args.kwargs == {"dedup_key": "library_album_organize:7"}


@pytest.mark.parametrize("where", ["root", "parent", "outside", "missing"])
def test_apply_endpoint_rejects_unsafe_album_paths(
    test_app, api_library, outside, where
):
    paths = {
        "root": api_library,
        "parent": api_library / "Artist" / ".." / "..",
        "outside": outside,
        "missing": api_library / "Artist" / "Gone",
    }
    with (
        _api_album(paths[where]),
        patch("crate.api.organizer.create_task_dedup") as create_task,
    ):
        response = test_app.post("/api/organize/albums/7/apply", json={})

    assert response.status_code == 404
    create_task.assert_not_called()


def test_apply_endpoint_returns_404_for_unknown_album(test_app, api_library):
    with (
        patch("crate.api.organizer.get_library_album_by_id", return_value=None),
        patch("crate.api.organizer.create_task_dedup") as create_task,
    ):
        response = test_app.post("/api/organize/albums/7/apply", json={})

    assert response.status_code == 404
    create_task.assert_not_called()


def test_preview_endpoint_reads_the_stored_album_path(test_app, api_library):
    with _api_album(api_library / "Artist" / "Album"):
        response = test_app.get("/api/organize/albums/7/preview")

    assert response.status_code == 200
    body = response.json()
    assert body["folder_current"] == "Album"
    assert body["changes"] == 2
