"""GET and PUT /api/decks/tracks/{uid}/stem-analysis (STEM-D8, design §5 and §7)."""

from __future__ import annotations

import base64
import json
from dataclasses import replace
from typing import Any

import pytest
from sqlalchemy import event, text

from crate.db.repositories.smart_mix import (
    mark_track_mix_source_revision,
    upsert_track_mix_profile,
)
from crate.db.repositories.smart_mix_stems import (
    get_stem_analyses,
    upsert_stem_analysis,
)
from crate.db.tx import read_scope
from crate.smart_mix.models import Phrase
from crate.smart_mix.stems import (
    STEM_PRESENCE_CUTS,
    STEM_SOURCES,
    StemAnalysis,
    stem_present,
)
from tests.test_smart_mix_repository import _create_track, _profile

REVISION = "e" * 64
OTHER_REVISION = "f" * 64
DURATION_MS = 32_000
WINDOWS = DURATION_MS // 250
# The stored grid starts after 0: 64 beats from 500 ms, two phrases of eight bars.
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
MISSING_UID = "00000000-0000-4000-8000-000000000000"


def _url(uid: str) -> str:
    return f"/api/decks/tracks/{uid}/stem-analysis"


def _track(name: str) -> tuple[int, str]:
    track_id, uid = _create_track(name)
    upsert_track_mix_profile(
        track_id,
        replace(
            _profile(uid),
            source_revision=REVISION,
            duration_ms=DURATION_MS,
            outro_cue_ms=24_000,
            beat_grid_ms=GRID,
            phrases=PHRASES,
        ),
    )
    return track_id, uid


def _payload(*, windows: int = WINDOWS, **changes: Any) -> dict:
    # Window 66 (16,500-16,750 ms) is the first whose centre is in the second phrase.
    first = 66
    levels = {
        "drums": bytes([200]) * windows,
        "bass": bytes([20]) * first + bytes([120]) * (windows - first),
        "other": bytes([30]) * windows,
        "vocals": bytes(first) + bytes([180]) * (windows - first),
    }
    payload = {
        "schema": "stem-analysis/1",
        "producer": "crate-decks/0.4.0",
        "separator": {
            "model": "htdemucs",
            "version": "htdemucs-onnx-1",
            "sources": list(STEM_SOURCES),
        },
        "sourceRevision": REVISION,
        "hopMs": 250,
        "levels": {
            stem: base64.b64encode(value).decode("ascii")
            for stem, value in levels.items()
        },
        "drumBeatsMs": list(GRID),
        "durationMs": windows * 250,
    }
    payload.update(changes)
    return payload


def _as_role(monkeypatch, role: str | None) -> None:
    async def resolve(self, request):
        del self, request
        if role is None:
            return None
        return {"id": 1, "email": f"{role}@test.local", "role": role}

    monkeypatch.setattr("crate.api.auth.AuthMiddleware.resolve_user", resolve)


def _stored_decks_rows(track_id: int) -> list[dict]:
    with read_scope() as session:
        return [
            dict(row)
            for row in session.execute(
                text(
                    "SELECT producer, contributed_by FROM track_stem_signals "
                    "WHERE track_id = :track_id AND producer_kind = 'decks'"
                ),
                {"track_id": track_id},
            ).mappings()
        ]


def test_put_requires_the_contribute_permission(test_app, monkeypatch) -> None:
    _as_role(monkeypatch, None)
    assert test_app.put(_url(MISSING_UID), json=_payload()).status_code == 401

    for role in ("user", "librarian", "curator", "editor", "contributor", "ops"):
        _as_role(monkeypatch, role)
        response = test_app.put(_url(MISSING_UID), json=_payload())
        assert response.status_code == 403, role


def test_put_rejects_a_source_revision_that_is_not_current(pg_db, test_app) -> None:
    del pg_db
    track_id, uid = _track("decks-stems-revision")

    response = test_app.put(_url(uid), json=_payload(sourceRevision=OTHER_REVISION))
    assert response.status_code == 409

    # A file replaced since its profile has no current revision until it is analysed.
    mark_track_mix_source_revision(track_id, OTHER_REVISION)
    assert test_app.put(_url(uid), json=_payload()).status_code == 409
    response = test_app.put(_url(uid), json=_payload(sourceRevision=OTHER_REVISION))
    assert response.status_code == 409

    assert get_stem_analyses([track_id]) == {track_id: []}


def test_put_rejects_bodies_over_64_kib(test_app) -> None:
    oversized = b" " * (64 * 1024) + json.dumps(_payload()).encode()

    response = test_app.put(
        _url(MISSING_UID),
        content=oversized,
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 413

    def chunks():
        for _ in range(17):
            yield b" " * 4096

    response = test_app.put(
        _url(MISSING_UID),
        content=chunks(),
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 413


def test_put_rejects_a_track_the_user_cannot_see(pg_db, test_app) -> None:
    del pg_db
    # Decks sees the server's local library: a UID outside it is not found.
    response = test_app.put(_url(MISSING_UID), json=_payload())

    assert response.status_code == 404
    assert test_app.get(_url(MISSING_UID)).status_code == 404


def test_put_then_get_round_trips(pg_db, test_app) -> None:
    del pg_db
    track_id, uid = _track("decks-stems-round-trip")
    payload = _payload()

    stored = test_app.put(_url(uid), json=payload)
    assert stored.status_code == 200, stored.text
    assert stored.json() == {"result": "stored"}

    read = test_app.get(_url(uid))
    assert read.status_code == 200
    assert read.json() == payload
    assert _stored_decks_rows(track_id) == [
        {"producer": "crate-decks/0.4.0", "contributed_by": 1}
    ]

    again = test_app.put(_url(uid), json=_payload(producer="crate-decks/0.4.1"))
    assert again.json() == {"result": "replaced"}
    assert test_app.get(_url(uid)).json()["producer"] == "crate-decks/0.4.1"


def test_put_reports_a_stronger_server_analysis_it_keeps(pg_db, test_app) -> None:
    del pg_db
    track_id, uid = _track("decks-stems-stronger")
    server = StemAnalysis.model_validate(
        _payload(
            producer="crate-server/2026.11.8",
            separator={
                "model": "htdemucs_ft",
                "version": "htdemucs_ft-onnx-1",
                "sources": list(STEM_SOURCES),
            },
        )
    )
    upsert_stem_analysis(track_id, server, producer_kind="server")

    response = test_app.put(_url(uid), json=_payload())

    assert response.json() == {"result": "kept_stronger"}
    assert test_app.get(_url(uid)).json()["producer"] == "crate-server/2026.11.8"
    assert _stored_decks_rows(track_id) == []


def test_uploads_can_be_turned_off_by_an_admin(pg_db, test_app) -> None:
    del pg_db
    from crate.api.settings import _get_smart_mix_settings

    track_id, uid = _track("decks-stems-switch")
    assert _get_smart_mix_settings()["stem_uploads_enabled"] is True

    off = test_app.put("/api/settings/smart-mix", json={"stem_uploads_enabled": False})
    assert off.status_code == 200
    assert _get_smart_mix_settings()["stem_uploads_enabled"] is False

    response = test_app.put(_url(uid), json=_payload())
    assert response.status_code == 403
    assert get_stem_analyses([track_id]) == {track_id: []}
    decks = test_app.get("/api/capabilities").json()["decks"]
    assert "stem_upload" not in decks["features"]
    # Reads keep working while uploads are off.
    assert test_app.get(_url(uid)).status_code == 404

    test_app.put("/api/settings/smart-mix", json={"stem_uploads_enabled": True})
    assert test_app.put(_url(uid), json=_payload()).json() == {"result": "stored"}


@pytest.mark.parametrize(
    "changes",
    [
        # A Decks client cannot pass its analysis off as the server's.
        {"producer": "crate-server/2026.11.8"},
        {"schema": "stem-analysis/2"},
        {"audio": "UklGRg=="},
        # Levels longer than the track itself.
        {"durationMs": 40_000, "windows": 160},
    ],
)
def test_put_rejects_documents_the_server_does_not_accept(
    pg_db, test_app, changes: dict
) -> None:
    del pg_db
    track_id, uid = _track("decks-stems-invalid")

    response = test_app.put(_url(uid), json=_payload(**changes))

    assert response.status_code == 422
    assert get_stem_analyses([track_id]) == {track_id: []}


def test_put_rejects_a_body_that_is_not_json(pg_db, test_app) -> None:
    del pg_db
    _track_id, uid = _track("decks-stems-not-json")

    response = test_app.put(
        _url(uid), content=b"{", headers={"content-type": "application/json"}
    )

    assert response.status_code == 422


def test_get_answers_404_without_a_current_analysis(pg_db, test_app) -> None:
    del pg_db
    track_id, uid = _track("decks-stems-none")
    assert test_app.get(_url(uid)).status_code == 404

    assert test_app.put(_url(uid), json=_payload()).status_code == 200
    mark_track_mix_source_revision(track_id, OTHER_REVISION)

    # The stored analysis described the old file.
    assert test_app.get(_url(uid)).status_code == 404


def test_the_full_profile_carries_the_stems_layer(pg_db, test_app) -> None:
    del pg_db
    _track_id, uid = _track("decks-stems-profile")
    profile_url = f"/api/tracks/by-entity/{uid}/mix-profile"
    assert "stems" not in test_app.get(profile_url, params={"detail": "full"}).json()

    test_app.put(_url(uid), json=_payload())
    full = test_app.get(profile_url, params={"detail": "full"}).json()
    summary = test_app.get(profile_url).json()

    def present(stem: str, level: int, loudest: int) -> bool:
        return stem_present(level, loudest, STEM_PRESENCE_CUTS[stem])

    assert full["stems"] == {
        "producer": "crate-decks/0.4.0",
        "separatorModel": "htdemucs",
        "separatorVersion": "htdemucs-onnx-1",
        "vocalDetector": "stem-vocals-1",
        "phrases": [
            {
                "startMs": 500,
                "endMs": 16_500,
                "drums": 200,
                "bass": 20,
                "other": 30,
                "vocals": 0,
                "vocalPresent": present("vocals", 0, 180),
                "bassPresent": present("bass", 20, 120),
                "drumsPresent": present("drums", 200, 200),
            },
            {
                "startMs": 16_500,
                "endMs": 32_000,
                "drums": 200,
                "bass": 120,
                "other": 30,
                "vocals": 180,
                "vocalPresent": present("vocals", 180, 180),
                "bassPresent": present("bass", 120, 120),
                "drumsPresent": present("drums", 200, 200),
            },
        ],
    }
    # The read plane serves the summary natively, so it keeps its shape.
    assert "stems" not in summary
    assert set(full) - {"stems", "beatGridMs"} == set(summary)


def test_reads_and_writes_stay_within_three_queries(pg_db, test_app) -> None:
    del pg_db
    from crate.db.engine import get_engine

    _track_id, uid = _track("decks-stems-queries")
    statements: list[str] = []

    def capture(_conn, _cursor, statement, *_args) -> None:
        statements.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        assert test_app.put(_url(uid), json=_payload()).status_code == 200
        put_statements = list(statements)
        statements.clear()
        assert test_app.get(_url(uid)).status_code == 200
        get_statements = list(statements)
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    assert len(put_statements) <= 3, put_statements
    assert len(get_statements) <= 1, get_statements
