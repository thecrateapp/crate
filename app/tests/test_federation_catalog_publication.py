from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from threading import Event, current_thread
from time import monotonic

import pytest
from crate.db.jobs import federation_catalog_changes as changes
from crate.db.tx import read_scope, transaction_scope
from sqlalchemy import text


def _append(title: str, *, entity_uid: str = "artist-a", session=None):
    def write(current):
        return changes.append_catalog_change(
            entity_type="artist",
            entity_uid=entity_uid,
            operation="upsert",
            payload={"title": title},
            session=current,
        )

    if session is not None:
        return write(session)
    with transaction_scope() as current:
        return write(current)


def test_committed_writer_does_not_allocate_public_sequence_before_publication(pg_db):
    del pg_db
    revision = _append("A")

    assert revision.startswith("sha256:")
    assert changes.catalog_high_water_mark() == 0
    assert changes.list_catalog_changes(after_sequence=0, limit=10) == []

    assert changes.publish_pending_catalog_changes(limit=10) == 1
    assert changes.catalog_high_water_mark() > 0
    assert changes.publish_pending_catalog_changes(limit=10) == 0


def test_return_to_previous_payload_is_published_again(pg_db):
    del pg_db
    checkpoints = [0]
    for title in ("A", "B", "A"):
        _append(title)
        changes.publish_pending_catalog_changes(limit=10)
        checkpoints.append(changes.catalog_high_water_mark())

    rows = changes.list_catalog_changes(after_sequence=0, limit=10)
    assert rows[-1]["payload_json"]["title"] == "A"
    assert changes.catalog_high_water_mark() == rows[-1]["sequence"]
    assert checkpoints == sorted(set(checkpoints))
    for checkpoint in checkpoints[:-1]:
        replay = changes.list_catalog_changes(after_sequence=checkpoint, limit=10)
        assert replay[-1]["payload_json"]["title"] == "A"


def test_one_publication_batch_compacts_repeated_states_in_occurrence_order(pg_db):
    del pg_db
    for title in ("A", "B", "A"):
        _append(title)
    assert changes.publish_pending_catalog_changes(limit=10) == 3
    rows = changes.list_catalog_changes(after_sequence=0, limit=10)
    assert [row["payload_json"]["title"] for row in rows] == ["B", "A"]
    assert changes.catalog_retention_floor() == 1


def test_repeated_delete_after_restore_remains_visible_to_all_old_cursors(pg_db):
    del pg_db
    checkpoints = [0]
    for operation in ("delete", "restore", "delete"):
        with transaction_scope() as session:
            changes.append_catalog_change(
                entity_type="artist",
                entity_uid="artist-a",
                operation=operation,
                payload={"title": "A"} if operation == "restore" else None,
                session=session,
            )
        changes.publish_pending_catalog_changes(limit=10)
        checkpoints.append(changes.catalog_high_water_mark())

    for checkpoint in checkpoints[:-1]:
        replay = changes.list_catalog_changes(after_sequence=checkpoint, limit=10)
        assert replay[-1]["operation"] == "delete"
    assert changes.catalog_retention_floor() == 1


def test_reader_continues_across_a_state_row_moved_after_its_first_page(pg_db):
    del pg_db
    _append("A")
    changes.publish_pending_catalog_changes(limit=10)
    first = changes.list_catalog_changes(after_sequence=0, limit=1)
    checkpoint = first[-1]["sequence"]
    for title in ("B", "A"):
        _append(title)
        changes.publish_pending_catalog_changes(limit=10)
    observed = []
    while True:
        page = changes.list_catalog_changes(after_sequence=checkpoint, limit=1)
        if not page:
            break
        observed.append(page[0]["payload_json"]["title"])
        assert page[0]["sequence"] > checkpoint
        checkpoint = page[0]["sequence"]
    assert observed == ["B", "A"]


def test_late_lower_intent_id_receives_a_later_public_sequence(pg_db):
    del pg_db
    staged, release = Event(), Event()

    def delayed_writer():
        with transaction_scope() as session:
            _append("late", session=session)
            staged.set()
            assert release.wait(10)

    with ThreadPoolExecutor(max_workers=1) as pool:
        delayed = pool.submit(delayed_writer)
        try:
            assert staged.wait(10)
            _append("early", entity_uid="artist-b")
            assert changes.publish_pending_catalog_changes(limit=10) == 1
            checkpoint = changes.catalog_high_water_mark()
            assert [
                r["payload_json"]["title"]
                for r in changes.list_catalog_changes(after_sequence=0, limit=10)
            ] == ["early"]
        finally:
            release.set()
        delayed.result(timeout=10)

    assert changes.publish_pending_catalog_changes(limit=10) == 1
    rows = changes.list_catalog_changes(after_sequence=checkpoint, limit=10)
    assert [row["payload_json"]["title"] for row in rows] == ["late"]


def test_legacy_writer_cannot_commit_a_sequence_below_a_new_publisher_checkpoint(pg_db):
    del pg_db
    staged, release = Event(), Event()

    def legacy_writer():
        with transaction_scope() as session:
            # The deployed pre-159 producer does not inspect rowcount/RETURNING.
            session.execute(
                text("""
                INSERT INTO federation_catalog_changes (
                    entity_type, entity_uid, operation, payload_revision,
                    payload_json, retention_until
                ) VALUES ('artist', 'legacy-late', 'upsert', 'legacy-revision',
                          '{"title":"legacy late"}', NOW() + INTERVAL '90 days')
                ON CONFLICT (entity_type, entity_uid, payload_revision, operation)
                DO NOTHING
            """)
            )
            staged.set()
            assert release.wait(10)

    with ThreadPoolExecutor(max_workers=1) as pool:
        old = pool.submit(legacy_writer)
        try:
            assert staged.wait(10)
            _append("new early", entity_uid="new-early")
            assert changes.publish_pending_catalog_changes(limit=10) == 1
            checkpoint = changes.catalog_high_water_mark()
        finally:
            release.set()
        old.result(timeout=10)
    assert changes.publish_pending_catalog_changes(limit=10) == 1
    rows = changes.list_catalog_changes(after_sequence=checkpoint, limit=10)
    assert [row["payload_json"]["title"] for row in rows] == ["legacy late"]


def test_publisher_bypass_is_transaction_local_and_old_inserts_still_stage_afterward(
    pg_db,
):
    del pg_db
    _append("published")
    assert changes.publish_pending_catalog_changes(limit=10) == 1
    checkpoint = changes.catalog_high_water_mark()
    with transaction_scope() as session:
        assert (
            session.execute(
                text("""
            SELECT current_setting('crate.federation_catalog_publisher', true)
        """)
            ).scalar_one()
            != "on"
        )
        session.execute(
            text("""
            INSERT INTO federation_catalog_changes (
                entity_type, entity_uid, operation, payload_revision,
                payload_json, retention_until
            ) VALUES ('artist', 'legacy-after-publish', 'upsert', 'legacy-revision',
                      '{"title":"still staged"}', NOW() + INTERVAL '90 days')
            ON CONFLICT (entity_type, entity_uid, payload_revision, operation)
            DO NOTHING
        """)
        )
    assert changes.catalog_high_water_mark() == checkpoint
    assert changes.publish_pending_catalog_changes(limit=10) == 1
    assert changes.catalog_high_water_mark() > checkpoint


def test_empty_probe_does_not_hold_an_outbox_lock_while_waiting_for_downgrade(
    pg_db, monkeypatch
):
    del pg_db
    from crate.db.schema_sections.federation_catalog_publication_v159 import (
        drop_federation_catalog_publication_v159_schema,
    )
    from sqlalchemy.orm import Session

    _append("pending")
    state_locked, probe_seen = Event(), Event()
    original_execute = Session.execute

    def observe_probe(session, statement, *args, **kwargs):
        result = original_execute(session, statement, *args, **kwargs)
        if "SELECT EXISTS (SELECT 1 FROM federation_catalog_change_outbox)" in str(
            statement
        ):
            probe_seen.set()
        return result

    monkeypatch.setattr(Session, "execute", observe_probe)

    class LocksAcquired(Exception):
        pass

    class LockOnlyExecutor:
        def __init__(self, session):
            self.session = session

        def execute(self, sql):
            if "set_config" in sql:
                # Roll back after the actual downgrade has acquired all locks;
                # retain the schema so the paused publisher can finish normally.
                raise LocksAcquired
            self.session.execute(text(sql))
            if "federation_catalog_feed_state" in sql:
                state_locked.set()
                assert probe_seen.wait(10)

    def acquire_downgrade_locks():
        with pytest.raises(LocksAcquired), transaction_scope() as session:
            drop_federation_catalog_publication_v159_schema(LockOnlyExecutor(session))

    with ThreadPoolExecutor(max_workers=2) as pool:
        downgrade = pool.submit(acquire_downgrade_locks)
        assert state_locked.wait(10)
        publisher = pool.submit(changes.publish_pending_catalog_changes, limit=10)
        downgrade.result(timeout=12)
        assert publisher.result(timeout=12) == 1


def test_upgrade_barrier_waits_for_old_inflight_writes_before_seeding_cursor(pg_db):
    del pg_db
    from crate.db.schema_sections.federation_catalog_publication_v159 import (
        create_federation_catalog_publication_v159_schema,
        drop_federation_catalog_publication_v159_schema,
    )

    class Executor:
        def __init__(self, session):
            self.session = session

        def execute(self, sql):
            self.session.execute(text(sql))

    with transaction_scope() as session:
        drop_federation_catalog_publication_v159_schema(Executor(session))
        session.execute(text("DROP TABLE federation_catalog_feed_state"))

    legacy_started, release_legacy = Event(), Event()

    def old_transaction():
        with transaction_scope() as session:
            sequence = session.execute(
                text("""
                INSERT INTO federation_catalog_changes (
                    entity_type, entity_uid, operation, payload_revision,
                    payload_json, retention_until
                ) VALUES ('artist', 'old-inflight', 'upsert', 'legacy-revision',
                          '{"title":"before upgrade"}', NOW() + INTERVAL '90 days')
                RETURNING sequence
            """)
            ).scalar_one()
            legacy_started.set()
            assert release_legacy.wait(10)
        return sequence

    def upgrade():
        with transaction_scope() as session:
            session.execute(text("SET LOCAL lock_timeout = '8s'"))
            create_federation_catalog_publication_v159_schema(Executor(session))

    with ThreadPoolExecutor(max_workers=2) as pool:
        old = pool.submit(old_transaction)
        try:
            assert legacy_started.wait(10)
            migration = pool.submit(upgrade)
            waiting = False
            deadline = monotonic() + 5
            while monotonic() < deadline:
                with read_scope() as session:
                    waiting = bool(
                        session.execute(
                            text("""
                        SELECT EXISTS (
                            SELECT 1 FROM pg_locks locks
                            JOIN pg_class relation ON relation.oid = locks.relation
                            WHERE relation.relname = 'federation_catalog_changes'
                              AND locks.mode = 'AccessExclusiveLock'
                              AND NOT locks.granted
                        )
                    """)
                        ).scalar_one()
                    )
                if waiting:
                    break
                release_legacy.wait(0.01)
            assert waiting, "The migration must wait for the legacy feed writer"
        finally:
            release_legacy.set()
        old_sequence = old.result(timeout=10)
        migration.result(timeout=10)
    assert changes.catalog_high_water_mark() == old_sequence
    assert changes.list_catalog_changes(after_sequence=old_sequence, limit=10) == []
    with transaction_scope() as session:
        session.execute(
            text("""
            INSERT INTO federation_catalog_changes (
                entity_type, entity_uid, operation, payload_revision,
                payload_json, retention_until
            ) VALUES ('artist', 'old-after-upgrade', 'upsert', 'legacy-after-revision',
                      '{"title":"after upgrade"}', NOW() + INTERVAL '90 days')
        """)
        )
    assert changes.catalog_high_water_mark() == old_sequence
    assert changes.publish_pending_catalog_changes(limit=10) == 1
    assert (
        changes.list_catalog_changes(after_sequence=old_sequence, limit=10)[0][
            "payload_json"
        ]["title"]
        == "after upgrade"
    )


def test_source_rollback_never_leaves_a_publication_intent(pg_db):
    del pg_db
    with (
        pytest.raises(RuntimeError, match="source failed"),
        transaction_scope() as session,
    ):
        _append("discarded", session=session)
        raise RuntimeError("source failed")

    assert changes.publish_pending_catalog_changes(limit=10) == 0
    assert changes.catalog_high_water_mark() == 0


def test_publication_failure_rolls_back_log_and_intent_consumption(pg_db):
    del pg_db
    from sqlalchemy.exc import DBAPIError

    _append("retry me")
    with transaction_scope() as session:
        session.execute(
            text("""
            CREATE FUNCTION fail_catalog_intent_delete() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'publisher failed'; END $$;
            CREATE TRIGGER fail_catalog_intent_delete BEFORE DELETE
            ON federation_catalog_change_outbox FOR EACH ROW
            EXECUTE FUNCTION fail_catalog_intent_delete();
        """)
        )
    with pytest.raises(DBAPIError, match="publisher failed"):
        changes.publish_pending_catalog_changes(limit=10)
    assert changes.catalog_high_water_mark() == 0

    with transaction_scope() as session:
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM federation_catalog_changes")
            ).scalar_one()
            == 0
        )
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM federation_catalog_change_outbox")
            ).scalar_one()
            == 1
        )
        session.execute(
            text(
                "DROP TRIGGER fail_catalog_intent_delete ON federation_catalog_change_outbox"
            )
        )
        session.execute(text("DROP FUNCTION fail_catalog_intent_delete()"))
    assert changes.publish_pending_catalog_changes(limit=10) == 1
    assert changes.publish_pending_catalog_changes(limit=10) == 0
    assert len(changes.list_catalog_changes(after_sequence=0, limit=10)) == 1


def test_rolled_back_sequence_gap_does_not_require_a_full_sync(pg_db):
    del pg_db
    with transaction_scope() as session:
        session.execute(
            text("SELECT nextval('federation_catalog_changes_sequence_seq')")
        )
    _append("first committed")
    changes.publish_pending_catalog_changes(limit=10)

    assert changes.catalog_retention_floor() == 1
    assert len(changes.list_catalog_changes(after_sequence=0, limit=10)) == 1


def test_pruning_retains_high_water_and_records_only_deleted_prefix(pg_db):
    del pg_db
    _append("expired first")
    _append("live", entity_uid="artist-b")
    _append("expired after live", entity_uid="artist-c")
    changes.publish_pending_catalog_changes(limit=10)
    before = changes.list_catalog_changes(after_sequence=0, limit=10)
    watermark = changes.catalog_high_water_mark()
    with transaction_scope() as session:
        session.execute(
            text("""
            UPDATE federation_catalog_changes
            SET retention_until = NOW() - INTERVAL '1 day'
            WHERE entity_uid <> 'artist-b'
        """)
        )

    assert changes.cleanup_expired_catalog_changes() == 1
    assert changes.catalog_retention_floor() == before[0]["sequence"] + 1
    assert changes.catalog_high_water_mark() == watermark
    assert (
        len(
            changes.list_catalog_changes(after_sequence=before[0]["sequence"], limit=10)
        )
        == 2
    )
    with pytest.raises(changes.CatalogHistoryExpired):
        changes.list_catalog_changes(after_sequence=0, limit=10)

    with transaction_scope() as session:
        session.execute(
            text("""
            UPDATE federation_catalog_changes
            SET retention_until = NOW() - INTERVAL '1 day'
        """)
        )
    assert changes.cleanup_expired_catalog_changes() == 2
    assert changes.catalog_high_water_mark() == watermark
    assert changes.catalog_retention_floor() == watermark + 1
    assert changes.list_catalog_changes(after_sequence=watermark, limit=10) == []


def test_downgrade_flushes_committed_intents_without_discarding_legacy_rows(pg_db):
    del pg_db
    from crate.db.schema_sections.federation_catalog_publication_v159 import (
        create_federation_catalog_publication_v159_schema,
        drop_federation_catalog_publication_v159_schema,
    )

    _append("legacy")
    changes.publish_pending_catalog_changes(limit=10)
    checkpoint = changes.catalog_high_water_mark()
    _append("pending", entity_uid="artist-b")

    class Executor:
        def __init__(self, session):
            self.session = session

        def execute(self, sql):
            self.session.execute(text(sql))

    with transaction_scope() as session:
        executor = Executor(session)
        drop_federation_catalog_publication_v159_schema(executor)
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM federation_catalog_changes")
            ).scalar_one()
            == 2
        )
        # Reapplying the migration must preserve deployed numeric cursors.
        create_federation_catalog_publication_v159_schema(executor)
    assert changes.catalog_high_water_mark() > checkpoint
    assert [
        row["payload_json"]["title"]
        for row in changes.list_catalog_changes(after_sequence=checkpoint, limit=10)
    ] == ["pending"]


def test_downgrade_upgrade_preserves_exact_pruning_boundary_and_legacy_writes(pg_db):
    del pg_db
    from crate.db.schema_sections.federation_catalog_publication_v159 import (
        create_federation_catalog_publication_v159_schema,
        drop_federation_catalog_publication_v159_schema,
    )

    for title in ("A", "B", "A"):
        _append(title)
    changes.publish_pending_catalog_changes(limit=10)
    assert changes.catalog_retention_floor() == 1
    watermark = changes.catalog_high_water_mark()
    with transaction_scope() as session:
        session.execute(
            text("""
            UPDATE federation_catalog_changes SET retention_until = NOW() - INTERVAL '1 day'
        """)
        )
    changes.cleanup_expired_catalog_changes()
    floor = changes.catalog_retention_floor()
    assert floor == watermark + 1

    class Executor:
        def __init__(self, session):
            self.session = session

        def execute(self, sql):
            self.session.execute(text(sql))

    with transaction_scope() as session:
        executor = Executor(session)
        drop_federation_catalog_publication_v159_schema(executor)
        # An old image still has its original ON CONFLICT target available.
        legacy_sequence = session.execute(
            text("""
            INSERT INTO federation_catalog_changes (
                entity_type, entity_uid, operation, payload_revision,
                payload_json, retention_until
            ) VALUES ('artist', 'legacy', 'upsert', 'old-revision',
                      '{"title":"old image"}', NOW() + INTERVAL '90 days')
            ON CONFLICT (entity_type, entity_uid, payload_revision, operation) DO NOTHING
            RETURNING sequence
        """)
        ).scalar_one()
        create_federation_catalog_publication_v159_schema(executor)
    assert changes.catalog_retention_floor() == floor
    assert changes.catalog_high_water_mark() == legacy_sequence
    assert (
        changes.list_catalog_changes(after_sequence=watermark, limit=10)[0][
            "payload_json"
        ]["title"]
        == "old image"
    )


def test_failed_downgrade_preserves_pending_intents_and_schema(pg_db):
    del pg_db
    from crate.db.schema_sections.federation_catalog_publication_v159 import (
        drop_federation_catalog_publication_v159_schema,
    )
    from sqlalchemy.exc import DBAPIError

    _append("pending")
    with transaction_scope() as session:
        session.execute(
            text("""
            CREATE FUNCTION fail_catalog_log_insert() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'downgrade failed'; END $$;
            CREATE TRIGGER fail_catalog_log_insert BEFORE INSERT
            ON federation_catalog_changes FOR EACH ROW
            EXECUTE FUNCTION fail_catalog_log_insert();
        """)
        )

    class Executor:
        def __init__(self, session):
            self.session = session

        def execute(self, sql):
            self.session.execute(text(sql))

    with (
        pytest.raises(DBAPIError, match="downgrade failed"),
        transaction_scope() as session,
    ):
        drop_federation_catalog_publication_v159_schema(Executor(session))
    with read_scope() as session:
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM federation_catalog_change_outbox")
            ).scalar_one()
            == 1
        )
    assert changes.catalog_high_water_mark() == 0


@pytest.mark.parametrize("existing_rows", [True, False])
def test_first_upgrade_preserves_deployed_watermark_and_legacy_rows(
    pg_db, existing_rows
):
    del pg_db
    from crate.db.schema_sections.federation_catalog_publication_v159 import (
        create_federation_catalog_publication_v159_schema,
        drop_federation_catalog_publication_v159_schema,
    )

    class Executor:
        def __init__(self, session):
            self.session = session

        def execute(self, sql):
            self.session.execute(text(sql))

    with transaction_scope() as session:
        drop_federation_catalog_publication_v159_schema(Executor(session))
        session.execute(text("DROP TABLE federation_catalog_feed_state"))
        session.execute(
            text("SELECT setval('federation_catalog_changes_sequence_seq', 30)")
        )
        if existing_rows:
            session.execute(
                text("""
                INSERT INTO federation_catalog_changes (
                    sequence, entity_type, entity_uid, operation,
                    payload_revision, payload_json, retention_until
                ) VALUES (30, 'artist', 'old', 'upsert', 'legacy-revision',
                          '{"title":"legacy payload"}', NOW() + INTERVAL '90 days')
            """)
            )
        create_federation_catalog_publication_v159_schema(Executor(session))

    assert changes.catalog_high_water_mark() == 30
    assert changes.catalog_retention_floor() == (30 if existing_rows else 31)
    assert changes.list_catalog_changes(after_sequence=30, limit=10) == []
    if existing_rows:
        rows = changes.list_catalog_changes(after_sequence=29, limit=10)
        assert rows[0]["payload_json"] == {"title": "legacy payload"}
    _append("new", entity_uid="new")
    changes.publish_pending_catalog_changes(limit=10)
    assert changes.catalog_high_water_mark() == 31
    assert changes.list_catalog_changes(after_sequence=30, limit=10)[0][
        "payload_json"
    ] == {"title": "new"}


def test_concurrent_publishers_apply_one_bounded_page_each(pg_db):
    del pg_db
    for index in range(6):
        _append(str(index), entity_uid=f"artist-{index}")
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(changes.publish_pending_catalog_changes, limit=3)
            for _ in range(2)
        ]
        assert sum(future.result(timeout=10) for future in futures) == 6
    rows = changes.list_catalog_changes(after_sequence=0, limit=10)
    assert len(rows) == 6
    assert len({row["sequence"] for row in rows}) == 6
    with read_scope() as session:
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM federation_catalog_change_outbox")
            ).scalar_one()
            == 0
        )


def test_an_uncommitted_publisher_cannot_be_overtaken_by_another_publisher(
    pg_db, monkeypatch
):
    del pg_db
    from sqlalchemy.orm import Session

    ready, release, second_started = Event(), Event(), Event()
    original_commit = Session.commit

    def pause_first_commit(session):
        if current_thread().name.startswith("first-publisher"):
            ready.set()
            assert release.wait(10)
        return original_commit(session)

    monkeypatch.setattr(Session, "commit", pause_first_commit)
    _append("first")
    with ThreadPoolExecutor(
        max_workers=1, thread_name_prefix="first-publisher"
    ) as first_pool:
        first = first_pool.submit(changes.publish_pending_catalog_changes, limit=1)
        try:
            assert ready.wait(10)
            _append("second", entity_uid="artist-b")

            def publish_second():
                second_started.set()
                return changes.publish_pending_catalog_changes(limit=1)

            with ThreadPoolExecutor(max_workers=1) as second_pool:
                second = second_pool.submit(publish_second)
                try:
                    assert second_started.wait(10)
                    assert changes.catalog_high_water_mark() == 0
                    assert (
                        changes.list_catalog_changes(after_sequence=0, limit=10) == []
                    )
                    assert not second.done()
                finally:
                    release.set()
                assert second.result(timeout=10) == 1
        finally:
            release.set()
        assert first.result(timeout=10) == 1
    rows = changes.list_catalog_changes(after_sequence=0, limit=10)
    assert [row["payload_json"]["title"] for row in rows] == ["first", "second"]
    assert changes.catalog_high_water_mark() == rows[-1]["sequence"]


@pytest.mark.parametrize("size", [1, 200])
def test_publication_uses_a_constant_number_of_statements_per_page(
    pg_db, monkeypatch, size
):
    del pg_db
    from sqlalchemy.orm import Session

    for index in range(size):
        _append(str(index), entity_uid=f"artist-{index}")
    statements = []
    original_execute = Session.execute

    def record(session, statement, *args, **kwargs):
        statements.append(str(statement))
        return original_execute(session, statement, *args, **kwargs)

    monkeypatch.setattr(Session, "execute", record)
    assert changes.publish_pending_catalog_changes(limit=size) == size
    assert len(statements) == 3
