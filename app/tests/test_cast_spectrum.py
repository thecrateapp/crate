from __future__ import annotations

import gzip
import io
import os
from unittest.mock import ANY

import numpy as np
import pytest
from sqlalchemy import text


def test_cast_spectrum_envelope_round_trips_fixed_contract():
    from crate.cast_spectrum import (
        BAND_COUNT,
        FORMAT_VERSION,
        NORMALIZATION_FLOOR_DB,
        SAMPLE_INTERVAL_MS,
        decode_spectrum,
        encode_spectrum,
    )

    frames = np.arange(BAND_COUNT * 3, dtype=np.uint8).reshape(3, BAND_COUNT)

    payload = encode_spectrum(frames, duration_ms=275)
    decoded = decode_spectrum(payload)

    assert decoded.version == FORMAT_VERSION
    assert decoded.band_count == BAND_COUNT
    assert decoded.sample_interval_ms == SAMPLE_INTERVAL_MS
    assert decoded.normalization_floor_db == NORMALIZATION_FLOOR_DB
    assert decoded.frame_count == 3
    assert decoded.duration_ms == 275
    assert decoded.frames == frames.tobytes()


@pytest.mark.parametrize(
    "mutate",
    [
        lambda payload: b"NOPE" + payload[4:],
        lambda payload: payload[:4] + bytes([99]) + payload[5:],
        lambda payload: payload[:-1],
        lambda payload: payload + b"unexpected",
    ],
)
def test_cast_spectrum_envelope_rejects_invalid_or_unbounded_payload(mutate):
    from crate.cast_spectrum import BAND_COUNT, decode_spectrum, encode_spectrum

    payload = encode_spectrum(
        np.zeros((2, BAND_COUNT), dtype=np.uint8), duration_ms=200
    )

    with pytest.raises(ValueError):
        decode_spectrum(mutate(payload))


def test_cast_spectrum_analysis_has_24_bounded_bands_and_tracks_tone():
    from crate.cast_spectrum import BAND_COUNT, SAMPLE_RATE, analyse_pcm

    seconds = 0.3
    timeline = np.arange(int(SAMPLE_RATE * seconds), dtype=np.float32) / SAMPLE_RATE
    samples = (0.75 * np.sin(2 * np.pi * 1000 * timeline)).astype(np.float32)

    frames = analyse_pcm(samples)

    assert frames.shape == (3, BAND_COUNT)
    assert frames.dtype == np.uint8
    assert int(frames.min()) >= 0
    assert int(frames.max()) <= 255
    assert int(frames[:, 10:18].max()) > int(frames[:, :4].max())


def test_cast_spectrum_fingerprint_changes_with_source_revision(tmp_path):
    from crate.cast_spectrum import source_fingerprint

    source = tmp_path / "track.flac"
    source.write_bytes(b"first")
    track = {"id": 7, "entity_uid": "track-uid", "path": "/music/track.flac"}

    first = source_fingerprint(track, source)
    source.write_bytes(b"second revision")
    os.utime(source, ns=(source.stat().st_atime_ns, source.stat().st_mtime_ns + 1))
    second = source_fingerprint(track, source)

    assert len(first) == 64
    assert first != second


def test_cast_spectrum_artifact_path_and_gzip_are_deterministic(tmp_path):
    from crate.cast_spectrum import (
        BAND_COUNT,
        decode_spectrum,
        spectrum_artifact_relative_path,
        write_spectrum_artifact,
    )

    fingerprint = "a" * 64
    relative = spectrum_artifact_relative_path(fingerprint)
    destination = tmp_path / relative
    frames = np.full((2, BAND_COUNT), 42, dtype=np.uint8)

    result = write_spectrum_artifact(destination, frames, duration_ms=200)
    first_bytes = destination.read_bytes()
    second = write_spectrum_artifact(destination, frames, duration_ms=200)

    assert relative.as_posix() == f"cast-spectrum/aa/{fingerprint}.crsp.gz"
    assert destination.read_bytes() == first_bytes
    assert result.etag == second.etag
    assert result.byte_size == len(first_bytes)
    assert decode_spectrum(gzip.decompress(first_bytes)).frame_count == 2


def test_cast_spectrum_stream_extraction_is_bounded_and_cancellable():
    from crate.cast_spectrum import (
        BAND_COUNT,
        SAMPLE_RATE,
        SpectrumGenerationCancelled,
        analyse_pcm_stream,
    )

    samples = np.zeros(SAMPLE_RATE // 5, dtype=np.float32)
    frames, duration_ms = analyse_pcm_stream(io.BytesIO(samples.tobytes()))

    assert frames.shape == (2, BAND_COUNT)
    assert duration_ms == 200

    with pytest.raises(SpectrumGenerationCancelled):
        analyse_pcm_stream(
            io.BytesIO(samples.tobytes()),
            cancelled=lambda: True,
        )


def test_generate_cast_spectrum_streams_ffmpeg_into_atomic_artifact(tmp_path):
    from crate.cast_spectrum import (
        SAMPLE_RATE,
        decode_spectrum,
        generate_spectrum_artifact,
    )

    source = tmp_path / "source.flac"
    source.write_bytes(b"source")
    destination = tmp_path / "spectrum.crsp.gz"
    timeline = np.arange(SAMPLE_RATE // 5, dtype=np.float32) / SAMPLE_RATE
    pcm = np.sin(2 * np.pi * 440 * timeline).astype(np.float32).tobytes()

    class FakeProcess:
        def __init__(self):
            self.stdout = io.BytesIO(pcm)
            self.stderr = io.BytesIO()
            self.returncode = None

        def wait(self, timeout=None):
            self.returncode = 0
            return 0

        def terminate(self):
            self.returncode = -15

        def kill(self):
            self.returncode = -9

    process = FakeProcess()
    commands: list[list[str]] = []

    def popen(command, **_kwargs):
        commands.append(command)
        return process

    result = generate_spectrum_artifact(
        source,
        destination,
        popen_factory=popen,
    )

    assert commands[0][-2:] == ["f32le", "pipe:1"]
    assert result.frame_count == 2
    assert result.duration_ms == 200
    assert decode_spectrum(gzip.decompress(destination.read_bytes())).frame_count == 2


def _insert_track() -> int:
    from crate.db.tx import transaction_scope

    with transaction_scope() as session:
        session.execute(
            text("INSERT INTO library_artists (name) VALUES ('Cast Spectrum Artist')")
        )
        album_id = session.execute(
            text(
                """
                INSERT INTO library_albums (artist, name, path)
                VALUES ('Cast Spectrum Artist', 'Album', '/music/cast-spectrum/album')
                RETURNING id
                """
            )
        ).scalar_one()
        return int(
            session.execute(
                text(
                    """
                    INSERT INTO library_tracks
                        (album_id, artist, album, filename, title, path)
                    VALUES
                        (:album_id, 'Cast Spectrum Artist', 'Album',
                         'track.flac', 'Track', '/music/cast-spectrum/album/track.flac')
                    RETURNING id
                    """
                ),
                {"album_id": album_id},
            ).scalar_one()
        )


def test_cast_spectrum_repository_claims_and_completes_matching_generation(pg_db):
    from crate.db.repositories.cast_spectrum import (
        claim_cast_spectrum_generation,
        complete_cast_spectrum_generation,
        ensure_cast_spectrum_request,
        get_cast_spectrum_artifact,
    )

    track_id = _insert_track()
    fingerprint = "a" * 64

    pending = ensure_cast_spectrum_request(track_id, fingerprint)
    claim = claim_cast_spectrum_generation(track_id, fingerprint)
    duplicate_claim = claim_cast_spectrum_generation(track_id, fingerprint)
    wrong_completion = complete_cast_spectrum_generation(
        track_id,
        fingerprint,
        "wrong-token",
        artifact_path="cast-spectrum/aa/file.crsp.gz",
        artifact_etag="etag",
        frame_count=20,
        duration_ms=2_000,
        byte_size=240,
    )
    completed = complete_cast_spectrum_generation(
        track_id,
        fingerprint,
        claim["generation_token"],
        artifact_path="cast-spectrum/aa/file.crsp.gz",
        artifact_etag="etag",
        frame_count=20,
        duration_ms=2_000,
        byte_size=240,
    )

    assert pending["status"] == "pending"
    assert pending["should_enqueue"] is True
    assert claim["status"] == "generating"
    assert duplicate_claim is None
    assert wrong_completion is False
    assert completed is True
    assert get_cast_spectrum_artifact(track_id) == {
        "track_id": track_id,
        "source_fingerprint": fingerprint,
        "format_version": 1,
        "status": "ready",
        "generation_token": None,
        "artifact_path": "cast-spectrum/aa/file.crsp.gz",
        "artifact_etag": "etag",
        "sample_interval_ms": 100,
        "band_count": 24,
        "frame_count": 20,
        "duration_ms": 2_000,
        "byte_size": 240,
        "failure_count": 0,
        "last_error": None,
        "claimed_at": None,
        "created_at": ANY,
        "updated_at": ANY,
    }


def test_cast_spectrum_repository_resets_stale_source_and_releases_cancelled_claim(
    pg_db,
):
    from crate.db.repositories.cast_spectrum import (
        claim_cast_spectrum_generation,
        ensure_cast_spectrum_request,
        release_cast_spectrum_generation,
    )

    track_id = _insert_track()
    ensure_cast_spectrum_request(track_id, "a" * 64)
    first_claim = claim_cast_spectrum_generation(track_id, "a" * 64)

    stale = ensure_cast_spectrum_request(track_id, "b" * 64)
    second_claim = claim_cast_spectrum_generation(track_id, "b" * 64)
    released = release_cast_spectrum_generation(
        track_id, "b" * 64, second_claim["generation_token"]
    )
    pending_again = ensure_cast_spectrum_request(track_id, "b" * 64)

    assert first_claim is not None
    assert stale["status"] == "pending"
    assert stale["should_enqueue"] is True
    assert released is True
    assert pending_again["status"] == "pending"
    assert pending_again["should_enqueue"] is True


def test_cast_spectrum_repository_allows_same_owner_to_resume_and_marks_failures(
    pg_db,
):
    from crate.db.repositories.cast_spectrum import (
        claim_cast_spectrum_generation,
        ensure_cast_spectrum_request,
        fail_cast_spectrum_generation,
        get_cast_spectrum_artifact,
    )

    track_id = _insert_track()
    fingerprint = "c" * 64
    owner_token = "11111111-1111-1111-1111-111111111111"
    ensure_cast_spectrum_request(track_id, fingerprint)

    first = claim_cast_spectrum_generation(
        track_id, fingerprint, generation_token=owner_token
    )
    resumed = claim_cast_spectrum_generation(
        track_id, fingerprint, generation_token=owner_token
    )
    failed = fail_cast_spectrum_generation(
        track_id, fingerprint, owner_token, "decoder failed"
    )

    assert first["generation_token"] == owner_token
    assert resumed["generation_token"] == owner_token
    assert failed is True
    artifact = get_cast_spectrum_artifact(track_id)
    assert artifact["status"] == "failed"
    assert artifact["failure_count"] == 1
    assert artifact["last_error"] == "decoder failed"
    assert (
        ensure_cast_spectrum_request(track_id, fingerprint)["should_enqueue"] is False
    )


def test_cast_spectrum_worker_completes_only_its_fenced_claim(tmp_path, monkeypatch):
    from crate.cast_spectrum import SpectrumWriteResult
    from crate.worker_handlers import cast_spectrum as handler

    source = tmp_path / "source.flac"
    source.write_bytes(b"audio")
    completed: list[dict] = []
    monkeypatch.setattr(
        handler, "get_track_delivery_row_by_id", lambda _track_id: {"id": 7}
    )
    monkeypatch.setattr(handler, "resolve_source_path", lambda _track: source)
    monkeypatch.setattr(handler, "source_fingerprint", lambda _track, _source: "a" * 64)
    monkeypatch.setattr(
        handler,
        "claim_cast_spectrum_generation",
        lambda _track_id, _fingerprint, **_kwargs: {"generation_token": "claim-token"},
    )
    monkeypatch.setattr(handler, "data_root", lambda: tmp_path)
    monkeypatch.setattr(handler, "is_cancelled", lambda _task_id: False)
    monkeypatch.setattr(
        handler,
        "generate_spectrum_artifact",
        lambda _source, destination, **_kwargs: (
            destination.parent.mkdir(parents=True, exist_ok=True),
            destination.write_bytes(b"artifact"),
            SpectrumWriteResult(
                etag="etag",
                byte_size=8,
                frame_count=2,
                duration_ms=200,
            ),
        )[-1],
    )
    monkeypatch.setattr(
        handler,
        "complete_cast_spectrum_generation",
        lambda *_args, **kwargs: completed.append(kwargs) or True,
    )

    result = handler._handle_generate_cast_spectrum(
        "task-1",
        {"track_id": 7, "source_fingerprint": "a" * 64},
        {},
    )

    assert result["status"] == "ready"
    assert result["frame_count"] == 2
    assert completed[0]["artifact_etag"] == "etag"
    assert completed[0]["artifact_path"].startswith("cast-spectrum/aa/")


def test_cast_spectrum_worker_releases_claim_when_cancelled(tmp_path, monkeypatch):
    from crate.cast_spectrum import SpectrumGenerationCancelled
    from crate.worker_handlers import cast_spectrum as handler

    source = tmp_path / "source.flac"
    source.write_bytes(b"audio")
    released: list[tuple] = []
    monkeypatch.setattr(
        handler, "get_track_delivery_row_by_id", lambda _track_id: {"id": 7}
    )
    monkeypatch.setattr(handler, "resolve_source_path", lambda _track: source)
    monkeypatch.setattr(handler, "source_fingerprint", lambda _track, _source: "a" * 64)
    monkeypatch.setattr(
        handler,
        "claim_cast_spectrum_generation",
        lambda _track_id, _fingerprint, **_kwargs: {"generation_token": "claim-token"},
    )
    monkeypatch.setattr(handler, "data_root", lambda: tmp_path)
    monkeypatch.setattr(handler, "is_cancelled", lambda _task_id: False)
    monkeypatch.setattr(
        handler,
        "generate_spectrum_artifact",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(SpectrumGenerationCancelled()),
    )
    monkeypatch.setattr(
        handler,
        "release_cast_spectrum_generation",
        lambda *args: released.append(args) or True,
    )

    result = handler._handle_generate_cast_spectrum(
        "task-1",
        {"track_id": 7, "source_fingerprint": "a" * 64},
        {},
    )

    assert result == {"status": "cancelled"}
    assert released == [(7, "a" * 64, "claim-token")]


def test_cast_spectrum_worker_fences_failure_for_retry(tmp_path, monkeypatch):
    from crate.worker_handlers import cast_spectrum as handler

    source = tmp_path / "source.flac"
    source.write_bytes(b"audio")
    failed: list[tuple] = []
    monkeypatch.setattr(
        handler, "get_track_delivery_row_by_id", lambda _track_id: {"id": 7}
    )
    monkeypatch.setattr(handler, "resolve_source_path", lambda _track: source)
    monkeypatch.setattr(handler, "source_fingerprint", lambda _track, _source: "a" * 64)
    monkeypatch.setattr(
        handler,
        "claim_cast_spectrum_generation",
        lambda _track_id, _fingerprint, **_kwargs: {
            "generation_token": "11111111-1111-1111-1111-111111111111"
        },
    )
    monkeypatch.setattr(handler, "data_root", lambda: tmp_path)
    monkeypatch.setattr(handler, "is_cancelled", lambda _task_id: False)
    monkeypatch.setattr(
        handler,
        "generate_spectrum_artifact",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("decode failed")),
    )
    monkeypatch.setattr(
        handler,
        "fail_cast_spectrum_generation",
        lambda *args: failed.append(args) or True,
    )

    with pytest.raises(RuntimeError, match="decode failed"):
        handler._handle_generate_cast_spectrum(
            "task-1",
            {"track_id": 7, "source_fingerprint": "a" * 64},
            {},
        )

    assert failed == [
        (
            7,
            "a" * 64,
            "11111111-1111-1111-1111-111111111111",
            "decode failed",
        )
    ]
