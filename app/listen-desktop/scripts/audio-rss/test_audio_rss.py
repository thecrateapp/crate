from __future__ import annotations

import importlib.util
import sys
import wave
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.request import urlopen

import pytest

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from capture_windows_audio_rss import summarize_bytes
from generate_wav_fixtures import write_wav_fixture

_FIXTURE_SERVER_SPEC = importlib.util.spec_from_file_location(
    "audio_rss_fixture_server", SCRIPT_DIR / "fixture_server.py"
)
assert _FIXTURE_SERVER_SPEC is not None
assert _FIXTURE_SERVER_SPEC.loader is not None
fixture_server = importlib.util.module_from_spec(_FIXTURE_SERVER_SPEC)
sys.modules[_FIXTURE_SERVER_SPEC.name] = fixture_server
_FIXTURE_SERVER_SPEC.loader.exec_module(fixture_server)


def test_wav_fixture_has_requested_pcm_format_and_duration(tmp_path: Path) -> None:
    fixture = tmp_path / "short.wav"

    frames = write_wav_fixture(fixture, duration_seconds=0.25, seed=5)

    with wave.open(str(fixture), "rb") as source:
        assert source.getframerate() == 44_100
        assert source.getnchannels() == 2
        assert source.getsampwidth() == 2
        assert source.getnframes() == frames == 11_025
        assert source.getcomptype() == "NONE"
    assert fixture.stat().st_size == 44 + frames * 2 * 2


@pytest.mark.parametrize(
    ("extension", "content", "expected_type"),
    [
        (".wav", b"RIFF test", "audio/wav"),
        (".flac", b"fLaC test", "audio/flac"),
    ],
)
def test_fixture_server_uses_audio_content_type(
    tmp_path: Path,
    extension: str,
    content: bytes,
    expected_type: str,
) -> None:
    fixture = tmp_path / f"tone{extension}"
    fixture.write_bytes(content)
    report_file = tmp_path / "events.jsonl"
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        fixture_server.make_handler({"tone": fixture}, report_file),
    )
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        with urlopen(f"http://127.0.0.1:{server.server_port}/track/tone") as response:
            assert response.headers["Content-Type"] == expected_type
            assert response.read() == content
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_summarize_bytes_converts_samples_to_mib() -> None:
    summary = summarize_bytes([1_048_576, 2_097_152, 3_145_728])

    assert summary == {"min": 1.0, "median": 2.0, "max": 3.0}
