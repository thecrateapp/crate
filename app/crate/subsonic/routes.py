"""FastAPI routing helpers for OpenSubsonic's form POST extension."""

from __future__ import annotations

from collections.abc import Collection
from urllib.parse import parse_qsl

from fastapi import APIRouter, HTTPException, Request
from fastapi.routing import APIRoute
from starlette.datastructures import QueryParams

_MAX_FORM_BODY_BYTES = 4 * 1024 * 1024
_MAX_FORM_FIELDS = 50_000


class OpenSubsonicFormPostRoute(APIRoute):
    """Merge urlencoded POST fields into FastAPI's query parameter view."""

    def get_route_handler(self):
        original_handler = super().get_route_handler()

        async def handle_form_post(request: Request):
            content_type = request.headers.get("content-type", "").split(";", 1)[0]
            if (
                request.method == "POST"
                and content_type.strip().lower() == "application/x-www-form-urlencoded"
            ):
                fields = await _read_form_fields(request)
                query_fields = list(request.query_params.multi_items())
                request._query_params = QueryParams([*query_fields, *fields])
                request.state.subsonic_form_params_merged = True

            return await original_handler(request)

        return handle_form_post


async def _read_form_fields(request: Request) -> list[tuple[str, str]]:
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > _MAX_FORM_BODY_BYTES:
                raise HTTPException(status_code=413, detail="Form body too large")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid form body") from None

    body = bytearray()
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > _MAX_FORM_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Form body too large")
        body.extend(chunk)

    body_bytes = bytes(body)
    try:
        return parse_qsl(
            body_bytes.decode("utf-8"),
            keep_blank_values=True,
            max_num_fields=_MAX_FORM_FIELDS,
            encoding="utf-8",
            errors="strict",
        )
    except (UnicodeDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid form body") from None


class OpenSubsonicAPIRouter(APIRouter):
    """Expose every GET endpoint over POST as required by formPost."""

    def __init__(self, *args, **kwargs) -> None:
        kwargs.setdefault("route_class", OpenSubsonicFormPostRoute)
        super().__init__(*args, **kwargs)

    def add_api_route(
        self,
        path: str,
        endpoint,
        *,
        methods: Collection[str] | None = None,
        **kwargs: object,
    ) -> None:
        normalized_methods = {method.upper() for method in (methods or {"GET"})}
        if "GET" in normalized_methods:
            normalized_methods.add("POST")
        methods = normalized_methods
        super().add_api_route(path, endpoint, methods=methods, **kwargs)


__all__ = ["OpenSubsonicAPIRouter", "OpenSubsonicFormPostRoute"]
