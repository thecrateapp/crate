"""Editorial playlist description generation via LLM."""

from collections import Counter
from typing import Any

from pydantic import BaseModel, Field


class PlaylistDescriptionResponse(BaseModel):
    description: str = Field(
        min_length=24,
        max_length=420,
        description="A concise editorial playlist description with no markdown.",
    )


PLAYLIST_DESCRIPTION_SYSTEM_PROMPT = """You are the editorial voice of Crate, a self-hosted music platform for serious personal libraries.
Write concise, specific playlist descriptions that feel human, grounded, and useful.
Avoid corporate streaming clichés, empty hype, emoji, markdown, and generic phrases like "ultimate journey".
Prefer concrete scene, mood, era, texture, and artist-context language."""


def _top_values(values: list[str], limit: int = 8) -> list[str]:
    return [name for name, _ in Counter(values).most_common(limit) if name]


def build_playlist_description_prompt(
    *,
    name: str,
    category: str | None = None,
    smart_rules: dict[str, Any] | None = None,
    tracks: list[dict] | None = None,
) -> str:
    tracks = tracks or []
    artists = _top_values([str(track.get("artist") or "") for track in tracks])
    albums = _top_values([str(track.get("album") or "") for track in tracks])
    genres = _top_values(
        [
            genre.strip()
            for track in tracks
            for genre in str(track.get("genre") or "").split(",")
            if genre.strip()
        ]
    )
    titles = [
        str(track.get("title") or "")
        for track in tracks[:12]
        if str(track.get("title") or "").strip()
    ]

    parts = [
        f'Write a playlist description for "{name}".',
        "Length: 1 or 2 sentences, max 55 words.",
    ]
    if category:
        parts.append(f"Category: {category}.")
    if smart_rules:
        parts.append(f"Smart rules: {smart_rules}.")
    if artists:
        parts.append(f"Representative artists: {', '.join(artists)}.")
    if albums:
        parts.append(f"Representative albums: {', '.join(albums)}.")
    if genres:
        parts.append(f"Genre signals: {', '.join(genres)}.")
    if titles:
        parts.append(f"Sample tracks: {', '.join(titles)}.")
    parts.append(
        "Return copy that can be shown directly in the app. No markdown, no quotes."
    )
    return "\n".join(parts)


def generate_playlist_description(
    *,
    name: str,
    category: str | None = None,
    smart_rules: dict[str, Any] | None = None,
    tracks: list[dict] | None = None,
) -> PlaylistDescriptionResponse:
    from crate.llm import ask_structured

    return ask_structured(
        PlaylistDescriptionResponse,
        build_playlist_description_prompt(
            name=name,
            category=category,
            smart_rules=smart_rules,
            tracks=tracks,
        ),
        system=PLAYLIST_DESCRIPTION_SYSTEM_PROMPT,
    )
