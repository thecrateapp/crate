from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

from crate.smart_mix.compatible import (
    CompatibleTrackCandidate,
    CompatibleTrackResult,
)
from crate.smart_mix.models import MixProfileQuality, TrackMixProfile
from crate.smart_mix.planner import CompatibilityScore


async def _unauthenticated(self, request):
    del self, request
    return None


def test_compatible_tracks_requires_authentication(test_app) -> None:
    with patch("crate.api.auth.AuthMiddleware.resolve_user", _unauthenticated):
        response = test_app.get(
            "/api/tracks/by-entity/00000000-0000-0000-0000-000000000001/compatible"
        )

    assert response.status_code == 401


def test_compatible_tracks_returns_one_bounded_ranked_response(
    test_app,
    monkeypatch,
) -> None:
    from crate.api import smart_mix

    calls: list[tuple[str, int, str]] = []
    rank_modes: list[str] = []
    seed = _candidate("seed")
    candidate = _candidate("candidate")

    def fake_inputs(entity_uid: str, *, max_candidates: int, mode: str):
        calls.append((entity_uid, max_candidates, mode))
        return seed, [candidate]

    def fake_rank(*_args, mode: str, **_kwargs):
        rank_modes.append(mode)
        return [_result(candidate)]

    monkeypatch.setattr(smart_mix, "get_compatible_track_inputs", fake_inputs)
    monkeypatch.setattr(smart_mix, "rank_compatible_tracks", fake_rank)
    monkeypatch.setattr(
        "crate.db.repositories.tasks.create_task",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("read request must not enqueue analysis")
        ),
    )

    response = test_app.get(
        "/api/tracks/by-entity/00000000-0000-0000-0000-000000000001/compatible",
        params={
            "scope": "local",
            "limit": 20,
            "planner_version": "smart-mix-v2",
            "context": "smooth",
        },
    )

    assert response.status_code == 200
    assert calls == [("00000000-0000-0000-0000-000000000001", 500, "smooth")]
    assert rank_modes == ["smooth"]
    assert response.json() == {
        "seedTrackEntityUid": "seed",
        "scope": "local",
        "plannerVersion": "smart-mix-v2",
        "context": "smooth",
        "items": [
            {
                "trackId": candidate.track_id,
                "trackEntityUid": "candidate",
                "title": "Track candidate",
                "artist": "Artist",
                "album": "Album",
                "score": 0.91,
                "confidence": 0.9,
                "scoreBreakdown": {
                    "plannerVersion": 2,
                    "overall": 0.91,
                    "signalConfidence": 0.9,
                    "tempo": 1.0,
                    "harmonic": 1.0,
                    "harmonicRelationship": "same",
                    "energy": 0.9,
                    "danceability": 0.9,
                    "valence": 0.9,
                    "bliss": 0.8,
                    "genre": 1.0,
                    "transition": 0.92,
                    "beatmatchAffinity": 0.1,
                    "beatmatchable": True,
                    "tempoFlow": 1.0,
                    "level": 0.95,
                    "brightness": 0.9,
                    "silence": 1.0,
                },
                "fallbackReasons": [],
            }
        ],
    }


def test_compatible_tracks_include_browser_fields_for_virtualdj(
    test_app,
    monkeypatch,
) -> None:
    from dataclasses import replace

    from crate.api import smart_mix

    seed = _candidate("seed")
    candidate = _candidate("candidate")
    result = replace(
        _result(candidate),
        duration_seconds=201.5,
        bpm=121.0,
        camelot="8A",
        energy=0.72,
        year="2001",
        genre="Post-hardcore",
        album_id=42,
        album_has_cover=True,
    )
    monkeypatch.setattr(
        smart_mix, "get_compatible_track_inputs", lambda *_a, **_k: (seed, [candidate])
    )
    monkeypatch.setattr(smart_mix, "rank_compatible_tracks", lambda *_a, **_k: [result])

    response = test_app.get(
        "/api/tracks/by-entity/00000000-0000-0000-0000-000000000001/compatible"
    )

    item = response.json()["items"][0]
    assert response.status_code == 200
    assert item["duration"] == 201.5
    assert item["bpm"] == 121.0
    assert item["camelot"] == "8A"
    assert item["energy"] == 0.72
    assert item["year"] == "2001"
    assert item["genre"] == "Post-hardcore"
    assert item["coverUrl"] == "/api/vdj/albums/42/cover?size=512"
    assert item["albumId"] == 42


def test_compatible_tracks_reports_missing_seed_or_profile(
    test_app, monkeypatch
) -> None:
    from crate.api import smart_mix

    monkeypatch.setattr(
        smart_mix,
        "get_compatible_track_inputs",
        lambda *_args, **_kwargs: (None, []),
    )

    response = test_app.get(
        "/api/tracks/by-entity/00000000-0000-0000-0000-000000000001/compatible"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Track or Smart Mix profile not found"


def test_compatible_tracks_validates_scope_limit_and_planner_version(test_app) -> None:
    path = "/api/tracks/by-entity/00000000-0000-0000-0000-000000000001/compatible"

    assert test_app.get(path, params={"scope": "global"}).status_code == 422
    assert test_app.get(path, params={"limit": 0}).status_code == 422
    assert test_app.get(path, params={"limit": 101}).status_code == 422
    assert (
        test_app.get(path, params={"planner_version": "future-v3"}).status_code == 422
    )


def _candidate(track_uid: str) -> CompatibleTrackCandidate:
    return CompatibleTrackCandidate(
        track_id=7 if track_uid == "seed" else 8,
        track_entity_uid=track_uid,
        title=f"Track {track_uid}",
        artist="Artist",
        album="Album",
        profile=TrackMixProfile(
            track_entity_uid=track_uid,
            profile_version=1,
            profile_revision=f"profile-{track_uid}",
            analyzer="crate-rust",
            analyzer_version="smart-mix-v2",
            source_revision=f"source-{track_uid}",
            duration_ms=180_000,
            quality=MixProfileQuality.FULL,
            bpm=120.0,
            bpm_confidence=0.95,
            tempo_stability=0.97,
            downbeat_anchor_ms=500,
            time_signature=4,
            camelot="8A",
            key_confidence=0.9,
            analyzed_at=datetime(2026, 7, 28, tzinfo=UTC),
        ),
    )


def _result(candidate: CompatibleTrackCandidate) -> CompatibleTrackResult:
    breakdown = CompatibilityScore(
        planner_version=2,
        overall=0.91,
        signal_confidence=0.9,
        tempo=1.0,
        harmonic=1.0,
        harmonic_relationship="same",
        energy=0.9,
        danceability=0.9,
        valence=0.9,
        bliss=0.8,
        genre=1.0,
        transition=0.92,
        beatmatch_affinity=0.1,
        beatmatchable=True,
        tempo_flow=1.0,
        level=0.95,
        brightness=0.9,
        silence=1.0,
    )
    return CompatibleTrackResult(
        track_id=candidate.track_id,
        track_entity_uid=candidate.track_entity_uid,
        title=candidate.title,
        artist=candidate.artist,
        album=candidate.album,
        score=0.91,
        confidence=0.9,
        score_breakdown=breakdown,
        fallback_reasons=(),
    )
