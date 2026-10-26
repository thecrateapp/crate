"""Bounded local CPU OCR. Scores describe recognition, never show correctness."""

from datetime import date
from io import BytesIO
from pathlib import Path
import os
import re
import resource
import shutil
import subprocess
import tempfile
import time
from uuid import uuid4
from PIL import Image, ImageOps

LANGUAGES = ("eng", "spa")
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 20_000_000
MAX_TEXT = 60_000
EXTRACTOR_VERSION = "shows-ocr-v1"


def validate_image(data: bytes) -> tuple[str, int, int]:
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError("INVALID_IMAGE: maximum size is 8 MiB")
    try:
        with Image.open(BytesIO(data)) as image:
            if (
                image.format not in {"PNG", "JPEG", "WEBP"}
                or getattr(image, "n_frames", 1) != 1
            ):
                raise ValueError("Unsupported image")
            if image.width * image.height > MAX_PIXELS or min(image.size) < 20:
                raise ValueError("Invalid dimensions")
            image.verify()
            return image.format, image.width, image.height
    except Exception:
        raise ValueError(
            "INVALID_IMAGE: use a static PNG, JPEG or WebP up to 20 megapixels"
        ) from None


def ocr_readiness() -> dict:
    binary = shutil.which("tesseract")
    if not binary:
        return {
            "available": False,
            "engine": None,
            "languages": [],
            "reason": "OCR_UNAVAILABLE",
        }
    try:
        version = subprocess.run(
            [binary, "--version"], capture_output=True, text=True, timeout=3, check=True
        ).stdout.splitlines()[0]
        languages = subprocess.run(
            [binary, "--list-langs"],
            capture_output=True,
            text=True,
            timeout=3,
            check=True,
        ).stdout.splitlines()[1:]
        available = set(LANGUAGES) <= set(languages) and version.startswith(
            "tesseract 5."
        )
        return {
            "available": available,
            "engine": version,
            "languages": languages,
            "reason": None if available else "OCR_LANGUAGES_OR_VERSION_UNAVAILABLE",
        }
    except (OSError, subprocess.SubprocessError):
        return {
            "available": False,
            "engine": None,
            "languages": [],
            "reason": "OCR_UNAVAILABLE",
        }


def recognize_image(data: bytes, *, cancelled=lambda: False, timeout=30) -> dict:
    validate_image(data)
    if cancelled():
        raise ValueError("CANCELLED")
    if timeout <= 0:
        raise ValueError("OCR_TIMEOUT")
    binary = shutil.which("tesseract")
    readiness = ocr_readiness()
    if not binary or not readiness["available"]:
        raise ValueError(
            "OCR_UNAVAILABLE: install Tesseract 5 with eng and spa in the worker"
        )
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="crate-show-ocr-") as directory:
        source = Path(directory) / "input.png"
        with Image.open(BytesIO(data)) as image:
            image = ImageOps.exif_transpose(image).convert("RGBA")
            background = Image.new("RGBA", image.size, "white")
            background.alpha_composite(image)
            ImageOps.grayscale(background.convert("RGB")).save(source, dpi=(300, 300))
        base = Path(directory) / "recognized"
        process = subprocess.Popen(
            [
                binary,
                str(source),
                str(base),
                "--oem",
                "1",
                "-l",
                "eng+spa",
                "--psm",
                "6",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env={**os.environ, "OMP_THREAD_LIMIT": "1"},
        )
        try:
            try:
                resource.prlimit(
                    process.pid,
                    resource.RLIMIT_AS,
                    (512 * 1024 * 1024, 512 * 1024 * 1024),
                )
                resource.prlimit(process.pid, resource.RLIMIT_CPU, (25, 26))
                resource.prlimit(
                    process.pid, resource.RLIMIT_FSIZE, (512 * 1024, 512 * 1024)
                )
            except ProcessLookupError:
                pass
            checked_at = 0.0
            while process.poll() is None:
                now = time.monotonic()
                if now - checked_at >= 0.5 and cancelled():
                    raise ValueError("CANCELLED")
                if now - checked_at >= 0.5:
                    checked_at = now
                if time.monotonic() - started >= min(timeout, 30):
                    raise ValueError("OCR_TIMEOUT")
                time.sleep(0.05)
            if process.returncode:
                raise ValueError("OCR_FAILED: inspect the image or use manual text")
            with base.with_suffix(".txt").open("rb") as handle:
                raw = handle.read(MAX_TEXT + 1)
            return {
                "text": raw[:MAX_TEXT].decode("utf-8", errors="replace"),
                "truncated": len(raw) > MAX_TEXT,
                "engine": readiness["engine"],
                "languages": list(LANGUAGES),
                "elapsed_seconds": round(time.monotonic() - started, 3),
                "extractor": EXTRACTOR_VERSION,
            }
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()


def parse_show_text(
    text: str, *, source_ref: str | None = None, include_undated: bool = True
) -> dict:
    raw = text[:MAX_TEXT]
    rows = []
    for line in raw.splitlines():
        for match in re.finditer(r"(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)", line):
            try:
                day = date.fromisoformat(match.group(1)).isoformat()
            except ValueError:
                day = None
            rows.append(
                {
                    "item_id": str(uuid4()),
                    "date": day,
                    "source_ref": source_ref,
                    "evidence": line[:1500],
                }
            )
            if len(rows) == 200:
                break
        if len(rows) == 200:
            break
    if not rows and include_undated:
        rows = [
            {
                "item_id": str(uuid4()),
                "date": None,
                "source_ref": source_ref,
                "evidence": raw[:1500],
            }
        ]
    return {
        "raw_text": raw,
        "candidates": rows,
        "coverage": "incomplete",
        "warnings": [
            "Only full ISO dates are proposed automatically. Review the source, every date, artist, venue and city; artistic or unreadable text may be missing."
        ],
        "extractor": EXTRACTOR_VERSION,
        "truncated": len(text) > MAX_TEXT or len(rows) == 200,
    }


__all__ = ["validate_image", "ocr_readiness", "recognize_image", "parse_show_text"]
