"""Offline extraction keeps uncertain fields and tour coverage explicit."""

import os
from pathlib import Path
import pytest
from crate.show_ocr import recognize_image, ocr_readiness, parse_show_text

FIXTURES = Path(__file__).parent / "fixtures" / "shows"


def test_real_ocr_offline_reads_tour_without_fabricating_required_fields():
    state = ocr_readiness()
    assert state["available"], state
    assert {"eng", "spa"} <= set(state["languages"])
    result = recognize_image((FIXTURES / "tour.png").read_bytes())
    assert result["engine"].startswith("tesseract 5.")
    assert "2027-03-02" in result["text"]
    parsed = parse_show_text(result["text"], source_ref="upload:fixture")
    assert [c["date"] for c in parsed["candidates"]] == [
        "2027-03-02",
        "2027-03-04",
        "2027-03-06",
    ]
    assert all(
        c.get("artist_name") is None and c.get("local_time") is None
        for c in parsed["candidates"]
    )
    assert parsed["coverage"] == "incomplete"


def test_parser_retains_unknown_year_and_every_date():
    parsed = parse_show_text("2 March - Madrid\n2027-03-02\n2027-03-04\n2027-02-30")
    assert len(parsed["candidates"]) == 3
    assert parsed["candidates"][-1]["date"] is None
    assert parsed["raw_text"].startswith("2 March")
    assert parsed["coverage"] == "incomplete"


def test_ocr_missing_engine_and_language_are_recoverable(monkeypatch):
    monkeypatch.setattr("crate.show_ocr.shutil.which", lambda _: None)
    assert ocr_readiness()["available"] is False
    with pytest.raises(ValueError, match="OCR_UNAVAILABLE"):
        recognize_image((FIXTURES / "flyer.png").read_bytes())


def test_ocr_cancel_timeout_and_invalid_images_do_not_publish():
    with pytest.raises(ValueError, match="CANCELLED"):
        recognize_image((FIXTURES / "flyer.png").read_bytes(), cancelled=lambda: True)
    with pytest.raises(ValueError, match="OCR_TIMEOUT"):
        recognize_image((FIXTURES / "flyer.png").read_bytes(), timeout=0)
    with pytest.raises(ValueError, match="INVALID_IMAGE"):
        recognize_image(b"not an image")
    result = recognize_image((FIXTURES / "illegible.png").read_bytes())
    assert parse_show_text(result["text"])["coverage"] == "incomplete"


def test_real_ocr_subprocess_stops_after_cancellation_or_deadline(monkeypatch):
    from crate import show_ocr

    real = show_ocr.subprocess.Popen
    children = []

    def spawn(*args, **kwargs):
        child = real(*args, **kwargs)
        children.append(child)
        return child

    monkeypatch.setattr(show_ocr.subprocess, "Popen", spawn)
    calls = 0

    def cancelled():
        nonlocal calls
        calls += 1
        return calls > 1

    with pytest.raises(ValueError, match="CANCELLED"):
        recognize_image((FIXTURES / "tour.png").read_bytes(), cancelled=cancelled)
    assert children[-1].returncode is not None
    with pytest.raises(ValueError, match="OCR_TIMEOUT"):
        recognize_image((FIXTURES / "tour.png").read_bytes(), timeout=0.001)
    assert children[-1].returncode is not None


def test_ocr_readiness_distinguishes_missing_languages(monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setattr(
        "crate.show_ocr.subprocess.run",
        lambda args, **kwargs: SimpleNamespace(
            stdout="tesseract 5.5.0\n"
            if "--version" in args
            else "List of available languages (1):\neng\n"
        ),
    )
    state = ocr_readiness()
    assert state["available"] is False
    assert state["reason"] == "OCR_LANGUAGES_OR_VERSION_UNAVAILABLE"


@pytest.mark.skipif(
    os.environ.get("CRATE_TEST_SHOW_LLM_SMOKE") != "1",
    reason="Opt-in configured model smoke; default tests never make a paid call",
)
def test_configured_show_vision_smoke_opt_in(pg_db):
    from crate.show_extraction import extract_show_candidates

    draft = extract_show_candidates(
        {"mode": "vision", "raw_text": ""},
        [
            {
                "id": "synthetic-smoke",
                "sha256": "fixture",
                "content": (FIXTURES / "tour.png").read_bytes(),
            }
        ],
    )
    assert not draft.get("error_code"), draft.get("warnings")
    assert draft["candidates"] and draft["coverage"] == "incomplete"
    assert all("latitude" not in candidate for candidate in draft["candidates"])
