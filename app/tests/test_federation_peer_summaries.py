from __future__ import annotations

import base64
import json

import httpx
import pytest

from crate.federation import peer_summaries
from crate.federation.summary_bloom import SUMMARY_CONTRACT, TOKENIZER, BloomFilter

PEER = {
    "node_uid": "11111111-1111-1111-1111-111111111111",
    "api_base_url": "https://peer.invalid",
    "capabilities_json": {"catalog.search": True, "catalog.summary": True},
}
LOCAL = {"node_uid": "local", "active_key_id": "key", "private_key_ref": "ref"}


def _payload(**overrides) -> dict:
    bloom = BloomFilter.sized(10)
    bloom.add("radiohead")
    params = dict(bloom.params)
    params["tokenizer"] = TOKENIZER
    payload = {
        "contract": SUMMARY_CONTRACT,
        "etag": "abc123",
        "source_sequence": 42,
        "built_at": "2026-11-18T10:00:00Z",
        "params": params,
        "bloom": base64.b64encode(bloom.to_bytes()).decode(),
        "artist_album_counts": {"deadbeef": 3},
    }
    payload.update(overrides)
    return payload


class _Stub:
    def __init__(self, monkeypatch, response: httpx.Response | Exception):
        self.calls: list[dict] = []
        self.writes: list[tuple] = []
        self.deleted: list[str] = []
        self.touched: list[str] = []
        self._response = response

        def fake_get(**kwargs):
            self.calls.append(kwargs)
            if isinstance(self._response, Exception):
                raise self._response
            return self._response

        monkeypatch.setattr("crate.federation.client.federated_get", fake_get)
        monkeypatch.setattr(
            peer_summaries.summaries_repo,
            "upsert_peer_summary",
            lambda uid, **kw: self.writes.append((uid, kw)),
        )
        monkeypatch.setattr(
            peer_summaries.summaries_repo,
            "delete_peer_summary",
            lambda uid, **kw: self.deleted.append(uid),
        )
        monkeypatch.setattr(
            peer_summaries.summaries_repo,
            "touch_peer_summary",
            lambda uid, **kw: self.touched.append(uid),
        )


def _json_response(payload, status=200, headers=None):
    return httpx.Response(status, content=json.dumps(payload), headers=headers)


def test_not_modified_touches_the_row(monkeypatch):
    stub = _Stub(monkeypatch, httpx.Response(304))
    result = peer_summaries.refresh_peer_summary(PEER, LOCAL, known_etag="abc123")
    assert result == "unchanged"
    assert stub.writes == []
    assert stub.touched == [PEER["node_uid"]]
    assert stub.deleted == []
    assert stub.calls[0]["path"] == "/api/federation/v1/catalog/summary"
    assert stub.calls[0]["headers"] == {"If-None-Match": '"abc123"'}


def test_no_known_etag_sends_no_conditional_header(monkeypatch):
    stub = _Stub(monkeypatch, httpx.Response(404, json={"code": "summary_pending"}))
    assert (
        peer_summaries.refresh_peer_summary(PEER, LOCAL, known_etag=None)
        == "unavailable"
    )
    assert not stub.calls[0].get("headers")
    assert stub.writes == []


def test_new_etag_is_stored(monkeypatch):
    payload = _payload()
    stub = _Stub(monkeypatch, _json_response(payload))
    result = peer_summaries.refresh_peer_summary(PEER, LOCAL, known_etag="old")
    assert result == "updated"
    uid, kw = stub.writes[0]
    assert uid == PEER["node_uid"]
    assert kw["etag"] == "abc123"
    assert kw["contract"] == SUMMARY_CONTRACT
    assert kw["source_sequence"] == 42
    assert kw["artist_album_counts"] == {"deadbeef": 3}
    assert kw["params"] == payload["params"]
    assert kw["bloom"] == base64.b64decode(payload["bloom"])


def test_unknown_contract_deletes_the_stored_summary(monkeypatch):
    stub = _Stub(monkeypatch, _json_response(_payload(contract="other/9")))
    assert (
        peer_summaries.refresh_peer_summary(PEER, LOCAL, known_etag=None)
        == "unavailable"
    )
    assert stub.writes == []
    assert stub.deleted == [PEER["node_uid"]]


def test_invalid_payload_deletes_the_stored_summary(monkeypatch):
    bad = _payload()
    bad["params"] = {**bad["params"], "tokenizer": "fts-simple-v0"}
    stub = _Stub(monkeypatch, _json_response(bad))
    assert (
        peer_summaries.refresh_peer_summary(PEER, LOCAL, known_etag="old")
        == "unavailable"
    )
    assert stub.writes == []
    assert stub.deleted == [PEER["node_uid"]]


def test_wrong_tokenizer_and_bloom_length_are_rejected():
    bad_tok = _payload()
    bad_tok["params"] = {**bad_tok["params"], "tokenizer": "nope"}
    with pytest.raises(peer_summaries.InvalidSummary):
        peer_summaries.parse_summary_payload(bad_tok)
    bad_len = _payload(bloom=base64.b64encode(b"\x00\x01").decode())
    with pytest.raises(peer_summaries.InvalidSummary):
        peer_summaries.parse_summary_payload(bad_len)
    with pytest.raises(peer_summaries.InvalidSummary):
        peer_summaries.parse_summary_payload({"contract": SUMMARY_CONTRACT})


@pytest.mark.parametrize(
    "status,code",
    [
        (403, "grant_denied"),
        (404, "summary_pending"),
        (404, "summary_unavailable"),
        (404, "x"),
    ],
)
def test_refusals_delete_the_stored_summary(monkeypatch, status, code):
    stub = _Stub(monkeypatch, httpx.Response(status, json={"code": code}))
    assert (
        peer_summaries.refresh_peer_summary(PEER, LOCAL, known_etag="old")
        == "unavailable"
    )
    assert stub.writes == []
    assert stub.deleted == [PEER["node_uid"]]


@pytest.mark.parametrize("status", [500, 502, 503, 429])
def test_transient_errors_keep_the_stored_summary(monkeypatch, status):
    stub = _Stub(monkeypatch, httpx.Response(status, json={"code": "x"}))
    assert (
        peer_summaries.refresh_peer_summary(PEER, LOCAL, known_etag="old")
        == "unavailable"
    )
    assert stub.writes == [] and stub.deleted == [] and stub.touched == []


def test_network_error_is_unavailable(monkeypatch):
    stub = _Stub(monkeypatch, httpx.ConnectError("boom"))
    assert (
        peer_summaries.refresh_peer_summary(PEER, LOCAL, known_etag=None)
        == "unavailable"
    )
    assert stub.writes == [] and stub.deleted == [] and stub.touched == []


@pytest.mark.parametrize(
    "caps,expected",
    [
        ({"catalog.summary": True}, True),
        (["catalog.summary"], True),
        ({"catalog.search": True}, False),
        (["catalog.search"], False),
        ({}, False),
        ([], False),
        (None, False),
    ],
)
def test_peer_advertises_summary(caps, expected):
    assert (
        peer_summaries.peer_advertises_summary({"capabilities_json": caps}) is expected
    )


def test_peer_without_capability_is_never_asked(monkeypatch):
    from crate.worker_handlers import federation as handlers

    asked: list[str] = []
    no_cap = {**PEER, "node_uid": "22222222-2222-2222-2222-222222222222"}
    no_cap["capabilities_json"] = {"catalog.search": True}
    monkeypatch.setattr(handlers.repo, "list_peers", lambda **kw: [PEER, no_cap])
    monkeypatch.setattr(handlers.repo, "get_local_node", lambda: LOCAL)
    monkeypatch.setattr(
        peer_summaries.summaries_repo,
        "list_peer_summary_etags",
        lambda uids: {PEER["node_uid"]: "e1"},
    )

    def fake_refresh(peer, local, *, known_etag):
        asked.append((peer["node_uid"], known_etag))
        return "unchanged"

    monkeypatch.setattr(peer_summaries, "refresh_peer_summary", fake_refresh)
    result = handlers._handle_federation_fetch_peer_summaries("t", {}, {})
    assert asked == [(PEER["node_uid"], "e1")]
    assert result == {"peers": 1, "updated": 0, "unchanged": 1, "unavailable": 0}
    assert "federation_fetch_peer_summaries" in handlers.FEDERATION_TASK_HANDLERS


# --- delta hook -----------------------------------------------------------


def _run_delta(monkeypatch, *, descriptor, stored, refresh, touched=None):
    from crate.worker_handlers import federation as handlers

    page = {
        "items": [],
        "next_cursor": "c2",
        "scanned_sequence": 5,
        "has_more": False,
    }
    if descriptor is not None:
        page["summary"] = descriptor

    class Resp:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return page

    monkeypatch.setattr("crate.federation.client.federated_get", lambda **kw: Resp())
    monkeypatch.setattr(
        "crate.db.jobs.global_catalog_reconciliation.apply_federation_delta_page",
        lambda **kw: {"applied": 0},
    )
    monkeypatch.setattr(
        peer_summaries.summaries_repo,
        "list_peer_summary_etags",
        lambda uids: stored,
    )
    monkeypatch.setattr(peer_summaries, "refresh_peer_summary", refresh)
    monkeypatch.setattr(
        peer_summaries.summaries_repo,
        "touch_peer_summary",
        lambda uid, **kw: (touched if touched is not None else []).append(uid),
    )
    return handlers._sync_peer_catalog_delta(
        peer=PEER, local_node=LOCAL, cursor="c1", page_size=10, sync_generation=1
    )


def test_delta_descriptor_triggers_fetch(monkeypatch):
    seen = []

    def refresh(peer, local, *, known_etag):
        seen.append(known_etag)
        return "updated"

    result = _run_delta(
        monkeypatch,
        descriptor={"contract": SUMMARY_CONTRACT, "etag": "new", "source_sequence": 5},
        stored={PEER["node_uid"]: "old"},
        refresh=refresh,
    )
    assert seen == ["old"]
    assert result["status"] == "completed"


def test_same_descriptor_skips_fetch_and_touches_the_row(monkeypatch):
    def refresh(*a, **k):
        pytest.fail("must not fetch")

    touched: list[str] = []
    _run_delta(
        monkeypatch,
        descriptor={"contract": SUMMARY_CONTRACT, "etag": "same", "source_sequence": 5},
        stored={PEER["node_uid"]: "same"},
        refresh=refresh,
        touched=touched,
    )
    assert touched == [PEER["node_uid"]]


def test_no_descriptor_skips_fetch(monkeypatch):
    def refresh(*a, **k):
        pytest.fail("must not fetch")

    _run_delta(monkeypatch, descriptor=None, stored={}, refresh=refresh)


def test_summary_fetch_failure_keeps_sync_result(monkeypatch):
    def refresh(*a, **k):
        raise RuntimeError("boom")

    result = _run_delta(
        monkeypatch,
        descriptor={"contract": SUMMARY_CONTRACT, "etag": "new", "source_sequence": 5},
        stored={},
        refresh=refresh,
    )
    assert result == {
        "status": "completed",
        "mode": "delta",
        "synced": 0,
        "pages": 1,
        "cursor": "c2",
    }


# --- freshness against PostgreSQL ------------------------------------------


def _stored_peer(pg_db, *, source_sequence: int = 7, etag: str = "e1") -> str:
    import uuid

    from crate.db.tx import transaction_scope
    from tests.conftest import approve_federation_node

    node_uid = str(uuid.uuid4())
    with transaction_scope() as session:
        approve_federation_node(session, node_uid)
    bloom = BloomFilter.sized(4)
    bloom.add("radiohead")
    peer_summaries.summaries_repo.upsert_peer_summary(
        node_uid,
        contract=SUMMARY_CONTRACT,
        params=bloom.params,
        bloom=bloom.to_bytes(),
        artist_album_counts={},
        source_sequence=source_sequence,
        etag=etag,
    )
    return node_uid


def _age_row(node_uid: str, seconds: int) -> None:
    from sqlalchemy import text

    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE federation_peer_summaries "
                "SET fetched_at = NOW() - make_interval(secs => :s) "
                "WHERE node_uid = CAST(:u AS uuid)"
            ),
            {"s": seconds, "u": node_uid},
        )


def test_stale_summary_is_ignored_by_load(pg_db):
    fresh = _stored_peer(pg_db, etag="fresh")
    stale = _stored_peer(pg_db, etag="stale")
    _age_row(stale, peer_summaries.PEER_SUMMARY_MAX_AGE_S + 60)

    loaded = peer_summaries.load_peer_summaries([fresh, stale])

    assert peer_summaries.PEER_SUMMARY_MAX_AGE_S == 1800
    assert set(loaded) == {fresh}


def test_touch_makes_a_stale_summary_fresh_again(pg_db):
    uid = _stored_peer(pg_db, etag="t1")
    _age_row(uid, peer_summaries.PEER_SUMMARY_MAX_AGE_S + 60)
    assert peer_summaries.load_peer_summaries([uid]) == {}

    peer_summaries.summaries_repo.touch_peer_summary(uid)

    assert set(peer_summaries.load_peer_summaries([uid])) == {uid}


def test_older_summary_never_overwrites_a_newer_one(pg_db):
    uid = _stored_peer(pg_db, source_sequence=10, etag="newer")
    repo = peer_summaries.summaries_repo
    bloom = BloomFilter.sized(4)

    repo.upsert_peer_summary(
        uid,
        contract=SUMMARY_CONTRACT,
        params=bloom.params,
        bloom=bloom.to_bytes(),
        artist_album_counts={},
        source_sequence=9,
        etag="older",
    )
    assert repo.list_peer_summary_etags([uid]) == {uid: "newer"}

    repo.upsert_peer_summary(
        uid,
        contract=SUMMARY_CONTRACT,
        params=bloom.params,
        bloom=bloom.to_bytes(),
        artist_album_counts={},
        source_sequence=10,
        etag="same-sequence",
    )
    assert repo.list_peer_summary_etags([uid]) == {uid: "same-sequence"}
