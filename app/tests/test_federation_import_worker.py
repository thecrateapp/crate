from __future__ import annotations

import hashlib
from contextlib import contextmanager

import pytest


class _Response:
    def __init__(self, chunks: list[bytes]):
        self._chunks = chunks

    def raise_for_status(self):
        return None

    def iter_bytes(self, chunk_size: int):
        del chunk_size
        yield from self._chunks


class _Client:
    def __init__(self, chunks: list[bytes]):
        self.chunks = chunks

    @contextmanager
    def stream(self, path: str, *, user_assertion: str):
        assert path.startswith("/api/federation/v1/import-files/")
        assert user_assertion
        yield _Response(self.chunks)


def test_import_assertions_are_scoped_and_refreshed_per_file(monkeypatch):
    from crate.worker_handlers.federation import _build_import_user_assertion

    calls: list[tuple[str, tuple[str, ...]]] = []

    def fake_build(local, peer, user, *, purpose, capabilities):
        assert local == {"node_uid": "local"}
        assert peer == {"node_uid": "remote"}
        assert user == {"id": "user-1", "role": "admin"}
        calls.append((purpose, tuple(capabilities)))
        return f"assertion:{purpose}"

    monkeypatch.setattr(
        "crate.federation.assertions.build_outbound_user_assertion",
        fake_build,
    )

    manifest_assertion = _build_import_user_assertion(
        {"node_uid": "local"},
        {"node_uid": "remote"},
        {"id": "user-1", "role": "admin"},
        purpose="import.manifest",
    )
    first_file_assertion = _build_import_user_assertion(
        {"node_uid": "local"},
        {"node_uid": "remote"},
        {"id": "user-1", "role": "admin"},
        purpose="import.file",
    )
    second_file_assertion = _build_import_user_assertion(
        {"node_uid": "local"},
        {"node_uid": "remote"},
        {"id": "user-1", "role": "admin"},
        purpose="import.file",
    )

    assert manifest_assertion == "assertion:import.manifest"
    assert first_file_assertion == "assertion:import.file"
    assert second_file_assertion == "assertion:import.file"
    assert calls == [
        ("import.manifest", ("federation.import.request",)),
        ("import.file", ("federation.import.request",)),
        ("import.file", ("federation.import.request",)),
    ]


def test_import_client_allows_slow_manifest_generation(monkeypatch):
    from crate.worker_handlers.federation import _build_import_client

    captured: dict = {}

    class FakeClient:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(
        "crate.federation.client.SignedFederationClient",
        FakeClient,
    )

    client = _build_import_client(
        {
            "node_uid": "local",
            "active_key_id": "key-1",
            "private_key_ref": "federation/keys/key-1.pem",
        },
        {"api_base_url": "https://remote.example"},
    )

    assert isinstance(client, FakeClient)
    assert captured["timeout"].connect == 10
    assert captured["timeout"].read == 300


def test_verified_import_download_is_atomic_and_retry_safe(tmp_path):
    from crate.worker_handlers.federation import _download_verified_import_track

    payload = b"verified audio bytes"
    target = tmp_path / "track.flac"
    client = _Client([payload[:5], payload[5:]])

    first = _download_verified_import_track(
        client=client,
        path="/api/federation/v1/import-files/track-1",
        target=target,
        expected_size=len(payload),
        expected_sha256=hashlib.sha256(payload).hexdigest(),
        user_assertion="assertion",
    )
    second = _download_verified_import_track(
        client=_Client([b"should-not-be-read"]),
        path="/api/federation/v1/import-files/track-1",
        target=target,
        expected_size=len(payload),
        expected_sha256=hashlib.sha256(payload).hexdigest(),
        user_assertion="assertion",
    )

    assert first == second == len(payload)
    assert target.read_bytes() == payload
    assert not list(tmp_path.glob("*.part"))


def test_verified_import_download_removes_partial_on_hash_failure(tmp_path):
    from crate.worker_handlers.federation import _download_verified_import_track

    target = tmp_path / "track.flac"
    with pytest.raises(ValueError, match="SHA-256"):
        _download_verified_import_track(
            client=_Client([b"wrong"]),
            path="/api/federation/v1/import-files/track-1",
            target=target,
            expected_size=5,
            expected_sha256="0" * 64,
            user_assertion="assertion",
        )

    assert not target.exists()
    assert not list(tmp_path.glob("*.part"))


def test_verified_import_download_honours_mid_file_cancellation(tmp_path):
    from crate.worker_handlers.federation import _download_verified_import_track

    target = tmp_path / "track.flac"
    checks = iter((False, True))

    with pytest.raises(RuntimeError, match="cancelled"):
        _download_verified_import_track(
            client=_Client([b"first", b"second"]),
            path="/api/federation/v1/import-files/track-1",
            target=target,
            expected_size=11,
            expected_sha256=hashlib.sha256(b"firstsecond").hexdigest(),
            user_assertion="assertion",
            should_cancel=lambda: next(checks, True),
        )

    assert not target.exists()
    assert not list(tmp_path.glob("*.part"))


def test_worker_registry_uses_hardened_federation_import_handler():
    from crate.worker import TASK_HANDLERS
    from crate.worker_handlers.federation import _handle_federation_import

    assert TASK_HANDLERS["federation_import_album"] is _handle_federation_import
