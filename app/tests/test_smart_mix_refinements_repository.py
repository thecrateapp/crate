"""Stored Smart Mix refinements (SM4.PR2, design §6)."""

from __future__ import annotations

from importlib import import_module

from sqlalchemy import text

from crate.db.repositories.smart_mix import upsert_track_mix_profile
from crate.db.repositories.smart_mix_refinements import (
    cleanup_unread_refinements,
    get_many,
    invalidate_for_tracks,
    refinement_latency_p50_ms,
    save,
    touch,
)
from crate.db.schema_bootstrap import create_schema
from crate.db.schema_sections.smart_mix_refined_plans_v152 import (
    create_smart_mix_refined_plans_v152_schema,
    drop_smart_mix_refined_plans_v152_schema,
)
from crate.db.tx import transaction_scope
from tests.sql_statements import recorded_statements
from tests.test_agent_access_migration import RecordingExecutor
from tests.test_smart_mix_repository import _create_track, _profile

MIGRATION = "crate.db.migrations.versions.152_smart_mix_refined_plans"
PLAN = {
    "plannerVersion": 2,
    "mode": "beatmatch",
    "durationMs": 15360,
    "outgoingCueMs": 180000,
}


def _row(key: str, outgoing: str, incoming: str, **overrides) -> dict:
    row = {
        "refinement_key": key,
        "from_entity_uid": outgoing,
        "to_entity_uid": incoming,
        "from_profile_revision": "profile-v1",
        "to_profile_revision": "profile-v1",
        "planner_identifier": "smart-mix-v3",
        "rules_revision": 1,
        "prompt_version": "sm3-refine-3",
        "config_fingerprint": "f" * 64,
        "model_label": "qwen3.8:27b",
        "status": "ready",
        "outcome_code": None,
        "candidate_index": 2,
        "adjustments": {"outgoingPhraseShift": -1, "lengthStep": 0},
        "plan": PLAN,
        "deterministic_plan_hash": "d" * 64,
        "reason": "Blend the outro into the intro.",
        "confidence": 0.8,
        "latency_ms": 2400,
        "invocation_id": None,
    }
    row.update(overrides)
    return row


def _key(number: int) -> str:
    return f"{number:064x}"


def test_migration_and_bootstrap_use_the_same_schema(monkeypatch):
    migration = import_module(MIGRATION)
    migrated, section, bootstrap = (
        RecordingExecutor(),
        RecordingExecutor(),
        RecordingExecutor(),
    )
    monkeypatch.setattr(migration, "op", migrated)
    migration.upgrade()
    create_smart_mix_refined_plans_v152_schema(section)
    create_schema(bootstrap)

    assert (migration.revision, migration.down_revision) == ("152", "151")
    assert migrated.statements == section.statements
    joined = "\n".join(bootstrap.statements)
    assert all(statement in joined for statement in section.statements)
    assert any(
        "(from_entity_uid, to_entity_uid)" in statement
        for statement in section.statements
    )
    assert any("(last_read_at)" in statement for statement in section.statements)

    downgrade = RecordingExecutor()
    monkeypatch.setattr(migration, "op", downgrade)
    migration.downgrade()
    expected = RecordingExecutor()
    drop_smart_mix_refined_plans_v152_schema(expected)
    assert downgrade.statements == expected.statements
    assert downgrade.statements == ["DROP TABLE IF EXISTS smart_mix_refined_plans"]


def test_get_many_single_query(pg_db):
    del pg_db
    outgoing, incoming = (_create_track(name)[1] for name in ("out", "in"))
    for number in range(3):
        save(_row(_key(number), outgoing, incoming, candidate_index=number))
    save(
        _row(
            _key(9),
            outgoing,
            incoming,
            status="rejected",
            outcome_code="low_confidence",
            plan=None,
        )
    )

    with recorded_statements() as statements:
        found = get_many([_key(0), _key(2), _key(9), _key(7)])

    assert len(statements) == 1
    assert "ANY(" in statements[0]
    assert set(found) == {_key(0), _key(2), _key(9)}
    ready = found[_key(2)]
    assert ready["status"] == "ready"
    assert ready["plan"] == PLAN
    assert ready["candidate_index"] == 2
    assert ready["model_label"] == "qwen3.8:27b"
    assert ready["prompt_version"] == "sm3-refine-3"
    assert ready["confidence"] == 0.8
    assert found[_key(9)]["outcome_code"] == "low_confidence"
    assert found[_key(9)]["plan"] is None
    assert get_many([]) == {}


def test_save_idempotent_by_key(pg_db):
    del pg_db
    outgoing, incoming = (_create_track(name)[1] for name in ("out", "in"))
    row = _row(_key(1), outgoing, incoming)

    save(row)
    save(row)
    save({**row, "latency_ms": 3100})

    with transaction_scope() as session:
        count = session.execute(
            text("SELECT count(*) FROM smart_mix_refined_plans")
        ).scalar_one()
    assert count == 1
    assert get_many([_key(1)])[_key(1)]["latency_ms"] == 3100


def test_save_reads_tokens_from_the_invocation(pg_db):
    del pg_db
    outgoing, incoming = (_create_track(name)[1] for name in ("out", "in"))
    with transaction_scope() as session:
        connection = session.execute(
            text(
                "INSERT INTO ai_provider_connections(label, provider) "
                "VALUES ('Refine', 'ollama') RETURNING id::text"
            )
        ).scalar_one()
        invocation = session.execute(
            text(
                """
                INSERT INTO ai_invocations
                    (idempotency_key, connection_id, action_id, model_id,
                     reserved_tokens, charged_tokens, input_tokens, output_tokens)
                VALUES ('refine-1', CAST(:connection AS uuid),
                        'smart_mix.transition.refine', 'model', 7000, 2600, 2400, 200)
                RETURNING id::text
                """
            ),
            {"connection": connection},
        ).scalar_one()

    save(_row(_key(1), outgoing, incoming, invocation_id=invocation))

    stored = get_many([_key(1)])[_key(1)]
    assert (stored["input_tokens"], stored["output_tokens"]) == (2400, 200)


def test_invalidate_for_tracks(pg_db):
    del pg_db
    out_id, outgoing = _create_track("out")
    in_id, incoming = _create_track("in")
    other_id, other = _create_track("other")
    for track_id, uid in ((out_id, outgoing), (in_id, incoming), (other_id, other)):
        upsert_track_mix_profile(track_id, _profile(uid, revision="profile-v1"))
    save(_row(_key(1), outgoing, incoming))
    save(_row(_key(2), incoming, other))
    save(_row(_key(3), other, outgoing))

    # Same revision: the refinements still describe the tracks.
    assert invalidate_for_tracks([incoming]) == 0
    upsert_track_mix_profile(in_id, _profile(incoming, revision="profile-v2"))

    assert invalidate_for_tracks([incoming]) == 2
    assert set(get_many([_key(1), _key(2), _key(3)])) == {_key(3)}
    assert invalidate_for_tracks([]) == 0


def test_cleanup_respects_last_read(pg_db):
    del pg_db
    outgoing, incoming = (_create_track(name)[1] for name in ("out", "in"))
    for number in range(4):
        save(_row(_key(number), outgoing, incoming))
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE smart_mix_refined_plans "
                "SET last_read_at = now() - interval '200 days', "
                "created_at = now() - interval '300 days'"
            )
        )

    # Reads recorded since then keep their refinement.
    assert touch([_key(1), _key(3), _key(8)]) == 2
    assert cleanup_unread_refinements(older_than_days=180) == 2
    assert set(get_many([_key(n) for n in range(4)])) == {_key(1), _key(3)}
    assert cleanup_unread_refinements(older_than_days=180) == 0


def test_latency_p50_reads_the_last_day(pg_db):
    del pg_db
    outgoing, incoming = (_create_track(name)[1] for name in ("out", "in"))
    assert refinement_latency_p50_ms() is None
    for number, latency in enumerate((1000, 2000, 9000)):
        save(_row(_key(number), outgoing, incoming, latency_ms=latency))
    save(_row(_key(5), outgoing, incoming, latency_ms=60_000))
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE smart_mix_refined_plans "
                "SET created_at = now() - interval '2 days' "
                "WHERE refinement_key = :key"
            ),
            {"key": _key(5)},
        )

    assert refinement_latency_p50_ms() == 2000


def test_track_genre_slugs_take_the_heaviest_album_genre(pg_db):
    from crate.db.queries.smart_mix_refinement import get_track_genre_slugs

    del pg_db
    tagged_id, tagged = _create_track("tagged")
    _untagged_id, untagged = _create_track("untagged")
    with transaction_scope() as session:
        album_id = session.execute(
            text("SELECT album_id FROM library_tracks WHERE id = :id"),
            {"id": tagged_id},
        ).scalar_one()
        for name, slug, weight in (
            ("Techno", "techno", 0.4),
            ("Minimal Techno", "minimal-techno", 0.9),
        ):
            genre_id = session.execute(
                text(
                    "INSERT INTO genres (name, slug) VALUES (:name, :slug) RETURNING id"
                ),
                {"name": name, "slug": slug},
            ).scalar_one()
            session.execute(
                text(
                    "INSERT INTO album_genres (album_id, genre_id, weight) "
                    "VALUES (:album, :genre, :weight)"
                ),
                {"album": album_id, "genre": genre_id, "weight": weight},
            )

    with recorded_statements() as statements:
        slugs = get_track_genre_slugs([tagged, untagged, tagged])

    assert slugs == {tagged: "minimal-techno", untagged: None}
    assert len(statements) == 1
    assert get_track_genre_slugs([]) == {}
