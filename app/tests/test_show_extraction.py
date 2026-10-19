"""Offline extraction keeps uncertain fields and tour coverage explicit."""

import os
from pathlib import Path
import pytest
from crate import show_extraction as extract
from crate.api.schemas.show_imports import ShowCandidate
from crate.show_ocr import recognize_image, ocr_readiness, parse_show_text
from tests.test_show_import_plans import show_world as show_world  # noqa: PLC0414

FIXTURES = Path(__file__).parent / "fixtures" / "shows"


def _ocr_sources(monkeypatch, texts):
    images = [
        {"id": label, "sha256": label * 64, "content": label.encode()}
        for label in texts
    ]

    def recognize(content, **kwargs):
        return {
            "text": texts[content.decode()],
            "truncated": False,
            "engine": "tesseract 5.5.0",
            "languages": ["eng", "spa"],
            "elapsed_seconds": 0.1,
            "extractor": "shows-ocr-v1",
        }

    monkeypatch.setattr(extract, "recognize_image", recognize)
    return images


def _configured_model(monkeypatch, mode, candidates):
    from tests.ai_consumer_fakes import pin_actions

    pin_actions(monkeypatch)
    calls = []

    def ask(*args, **kwargs):
        calls.append((args, kwargs))
        return extract.ExtractedShows(
            candidates=[ShowCandidate.model_validate(row) for row in candidates],
            coverage="complete",
        )

    monkeypatch.setattr(
        extract.provider,
        "ask_image_structured" if mode == "vision" else "ask_structured",
        ask,
    )
    return calls


def test_ocr_candidates_keep_each_attachment_source_and_full_evidence(monkeypatch):
    images = _ocr_sources(
        monkeypatch,
        {"a": "2027-03-02 Madrid", "b": "2027-03-04 Barcelona"},
    )
    draft = extract.extract_show_candidates({"mode": "ocr"}, images)

    assert [
        (row["date"], row["source_ref"], row["evidence"]) for row in draft["candidates"]
    ] == [
        ("2027-03-02", "upload:a", "2027-03-02 Madrid"),
        ("2027-03-04", "upload:b", "2027-03-04 Barcelona"),
    ]
    assert {row["source_ref"]: row["text"] for row in draft["sources"]} == {
        "upload:a": "2027-03-02 Madrid",
        "upload:b": "2027-03-04 Barcelona",
    }
    assert draft["coverage"] == "incomplete"
    assert len({row["item_id"] for row in draft["candidates"]}) == 2


def test_ocr_context_without_dates_does_not_add_an_empty_candidate(monkeypatch):
    images = _ocr_sources(monkeypatch, {"a": "2027-03-02 Madrid"})
    draft = extract.extract_show_candidates(
        {"mode": "ocr", "raw_text": "External Band tour"}, images
    )

    assert len(draft["candidates"]) == 1
    assert draft["candidates"][0]["source_ref"] == "upload:a"
    assert draft["sources"][0]["text"] == "External Band tour"


def test_unread_url_and_whitespace_do_not_send_an_empty_text_model_source(monkeypatch):
    monkeypatch.setattr(
        "crate.show_url_fetch.fetch_worker_source",
        lambda *args, **kwargs: {
            "available": False,
            "text": "",
            "source_ref": "https://events.example/unread",
            "truncated": False,
            "warning": "Source unavailable; upload a screenshot",
        },
    )
    calls = _configured_model(monkeypatch, "text_llm", [])
    with pytest.raises(ValueError, match="TEXT_REQUIRED"):
        extract.extract_show_candidates(
            {
                "mode": "text_llm",
                "raw_text": " \n ",
                "source_url": "https://events.example/unread",
            },
            [],
        )
    assert calls == []


@pytest.mark.parametrize("available", [False, True])
def test_pasted_text_url_and_image_candidates_keep_their_read_sources(
    monkeypatch, available
):
    url = "https://events.example/tour"
    monkeypatch.setattr(
        "crate.show_url_fetch.fetch_worker_source",
        lambda *args, **kwargs: {
            "available": available,
            "text": "2027-03-03 Zaragoza" if available else "",
            "source_ref": url,
            "truncated": False,
            "warning": "Source unavailable; upload a screenshot",
        },
    )
    images = _ocr_sources(monkeypatch, {"b": "2027-03-04 Barcelona"})
    draft = extract.extract_show_candidates(
        {
            "mode": "ocr",
            "raw_text": "2027-03-02 Madrid",
            "source_url": url,
        },
        images,
    )

    expected = [("2027-03-02", "pasted-text")]
    if available:
        expected.append(("2027-03-03", url))
    expected.append(("2027-03-04", "upload:b"))
    assert [(row["date"], row["source_ref"]) for row in draft["candidates"]] == expected
    evidence = {row["source_ref"]: row for row in draft["sources"]}
    assert evidence["pasted-text"]["text"] == "2027-03-02 Madrid"
    assert evidence[url]["read"] is available
    assert evidence[url]["text"] == ("2027-03-03 Zaragoza" if available else "")
    assert evidence["upload:b"]["text"] == "2027-03-04 Barcelona"
    assert draft["coverage"] == "incomplete"


@pytest.mark.parametrize("mode", ["text_llm", "ocr_text_llm", "vision"])
def test_combined_model_sources_use_server_manifest_instead_of_first_source(
    monkeypatch, mode
):
    url = "https://events.example/tour"
    monkeypatch.setattr(
        "crate.show_url_fetch.fetch_worker_source",
        lambda *args, **kwargs: {
            "available": False,
            "text": "",
            "source_ref": url,
            "truncated": False,
            "warning": "Source unavailable; upload a screenshot",
        },
    )
    images = (
        _ocr_sources(monkeypatch, {"b": "2027-03-04 Barcelona"})
        if mode == "ocr_text_llm"
        else []
    )
    if mode == "vision":
        images = [
            {
                "id": "b",
                "sha256": "b" * 64,
                "content": (FIXTURES / "tour.png").read_bytes(),
            }
        ]
    if mode == "text_llm":
        monkeypatch.setattr(
            "crate.show_url_fetch.fetch_worker_source",
            lambda *args, **kwargs: {
                "available": True,
                "text": "2027-03-04 Barcelona",
                "source_ref": url,
                "truncated": False,
            },
        )
    calls = _configured_model(
        monkeypatch,
        mode,
        [
            {
                "item_id": "untrusted-label",
                "date": "2027-03-04",
                "source_ref": "https://unread.example/not-a-source",
                "evidence": "2027-03-04 Barcelona",
                "source_draft_id": "11111111-1111-1111-1111-111111111111",
            }
        ],
    )
    draft = extract.extract_show_candidates(
        {"mode": mode, "raw_text": "2027-03-02 Madrid", "source_url": url},
        images,
    )

    assert len(calls) == 1
    row = draft["candidates"][0]
    assert row["source_ref"].startswith("source-set:sha256:")
    assert row["item_id"] != "untrusted-label" and "source_draft_id" not in row
    manifest = draft["source_sets"][row["source_ref"]]
    assert {item["source_ref"] for item in manifest} == {
        "pasted-text",
        url if mode == "text_llm" else "upload:b",
    }
    assert all(item["read"] for item in manifest)
    assert row["evidence"] == "2027-03-04 Barcelona"
    assert draft["coverage"] == "incomplete"


def test_ocr_sources_share_text_and_candidate_budgets(monkeypatch):
    images = _ocr_sources(
        monkeypatch,
        {
            "a": "\n".join("2027-03-02 Madrid" for _ in range(199)),
            "b": "2027-03-04 Barcelona\n2027-03-06 Valencia",
        },
    )
    draft = extract.extract_show_candidates({"mode": "ocr"}, images)
    assert len(draft["candidates"]) == 200
    assert draft["candidates"][-1]["source_ref"] == "upload:b"
    assert draft["candidates"][-1]["date"] == "2027-03-04"
    assert draft["truncated"] is True

    images = _ocr_sources(monkeypatch, {"a": "x" * 59_990, "b": "2027-03-04"})
    draft = extract.extract_show_candidates({"mode": "ocr"}, images)
    assert len(draft["raw_text"]) <= 60_000
    assert sum(len(row.get("text", "")) for row in draft["sources"]) <= 60_000
    assert draft["truncated"] is True
    assert draft["coverage"] == "incomplete"


def test_ocr_attachment_provenance_survives_review_and_publication(
    show_world, monkeypatch
):
    from sqlalchemy import text
    from crate.db.repositories.show_extraction_jobs import (
        accept_show_extraction,
        stage_show_image,
    )
    from crate.db.repositories.show_imports import read_show_job
    from crate.db.repositories.tasks_updates import start_task
    from crate.db.tx import read_scope
    from crate.worker_handlers.show_imports import handle_show_extraction
    from tests.test_show_import_plans import prepare, apply

    _ocr_sources(
        monkeypatch,
        {"a": "2027-03-02 Madrid", "b": "2027-03-04 Barcelona"},
    )
    recognize = extract.recognize_image
    first_bytes = (FIXTURES / "flyer.png").read_bytes()
    second_bytes = (FIXTURES / "tour.png").read_bytes()
    monkeypatch.setattr(
        extract,
        "recognize_image",
        lambda content, **kwargs: recognize(
            b"a" if content == first_bytes else b"b", **kwargs
        ),
    )
    actor = show_world["principal"]
    uploads = [
        stage_show_image(actor, content) for content in [first_bytes, second_bytes]
    ]
    accepted = accept_show_extraction(
        actor,
        {"mode": "ocr", "upload_ids": [row["upload_id"] for row in uploads]},
        "two-images",
    )
    start_task(accepted["job_id"])
    handle_show_extraction(accepted["job_id"], {}, {})
    result = read_show_job(actor, accepted["job_id"])["result"]
    draft_id = result["execution"]["draft_id"]
    rows = [
        {
            **row,
            "source_draft_id": draft_id,
            "artist_name": "External Band",
            "venue": "Sala Norte",
            "city": city,
            "source_ref": "https://unread.example/fabricated",
            "evidence": "fabricated evidence",
        }
        for row, city in zip(result["draft"]["candidates"], ["Madrid", "Barcelona"])
    ]
    _, plan = prepare(show_world, key="source-review", candidates=rows)
    assert [item["after"]["source_ref"] for item in plan["changes"]] == [
        "upload:" + row["upload_id"] for row in uploads
    ]
    _, saved = apply(show_world, plan, key="source-save")
    assert saved["verification"]["status"] == "passed"
    with read_scope() as db:
        actual = (
            db.execute(
                text("SELECT date::text,field_provenance FROM shows ORDER BY date")
            )
            .mappings()
            .all()
        )
        sources = (
            db.execute(text("SELECT evidence FROM show_sources ORDER BY show_id"))
            .scalars()
            .all()
        )
    assert [row["field_provenance"]["date"]["source_ref"] for row in actual] == [
        "upload:" + row["upload_id"] for row in uploads
    ]
    assert [row["field_provenance"]["date"]["evidence"] for row in actual] == [
        "2027-03-02 Madrid",
        "2027-03-04 Barcelona",
    ]
    assert all(row["candidate"]["source_draft_id"] == draft_id for row in sources)


def test_combined_model_manifest_is_durable_after_private_source_expiration(
    show_world, monkeypatch
):
    from sqlalchemy import text
    from crate.db.repositories.show_extraction_jobs import (
        accept_show_extraction,
        cleanup_expired_show_sources,
        read_show_drafts,
        stage_show_image,
    )
    from crate.db.repositories.show_imports import read_show_job
    from crate.db.repositories.tasks_updates import start_task
    from crate.db.tx import read_scope, transaction_scope
    from crate.worker_handlers.show_imports import handle_show_extraction
    from tests.test_show_import_plans import prepare, apply

    calls = _configured_model(
        monkeypatch,
        "vision",
        [
            {
                "item_id": "temporary-model-label",
                "date": "2027-03-02",
                "evidence": "2027-03-02 Madrid",
                "source_ref": "https://unread.example/not-viewed",
            }
        ],
    )
    actor = show_world["principal"]
    upload = stage_show_image(actor, (FIXTURES / "tour.png").read_bytes())
    accepted = accept_show_extraction(
        actor,
        {
            "mode": "vision",
            "raw_text": "External Band tour",
            "upload_ids": [upload["upload_id"]],
            "expected_model": "test/model",
            "expected_configuration": extract.show_llm_configuration("vision")[
                "configuration_fingerprint"
            ],
        },
        "composite-image",
    )
    start_task(accepted["job_id"])
    handle_show_extraction(accepted["job_id"], {}, {})
    result = read_show_job(actor, accepted["job_id"])["result"]
    original = result["draft"]["candidates"][0]
    assert original["source_ref"].startswith("source-set:sha256:")
    row = {
        **original,
        "artist_name": "External Band",
        "venue": "Sala Norte",
        "city": "Madrid",
        "source_draft_id": result["execution"]["draft_id"],
        "source_ref": "https://unread.example/fabricated",
        "evidence": "fabricated evidence",
    }
    _, plan = prepare(show_world, key="composite-review", candidates=[row])
    _, saved = apply(show_world, plan, key="composite-save")
    assert saved["verification"]["status"] == "passed"
    recorded = read_show_drafts(actor, row["source_draft_id"])["result"]["candidates"]
    assert all("source_manifest" not in candidate for candidate in recorded)
    assert (
        ShowCandidate.model_validate(recorded[0]).source_draft_id
        == row["source_draft_id"]
    )
    with transaction_scope() as db:
        db.execute(
            text(
                "UPDATE show_extraction_drafts SET expires_at=NOW()-INTERVAL '1 second'"
            )
        )
        db.execute(
            text("UPDATE show_image_uploads SET expires_at=NOW()-INTERVAL '1 second'")
        )
    cleanup_expired_show_sources()
    with read_scope() as db:
        source = db.execute(text("SELECT evidence FROM show_sources")).scalar_one()
        provenance = db.execute(text("SELECT field_provenance FROM shows")).scalar_one()
        assert (
            db.execute(text("SELECT count(*) FROM show_extraction_drafts")).scalar_one()
            == 0
        )
        assert (
            db.execute(text("SELECT count(*) FROM show_image_uploads")).scalar_one()
            == 0
        )
    assert len(calls) == 1
    assert source["candidate"]["source_ref"] == original["source_ref"]
    assert provenance["date"]["source_ref"] == original["source_ref"]
    assert provenance["date"]["evidence"] == "2027-03-02 Madrid"
    manifest = source["candidate"]["source_manifest"]
    assert {item["source_ref"] for item in manifest} == {
        "pasted-text",
        "upload:" + upload["upload_id"],
    }
    image = next(item for item in manifest if item["source_ref"].startswith("upload:"))
    assert image["sha256"] == upload["sha256"] and image["modality"] == "image"
    assert all(item["read"] and "text" not in item for item in manifest)


@pytest.mark.parametrize("filenames", [("flyer.png",), ("flyer.png", "tour.png")])
def test_empty_vision_result_keeps_image_provenance_after_manual_publication(
    show_world, monkeypatch, filenames
):
    from sqlalchemy import text
    from crate.db.repositories.show_extraction_jobs import (
        accept_show_extraction,
        stage_show_image,
    )
    from crate.db.repositories.show_imports import read_show_job
    from crate.db.repositories.tasks_updates import start_task
    from crate.db.tx import read_scope
    from crate.worker_handlers.show_imports import handle_show_extraction
    from tests.test_show_import_plans import prepare, apply

    calls = _configured_model(monkeypatch, "vision", [])
    actor = show_world["principal"]
    uploads = [
        stage_show_image(actor, (FIXTURES / name).read_bytes()) for name in filenames
    ]
    accepted = accept_show_extraction(
        actor,
        {
            "mode": "vision",
            "upload_ids": [row["upload_id"] for row in uploads],
            "expected_model": "test/model",
            "expected_configuration": extract.show_llm_configuration("vision")[
                "configuration_fingerprint"
            ],
        },
        "empty-vision-result",
    )
    start_task(accepted["job_id"])
    handle_show_extraction(accepted["job_id"], {}, {})
    result = read_show_job(actor, accepted["job_id"])["result"]
    assert result["execution"]["status"] == "extracted"
    original = result["draft"]["candidates"][0]
    image_refs = {"upload:" + row["upload_id"] for row in uploads}
    if len(uploads) == 1:
        assert original["source_ref"] == "upload:" + uploads[0]["upload_id"]
    else:
        assert original["source_ref"] is not None
        assert original["source_ref"].startswith("source-set:sha256:")
        assert {
            item["source_ref"]
            for item in result["draft"]["source_sets"][original["source_ref"]]
        } == image_refs
    candidate = {
        **original,
        "source_draft_id": result["execution"]["draft_id"],
        "artist_name": "External Band",
        "date": "2027-03-02",
        "venue": "Sala Norte",
        "city": "Madrid",
    }
    _, plan = prepare(show_world, key="empty-vision-review", candidates=[candidate])
    _, saved = apply(show_world, plan, key="empty-vision-save")
    assert saved["verification"]["status"] == "passed"
    with read_scope() as db:
        source = db.execute(text("SELECT evidence FROM show_sources")).scalar_one()
        provenance = db.execute(text("SELECT field_provenance FROM shows")).scalar_one()
    assert len(calls) == 1
    assert provenance["date"]["source_ref"] == original["source_ref"]
    manifest = source["candidate"]["source_manifest"]
    assert {item["source_ref"] for item in manifest} == image_refs
    assert {item["sha256"] for item in manifest} == {row["sha256"] for row in uploads}
    assert all(item["read"] and item["modality"] == "image" for item in manifest)


def test_failed_vision_keeps_unread_image_reference_unknown(monkeypatch):
    _configured_model(monkeypatch, "vision", [])

    def unavailable(*args, **kwargs):
        raise ValueError("Provider unavailable")

    monkeypatch.setattr(extract.provider, "ask_image_structured", unavailable)
    draft = extract.extract_show_candidates(
        {"mode": "vision", "raw_text": ""},
        [
            {
                "id": "a",
                "sha256": "a" * 64,
                "content": (FIXTURES / "flyer.png").read_bytes(),
            }
        ],
    )
    assert draft["error_code"] == "LLM_EXTRACTION_FAILED"
    assert draft["candidates"][0]["source_ref"] is None
    assert all(item["read"] is False for item in draft["sources"])
    assert draft["source_sets"] == {}


@pytest.mark.parametrize("mode", ["vision", "ocr_text_llm"])
def test_empty_model_result_preserves_dates_from_individual_text_sources(
    monkeypatch, mode
):
    images = (
        _ocr_sources(monkeypatch, {"a": "2027-03-04 Barcelona"})
        if mode == "ocr_text_llm"
        else [
            {
                "id": "a",
                "sha256": "a" * 64,
                "content": (FIXTURES / "flyer.png").read_bytes(),
            }
        ]
    )
    calls = _configured_model(monkeypatch, mode, [])
    draft = extract.extract_show_candidates(
        {"mode": mode, "raw_text": "2027-03-02 Madrid"}, images
    )
    expected = [("2027-03-02", "pasted-text")]
    if mode == "ocr_text_llm":
        expected.append(("2027-03-04", "upload:a"))
    assert [(row["date"], row["source_ref"]) for row in draft["candidates"]] == expected
    assert len(calls) == 1


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
