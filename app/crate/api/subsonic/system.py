"""OpenSubsonic v1 system endpoints."""

import logging
from typing import Any, Callable

from fastapi import Request
from fastapi.responses import Response

from crate.db.queries.subsonic_user_queries import get_user_by_username
from crate.subsonic.capabilities import advertised_extensions
from crate.subsonic.errors import ErrorCode, OpenSubsonicError
from crate.subsonic.params import RequestParameters, collect_parameters
from crate.subsonic.protocol import API_VERSION, render_response
from crate.subsonic.routes import OpenSubsonicAPIRouter
from crate.subsonic.services import system_operations
from crate.subsonic.services.avatars import fetch_avatar
from crate.user_avatars import AvatarProxyError, AvatarUnavailable

log = logging.getLogger(__name__)
router = OpenSubsonicAPIRouter(prefix="/rest", tags=["subsonic"])


def _response_format(params: RequestParameters) -> str:
    return "json" if params.first("f", "xml") == "json" else "xml"


def _validate_common_parameters(params: RequestParameters) -> None:
    version = params.first("v")
    if not version:
        raise OpenSubsonicError(
            ErrorCode.MISSING_PARAMETER, "Required parameter 'v' is missing"
        )
    if version != API_VERSION:
        raise OpenSubsonicError(
            ErrorCode.INCOMPATIBLE_CLIENT, "Incompatible client protocol version"
        )
    if not params.first("c"):
        raise OpenSubsonicError(
            ErrorCode.MISSING_PARAMETER, "Required parameter 'c' is missing"
        )
    response_format = params.first("f", "xml")
    if response_format not in {"json", "xml"}:
        raise OpenSubsonicError(ErrorCode.GENERIC, "Unsupported response format")


async def _handle_system_request(
    request: Request,
    *,
    payload: dict[str, object],
    requires_auth: bool,
) -> Response:
    params = await collect_parameters(request)
    response_format = _response_format(params)
    try:
        _validate_common_parameters(params)
        if requires_auth:
            from crate.subsonic.auth import authenticate

            authenticate(params)
    except OpenSubsonicError as error:
        return render_response(error=error, response_format=response_format)
    return render_response(payload, response_format=response_format)


async def _handle_authenticated_operation(
    request: Request, operation: Callable[[dict[str, Any]], dict[str, Any]]
) -> Response:
    params = await collect_parameters(request)
    response_format = _response_format(params)
    try:
        _validate_common_parameters(params)
        from crate.subsonic.auth import authenticate

        user = authenticate(params)
        payload = operation(user)
    except OpenSubsonicError as error:
        return render_response(error=error, response_format=response_format)
    except Exception:
        log.exception("OpenSubsonic system operation failed")
        return render_response(
            error=OpenSubsonicError(ErrorCode.GENERIC, "System operation failed"),
            response_format=response_format,
        )
    return render_response(payload, response_format=response_format)


def _avatar_error_response(error: OpenSubsonicError) -> Response:
    response = render_response(error=error, response_format="xml")
    response.headers["content-type"] = "text/xml; charset=utf-8"
    return response


@router.api_route("/ping", methods=["GET", "POST"])
@router.api_route("/ping.view", methods=["GET", "POST"], include_in_schema=False)
async def ping(request: Request) -> Response:
    return await _handle_system_request(request, payload={}, requires_auth=True)


@router.api_route("/getLicense", methods=["GET", "POST"])
@router.api_route("/getLicense.view", methods=["GET", "POST"], include_in_schema=False)
async def get_license(request: Request) -> Response:
    return await _handle_system_request(
        request,
        payload={
            "license": {
                "valid": True,
                "email": "crate@local",
                "licenseExpires": "2099-12-31T00:00:00Z",
            }
        },
        requires_auth=True,
    )


@router.api_route("/getOpenSubsonicExtensions", methods=["GET", "POST"])
@router.api_route(
    "/getOpenSubsonicExtensions.view", methods=["GET", "POST"], include_in_schema=False
)
async def get_open_subsonic_extensions(request: Request) -> Response:
    return await _handle_system_request(
        request,
        payload={"openSubsonicExtensions": advertised_extensions()},
        requires_auth=False,
    )


@router.api_route("/getScanStatus", methods=["GET"])
@router.api_route("/getScanStatus.view", methods=["GET"], include_in_schema=False)
async def get_scan_status(request: Request) -> Response:
    return await _handle_authenticated_operation(
        request, lambda _user: {"scanStatus": system_operations.scan_status()}
    )


@router.api_route("/startScan", methods=["GET"])
@router.api_route("/startScan.view", methods=["GET"], include_in_schema=False)
async def start_scan(request: Request) -> Response:
    return await _handle_authenticated_operation(
        request, lambda user: {"scanStatus": system_operations.start_scan(user)}
    )


@router.api_route("/getAvatar", methods=["GET"])
@router.api_route("/getAvatar.view", methods=["GET"], include_in_schema=False)
async def get_avatar(request: Request) -> Response:
    params = await collect_parameters(request)
    try:
        _validate_common_parameters(params)
        from crate.subsonic.auth import authenticate

        authenticate(params)
        username = params.first("username")
        if not username:
            raise OpenSubsonicError(
                ErrorCode.MISSING_PARAMETER, "Required parameter 'username' is missing"
            )
        user = get_user_by_username(username)
        if not user or not user.get("avatar"):
            raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Avatar not found")
        try:
            content, content_type = fetch_avatar(user["avatar"])
        except AvatarUnavailable as exc:
            raise OpenSubsonicError(ErrorCode.NOT_FOUND, "Avatar not found") from exc
        except AvatarProxyError as exc:
            raise OpenSubsonicError(ErrorCode.GENERIC, "Avatar unavailable") from exc
    except OpenSubsonicError as error:
        return _avatar_error_response(error)
    except Exception:
        log.exception("OpenSubsonic avatar retrieval failed")
        return _avatar_error_response(
            OpenSubsonicError(ErrorCode.GENERIC, "Avatar unavailable")
        )

    return Response(
        content=content,
        media_type=content_type,
        headers={
            "Cache-Control": "private, max-age=86400",
            "Vary": "Authorization, Cookie",
        },
    )
