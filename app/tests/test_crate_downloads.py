"""Crate ZIP downloads prepared by the worker and served from the download cache."""

from uuid import uuid4
from zipfile import ZIP_STORED, ZipFile

import pytest
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


@pytest.fixture
def download_env(test_app, monkeypatch, tmp_path):
    from crate.api.auth import AuthMiddleware

    async def resolve_test_user(self, request):
        user_id = request.headers.get("x-test-user")
        if not user_id:
            return None
        return {"id": int(user_id), "role": "user", "username": f"user-{user_id}"}

    dispatched: list[tuple[str, str]] = []
    monkeypatch.setattr(AuthMiddleware, "resolve_user", resolve_test_user)
    monkeypatch.setattr(
        "crate.db.repositories.tasks_mutations.dispatch_task",
        lambda task_type, task_id: dispatched.append((task_type, task_id)),
    )
    monkeypatch.setenv("CRATE_DOWNLOAD_CACHE_DIR", str(tmp_path / "cache"))
    library_root = tmp_path / "library"
    library_root.mkdir()
    return {
        "client": test_app,
        "library_root": library_root,
        "dispatched": dispatched,
    }


@pytest.fixture
def worker_events(monkeypatch):
    from crate.worker_handlers import crate_download as handler_module

    events: list[tuple[str, str, dict]] = []
    monkeypatch.setattr(
        handler_module,
        "emit_task_event",
        lambda task_id, event_type, data=None: events.append(
            (task_id, event_type, data or {})
        ),
    )
    monkeypatch.setattr(handler_module, "emit_progress", lambda *args, **kwargs: None)
    return events


def _headers(user_id: int) -> dict[str, str]:
    return {"x-test-user": str(user_id)}


def _create_user(email: str) -> int:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        return int(
            session.execute(
                text(
                    """
                    INSERT INTO users (email, name, password_hash, created_at)
                    VALUES (:email, 'Download user', 'test-hash', NOW())
                    RETURNING id
                    """
                ),
                {"email": email},
            ).scalar_one()
        )


def _seed_crate_with_local_tracks(
    library_root,
    *,
    name: str = "Year-end records",
    visibility: str = "private",
    album: str = "Download Album",
) -> str:
    from crate.db.repositories.crates import create_crate
    from crate.db.tx import transaction_scope

    crate_id = create_crate(owner_id=1, name=name, visibility=visibility)
    album_dir = library_root / "Download Artist" / album
    album_dir.mkdir(parents=True, exist_ok=True)
    (album_dir / "cover.jpg").write_bytes(b"cover")
    artist_uid = str(uuid4())
    album_uid = str(uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO global_catalog_artists (
                    global_artist_uid, canonical_name, sort_name, normalized_name
                ) VALUES (:uid, :name, :name, :name)
                """
            ),
            {"uid": artist_uid, "name": f"Download Artist {artist_uid[:8]}"},
        )
        session.execute(
            text(
                """
                INSERT INTO global_catalog_albums (
                    global_album_uid, global_artist_uid, canonical_name,
                    normalized_name, artist_name
                ) VALUES (:uid, :artist_uid, :album, :album, 'Download Artist')
                """
            ),
            {"uid": album_uid, "artist_uid": artist_uid, "album": album},
        )
        for number in (1, 2):
            path = album_dir / f"{number:02d} - Track.flac"
            path.write_bytes(f"audio-{number}".encode())
            track_id = session.execute(
                text(
                    """
                    INSERT INTO library_tracks (
                        artist, album, filename, title, track_number, path, size,
                        updated_at
                    ) VALUES (
                        'Download Artist', :album, :filename, :title,
                        :number, :path, :size, NOW()
                    )
                    RETURNING id
                    """
                ),
                {
                    "album": album,
                    "filename": path.name,
                    "title": f"Track {number} {uuid4()}",
                    "number": number,
                    "path": str(path),
                    "size": path.stat().st_size,
                },
            ).scalar_one()
            session.execute(
                text(
                    """
                    INSERT INTO global_catalog_tracks (
                        global_track_uid, global_album_uid, global_artist_uid,
                        canonical_title, normalized_title, artist_name,
                        album_name, disc_number, track_number, has_local,
                        local_track_id
                    ) VALUES (
                        CAST(:track_uid AS uuid), CAST(:album_uid AS uuid),
                        CAST(:artist_uid AS uuid), :title, :title,
                        'Download Artist', :album, 1, :number, TRUE,
                        :track_id
                    )
                    """
                ),
                {
                    "track_uid": str(uuid4()),
                    "album_uid": album_uid,
                    "artist_uid": artist_uid,
                    "title": f"Track {number}",
                    "album": album,
                    "number": number,
                    "track_id": track_id,
                },
            )
        session.execute(
            text(
                """
                INSERT INTO crate_albums (crate_id, global_album_uid, position, added_by)
                VALUES (CAST(:crate_id AS uuid), CAST(:album_uid AS uuid), 1, 1)
                """
            ),
            {"crate_id": crate_id, "album_uid": album_uid},
        )
    return crate_id


def _run_worker(task_id: str, crate_id: str, library_root) -> dict:
    from crate.worker_handlers.crate_download import CRATE_DOWNLOAD_TASK_HANDLERS

    return CRATE_DOWNLOAD_TASK_HANDLERS["crate_download"](
        task_id, {"crate_id": crate_id}, {"library_path": str(library_root)}
    )


def test_worker_builds_crate_zip_into_download_cache(
    pg_db, download_env, worker_events
):
    from crate.download_cache import crate_cache_ttl_seconds, find_cached_download

    library_root = download_env["library_root"]
    crate_id = _seed_crate_with_local_tracks(library_root)

    result = _run_worker("crate-task", crate_id, library_root)

    assert result["filename"] == "Year-end records.zip"
    assert result["download_url"] == (
        f"/api/crates/{crate_id}/download/{result['cache_key']}"
    )
    assert result["tracks"] == 2
    found = find_cached_download(
        "crate", result["cache_key"], ttl_seconds=crate_cache_ttl_seconds()
    )
    assert found is not None
    cached, metadata = found
    assert metadata["crate_id"] == crate_id
    assert metadata["filename"] == "Year-end records.zip"
    with ZipFile(cached.path) as archive:
        assert archive.namelist() == [
            "Download Artist/Download Album/01 - Track.flac",
            "Download Artist/Download Album/cover.jpg",
            "Download Artist/Download Album/02 - Track.flac",
        ]
        assert {info.compress_type for info in archive.infolist()} == {ZIP_STORED}
    progress = [
        data for _, event_type, data in worker_events if event_type == "progress"
    ]
    assert progress[0]["done"] == 0
    assert progress[-1]["done"] == progress[-1]["total"] == 2


def test_worker_reuses_cached_artifact(pg_db, download_env, worker_events):
    library_root = download_env["library_root"]
    crate_id = _seed_crate_with_local_tracks(library_root)

    first = _run_worker("crate-task-1", crate_id, library_root)
    worker_events.clear()
    second = _run_worker("crate-task-2", crate_id, library_root)

    assert second["cache_key"] == first["cache_key"]
    assert worker_events == []


def test_post_download_queues_a_deduplicated_task_until_ready(
    pg_db, download_env, worker_events
):
    client = download_env["client"]
    library_root = download_env["library_root"]
    crate_id = _seed_crate_with_local_tracks(library_root)
    url = f"/api/crates/{crate_id}/download"

    first = client.post(url, headers=_headers(1))
    second = client.post(url, headers=_headers(1))

    assert first.status_code == 202
    assert first.json() == {
        "status": "pending",
        "task_id": first.json()["task_id"],
        "filename": "Year-end records.zip",
        "download_url": None,
    }
    assert second.status_code == 202
    assert second.json()["task_id"] == first.json()["task_id"]
    task_id = first.json()["task_id"]
    assert download_env["dispatched"] == [("crate_download", task_id)]
    task = pg_db.get_task(task_id)
    assert task["type"] == "crate_download"
    assert task["params"] == {"crate_id": crate_id}

    result = _run_worker(task_id, crate_id, library_root)
    ready = client.post(url, headers=_headers(1))

    assert ready.status_code == 200
    assert ready.json() == {
        "status": "ready",
        "download_url": result["download_url"],
        "filename": "Year-end records.zip",
        "task_id": None,
    }

    artifact = client.get(result["download_url"], headers=_headers(1))
    assert artifact.status_code == 200
    assert artifact.headers["content-type"] == "application/zip"
    assert "Year-end%20records.zip" in artifact.headers["content-disposition"]


def test_post_download_without_local_tracks_is_not_found(pg_db, download_env):
    from crate.db.repositories.crates import create_crate

    crate_id = create_crate(owner_id=1, name="Empty")

    response = download_env["client"].post(
        f"/api/crates/{crate_id}/download", headers=_headers(1)
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Crate has no downloadable local tracks"


def test_cached_artifact_requires_crate_access(pg_db, download_env, worker_events):
    client = download_env["client"]
    library_root = download_env["library_root"]
    stranger_id = _create_user(f"download-stranger-{uuid4()}@example.test")
    private_id = _seed_crate_with_local_tracks(library_root)
    public_id = _seed_crate_with_local_tracks(
        library_root,
        name="Public records",
        visibility="public",
        album="Public Album",
    )
    private_result = _run_worker("private-task", private_id, library_root)
    public_result = _run_worker("public-task", public_id, library_root)

    assert (
        client.get(private_result["download_url"], headers=_headers(stranger_id))
    ).status_code == 404
    assert (
        client.post(
            f"/api/crates/{private_id}/download", headers=_headers(stranger_id)
        ).status_code
        == 404
    )
    assert (
        client.get(public_result["download_url"], headers=_headers(stranger_id))
    ).status_code == 200
    assert (
        client.post(
            f"/api/crates/{public_id}/download", headers=_headers(stranger_id)
        ).json()["status"]
        == "ready"
    )
    assert (
        client.get(
            f"/api/crates/{public_id}/download/{private_result['cache_key']}",
            headers=_headers(stranger_id),
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/crates/{public_id}/download/..%2F..%2Fetc",
            headers=_headers(stranger_id),
        ).status_code
        == 404
    )
    assert client.get(public_result["download_url"]).status_code == 401


def test_expired_cached_artifact_is_not_served(
    pg_db, download_env, worker_events, monkeypatch
):
    library_root = download_env["library_root"]
    crate_id = _seed_crate_with_local_tracks(library_root)
    result = _run_worker("crate-task", crate_id, library_root)
    monkeypatch.setenv("CRATE_DOWNLOAD_CACHE_CRATE_TTL_SECONDS", "0")

    response = download_env["client"].get(result["download_url"], headers=_headers(1))

    assert response.status_code == 404


def _cache_key_for(crate_id: str) -> str:
    from crate.db.queries.crates import get_crate_download_source
    from crate.download_cache import crate_download_cache_key

    crate, tracks = get_crate_download_source(crate_id)
    return crate_download_cache_key(crate, tracks)


def test_prune_sweeps_stale_tmp_files(download_env):
    import os
    import time

    from crate.download_cache import download_cache_root, prune_download_cache

    artifact_dir = download_cache_root() / "crate" / "ab" / "cd" / ("abcd" + "0" * 60)
    artifact_dir.mkdir(parents=True)
    stale = artifact_dir / ".Crate.zip.dead.tmp"
    fresh = artifact_dir / ".Crate.zip.live.tmp"
    stale.write_bytes(b"partial")
    fresh.write_bytes(b"partial")
    old = time.time() - 4 * 3600
    os.utime(stale, (old, old))

    result = prune_download_cache()

    assert not stale.exists()
    assert fresh.exists()
    assert result["removed"] == 1
    assert result["bytes_removed"] == len(b"partial")


def test_build_removes_leftover_tmp_files_for_its_key(
    pg_db, download_env, worker_events
):
    from crate.download_cache import cached_download_artifact_path

    library_root = download_env["library_root"]
    crate_id = _seed_crate_with_local_tracks(library_root)
    artifact_dir = cached_download_artifact_path(
        "crate", _cache_key_for(crate_id), "Year-end records.zip"
    ).parent
    artifact_dir.mkdir(parents=True)
    leftover = artifact_dir / ".Year-end records.zip.dead.tmp"
    leftover.write_bytes(b"partial")

    _run_worker("crate-task", crate_id, library_root)

    assert not leftover.exists()
    assert list(artifact_dir.glob(".*.tmp")) == []


def test_worker_fails_fast_when_zip_exceeds_cache_limit(
    pg_db, download_env, worker_events, monkeypatch
):
    from crate.download_cache import DownloadCacheCapacityError, download_cache_root

    library_root = download_env["library_root"]
    crate_id = _seed_crate_with_local_tracks(library_root)
    monkeypatch.setenv("CRATE_DOWNLOAD_CACHE_MAX_BYTES", "100")

    with pytest.raises(DownloadCacheCapacityError, match="download cache limit"):
        _run_worker("crate-task", crate_id, library_root)

    assert list(download_cache_root().rglob("*.zip*")) == []


def test_worker_fails_fast_without_free_disk_space(
    pg_db, download_env, worker_events, monkeypatch
):
    from collections import namedtuple

    from crate import download_cache
    from crate.download_cache import DownloadCacheCapacityError

    library_root = download_env["library_root"]
    crate_id = _seed_crate_with_local_tracks(library_root)
    usage = namedtuple("usage", "total used free")
    monkeypatch.setattr(
        download_cache.shutil, "disk_usage", lambda _path: usage(1, 1, 1024)
    )

    with pytest.raises(DownloadCacheCapacityError, match="Not enough free disk"):
        _run_worker("crate-task", crate_id, library_root)

    assert list(download_cache.download_cache_root().rglob("*.zip*")) == []


@pytest.mark.parametrize("field", ["artist", "album"])
def test_crate_cache_key_changes_when_archive_folders_change(field):
    from crate.download_cache import crate_download_cache_key

    crate = {"id": "crate-id", "name": "Crate"}
    track = {
        "id": 1,
        "path": "/music/a.flac",
        "size": 10,
        "updated_at": "2026-10-03T00:00:00+00:00",
        "artist": "Artist",
        "album": "Album",
    }

    renamed = {**track, field: f"Renamed {field}"}

    assert crate_download_cache_key(crate, [track]) != crate_download_cache_key(
        crate, [renamed]
    )
