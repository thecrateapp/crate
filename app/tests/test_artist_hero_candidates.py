from __future__ import annotations

import io

from PIL import Image


def _image_bytes(size: tuple[int, int]) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color=(35, 80, 110)).save(buffer, "JPEG")
    return buffer.getvalue()


def test_candidate_scoring_distinguishes_desktop_and_mobile_fit():
    from crate.artist_hero_candidates import score_candidate

    landscape = score_candidate(2400, 1000)
    portrait = score_candidate(1200, 1600)

    assert landscape.desktop.score > landscape.mobile.score
    assert portrait.mobile.score > portrait.desktop.score
    assert landscape.desktop.label in {"excellent", "good"}
    assert portrait.mobile.label in {"excellent", "good"}


def test_candidate_tokens_are_signed_and_tamper_evident(monkeypatch):
    from crate.artist_hero_candidates import (
        decode_candidate_token,
        encode_candidate_token,
    )

    monkeypatch.setattr(
        "crate.artist_hero_candidates._candidate_secret", lambda: "test-secret"
    )
    token = encode_candidate_token(
        artist_id=7,
        origin="fanart-background",
        reference="https://assets.fanart.tv/example.jpg",
    )

    decoded = decode_candidate_token(token, expected_artist_id=7)

    assert decoded["reference"] == "https://assets.fanart.tv/example.jpg"
    assert decode_candidate_token(token + "broken", expected_artist_id=7) is None
    assert decode_candidate_token(token, expected_artist_id=8) is None


def _streaming_response(raw):
    """A requests response over ``raw``, a stub of urllib3's stream."""

    class Response:
        headers = {"content-type": "image/jpeg"}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def raise_for_status(self):
            return None

        def iter_content(self, *, chunk_size):
            # Like urllib3, a chunk only comes back once chunk_size bytes arrived.
            while True:
                received = 0
                while received < chunk_size:
                    piece = raw.read1(chunk_size - received)
                    if not piece:
                        break
                    received += len(piece)
                if not received:
                    return
                yield b"x" * received

    response = Response()
    response.raw = raw
    return response


def test_remote_candidate_stops_streaming_after_size_limit(monkeypatch):
    from crate import artist_hero_candidates as hero

    class Raw:
        left = hero._MAX_BYTES + 1

        def read1(self, amt=None, decode_content=None):
            size = min(amt or self.left, self.left, 1024 * 1024)
            self.left -= size
            return b"x" * size

    monkeypatch.setattr(
        hero.requests, "get", lambda *args, **kwargs: _streaming_response(Raw())
    )

    assert hero._download_remote_candidate("https://example.test/large.jpg") is None


def test_remote_candidate_stops_streaming_after_its_time_budget(monkeypatch):
    # A server that sends a byte every 11 s never trips the read timeout, so only
    # a deadline checked after every socket read keeps the ai task's time for the
    # model call.
    from crate import artist_hero_candidates as hero

    clock = {"now": 100.0}

    class Raw:
        def read1(self, amt=None, decode_content=None):
            clock["now"] += hero._READ_TIMEOUT_SECONDS - 1
            return b"x"

    monkeypatch.setattr(hero.time, "monotonic", lambda: clock["now"])
    monkeypatch.setattr(
        hero.requests, "get", lambda *args, **kwargs: _streaming_response(Raw())
    )

    assert hero._download_remote_candidate("https://example.test/slow.jpg") is None
    elapsed = clock["now"] - 100.0
    assert elapsed <= hero._DOWNLOAD_BUDGET_SECONDS + hero._READ_TIMEOUT_SECONDS


def test_discovery_returns_all_valid_sources_with_same_origin_previews(
    monkeypatch, tmp_path
):
    from crate.artist_hero_candidates import discover_artist_hero_candidates

    artist_dir = tmp_path / "Converge"
    artist_dir.mkdir()
    (artist_dir / "background.jpg").write_bytes(_image_bytes((2400, 1000)))
    monkeypatch.setattr(
        "crate.artist_hero_candidates.get_fanart_all_images",
        lambda _name: {
            "backgrounds": ["https://assets.fanart.tv/one.jpg"],
            "thumbs": ["https://assets.fanart.tv/two.jpg"],
        },
    )
    monkeypatch.setattr(
        "crate.artist_hero_candidates._download_remote_candidate",
        lambda url: (
            _image_bytes((2400, 1000))
            if url.endswith("one.jpg")
            else _image_bytes((1200, 1600))
        ),
    )
    monkeypatch.setattr(
        "crate.artist_hero_candidates._candidate_secret", lambda: "test-secret"
    )

    candidates = discover_artist_hero_candidates(
        artist_id=7, artist_name="Converge", artist_dir=artist_dir
    )

    assert len(candidates) == 3
    assert {candidate.origin for candidate in candidates} == {
        "local-background",
        "fanart-background",
        "fanart-thumb",
    }
    assert all(
        candidate.preview_url.startswith("/api/artwork/artists/7/")
        for candidate in candidates
    )
    assert candidates[0].desktop.score >= candidates[-1].desktop.score


def test_visual_analysis_keeps_the_closed_error_code(monkeypatch):
    # The analysis runs in an ai task, which reports the code; no silent None.
    import pytest

    from crate.ai.contracts import AIConfigurationError
    from crate.artist_hero_candidates import analyze_candidate_image

    def refuse(*args, **kwargs):
        raise AIConfigurationError(
            "AI_ACTION_NEEDS_IMAGE", "Action requires image input"
        )

    monkeypatch.setattr("crate.artist_hero_candidates.ask_image_structured", refuse)

    with pytest.raises(AIConfigurationError) as error:
        analyze_candidate_image(
            _image_bytes((2400, 1000)),
            ai_call={"context": {}, "actor_id": 1, "job_id": "job"},
        )
    assert error.value.code == "AI_ACTION_NEEDS_IMAGE"


def test_candidate_fingerprint_ignores_the_token_expiry():
    from crate.artist_hero_candidates import candidate_fingerprint

    photo = {"origin": "local-photo", "reference": "artist.jpg", "expires_at": 1}
    later = {**photo, "expires_at": 2}
    background = {**photo, "origin": "local-background"}

    assert candidate_fingerprint(photo) == candidate_fingerprint(later)
    assert candidate_fingerprint(photo) != candidate_fingerprint(background)


def test_candidate_catalog_endpoint_returns_ranked_candidates(test_app, tmp_path):
    from unittest.mock import patch

    artist_dir = tmp_path / "Converge"
    artist_dir.mkdir()
    with (
        patch("crate.api.artwork.artist_name_from_id", return_value="Converge"),
        patch(
            "crate.api.artwork.get_library_artist",
            return_value={"id": 7, "name": "Converge", "folder_name": "Converge"},
        ),
        patch("crate.api.artwork.library_path", return_value=tmp_path),
        patch(
            "crate.api.artwork.discover_artist_hero_candidates",
            return_value=[],
        ) as discover,
    ):
        response = test_app.get("/api/artwork/artists/7/hero-candidates")

    assert response.status_code == 200
    assert response.json() == {"candidates": []}
    discover.assert_called_once()


def test_gemini_image_structured_request_includes_inline_image(monkeypatch):
    from pydantic import BaseModel

    from crate.llm.provider import ask_image_structured

    class Result(BaseModel):
        score: int

    captured: dict = {}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"candidates": [{"content": {"parts": [{"text": '{"score": 91}'}]}}]}

    def post(url, **kwargs):
        captured.update(kwargs["json"])
        return Response()

    monkeypatch.setattr("crate.llm.provider.get_provider_api_key", lambda _p: "key")
    monkeypatch.setattr("crate.llm.provider.requests.post", post)

    result = ask_image_structured(
        Result,
        "Score this image",
        image=_image_bytes((100, 100)),
        media_type="image/jpeg",
        model="gemini/gemini-2.5-flash",
    )

    parts = captured["contents"][0]["parts"]
    assert result.score == 91
    assert any("inlineData" in part for part in parts)
