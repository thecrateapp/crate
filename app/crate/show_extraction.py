"""Worker-only helpers for explicit local OCR or a single configured model call."""

from datetime import UTC, datetime
from html.parser import HTMLParser
from io import BytesIO
import importlib.util
import hashlib
import json
import time
from urllib.parse import urljoin
from uuid import uuid4
from typing import Annotated
from PIL import Image, ImageOps
from pydantic import BaseModel, ConfigDict, Field
from crate.api.schemas.show_imports import ShowCandidate
from crate import artist_bio_research as public_web
from crate.llm import provider
from crate.show_ocr import (
    MAX_PIXELS,
    MAX_TEXT,
    ocr_readiness,
    parse_show_text,
    recognize_image,
)

EXTRACTOR_VERSION = "shows-extraction-v2"


class ExtractedShows(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candidates: Annotated[list[ShowCandidate], Field(max_length=200)]
    coverage: str
    warnings: Annotated[list[str], Field(max_length=20)] = []


class _PageText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript", "svg", "template"}:
            self.hidden += 1
        if tag in {"p", "div", "br", "tr", "li", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg", "template"}:
            self.hidden = max(0, self.hidden - 1)
        if tag in {"p", "div", "tr", "li"}:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def fetch_show_source(url: str, *, cancelled=lambda: False) -> dict:
    current = url
    started = time.monotonic()
    for _ in range(public_web.MAX_PUBLIC_PAGE_REDIRECTS + 1):
        if cancelled():
            raise ValueError("CANCELLED")
        if time.monotonic() - started > 45:
            break
        target = public_web._resolve_public_target(current)
        if not target:
            break
        try:
            status, headers, body = public_web._fetch_public_page(target)
        except Exception:
            break
        if status in {301, 302, 303, 307, 308}:
            location = headers.get("location")
            if not location:
                break
            current = urljoin(target.url, location)
            continue
        if status != 200 or not headers.get("content-type", "").lower().startswith(
            ("text/html", "text/plain")
        ):
            break
        parser = _PageText()
        parser.feed(body)
        content = "\n".join(
            line.strip() for line in "".join(parser.parts).splitlines() if line.strip()
        )
        if not content or any(
            phrase in content.lower()
            for phrase in (
                "log in to instagram",
                "login to continue",
                "enable javascript",
                "captcha",
            )
        ):
            break
        return {
            "available": True,
            "text": content[:MAX_TEXT],
            "source_ref": url,
            "truncated": len(content) > MAX_TEXT or len(body) >= 250000,
        }
    return {
        "available": False,
        "text": "",
        "source_ref": url,
        "truncated": False,
        "warning": "Source could not be read. Upload a screenshot or paste the visible text; no cookies or private login are used.",
    }


def _configuration(config: dict) -> dict:
    name = config["provider"]
    native = name in {"ollama", "ollama_chat", "gemini"}
    installed = native or importlib.util.find_spec("litellm") is not None
    configured = name in {"ollama", "ollama_chat"} or bool(
        provider.get_provider_api_key(name)
    )
    return {
        "model": config["model"],
        "provider": name,
        "configured": configured,
        "connectivity": "not_checked",
        "vision": "unknown",
        "dependency_available": installed,
        "configuration_fingerprint": hashlib.sha256(
            json.dumps(
                {
                    "model": config["model"],
                    "provider": name,
                    "endpoint": config.get("ollama_url")
                    if name in {"ollama", "ollama_chat"}
                    else None,
                },
                sort_keys=True,
            ).encode()
        ).hexdigest(),
    }


def show_llm_configuration() -> dict:
    return _configuration(provider.get_config())


def probe_show_extractors() -> dict:
    import requests

    config = provider.get_config()
    state = {
        "ocr": ocr_readiness(),
        **_configuration(config),
        "checked_at": datetime.now(UTC).isoformat(),
    }
    if config["provider"] in {"ollama", "ollama_chat"}:
        try:
            response = requests.post(
                config["ollama_url"].rstrip("/") + "/api/show",
                json={"model": config["model"].split("/", 1)[-1]},
                timeout=5,
            )
            response.raise_for_status()
            data = response.json()
            state["connectivity"] = "available"
            if isinstance(data.get("capabilities"), list):
                state["vision"] = (
                    "supported" if "vision" in data["capabilities"] else "unsupported"
                )
        except Exception:
            state["connectivity"] = "unavailable"
    elif state["configured"]:
        # Registry capability and actual connectivity are separate. No billable probe.
        try:
            import litellm

            state["vision"] = (
                "supported"
                if litellm.supports_vision(model=config["model"])
                else "unsupported"
            )
        except (ImportError, KeyError, ValueError):
            pass
    return state


def _composite(images):
    prepared = []
    for source in images:
        with Image.open(BytesIO(source["content"])) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            prepared.append(image.copy())
    width = max(image.width for image in prepared)
    height = sum(image.height for image in prepared)
    if width * height > MAX_PIXELS:
        raise ValueError("IMAGE_BUDGET: combined images exceed 20 megapixels")
    canvas = Image.new("RGB", (width, height), "white")
    offset = 0
    for image in prepared:
        canvas.paste(image, (0, offset))
        offset += image.height
    output = BytesIO()
    canvas.save(output, format="JPEG", quality=90)
    return output.getvalue()


def _source_manifest(sources):
    return [
        {
            key: source[key]
            for key in (
                "source_ref",
                "sha256",
                "text_sha256",
                "modality",
                "read",
                "extractor",
            )
            if key in source
        }
        for source in sources
        if source["read"] and (source.get("text") or source["modality"] == "image")
    ]


def _combined_source_ref(manifest):
    if not manifest:
        return None
    if len(manifest) == 1:
        return manifest[0]["source_ref"]
    encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    return "source-set:sha256:" + hashlib.sha256(encoded).hexdigest()


def _parse_sources(sources):
    draft = parse_show_text("")
    raw = ""
    rows = []
    truncated = False
    for source in sources:
        text = source.get("text", "") if source["read"] else ""
        separator = "\n" if raw and text else ""
        remaining = max(0, MAX_TEXT - len(raw) - len(separator))
        source["text"] = text[:remaining]
        source["truncated"] = source.get("truncated", False) or len(text) > remaining
        truncated = truncated or source["truncated"]
        if not source["text"]:
            continue
        source["text_sha256"] = hashlib.sha256(source["text"].encode()).hexdigest()
        raw += separator + source["text"]
        parsed = parse_show_text(
            source["text"], source_ref=source["source_ref"], include_undated=False
        )
        remaining_rows = 200 - len(rows)
        rows.extend(parsed["candidates"][:remaining_rows])
        truncated = (
            truncated
            or parsed["truncated"]
            or len(parsed["candidates"]) > remaining_rows
        )
    manifest = _source_manifest(sources)
    fallback_ref = _combined_source_ref(manifest)
    if not rows:
        rows = parse_show_text(raw, source_ref=fallback_ref)["candidates"]
    draft.update(
        raw_text=raw,
        candidates=rows,
        sources=sources,
        source_sets={fallback_ref: manifest} if len(manifest) > 1 else {},
        truncated=truncated or len(rows) == 200,
    )
    return draft


def extract_show_candidates(
    source: dict, images: list[dict], *, cancelled=lambda: False
) -> dict:
    mode = source["mode"]
    if cancelled():
        raise ValueError("CANCELLED")
    if mode == "probe":
        return {"readiness": probe_show_extractors()}
    warnings = []
    evidence = []
    if source.get("raw_text"):
        evidence.append(
            {
                "source_ref": "pasted-text",
                "read": True,
                "modality": "text",
                "text": source["raw_text"],
            }
        )
    if source.get("source_url"):
        from crate.show_url_fetch import fetch_worker_source

        page = fetch_worker_source(source["source_url"], cancelled=cancelled)
        if not page["available"]:
            warnings.append(page["warning"])
        evidence.append(
            {
                "source_ref": page["source_ref"],
                "read": page["available"],
                "modality": "text",
                "text": page["text"] if page["available"] else "",
                "truncated": page["truncated"],
            }
        )
    if mode in {"ocr", "ocr_text_llm"}:
        for image in images:
            result = recognize_image(image["content"], cancelled=cancelled)
            evidence.append(
                {
                    "source_ref": "upload:" + image["id"],
                    "sha256": image["sha256"],
                    "read": True,
                    "modality": "text",
                    **{
                        k: result[k]
                        for k in ("engine", "languages", "elapsed_seconds", "extractor")
                    },
                    "text": result["text"],
                    "truncated": result["truncated"],
                }
            )
    if mode == "vision":
        evidence.extend(
            {
                "source_ref": "upload:" + image["id"],
                "sha256": image["sha256"],
                "read": False,
                "modality": "image",
            }
            for image in images
        )
    draft = _parse_sources(evidence)
    raw = draft["raw_text"]
    draft.update(
        warnings=[*draft["warnings"], *warnings],
        mode=mode,
    )
    if mode in {"vision", "text_llm", "ocr_text_llm"}:
        runtime_config = provider.get_config()
        config = _configuration(runtime_config)
        if not config["configured"] or not config["dependency_available"]:
            draft.update(
                error_code="LLM_UNAVAILABLE",
                warnings=[
                    *draft["warnings"],
                    "The configured model is unavailable. Recognized text is preserved; use local OCR or manual correction.",
                ],
            )
            return draft
        if source.get("expected_configuration") and (
            source["expected_configuration"] != config["configuration_fingerprint"]
            or source.get("expected_model") != config["model"]
        ):
            draft.update(
                error_code="CONFIGURATION_CHANGED",
                warnings=[
                    *draft["warnings"],
                    "The configured model changed. Check readiness and explicitly choose the model again; no source was sent.",
                ],
            )
            return draft
        if mode == "vision" and not images:
            raise ValueError(
                "IMAGE_REQUIRED: upload a screenshot; a URL alone is not a viewed image"
            )
        if mode != "vision" and not raw.strip():
            raise ValueError("TEXT_REQUIRED: paste text or use a readable image")
        if cancelled():
            raise ValueError("CANCELLED")
        from crate.llm.prompts.show_extraction import build_show_extraction_prompt

        prompt = build_show_extraction_prompt(raw[:MAX_TEXT], len(images))
        options = {
            "model": config["model"],
            # Vision reads the complete poster before generating every tour row.
            # 45 s for a preceding URL + 90 s here leaves room in the 180 s task.
            "timeout_seconds": 90 if mode == "vision" else 45,
            "max_tokens": 16000,
            "private_response": True,
            **(
                {"ollama_url": runtime_config["ollama_url"]}
                if config["provider"] in {"ollama", "ollama_chat"}
                else {}
            ),
        }
        try:
            if mode == "vision":
                extracted = provider.ask_image_structured(
                    ExtractedShows,
                    prompt,
                    image=_composite(images),
                    media_type="image/jpeg",
                    image_detail=(
                        "ultra_high"
                        if config["model"].startswith("gemini/gemini-3")
                        else "default"
                    ),
                    **options,
                )
            else:
                extracted = provider.ask_structured(ExtractedShows, prompt, **options)
        except Exception:
            draft["error_code"] = "LLM_EXTRACTION_FAILED"
            draft["warnings"].append(
                "The configured model did not return valid candidates. Recognized text is preserved for manual correction; no second model call was made."
            )
            return draft
        if mode == "vision":
            for item in evidence:
                if item["modality"] == "image":
                    item["read"] = True
        manifest = _source_manifest(evidence)
        model_source_ref = _combined_source_ref(manifest)
        if len(manifest) > 1:
            draft["source_sets"][model_source_ref] = manifest
        if mode == "vision" and not extracted.candidates:
            for candidate in draft["candidates"]:
                if candidate["source_ref"] is None:
                    candidate["source_ref"] = model_source_ref
        rows = []
        for candidate in extracted.candidates:
            row = candidate.model_dump(mode="json", exclude_unset=True)
            for key in (
                "source_draft_id",
                "artist_uid",
                "existing_show_id",
                "expected_revision",
                "source_provider",
                "source_event_id",
                "latitude",
                "longitude",
            ):
                row.pop(key, None)
            row.update(
                item_id=str(uuid4()),
                source_ref=model_source_ref,
                extractor=EXTRACTOR_VERSION,
                extractor_model=config["model"],
            )
            rows.append(row)
        draft.update(
            candidates=rows or draft["candidates"],
            model=config["model"],
            warnings=[*warnings, *extracted.warnings[:20]],
            extractor=EXTRACTOR_VERSION,
        )
        # A model's assertion cannot certify that every tour date is visible/interpreted.
        draft["coverage"] = "incomplete"
    if cancelled():
        raise ValueError("CANCELLED")
    return draft


__all__ = [
    "fetch_show_source",
    "show_llm_configuration",
    "probe_show_extractors",
    "extract_show_candidates",
]
