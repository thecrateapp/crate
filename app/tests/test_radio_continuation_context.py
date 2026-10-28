from unittest.mock import MagicMock

from crate.db.queries.radio_continuation import get_buffer_context


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


def test_unknown_legacy_references_do_not_scan_the_catalog():
    session = MagicMock()
    assert get_buffer_context(["not-a-canonical-id", str(2**65)], session=session) == []
    session.execute.assert_not_called()


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
