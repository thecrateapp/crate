"""OpenSubsonic media delivery endpoints."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable

from fastapi import Depends, Query, Request
from fastapi.responses import Response

from crate.federation.playback_service import PlaybackServiceError
from crate.subsonic.auth import authenticate
from crate.subsonic.errors import ErrorCode, OpenSubsonicError
from crate.subsonic.params import RequestParameters
from crate.subsonic.protocol import render_response
from crate.subsonic.routes import OpenSubsonicAPIRouter
from crate.subsonic.services import media as media_service

router = OpenSubsonicAPIRouter(prefix="/rest", tags=["subsonic"])

_AUDIO_CONTENT_TYPES = (
    "audio/aac",
    "audio/flac",
    "audio/mp4",
    "audio/mpeg",
    "audio/ogg",
    "audio/opus",
    "audio/wav",
)
_MEDIA_RESPONSES = {
    200: {
        "description": "Audio bytes, or a Subsonic error envelope.",
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/SubsonicOkResponse"}
            },
            **{
                content_type: {"schema": {"type": "string", "format": "binary"}}
                for content_type in _AUDIO_CONTENT_TYPES
            },
        },
    },
    404: {"description": "The requested track media was not found."},
}


def _auth_documentation(
    username: str = Query("", alias="u"),
    password: str = Query("", alias="p"),
    token: str = Query("", alias="t"),
    salt: str = Query("", alias="s"),
    api_key: str = Query("", alias="apiKey"),
    version: str = Query("1.16.1", alias="v"),
    client: str = Query("", alias="c"),
    response_format: str = Query("xml", alias="f"),
) -> None:
    del username, password, token, salt, api_key, version, client, response_format


def _stream_documentation(
    identifier: str = Query("", alias="id"),
    audio_format: str | None = Query(None, alias="format"),
    max_bit_rate: str | None = Query(None, alias="maxBitRate"),
) -> None:
    del identifier, audio_format, max_bit_rate


def _download_documentation(identifier: str = Query("", alias="id")) -> None:
    del identifier


def _response_format(request: Request) -> tuple[str, OpenSubsonicError | None]:
    requested = (request.query_params.get("f") or "xml").strip().lower()
    if requested not in {"xml", "json"}:
        return "xml", OpenSubsonicError(
            ErrorCode.GENERIC, "Unsupported response format"
        )
    return requested, None


def _authenticate_request(request: Request) -> dict:
    grouped: defaultdict[str, list[str]] = defaultdict(list)
    for name, value in request.query_params.multi_items():
        grouped[name].append(value)
    return authenticate(
        RequestParameters({name: tuple(values) for name, values in grouped.items()})
    )


def _handle_media_request(
    request: Request, operation: Callable[[dict], Response]
) -> Response:
    response_format, format_error = _response_format(request)
    if format_error is not None:
        return render_response(error=format_error, response_format=response_format)
    try:
        user = _authenticate_request(request)
        return operation(user)
    except OpenSubsonicError as error:
        return render_response(error=error, response_format=response_format)
    except PlaybackServiceError as error:
        return Response(status_code=error.status_code)


def _required_id(request: Request) -> str:
    identifier = request.query_params.get("id")
    if not identifier:
        raise OpenSubsonicError(
            ErrorCode.MISSING_PARAMETER, "Required parameter 'id' is missing"
        )
    return identifier


@router.get(
    "/stream",
    summary="Stream or transcode a track",
    dependencies=[Depends(_auth_documentation), Depends(_stream_documentation)],
    responses=_MEDIA_RESPONSES,
)
@router.get("/stream.view", include_in_schema=False)
def stream(request: Request) -> Response:
    def deliver(user: dict) -> Response:
        return media_service.stream_track(
            _required_id(request),
            user=user,
            request_headers=dict(request.headers),
            audio_format=request.query_params.get("format"),
            max_bit_rate=request.query_params.get("maxBitRate"),
        )

    return _handle_media_request(request, deliver)


@router.get(
    "/download",
    summary="Download the original track file",
    dependencies=[Depends(_auth_documentation), Depends(_download_documentation)],
    responses=_MEDIA_RESPONSES,
)
@router.get("/download.view", include_in_schema=False)
def download(request: Request) -> Response:
    def deliver(user: dict) -> Response:
        return media_service.download_track(
            _required_id(request),
            user=user,
            request_headers=dict(request.headers),
        )

    return _handle_media_request(request, deliver)


__all__ = ["router"]
