"""OpenSubsonic media delivery backed by Crate's playback pipeline."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi.responses import FileResponse, Response

from crate.db.queries.subsonic_global import get_global_track
from crate.db.queries.subsonic_track_queries import get_track_full
from crate.subsonic.errors import ErrorCode, OpenSubsonicError
from crate.subsonic.global_ids import (
    SubsonicEntityId,
    SubsonicIdError,
    decode_subsonic_id,
)
from crate.streaming.policy import (
    BALANCED_POLICY,
    DATA_SAVER_POLICY,
    ORIGINAL_POLICY,
)
from crate.streaming.service import (
    media_type_for_path,
    resolve_playback,
    resolve_source_path,
)

_SUPPORTED_TRANSCODE_FORMAT = "m4a"
_MIN_TRANSCODE_BITRATE = 128
_BALANCED_TRANSCODE_BITRATE = 192
_SAFE_FILENAME_RE = re.compile(r'[\\/\x00-\x1f\x7f"]+')


def select_transcode_policy(
    audio_format: str | None, max_bit_rate: int | str | None
) -> str:
    """Map only worker-supported OpenSubsonic format/bitrate requests."""
    normalized_format = (audio_format or "").strip().lower()
    if normalized_format == "raw":
        return ORIGINAL_POLICY

    requested_rate: int | None
    if max_bit_rate is None or str(max_bit_rate).strip() == "":
        requested_rate = None
    else:
        try:
            requested_rate = int(max_bit_rate)
        except (TypeError, ValueError) as exc:
            raise OpenSubsonicError(
                ErrorCode.MISSING_PARAMETER, "Invalid parameter 'maxBitRate'"
            ) from exc
        if requested_rate < 0:
            raise OpenSubsonicError(
                ErrorCode.MISSING_PARAMETER, "Invalid parameter 'maxBitRate'"
            )

    if not normalized_format and requested_rate in {None, 0}:
        return ORIGINAL_POLICY
    if normalized_format and normalized_format != _SUPPORTED_TRANSCODE_FORMAT:
        raise OpenSubsonicError(
            ErrorCode.GENERIC, "Requested transcode format is not supported"
        )
    if requested_rate is not None and 0 < requested_rate < _MIN_TRANSCODE_BITRATE:
        raise OpenSubsonicError(
            ErrorCode.GENERIC, "Requested transcode bitrate is not supported"
        )
    if requested_rate and requested_rate < _BALANCED_TRANSCODE_BITRATE:
        return DATA_SAVER_POLICY
    return BALANCED_POLICY


def stream_track(
    identifier: str,
    *,
    user: dict[str, Any],
    request_headers: dict[str, str],
    audio_format: str | None = None,
    max_bit_rate: int | str | None = None,
) -> Response:
    """Deliver local or federated media through playback preparation."""
    entity_id = _track_id(identifier)
    policy = select_transcode_policy(audio_format, max_bit_rate)
    if entity_id.scope == "global":
        from crate.federation.playback_service import stream_global_track

        return stream_global_track(
            str(entity_id.global_uid),
            user=user,
            request_headers=request_headers,
            delivery_policy=policy,
        )

    track = get_track_full(int(entity_id.local_id or 0))
    if track is None:
        raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Track not found")
    resolution = resolve_playback(track, policy, enqueue=True)
    if resolution is None:
        raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Track file not found")
    return _file_response(
        resolution.file_path,
        media_type=resolution.media_type,
    )


def download_track(
    identifier: str,
    *,
    user: dict[str, Any],
    request_headers: dict[str, str],
) -> Response:
    """Download the original file, never a prepared/transcoded variant."""
    entity_id = _track_id(identifier)
    if entity_id.scope == "global":
        from crate.federation.playback_service import stream_global_track

        track = get_global_track(str(entity_id.global_uid))
        if track is None:
            raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Track not found")
        response = stream_global_track(
            str(entity_id.global_uid),
            user=user,
            request_headers=request_headers,
            delivery_policy=ORIGINAL_POLICY,
        )
        response.headers["Content-Disposition"] = _attachment_header(
            _filename(str(track.get("title") or "track"), track.get("format"))
        )
        return response

    track = get_track_full(int(entity_id.local_id or 0))
    if track is None:
        raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Track not found")
    source_path = resolve_source_path(track)
    if source_path is None or not source_path.is_file():
        raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Track file not found")
    return _file_response(
        source_path,
        media_type=media_type_for_path(source_path),
        filename=source_path.name,
    )


def _track_id(identifier: str) -> SubsonicEntityId:
    try:
        return decode_subsonic_id(identifier, expected_kind="track")
    except SubsonicIdError as exc:
        raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Invalid track ID") from exc


def _file_response(
    path: Path, *, media_type: str, filename: str | None = None
) -> FileResponse:
    return FileResponse(
        str(path),
        media_type=media_type,
        filename=filename,
        headers={"Cache-Control": "private, no-store", "Accept-Ranges": "bytes"},
    )


def _filename(title: str, audio_format: Any) -> str:
    safe_title = _SAFE_FILENAME_RE.sub("_", title).strip(" .") or "track"
    extension = str(audio_format or "").strip().lower().lstrip(".")
    if not extension or not extension.isalnum():
        extension = "m4a"
    return f"{safe_title}.{extension}"


def _attachment_header(filename: str) -> str:
    fallback = filename.encode("ascii", "ignore").decode("ascii") or "track"
    encoded = quote(filename, safe="!#$&+-.^_`|~")
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"


__all__ = ["download_track", "select_transcode_policy", "stream_track"]
