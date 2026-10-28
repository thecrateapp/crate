import hashlib
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import event, text

from crate.db.queries.radio_continuation import get_buffer_context
from crate.db.tx import transaction_scope


def test_context_uses_indexable_arrays_and_buffer_order():
    session = MagicMock()
    uid = "123e4567-e89b-12d3-a456-426614174042"
    rows = [dict(track_id=42, entity_uid=uid), dict(track_id=7, entity_uid=None)]
    session.execute.return_value.mappings.return_value.all.return_value = rows
    result = get_buffer_context(["7", uid], session=session)
    assert [row["track_id"] for row in result] == [7, 42]
    statement, params = session.execute.call_args.args
    assert params == {"ids": [7], "uids": [uid]}
    assert "CAST(id AS" not in str(statement)
    assert "ANY(" in str(statement)


@pytest.mark.parametrize("refs", [[], ["not-a-canonical-id", str(2**65)]])
def test_unknown_legacy_references_do_not_scan_the_catalog(refs):
    session = MagicMock()
    assert get_buffer_context(refs, session=session) == []
    session.execute.assert_not_called()


def test_context_keeps_identity_even_without_audio_analysis():
    session = MagicMock()
    session.execute.return_value.mappings.return_value.all.return_value = [
        {
            "track_id": 7,
            "entity_uid": None,
            "artist": "A",
            "title": "Song",
            "bliss_vector": None,
        }
    ]
    assert get_buffer_context(["7"], session=session)[0]["title"] == "Song"
    statement = str(session.execute.call_args.args[0])
    assert "bliss_vector IS NOT NULL" not in statement


def test_global_alias_survives_deduplication_when_rows_arrive_in_reverse_order():
    session = MagicMock()
    uid, global_uid = str(uuid4()), str(uuid4())
    session.execute.return_value.mappings.return_value.all.return_value = [
        {"track_id": 7, "entity_uid": uid, "global_track_uid": global_uid},
        {"track_id": 7, "entity_uid": uid},
    ]

    rows = get_buffer_context([global_uid, uid], session=session)

    assert len(rows) == 1
    assert rows[0]["global_track_uid"] == global_uid


def test_context_resolves_real_postgres_rows_by_both_ids_in_buffer_order(pg_db):
    from uuid import uuid4
    from sqlalchemy import text
    from crate.db.tx import transaction_scope

    pg_db.upsert_artist({"name": "Continuation Artist"})
    album_id = pg_db.upsert_album(
        {
            "artist": "Continuation Artist",
            "name": "Buffer",
            "path": "/music/continuation-buffer",
        }
    )
    uids = [str(uuid4()), str(uuid4())]
    ids = []
    with transaction_scope() as session:
        for index, uid in enumerate(uids):
            ids.append(
                session.execute(
                    text("""
                INSERT INTO library_tracks (album_id, artist, album, filename, title, path, entity_uid, bliss_vector, bpm)
                VALUES (:album, 'Continuation Artist', 'Buffer', :filename, :title, :path, CAST(:uid AS uuid), CAST(:vector AS double precision[]), :bpm)
                RETURNING id
            """),
                    {
                        "album": album_id,
                        "filename": f"{index}.flac",
                        "title": f"Track {index}",
                        "path": f"/music/continuation-buffer/{index}.flac",
                        "uid": uid,
                        "vector": [0.1, 0.2],
                        "bpm": 100 + index,
                    },
                ).scalar_one()
            )
    rows = get_buffer_context([str(ids[1]), uids[0]])
    assert [row["track_id"] for row in rows] == [ids[1], ids[0]]
    assert [row["bpm"] for row in rows] == [101, 100]
    assert list(rows[0]["bliss_vector"]) == [0.1, 0.2]


def _insert_global_track(session, *, name="Song", local=True, local_mapping="both"):
    global_uid, artist_uid, entity_uid = (str(uuid4()) for _ in range(3))
    track_id = None
    if local:
        track_id = session.execute(
            text(
                """
                INSERT INTO library_tracks
                    (entity_uid, artist, album, filename, title, path, bliss_vector, bpm)
                VALUES
                    (CAST(:uid AS uuid), 'Local Artist', 'Buffer', :filename, :title,
                     :path, CAST(:vector AS double precision[]), 115)
                RETURNING id
                """
            ),
            {
                "uid": entity_uid,
                "filename": f"{entity_uid}.flac",
                "title": f"Local {name}",
                "path": f"/music/continuation-global/{entity_uid}.flac",
                "vector": [0.1, 0.2],
            },
        ).scalar_one()
    session.execute(
        text(
            """
            INSERT INTO global_catalog_artists
                (global_artist_uid, canonical_name, sort_name, normalized_name)
            VALUES (CAST(:uid AS uuid), 'Global Artist', 'Global Artist', 'global artist')
            """
        ),
        {"uid": artist_uid},
    )
    session.execute(
        text(
            """
            INSERT INTO global_catalog_tracks
                (global_track_uid, global_artist_uid, canonical_title,
                 normalized_title, artist_name, local_track_id, local_track_entity_uid)
            VALUES
                (CAST(:uid AS uuid), CAST(:artist_uid AS uuid), :title, LOWER(:title),
                 'Global Artist', :track_id, CAST(:entity_uid AS uuid))
            """
        ),
        {
            "uid": global_uid,
            "artist_uid": artist_uid,
            "title": f"Global {name}",
            "track_id": track_id if local_mapping in ("both", "id") else None,
            "entity_uid": entity_uid
            if local and local_mapping in ("both", "entity")
            else None,
        },
    )
    return {
        "track_id": track_id,
        "entity_uid": entity_uid,
        "global_track_uid": global_uid,
    }


@pytest.mark.parametrize("local_mapping", ["id", "entity"])
def test_global_buffer_alias_resolves_local_identity_and_audio_vector(
    pg_db, local_mapping
):
    with transaction_scope() as session:
        song = _insert_global_track(session, local_mapping=local_mapping)

    rows = get_buffer_context([song["global_track_uid"]])

    assert len(rows) == 1
    assert rows[0]["track_id"] == song["track_id"]
    assert str(rows[0]["entity_uid"]) == song["entity_uid"]
    assert str(rows[0]["global_track_uid"]) == song["global_track_uid"]
    assert rows[0]["artist"] == "Local Artist"
    assert rows[0]["title"] == "Local Song"
    assert list(rows[0]["bliss_vector"]) == [0.1, 0.2]


def test_remote_global_buffer_track_keeps_identity_without_a_vector(pg_db):
    with transaction_scope() as session:
        song = _insert_global_track(session, local=False)

    rows = get_buffer_context([song["global_track_uid"]])

    assert len(rows) == 1
    assert rows[0]["track_id"] is None
    assert rows[0]["entity_uid"] is None
    assert rows[0]["bliss_vector"] is None
    assert str(rows[0]["global_track_uid"]) == song["global_track_uid"]
    assert rows[0]["artist"] == "Global Artist"
    assert rows[0]["title"] == "Global Song"


def test_mixed_buffer_aliases_deduplicate_at_their_last_position(pg_db):
    with transaction_scope() as session:
        first = _insert_global_track(session, name="First")
        second = _insert_global_track(session, name="Second")
        remote = _insert_global_track(session, name="Remote", local=False)
    refs = [
        str(first["track_id"]),
        second["entity_uid"],
        first["global_track_uid"],
        remote["global_track_uid"],
        second["global_track_uid"],
        first["entity_uid"],
    ]

    rows = get_buffer_context(refs)

    assert [row["title"] for row in rows] == [
        "Global Remote",
        "Local Second",
        "Local First",
    ]
    assert [str(row["global_track_uid"]) for row in rows] == [
        remote["global_track_uid"],
        second["global_track_uid"],
        first["global_track_uid"],
    ]


@pytest.mark.parametrize("include_global", [False, True])
def test_global_buffer_lookup_reuses_the_callers_transaction_with_one_query(
    pg_db, include_global
):
    with transaction_scope() as session:
        song = _insert_global_track(session)
        statements = []

        def capture_statement(_conn, _cursor, statement, _parameters, _context, _many):
            statements.append(statement)

        bind = session.get_bind()
        event.listen(bind, "before_cursor_execute", capture_statement)
        try:
            refs = [song["global_track_uid"]]
            if not include_global:
                refs.insert(0, str(song["track_id"]))
            rows = get_buffer_context(
                refs, include_global=include_global, session=session
            )
        finally:
            event.remove(bind, "before_cursor_execute", capture_statement)

        assert rows[0]["track_id"] == song["track_id"]
        assert len(statements) == 1
        assert session.in_transaction()


def test_unknown_canonical_global_uid_returns_no_context(pg_db):
    assert get_buffer_context([str(uuid4())]) == []


def test_legacy_context_keeps_original_sql_and_local_array_parameters():
    session = MagicMock()
    uid, global_uid = str(uuid4()), str(uuid4())
    session.execute.return_value.mappings.return_value.all.return_value = [
        {"track_id": 2, "entity_uid": uid},
        {"track_id": 1, "entity_uid": None},
    ]

    rows = get_buffer_context(
        ["1", "2", uid, global_uid], include_global=False, session=session
    )

    assert [row["track_id"] for row in rows] == [1, 2]
    statement, params = session.execute.call_args.args
    assert params == {"ids": [1, 2], "uids": [uid, global_uid]}
    assert hashlib.sha256(str(statement).encode()).hexdigest() == (
        "4d34fce46e3eb3c9f18b1450ccf38e5112365361f768eb50f743288f8bfc22ca"
    )
    session.execute.assert_called_once()


def test_legacy_context_ignores_global_alias_when_choosing_the_buffer_tail(pg_db):
    with transaction_scope() as session:
        first = _insert_global_track(session, name="Legacy First")
        second = _insert_global_track(session, name="Legacy Second")
    refs = [str(first["track_id"]), str(second["track_id"]), first["global_track_uid"]]

    legacy = get_buffer_context(refs, include_global=False)
    current = get_buffer_context(refs, include_global=True)

    assert [row["track_id"] for row in legacy] == [
        first["track_id"],
        second["track_id"],
    ]
    assert [row["track_id"] for row in current] == [
        second["track_id"],
        first["track_id"],
    ]
    assert all("global_track_uid" not in row for row in legacy)


def test_legacy_context_filters_missing_vectors_in_postgres(pg_db):
    with transaction_scope() as session:
        analyzed = _insert_global_track(session, name="Analyzed")
        missing = _insert_global_track(session, name="Missing")
        session.execute(
            text("UPDATE library_tracks SET bliss_vector = NULL WHERE id = :id"),
            {"id": missing["track_id"]},
        )
    refs = [analyzed["entity_uid"], str(missing["track_id"])]

    legacy = get_buffer_context(refs, include_global=False)
    current = get_buffer_context(refs, include_global=True)

    assert [row["track_id"] for row in legacy] == [analyzed["track_id"]]
    assert [row["track_id"] for row in current] == [
        analyzed["track_id"],
        missing["track_id"],
    ]
    assert current[-1]["bliss_vector"] is None
    assert current[-1]["title"] == "Local Missing"


def test_context_catalog_lookups_avoid_sequential_scans_in_both_modes(pg_db):
    with transaction_scope() as session:
        song = _insert_global_track(session)
        session.execute(
            text(
                """
                INSERT INTO library_tracks
                    (entity_uid, artist, album, filename, title, path, bliss_vector)
                SELECT md5('buffer-plan-local-' || n)::uuid, 'Plan Artist', 'Buffer Plan',
                       n || '.flac', 'Plan ' || n, '/music/buffer-plan/' || n || '.flac',
                       ARRAY[0.1, 0.2]::double precision[]
                FROM generate_series(1, 48000) n
                """
            )
        )
        session.execute(
            text(
                """
                INSERT INTO global_catalog_tracks
                    (global_track_uid, global_artist_uid, canonical_title,
                     normalized_title, artist_name, local_track_id, local_track_entity_uid)
                SELECT md5('buffer-plan-global-' || lt.id)::uuid, gct.global_artist_uid,
                       lt.title, LOWER(lt.title), lt.artist, lt.id, lt.entity_uid
                FROM library_tracks lt
                JOIN global_catalog_tracks gct
                  ON gct.global_track_uid = CAST(:global_uid AS uuid)
                WHERE lt.path LIKE '/music/buffer-plan/%'
                """
            ),
            {"global_uid": song["global_track_uid"]},
        )
        session.execute(text("ANALYZE library_tracks"))
        session.execute(text("ANALYZE global_catalog_tracks"))
        refs = [str(song["track_id"]), song["entity_uid"], song["global_track_uid"]]
        bind = session.get_bind()
        captured = []

        def capture_statement(_conn, statement, _many, params, _options):
            captured.append((statement, params))

        for include_global in (False, True):
            captured.clear()
            event.listen(bind, "before_execute", capture_statement)
            try:
                rows = get_buffer_context(
                    refs, include_global=include_global, session=session
                )
            finally:
                event.remove(bind, "before_execute", capture_statement)
            assert len(rows) == len(captured) == 1
            statement, params = captured[0]
            assert set(params) == {"ids", "uids"}
            plan = session.execute(
                text("EXPLAIN (ANALYZE, FORMAT JSON) " + str(statement)), params
            ).scalar_one()[0]["Plan"]
            pending = [plan]
            while pending:
                node = pending.pop()
                assert node["Node Type"] != "Seq Scan", node
                pending.extend(node.get("Plans", []))
