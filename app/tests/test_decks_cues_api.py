"""S7 (F8.S-PR2): Decks cue and correction sync routes."""

from __future__ import annotations

import uuid
from datetime import datetime
from unittest.mock import patch

import pytest

from crate.db.repositories.auth_user_accounts import create_user
from tests.conftest import PG_AVAILABLE
from tests.test_decks_profiles_api import _access_token_user, _record_statements
from tests.test_smart_mix_repository import _create_track

pg = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")

CUES_QUERY = "/api/decks/cues/query"
CORRECTIONS_QUERY = "/api/decks/corrections/query"


def _cues_path(uid: str) -> str:
    return f"/api/decks/cues/{uid}"


def _corrections_path(uid: str) -> str:
    return f"/api/decks/corrections/{uid}"


def _cue(cue_type="hotcue", slot=0, start_ms=1000.0, end_ms=None, **extra) -> dict:
    return {
        "cue_type": cue_type,
        "slot": slot,
        "start_ms": start_ms,
        "end_ms": end_ms,
        "label": extra.get("label"),
        "color": extra.get("color"),
    }


def _put_cues(test_app, uid: str, cues: list[dict], base: int, **extra):
    return test_app.put(
        _cues_path(uid), json={"base_revision": base, "cues": cues, **extra}
    )


def _put_correction(test_app, uid: str, base: int, **values):
    return test_app.put(_corrections_path(uid), json={"base_revision": base, **values})


def _without_server_time(body: dict) -> dict:
    assert "server_time" in body
    return {key: value for key, value in body.items() if key != "server_time"}


@pg
def test_batch_query(pg_db, test_app):
    del pg_db
    first, second, untouched = (
        _create_track(f"decks-cues-api-{name}")[1] for name in ("a", "b", "c")
    )
    stored = _put_cues(
        test_app,
        first,
        [
            _cue("loop", 2, 1000.25, 4750.5, label="Build", color="#00AAFF"),
            _cue("main", 0, 120.0),
            _cue("intro", 0, None, 30000.0),
        ],
        0,
        client_id="install-1",
    )
    assert stored.status_code == 200, stored.text
    assert _put_cues(test_app, second, [_cue(slot=7)], 0).status_code == 200
    unknown = str(uuid.uuid4())

    response = test_app.post(
        CUES_QUERY,
        json={"entity_uids": [unknown, second, first.upper(), first, untouched]},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert list(body["cue_sets"]) == [second, first]
    assert body["missing"] == [unknown, untouched]
    first_set = body["cue_sets"][first]
    assert first_set["entity_uid"] == first
    assert first_set["revision"] == 1
    assert first_set["client_id"] == "install-1"
    assert first_set["updated_at"]
    # Canonical order (main, intro, outro, then slotted types by slot); colours
    # lowercase.
    assert first_set["cues"] == [
        _cue("main", 0, 120.0),
        _cue("intro", 0, None, 30000.0),
        _cue("loop", 2, 1000.25, 4750.5, label="Build", color="#00aaff"),
    ]
    assert _without_server_time(stored.json()) == first_set


@pg
def test_put_with_stale_revision_returns_409(pg_db, test_app):
    del pg_db
    _track_id, uid = _create_track("decks-cues-api-conflict")
    assert _put_cues(test_app, uid, [_cue(slot=1)], 0).status_code == 200
    second = _put_cues(test_app, uid, [_cue(slot=1, start_ms=2000.0)], 1)
    assert second.status_code == 200 and second.json()["revision"] == 2

    stale = _put_cues(test_app, uid, [_cue(slot=3)], 1, client_id="other")

    assert stale.status_code == 409
    body = stale.json()
    assert body["detail"]
    assert body["current"]["revision"] == 2
    assert body["current"]["cues"] == [_cue(slot=1, start_ms=2000.0)]
    # A retried PUT with the content already stored succeeds.
    retried = _put_cues(test_app, uid, [_cue(slot=1, start_ms=2000.0)], 1)
    assert retried.status_code == 200 and retried.json()["revision"] == 2

    assert _put_correction(test_app, uid, 0, bpm=124.0).status_code == 200
    correction_conflict = _put_correction(test_app, uid, 0, bpm=125.0)
    assert correction_conflict.status_code == 409
    assert correction_conflict.json()["current"]["bpm"] == 124.0
    assert correction_conflict.json()["current"]["revision"] == 1


@pg
def test_corrections_round_trip(pg_db, test_app):
    del pg_db
    _track_id, uid = _create_track("decks-corrections-api")
    grid = [512, 981, 1450, 1919]

    stored = _put_correction(
        test_app,
        uid,
        0,
        bpm=127.95,
        beat_grid_format="delta-ms-v1",
        beat_grid_ms=grid,
        key="8a",
        client_id="install-1",
    )

    assert stored.status_code == 200, stored.text
    expected = {
        "entity_uid": uid,
        "revision": 1,
        "updated_at": stored.json()["updated_at"],
        "client_id": "install-1",
        "bpm": 127.95,
        "beat_grid_format": "delta-ms-v1",
        "beat_grid_ms": grid,
        "key": "8A",
    }
    assert _without_server_time(stored.json()) == expected
    query = test_app.post(CORRECTIONS_QUERY, json={"entity_uids": [uid]})
    assert _without_server_time(query.json()) == {
        "corrections": {uid: expected},
        "missing": [],
    }

    cleared = _put_correction(test_app, uid, 1)
    assert cleared.status_code == 200
    assert cleared.json()["revision"] == 2
    assert cleared.json()["bpm"] is None and cleared.json()["beat_grid_ms"] is None


@pg
def test_put_for_a_track_outside_the_library_is_404(pg_db, test_app):
    del pg_db
    unknown = str(uuid.uuid4())
    assert _put_cues(test_app, unknown, [_cue()], 0).status_code == 404
    assert _put_correction(test_app, unknown, 0, bpm=120.0).status_code == 404


@pg
def test_user_isolation(pg_db, test_app):
    del pg_db
    _track_id, uid = _create_track("decks-cues-api-isolation")
    assert _put_cues(test_app, uid, [_cue(slot=0)], 0).status_code == 200
    other = int(create_user("decks-cues-api-other@test.com")["id"])

    async def _other_user(_middleware, _request):
        return {"id": other, "email": "other@test.com", "role": "user"}

    with patch("crate.api.auth.AuthMiddleware.resolve_user", _other_user):
        body = test_app.post(CUES_QUERY, json={"entity_uids": [uid]}).json()
        assert _without_server_time(body) == {"cue_sets": {}, "missing": [uid]}
        mine = _put_cues(test_app, uid, [_cue(slot=9)], 0)
        assert mine.status_code == 200 and mine.json()["revision"] == 1

    own = test_app.post(CUES_QUERY, json={"entity_uids": [uid]}).json()
    assert own["cue_sets"][uid]["cues"] == [_cue(slot=0)]


@pg
def test_single_query_per_batch(pg_db, test_app):
    del pg_db
    from crate.db.queries.decks_cues import get_decks_corrections, get_decks_cue_sets

    uids = [_create_track(f"decks-cues-api-query-{index}")[1] for index in range(3)]
    for uid in uids[:2]:
        _put_cues(test_app, uid, [_cue(slot=0), _cue(slot=1, start_ms=2000.0)], 0)
        _put_correction(
            test_app,
            uid,
            0,
            bpm=120.0,
            beat_grid_ms=[500, 1000],
            beat_grid_format="delta-ms-v1",
        )
    batch = [*uids, str(uuid.uuid4())]

    for read in (get_decks_cue_sets, get_decks_corrections):
        statements, stop = _record_statements()
        try:
            result = read(1, batch)
        finally:
            stop()
        assert len(statements) == 1, statements
        assert "ANY" in statements[0]
        assert list(result.found) == uids[:2]

    for path in (CUES_QUERY, CORRECTIONS_QUERY):
        statements, stop = _record_statements()
        try:
            response = test_app.post(path, json={"entity_uids": batch})
        finally:
            stop()
        assert response.status_code == 200
        assert len(statements) == 1, (path, statements)


def _instant(value: str) -> datetime:
    # ISO 8601 in UTC, the way updated_at is serialised.
    assert value.endswith("Z"), value
    return datetime.fromisoformat(value)


@pg
def test_server_time_in_every_response(pg_db, test_app):
    del pg_db
    _track_id, uid = _create_track("decks-cues-api-server-time")
    unknown = str(uuid.uuid4())

    put = _put_cues(test_app, uid, [_cue()], 0)
    unchanged = _put_cues(test_app, uid, [_cue()], 0)
    conflict = _put_cues(test_app, uid, [_cue(slot=2)], 0)
    correction = _put_correction(test_app, uid, 0, bpm=120.0)
    correction_conflict = _put_correction(test_app, uid, 0, bpm=121.0)
    cues_query = test_app.post(CUES_QUERY, json={"entity_uids": [uid, unknown]})
    corrections_query = test_app.post(CORRECTIONS_QUERY, json={"entity_uids": [uid]})
    nothing = test_app.post(CUES_QUERY, json={"entity_uids": [unknown]})

    # PUT 200: next to the stored set's fields.
    for response in (put, unchanged, correction):
        assert response.status_code == 200, response.text
        body = response.json()
        assert _instant(body["server_time"]) >= _instant(body["updated_at"])
    # 409: next to detail and current.
    for response in (conflict, correction_conflict):
        assert response.status_code == 409, response.text
        body = response.json()
        assert set(body) == {"detail", "current", "server_time"}
        assert _instant(body["server_time"]) >= _instant(body["current"]["updated_at"])
        assert "server_time" not in body["current"]
    # Queries: top level, next to the found and missing entries.
    for response, key in ((cues_query, "cue_sets"), (corrections_query, "corrections")):
        body = response.json()
        assert set(body) == {key, "missing", "server_time"}
        assert "server_time" not in body[key][uid]
        assert _instant(body["server_time"]) >= _instant(body[key][uid]["updated_at"])
    later = nothing.json()
    assert later["cue_sets"] == {} and later["missing"] == [unknown]
    assert _instant(later["server_time"]) >= _instant(cues_query.json()["server_time"])


def test_batch_over_200_rejected(test_app):
    uids = [str(uuid.uuid4()) for _ in range(201)]
    for path in (CUES_QUERY, CORRECTIONS_QUERY):
        assert test_app.post(path, json={"entity_uids": uids}).status_code == 422
        for body in (
            {"entity_uids": []},
            {"entity_uids": ["not-a-uuid"]},
            {},
            {"entity_uids": uids[:1], "limit": 1},
        ):
            assert test_app.post(path, json=body).status_code == 422, (path, body)


_UID = "0b6f2c1e-5d6a-4c1b-9a51-2f0c8a3c9e10"


@pytest.mark.parametrize(
    "cues",
    [
        pytest.param([_cue("cue")], id="unknown-type"),
        pytest.param([_cue(slot=36)], id="slot-over-35"),
        pytest.param([_cue(slot=-1)], id="negative-slot"),
        pytest.param([_cue("main", 1)], id="main-not-slot-0"),
        pytest.param([_cue("intro", 2, 0.0, 10.0)], id="intro-not-slot-0"),
        pytest.param([_cue(start_ms=-1.0)], id="negative-start"),
        pytest.param([_cue(start_ms=86_400_001.0)], id="start-over-24h"),
        pytest.param([_cue(start_ms=None)], id="hotcue-without-start"),
        pytest.param([_cue(end_ms=2000.0)], id="hotcue-with-end"),
        pytest.param([_cue("main", 0, 10.0, 20.0)], id="main-with-end"),
        pytest.param([_cue("loop", 0, 1000.0)], id="loop-without-end"),
        pytest.param([_cue("loop", 0, 1000.0, 1000.0)], id="empty-loop"),
        pytest.param([_cue("loop", 0, 2000.0, 1000.0)], id="reversed-loop"),
        pytest.param([_cue("jump", 0, 1000.0)], id="jump-without-end"),
        pytest.param([_cue("jump", 0, 1000.0, 1000.0)], id="jump-to-itself"),
        pytest.param([_cue("outro", 0, None, None)], id="outro-without-bounds"),
        pytest.param([_cue("outro", 0, 5000.0, 4000.0)], id="reversed-outro"),
        pytest.param([_cue(color="red")], id="named-colour"),
        pytest.param([_cue(color="#ff880")], id="short-colour"),
        pytest.param([_cue(color="#ff8800aa")], id="alpha-colour"),
        pytest.param([_cue(label="x" * 201)], id="long-label"),
        pytest.param([_cue(slot=4), _cue(slot=4, start_ms=5.0)], id="duplicate-slot"),
        pytest.param(
            [_cue(slot=4), _cue("loop", 4, 10.0, 20.0)], id="hotcue-and-loop-share"
        ),
        pytest.param([_cue("main", 0, 1.0), _cue("main", 0, 2.0)], id="two-main-cues"),
        pytest.param([{**_cue(), "extra": 1}], id="extra-field"),
    ],
)
def test_invalid_cue_sets_rejected(test_app, cues):
    response = test_app.put(_cues_path(_UID), json={"base_revision": 0, "cues": cues})
    assert response.status_code == 422, response.text


def test_invalid_cue_put_bodies_rejected(test_app):
    full = [_cue(slot=index) for index in range(36)] + [
        _cue("main", 0, 1.0),
        _cue("intro", 0, 1.0),
        _cue("outro", 0, 1.0),
        _cue("loop", 0, 1.0, 2.0),
    ]
    for body in (
        {"cues": []},
        {"base_revision": -1, "cues": []},
        {"base_revision": 0},
        {"base_revision": 0, "cues": full},
        {"base_revision": 0, "cues": [], "client_id": ""},
        {"base_revision": 0, "cues": [], "client_id": "x" * 129},
    ):
        assert test_app.put(_cues_path(_UID), json=body).status_code == 422, body
    assert (
        test_app.put(
            "/api/decks/cues/not-a-uuid", json={"base_revision": 0, "cues": []}
        ).status_code
        == 422
    )


@pytest.mark.parametrize(
    "values",
    [
        pytest.param({"bpm": 29.9}, id="bpm-too-low"),
        pytest.param({"bpm": 300.1}, id="bpm-too-high"),
        pytest.param({"key": "13A"}, id="key-13"),
        pytest.param({"key": "0B"}, id="key-0"),
        pytest.param({"key": "C#m"}, id="musical-key"),
        pytest.param({"beat_grid_ms": [500, 1000]}, id="grid-without-format"),
        pytest.param({"beat_grid_format": "delta-ms-v1"}, id="format-without-grid"),
        pytest.param(
            {"beat_grid_format": "delta-ms-v2", "beat_grid_ms": [500, 1000]},
            id="unknown-format",
        ),
        pytest.param(
            {"beat_grid_format": "delta-ms-v1", "beat_grid_ms": [500]},
            id="single-beat",
        ),
        pytest.param(
            {"beat_grid_format": "delta-ms-v1", "beat_grid_ms": [500, 500, 900]},
            id="repeated-beat",
        ),
        pytest.param(
            {"beat_grid_format": "delta-ms-v1", "beat_grid_ms": [900, 500]},
            id="decreasing-grid",
        ),
        pytest.param(
            {"beat_grid_format": "delta-ms-v1", "beat_grid_ms": [0, 500]},
            id="beat-at-zero",
        ),
        pytest.param(
            {"beat_grid_format": "delta-ms-v1", "beat_grid_ms": [500, 86_400_001]},
            id="beat-over-24h",
        ),
        pytest.param({"base_revision": -1}, id="negative-base"),
        pytest.param({"tempo": 120}, id="extra-field"),
    ],
)
def test_invalid_corrections_rejected(test_app, values):
    body = {"base_revision": 0, **values}
    response = test_app.put(_corrections_path(_UID), json=body)
    assert response.status_code == 422, response.text


def test_access_token_rejected(test_app):
    calls = [
        ("post", CUES_QUERY, {"entity_uids": [_UID]}),
        ("put", _cues_path(_UID), {"base_revision": 0, "cues": []}),
        ("post", CORRECTIONS_QUERY, {"entity_uids": [_UID]}),
        ("put", _corrections_path(_UID), {"base_revision": 0}),
    ]
    with patch("crate.api.auth.AuthMiddleware.resolve_user", _access_token_user):
        for method, path, body in calls:
            # The middleware never lets a crv_ token reach Decks routes...
            assert getattr(test_app, method)(path, json=body).status_code == 401
        # ...and the handlers refuse one even if a future allow-list did.
        with patch("crate.api.auth._is_access_token_request", return_value=True):
            for method, path, body in calls:
                response = getattr(test_app, method)(path, json=body)
                assert response.status_code == 403, (path, response.text)


def test_no_session_or_account_rejected(test_app):
    async def _anonymous(_middleware, _request):
        return None

    async def _remote_user(_middleware, _request):
        return {"id": None, "email": "proxy@example.test", "role": "user"}

    body = {"entity_uids": [_UID]}
    with patch("crate.api.auth.AuthMiddleware.resolve_user", _anonymous):
        assert test_app.post(CUES_QUERY, json=body).status_code == 401
    with patch("crate.api.auth.AuthMiddleware.resolve_user", _remote_user):
        assert test_app.post(CUES_QUERY, json=body).status_code == 403
        assert (
            test_app.put(
                _cues_path(_UID), json={"base_revision": 0, "cues": []}
            ).status_code
            == 403
        )


def test_capability_advertised(test_app):
    features = test_app.get("/api/capabilities").json()["decks"]["features"]
    assert "cues" in features
