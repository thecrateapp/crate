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


def test_remote_candidate_stops_streaming_after_size_limit(monkeypatch):
    from crate.artist_hero_candidates import _MAX_BYTES, _download_remote_candidate

    class Response:
        headers = {"content-type": "image/jpeg"}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def raise_for_status(self):
            return None

        def iter_content(self, *, chunk_size):
            assert chunk_size == 1024 * 1024
            yield b"x" * (_MAX_BYTES // 2)
            yield b"x" * (_MAX_BYTES // 2 + 1)

    monkeypatch.setattr(
        "crate.artist_hero_candidates.requests.get", lambda *args, **kwargs: Response()
    )

    assert _download_remote_candidate("https://example.test/large.jpg") is None


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


def test_visual_analysis_falls_back_without_a_vision_capable_model(monkeypatch):
    from crate.artist_hero_candidates import analyze_candidate_image

    monkeypatch.setattr(
        "crate.artist_hero_candidates.ask_image_structured",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("unsupported")),
    )

    assert analyze_candidate_image(_image_bytes((2400, 1000))) is None


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
