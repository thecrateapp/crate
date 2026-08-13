from __future__ import annotations

import base64
import io
from unittest.mock import patch

import pytest
from PIL import Image
from sqlalchemy import text

from tests.conftest import PG_AVAILABLE


def _image_bytes(size: tuple[int, int] = (1800, 1200)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color=(28, 72, 96)).save(buffer, "PNG")
    return buffer.getvalue()


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_gallery_deduplicates_assets_and_assigns_one_asset_to_multiple_slots(pg_db):
    from crate.db.repositories.artist_artwork_assets import (
        assign_artist_artwork_slot,
        create_or_get_artist_artwork_asset,
        list_artist_artwork_assets,
    )
    from crate.db.tx import read_scope

    pg_db.upsert_artist({"name": "Gallery Artist"})
    with read_scope() as session:
        artist_id = session.execute(
            text("SELECT id FROM library_artists WHERE name = 'Gallery Artist'")
        ).scalar_one()

    first = create_or_get_artist_artwork_asset(
        artist_id=artist_id,
        checksum="a" * 64,
        storage_path=".crate/artwork-gallery/aa/source.jpg",
        origin="manual-upload",
        label="Press photo",
        mime_type="image/jpeg",
        width=1800,
        height=1200,
    )
    duplicate = create_or_get_artist_artwork_asset(
        artist_id=artist_id,
        checksum="a" * 64,
        storage_path=".crate/artwork-gallery/aa/source.jpg",
        origin="manual-upload",
        label="Duplicate upload",
        mime_type="image/jpeg",
        width=1800,
        height=1200,
    )
    assign_artist_artwork_slot(artist_id=artist_id, slot="avatar", asset_id=first["id"])
    assign_artist_artwork_slot(
        artist_id=artist_id, slot="hero_mobile", asset_id=first["id"]
    )

    assets = list_artist_artwork_assets(artist_id)

    assert duplicate["id"] == first["id"]
    assert len(assets) == 1
    assert assets[0]["slots"] == ["avatar", "hero_mobile"]


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_gallery_deletes_only_unassigned_assets(pg_db):
    from crate.db.repositories.artist_artwork_assets import (
        assign_artist_artwork_slot,
        create_or_get_artist_artwork_asset,
        delete_artist_artwork_asset,
        get_artist_artwork_asset,
    )
    from crate.db.tx import read_scope

    pg_db.upsert_artist({"name": "Delete Gallery Artist"})
    with read_scope() as session:
        artist_id = session.execute(
            text("SELECT id FROM library_artists WHERE name = 'Delete Gallery Artist'")
        ).scalar_one()

    removable = create_or_get_artist_artwork_asset(
        artist_id=artist_id,
        checksum="b" * 64,
        storage_path=".crate/artwork-gallery/bb/removable.jpg",
        origin="manual-upload",
        label="Removable photo",
        mime_type="image/jpeg",
        width=1800,
        height=1200,
    )
    assigned = create_or_get_artist_artwork_asset(
        artist_id=artist_id,
        checksum="c" * 64,
        storage_path=".crate/artwork-gallery/cc/assigned.jpg",
        origin="manual-upload",
        label="Assigned photo",
        mime_type="image/jpeg",
        width=1800,
        height=1200,
    )
    assign_artist_artwork_slot(
        artist_id=artist_id, slot="avatar", asset_id=assigned["id"]
    )

    deleted = delete_artist_artwork_asset(artist_id=artist_id, asset_id=removable["id"])
    blocked = delete_artist_artwork_asset(artist_id=artist_id, asset_id=assigned["id"])

    assert deleted["id"] == removable["id"]
    assert blocked is None
    assert get_artist_artwork_asset(artist_id, removable["id"]) is None
    assert get_artist_artwork_asset(artist_id, assigned["id"]) is not None


def test_gallery_worker_imports_validated_image_into_artist_storage(
    monkeypatch, tmp_path
):
    from crate.worker_handlers.artwork import _handle_import_artist_artwork_asset

    artist_dir = tmp_path / "Converge"
    artist_dir.mkdir()
    persisted: list[dict] = []
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_library_artist",
        lambda name: {"id": 7, "entity_uid": "artist-entity", "name": name},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.resolve_artist_dir",
        lambda *args, **kwargs: artist_dir,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.create_or_get_artist_artwork_asset",
        lambda **kwargs: persisted.append(kwargs) or {"id": 41, **kwargs},
    )

    result = _handle_import_artist_artwork_asset(
        "task-1",
        {
            "artist": "Converge",
            "data_b64": base64.b64encode(_image_bytes()).decode(),
            "filename": "press.png",
            "origin": "manual-upload",
            "label": "Press photo",
        },
        {"library_path": str(tmp_path)},
    )

    stored = artist_dir / persisted[0]["storage_path"]
    assert result["asset_id"] == 41
    assert stored.is_file()
    assert Image.open(stored).size == (1800, 1200)
    assert persisted[0]["checksum"] == result["checksum"]


def test_gallery_worker_assigns_asset_to_independent_mobile_hero_source(
    monkeypatch, tmp_path
):
    from crate.worker_handlers.artwork import _handle_assign_artist_artwork_slot

    artist_dir = tmp_path / "Converge"
    source = artist_dir / ".crate" / "artwork-gallery" / "aa" / "source.jpg"
    source.parent.mkdir(parents=True)
    source.write_bytes(_image_bytes())
    uploaded: list[dict] = []
    assigned: list[dict] = []

    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_library_artist",
        lambda name: {"id": 7, "entity_uid": "artist-entity", "name": name},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.resolve_artist_dir",
        lambda *args, **kwargs: artist_dir,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_artist_artwork_asset",
        lambda artist_id, asset_id: {
            "id": asset_id,
            "artist_id": artist_id,
            "storage_path": ".crate/artwork-gallery/aa/source.jpg",
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_artist_hero_artwork",
        lambda artist_id: None,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork._handle_upload_image",
        lambda task_id, params, config: (
            uploaded.append(params)
            or {"status": "success", "path": "artist-hero-source-mobile.jpg"}
        ),
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.assign_artist_artwork_slot",
        lambda **kwargs: assigned.append(kwargs) or True,
    )

    result = _handle_assign_artist_artwork_slot(
        "task-assign",
        {
            "artist": "Converge",
            "artist_id": 7,
            "slot": "hero_mobile",
            "asset_id": 41,
        },
        {"library_path": str(tmp_path)},
    )

    assert result == {
        "status": "assigned",
        "artist_id": 7,
        "asset_id": 41,
        "slot": "hero_mobile",
        "path": "artist-hero-source-mobile.jpg",
    }
    assert uploaded[0]["type"] == "artist_hero"
    assert uploaded[0]["composition"] == "mobile"
    assert uploaded[0]["source_origin"] == "gallery:41"
    assert assigned == [{"artist_id": 7, "slot": "hero_mobile", "asset_id": 41}]


def test_gallery_worker_deletes_unassigned_asset_file_and_record(monkeypatch, tmp_path):
    from crate.worker_handlers.artwork import _handle_delete_artist_artwork_asset

    artist_dir = tmp_path / "Converge"
    source = artist_dir / ".crate" / "artwork-gallery" / "aa" / "source.jpg"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"source")

    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_library_artist",
        lambda name: {"id": 7, "entity_uid": "artist-entity", "name": name},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.resolve_artist_dir",
        lambda *args, **kwargs: artist_dir,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_artist_artwork_asset",
        lambda artist_id, asset_id: {
            "id": asset_id,
            "artist_id": artist_id,
            "storage_path": ".crate/artwork-gallery/aa/source.jpg",
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.delete_artist_artwork_asset",
        lambda **kwargs: {
            "id": kwargs["asset_id"],
            "storage_path": ".crate/artwork-gallery/aa/source.jpg",
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork._broadcast_artwork_invalidation",
        lambda *scopes: None,
    )

    result = _handle_delete_artist_artwork_asset(
        "task-delete",
        {"artist": "Converge", "artist_id": 7, "asset_id": 41},
        {"library_path": str(tmp_path)},
    )

    assert result == {"status": "deleted", "artist_id": 7, "asset_id": 41}
    assert not source.exists()


def test_gallery_worker_keeps_asset_when_assignment_races_delete(monkeypatch, tmp_path):
    from crate.worker_handlers.artwork import _handle_delete_artist_artwork_asset

    artist_dir = tmp_path / "Converge"
    source = artist_dir / ".crate" / "artwork-gallery" / "aa" / "source.jpg"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"source")

    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_library_artist",
        lambda name: {"id": 7, "entity_uid": "artist-entity", "name": name},
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.resolve_artist_dir",
        lambda *args, **kwargs: artist_dir,
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.get_artist_artwork_asset",
        lambda artist_id, asset_id: {
            "id": asset_id,
            "artist_id": artist_id,
            "storage_path": ".crate/artwork-gallery/aa/source.jpg",
        },
    )
    monkeypatch.setattr(
        "crate.worker_handlers.artwork.delete_artist_artwork_asset",
        lambda **kwargs: None,
    )

    result = _handle_delete_artist_artwork_asset(
        "task-delete",
        {"artist": "Converge", "artist_id": 7, "asset_id": 41},
        {"library_path": str(tmp_path)},
    )

    assert result == {"error": "Artwork asset is assigned to a slot"}
    assert source.is_file()


def test_gallery_endpoint_returns_curated_assets_with_same_origin_previews(test_app):
    with (
        patch("crate.api.artwork.artist_name_from_id", return_value="Converge"),
        patch(
            "crate.api.artwork.list_artist_artwork_assets",
            return_value=[
                {
                    "id": 41,
                    "artist_id": 7,
                    "origin": "manual-upload",
                    "label": "Press photo",
                    "mime_type": "image/jpeg",
                    "width": 1800,
                    "height": 1200,
                    "checksum": "a" * 64,
                    "slots": ["avatar"],
                    "created_at": "2026-08-01T12:00:00+00:00",
                }
            ],
        ),
    ):
        response = test_app.get("/api/artwork/artists/7/assets")

    assert response.status_code == 200
    asset = response.json()["assets"][0]
    assert asset["preview_url"] == "/api/artwork/artists/7/assets/41/preview"
    assert asset["slots"] == ["avatar"]


def test_gallery_delete_endpoint_queues_worker_for_existing_asset(test_app):
    with (
        patch("crate.api.artwork.artist_name_from_id", return_value="Converge"),
        patch(
            "crate.api.artwork.get_artist_artwork_asset",
            return_value={"id": 41, "artist_id": 7},
        ),
        patch("crate.api.artwork.create_task", return_value="task-delete") as create,
    ):
        response = test_app.delete("/api/artwork/artists/7/assets/41")

    assert response.status_code == 200
    assert response.json()["task_id"] == "task-delete"
    assert create.call_args.args == (
        "delete_artist_artwork_asset",
        {"artist": "Converge", "artist_id": 7, "asset_id": 41},
    )


def test_gallery_upload_and_slot_assignment_are_queued_for_the_worker(test_app):
    with (
        patch("crate.api.artwork.artist_name_from_id", return_value="Converge"),
        patch(
            "crate.api.artwork.create_task", side_effect=["task-import", "task-assign"]
        ) as create,
    ):
        upload = test_app.post(
            "/api/artwork/artists/7/assets/upload",
            files={"file": ("press.png", _image_bytes(), "image/png")},
        )
        assign = test_app.post(
            "/api/artwork/artists/7/slots/hero_mobile",
            json={"asset_id": 41},
        )

    assert upload.status_code == 200
    assert upload.json()["task_id"] == "task-import"
    assert assign.status_code == 200
    assert assign.json()["task_id"] == "task-assign"
    assert create.call_args_list[0].args[0] == "import_artist_artwork_asset"
    assert create.call_args_list[1].args == (
        "assign_artist_artwork_slot",
        {"artist": "Converge", "artist_id": 7, "slot": "hero_mobile", "asset_id": 41},
    )


def test_gallery_rejects_unknown_artwork_slots(test_app):
    with patch("crate.api.artwork.artist_name_from_id", return_value="Converge"):
        response = test_app.post(
            "/api/artwork/artists/7/slots/unknown",
            json={"asset_id": 41},
        )

    assert response.status_code == 422
