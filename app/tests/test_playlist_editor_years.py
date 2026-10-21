"""Admin metadata saves and canonical year filters preserve persisted playlists."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from crate.api import system_playlists as routes
from crate.db.repositories.playlists_collection_reads import get_playlist
from crate.db.repositories.playlists_create import create_playlist


@pytest.fixture
def editor_year_client(pg_db, monkeypatch):
    monkeypatch.setattr(routes, "_require_playlist_curator", lambda _request: {"id": 1})

    def unexpected_generation(*_args, **_kwargs):
        pytest.fail("Metadata-only changes must not regenerate the playlist")

    monkeypatch.setattr(
        routes, "enqueue_system_playlist_generation", unexpected_generation
    )
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as client:
        yield client


@pytest.mark.parametrize("value", [2000, [2000, 2020]])
def test_metadata_save_omits_unchanged_legacy_year_rules(editor_year_client, value):
    rules = {
        "rules": [
            {
                "field": "year",
                "op": "between" if isinstance(value, list) else "gte",
                "value": value,
            }
        ],
        "max_per_artist": 3,
    }
    playlist_id = create_playlist(
        "Old name",
        scope="system",
        is_smart=True,
        generation_mode="smart",
        smart_rules=rules,
        auto_refresh_enabled=False,
    )
    response = editor_year_client.put(
        f"/api/admin/system-playlists/{playlist_id}",
        json={
            "name": "Renamed",
            "description": "Metadata only",
            "auto_refresh_enabled": False,
        },
    )
    assert response.status_code == 200, response.text
    saved = get_playlist(playlist_id)
    assert saved["name"] == "Renamed"
    assert saved["description"] == "Metadata only"
    assert saved["smart_rules"] == rules
    assert saved["auto_refresh_enabled"] is False


@pytest.mark.parametrize("op,value", [("gte", "2000"), ("between", ["2000", "2020"])])
def test_canonical_editor_year_preview_queries_real_library(
    editor_year_client, pg_db, op, value
):
    pg_db.upsert_artist({"name": "Year Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Year Artist",
            "name": "Album",
            "path": "/music/year",
            "track_count": 1,
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": "Year Artist",
            "album": "Album",
            "filename": "track.flac",
            "title": "Year Track",
            "path": "/music/year/track.flac",
            "year": "2010",
            "format": "flac",
            "duration": 180,
        }
    )
    rules = {
        "rules": [{"field": "year", "op": op, "value": value}],
        "limit": 50,
        "sort": "title",
        "max_per_artist": 3,
    }
    playlist_id = create_playlist(
        "Years",
        scope="system",
        is_smart=True,
        generation_mode="smart",
        smart_rules=rules,
    )
    response = editor_year_client.post(
        f"/api/admin/system-playlists/{playlist_id}/preview",
        json={"smart_rules": rules},
    )
    assert response.status_code == 200, response.text
    assert response.json()["total_matching"] == 1
    assert [track["title"] for track in response.json()["tracks"]] == ["Year Track"]
