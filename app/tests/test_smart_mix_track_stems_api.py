"""GET /api/smart-mix/tracks/{track_id}/stems: a track's stems for the admin's Audio
profile dialog (ST2.PR4, design §3 STEM-D2)."""

from __future__ import annotations

import base64
from dataclasses import replace

import pytest
from sqlalchemy import text

from crate.db.repositories.smart_mix import (
    mark_track_mix_source_revision,
    upsert_track_mix_profile,
)
from crate.db.repositories.smart_mix_stems import upsert_stem_analysis
from crate.db.tx import transaction_scope
from crate.smart_mix.models import Phrase
from crate.smart_mix.stems import (
    ESTIMATED_STEM_SECONDS_PER_TRACK,
    STEM_SOURCES,
    StemAnalysis,
)
from tests.test_smart_mix_playlists_api import _as_user, _count_statements
from tests.test_smart_mix_playlists_repository import _playlist, _user
from tests.test_smart_mix_repository import _create_track, _profile

# The test client's session is user 1, an admin (tests/conftest.py).
ME = 1
REVISION = "d" * 64
OLD_REVISION = "c" * 64
DURATION_MS = 32_000
WINDOWS = DURATION_MS // 250
GRID = tuple(range(500, DURATION_MS + 500, 500))
PHRASES = (
    Phrase(
        start_beat=0, start_ms=500, bars=8, energy=0.5, delta_energy=None, kind="intro"
    ),
    Phrase(
        start_beat=32,
        start_ms=16_500,
        bars=8,
        energy=0.7,
        delta_energy=0.2,
        kind="body",
    ),
)
# YAMNet's voice per phrase: the first is under the threshold (90), the second over.
VOICE = bytes([20, 200])


def _url(track_id: int) -> str:
    return f"/api/smart-mix/tracks/{track_id}/stems"


def _track(name: str, *, profiled: bool = True) -> tuple[int, str]:
    track_id, uid = _create_track(name)
    if profiled:
        upsert_track_mix_profile(
            track_id,
            replace(
                _profile(uid),
                source_revision=REVISION,
                duration_ms=DURATION_MS,
                outro_cue_ms=24_000,
                beat_grid_ms=GRID,
                phrases=PHRASES,
                vocal_presence=VOICE,
                vocal_detector="yamnet-2",
            ),
        )
    return track_id, uid


def _levels() -> dict[str, bytes]:
    first = 66  # The first window whose centre is in the second phrase.
    return {
        "drums": bytes([200]) * WINDOWS,
        "bass": bytes([20]) * first + bytes([120]) * (WINDOWS - first),
        "other": bytes([30]) * WINDOWS,
        "vocals": bytes(first) + bytes([180]) * (WINDOWS - first),
    }


def _analysis(*, producer: str, revision: str = REVISION, beats=GRID) -> StemAnalysis:
    return StemAnalysis.model_validate(
        {
            "schema": "stem-analysis/1",
            "producer": producer,
            "separator": {
                "model": "htdemucs",
                "version": "htdemucs-onnx-1",
                "sources": list(STEM_SOURCES),
            },
            "sourceRevision": revision,
            "hopMs": 250,
            "levels": _levels(),
            "drumBeatsMs": beats,
            "durationMs": DURATION_MS,
        }
    )


def _b64(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def _job(track_id: int, **values) -> None:
    columns = {
        "state": "pending",
        "attempts": 0,
        "last_error": None,
        "started_at": None,
        "finished_at": None,
        "source_revision": REVISION,
        **values,
    }
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_stem_jobs (
                    track_id, state, attempts, last_error, started_at, finished_at,
                    source_revision
                ) VALUES (
                    :track_id, :state, :attempts, :last_error,
                    CAST(:started_at AS TIMESTAMPTZ), CAST(:finished_at AS TIMESTAMPTZ),
                    :source_revision
                )
                ON CONFLICT (track_id) DO UPDATE SET
                    state = EXCLUDED.state, attempts = EXCLUDED.attempts,
                    last_error = EXCLUDED.last_error,
                    started_at = EXCLUDED.started_at,
                    finished_at = EXCLUDED.finished_at
                """
            ),
            {"track_id": track_id, **columns},
        )


def _stem_file(track_id: int, *, revision: str = REVISION, size: int = 42_000) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO track_stem_files (
                    track_id, path, bytes, separator_model, separator_version,
                    source_revision
                ) VALUES (
                    :track_id, :path, :bytes, 'htdemucs', 'htdemucs-onnx-1', :revision
                )
                """
            ),
            {
                "track_id": track_id,
                "path": f"{track_id}.stem.mp4",
                "bytes": size,
                "revision": revision,
            },
        )


def _turn_on(playlist_id: int) -> None:
    with transaction_scope() as session:
        session.execute(
            text(
                """
                INSERT INTO smart_mix_playlists (
                    playlist_id, user_id, enabled, enabled_at, revision, updated_at
                )
                SELECT id, user_id, TRUE, NOW(), 1, NOW()
                FROM playlists WHERE id = :playlist_id
                """
            ),
            {"playlist_id": playlist_id},
        )


def test_reads_every_analysis_with_its_levels_and_the_one_smart_mix_uses(
    pg_db, test_app
) -> None:
    del pg_db
    track_id, uid = _track("track-stems-analyses")
    contributor = _user("track-stems-contributor")
    upsert_stem_analysis(
        track_id,
        _analysis(producer="crate-decks/0.4.0"),
        producer_kind="decks",
        contributed_by=contributor,
    )
    # The server's analysis describes the file the track had before.
    upsert_stem_analysis(
        track_id,
        _analysis(producer="crate-server/stems-1", revision=OLD_REVISION, beats=None),
        producer_kind="server",
    )

    response = test_app.get(_url(track_id))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["trackId"] == track_id
    assert body["trackEntityUid"] == uid
    assert body["durationMs"] == DURATION_MS
    assert body["sourceRevision"] == REVISION
    assert body["profileAnalyzedAt"] is not None
    assert body["sourceStaleAt"] is None
    assert body["vocalDetector"] == "yamnet-2"
    # Every user gets the phrase grid, with YAMNet's voice per phrase.
    assert body["phrases"] == [
        {"startMs": 500, "endMs": 16_500, "kind": "intro", "bars": 8, "voiced": False},
        {"startMs": 16_500, "endMs": 32_000, "kind": "body", "bars": 8, "voiced": True},
    ]
    by_kind = {analysis["producerKind"]: analysis for analysis in body["analyses"]}
    assert set(by_kind) == {"decks", "server"}
    decks, server = by_kind["decks"], by_kind["server"]
    assert decks["producer"] == "crate-decks/0.4.0"
    assert (decks["separatorModel"], decks["separatorVersion"]) == (
        "htdemucs",
        "htdemucs-onnx-1",
    )
    assert (decks["sourceRevision"], decks["hopMs"], decks["durationMs"]) == (
        REVISION,
        250,
        DURATION_MS,
    )
    assert decks["levels"] == {stem: _b64(v) for stem, v in _levels().items()}
    assert decks["drumBeatsMs"] == list(GRID)
    assert (decks["current"], decks["chosen"]) == (True, True)
    assert decks["contributedBy"] == {
        "id": contributor,
        "username": "track-stems-contributor",
    }
    assert decks["createdAt"] and decks["updatedAt"]
    # A stale analysis is listed, but Smart Mix does not use it.
    assert (server["current"], server["chosen"]) == (False, False)
    assert server["sourceRevision"] == OLD_REVISION
    assert server["drumBeatsMs"] is None
    assert server["contributedBy"] is None
    # The stems layer of the chosen analysis, as the full mix profile serves it.
    assert body["stems"]["producer"] == "crate-decks/0.4.0"
    assert [phrase["bass"] for phrase in body["stems"]["phrases"]] == [20, 120]
    assert (body["job"], body["file"], body["playlists"]) == (None, None, [])


def test_a_stale_profile_keeps_the_analyses_without_phrases_or_layer(
    pg_db, test_app
) -> None:
    del pg_db
    track_id, _uid = _track("track-stems-stale-profile")
    upsert_stem_analysis(
        track_id, _analysis(producer="crate-server/stems-1"), producer_kind="server"
    )
    assert mark_track_mix_source_revision(track_id, "e" * 64)

    body = test_app.get(_url(track_id)).json()

    assert body["sourceRevision"] is None
    assert body["sourceStaleAt"] is not None
    assert body["phrases"] == [] and body["stems"] is None
    assert [a["current"] for a in body["analyses"]] == [False]
    assert [a["chosen"] for a in body["analyses"]] == [False]
    # The library's duration until the profile is analysed again.
    assert body["durationMs"] == 180_000


def test_job_state_has_its_dates_and_the_last_error_only_for_analysis_managers(
    pg_db, test_app, monkeypatch
) -> None:
    del pg_db
    track_id, _uid = _track("track-stems-job")
    _job(
        track_id,
        state="failed",
        attempts=3,
        last_error="ffmpeg could not decode the file",
        started_at="2026-11-09T01:44:00+00:00",
        finished_at="2026-11-09T01:47:00+00:00",
    )

    job = test_app.get(_url(track_id)).json()["job"]

    assert job["state"] == "failed"
    assert (job["attempts"], job["maxAttempts"]) == (3, 3)
    assert job["requestedAt"] is not None
    assert job["startedAt"].startswith("2026-11-09T01:44:00")
    assert job["finishedAt"].startswith("2026-11-09T01:47:00")
    assert job["lastError"] == "ffmpeg could not decode the file"
    # Nothing separated on this server yet: the estimated time per track.
    assert job["secondsPerTrack"] == ESTIMATED_STEM_SECONDS_PER_TRACK

    _as_user(monkeypatch, _user("track-stems-listener"))
    hidden = test_app.get(_url(track_id)).json()["job"]
    assert hidden["state"] == "failed"
    assert hidden["lastError"] is None


def test_a_current_server_analysis_makes_the_job_ready(pg_db, test_app) -> None:
    del pg_db
    track_id, _uid = _track("track-stems-job-ready")
    upsert_stem_analysis(
        track_id, _analysis(producer="crate-server/stems-1"), producer_kind="server"
    )
    _job(
        track_id,
        state="ready",
        attempts=1,
        started_at="2026-11-09T03:11:18+00:00",
        finished_at="2026-11-09T03:14:07+00:00",
    )

    job = test_app.get(_url(track_id)).json()["job"]

    assert (job["state"], job["attempts"]) == ("ready", 1)
    # The pace of the latest separations: this one took 169 s.
    assert job["secondsPerTrack"] == 169


def test_files_and_the_smart_mix_playlists_that_hold_the_track(
    pg_db, test_app, monkeypatch
) -> None:
    del pg_db
    track_id, _uid = _track("track-stems-files")
    other_id, _other_uid = _track("track-stems-files-other")
    upsert_stem_analysis(
        track_id, _analysis(producer="crate-server/stems-1"), producer_kind="server"
    )
    _stem_file(track_id)
    owner = _user("track-stems-owner")
    member = _user("track-stems-member")
    mine = _playlist(owner, [track_id, other_id], name="Warehouse 03:00")
    _turn_on(mine)
    theirs = _playlist(ME, [track_id], name="Cold Waves B2B")
    _turn_on(theirs)
    # Not a Smart Mix playlist: not listed.
    _playlist(owner, [track_id], name="Plain")
    with transaction_scope() as session:
        session.execute(
            text(
                "INSERT INTO playlist_members (playlist_id, user_id, role, created_at) "
                "VALUES (:playlist_id, :user_id, 'collab', NOW())"
            ),
            {"playlist_id": mine, "user_id": member},
        )

    body = test_app.get(_url(track_id)).json()

    file = body["file"]
    assert file["bytes"] == 42_000
    assert (file["separatorModel"], file["separatorVersion"]) == (
        "htdemucs",
        "htdemucs-onnx-1",
    )
    assert (file["sourceRevision"], file["current"]) == (REVISION, True)
    assert file["createdAt"] and file["lastUsedAt"]
    with transaction_scope() as session:
        owner_name = session.execute(
            text("SELECT username FROM users WHERE id = :id"), {"id": ME}
        ).scalar_one()
    assert sorted(body["playlists"], key=lambda p: p["playlistId"]) == [
        {
            "playlistId": mine,
            "name": "Warehouse 03:00",
            "owner": {"id": owner, "username": "track-stems-owner"},
            "enabled": True,
            "ready": 1,
            "total": 2,
        },
        {
            "playlistId": theirs,
            "name": "Cold Waves B2B",
            "owner": {"id": ME, "username": owner_name},
            "enabled": True,
            "ready": 1,
            "total": 1,
        },
    ]

    # Other users only see the Smart Mix playlists they own or belong to.
    _as_user(monkeypatch, member)
    assert [
        p["playlistId"] for p in test_app.get(_url(track_id)).json()["playlists"]
    ] == [mine]
    _as_user(monkeypatch, _user("track-stems-stranger"))
    assert test_app.get(_url(track_id)).json()["playlists"] == []


def test_a_file_of_another_revision_is_not_current(pg_db, test_app) -> None:
    del pg_db
    track_id, _uid = _track("track-stems-old-file")
    _stem_file(track_id, revision=OLD_REVISION)

    file = test_app.get(_url(track_id)).json()["file"]

    assert (file["sourceRevision"], file["current"]) == (OLD_REVISION, False)


def test_a_track_without_stem_data_reads_empty_and_a_missing_one_is_404(
    pg_db, test_app
) -> None:
    del pg_db
    track_id, _uid = _track("track-stems-nothing", profiled=False)

    body = test_app.get(_url(track_id)).json()

    assert (body["analyses"], body["job"], body["file"], body["playlists"]) == (
        [],
        None,
        None,
        [],
    )
    assert (body["sourceRevision"], body["phrases"], body["stems"]) == (None, [], None)
    assert test_app.get(_url(999_999_999)).status_code == 404


def test_reads_stay_within_three_queries(pg_db, test_app) -> None:
    del pg_db
    track_id, _uid = _track("track-stems-queries")
    upsert_stem_analysis(
        track_id, _analysis(producer="crate-server/stems-1"), producer_kind="server"
    )
    _stem_file(track_id)
    _job(track_id, state="ready", attempts=1)
    for n in range(3):
        playlist_id = _playlist(ME, [track_id], name=f"Set {n}")
        _turn_on(playlist_id)

    statements, stop = _count_statements()
    try:
        assert test_app.get(_url(track_id)).status_code == 200
    finally:
        stop()

    assert len(statements) <= 3, statements


def test_the_job_attempts_match_the_separation_task() -> None:
    from crate.api.smart_mix_stems import STEM_JOB_MAX_ATTEMPTS
    from crate.worker_handlers.smart_mix_stems import MAX_ATTEMPTS

    assert STEM_JOB_MAX_ATTEMPTS == MAX_ATTEMPTS


@pytest.mark.parametrize("spec", ["/openapi.json", "/openapi-crate.json"])
def test_openapi_types_the_track_stems_route(test_app, spec: str) -> None:
    schema = test_app.get(spec).json()
    operation = schema["paths"]["/api/smart-mix/tracks/{track_id}/stems"]["get"]
    components = schema["components"]["schemas"]

    assert operation["tags"] == ["smart-mix"]
    assert operation["security"] == [{"cookieAuth": []}, {"bearerAuth": []}]
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/SmartMixTrackStemsResponse"
    }
    assert {"401", "404"} <= set(operation["responses"])
    analysis = components["SmartMixTrackStemAnalysisResponse"]["properties"]
    assert analysis["producerKind"]["enum"] == ["server", "decks"]
    assert analysis["levels"] == {"$ref": "#/components/schemas/StemLevels"}
    job = components["SmartMixTrackStemJobResponse"]["properties"]
    assert job["state"]["enum"] == ["pending", "analyzing", "ready", "failed"]
