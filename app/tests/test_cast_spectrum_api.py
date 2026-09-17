from __future__ import annotations


def _track() -> dict:
    return {
        "id": 7,
        "entity_uid": "22222222-2222-2222-2222-222222222222",
        "path": "Artist/Album/track.flac",
        "title": "Track",
        "artist": "Artist",
        "album": "Album",
        "duration": 185.5,
        "format": "flac",
    }


def _session() -> dict:
    return {
        "session_id": "11111111-1111-1111-1111-111111111111",
        "user_id": 1,
        "receiver_capabilities": {},
        "appearance": {},
        "queue": [
            {
                "item_id": "item-1",
                "track_id": 7,
                "track_path": "Artist/Album/track.flac",
            }
        ],
        "current_index": 0,
        "current_time": 0,
        "repeat_mode": "off",
        "shuffle": False,
        "revision": 0,
        "state_seq": 0,
    }


def _prepare(tmp_path, monkeypatch, artifact: dict) -> None:
    source = tmp_path / "track.flac"
    source.write_bytes(b"audio-source")
    monkeypatch.setattr("crate.api.cast.touch_cast_session", lambda _lease: _session())
    monkeypatch.setattr(
        "crate.api.cast.get_track_delivery_row_by_id", lambda _track_id: _track()
    )
    monkeypatch.setattr("crate.api.cast.resolve_source_path", lambda _track: source)
    monkeypatch.setattr(
        "crate.api.cast.source_fingerprint", lambda _track, _source: "a" * 64
    )
    monkeypatch.setattr(
        "crate.api.cast.ensure_cast_spectrum_request",
        lambda _track_id, _fingerprint: dict(artifact),
    )


def test_cast_spectrum_api_requeues_ready_metadata_when_file_is_missing(
    tmp_path, test_app, monkeypatch
):
    _prepare(
        tmp_path,
        monkeypatch,
        {
            "status": "ready",
            "artifact_path": "cast-spectrum/aa/missing.crsp.gz",
            "artifact_etag": "etag",
            "should_enqueue": False,
        },
    )
    missing = tmp_path / "missing.crsp.gz"
    marked: list[tuple[int, str]] = []
    queued: list[tuple[str, str]] = []
    monkeypatch.setattr("crate.api.cast.resolve_data_file", lambda _path: missing)
    monkeypatch.setattr(
        "crate.api.cast.mark_cast_spectrum_missing",
        lambda track_id, fingerprint: marked.append((track_id, fingerprint)) or True,
    )
    monkeypatch.setattr(
        "crate.api.cast.create_task_dedup",
        lambda task_type, _params, dedup_key: (
            queued.append((task_type, dedup_key)) or "task-1"
        ),
    )

    response = test_app.get("/api/cast/sessions/opaque-lease/items/item-1/spectrum")

    assert response.status_code == 202
    assert marked == [(7, "a" * 64)]
    assert queued == [("generate_cast_spectrum", f"7:{'a' * 64}")]


def test_cast_spectrum_api_does_not_loop_terminal_failure(
    tmp_path, test_app, monkeypatch
):
    _prepare(
        tmp_path,
        monkeypatch,
        {"status": "failed", "should_enqueue": False},
    )
    monkeypatch.setattr(
        "crate.api.cast.create_task_dedup",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("terminal failure must not be requeued")
        ),
    )

    response = test_app.get("/api/cast/sessions/opaque-lease/items/item-1/spectrum")

    assert response.status_code == 404
    assert response.json()["detail"] == "Spectrum artefact unavailable"
