"""FED2: owner-side GET /catalog/summary and the delta `summary` descriptor."""

from __future__ import annotations

import asyncio
import base64
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from crate.api import federation
from crate.db.queries.federation_catalog_summaries import (
    get_catalog_summary,
    list_catalog_summary_heads,
)
from crate.federation import summary_builder
from crate.federation.catalog_scope import catalog_scope_digest
from crate.federation.summary_bloom import BloomFilter, query_probe_terms

OPEN: dict = {}


def _seed(pg_db, artist: str, album: str) -> str:
    pg_db.upsert_artist({"name": artist})
    uid = str(uuid4())
    album_id = pg_db.upsert_album(
        {
            "artist": artist,
            "name": album,
            "path": f"/music/{artist}/{album}",
            "track_count": 1,
            "entity_uid": uid,
        }
    )
    pg_db.upsert_track(
        {
            "album_id": album_id,
            "artist": artist,
            "album": album,
            "filename": "t.flac",
            "title": f"Song of {album}",
            "path": f"/music/{artist}/{album}/t.flac",
            "duration": 100.0,
            "format": "flac",
        }
    )
    return uid


class _World:
    def __init__(self, monkeypatch):
        self.policies: dict[str, dict | None] = {}
        monkeypatch.setattr(
            summary_builder.repo,
            "list_peers",
            lambda trust_state=None: [
                {"node_uid": uid, "disabled_at": None} for uid in self.policies
            ],
        )
        monkeypatch.setattr(
            summary_builder,
            "peer_search_policy",
            lambda peer: self.policies[peer["node_uid"]],
        )
        monkeypatch.setattr(summary_builder, "catalog_high_water_mark", lambda: 10)
        monkeypatch.setattr(
            federation,
            "peer_search_policy",
            lambda peer: self.policies[peer["node_uid"]],
        )

    def as_peer(self, monkeypatch, uid: str) -> None:
        async def peer(_request):
            return {"node_uid": uid}

        monkeypatch.setattr(federation, "_require_signed_node_request", peer)


@pytest.fixture
def world(monkeypatch):
    return _World(monkeypatch)


def _request(**headers: str):
    return SimpleNamespace(headers=headers)


def _get(**headers: str):
    return asyncio.run(federation.catalog_summary(_request(**headers)))


def test_summary_scope_isolation(pg_db, world, monkeypatch):
    from sqlalchemy import text

    from crate.db.tx import read_scope

    album_uid = _seed(pg_db, "Isolation Band", "zyxqvalbum")
    with read_scope() as session:
        track_uids = [
            str(u)
            for u in session.execute(
                text("SELECT entity_uid FROM library_tracks WHERE album = 'zyxqvalbum'")
            ).scalars()
        ]
    denied = {"catalog_filter": {"deny_entity_uids": [album_uid, *track_uids]}}
    world.policies["open"] = OPEN
    world.policies["narrow"] = denied
    summary_builder.refresh_catalog_summaries()

    bodies = {}
    for uid in ("open", "narrow"):
        world.as_peer(monkeypatch, uid)
        response = _get()
        assert response.status_code == 200
        assert response.headers["etag"].startswith('"')
        bodies[uid] = json.loads(response.body)

    assert bodies["open"]["etag"] != bodies["narrow"]["etag"]
    assert bodies["open"]["contract"] == "crate.federation.summary/1"

    def decode(body):
        return BloomFilter.from_bytes(
            base64.b64decode(body["bloom"]),
            m=body["params"]["m"],
            k=body["params"]["k"],
        )

    probes = query_probe_terms("zyxqvalbum")
    assert probes and all(p in decode(bodies["open"]) for p in probes)
    assert not all(p in decode(bodies["narrow"]) for p in probes)
    assert isinstance(bodies["open"]["artist_album_counts"], dict)
    assert bodies["open"]["built_at"]


def test_summary_not_modified(pg_db, world, monkeypatch):
    _seed(pg_db, "Cached Band", "Cached Album")
    world.policies["p1"] = OPEN
    summary_builder.refresh_catalog_summaries()
    world.as_peer(monkeypatch, "p1")
    etag = json.loads(_get().body)["etag"]

    for header in (etag, f'"{etag}"'):
        response = _get(**{"if-none-match": header})
        assert response.status_code == 304
        assert response.body == b""
        assert response.headers["etag"] == f'"{etag}"'


def test_summary_requires_search_grant(pg_db, world, monkeypatch):
    world.policies["p1"] = None
    world.as_peer(monkeypatch, "p1")

    with pytest.raises(HTTPException) as exc:
        _get()

    assert exc.value.status_code == 403


def test_summary_pending_enqueues_build(pg_db, world, monkeypatch):
    from crate.db.queries.tasks import list_tasks

    world.policies["p1"] = OPEN
    world.as_peer(monkeypatch, "p1")

    response = _get()
    again = _get()

    assert response.status_code == 404 and again.status_code == 404
    assert json.loads(response.body)["code"] == "summary_pending"
    tasks = [
        t
        for t in list_tasks(task_type="federation_build_catalog_summaries")
        if t.get("status") in {"pending", "queued", "running"}
    ]
    assert len(tasks) == 1


def _delta(monkeypatch, uid: str):
    async def peer(_request):
        return {"node_uid": uid}

    monkeypatch.setenv(
        "CRATE_FEDERATION_CURSOR_SECRET", "test-secret-at-least-32-bytes-long"
    )
    monkeypatch.setattr(federation, "_require_signed_node_request", peer)
    monkeypatch.setattr(federation, "_require_capability", lambda *_a: None)
    monkeypatch.setattr(federation, "_peer_has_capability", lambda *_a: False)
    monkeypatch.setattr(federation, "catalog_share_policy", dict)
    monkeypatch.setattr(federation, "catalog_policy_for_grant", lambda p, *_a, **_k: p)
    monkeypatch.setattr(federation, "catalog_retention_floor", lambda: 0)
    monkeypatch.setattr(federation, "list_catalog_changes", lambda **_k: [])
    monkeypatch.setattr(federation, "catalog_high_water_mark", lambda: 10)
    return asyncio.run(federation.catalog_delta(object()))


def test_delta_page_carries_summary_descriptor(pg_db, world, monkeypatch):
    _seed(pg_db, "Delta Band", "Delta Album")
    world.policies["p1"] = OPEN
    world.policies["p2"] = None
    summary_builder.refresh_catalog_summaries()
    [head] = list_catalog_summary_heads()

    page = _delta(monkeypatch, "p1")
    assert page["summary"] == {
        "contract": head["contract"],
        "etag": head["etag"],
        "source_sequence": head["source_sequence"],
    }
    assert get_catalog_summary(catalog_scope_digest(OPEN))["etag"] == head["etag"]

    assert "summary" not in _delta(monkeypatch, "p2")


def test_delta_page_has_no_summary_before_first_build(pg_db, world, monkeypatch):
    world.policies["p1"] = OPEN

    assert "summary" not in _delta(monkeypatch, "p1")
