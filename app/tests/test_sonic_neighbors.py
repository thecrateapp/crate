"""Bounded Admin sonic neighbors keep local identity and measured units."""

from datetime import date

import pytest
from sqlalchemy import text

from crate.db.tx import read_scope
from crate.smart_mix.versions import ANALYZER_VERSION, PROFILE_SCHEMA_VERSION
from tests.conftest import PG_AVAILABLE
from tests.test_collection_insights import _album, _play, _track


def _neighbor(s, album, n, vector):
    track = _track(s, album, n=n, bliss=vector)
    if vector is not None:
        s.execute(
            text(
                "UPDATE library_tracks SET bliss_embedding=CAST(:vector AS vector(20)) WHERE id=:id"
            ),
            {"id": track["id"], "vector": "[" + ",".join(map(str, vector)) + "]"},
        )
    return track


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_neighbors_are_bounded_ordered_local_and_resolve_listening_once(pg_db):
    from crate.db.queries.sonic_neighbors import get_sonic_neighbors

    with read_scope() as s:
        album = _album(s)
        seed = _neighbor(s, album, 1, [1.0] + [0.0] * 19)
        close = _neighbor(s, album, 2, [1.0, 0.1] + [0.0] * 18)
        farther = _neighbor(s, album, 3, [0.2, 1.0] + [0.0] * 18)
        _neighbor(s, _album(s, artist="Hidden", quarantine=True), 1, [1.0] + [0.0] * 19)
        _neighbor(s, album, 4, [0.0] * 20)
        _play(s, date(2026, 10, 24), uid=close["entity_uid"], plays=2, minutes=7)
        _play(s, date(2026, 10, 23), track=close["id"], plays=1, minutes=3)
        # A nonmatching stronger UID must not fall back to the matching local ID.
        _play(
            s,
            date(2026, 10, 24),
            track=close["id"],
            uid=seed["entity_uid"],
            plays=100,
            minutes=100,
        )
        _play(s, date(2026, 8, 1), track=close["id"], plays=1, minutes=50)
        result = get_sonic_neighbors(
            seed["id"], today=date(2026, 10, 24), limit=2, session=s
        )
        assert result["available"] is True
        assert [r["track"]["id"] for r in result["items"]] == [
            close["id"],
            farther["id"],
        ]
        assert result["items"][0]["distance"] < result["items"][1]["distance"]
        reading = result["items"][0]["track"]
        assert reading["heard"] is True
        assert reading["plays"] == 3
        assert reading["minutes"] == 10
        assert reading["entity_uid"] == close["entity_uid"]
        assert result["items"][1]["track"]["heard"] is False
        assert len(get_sonic_neighbors(seed["id"], limit=1, session=s)["items"]) == 1


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_missing_invalid_and_quarantined_seeds_do_not_claim_similarity(pg_db):
    from crate.db.queries.sonic_neighbors import get_sonic_neighbors

    with read_scope() as s:
        album = _album(s)
        no_vector = _neighbor(s, album, 1, None)
        zero_vector = _neighbor(s, album, 2, [0.0] * 20)
        hidden = _neighbor(
            s, _album(s, artist="Hidden", quarantine=True), 1, [1.0] + [0.0] * 19
        )
        assert get_sonic_neighbors(9999999, session=s) is None
        assert get_sonic_neighbors(hidden["id"], session=s) is None
        for seed in (no_vector, zero_vector):
            result = get_sonic_neighbors(seed["id"], session=s)
            assert result == {
                "seed_track_id": seed["id"],
                "available": False,
                "items": [],
            }


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_neighbor_readings_never_fall_back_to_legacy_energy_or_loudness(pg_db):
    from crate.db.queries.sonic_neighbors import get_sonic_neighbors

    with read_scope() as s:
        album = _album(s)
        seed = _neighbor(s, album, 1, [1.0] + [0.0] * 19)
        neighbor = _neighbor(s, album, 2, [1.0, 0.1] + [0.0] * 18)
        s.execute(
            text(
                "UPDATE library_tracks SET bpm=99,energy=0.99,loudness=-2 WHERE id=:id"
            ),
            {"id": neighbor["id"]},
        )
        s.execute(
            text("""INSERT INTO track_mix_profiles(track_id,profile_version,profile_revision,analyzer,analyzer_version,source_revision,quality,bpm,global_energy,integrated_lufs,measurement_version,analyzed_at)
            VALUES(:id,:version,'test','crate-rust',:analyzer,'source','partial',123,0.4,-16,'bs1770-v1',now())"""),
            {
                "id": neighbor["id"],
                "version": PROFILE_SCHEMA_VERSION,
                "analyzer": ANALYZER_VERSION,
            },
        )
        reading = get_sonic_neighbors(seed["id"], session=s)["items"][0]["track"]
        assert reading["bpm"] == 123
        assert reading["energy"] == 0.4
        assert reading["integrated_lufs"] == -16
        assert reading["quality"] == "partial"
        s.execute(
            text(
                "UPDATE track_mix_profiles SET source_stale_at=now() WHERE track_id=:id"
            ),
            {"id": neighbor["id"]},
        )
        reading = get_sonic_neighbors(seed["id"], session=s)["items"][0]["track"]
        assert reading["bpm"] is None
        assert reading["energy"] is None
        assert reading["integrated_lufs"] is None


def test_sonic_neighbor_endpoint_is_typed_bounded_and_authenticated(
    test_app, monkeypatch
):
    import crate.api.analytics as router

    calls = []

    def neighbors(track_id, **params):
        calls.append((track_id, params))
        return {"seed_track_id": track_id, "available": False, "items": []}

    monkeypatch.setattr(router, "get_sonic_neighbors", neighbors, raising=False)
    path = "/api/admin/collection-insights/sonic-neighbors/7"
    result = test_app.get(path + "?window=90d&limit=4")
    assert result.status_code == 200
    assert result.json()["available"] is False
    assert calls == [(7, {"window": "90d", "limit": 4})]
    for suffix in ("?limit=0", "?limit=13", "?window=all"):
        assert test_app.get(path + suffix).status_code == 422
    assert test_app.get(path.replace("/7", "/0")).status_code == 422
    operation = test_app.get("/openapi.json").json()["paths"][
        path.replace("/7", "/{track_id}")
    ]["get"]
    assert operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert operation["responses"]["200"]["content"]["application/json"]["schema"][
        "$ref"
    ].endswith("/SonicNeighborsResponse")
    monkeypatch.setattr(router, "get_sonic_neighbors", lambda *_a, **_k: None)
    assert test_app.get(path).status_code == 404

    async def no_user(self, request):
        return None

    monkeypatch.setattr("crate.api.auth.AuthMiddleware.resolve_user", no_user)
    assert test_app.get(path).status_code == 401


def test_neighbor_query_validates_bounds_before_reading():
    from crate.db.queries.sonic_neighbors import get_sonic_neighbors

    for kwargs in (
        {"track_id": 0},
        {"track_id": 1, "limit": 0},
        {"track_id": 1, "limit": 13},
        {"track_id": 1, "window": "all"},
    ):
        with pytest.raises(ValueError):
            get_sonic_neighbors(**kwargs)


def test_collection_contract_accepts_old_snapshots_and_validates_sonic_payload():
    from pydantic import ValidationError

    from crate.api.schemas.collection_insights import CollectionInsightsResponse
    from crate.db.collection_insights_surface import cold_collection_insights
    from crate.db.queries.sonic_insights import build_sonic_insights
    from tests.test_sonic_insights import _row

    payload = cold_collection_insights()
    assert CollectionInsightsResponse.model_validate(payload).sonic is None
    payload["sonic"] = build_sonic_insights([_row()])
    response = CollectionInsightsResponse.model_validate(payload)
    assert response.sonic.planes[0].coverage.paired_tracks == 1
    payload["sonic"]["planes"][0]["cells"][0]["examples"][0]["energy"] = float("nan")
    with pytest.raises(ValidationError):
        CollectionInsightsResponse.model_validate(payload)


@pytest.mark.skipif(not PG_AVAILABLE, reason="PostgreSQL not available")
def test_neighbors_attribute_path_only_listening_but_not_global_rows(pg_db):
    from uuid import uuid4

    from crate.db.queries.sonic_neighbors import get_sonic_neighbors

    with read_scope() as s:
        album = _album(s)
        seed = _neighbor(s, album, 1, [1.0] + [0.0] * 19)
        close = _neighbor(s, album, 2, [1.0, 0.1] + [0.0] * 18)
        path = s.execute(
            text("SELECT path FROM library_tracks WHERE id=:id"), {"id": close["id"]}
        ).scalar_one()
        _play(s, date(2026, 10, 24), path=path, plays=4, minutes=12)
        _play(
            s,
            date(2026, 10, 24),
            path=path,
            global_uid=str(uuid4()),
            plays=50,
            minutes=50,
        )

        result = get_sonic_neighbors(
            seed["id"], today=date(2026, 10, 24), limit=1, session=s
        )

        reading = result["items"][0]["track"]
        assert reading["id"] == close["id"]
        assert reading["plays"] == 4
        assert reading["minutes"] == 12
