from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch
import uuid

from crate.smart_mix.models import MixProfileQuality, TrackMixProfile


async def _unauthenticated(self, request):
    del self, request
    return None


def test_profile_and_plan_routes_require_authentication(test_app) -> None:
    uid = str(uuid.uuid4())
    with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
        profile = test_app.get(f"/api/tracks/by-entity/{uid}/mix-profile")
        plans = test_app.post(
            "/api/playback/transition-plans",
            json={
                "plannerVersion": "smart-mix-v1",
                "edges": [_edge(uid, str(uuid.uuid4()))],
            },
        )

    assert profile.status_code == 401
    assert plans.status_code == 401


def test_profile_summary_omits_grid_and_full_detail_decodes_it(
    test_app,
    monkeypatch,
) -> None:
    from crate.api import smart_mix

    uid = str(uuid.uuid4())
    monkeypatch.setattr(
        smart_mix,
        "get_track_mix_profile_by_entity_uid",
        lambda _uid, *, include_beat_grid: _profile(
            uid,
            include_grid=include_beat_grid,
        ),
    )
    monkeypatch.setattr(
        "crate.db.repositories.tasks.create_task",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("profile reads must not start analysis")
        ),
    )

    summary = test_app.get(
        f"/api/tracks/by-entity/{uid}/mix-profile",
        params={"detail": "summary"},
    )
    full = test_app.get(
        f"/api/tracks/by-entity/{uid}/mix-profile",
        params={"detail": "full"},
    )

    assert summary.status_code == 200
    assert "beatGridMs" not in summary.json()
    assert full.status_code == 200
    assert full.json()["beatGridFormat"] == "delta-ms-v1"
    assert full.json()["beatGridMs"] == [500, 1_000, 1_500]


def test_profile_route_rejects_raw_paths_and_reports_missing_profile(
    test_app,
    monkeypatch,
) -> None:
    from crate.api import smart_mix

    uid = str(uuid.uuid4())
    monkeypatch.setattr(
        smart_mix,
        "get_track_mix_profile_by_entity_uid",
        lambda *_args, **_kwargs: None,
    )

    assert test_app.get(
        "/api/tracks/by-entity/%2Fmusic%2Ftrack.flac/mix-profile"
    ).status_code in {
        404,
        422,
    }
    missing = test_app.get(f"/api/tracks/by-entity/{uid}/mix-profile")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Smart Mix profile not found"


def test_batch_plans_deduplicate_edges_and_load_profiles_once(
    test_app,
    monkeypatch,
) -> None:
    from crate.api import smart_mix

    outgoing_uid = str(uuid.uuid4())
    incoming_uid = str(uuid.uuid4())
    loads: list[list[str]] = []
    planned: list[tuple[str, str]] = []
    cached: dict[str, dict] = {}

    def fake_profiles(entity_uids, *, include_beat_grid):
        loads.append(list(entity_uids))
        assert include_beat_grid is True
        return [
            _profile(uid, include_grid=True)
            if uid in {outgoing_uid, incoming_uid}
            else None
            for uid in entity_uids
        ]

    real_planner = smart_mix.plan_transition

    def counting_planner(outgoing, incoming, context, **kwargs):
        planned.append(
            (
                kwargs["outgoing_track_entity_uid"],
                kwargs["incoming_track_entity_uid"],
            )
        )
        return real_planner(outgoing, incoming, context, **kwargs)

    monkeypatch.setattr(
        smart_mix,
        "get_track_mix_profiles_by_entity_uids",
        fake_profiles,
    )
    monkeypatch.setattr(smart_mix, "plan_transition", counting_planner)
    monkeypatch.setattr(
        smart_mix,
        "get_smart_mix_plan_cache",
        lambda key: cached.get(key),
    )
    monkeypatch.setattr(
        smart_mix,
        "set_smart_mix_plan_cache",
        lambda key, value: cached.__setitem__(key, value),
    )
    edge = _edge(outgoing_uid, incoming_uid)

    response = test_app.post(
        "/api/playback/transition-plans",
        json={
            "plannerVersion": "smart-mix-v1",
            "edges": [edge, edge],
        },
    )

    assert response.status_code == 200
    assert len(response.json()["plans"]) == 1
    assert response.json()["plans"][0]["mode"] == "beatmatch"
    assert loads == [[outgoing_uid, incoming_uid]]
    assert planned == [(outgoing_uid, incoming_uid)]

    cached_response = test_app.post(
        "/api/playback/transition-plans",
        json={"plannerVersion": "smart-mix-v1", "edges": [edge]},
    )
    assert cached_response.status_code == 200
    assert len(planned) == 1


def test_missing_profile_returns_per_edge_fallback(test_app, monkeypatch) -> None:
    from crate.api import smart_mix

    outgoing_uid = str(uuid.uuid4())
    incoming_uid = str(uuid.uuid4())
    monkeypatch.setattr(
        smart_mix,
        "get_track_mix_profiles_by_entity_uids",
        lambda entity_uids, **_kwargs: [
            None if uid == outgoing_uid else _profile(uid) for uid in entity_uids
        ],
    )
    monkeypatch.setattr(smart_mix, "get_smart_mix_plan_cache", lambda _key: None)
    monkeypatch.setattr(
        smart_mix,
        "set_smart_mix_plan_cache",
        lambda _key, _value: None,
    )

    response = test_app.post(
        "/api/playback/transition-plans",
        json={
            "plannerVersion": "smart-mix-v1",
            "edges": [_edge(outgoing_uid, incoming_uid)],
        },
    )

    assert response.status_code == 200
    [plan] = response.json()["plans"]
    assert plan["mode"] == "adaptive"
    assert plan["fallbackReason"] == "missing_profile"
    assert plan["outgoingTrackEntityUid"] == outgoing_uid


def test_batch_rejects_empty_oversized_or_unknown_plan_requests(test_app) -> None:
    uid = str(uuid.uuid4())
    path = "/api/playback/transition-plans"

    assert (
        test_app.post(
            path,
            json={"plannerVersion": "smart-mix-v1", "edges": []},
        ).status_code
        == 422
    )
    assert (
        test_app.post(
            path,
            json={
                "plannerVersion": "smart-mix-v1",
                "edges": [_edge(uid, str(uuid.uuid4())) for _ in range(33)],
            },
        ).status_code
        == 422
    )
    assert (
        test_app.post(
            path,
            json={
                "plannerVersion": "future-v2",
                "edges": [_edge(uid, str(uuid.uuid4()))],
            },
        ).status_code
        == 422
    )
    edge_with_path = {
        **_edge(uid, str(uuid.uuid4())),
        "outgoingPath": "/music/secret.flac",
    }
    assert (
        test_app.post(
            path,
            json={"plannerVersion": "smart-mix-v1", "edges": [edge_with_path]},
        ).status_code
        == 422
    )


def _edge(outgoing_uid: str, incoming_uid: str) -> dict:
    return {
        "outgoingTrackEntityUid": outgoing_uid,
        "incomingTrackEntityUid": incoming_uid,
        "context": {
            "source": "radio",
            "automatic": True,
            "offline": False,
            "preferredDurationMs": 5_000,
            "userCueProfile": "default",
            "allowBeatmatch": True,
            "allowTempoAdjustment": True,
        },
    }


def _profile(
    track_uid: str,
    *,
    include_grid: bool = False,
) -> TrackMixProfile:
    return TrackMixProfile(
        track_entity_uid=track_uid,
        profile_version=1,
        profile_revision=f"profile-{track_uid}",
        analyzer="crate-rust",
        analyzer_version="smart-mix-v1",
        source_revision=f"source-{track_uid}",
        duration_ms=180_000,
        quality=MixProfileQuality.FULL,
        bpm=120.0,
        bpm_confidence=0.95,
        tempo_stability=0.97,
        beat_anchor_ms=500,
        downbeat_anchor_ms=500,
        time_signature=4,
        beat_grid_format="delta-ms-v1" if include_grid else None,
        beat_grid_ms=(500, 1_000, 1_500) if include_grid else (),
        key="A",
        scale="minor",
        camelot="8A",
        key_confidence=0.9,
        intro_cue_ms=8_000,
        outro_cue_ms=165_000,
        intro_lufs=-10.0,
        outro_lufs=-10.0,
        true_peak_dbfs=-1.0,
        intro_energy=0.7,
        outro_energy=0.7,
        global_energy=0.7,
        danceability=0.7,
        valence=0.5,
        analyzed_at=datetime(2026, 7, 28, tzinfo=UTC),
    )
