"""Stem analyses stored per track and producer (STEM-D1, D4, design §5 and §7)."""

from __future__ import annotations

from dataclasses import replace

import pytest
from sqlalchemy import event, text

from crate.db.repositories.smart_mix import (
    mark_track_mix_source_revision,
    upsert_track_mix_profile,
)
from crate.db.repositories.smart_mix_stems import (
    get_stem_analyses,
    get_stem_track,
    upsert_stem_analysis,
)
from crate.db.tx import read_scope, transaction_scope
from crate.smart_mix.stems import STEM_SOURCES, StemAnalysis
from tests.test_smart_mix_repository import _create_track, _profile

REVISION_A = "a" * 64
REVISION_B = "b" * 64
SERVER = "crate-server/2026.11.8"
DECKS = "crate-decks/0.4.0"


def _analysis(
    *,
    producer: str = SERVER,
    model: str = "htdemucs",
    revision: str = REVISION_A,
    level: int = 10,
    beats: tuple[int, ...] | None = None,
) -> StemAnalysis:
    return StemAnalysis(
        schema_version="stem-analysis/1",
        producer=producer,
        separator={
            "model": model,
            "version": f"{model}-onnx-1",
            "sources": STEM_SOURCES,
        },
        source_revision=revision,
        hop_ms=250,
        levels={
            stem: bytes([level + offset]) * 8
            for offset, stem in enumerate(STEM_SOURCES)
        },
        drum_beats_ms=beats,
        duration_ms=2_000,
    )


def _create_user(email: str) -> int:
    with transaction_scope() as session:
        return session.execute(
            text(
                "INSERT INTO users (email, name, role, created_at) "
                "VALUES (:email, 'Stem contributor', 'admin', NOW()) RETURNING id"
            ),
            {"email": email},
        ).scalar_one()


def _stored_row(track_id: int, producer_kind: str) -> dict | None:
    with read_scope() as session:
        row = (
            session.execute(
                text(
                    "SELECT producer, contributed_by, created_at, updated_at "
                    "FROM track_stem_signals "
                    "WHERE track_id = :track_id AND producer_kind = :kind"
                ),
                {"track_id": track_id, "kind": producer_kind},
            )
            .mappings()
            .first()
        )
    return None if row is None else dict(row)


def test_stores_and_reads_back_an_analysis(pg_db) -> None:
    del pg_db
    track_id, _uid = _create_track("stems-store")
    analysis = _analysis(beats=(0, 500, 1_000, 1_500))

    assert upsert_stem_analysis(track_id, analysis, producer_kind="server") == "stored"

    assert get_stem_analyses([track_id]) == {track_id: [analysis]}


def test_replaces_a_row_whose_source_revision_changed(pg_db) -> None:
    del pg_db
    track_id, _uid = _create_track("stems-revision")
    old = _analysis(model="htdemucs_ft", revision=REVISION_A, level=10)
    new = _analysis(model="htdemucs", revision=REVISION_B, level=50)

    assert upsert_stem_analysis(track_id, old, producer_kind="server") == "stored"
    # The old file's analysis goes even though its separator was stronger.
    assert upsert_stem_analysis(track_id, new, producer_kind="server") == "replaced"

    assert get_stem_analyses([track_id]) == {track_id: [new]}


def test_decks_row_never_replaces_a_server_row_from_an_equal_or_stronger_separator(
    pg_db,
) -> None:
    del pg_db
    equal_id, _ = _create_track("stems-equal")
    stronger_id, _ = _create_track("stems-stronger")
    weaker_id, _ = _create_track("stems-weaker")
    server = _analysis()
    server_ft = _analysis(model="htdemucs_ft")
    decks = _analysis(producer=DECKS, level=90)
    decks_ft = _analysis(producer=DECKS, model="htdemucs_ft", level=90)
    upsert_stem_analysis(equal_id, server, producer_kind="server")
    upsert_stem_analysis(stronger_id, server_ft, producer_kind="server")
    upsert_stem_analysis(weaker_id, server, producer_kind="server")

    assert (
        upsert_stem_analysis(equal_id, decks, producer_kind="decks") == "kept_stronger"
    )
    assert (
        upsert_stem_analysis(stronger_id, decks_ft, producer_kind="decks")
        == "kept_stronger"
    )
    assert upsert_stem_analysis(weaker_id, decks_ft, producer_kind="decks") == "stored"

    assert get_stem_analyses([equal_id, stronger_id, weaker_id]) == {
        equal_id: [server],
        stronger_id: [server_ft],
        weaker_id: [decks_ft, server],
    }


def test_a_server_row_of_another_file_does_not_hold_back_a_decks_upload(
    pg_db,
) -> None:
    del pg_db
    track_id, _uid = _create_track("stems-stale-server")
    upsert_stem_analysis(
        track_id, _analysis(model="htdemucs_ft"), producer_kind="server"
    )
    decks = _analysis(producer=DECKS, revision=REVISION_B)

    assert upsert_stem_analysis(track_id, decks, producer_kind="decks") == "stored"


@pytest.mark.parametrize(("producer", "kind"), [(SERVER, "server"), (DECKS, "decks")])
def test_a_weaker_analysis_never_overwrites_a_stronger_one_of_the_same_file(
    pg_db, producer: str, kind: str
) -> None:
    del pg_db
    track_id, _uid = _create_track(f"stems-weaker-{kind}")
    stronger = _analysis(producer=producer, model="htdemucs_ft")
    upsert_stem_analysis(track_id, stronger, producer_kind=kind)

    weaker = _analysis(producer=producer, level=70)
    assert upsert_stem_analysis(track_id, weaker, producer_kind=kind) == "kept_stronger"
    equal = _analysis(producer=producer, model="htdemucs_ft", level=80)
    assert upsert_stem_analysis(track_id, equal, producer_kind=kind) == "replaced"

    assert get_stem_analyses([track_id]) == {track_id: [equal]}


def test_reads_many_tracks_in_one_query(pg_db) -> None:
    del pg_db
    from crate.db.engine import get_engine

    tracks = [_create_track(f"stems-batch-{index}")[0] for index in range(3)]
    empty_id, _ = _create_track("stems-batch-empty")
    for index, track_id in enumerate(tracks):
        upsert_stem_analysis(
            track_id, _analysis(level=10 * index), producer_kind="server"
        )
    upsert_stem_analysis(
        tracks[0], _analysis(producer=DECKS, model="htdemucs_ft"), producer_kind="decks"
    )
    statements: list[str] = []

    def capture(_conn, _cursor, statement, *_args) -> None:
        if "track_stem_signals" in statement:
            statements.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        analyses = get_stem_analyses([*tracks, empty_id])
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    assert len(statements) == 1
    assert "ANY" in statements[0]
    assert list(analyses) == [*tracks, empty_id]
    assert [len(analyses[track_id]) for track_id in tracks] == [2, 1, 1]
    assert analyses[empty_id] == []
    assert get_stem_analyses([]) == {}


def test_the_producer_kind_must_match_the_producer(pg_db) -> None:
    del pg_db
    track_id, _uid = _create_track("stems-kind")

    with pytest.raises(ValueError):
        upsert_stem_analysis(track_id, _analysis(), producer_kind="decks")
    with pytest.raises(ValueError):
        upsert_stem_analysis(
            track_id, _analysis(producer=DECKS), producer_kind="server"
        )
    # Only Decks uploads are contributed by a user.
    with pytest.raises(ValueError):
        upsert_stem_analysis(
            track_id, _analysis(), producer_kind="server", contributed_by=1
        )
    assert get_stem_analyses([track_id]) == {track_id: []}


def test_uploads_record_who_contributed_them(pg_db) -> None:
    del pg_db
    track_id, _uid = _create_track("stems-audit")
    first_user = _create_user("first-stems@test.local")
    second_user = _create_user("second-stems@test.local")

    upsert_stem_analysis(
        track_id,
        _analysis(producer=DECKS),
        producer_kind="decks",
        contributed_by=first_user,
    )
    created = _stored_row(track_id, "decks")
    upsert_stem_analysis(
        track_id,
        _analysis(producer="crate-decks/0.5.0", revision=REVISION_B),
        producer_kind="decks",
        contributed_by=second_user,
    )
    replaced = _stored_row(track_id, "decks")

    assert created is not None and replaced is not None
    assert created["contributed_by"] == first_user
    assert replaced["contributed_by"] == second_user
    assert replaced["producer"] == "crate-decks/0.5.0"
    assert replaced["created_at"] == created["created_at"]
    assert replaced["updated_at"] >= created["updated_at"]


def test_analyses_are_deleted_with_their_track(pg_db) -> None:
    del pg_db
    track_id, _uid = _create_track("stems-cascade")
    upsert_stem_analysis(track_id, _analysis(), producer_kind="server")

    with transaction_scope() as session:
        session.execute(
            text("DELETE FROM library_tracks WHERE id = :id"), {"id": track_id}
        )

    assert get_stem_analyses([track_id]) == {track_id: []}


def test_stem_track_reads_the_current_source_revision_and_the_analyses(
    pg_db,
) -> None:
    del pg_db
    track_id, track_uid = _create_track("stems-target")
    bare_id, bare_uid = _create_track("stems-target-bare")
    upsert_track_mix_profile(
        track_id, replace(_profile(track_uid), source_revision=REVISION_A)
    )
    server = _analysis()
    decks = _analysis(producer=DECKS, model="htdemucs_ft")
    upsert_stem_analysis(track_id, server, producer_kind="server")
    upsert_stem_analysis(track_id, decks, producer_kind="decks")

    target = get_stem_track(track_uid)

    assert target is not None
    assert target.track_id == track_id
    assert target.source_revision == REVISION_A
    assert target.duration_ms == 180_000
    assert target.analyses == (decks, server)

    bare = get_stem_track(bare_uid)
    assert bare is not None and bare.track_id == bare_id
    assert bare.source_revision is None and bare.analyses == ()

    # A file replaced since its profile has no current revision until it is analysed.
    mark_track_mix_source_revision(track_id, REVISION_B)
    stale = get_stem_track(track_uid)
    assert stale is not None and stale.source_revision is None

    assert get_stem_track("00000000-0000-4000-8000-000000000000") is None
