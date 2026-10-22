"""Real PostgreSQL regressions for approved sync scope and stable identities."""

from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import event, text

from tests.conftest import PG_AVAILABLE
from tests.test_agent_analysis_sync import (
    TestExactSyncOperations as _ExactSyncFixtures,
    _album_for,
    _authorize,
    _frozen_scan,
    _seed_track,
)
from tests.test_smart_mix_publication import _draft

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _track_row(track_id):
    from crate.db.tx import read_scope

    with read_scope() as session:
        return dict(
            session.execute(
                text("SELECT * FROM library_tracks WHERE id=:id"), {"id": track_id}
            )
            .mappings()
            .one()
        )


@pytest.mark.parametrize("collision_after_preview", [False, True])
def test_sync_never_retargets_a_foreign_track_indexed_at_an_incoming_path(
    pg_db, tmp_path, monkeypatch, collision_after_preview
):
    from crate.agent_sync import apply_operation, compile_operation
    from crate.db.queries.agent_sync import read_sync_state
    from crate.db.tx import transaction_scope
    from crate.library_sync import LibrarySync

    track, album, config, _initial = _ExactSyncFixtures()._prepare(
        pg_db, tmp_path, monkeypatch, suffix="path-collision"
    )
    foreign = _seed_track(pg_db, "foreign-path-owner")
    foreign_album = _album_for(foreign)
    new_path = Path(track["path"]).with_name("new.flac")
    new_path.write_bytes(b"new-audio")
    extra = {
        **_frozen_scan(new_path.parent, album["artist"])["track_payloads"][0],
        "path": str(new_path),
        "filename": new_path.name,
        "title": "New track",
        "track_number": 2,
        "size": new_path.stat().st_size,
    }
    monkeypatch.setattr(
        LibrarySync,
        "prepare_album_sync",
        lambda _self, directory, artist: _frozen_scan(
            directory, artist, extra_tracks=[extra]
        ),
    )

    def occupy_path():
        with transaction_scope() as session:
            session.execute(
                text("UPDATE library_tracks SET path=:path WHERE id=:id"),
                {"path": str(new_path), "id": foreign["id"]},
            )

    if not collision_after_preview:
        occupy_path()
    plan = compile_operation(
        "library_sync", {"scope": "album", "entity_uid": album["entity_uid"]}, config
    )
    if collision_after_preview:
        occupy_path()
    before = read_sync_state(album["entity_uid"])
    foreign_before = read_sync_state(foreign_album["entity_uid"])
    assert foreign["entity_uid"] not in {
        target["entity_uid"] for target in plan["document"]["targets"]
    }

    result = apply_operation(
        "library_sync",
        plan["execution"],
        config,
        task_id="sync-path-collision",
        authorize=_authorize,
    )

    assert result["execution"]["status"] == "conflict"
    assert result["execution"]["items"][0]["code"] == "IDENTITY_CONFLICT"
    assert result["verification"]["status"] == "failed"
    assert read_sync_state(album["entity_uid"]) == before
    assert read_sync_state(foreign_album["entity_uid"]) == foreign_before


def test_strict_upsert_preserves_approved_uid_for_a_new_track(pg_db):
    from crate.db.repositories.library_track_upserts import upsert_track
    from crate.db.tx import read_scope

    existing = _seed_track(pg_db, "strict-insert")
    album = _album_for(existing)
    uid = str(uuid4())
    path = str(Path(existing["path"]).with_name("new.flac"))
    payload = {
        "entity_uid": uid,
        "album_id": album["id"],
        "artist": album["artist"],
        "album": "Album",
        "path": path,
        "filename": "new.flac",
        "title": "New",
        "track_number": 2,
        "disc_number": 1,
    }

    upsert_track(payload, strict_identity=True)
    upsert_track({**payload, "title": "Updated"}, strict_identity=True)

    with read_scope() as session:
        row = session.execute(
            text(
                "SELECT entity_uid::text,album_id,title FROM library_tracks WHERE path=:path"
            ),
            {"path": path},
        ).one()
    assert tuple(row) == (uid, album["id"], "Updated")


@pytest.mark.parametrize("same_album", [False, True])
def test_strict_upsert_rejects_path_collision_inserted_after_its_initial_lookup(
    pg_db, same_album
):
    from crate.db.engine import get_engine
    from crate.db.repositories.library_track_upserts import upsert_track
    from crate.db.tx import transaction_scope

    existing = _seed_track(pg_db, "race-approved")
    album = _album_for(existing)
    foreign = _seed_track(pg_db, "race-outside")
    if same_album:
        with transaction_scope() as session:
            session.execute(
                text("UPDATE library_tracks SET album_id=:album WHERE id=:id"),
                {"album": album["id"], "id": foreign["id"]},
            )
    before = _track_row(foreign["id"])
    new_path = str(Path(existing["path"]).with_name("new.flac"))
    raced = False
    engine = get_engine()

    def occupy_before_insert(
        _connection, _cursor, statement, _parameters, _context, _executemany
    ):
        nonlocal raced
        if raced or not statement.lower().startswith("insert into library_tracks"):
            return
        raced = True
        with engine.begin() as concurrent:
            concurrent.execute(
                text("UPDATE library_tracks SET path=:path WHERE id=:id"),
                {"path": new_path, "id": foreign["id"]},
            )

    event.listen(engine, "before_cursor_execute", occupy_before_insert)
    try:
        with pytest.raises(ValueError, match="identity changed during insertion"):
            upsert_track(
                {
                    "entity_uid": str(uuid4()),
                    "album_id": album["id"],
                    "artist": album["artist"],
                    "album": "Album",
                    "path": new_path,
                    "filename": "new.flac",
                    "title": "Approved new track",
                    "track_number": 2,
                    "disc_number": 1,
                },
                strict_identity=True,
            )
    finally:
        event.remove(engine, "before_cursor_execute", occupy_before_insert)

    assert raced
    assert _track_row(foreign["id"]) == {**before, "path": new_path}


def test_sync_verifies_track_uid_and_rolls_back_an_unexpected_identity(
    pg_db, tmp_path, monkeypatch
):
    from crate.agent_sync import apply_operation
    from crate.db.queries.agent_sync import read_sync_state
    from crate.db.repositories import agent_sync

    track, album, config, plan = _ExactSyncFixtures()._prepare(
        pg_db, tmp_path, monkeypatch, suffix="uid-postcondition"
    )
    before = read_sync_state(album["entity_uid"])
    real_upsert = agent_sync.upsert_track

    def substitute_identity(data, **kwargs):
        real_upsert(data, **kwargs)
        kwargs["session"].execute(
            text(
                "UPDATE library_tracks SET entity_uid=CAST(:uid AS uuid) WHERE id=:id"
            ),
            {"uid": str(uuid4()), "id": track["id"]},
        )

    monkeypatch.setattr(agent_sync, "upsert_track", substitute_identity)

    with pytest.raises(RuntimeError, match="postcondition failed"):
        apply_operation(
            "library_sync",
            plan["execution"],
            config,
            task_id="sync-wrong-postcondition-uid",
            authorize=_authorize,
        )

    assert read_sync_state(album["entity_uid"]) == before


def test_sync_rolls_back_earlier_album_writes_when_a_path_is_occupied_during_insert(
    pg_db, tmp_path, monkeypatch
):
    from crate.agent_sync import apply_operation, compile_operation
    from crate.db.engine import get_engine
    from crate.db.queries.agent_sync import read_sync_state
    from crate.library_sync import LibrarySync

    track, album, config, _initial = _ExactSyncFixtures()._prepare(
        pg_db, tmp_path, monkeypatch, suffix="album-insert-race"
    )
    foreign = _seed_track(pg_db, "album-race-outside")
    foreign_before = _track_row(foreign["id"])
    new_path = Path(track["path"]).with_name("new.flac")
    new_path.write_bytes(b"new-audio")
    extra = {
        **_frozen_scan(new_path.parent, album["artist"])["track_payloads"][0],
        "path": str(new_path),
        "filename": new_path.name,
        "title": "New track",
        "track_number": 2,
        "size": new_path.stat().st_size,
    }
    monkeypatch.setattr(
        LibrarySync,
        "prepare_album_sync",
        lambda _self, directory, artist: _frozen_scan(
            directory, artist, extra_tracks=[extra]
        ),
    )
    plan = compile_operation(
        "library_sync", {"entity_uid": album["entity_uid"]}, config
    )
    before = read_sync_state(album["entity_uid"])
    raced = False
    engine = get_engine()

    def occupy_before_insert(
        _connection, _cursor, statement, _parameters, _context, _executemany
    ):
        nonlocal raced
        if raced or not statement.lower().startswith("insert into library_tracks"):
            return
        raced = True
        with engine.begin() as concurrent:
            concurrent.execute(
                text("UPDATE library_tracks SET path=:path WHERE id=:id"),
                {"path": str(new_path), "id": foreign["id"]},
            )

    event.listen(engine, "before_cursor_execute", occupy_before_insert)
    try:
        result = apply_operation(
            "library_sync",
            plan["execution"],
            config,
            task_id="sync-album-insert-race",
            authorize=_authorize,
        )
    finally:
        event.remove(engine, "before_cursor_execute", occupy_before_insert)

    assert raced
    assert result["execution"]["status"] == "conflict"
    assert read_sync_state(album["entity_uid"]) == before
    assert _track_row(foreign["id"]) == {
        **foreign_before,
        "path": str(new_path),
    }


def test_sync_preview_hides_smart_mix_source_revision_but_apply_payload_keeps_it(
    pg_db, tmp_path, monkeypatch
):
    from crate.agent_sync import apply_operation, compile_operation
    from crate.db.jobs.analysis_storage import (
        SmartMixPublication,
        capture_smart_mix_source,
        publish_smart_mix_profile,
    )
    from crate.db.repositories.smart_mix import get_track_mix_profile
    from crate.library_sync import LibrarySync

    track, album, config, _initial = _ExactSyncFixtures()._prepare(
        pg_db, tmp_path, monkeypatch, suffix="smart-mix-preview"
    )
    path = Path(track["path"])
    outcome = publish_smart_mix_profile(
        capture_smart_mix_source(track["id"], path), _draft()
    )
    assert outcome is SmartMixPublication.PUBLISHED

    new_revision = "deadbeef" * 8

    def _scan_with_revision(_self, directory, artist):
        scan = _frozen_scan(directory, artist)
        scan["track_payloads"][0]["smart_mix_source_revision"] = new_revision
        return scan

    monkeypatch.setattr(LibrarySync, "prepare_album_sync", _scan_with_revision)

    plan = compile_operation(
        "library_sync",
        {"scope": "album", "entity_uid": album["entity_uid"]},
        config,
    )

    changes = plan["document"]["changes"]
    assert len(changes) == 1
    change = changes[0]
    assert change["action"] == "update_index"
    assert "smart_mix_source_revision" not in change["after"]
    assert not (change["before"] or {}).keys() & {"smart_mix_source_revision"}

    track_payloads = plan["execution"]["albums"][0]["prepared"]["track_payloads"]
    assert track_payloads[0]["smart_mix_source_revision"] == new_revision

    result = apply_operation(
        "library_sync",
        plan["execution"],
        config,
        task_id="sync-smart-mix-preview",
        authorize=_authorize,
    )

    assert result["execution"]["status"] == "completed"
    # Applying the plan still carried smart_mix_source_revision through to the
    # upsert, so the now-stale profile from the earlier source is no longer served.
    assert get_track_mix_profile(track["id"]) is None
