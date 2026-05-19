import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException


def _request_for(role: str | None, user_id: int = 1):
    return SimpleNamespace(
        state=SimpleNamespace(
            user={"id": user_id, "email": "test@cratemusic.app", "role": role}
        )
    )


def test_admin_and_owner_have_all_capabilities():
    from crate.api.permissions import ALL_CAPABILITIES, get_user_capabilities

    assert get_user_capabilities({"role": "admin"}) == set(ALL_CAPABILITIES)
    assert get_user_capabilities({"role": "owner"}) == set(ALL_CAPABILITIES)


def test_roles_are_checked_through_casbin_policy():
    from crate.api.permissions import has_capability

    assert has_capability({"role": "editor"}, "library.metadata.write")
    assert not has_capability({"role": "editor"}, "users.manage")
    assert has_capability({"role": "admin"}, "users.manage")
    assert not has_capability({"role": "user"}, "admin.access")


def test_require_permission_returns_user_for_allowed_role():
    from crate.api.permissions import require_permission

    user = require_permission(
        _request_for("librarian"),
        "library.metadata.write",  # type: ignore[arg-type]
    )

    assert user["role"] == "librarian"


def test_require_permission_rejects_authenticated_user_without_capability():
    from crate.api.permissions import require_permission

    with pytest.raises(HTTPException) as exc:
        require_permission(
            _request_for("user"),
            "library.metadata.write",  # type: ignore[arg-type]
        )

    assert exc.value.status_code == 403


def test_require_permission_rejects_anonymous_user():
    from crate.api.permissions import require_permission

    request = SimpleNamespace(state=SimpleNamespace(user=None))

    with pytest.raises(HTTPException) as exc:
        require_permission(request, "library.metadata.write")  # type: ignore[arg-type]

    assert exc.value.status_code == 401


def test_validate_role_rejects_unknown_role():
    from crate.api.permissions import validate_role

    with pytest.raises(HTTPException) as exc:
        validate_role("viewer")

    assert exc.value.status_code == 422


def test_require_admin_uses_admin_access_capability_for_owner():
    from crate.api.auth import _require_admin

    request = _request_for("owner")

    user = _require_admin(request)  # type: ignore[arg-type]

    assert user["role"] == "owner"


def test_require_admin_does_not_grant_legacy_admin_to_partial_roles():
    from crate.api.auth import _require_admin

    with pytest.raises(HTTPException) as exc:
        _require_admin(_request_for("ops"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_admin_update_user_role_validates_persists_and_audits(monkeypatch):
    from crate.api.auth import admin_update_user_role
    from crate.api.schemas.auth import UpdateUserRoleRequest

    target = {
        "id": 2,
        "email": "editor@test.com",
        "name": "Editor",
        "avatar": None,
        "role": "user",
    }
    updated = {**target, "role": "editor"}
    lookups = [target, updated]
    audit = MagicMock()

    monkeypatch.setattr(
        "crate.api.auth.get_user_by_id", lambda _user_id: lookups.pop(0)
    )
    monkeypatch.setattr(
        "crate.api.auth.update_user", lambda _user_id, **fields: {**target, **fields}
    )
    monkeypatch.setattr("crate.api.auth.list_user_external_identities", lambda _id: [])
    monkeypatch.setattr("crate.api.auth.list_sessions", lambda *_args, **_kwargs: [])
    monkeypatch.setattr("crate.api.auth.get_user_presence", lambda _id: {})
    monkeypatch.setattr("crate.api.auth.log_audit", audit)

    result = asyncio.run(
        admin_update_user_role(
            _request_for("admin", user_id=1),  # type: ignore[arg-type]
            2,
            UpdateUserRoleRequest(role="editor"),
        )
    )

    assert result["role"] == "editor"
    assert "library.metadata.write" in result["capabilities"]
    audit.assert_called_once()
    assert audit.call_args.args[:3] == ("update_user_role", "user", "editor@test.com")
    assert audit.call_args.kwargs["user_id"] == 1
    assert audit.call_args.kwargs["details"]["before"] == {"role": "user"}
    assert audit.call_args.kwargs["details"]["after"] == {"role": "editor"}


def test_admin_update_user_role_prevents_self_lockout(monkeypatch):
    from crate.api.auth import admin_update_user_role
    from crate.api.schemas.auth import UpdateUserRoleRequest

    monkeypatch.setattr(
        "crate.api.auth.get_user_by_id",
        lambda _id: {
            "id": 1,
            "email": "admin@test.com",
            "name": "Admin",
            "avatar": None,
            "role": "admin",
        },
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            admin_update_user_role(
                _request_for("admin", user_id=1),  # type: ignore[arg-type]
                1,
                UpdateUserRoleRequest(role="user"),
            )
        )

    assert exc.value.status_code == 400


def test_admin_list_users_rejects_regular_user():
    from crate.api.auth import admin_list_users

    with pytest.raises(HTTPException) as exc:
        asyncio.run(admin_list_users(_request_for("user")))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_admin_create_invite_rejects_user_without_manage_capability():
    from crate.api.auth import admin_create_auth_invite
    from crate.api.schemas.auth import AuthInviteRequest

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            admin_create_auth_invite(  # type: ignore[arg-type]
                _request_for("user"),
                AuthInviteRequest(email="invitee@example.test"),
            )
        )

    assert exc.value.status_code == 403


def test_admin_update_user_role_requires_roles_manage():
    from crate.api.auth import admin_update_user_role
    from crate.api.schemas.auth import UpdateUserRoleRequest

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            admin_update_user_role(  # type: ignore[arg-type]
                _request_for("editor"),
                2,
                UpdateUserRoleRequest(role="curator"),
            )
        )

    assert exc.value.status_code == 403


def test_tags_api_queues_actor_user_id_for_metadata_edit(tmp_path, monkeypatch):
    from crate.api.schemas.utility import TrackTagsUpdate
    from crate.api.tags import _update_track_tags

    album_dir = tmp_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    track = album_dir / "01 - Song.flac"
    track.write_bytes(b"fake")
    created: list[tuple[str, dict]] = []

    monkeypatch.setattr("crate.api.tags.library_path", lambda: tmp_path)
    monkeypatch.setattr(
        "crate.api.tags.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-1",
    )

    response = _update_track_tags(
        _request_for("editor", user_id=42),  # type: ignore[arg-type]
        "Artist/Album/01 - Song.flac",
        TrackTagsUpdate(title="Song"),
    )

    assert response == {"task_id": "task-1"}
    assert created == [
        (
            "update_track_tags",
            {
                "filepath": "Artist/Album/01 - Song.flac",
                "tags": {"title": "Song"},
                "actor_user_id": 42,
            },
        )
    ]


def test_update_track_tags_writes_audit_entry(tmp_path, monkeypatch):
    from crate.worker_handlers.management import _handle_update_track_tags

    track = tmp_path / "Artist" / "Album" / "01 - Song.flac"
    track.parent.mkdir(parents=True)
    track.write_bytes(b"fake")

    class FakeAudio(dict):
        def save(self):
            self.saved = True

    fake_audio = FakeAudio(title=["Old Song"])
    audit = MagicMock()

    monkeypatch.setattr("mutagen.File", lambda *_args, **_kwargs: fake_audio)
    monkeypatch.setattr("crate.worker_handlers.management.log_audit", audit)

    result = _handle_update_track_tags(
        "task-1",
        {
            "filepath": "Artist/Album/01 - Song.flac",
            "tags": {"title": "New Song"},
            "actor_user_id": 42,
        },
        {"library_path": str(tmp_path)},
    )

    assert result == {"status": "ok", "file": "01 - Song.flac"}
    audit.assert_called_once()
    _, _, target_name = audit.call_args.args[:3]
    assert target_name == "Artist/Album/01 - Song.flac"
    assert audit.call_args.kwargs["user_id"] == 42
    assert audit.call_args.kwargs["details"]["before"] == {"title": ["Old Song"]}
    assert audit.call_args.kwargs["details"]["after"] == {"title": ["New Song"]}


def test_system_playlists_allow_playlist_curator(monkeypatch):
    from crate.api.system_playlists import admin_list_system_playlists

    playlist = {
        "id": 23,
        "name": "Curated Mix",
        "description": "Test",
        "scope": "system",
        "generation_mode": "static",
        "is_curated": True,
        "is_active": True,
        "artwork_tracks": [],
        "follower_count": 0,
    }

    monkeypatch.setattr(
        "crate.api.system_playlists.list_system_playlists",
        lambda **_kwargs: [playlist],
    )

    response = admin_list_system_playlists(  # type: ignore[arg-type]
        _request_for("curator"),
    )

    assert response[0]["id"] == 23


def test_system_playlists_reject_metadata_editor():
    from crate.api.system_playlists import admin_list_system_playlists

    with pytest.raises(HTTPException) as exc:
        admin_list_system_playlists(  # type: ignore[arg-type]
            _request_for("editor"),
        )

    assert exc.value.status_code == 403


def test_genre_curator_can_queue_taxonomy_cleanup(monkeypatch):
    from crate.api.genres import cleanup_invalid_taxonomy_nodes

    monkeypatch.setattr("crate.api.genres.list_tasks", lambda **_kwargs: [])
    monkeypatch.setattr(
        "crate.api.genres.create_task",
        lambda task_type, params: f"{task_type}:{params}",
    )

    response = cleanup_invalid_taxonomy_nodes(  # type: ignore[arg-type]
        _request_for("curator")
    )

    assert response == {
        "task_id": "cleanup_invalid_genre_taxonomy:{}",
        "status": "queued",
        "deduplicated": False,
    }


def test_genre_taxonomy_cleanup_rejects_metadata_editor():
    from crate.api.genres import cleanup_invalid_taxonomy_nodes

    with pytest.raises(HTTPException) as exc:
        cleanup_invalid_taxonomy_nodes(  # type: ignore[arg-type]
            _request_for("editor")
        )

    assert exc.value.status_code == 403


def test_sync_shows_allows_show_curator(monkeypatch):
    from crate.api.tasks import api_sync_shows

    monkeypatch.setattr("crate.api.tasks.list_tasks", lambda **_kwargs: [])
    monkeypatch.setattr(
        "crate.api.tasks.create_task",
        lambda task_type: f"task:{task_type}",
    )

    response = api_sync_shows(_request_for("curator"))  # type: ignore[arg-type]

    assert response == {"task_id": "task:sync_shows"}


def test_sync_shows_rejects_metadata_editor():
    from crate.api.tasks import api_sync_shows

    with pytest.raises(HTTPException) as exc:
        api_sync_shows(_request_for("editor"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_new_release_check_allows_release_curator(monkeypatch):
    from crate.api.acquisition import api_check_new_releases

    monkeypatch.setattr(
        "crate.api.acquisition.create_task",
        lambda task_type, params: f"{task_type}:{params}",
    )

    response = api_check_new_releases(  # type: ignore[arg-type]
        _request_for("curator")
    )

    assert response == {"task_id": "check_new_releases:{}"}


def test_new_release_dismiss_requires_release_curator(monkeypatch):
    from crate.api.acquisition import api_dismiss_release

    dismissed: list[int] = []
    monkeypatch.setattr(
        "crate.api.acquisition.mark_release_dismissed",
        lambda release_id: dismissed.append(release_id),
    )

    response = api_dismiss_release(  # type: ignore[arg-type]
        _request_for("curator"),
        77,
    )

    assert response == {"ok": True}
    assert dismissed == [77]

    with pytest.raises(HTTPException) as exc:
        api_dismiss_release(  # type: ignore[arg-type]
            _request_for("user"),
            77,
        )

    assert exc.value.status_code == 403


def test_tidal_refresh_allows_librarian_without_admin_access(monkeypatch):
    from crate.api.tidal import tidal_refresh

    monkeypatch.setattr("crate.api.tidal.tidal.refresh_token", lambda: True)

    response = tidal_refresh(_request_for("librarian"))  # type: ignore[arg-type]

    assert response == {"success": True}


def test_tidal_refresh_rejects_regular_user():
    from crate.api.tidal import tidal_refresh

    with pytest.raises(HTTPException) as exc:
        tidal_refresh(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_acquisition_queue_cleanup_allows_librarian_without_admin_access(
    monkeypatch,
):
    from crate.api.acquisition import clear_completed

    monkeypatch.setattr(
        "crate.api.acquisition.soulseek.clear_completed_downloads",
        lambda: True,
    )

    response = clear_completed(_request_for("librarian"))  # type: ignore[arg-type]

    assert response == {"cleared": True}


def test_acquisition_queue_cleanup_rejects_metadata_editor():
    from crate.api.acquisition import clear_completed

    with pytest.raises(HTTPException) as exc:
        clear_completed(_request_for("editor"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_bandcamp_admin_collection_allows_librarian_without_admin_access(
    monkeypatch,
):
    from crate.api.bandcamp import api_admin_bandcamp_collection

    monkeypatch.setattr(
        "crate.api.bandcamp.list_admin_user_collections",
        lambda _relation_type, limit: [{"id": 1, "limit": limit}],
    )

    response = api_admin_bandcamp_collection(  # type: ignore[arg-type]
        _request_for("librarian"),
        relation_type="collection",
        limit=25,
    )

    assert response.total == 1
    assert response.items[0]["limit"] == 25


def test_bandcamp_admin_collection_rejects_regular_user():
    from crate.api.bandcamp import api_admin_bandcamp_collection

    with pytest.raises(HTTPException) as exc:
        api_admin_bandcamp_collection(  # type: ignore[arg-type]
            _request_for("user"),
            relation_type="collection",
        )

    assert exc.value.status_code == 403


def test_ops_snapshot_allows_ops_role_without_admin_access(monkeypatch):
    from crate.api.admin_ops import api_admin_ops_snapshot

    monkeypatch.setattr(
        "crate.api.admin_ops.get_cached_ops_snapshot",
        lambda fresh=False: {"fresh": fresh, "ok": True},
    )

    response = api_admin_ops_snapshot(  # type: ignore[arg-type]
        _request_for("ops"),
        fresh=True,
    )

    assert response == {"fresh": True, "ok": True}


def test_ops_snapshot_rejects_regular_user():
    from crate.api.admin_ops import api_admin_ops_snapshot

    with pytest.raises(HTTPException) as exc:
        api_admin_ops_snapshot(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_tasks_snapshot_allows_ops_role_without_admin_access(monkeypatch):
    from crate.api.tasks import api_admin_tasks_snapshot

    monkeypatch.setattr(
        "crate.api.tasks.get_cached_tasks_surface",
        lambda limit=100, fresh=False: {"limit": limit, "fresh": fresh},
    )

    response = api_admin_tasks_snapshot(  # type: ignore[arg-type]
        _request_for("ops"),
        fresh=True,
        limit=25,
    )

    assert response == {"limit": 25, "fresh": True}


def test_tasks_snapshot_rejects_metadata_editor():
    from crate.api.tasks import api_admin_tasks_snapshot

    with pytest.raises(HTTPException) as exc:
        api_admin_tasks_snapshot(_request_for("editor"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_stack_status_allows_runtime_ops_role_without_admin_access(monkeypatch):
    from crate.api.stack import stack_status

    monkeypatch.setattr(
        "crate.api.stack.get_cached_stack_surface",
        lambda fresh=False: {"stack": {"available": True, "fresh": fresh}},
    )

    response = stack_status(_request_for("ops"), fresh=True)  # type: ignore[arg-type]

    assert response == {"available": True, "fresh": True}


def test_stack_status_rejects_metadata_editor():
    from crate.api.stack import stack_status

    with pytest.raises(HTTPException) as exc:
        stack_status(_request_for("editor"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_logs_snapshot_allows_ops_role_without_admin_access(monkeypatch):
    from crate.api.admin_metrics import admin_logs_snapshot

    monkeypatch.setattr(
        "crate.api.admin_metrics.get_cached_logs_surface",
        lambda limit=100, fresh=False: {"limit": limit, "fresh": fresh},
    )

    response = admin_logs_snapshot(  # type: ignore[arg-type]
        _request_for("ops"),
        fresh=True,
        limit=40,
    )

    assert response == {"limit": 40, "fresh": True}


def test_logs_snapshot_rejects_regular_user():
    from crate.api.admin_metrics import admin_logs_snapshot

    with pytest.raises(HTTPException) as exc:
        admin_logs_snapshot(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_library_health_check_allows_librarian_without_admin_access(monkeypatch):
    from crate.api.management import run_health_check

    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: f"{task_type}:{params['triggered_by']}",
    )

    response = run_health_check(_request_for("librarian"))  # type: ignore[arg-type]

    assert response == {"task_id": "health_check:console"}


def test_library_health_check_rejects_metadata_editor():
    from crate.api.management import run_health_check

    with pytest.raises(HTTPException) as exc:
        run_health_check(_request_for("editor"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_full_album_delete_requires_librarian_file_delete_capability(monkeypatch):
    from crate.api.management import delete_album_by_id
    from crate.api.schemas.management import DeleteRequest

    created: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        "crate.api.management.album_names_from_id",
        lambda _album_id: ("Artist", "Album"),
    )
    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-1",
    )

    response = delete_album_by_id(  # type: ignore[arg-type]
        _request_for("librarian"),
        123,
        DeleteRequest(mode="full"),
    )

    assert response == {"task_id": "task-1"}
    assert created == [
        ("delete_album", {"artist": "Artist", "album": "Album", "mode": "full"})
    ]

    with pytest.raises(HTTPException) as exc:
        delete_album_by_id(  # type: ignore[arg-type]
            _request_for("editor"),
            123,
            DeleteRequest(mode="full"),
        )

    assert exc.value.status_code == 403


def test_import_queue_allows_librarian_without_admin_access(monkeypatch):
    from crate.api.imports import api_imports_pending

    monkeypatch.setattr(
        "crate.api.imports.list_import_queue_items",
        lambda status: [{"status": status}],
    )

    response = api_imports_pending(_request_for("librarian"))  # type: ignore[arg-type]

    assert response == [{"status": "pending"}]


def test_import_queue_rejects_regular_user():
    from crate.api.imports import api_imports_pending

    with pytest.raises(HTTPException) as exc:
        api_imports_pending(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_scanner_start_allows_librarian_without_admin_access(monkeypatch):
    from crate.api.scanner import start_scan
    from crate.api.schemas.operations import ScanRequest

    monkeypatch.setattr("crate.api.scanner.list_tasks", lambda **_kwargs: [])
    monkeypatch.setattr(
        "crate.api.scanner.create_task",
        lambda task_type, params: f"{task_type}:{params.get('only')}",
    )

    response = start_scan(  # type: ignore[arg-type]
        _request_for("librarian"),
        ScanRequest(only="High Vis"),
    )

    assert response == {
        "status": "started",
        "task_id": "scan:High Vis",
        "only": "High Vis",
    }


def test_scanner_start_rejects_regular_user():
    from crate.api.scanner import start_scan

    with pytest.raises(HTTPException) as exc:
        start_scan(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_metadata_editor_can_queue_lyrics_sync(monkeypatch):
    from crate.api.management import sync_lyrics
    from crate.api.schemas.management import LyricsSyncRequest

    monkeypatch.setattr(
        "crate.api.management.create_task",
        lambda task_type, params: f"{task_type}:{params['artist']}",
    )

    response = sync_lyrics(  # type: ignore[arg-type]
        _request_for("editor"),
        LyricsSyncRequest(artist="High Vis"),
    )

    assert response == {"task_id": "sync_lyrics:High Vis"}


def test_metadata_task_rejects_regular_user():
    from crate.api.management import sync_lyrics
    from crate.api.schemas.management import LyricsSyncRequest

    with pytest.raises(HTTPException) as exc:
        sync_lyrics(  # type: ignore[arg-type]
            _request_for("user"),
            LyricsSyncRequest(artist="High Vis"),
        )

    assert exc.value.status_code == 403


def test_artwork_fetch_allows_metadata_editor_without_admin_access(monkeypatch):
    from crate.api.artwork import api_artwork_fetch
    from crate.api.schemas.artwork import ArtworkFetchRequest

    monkeypatch.setattr(
        "crate.api.artwork.create_task",
        lambda task_type, params: f"{task_type}:{params['mbid']}",
    )

    response = api_artwork_fetch(  # type: ignore[arg-type]
        _request_for("editor"),
        ArtworkFetchRequest(mbid="release-mbid", path="Artist/Album"),
    )

    assert response == {"status": "queued", "task_id": "fetch_cover:release-mbid"}


def test_artwork_fetch_rejects_regular_user():
    from crate.api.artwork import api_artwork_fetch
    from crate.api.schemas.artwork import ArtworkFetchRequest

    with pytest.raises(HTTPException) as exc:
        api_artwork_fetch(  # type: ignore[arg-type]
            _request_for("user"),
            ArtworkFetchRequest(mbid="release-mbid", path="Artist/Album"),
        )

    assert exc.value.status_code == 403


def test_match_candidates_allow_metadata_editor_without_admin_access(
    tmp_path,
    monkeypatch,
):
    from crate.api.matcher import api_match_album

    album_dir = tmp_path / "Artist" / "Album"
    album_dir.mkdir(parents=True)
    monkeypatch.setattr("crate.api.matcher.library_path", lambda: tmp_path)
    monkeypatch.setattr("crate.api.matcher.extensions", lambda: {".flac"})
    monkeypatch.setattr("crate.api.matcher.find_album_dir", lambda *_args: album_dir)
    monkeypatch.setattr(
        "crate.api.matcher.match_album",
        lambda _album_dir, _exts: [{"title": "Album"}],
    )

    response = api_match_album(  # type: ignore[arg-type]
        _request_for("editor"),
        "Artist",
        "Album",
    )

    assert response == [{"title": "Album"}]


def test_match_candidates_reject_regular_user():
    from crate.api.matcher import api_match_album

    with pytest.raises(HTTPException) as exc:
        api_match_album(  # type: ignore[arg-type]
            _request_for("user"),
            "Artist",
            "Album",
        )

    assert exc.value.status_code == 403


def test_album_enrich_allows_metadata_editor_without_admin_access(monkeypatch):
    from crate.api.browse_album import api_enrich_album

    created: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        "crate.api.browse_album.get_library_album_by_id",
        lambda _album_id: {"artist": "High Vis", "name": "Blending"},
    )
    monkeypatch.setattr(
        "crate.api.browse_album.create_task",
        lambda task_type, params: created.append((task_type, params)) or "task-1",
    )

    response = api_enrich_album(_request_for("editor"), 7)  # type: ignore[arg-type]

    assert response == {"task_id": "task-1"}
    assert created == [
        (
            "process_new_content",
            {
                "artist": "High Vis",
                "album": "Blending",
                "force": True,
                "triggered_by": "ui",
            },
        )
    ]


def test_album_enrich_rejects_regular_user():
    from crate.api.browse_album import api_enrich_album

    with pytest.raises(HTTPException) as exc:
        api_enrich_album(_request_for("user"), 7)  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_artist_enrich_allows_metadata_editor_without_admin_access(monkeypatch):
    from crate.api.browse_artist import api_artist_enrich

    queued: list[tuple[str, bool, str]] = []
    monkeypatch.setattr(
        "crate.content.queue_process_new_content_if_needed",
        lambda name, force, triggered_by: (
            queued.append((name, force, triggered_by)) or "task-artist"
        ),
    )

    response = api_artist_enrich(  # type: ignore[arg-type]
        _request_for("editor"),
        "High Vis",
    )

    assert response == {"status": "queued", "task_id": "task-artist"}
    assert queued == [("High Vis", True, "ui")]


def test_artist_enrich_rejects_regular_user():
    from crate.api.browse_artist import api_artist_enrich

    with pytest.raises(HTTPException) as exc:
        api_artist_enrich(  # type: ignore[arg-type]
            _request_for("user"),
            "High Vis",
        )

    assert exc.value.status_code == 403


def test_organizer_presets_allow_metadata_editor_without_admin_access():
    from crate.api.organizer import api_organize_presets
    from crate.organizer import PRESETS

    response = api_organize_presets(_request_for("editor"))  # type: ignore[arg-type]

    assert response == PRESETS


def test_organizer_presets_reject_regular_user():
    from crate.api.organizer import api_organize_presets

    with pytest.raises(HTTPException) as exc:
        api_organize_presets(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_batch_retag_allows_metadata_editor_without_admin_access(monkeypatch):
    from crate.api.batch import api_batch_retag
    from crate.api.schemas.operations import BatchAlbumItem, BatchRetagRequest

    monkeypatch.setattr(
        "crate.api.batch.create_task",
        lambda task_type, params: f"{task_type}:{len(params['albums'])}",
    )

    response = api_batch_retag(  # type: ignore[arg-type]
        _request_for("editor"),
        BatchRetagRequest(albums=[BatchAlbumItem(artist="High Vis", album="Blending")]),
    )

    assert response == {"status": "queued", "task_id": "batch_retag:1", "count": 1}


def test_batch_retag_rejects_regular_user():
    from crate.api.batch import api_batch_retag
    from crate.api.schemas.operations import BatchRetagRequest

    with pytest.raises(HTTPException) as exc:
        api_batch_retag(  # type: ignore[arg-type]
            _request_for("user"),
            BatchRetagRequest(albums=[]),
        )

    assert exc.value.status_code == 403


def test_playback_delivery_allows_ops_health_without_admin_access(monkeypatch):
    from crate.api.playback_admin import api_admin_playback_delivery

    monkeypatch.setattr(
        "crate.api.playback_admin.get_playback_delivery_snapshot",
        lambda limit=20: {"limit": limit, "items": []},
    )
    monkeypatch.setattr("crate.api.playback_admin.load_config", lambda: {})
    monkeypatch.setattr(
        "crate.api.playback_admin.get_stream_transcode_runtime",
        lambda _config: {"available": True},
    )

    response = api_admin_playback_delivery(  # type: ignore[arg-type]
        _request_for("ops"),
        limit=8,
    )

    assert response == {"limit": 8, "items": [], "runtime": {"available": True}}


def test_playback_delivery_rejects_regular_user():
    from crate.api.playback_admin import api_admin_playback_delivery

    with pytest.raises(HTTPException) as exc:
        api_admin_playback_delivery(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_sync_library_allows_librarian_without_admin_access(monkeypatch):
    from crate.api.tasks import api_sync_library

    monkeypatch.setattr("crate.api.tasks.list_tasks", lambda **_kwargs: [])
    monkeypatch.setattr(
        "crate.api.tasks.create_task",
        lambda task_type: f"task:{task_type}",
    )

    response = api_sync_library(_request_for("librarian"))  # type: ignore[arg-type]

    assert response == {"task_id": "task:library_sync", "status": "started"}


def test_sync_library_rejects_metadata_editor():
    from crate.api.tasks import api_sync_library

    with pytest.raises(HTTPException) as exc:
        api_sync_library(_request_for("editor"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_backfill_similarities_allows_metadata_editor_without_admin_access(
    monkeypatch,
):
    from crate.api.tasks import api_backfill_similarities

    monkeypatch.setattr("crate.api.tasks.list_tasks", lambda **_kwargs: [])
    monkeypatch.setattr(
        "crate.api.tasks.create_task",
        lambda task_type: f"task:{task_type}",
    )

    response = api_backfill_similarities(  # type: ignore[arg-type]
        _request_for("editor")
    )

    assert response == {"task_id": "task:backfill_similarities"}


def test_backfill_similarities_rejects_regular_user():
    from crate.api.tasks import api_backfill_similarities

    with pytest.raises(HTTPException) as exc:
        api_backfill_similarities(_request_for("user"))  # type: ignore[arg-type]

    assert exc.value.status_code == 403


def test_artist_enrichment_allows_library_viewer_without_admin_access(monkeypatch):
    from crate.api.enrichment import get_artist_enrichment

    monkeypatch.setattr(
        "crate.api.enrichment.get_cache", lambda *_args, **_kwargs: None
    )
    monkeypatch.setattr("crate.api.enrichment.get_library_artist", lambda _name: None)
    monkeypatch.setattr(
        "crate.api.enrichment._fetch_enrichment",
        lambda _name: {"lastfm": {"bio": "Bio"}},
    )
    monkeypatch.setattr(
        "crate.api.enrichment.set_cache", lambda *_args, **_kwargs: None
    )

    response = get_artist_enrichment(  # type: ignore[arg-type]
        _request_for("user"),
        "High Vis",
    )

    assert response == {"lastfm": {"bio": "Bio"}}


def test_artist_enrichment_rejects_anonymous_request():
    from crate.api.enrichment import get_artist_enrichment

    request = SimpleNamespace(state=SimpleNamespace(user=None))

    with pytest.raises(HTTPException) as exc:
        get_artist_enrichment(request, "High Vis")  # type: ignore[arg-type]

    assert exc.value.status_code == 401
