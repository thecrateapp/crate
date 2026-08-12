"""Trusted candidate discovery and optional visual analysis for artist heroes."""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import quote

import requests
from PIL import Image
from pydantic import BaseModel, Field

from crate.auth import _get_jwt_secret
from crate.lastfm import get_fanart_all_images
from crate.llm.provider import ask_image_structured
from crate.utils import PHOTO_NAMES

log = logging.getLogger(__name__)

_MAX_CANDIDATES = 12
_MAX_BYTES = 25 * 1024 * 1024
_TOKEN_TTL_SECONDS = 60 * 60


@dataclass(frozen=True)
class CandidateFit:
    score: int
    label: str
    reason: str


@dataclass(frozen=True)
class CandidateScore:
    desktop: CandidateFit
    mobile: CandidateFit


@dataclass(frozen=True)
class ArtistHeroCandidate:
    id: str
    origin: str
    label: str
    preview_url: str
    width: int
    height: int
    desktop: CandidateFit
    mobile: CandidateFit

    def to_dict(self) -> dict:
        return asdict(self)


class VisualFit(BaseModel):
    score: int = Field(ge=0, le=100)
    reason: str = Field(max_length=160)
    focal_x: float = Field(ge=0, le=1)
    focal_y: float = Field(ge=0, le=1)


class ArtistHeroVisualAnalysis(BaseModel):
    desktop: VisualFit
    mobile: VisualFit
    summary: str = Field(max_length=240)


def _fit_score(width: int, height: int, target: tuple[int, int]) -> CandidateFit:
    ratio = width / height
    target_ratio = target[0] / target[1]
    aspect = math.exp(-abs(math.log(ratio / target_ratio)))
    resolution = min(1.0, width / target[0], height / target[1])
    score = round(65 * aspect + 35 * resolution)
    label = "excellent" if score >= 82 else "good" if score >= 64 else "poor"
    if resolution < 0.75:
        reason = "Resolution is below the target output."
    elif aspect >= 0.8:
        reason = "Aspect ratio leaves little destructive cropping."
    else:
        reason = "The subject may need a deliberate crop or Fill composition."
    return CandidateFit(score=score, label=label, reason=reason)


def score_candidate(width: int, height: int) -> CandidateScore:
    if width <= 0 or height <= 0:
        raise ValueError("Candidate dimensions must be positive")
    return CandidateScore(
        desktop=_fit_score(width, height, (1480, 600)),
        mobile=_fit_score(width, height, (1080, 1350)),
    )


def _candidate_secret() -> str:
    return _get_jwt_secret()


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def encode_candidate_token(*, artist_id: int, origin: str, reference: str) -> str:
    payload = json.dumps(
        {
            "artist_id": artist_id,
            "origin": origin,
            "reference": reference,
            "expires_at": int(time.time()) + _TOKEN_TTL_SECONDS,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    encoded = _b64encode(payload)
    signature = _b64encode(
        hmac.new(
            _candidate_secret().encode(), encoded.encode(), hashlib.sha256
        ).digest()
    )
    return f"{encoded}.{signature}"


def decode_candidate_token(
    token: str, *, expected_artist_id: int
) -> dict[str, object] | None:
    try:
        encoded, supplied = token.split(".", 1)
        expected = _b64encode(
            hmac.new(
                _candidate_secret().encode(), encoded.encode(), hashlib.sha256
            ).digest()
        )
        if not hmac.compare_digest(supplied, expected):
            return None
        payload = json.loads(_b64decode(encoded))
        if int(payload.get("artist_id") or 0) != expected_artist_id:
            return None
        if int(payload.get("expires_at") or 0) < int(time.time()):
            return None
        return payload
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def _download_remote_candidate(url: str) -> bytes | None:
    chunks: list[bytes] = []
    total = 0
    try:
        with requests.get(
            url, timeout=(3, 12), headers={"Accept": "image/*"}, stream=True
        ) as response:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if content_type and not content_type.startswith("image/"):
                return None
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                total += len(chunk)
                if total > _MAX_BYTES:
                    return None
                chunks.append(chunk)
    except (requests.RequestException, TypeError, AttributeError):
        return None
    content = b"".join(chunks)
    return content if content else None


def _validated_dimensions(content: bytes) -> tuple[int, int] | None:
    try:
        with Image.open(io.BytesIO(content)) as image:
            image.verify()
            width, height = image.size
        if width <= 0 or height <= 0 or width * height > 80_000_000:
            return None
        return width, height
    except (Image.DecompressionBombError, OSError, ValueError):
        return None


def _candidate_from_source(
    *,
    artist_id: int,
    origin: str,
    label: str,
    reference: str,
    content: bytes | None,
) -> ArtistHeroCandidate | None:
    if not content or len(content) > _MAX_BYTES:
        return None
    dimensions = _validated_dimensions(content)
    if dimensions is None:
        return None
    width, height = dimensions
    score = score_candidate(width, height)
    token = encode_candidate_token(
        artist_id=artist_id, origin=origin, reference=reference
    )
    return ArtistHeroCandidate(
        id=token,
        origin=origin,
        label=label,
        preview_url=(
            f"/api/artwork/artists/{artist_id}/hero-candidates/preview"
            f"?candidate={quote(token)}"
        ),
        width=width,
        height=height,
        desktop=score.desktop,
        mobile=score.mobile,
    )


def discover_artist_hero_candidates(
    *, artist_id: int, artist_name: str, artist_dir: Path
) -> list[ArtistHeroCandidate]:
    sources: list[tuple[str, str, str, bytes | None]] = []
    local_names = ["background.jpg", *sorted(PHOTO_NAMES)]
    for filename in dict.fromkeys(local_names):
        path = artist_dir / filename
        if path.is_file() and path.stat().st_size <= _MAX_BYTES:
            origin = (
                "local-background" if filename == "background.jpg" else "local-photo"
            )
            sources.append((origin, filename, filename, path.read_bytes()))

    fanart = get_fanart_all_images(artist_name) or {}
    remote: list[tuple[str, str, str]] = []
    for origin, key, label in (
        ("fanart-background", "backgrounds", "Fanart background"),
        ("fanart-thumb", "thumbs", "Fanart portrait"),
    ):
        for index, url in enumerate(fanart.get(key) or []):
            if isinstance(url, str) and url.startswith(("https://", "http://")):
                remote.append((origin, f"{label} {index + 1}", url))
    remote = remote[: max(0, _MAX_CANDIDATES - len(sources))]
    if remote:
        with ThreadPoolExecutor(max_workers=min(4, len(remote))) as executor:
            contents = list(
                executor.map(lambda item: _download_remote_candidate(item[2]), remote)
            )
        sources.extend(
            (*item, content) for item, content in zip(remote, contents, strict=True)
        )

    candidates = [
        candidate
        for origin, label, reference, content in sources
        if (
            candidate := _candidate_from_source(
                artist_id=artist_id,
                origin=origin,
                label=label,
                reference=reference,
                content=content,
            )
        )
    ]
    return sorted(candidates, key=lambda item: item.desktop.score, reverse=True)


def load_candidate_content(
    token: str, *, artist_id: int, artist_dir: Path
) -> tuple[bytes, str] | None:
    payload = decode_candidate_token(token, expected_artist_id=artist_id)
    if payload is None:
        return None
    reference = str(payload.get("reference") or "")
    origin = str(payload.get("origin") or "")
    if origin.startswith("local-"):
        path = (artist_dir / reference).resolve()
        root = artist_dir.resolve()
        if not path.is_relative_to(root) or not path.is_file():
            return None
        content = path.read_bytes()
    elif origin.startswith("fanart-") and reference.startswith(("https://", "http://")):
        content = _download_remote_candidate(reference)
    else:
        return None
    if not content or _validated_dimensions(content) is None:
        return None
    return content, origin


def analyze_candidate_image(content: bytes) -> ArtistHeroVisualAnalysis | None:
    prompt = (
        "Evaluate this artist photo for a music app hero. Desktop is a 1480x600 "
        "canvas with text on the left; mobile is a 1080x1350 canvas with text near "
        "the bottom. Score whether important faces and bodies can remain visible, "
        "give a normalized focal point for each format, and explain briefly."
    )
    try:
        return ask_image_structured(
            ArtistHeroVisualAnalysis,
            prompt,
            image=content,
            media_type="image/jpeg",
            system="You are an editorial art director. Do not propose generative edits.",
        )
    except (RuntimeError, ValueError):
        log.info("Vision analysis unavailable for artist hero candidate", exc_info=True)
        return None
