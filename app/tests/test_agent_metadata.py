from __future__ import annotations

import copy
from pathlib import Path
from uuid import uuid4

import mutagen
import pytest
from mutagen.flac import FLAC
from sqlalchemy import text

from crate.agent_metadata import apply_operation, compile_operation
from crate.db.repositories.agent_metadata import (
    apply_metadata_state,
    metadata_state_version,
    read_metadata_state,
)
from crate.db.repositories.field_locks import lock_fields
from crate.db.tx import read_scope, transaction_scope


def _authorize(effect=None):
    return effect() if effect is not None else None


def _flac(path: Path, **tags) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    stream = (
        (4096).to_bytes(2, "big") * 2
        + bytes(6)
        + ((44100 << 44) | (1 << 41) | (15 << 36) | 44100).to_bytes(8, "big")
        + bytes(16)
    )
    path.write_bytes(b"fLaC" + bytes([128]) + len(stream).to_bytes(3, "big") + stream)
    audio = FLAC(path)
    for name, value in tags.items():
        audio[name] = [value]
    audio.save()


@pytest.fixture
def metadata_library(pg_db, tmp_path):
    artist_uid, album_uid, track_uid = (str(uuid4()) for _ in range(3))
    album = tmp_path / "Artist" / "Album"
    path = album / "01 Song.flac"
    _flac(path, title="Song", album="Album", artist="Artist", tracknumber="1")
    with transaction_scope() as session:
        actor = session.execute(
            text("SELECT id FROM users ORDER BY id LIMIT 1")
        ).scalar_one()
        artist_id = session.execute(
            text(
                "INSERT INTO library_artists (name, entity_uid, bio, updated_at) "
                "VALUES ('Artist', CAST(:uid AS uuid), 'Old biography', NOW()) RETURNING id"
            ),
            {"uid": artist_uid},
        ).scalar_one()
        album_id = session.execute(
            text(
                "INSERT INTO library_albums (artist, name, path, entity_uid, updated_at) "
                "VALUES ('Artist', 'Album', :path, CAST(:uid AS uuid), NOW()) RETURNING id"
            ),
            {"path": str(album), "uid": album_uid},
        ).scalar_one()
        track_id = session.execute(
            text(
                "INSERT INTO library_tracks (album_id, artist, album, filename, title, path, entity_uid, size, updated_at) "
                "VALUES (:album, 'Artist', 'Album', '01 Song.flac', 'Song', :path, CAST(:uid AS uuid), :size, NOW()) RETURNING id"
            ),
            {
                "album": album_id,
                "path": str(path),
                "uid": track_uid,
                "size": path.stat().st_size,
            },
        ).scalar_one()
    return {
        "artist_uid": artist_uid,
        "artist_id": artist_id,
        "album_uid": album_uid,
        "album_id": album_id,
        "track_uid": track_uid,
        "track_id": track_id,
        "actor": actor,
        "path": path,
        "root": tmp_path,
        "config": {"library_path": str(tmp_path)},
    }


def _compile(library, kind="track", patch=None):
    return compile_operation(
        "metadata_update",
        {
            "entity_type": kind,
            "entity_uid": library[f"{kind}_uid"],
            "patch": patch or {"title": "New title"},
        },
        library["config"],
    )


@pytest.mark.parametrize(
    "parameters",
    [
        {"entity_type": "track", "entity_uid": "bad", "patch": {"title": "Title"}},
        {
            "entity_type": "playlist",
            "entity_uid": str(uuid4()),
            "patch": {"title": "Title"},
        },
        {"entity_type": "artist", "entity_uid": str(uuid4()), "patch": {}},
        {
            "entity_type": "artist",
            "entity_uid": str(uuid4()),
            "patch": {"has_photo": 1},
        },
        {
            "entity_type": "track",
            "entity_uid": str(uuid4()),
            "patch": {"path": "/tmp/song"},
        },
        {
            "entity_type": "album",
            "entity_uid": str(uuid4()),
            "patch": {"title": "Title"},
        },
        {
            "entity_type": "track",
            "entity_uid": str(uuid4()),
            "patch": {"title": "x" * 4097},
        },
        {
            "entity_type": "track",
            "entity_uid": str(uuid4()),
            "patch": {"title": "null\x00byte"},
        },
        {
            "entity_type": "track",
            "entity_uid": str(uuid4()),
            "patch": {"title": ["Title"]},
        },
        {
            "entity_type": "track",
            "entity_uid": str(uuid4()),
            "patch": {"tracknumber": "0"},
        },
        {
            "entity_type": "track",
            "entity_uid": str(uuid4()),
            "patch": {"discnumber": "1; rm -rf /"},
        },
        {
            "entity_type": "artist",
            "entity_uid": str(uuid4()),
            "patch": {"tags": ["tag"] * 101},
        },
        {
            "entity_type": "artist",
            "entity_uid": str(uuid4()),
            "patch": {"genres": [""]},
        },
        {
            "entity_type": "artist",
            "entity_uid": str(uuid4()),
            "patch": {"urls": {"home": "file:///tmp"}},
        },
        {
            "entity_type": "artist",
            "entity_uid": str(uuid4()),
            "patch": {"bio": "x" * 50001},
        },
        {
            "entity_type": "track",
            "entity_uid": str(uuid4()),
            "patch": {"title": "Title"},
            "files": [],
        },
    ],
)
def test_invalid_metadata_requests_are_rejected_before_database_reads(
    parameters, monkeypatch
):
    def unexpected_read(*args, **kwargs):
        pytest.fail("Invalid metadata request reached the database")

    monkeypatch.setattr("crate.agent_metadata.read_metadata_state", unexpected_read)
    with pytest.raises((ValueError, TypeError)):
        compile_operation("metadata_update", parameters, {})


def test_unknown_operations_are_rejected():
    with pytest.raises(ValueError, match="Unsupported"):
        compile_operation("delete_artist", {}, {})
    with pytest.raises(ValueError, match="Unsupported"):
        apply_operation("delete_artist", {}, {}, task_id="task", authorize=_authorize)


def test_plan_lists_exact_track_sources_and_real_mutagen_changes(metadata_library):
    library = metadata_library
    original = library["path"].read_bytes()
    plan = _compile(library, patch={"title": "New title", "tracknumber": "2/9"})

    assert library["path"].read_bytes() == original
    assert plan["document"]["targets"] == [
        {"entity_type": "track", "entity_uid": library["track_uid"]}
    ]
    assert plan["document"]["changes"] == [
        {
            "entity_uid": library["track_uid"],
            "field": "title",
            "before": ["Song"],
            "after": ["New title"],
        },
        {
            "entity_uid": library["track_uid"],
            "field": "tracknumber",
            "before": ["1"],
            "after": ["2/9"],
        },
    ]
    assert plan["document"]["impact"]["files"] == 1
    assert plan["document"]["impact"]["bytes_read_for_preconditions"] == len(original)
    assert plan["document"]["impact"]["provenance"] == "manual_edit"
    assert len(plan["document"]["source_versions"]["files"][0]["sha256"]) == 64


def test_track_apply_verifies_audio_and_projects_tags_locks_audit_and_outbox(
    metadata_library,
):
    library = metadata_library
    plan = _compile(
        library, patch={"title": "New title", "date": "1997", "tracknumber": "2/9"}
    )
    plan["execution"]["actor_user_id"] = library["actor"]

    result = apply_operation(
        "metadata_update",
        plan["execution"],
        library["config"],
        task_id="metadata-test",
        authorize=_authorize,
    )

    assert result["execution"]["status"] == "completed"
    assert result["verification"]["status"] == "passed"
    assert result["verification"]["items"] == [
        {"entity_uid": library["track_uid"], "status": "passed"}
    ]
    audio = mutagen.File(library["path"], easy=True)
    assert audio["title"] == ["New title"]
    assert audio["tracknumber"] == ["2/9"]
    state = read_metadata_state("track", library["track_uid"])
    assert (
        state["entity"]["title"],
        state["entity"]["year"],
        state["entity"]["track_number"],
    ) == ("New title", "1997", 2)
    assert state["entity"]["size"] == library["path"].stat().st_size
    assert {
        (lock["field_name"], lock["source"], lock["locked_by_user_id"])
        for lock in state["locks"]
    } == {
        (field, "manual_edit", library["actor"])
        for field in ("title", "date", "tracknumber")
    }
    with read_scope() as session:
        audit = (
            session.execute(
                text(
                    "SELECT details_json, user_id FROM audit_log WHERE task_id='metadata-test'"
                )
            )
            .mappings()
            .one()
        )
        event = session.execute(
            text(
                "SELECT payload_json FROM domain_event_outbox WHERE subject_key=:key AND event_type='ui.invalidate'"
            ),
            {"key": f"track:{library['track_uid']}"},
        ).scalar_one()
        dirty = session.execute(
            text(
                "SELECT operation FROM global_catalog_dirty_sources WHERE local_entity_uid=CAST(:uid AS uuid)"
            ),
            {"uid": library["track_uid"]},
        ).scalar_one()
    assert audit["user_id"] == library["actor"]
    assert audit["details_json"]["source"] == "manual_edit"
    assert audit["details_json"]["items"][0]["after"]["title"] == "New title"
    assert event == {"scope": "library"}
    assert dirty == "upsert"
    assert not list(library["path"].parent.glob(".crate-tags-*"))


@pytest.mark.parametrize("entity_type", ["track", "album"])
def test_tag_growth_refreshes_canonical_parent_size_totals(
    metadata_library, entity_type
):
    library = metadata_library
    second = library["path"].parent / "02 Song.flac"
    _flac(second, title="Second", album="Album", artist="Track credit")
    original_size = library["path"].stat().st_size
    second_size = second.stat().st_size
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_tracks (album_id, artist, album, filename, path, entity_uid, size) "
                "VALUES (:album, 'Track credit', 'Album', '02 Song.flac', :path, gen_random_uuid(), :size)"
            ),
            {"album": library["album_id"], "path": str(second), "size": second_size},
        )
        session.execute(
            text("UPDATE library_tracks SET artist='Track credit' WHERE id=:id"),
            {"id": library["track_id"]},
        )
        session.execute(
            text("UPDATE library_albums SET total_size=:size WHERE id=:id"),
            {"size": original_size + second_size, "id": library["album_id"]},
        )
        session.execute(
            text(
                "INSERT INTO library_albums (artist, name, path, total_size, quarantined_at) VALUES "
                "('Artist', 'Other', :other, 1234, NULL), "
                "('Artist', 'Quarantined', :quarantined, 9999, NOW())"
            ),
            {
                "other": str(library["root"] / "Other"),
                "quarantined": str(library["root"] / "Quarantined"),
            },
        )
        session.execute(
            text("UPDATE library_artists SET total_size=:size WHERE id=:id"),
            {"size": original_size + second_size + 1234, "id": library["artist_id"]},
        )
        session.execute(
            text(
                "INSERT INTO library_artists (name, total_size) VALUES ('Track credit', 5678)"
            )
        )
    patch = {"title" if entity_type == "track" else "album": "Long tag " + "x" * 4000}
    plan = _compile(library, entity_type, patch)

    result = apply_operation(
        "metadata_update",
        plan["execution"],
        library["config"],
        task_id="metadata-size-growth",
        authorize=_authorize,
    )

    assert result["verification"]["status"] == "passed"
    assert library["path"].stat().st_size > original_size
    expected_album_size = library["path"].stat().st_size + second.stat().st_size
    with read_scope() as session:
        album_size = session.execute(
            text("SELECT total_size FROM library_albums WHERE id=:id"),
            {"id": library["album_id"]},
        ).scalar_one()
        artist_sizes = dict(
            session.execute(
                text(
                    "SELECT name, total_size FROM library_artists WHERE name=ANY(:names)"
                ),
                {"names": ["Artist", "Track credit"]},
            ).all()
        )
        track_sizes = (
            session.execute(
                text(
                    "SELECT size FROM library_tracks WHERE album_id=:id ORDER BY filename"
                ),
                {"id": library["album_id"]},
            )
            .scalars()
            .all()
        )
        dirty_parents = {
            (row[0], str(row[1]))
            for row in session.execute(
                text(
                    "SELECT entity_type, local_entity_uid FROM global_catalog_dirty_sources "
                    "WHERE local_entity_uid=ANY(CAST(:uids AS uuid[]))"
                ),
                {"uids": [library["album_uid"], library["artist_uid"]]},
            )
        }
    assert track_sizes == [library["path"].stat().st_size, second.stat().st_size]
    assert album_size == expected_album_size
    assert artist_sizes == {"Artist": expected_album_size + 1234, "Track credit": 5678}
    assert dirty_parents == {
        ("album", library["album_uid"]),
        ("artist", library["artist_uid"]),
    }
    assert plan["document"]["impact"]["refreshes_size_totals"] == ["album", "artist"]


def test_artist_edit_is_database_only_and_preserves_manual_provenance(metadata_library):
    library = metadata_library
    original = library["path"].read_bytes()
    plan = _compile(
        library,
        "artist",
        {
            "bio": "New biography",
            "tags": ["post-hardcore"],
            "bandcamp_url": "https://artist.bandcamp.com",
        },
    )
    plan["execution"]["actor_user_id"] = library["actor"]
    assert plan["document"]["impact"]["filesystem"] is False
    assert plan["document"]["source_versions"]["files"] == []

    result = apply_operation(
        "metadata_update",
        plan["execution"],
        library["config"],
        task_id="artist-edit",
        authorize=_authorize,
    )

    assert result["verification"]["status"] == "passed"
    state = read_metadata_state("artist", library["artist_uid"])
    assert state["entity"]["bio"] == "New biography"
    assert state["entity"]["tags_json"] == ["post-hardcore"]
    assert state["entity"]["bandcamp_url_source"] == "manual"
    assert state["entity"]["bandcamp_url_updated_at"] is not None
    assert {(lock["field_name"], lock["source"]) for lock in state["locks"]} == {
        (field, "manual_edit") for field in ("bio", "tags", "bandcamp_url")
    }
    assert library["path"].read_bytes() == original


def test_clearing_an_optional_tag_is_verified_and_projected(metadata_library):
    library = metadata_library
    plan = _compile(library, patch={"title": None})

    result = apply_operation(
        "metadata_update",
        plan["execution"],
        library["config"],
        task_id="clear-title",
        authorize=_authorize,
    )

    assert result["verification"]["status"] == "passed"
    assert "title" not in FLAC(library["path"])
    assert read_metadata_state("track", library["track_uid"])["entity"]["title"] is None


def test_missing_target_does_not_produce_an_executable_plan(metadata_library):
    with pytest.raises(ValueError, match="does not exist"):
        read_metadata_state("artist", str(uuid4()))
    with pytest.raises(ValueError, match="Unsupported"):
        read_metadata_state("playlist", metadata_library["artist_uid"])


def test_empty_album_does_not_produce_a_metadata_write_plan(metadata_library):
    library = metadata_library
    with transaction_scope() as session:
        session.execute(
            text("DELETE FROM library_tracks WHERE album_id=:id"),
            {"id": library["album_id"]},
        )

    with pytest.raises(ValueError, match="no indexed tracks"):
        _compile(library, "album", {"album": "Corrected title"})


@pytest.mark.parametrize(
    "mutation", ["database", "field_lock", "file", "file_identity"]
)
def test_changed_sources_prevent_writing_approved_metadata(metadata_library, mutation):
    library = metadata_library
    plan = _compile(library)
    if mutation == "database":
        with transaction_scope() as session:
            session.execute(
                text("UPDATE library_tracks SET title='Concurrent edit' WHERE id=:id"),
                {"id": library["track_id"]},
            )
    elif mutation == "field_lock":
        lock_fields(
            entity_type="track", entity_id=library["track_id"], field_names=["genre"]
        )
    elif mutation == "file":
        audio = FLAC(library["path"])
        audio["title"] = ["Concurrent tag"]
        audio.save()
    else:
        replacement = library["path"].with_suffix(".replacement")
        replacement.write_bytes(library["path"].read_bytes())
        replacement.replace(library["path"])
    before = library["path"].read_bytes()

    result = apply_operation(
        "metadata_update",
        plan["execution"],
        library["config"],
        task_id="stale-plan",
        authorize=_authorize,
    )

    assert result["execution"]["status"] != "completed"
    assert result["verification"]["status"] != "passed"
    assert library["path"].read_bytes() == before
    assert (
        read_metadata_state("track", library["track_uid"])["entity"]["title"]
        != "New title"
    )


@pytest.mark.parametrize(
    "entity_type,concurrent_update,patch",
    [
        pytest.param(
            "track",
            "UPDATE library_tracks SET genre='Concurrent genre' WHERE id=:id",
            {"title": "New title"},
            id="track",
        ),
        pytest.param(
            "album",
            "UPDATE library_albums SET genre='Concurrent genre' WHERE id=:id",
            {"album": "Corrected title"},
            id="album",
        ),
        pytest.param(
            "artist",
            "UPDATE library_artists SET bio='Concurrent biography' WHERE id=:id",
            {"bio": "New biography", "tags": ["post-hardcore"]},
            id="artist",
        ),
    ],
)
def test_database_conflict_does_not_invoke_filesystem_callback(
    metadata_library, entity_type, concurrent_update, patch
):
    library = metadata_library
    entity_uid = library[f"{entity_type}_uid"]
    stale = read_metadata_state(entity_type, entity_uid)
    with transaction_scope() as session:
        session.execute(
            text(concurrent_update),
            {"id": library[f"{entity_type}_id"]},
        )
    with read_scope() as session:
        before = {
            kind: read_metadata_state(kind, library[f"{kind}_uid"], session=session)
            for kind in ("artist", "album", "track")
        }
    assert metadata_state_version(before[entity_type]) != metadata_state_version(stale)
    original_audio = library["path"].read_bytes()

    def forbidden_callback(state):
        pytest.fail("Filesystem callback ran for a stale database source")

    result = apply_metadata_state(
        entity_type,
        entity_uid,
        expected_version=metadata_state_version(stale),
        patch=patch,
        apply_files=forbidden_callback,
        task_id="stale-db",
        actor_user_id=library["actor"],
    )
    assert result == {"status": "conflict", "items": [], "code": "SOURCE_CHANGED"}
    with read_scope() as session:
        after = {
            kind: read_metadata_state(kind, library[f"{kind}_uid"], session=session)
            for kind in ("artist", "album", "track")
        }
        assert (
            session.execute(
                text("SELECT id FROM audit_log WHERE task_id='stale-db'")
            ).first()
            is None
        )
    assert after == before
    assert library["path"].read_bytes() == original_audio


def test_authorization_denial_before_effect_preserves_original_audio_and_database(
    metadata_library,
    monkeypatch,
):
    library = metadata_library
    plan = _compile(library)
    original = library["path"].read_bytes()
    revoked = False
    original_save = FLAC.save

    class AccessRevoked(RuntimeError):
        pass

    def save_and_revoke(audio, *args, **kwargs):
        nonlocal revoked
        result = original_save(audio, *args, **kwargs)
        if Path(audio.filename).name.startswith(".crate-tags-"):
            revoked = True
        return result

    def authorize(effect=None):
        if revoked:
            raise AccessRevoked()
        return effect() if effect else None

    monkeypatch.setattr(FLAC, "save", save_and_revoke)
    with pytest.raises(AccessRevoked):
        apply_operation(
            "metadata_update",
            plan["execution"],
            library["config"],
            task_id="revoked",
            authorize=authorize,
        )

    assert revoked
    assert library["path"].read_bytes() == original
    assert (
        read_metadata_state("track", library["track_uid"])["entity"]["title"] == "Song"
    )
    assert not list(library["path"].parent.glob(".crate-tags-*"))


@pytest.mark.parametrize(
    "unsafe_path", ["../outside.flac", "/outside.flac", "symlink", "parent_symlink"]
)
def test_metadata_plans_reject_paths_outside_library_or_through_symlinks(
    metadata_library, unsafe_path
):
    library = metadata_library
    if unsafe_path == "symlink":
        link = library["root"] / "linked.flac"
        link.symlink_to(library["path"])
        unsafe_path = str(link)
    elif unsafe_path == "parent_symlink":
        link = library["root"] / "linked-album"
        link.symlink_to(library["path"].parent, target_is_directory=True)
        unsafe_path = str(link / library["path"].name)
    with transaction_scope() as session:
        session.execute(
            text("UPDATE library_tracks SET path=:path WHERE id=:id"),
            {"path": unsafe_path, "id": library["track_id"]},
        )

    with pytest.raises(ValueError, match="outside|Symbolic"):
        _compile(library)


def test_album_plan_covers_all_indexed_tracks_but_ignores_unindexed_files(
    metadata_library,
):
    library = metadata_library
    unindexed = library["path"].parent / "unindexed.flac"
    _flac(unindexed, title="Do not change", album="Unindexed")
    original = unindexed.read_bytes()
    plan = _compile(library, "album", {"album": "Corrected title", "date": "2001"})
    assert plan["document"]["targets"] == [
        {"entity_type": "album", "entity_uid": library["album_uid"]},
        {"entity_type": "track", "entity_uid": library["track_uid"]},
    ]

    result = apply_operation(
        "metadata_update",
        plan["execution"],
        library["config"],
        task_id="album-edit",
        authorize=_authorize,
    )

    assert result["verification"]["status"] == "passed"
    assert FLAC(library["path"])["album"] == ["Corrected title"]
    assert unindexed.read_bytes() == original
    state = read_metadata_state("album", library["album_uid"])
    assert state["entity"]["tag_album"] == "Corrected title"
    assert state["entity"]["year"] == "2001"
    assert state["entity"]["name"] == "Album"
    assert {(lock["entity_type"], lock["field_name"]) for lock in state["locks"]} == {
        (kind, field) for kind in ("album", "track") for field in ("album", "date")
    }


def test_album_membership_changed_after_plan_is_rejected_before_file_effect(
    metadata_library,
):
    library = metadata_library
    plan = _compile(library, "album", {"album": "Corrected title"})
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_tracks (album_id, artist, album, filename, path, entity_uid) VALUES (:album,'Artist','Album','new.flac',:path,CAST(:uid AS uuid))"
            ),
            {
                "album": library["album_id"],
                "path": str(library["path"].parent / "new.flac"),
                "uid": str(uuid4()),
            },
        )
    original = library["path"].read_bytes()

    result = apply_operation(
        "metadata_update",
        plan["execution"],
        library["config"],
        task_id="changed-membership",
        authorize=_authorize,
    )

    assert result["execution"]["status"] == "conflict"
    assert library["path"].read_bytes() == original


def test_album_rejects_more_than_one_hundred_indexed_tracks(metadata_library):
    library = metadata_library
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_tracks (album_id, artist, album, filename, path, entity_uid) SELECT :album,'Artist','Album','extra-'||n||'.flac',:root||'/extra-'||n||'.flac',gen_random_uuid() FROM generate_series(1,100) n"
            ),
            {"album": library["album_id"], "root": str(library["path"].parent)},
        )

    with pytest.raises(ValueError, match="100 indexed tracks"):
        _compile(library, "album", {"album": "Corrected title"})


def test_partial_album_write_projects_only_verified_files(
    metadata_library, monkeypatch
):
    library = metadata_library
    second_uid = str(uuid4())
    second = library["path"].parent / "02 Song.flac"
    _flac(second, title="Second", album="Album")
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO library_tracks (album_id, artist, album, filename, title, path, entity_uid, size) VALUES (:album,'Artist','Album','02 Song.flac','Second',:path,CAST(:uid AS uuid),:size)"
            ),
            {
                "album": library["album_id"],
                "path": str(second),
                "uid": second_uid,
                "size": second.stat().st_size,
            },
        )
    plan = _compile(library, "album", {"album": "Corrected title"})
    original = second.read_bytes()
    real_os_replace = __import__("os").replace

    def fail_second_replace(source, destination):
        if Path(destination) == second:
            raise OSError("simulated filesystem failure")
        return real_os_replace(source, destination)

    monkeypatch.setattr("crate.agent_metadata.os.replace", fail_second_replace)
    result = apply_operation(
        "metadata_update",
        plan["execution"],
        library["config"],
        task_id="partial-tags",
        authorize=_authorize,
    )

    assert result["execution"]["status"] == "partial"
    assert result["verification"]["status"] == "failed"
    assert {
        item["entity_uid"]: item["status"] for item in result["execution"]["items"]
    } == {library["track_uid"]: "applied", second_uid: "failed"}
    assert FLAC(library["path"])["album"] == ["Corrected title"]
    assert second.read_bytes() == original
    state = read_metadata_state("album", library["album_uid"])
    assert {str(track["entity_uid"]): track["album"] for track in state["tracks"]} == {
        library["track_uid"]: "Corrected title",
        second_uid: "Album",
    }
    assert state["entity"]["tag_album"] is None
    assert state["entity"]["total_size"] == sum(
        path.stat().st_size for path in (library["path"], second)
    )
    assert (
        read_metadata_state("artist", library["artist_uid"])["entity"]["total_size"]
        == (state["entity"]["total_size"])
    )
    assert all(lock["entity_id"] == library["track_id"] for lock in state["locks"])
    assert not list(second.parent.glob(".crate-tags-*"))


def test_metadata_version_binds_complete_sources_and_is_independent_of_mapping_order():
    state = {
        "entity": {"id": 1, "bio": "Old", "bandcamp_url_source": "provider"},
        "tracks": [],
        "genres": ["punk"],
        "locks": [{"field_name": "bio", "source": "manual_edit"}],
    }
    version = metadata_state_version(state)
    reordered = {key: state[key] for key in reversed(state)}
    assert metadata_state_version(reordered) == version
    for section, key, value in [
        ("entity", "bio", "New"),
        ("entity", "bandcamp_url_source", "manual"),
        ("locks", "source", "provider"),
    ]:
        changed = copy.deepcopy(state)
        if section == "locks":
            changed[section][0][key] = value
        else:
            changed[section][key] = value
        assert metadata_state_version(changed) != version
    changed = copy.deepcopy(state)
    changed["genres"] = ["rock"]
    assert metadata_state_version(changed) != version
