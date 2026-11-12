"""S4: batch mix profiles for Crate Decks (`POST /api/decks/mix-profiles`)."""

from __future__ import annotations

import uuid
from dataclasses import replace
from unittest.mock import patch

import pytest
from sqlalchemy import event

from crate.db.repositories.smart_mix import (
    mark_track_mix_source_revision,
    upsert_track_mix_profile,
)
from crate.db.repositories.smart_mix_stems import upsert_stem_analysis
from crate.smart_mix.stems import StemAnalysis
from tests.conftest import PG_AVAILABLE
from tests.test_decks_stem_analysis_api import (
    DURATION_MS,
    GRID,
    OTHER_REVISION,
    REVISION,
    _payload,
    _track,
)
from tests.test_smart_mix_repository import _create_track, _profile

pytestmark = pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")

PATH = "/api/decks/mix-profiles"


def _single(test_app, uid: str) -> dict:
    response = test_app.get(
        f"/api/tracks/by-entity/{uid}/mix-profile", params={"detail": "full"}
    )
    assert response.status_code == 200, response.text
    return response.json()


def _batch(test_app, uids: list[str]) -> dict:
    response = test_app.post(PATH, json={"entity_uids": uids, "detail": "full"})
    assert response.status_code == 200, response.text
    return response.json()


def _with_stems(name: str, *, producers: tuple[str, ...] = ("decks",)) -> str:
    """A track with phrases, a grid and stem analyses of its current file.

    The server's analysis stores over Decks' of the same separator, not the reverse.
    """
    track_id, uid = _track(name)
    for kind in producers:
        analysis = StemAnalysis.model_validate(_payload(producer=f"crate-{kind}/0.4.0"))
        assert upsert_stem_analysis(track_id, analysis, producer_kind=kind) == "stored"
    return uid


def _record_statements():
    from crate.db.engine import get_engine

    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", record)
    return statements, lambda: event.remove(engine, "before_cursor_execute", record)


def test_batch_matches_single_endpoint(pg_db, test_app) -> None:
    del pg_db
    stems = _with_stems("decks-batch-stems", producers=("decks", "server"))
    _plain_id, plain = _track("decks-batch-plain")
    # Stems of an older file of the track: the single endpoint ignores them.
    old_file_id, old_file = _track("decks-batch-old-file")
    upsert_stem_analysis(
        old_file_id,
        StemAnalysis.model_validate(_payload(sourceRevision=OTHER_REVISION)),
        producer_kind="decks",
    )
    legacy_id, legacy = _create_track("decks-batch-legacy")
    upsert_track_mix_profile(legacy_id, _profile(legacy))

    uids = [stems, plain, old_file, legacy]
    batch = _batch(test_app, uids)

    assert batch["missing"] == []
    assert list(batch["profiles"]) == uids
    for uid in uids:
        single = _single(test_app, uid)
        profile = batch["profiles"][uid]
        assert set(profile) == set(single), uid
        for field, value in single.items():
            assert profile[field] == value, (uid, field)
    assert "stems" in batch["profiles"][stems]
    assert batch["profiles"][stems]["beatGridMs"] == list(GRID)
    for uid in (plain, old_file, legacy):
        assert "stems" not in batch["profiles"][uid]


def test_batch_limit_200(pg_db, test_app) -> None:
    del pg_db
    uids = [str(uuid.uuid4()) for _ in range(201)]

    too_many = test_app.post(PATH, json={"entity_uids": uids, "detail": "full"})
    assert too_many.status_code == 422

    at_limit = _batch(test_app, uids[:200])
    assert at_limit == {"profiles": {}, "missing": uids[:200]}

    for body in (
        {"entity_uids": [], "detail": "full"},
        {"entity_uids": ["not-a-uuid"], "detail": "full"},
        {"entity_uids": uids[:1], "detail": "summary"},
        {"detail": "full"},
        {"entity_uids": uids[:1], "detail": "full", "limit": 1},
    ):
        assert test_app.post(PATH, json=body).status_code == 422, body


def test_missing_uids_listed(pg_db, test_app) -> None:
    del pg_db
    found = _with_stems("decks-batch-found")
    _no_profile_id, no_profile = _create_track("decks-batch-no-profile")
    stale_id, stale = _track("decks-batch-stale")
    # The file changed since it was analysed: the profile no longer describes it.
    mark_track_mix_source_revision(stale_id, OTHER_REVISION)
    unknown = str(uuid.uuid4())

    batch = _batch(
        test_app,
        [unknown, found, no_profile, found.upper(), stale, unknown],
    )

    assert list(batch["profiles"]) == [found]
    # Request order, each UID once, in canonical form.
    assert batch["missing"] == [unknown, no_profile, stale]
    for uid in batch["missing"]:
        assert (
            test_app.get(f"/api/tracks/by-entity/{uid}/mix-profile").status_code == 404
        )


def test_single_query(pg_db, test_app) -> None:
    del pg_db
    from crate.db.queries.decks_profiles import get_decks_mix_profiles

    uids = [
        _with_stems("decks-batch-query-a", producers=("decks", "server")),
        _with_stems("decks-batch-query-b"),
        _track("decks-batch-query-c")[1],
        str(uuid.uuid4()),
    ]

    statements, stop = _record_statements()
    try:
        reads = get_decks_mix_profiles(uids)
    finally:
        stop()
    assert len(statements) == 1, statements
    assert "ANY" in statements[0]
    assert set(reads) == set(uids[:3])
    # Two producers of the same file do not repeat the profile.
    assert len(reads[uids[0]].analyses) == 2

    statements, stop = _record_statements()
    try:
        _batch(test_app, uids)
    finally:
        stop()
    assert len(statements) == 1, statements


def test_full_profile_without_phrases_keeps_the_grid(pg_db, test_app) -> None:
    del pg_db
    track_id, uid = _create_track("decks-batch-no-phrases")
    upsert_track_mix_profile(
        track_id,
        replace(
            _profile(uid),
            source_revision=REVISION,
            duration_ms=DURATION_MS,
            beat_grid_ms=GRID,
            phrases=None,
        ),
    )
    upsert_stem_analysis(
        track_id, StemAnalysis.model_validate(_payload()), producer_kind="decks"
    )

    profile = _batch(test_app, [uid])["profiles"][uid]

    # The analysis applies to the file, but there are no phrases to lay it on.
    assert "stems" not in profile
    assert profile == _single(test_app, uid)


async def _access_token_user(_middleware, _request):
    return {
        "id": 7,
        "email": "vdj@example.test",
        "role": "user",
        "auth_type": "access_token",
        "access_token_id": 42,
        "scopes": ["vdj.catalog.read", "vdj.smart_mix.read"],
    }


def test_access_token_rejected(test_app) -> None:
    body = {"entity_uids": [str(uuid.uuid4())], "detail": "full"}
    with patch("crate.api.auth.AuthMiddleware.resolve_user", _access_token_user):
        # The middleware never lets a crv_ token reach Decks routes...
        assert test_app.post(PATH, json=body).status_code == 401
        # ...and the handler refuses one even if a future allow-list did.
        with patch("crate.api.auth._is_access_token_request", return_value=True):
            assert test_app.post(PATH, json=body).status_code == 403


def test_no_session_or_account_rejected(test_app) -> None:
    body = {"entity_uids": [str(uuid.uuid4())], "detail": "full"}

    async def _anonymous(_middleware, _request):
        return None

    async def _remote_user(_middleware, _request):
        return {"id": None, "email": "proxy@example.test", "role": "user"}

    with patch("crate.api.auth.AuthMiddleware.resolve_user", _anonymous):
        assert test_app.post(PATH, json=body).status_code == 401
    with patch("crate.api.auth.AuthMiddleware.resolve_user", _remote_user):
        assert test_app.post(PATH, json=body).status_code == 403
