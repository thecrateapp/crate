"""S7 (F8.S-PR1): Decks cue sets and corrections per user and track."""

from __future__ import annotations

import uuid
from importlib import import_module

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from crate.db.queries.decks_cues import get_decks_corrections, get_decks_cue_sets
from crate.db.repositories.auth_user_accounts import create_user
from crate.db.repositories.decks_cues import (
    put_decks_correction,
    put_decks_cue_set,
)
from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.decks_cues_v166 import (
    create_decks_cues_v166_schema,
    drop_decks_cues_v166_schema,
)
from crate.db.tx import read_scope, transaction_scope
from tests.conftest import PG_AVAILABLE
from tests.test_agent_access_migration import RecordingExecutor
from tests.test_smart_mix_repository import _create_track

MIGRATION = "crate.db.migrations.versions.166_decks_cues"

pg = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")


def _cue(cue_type="hotcue", slot=0, start_ms=1000.0, end_ms=None, **extra) -> dict:
    return {
        "cue_type": cue_type,
        "slot": slot,
        "start_ms": start_ms,
        "end_ms": end_ms,
        "label": extra.get("label"),
        "color": extra.get("color"),
    }


def _cue_rows(user_id: int, uid: str) -> list[dict]:
    with read_scope() as session:
        return [
            dict(row)
            for row in session.execute(
                text(
                    """
                    SELECT cue_type, slot, start_ms, revision
                    FROM user_track_cues
                    WHERE user_id = :user_id AND entity_uid = CAST(:uid AS UUID)
                    ORDER BY cue_type, slot
                    """
                ),
                {"user_id": user_id, "uid": uid},
            ).mappings()
        ]


def _user(name: str) -> int:
    return int(create_user(f"{name}@decks-cues.test")["id"])


def test_migration_and_bootstrap_use_the_same_schema(monkeypatch):
    migration = import_module(MIGRATION)
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_decks_cues_v166_schema(section)
    create_schema(bootstrap)

    assert migration.revision == "166" and migration.down_revision == "165"
    assert migrated.statements == section.statements
    joined = "\n".join(bootstrap.statements)
    assert all(statement in joined for statement in section.statements)

    downgrade, expected = RecordingExecutor(), RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    drop_decks_cues_v166_schema(expected)
    assert downgrade.statements == expected.statements
    assert downgrade.statements == [
        "DROP TABLE IF EXISTS user_track_corrections",
        "DROP TABLE IF EXISTS user_track_cues",
        "DROP TABLE IF EXISTS user_track_cue_sets",
    ]


@pg
def test_upsert_is_idempotent_by_slot(pg_db):
    del pg_db
    _track_id, uid = _create_track("decks-cues-idempotent")
    cues = [_cue(slot=0, start_ms=1000.0), _cue("main", 0, 500.0)]

    first = put_decks_cue_set(1, uid, cues, base_revision=0, client_id="install-a")
    assert first.status == "stored"
    assert first.current["revision"] == 1

    # The same set again, with the right or a stale base: nothing changes.
    for base in (1, 0):
        again = put_decks_cue_set(1, uid, cues, base_revision=base, client_id="b")
        assert again.status == "unchanged"
        assert again.current["revision"] == 1
        assert again.current["client_id"] == "install-a"

    moved = put_decks_cue_set(
        1,
        uid,
        [_cue(slot=0, start_ms=2000.0), _cue("main", 0, 500.0)],
        base_revision=1,
        client_id="install-a",
    )
    assert moved.status == "stored"
    assert moved.current["revision"] == 2

    # One row per (type, slot); each cue keeps the revision that last changed it.
    assert _cue_rows(1, uid) == [
        {"cue_type": "hotcue", "slot": 0, "start_ms": 2000.0, "revision": 2},
        {"cue_type": "main", "slot": 0, "start_ms": 500.0, "revision": 1},
    ]
    stored = get_decks_cue_sets(1, [uid])[uid]
    assert stored["revision"] == 2
    assert stored["cues"] == [
        _cue("main", 0, 500.0),
        _cue("hotcue", 0, 2000.0),
    ]


@pg
def test_revision_conflict_detected(pg_db):
    del pg_db
    _track_id, uid = _create_track("decks-cues-conflict")
    original = [_cue(slot=1, start_ms=1500.0, label="Drop", color="#ff8800")]
    assert put_decks_cue_set(
        1, uid, original, base_revision=0, client_id="a"
    ).status == ("stored")

    for stale in (0, 2, 7):
        conflict = put_decks_cue_set(
            1, uid, [_cue(slot=1, start_ms=9.0)], base_revision=stale, client_id="b"
        )
        assert conflict.status == "conflict"
        assert conflict.current["revision"] == 1
        assert conflict.current["cues"] == original
        assert conflict.current["client_id"] == "a"

    # Nothing was written by the rejected PUTs.
    assert get_decks_cue_sets(1, [uid])[uid]["cues"] == original


@pg
def test_user_isolation(pg_db):
    del pg_db
    _track_id, uid = _create_track("decks-cues-isolation")
    other = _user("decks-cues-other")

    put_decks_cue_set(1, uid, [_cue(slot=0)], base_revision=0, client_id=None)
    # Another user starts from revision 0 on the same track.
    theirs = put_decks_cue_set(
        other, uid, [_cue("loop", 2, 100.0, 900.0)], base_revision=0, client_id=None
    )
    assert theirs.status == "stored" and theirs.current["revision"] == 1
    put_decks_correction(
        other,
        uid,
        base_revision=0,
        bpm=128.0,
        beat_grid_ms=None,
        key="8A",
        client_id=None,
    )

    assert get_decks_cue_sets(1, [uid])[uid]["cues"] == [_cue(slot=0)]
    assert get_decks_cue_sets(other, [uid])[uid]["cues"] == [
        _cue("loop", 2, 100.0, 900.0)
    ]
    assert get_decks_corrections(1, [uid]) == {}
    assert get_decks_corrections(other, [uid])[uid]["bpm"] == 128.0

    # Deleting a user deletes their cues and corrections only.
    with transaction_scope() as session:
        session.execute(text("DELETE FROM users WHERE id = :id"), {"id": other})
    assert get_decks_cue_sets(other, [uid]) == {}
    assert get_decks_corrections(other, [uid]) == {}
    assert get_decks_cue_sets(1, [uid])[uid]["revision"] == 1


@pg
def test_emptied_set_keeps_its_revision(pg_db):
    del pg_db
    _track_id, uid = _create_track("decks-cues-empty")
    put_decks_cue_set(1, uid, [_cue(slot=3)], base_revision=0, client_id=None)

    cleared = put_decks_cue_set(1, uid, [], base_revision=1, client_id=None)

    assert cleared.status == "stored"
    assert cleared.current["revision"] == 2
    assert get_decks_cue_sets(1, [uid])[uid]["cues"] == []
    assert _cue_rows(1, uid) == []
    # A client that never saw the set cannot overwrite the clearing.
    assert (
        put_decks_cue_set(
            1, uid, [_cue(slot=4)], base_revision=0, client_id=None
        ).status
        == "conflict"
    )


@pg
def test_replacing_a_hotcue_with_a_loop_on_its_slot(pg_db):
    del pg_db
    _track_id, uid = _create_track("decks-cues-shared-slot")
    put_decks_cue_set(1, uid, [_cue(slot=5)], base_revision=0, client_id=None)

    replaced = put_decks_cue_set(
        1, uid, [_cue("loop", 5, 1000.0, 3000.0)], base_revision=1, client_id=None
    )

    assert replaced.status == "stored"
    assert get_decks_cue_sets(1, [uid])[uid]["cues"] == [
        _cue("loop", 5, 1000.0, 3000.0)
    ]
    # The database backs the shared hot cue slots up.
    with pytest.raises(IntegrityError):
        put_decks_cue_set(
            1,
            uid,
            [_cue("loop", 5, 1000.0, 3000.0), _cue("jump", 5, 100.0, 50.0)],
            base_revision=2,
            client_id=None,
        )


@pg
def test_unknown_track_not_found(pg_db):
    del pg_db
    unknown = str(uuid.uuid4())

    result = put_decks_cue_set(1, unknown, [_cue()], base_revision=0, client_id=None)
    assert result.status == "not_found" and result.current is None
    correction = put_decks_correction(
        1,
        unknown,
        base_revision=0,
        bpm=120.0,
        beat_grid_ms=None,
        key=None,
        client_id=None,
    )
    assert correction.status == "not_found"
    assert get_decks_cue_sets(1, [unknown]) == {}


@pg
def test_correction_round_trip_conflict_and_clearing(pg_db):
    del pg_db
    _track_id, uid = _create_track("decks-corrections")
    grid = [480, 949, 1418, 1887]

    stored = put_decks_correction(
        1, uid, base_revision=0, bpm=127.9, beat_grid_ms=grid, key="8a", client_id="a"
    )
    assert stored.status == "stored"
    assert stored.current == {
        "entity_uid": uid,
        "revision": 1,
        "updated_at": stored.current["updated_at"],
        "client_id": "a",
        "bpm": 127.9,
        "beat_grid_format": "delta-ms-v1",
        "beat_grid_ms": grid,
        "key": "8A",
    }
    assert stored.current["updated_at"] is not None
    with read_scope() as session:
        data = session.execute(
            text("SELECT beat_grid_data FROM user_track_corrections")
        ).scalar_one()
    # Stored as the Smart Mix profiles store their grids.
    from crate.smart_mix.beat_grid import encode_beat_grid

    assert bytes(data) == encode_beat_grid(grid)

    same = put_decks_correction(
        1, uid, base_revision=0, bpm=127.9, beat_grid_ms=grid, key="8A", client_id="b"
    )
    assert same.status == "unchanged" and same.current["revision"] == 1

    conflict = put_decks_correction(
        1, uid, base_revision=0, bpm=128.0, beat_grid_ms=None, key=None, client_id="b"
    )
    assert conflict.status == "conflict"
    assert conflict.current["bpm"] == 127.9

    cleared = put_decks_correction(
        1, uid, base_revision=1, bpm=None, beat_grid_ms=None, key=None, client_id="b"
    )
    assert cleared.status == "stored"
    assert get_decks_corrections(1, [uid])[uid] == {
        **cleared.current,
        "revision": 2,
        "bpm": None,
        "beat_grid_format": None,
        "beat_grid_ms": None,
        "key": None,
    }


@pg
def test_batch_reads_answer_only_stored_uids(pg_db):
    del pg_db
    uids = [_create_track(f"decks-cues-batch-{index}")[1] for index in range(3)]
    put_decks_cue_set(1, uids[0], [_cue()], base_revision=0, client_id=None)
    # An empty set over nothing stored writes nothing.
    nothing = put_decks_cue_set(1, uids[2], [], base_revision=0, client_id=None)
    assert nothing.status == "unchanged" and nothing.current["revision"] == 0
    put_decks_cue_set(1, uids[2], [_cue()], base_revision=0, client_id=None)
    put_decks_cue_set(1, uids[2], [], base_revision=1, client_id=None)
    put_decks_correction(
        1,
        uids[1],
        base_revision=0,
        bpm=100.0,
        beat_grid_ms=None,
        key=None,
        client_id=None,
    )

    sets = get_decks_cue_sets(1, [uids[2], uids[1], uids[0].upper(), uids[0]])
    assert list(sets) == [uids[2], uids[0]]
    assert sets[uids[2]]["cues"] == [] and sets[uids[2]]["revision"] == 2
    assert list(get_decks_corrections(1, uids)) == [uids[1]]
    assert get_decks_cue_sets(1, []) == {}
    with pytest.raises(ValueError):
        get_decks_cue_sets(1, [str(uuid.uuid4()) for _ in range(201)])
