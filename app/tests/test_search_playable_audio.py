"""S9: search tells Decks whether a track has audio it can stream."""

from __future__ import annotations

from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def _vdj_enabled(monkeypatch):
    monkeypatch.setenv("CRATE_VDJ_ENABLED", "true")


async def _token_user(_middleware, _request):
    return {
        "id": 7,
        "email": "dj@example.test",
        "role": "user",
        "auth_type": "access_token",
        "access_token_id": 42,
        "scopes": ["vdj.catalog.read"],
    }


@pytest.fixture
def library(tmp_path: Path):
    root = tmp_path / "music"
    (root / "Artist" / "Album").mkdir(parents=True)
    (root / "Artist" / "Album" / "present.flac").write_bytes(b"fLaC")
    (root / "Artist" / "Album" / "folder.flac").mkdir()
    (tmp_path / "outside.flac").write_bytes(b"fLaC")
    with patch("crate.streaming.service.library_path", return_value=root):
        yield root


def _dj_tracks(root: Path) -> list[dict]:
    rows = [
        ("present", str(root / "Artist" / "Album" / "present.flac")),
        ("relative", "Artist/Album/present.flac"),
        ("container-path", "/music/Artist/Album/present.flac"),
        ("missing", str(root / "Artist" / "Album" / "missing.flac")),
        ("directory", str(root / "Artist" / "Album" / "folder.flac")),
        ("escape", "../outside.flac"),
        ("absolute-outside", str(root.parent / "outside.flac")),
        ("empty", ""),
        ("null", None),
    ]
    return [
        {"id": index, "title": title, "artist": "A", "album": "B", "path": path}
        for index, (title, path) in enumerate(rows, start=1)
    ]


_EXPECTED_PLAYABLE = {
    "present": True,
    "relative": True,
    # Rows may hold the container path; like the stream endpoint, /music/ maps
    # onto the configured library root.
    "container-path": True,
    "missing": False,
    "directory": False,
    "escape": False,
    "absolute-outside": False,
    "empty": False,
    "null": False,
}


@pytest.mark.parametrize("auth", ["session", "access_token"])
def test_dj_search_marks_whether_each_track_has_audio(test_app, library, auth):
    with ExitStack() as stack:
        dj_search = stack.enter_context(
            patch(
                "crate.api.browse_media.search_dj_tracks",
                return_value=_dj_tracks(library),
            )
        )
        if auth == "access_token":
            stack.enter_context(
                patch("crate.api.auth.AuthMiddleware.resolve_user", _token_user)
            )
        response = test_app.get(
            "/api/search", params={"q": "bpm:120-128", "fields": "dj"}
        )

    assert response.status_code == 200
    tracks = response.json()["tracks"]
    assert {track["title"]: track["playable"] for track in tracks} == (
        _EXPECTED_PLAYABLE
    )
    assert all("path" not in track for track in tracks)
    dj_search.assert_called_once_with("bpm:120-128", 20, include_path=True)


def test_access_token_text_query_also_reports_playable(test_app, library):
    with (
        patch("crate.api.auth.AuthMiddleware.resolve_user", _token_user),
        patch(
            "crate.api.browse_media.search_dj_tracks",
            return_value=_dj_tracks(library)[:1],
        ),
    ):
        response = test_app.get("/api/search", params={"q": "noah"})

    assert response.json()["tracks"][0]["playable"] is True
    assert "path" not in response.json()["tracks"][0]


def test_unreadable_library_counts_as_no_audio(test_app, library):
    tracks = _dj_tracks(library)[:1]
    with (
        patch("crate.api.browse_media.search_dj_tracks", return_value=tracks),
        patch("pathlib.Path.stat", side_effect=PermissionError("denied")),
    ):
        response = test_app.get("/api/search", params={"q": "noah", "fields": "dj"})

    assert response.status_code == 200
    assert response.json()["tracks"][0]["playable"] is False


def test_batch_check_matches_the_per_track_check(library):
    # S3 pages check up to 500 tracks at once; the batch check gives the same
    # answers as the stream endpoints and returns the stat of each regular file.
    from crate.streaming.service import stat_playable_sources

    rows = _dj_tracks(library)
    stats = stat_playable_sources([row["path"] for row in rows])

    assert {
        row["title"]: file_stat is not None
        for row, file_stat in zip(rows, stats, strict=True)
    } == _EXPECTED_PLAYABLE
    present = stats[0]
    assert present is not None
    assert present.st_size == len(b"fLaC")


def test_dj_search_reads_the_library_root_once(test_app, library):
    # library_path() parses config.yaml on every call; a 50-track page must not
    # pay that 50 times.
    with (
        patch(
            "crate.streaming.service.library_path", return_value=library
        ) as library_root,
        patch(
            "crate.api.browse_media.search_dj_tracks",
            return_value=_dj_tracks(library),
        ),
    ):
        response = test_app.get(
            "/api/search", params={"q": "bpm:120-128", "fields": "dj"}
        )

    assert response.status_code == 200
    playable = {
        track["title"]: track["playable"] for track in response.json()["tracks"]
    }
    assert playable == _EXPECTED_PLAYABLE
    assert library_root.call_count == 1


def test_local_search_shape_is_unchanged(test_app):
    # The Go read plane serves plain local search natively and must keep the
    # same JSON shape, so `playable` is only part of the DJ search.
    payload = {
        "artists": [],
        "albums": [],
        "tracks": [
            {"id": 1, "title": "Noah", "artist": "A", "album": "B", "path": "/music/x"}
        ],
    }
    with patch("crate.api.browse_media.search_local_library", return_value=payload):
        response = test_app.get("/api/search", params={"q": "noah"})

    assert "playable" not in response.json()["tracks"][0]


def test_search_dj_tracks_only_returns_paths_on_request(pg_db, tmp_path):
    from tests.test_vdj_search_filters import _library

    from crate.db.queries.browse_media_search import search_dj_tracks

    del pg_db
    _library(tmp_path, [("Alpha", 124.0, "8A", 0.7)], artist="Playable Check")

    without = search_dj_tracks('artist:"playable check"', 50)
    with_path = search_dj_tracks('artist:"playable check"', 50, include_path=True)

    assert "path" not in without[0]
    assert with_path[0]["path"].endswith(".flac")
    assert {key: value for key, value in with_path[0].items() if key != "path"} == (
        without[0]
    )


# ── OpenAPI documentation ────────────────────────────────────────


@pytest.fixture
def components(test_app):
    return test_app.get("/openapi.json").json()["components"]["schemas"]


def test_search_openapi_documents_playable(components):
    tracks = components["SearchResponse"]["properties"]["tracks"]
    assert tracks["items"] == {"$ref": "#/components/schemas/SearchTrackResultResponse"}
    playable = components["SearchTrackResultResponse"]["properties"]["playable"]
    assert "fields=dj" in playable["description"]
    assert "stream" in playable["description"]
