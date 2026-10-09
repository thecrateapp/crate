"""Stable identity and readable copy for library health issues."""

from __future__ import annotations

import hashlib
import json
from pathlib import PurePath
from typing import Any


def health_issue_identity(
    check_type: str, details: dict[str, Any] | None, description: str = ""
) -> str:
    payload = (
        json.dumps(details, sort_keys=True, default=str) if details else description
    )
    return hashlib.md5(f"{check_type}\n{payload}".encode()).hexdigest()


def _name(path: Any) -> str:
    return PurePath(str(path)).name if path else ""


def _artist_album(details: dict[str, Any]) -> str:
    artist = details.get("artist") or details.get("db_artist") or ""
    album = details.get("album") or ""
    return f"{artist} / {album}" if artist and album else artist or album


def describe_health_issue(check_type: str, details: dict[str, Any] | None) -> str:
    d = details or {}
    who = _artist_album(d)
    match check_type:
        case "duplicate_folders":
            folders = [_name(folder) for folder in d.get("folders", [])]
            return f"Duplicate artist folders: {', '.join(folders[:4])}"
        case "canonical_mismatch":
            return (
                f"{d.get('artist')}: folder '{d.get('folder')}' or tag "
                f"'{d.get('tag_name')}' differs from the canonical name"
            )
        case "artist_layout_fix":
            return f"{d.get('artist')}: folder layout needs fixing"
        case "fk_orphan_albums":
            return f"Album without a matching artist: {who}"
        case "fk_orphan_tracks":
            return f"Track without an album: {_name(d.get('track_path'))}"
        case "stale_artists":
            return f"Artist folder missing on disk: {d.get('artist')}"
        case "stale_albums":
            return f"Album folder missing on disk: {who}"
        case "stale_tracks":
            return f"Track file missing on disk: {d.get('artist')} / {_name(d.get('track_path'))}"
        case "zombie_artists":
            return f"Artist with no albums or tracks: {d.get('artist')}"
        case "has_photo_desync":
            return f"Artist photo flag out of sync: {d.get('artist')}"
        case "duplicate_albums":
            return f"{who}: {d.get('count', 2)} copies of the album"
        case "duplicate_tracks":
            position = d.get("track_number")
            label = f"#{position} " if position else ""
            return f"{who}: {label}'{d.get('title')}' appears {d.get('count', 2)} times"
        case "shadow_quality_tracks":
            formats = ", ".join(str(f) for f in d.get("formats", [])[:3])
            return f"{who}: lower quality copies alongside the album ({formats})"
        case "unindexed_files":
            return f"{d.get('count')} audio files not in the library: {_name(d.get('dir'))}"
        case "tag_mismatch":
            return (
                f"{_name(d.get('track_path'))}: tag artist '{d.get('tag_artist')}' "
                f"differs from '{d.get('db_artist')}'"
            )
        case "folder_naming":
            return f"{d.get('artist')}: rename '{d.get('current_folder')}' to '{_name(d.get('expected_path'))}'"
        case "missing_cover":
            return f"Missing cover: {who}"
    return who or check_type.replace("_", " ")


__all__ = ["describe_health_issue", "health_issue_identity"]
