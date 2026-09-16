"""OpenSubsonic v1 system endpoints."""

from fastapi import APIRouter, Request
from fastapi.responses import Response

from crate.subsonic.capabilities import advertised_extensions
from crate.subsonic.errors import ErrorCode, OpenSubsonicError
from crate.subsonic.params import RequestParameters, collect_parameters
from crate.subsonic.protocol import API_VERSION, render_response

from . import legacy

router = APIRouter(prefix="/rest", tags=["subsonic"])


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
        if requires_auth and not legacy._subsonic_auth(request):
            raise OpenSubsonicError(
                ErrorCode.INVALID_CREDENTIALS, "Wrong username or password"
            )
    except OpenSubsonicError as error:
        return render_response(error=error, response_format=response_format)
    return render_response(payload, response_format=response_format)


@router.get("/ping")
@router.get("/ping.view", include_in_schema=False)
async def ping(request: Request) -> Response:
    return await _handle_system_request(request, payload={}, requires_auth=True)


@router.get("/getLicense")
@router.get("/getLicense.view", include_in_schema=False)
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


@router.get("/getOpenSubsonicExtensions")
@router.get("/getOpenSubsonicExtensions.view", include_in_schema=False)
async def get_open_subsonic_extensions(request: Request) -> Response:
    return await _handle_system_request(
        request,
        payload={"openSubsonicExtensions": advertised_extensions()},
        requires_auth=False,
    )
