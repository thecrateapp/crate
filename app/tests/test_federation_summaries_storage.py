"""FED2: storage of owner catalog summaries and receiver peer summaries."""

from __future__ import annotations

import uuid

from sqlalchemy import text

from crate.db.jobs.federation_catalog_summaries import (
    delete_catalog_summaries_except,
    upsert_catalog_summary,
)
from crate.db.queries.federation_catalog_summaries import (
    get_catalog_summary,
    list_catalog_summary_heads,
)
from crate.db.repositories.federation_peer_summaries import (
    delete_peer_summary,
    get_peer_summaries,
    list_peer_summary_etags,
    upsert_peer_summary,
)
from crate.db.tx import read_scope, transaction_scope
from tests.conftest import approve_federation_node


def _summary(digest: str, **overrides) -> dict:
    data = {
        "scope_digest": digest,
        "contract": "bloom-v1",
        "params": {"m": 1024, "k": 7},
        "bloom": b"\x00\x01\xff\x10",
        "artist_album_counts": {"abc": 3},
        "entry_count": 12,
        "source_sequence": 40,
        "etag": f"etag-{digest}",
    }
    data.update(overrides)
    return data


def test_catalog_summary_round_trip_and_upsert(pg_db):
    upsert_catalog_summary(_summary("a"))
    got = get_catalog_summary("a")
    assert got is not None
    assert got["bloom"] == b"\x00\x01\xff\x10" and isinstance(got["bloom"], bytes)
    assert got["params"] == {"m": 1024, "k": 7}
    assert got["artist_album_counts"] == {"abc": 3}
    assert got["entry_count"] == 12 and got["source_sequence"] == 40
    assert got["built_at"] is not None

    upsert_catalog_summary(_summary("a", etag="new", source_sequence=41))
    got = get_catalog_summary("a")
    assert got["etag"] == "new" and got["source_sequence"] == 41
    assert get_catalog_summary("missing") is None

    heads = list_catalog_summary_heads()
    assert heads == [
        {
            "scope_digest": "a",
            "contract": "bloom-v1",
            "source_sequence": 41,
            "etag": "new",
            "tokenizer": None,
            "hash": None,
            "min_prefix": None,
        }
    ]
    upsert_catalog_summary(
        _summary(
            "a",
            params={
                "m": 64,
                "k": 3,
                "tokenizer": "fts-simple-v2",
                "hash": "blake2b-128-km",
                "min_prefix": 3,
            },
            source_sequence=42,
        )
    )
    [head] = list_catalog_summary_heads()
    assert (head["tokenizer"], head["hash"], head["min_prefix"]) == (
        "fts-simple-v2",
        "blake2b-128-km",
        3,
    )


def test_delete_catalog_summaries_except_keeps_listed(pg_db):
    upsert_catalog_summary(_summary("a"))
    upsert_catalog_summary(_summary("b"))
    assert delete_catalog_summaries_except(["a"]) == 1
    assert [h["scope_digest"] for h in list_catalog_summary_heads()] == ["a"]
    assert delete_catalog_summaries_except([]) == 1
    assert list_catalog_summary_heads() == []


def _node() -> str:
    node_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        approve_federation_node(session, node_uid)
    return node_uid


def _peer(node_uid: str, **overrides) -> None:
    kwargs = {
        "contract": "bloom-v1",
        "params": {"m": 64, "k": 3},
        "bloom": b"\x01\x02\x03",
        "artist_album_counts": {"x": 2},
        "source_sequence": 7,
        "etag": "e1",
    }
    kwargs.update(overrides)
    upsert_peer_summary(node_uid, **kwargs)


def test_peer_summary_round_trip_and_cascade(pg_db):
    first, second = _node(), _node()
    _peer(first)
    _peer(second, etag="e2")
    _peer(first, etag="e3", bloom=b"\xff")

    assert list_peer_summary_etags([first, second]) == {first: "e3", second: "e2"}
    assert list_peer_summary_etags([]) == {}
    rows = {r["node_uid"]: r for r in get_peer_summaries([first, second])}
    assert rows[first]["bloom"] == b"\xff" and isinstance(rows[first]["bloom"], bytes)
    assert rows[first]["params"] == {"m": 64, "k": 3}
    assert rows[first]["artist_album_counts"] == {"x": 2}
    assert rows[first]["contract"] == "bloom-v1" and rows[first]["source_sequence"] == 7
    assert rows[first]["etag"] == "e3"
    assert get_peer_summaries([]) == []

    delete_peer_summary(second)
    assert list(list_peer_summary_etags([first, second])) == [first]

    with transaction_scope() as session:
        session.execute(
            text("DELETE FROM federation_nodes WHERE node_uid = CAST(:u AS uuid)"),
            {"u": first},
        )
    assert list_peer_summary_etags([first]) == {}
    with read_scope() as session:
        assert (
            session.execute(
                text("SELECT COUNT(*) FROM federation_peer_summaries")
            ).scalar_one()
            == 0
        )
