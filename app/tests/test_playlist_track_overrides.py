from __future__ import annotations

import pytest

from tests.conftest import PG_AVAILABLE

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _seed_track(pg_db, *, title: str, filename: str) -> dict:
    artist = "Smart Override Artist"
    album = "Smart Override Album"
    pg_db.upsert_artist({"name": artist})
    album_id = pg_db.upsert_album(
        {
            "artist": artist,
            "name": album,
            "path": "/music/smart-override-artist/smart-override-album",
            "track_count": 4,
            "total_size": 0,
            "formats": ["flac"],
        }
    )
    path = f"/music/smart-override-artist/smart-override-album/{filename}"
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": artist,
            "album": album,
            "filename": filename,
            "title": title,
            "track_number": 1,
            "format": "flac",
            "duration": 180,
            "size": 123,
            "path": path,
        }
    )
    return pg_db.get_library_track_by_path(path)


def test_regenerate_playlist_tracks_preserves_manual_locks_and_exclusions(pg_db):
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
    from crate.db.repositories.playlists_tracks import (
        add_playlist_tracks,
        regenerate_playlist_tracks,
        remove_playlist_track,
    )

    manual = _seed_track(pg_db, title="Manual Keep", filename="01-manual.flac")
    excluded = _seed_track(pg_db, title="Removed Once", filename="02-removed.flac")
    fallback = _seed_track(pg_db, title="Fallback", filename="03-fallback.flac")

    playlist_id = create_playlist(
        "Smart Override Playlist",
        is_smart=True,
        smart_rules={"rules": [], "limit": 2, "sort": "random"},
        scope="system",
        generation_mode="smart",
    )

    add_playlist_tracks(
        playlist_id,
        [{"track_id": manual["id"], "source": "manual", "locked": True}],
    )
    first_count = regenerate_playlist_tracks(
        playlist_id,
        [{"track_id": excluded["id"]}, {"track_id": fallback["id"]}],
        target_count=2,
    )
    first_tracks = get_playlist_tracks(playlist_id)

    assert first_count == 2
    assert [track["title"] for track in first_tracks] == [
        "Manual Keep",
        "Removed Once",
    ]
    assert first_tracks[0]["source"] == "manual"
    assert first_tracks[0]["locked"] is True

    remove_playlist_track(playlist_id, 2, record_exclusion=True)
    second_count = regenerate_playlist_tracks(
        playlist_id,
        [{"track_id": excluded["id"]}, {"track_id": fallback["id"]}],
        target_count=2,
    )
    second_tracks = get_playlist_tracks(playlist_id)

    assert second_count == 2
    assert [track["title"] for track in second_tracks] == [
        "Manual Keep",
        "Fallback",
    ]
    assert second_tracks[1]["source"] == "generated"
    assert second_tracks[1]["locked"] is False


def test_reorder_playlist_can_lock_curated_track_order(pg_db):
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
    from crate.db.repositories.playlists_tracks import (
        add_playlist_tracks,
        reorder_playlist,
    )

    first = _seed_track(pg_db, title="First", filename="10-first.flac")
    second = _seed_track(pg_db, title="Second", filename="11-second.flac")
    playlist_id = create_playlist("Manual Reorder Playlist", scope="system")

    add_playlist_tracks(
        playlist_id,
        [
            {"track_id": first["id"], "source": "generated"},
            {"track_id": second["id"], "source": "generated"},
        ],
    )
    tracks = get_playlist_tracks(playlist_id)

    reorder_playlist(
        playlist_id,
        [tracks[1]["id"], tracks[0]["id"]],
        lock_tracks=True,
    )

    reordered = get_playlist_tracks(playlist_id)
    assert [track["title"] for track in reordered] == ["Second", "First"]
    assert [track["locked"] for track in reordered] == [True, True]


def test_reorder_rejects_missing_duplicate_and_library_track_ids(pg_db):
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
    from crate.db.repositories.playlists_tracks import (
        add_playlist_tracks,
        reorder_playlist,
    )

    first = _seed_track(pg_db, title="First", filename="20-first.flac")
    second = _seed_track(pg_db, title="Second", filename="21-second.flac")
    prelude_id = create_playlist("Prelude", scope="system")
    add_playlist_tracks(
        prelude_id, [{"track_id": first["id"]}, {"track_id": second["id"]}]
    )
    playlist_id = create_playlist("Reorder contract", scope="system")
    add_playlist_tracks(
        playlist_id, [{"track_id": first["id"]}, {"track_id": second["id"]}]
    )
    rows = get_playlist_tracks(playlist_id)
    row_ids = [row["id"] for row in rows]

    for invalid in (
        [row_ids[0]],
        [row_ids[0], row_ids[0]],
        [first["id"], second["id"]],
    ):
        with pytest.raises(ValueError, match="permutation"):
            reorder_playlist(playlist_id, invalid)

    assert [row["id"] for row in get_playlist_tracks(playlist_id)] == row_ids


def test_regeneration_keeps_local_identity_when_global_uid_is_present(pg_db):
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
    from crate.db.repositories.playlists_tracks import (
        add_playlist_tracks,
        regenerate_playlist_tracks,
    )
    from tests.test_global_catalog_playlists import _seed_playlist_and_global_track

    local = _seed_track(pg_db, title="Local locked", filename="30-local.flac")
    _other_playlist, _artist, _album, global_uid = _seed_playlist_and_global_track(
        pg_db
    )
    with transaction_scope() as session:
        session.execute(
            text("""UPDATE global_catalog_tracks SET local_track_id=:id,
                local_track_entity_uid=CAST(:uid AS uuid),has_local=TRUE
                WHERE global_track_uid=CAST(:global_uid AS uuid)"""),
            {
                "id": local["id"],
                "uid": str(local["entity_uid"]),
                "global_uid": global_uid,
            },
        )
    playlist_id = create_playlist(
        "Local and global",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules={"rules": [], "limit": 1},
    )
    add_playlist_tracks(
        playlist_id, [{"track_id": local["id"], "source": "manual", "locked": True}]
    )
    before = get_playlist_tracks(playlist_id)[0]
    assert before["global_track_uid"] == global_uid
    regenerate_playlist_tracks(playlist_id, [], target_count=1)
    after = get_playlist_tracks(playlist_id)[0]
    assert after["global_track_uid"] == global_uid
    assert after["track_entity_uid"] == str(local["entity_uid"])
    assert after["track_path"] == local["path"]
    assert after["source"] == "manual" and after["locked"] is True


def test_regeneration_falls_back_to_remote_global_when_local_row_disappears(pg_db):
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
    from crate.db.repositories.playlists_tracks import (
        add_playlist_tracks,
        regenerate_playlist_tracks,
    )
    from tests.test_global_catalog_playlists import _seed_playlist_and_global_track

    local = _seed_track(pg_db, title="Local then remote", filename="31-local.flac")
    _other_playlist, _artist, _album, global_uid = _seed_playlist_and_global_track(
        pg_db
    )
    with transaction_scope() as session:
        session.execute(
            text("""UPDATE global_catalog_tracks SET local_track_id=:id,
                local_track_entity_uid=CAST(:uid AS uuid),has_local=TRUE
                WHERE global_track_uid=CAST(:global_uid AS uuid)"""),
            {
                "id": local["id"],
                "uid": str(local["entity_uid"]),
                "global_uid": global_uid,
            },
        )
    playlist_id = create_playlist(
        "Remote fallback",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules={"rules": [], "limit": 1},
    )
    add_playlist_tracks(
        playlist_id, [{"track_id": local["id"], "source": "manual", "locked": True}]
    )
    with transaction_scope() as session:
        session.execute(
            text("DELETE FROM library_tracks WHERE id=:id"), {"id": local["id"]}
        )
        session.execute(
            text("""UPDATE global_catalog_tracks SET local_track_id=NULL,
            local_track_entity_uid=NULL,has_local=FALSE,has_remote=TRUE
            WHERE global_track_uid=CAST(:global_uid AS uuid)"""),
            {"global_uid": global_uid},
        )
    regenerate_playlist_tracks(playlist_id, [], target_count=1)
    after = get_playlist_tracks(playlist_id)
    assert len(after) == 1
    assert after[0]["global_track_uid"] == global_uid
    assert after[0]["track_entity_uid"] is None
    assert after[0]["source"] == "manual" and after[0]["locked"] is True


@pytest.mark.parametrize("mapping", ["none", "same", "different"])
@pytest.mark.parametrize("override", ["exclusion", "manual", "locked"])
def test_regeneration_matches_global_overrides_across_local_mapping(
    pg_db, mapping, override
):
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    from crate.db.repositories.editorial_plans import snapshot_system_playlist
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
    from crate.db.repositories.playlists_tracks import (
        add_playlist_tracks,
        regenerate_playlist_tracks,
        remove_playlist_track,
    )
    from tests.test_global_catalog_playlists import _seed_playlist_and_global_track

    first = _seed_track(pg_db, title="First", filename="40-first.flac")
    local = _seed_track(pg_db, title="Wring It Out", filename="41-local.flac")
    _other, _artist, _album, global_uid = _seed_playlist_and_global_track(pg_db)
    playlist_id = create_playlist(
        "Global override",
        scope="system",
        generation_mode="smart",
        is_smart=True,
        smart_rules={"rules": [], "limit": 3},
    )
    source = "manual" if override == "manual" else "generated"
    locked = override == "locked"
    add_playlist_tracks(
        playlist_id,
        [
            {"track_id": first["id"], "source": "generated"},
            {"global_track_uid": global_uid, "source": source, "locked": locked},
        ],
    )
    if override == "exclusion":
        remove_playlist_track(playlist_id, 2, record_exclusion=True)
    before_exclusions = snapshot_system_playlist(playlist_id)["exclusions"]
    mapped_uid = None
    if mapping != "none":
        mapped_uid = global_uid
        if mapping == "different":
            _other, _artist, _album, mapped_uid = _seed_playlist_and_global_track(pg_db)
        with transaction_scope() as session:
            session.execute(
                text("""UPDATE global_catalog_tracks SET local_track_id=:id,
                local_track_entity_uid=CAST(:uid AS uuid),has_local=TRUE
                WHERE global_track_uid=CAST(:global_uid AS uuid)"""),
                {
                    "id": local["id"],
                    "uid": str(local["entity_uid"]),
                    "global_uid": mapped_uid,
                },
            )

    count = regenerate_playlist_tracks(
        playlist_id,
        [{"track_id": first["id"]}, {"track_id": local["id"]}],
        target_count=3,
    )
    rows = get_playlist_tracks(playlist_id)
    expected = [(str(first["entity_uid"]), None, "generated", False)]
    if override != "exclusion":
        expected.append((None, global_uid, source, locked))
    if mapping != "same":
        expected.append((str(local["entity_uid"]), mapped_uid, "generated", False))
    assert [
        (
            row["track_entity_uid"],
            row["global_track_uid"],
            row["source"],
            row["locked"],
        )
        for row in rows
    ] == expected
    assert [row["position"] for row in rows] == list(range(1, len(expected) + 1))
    assert count == len(expected)
    assert snapshot_system_playlist(playlist_id)["exclusions"] == before_exclusions
    if override != "exclusion":
        assert rows[1]["track_id"] is None
        assert rows[1]["track_storage_id"] is None
        assert rows[1]["track_path"] is None


@pytest.mark.parametrize("strong_identity", ["entity_uid", "storage_id"])
def test_regeneration_does_not_exclude_replacement_at_the_same_path(
    pg_db, strong_identity
):
    import uuid
    from sqlalchemy import text
    from crate.db.tx import transaction_scope
    from crate.db.repositories.editorial_plans import snapshot_system_playlist
    from crate.db.repositories.playlists_create import create_playlist
    from crate.db.repositories.playlists_detail_reads import get_playlist_tracks
    from crate.db.repositories.playlists_tracks import (
        add_playlist_tracks,
        regenerate_playlist_tracks,
        remove_playlist_track,
    )

    original = _seed_track(pg_db, title="Original", filename="42-reused.flac")
    old_storage_id = str(uuid.uuid4())
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET storage_id=CAST(:storage AS uuid) WHERE id=:id"
            ),
            {"storage": old_storage_id, "id": original["id"]},
        )
    playlist_id = create_playlist(
        "Replacement at excluded path", scope="system", generation_mode="smart"
    )
    add_playlist_tracks(
        playlist_id, [{"track_id": original["id"], "source": "generated"}]
    )
    remove_playlist_track(playlist_id, 1, record_exclusion=True)
    with transaction_scope() as session:
        session.execute(
            text("""UPDATE playlist_track_exclusions SET track_id=NULL,
            track_entity_uid=CASE WHEN :identity='entity_uid' THEN track_entity_uid END,
            track_storage_id=CASE WHEN :identity='storage_id' THEN track_storage_id END
            WHERE playlist_id=:id"""),
            {"identity": strong_identity, "id": playlist_id},
        )
        session.execute(
            text("DELETE FROM library_tracks WHERE id=:id"), {"id": original["id"]}
        )
    replacement = _seed_track(pg_db, title="Replacement", filename="42-reused.flac")
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE library_tracks SET storage_id=CAST(:storage AS uuid) WHERE id=:id"
            ),
            {"storage": str(uuid.uuid4()), "id": replacement["id"]},
        )
    assert replacement["entity_uid"] != original["entity_uid"]
    before = snapshot_system_playlist(playlist_id)["exclusions"]

    regenerate_playlist_tracks(
        playlist_id, [{"track_id": replacement["id"]}], target_count=1
    )

    rows = get_playlist_tracks(playlist_id)
    assert [row["track_entity_uid"] for row in rows] == [str(replacement["entity_uid"])]
    assert rows[0]["track_id"] == replacement["id"]
    assert rows[0]["track_path"] == original["path"]
    assert snapshot_system_playlist(playlist_id)["exclusions"] == before
