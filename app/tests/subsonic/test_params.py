import asyncio

from starlette.requests import Request

from crate.subsonic.params import collect_parameters


def _request(*, method: str, query: bytes, body: bytes = b"") -> Request:
    messages = [{"type": "http.request", "body": body, "more_body": False}]

    async def receive() -> dict:
        return messages.pop(0)

    headers = []
    if method == "POST":
        headers.append((b"content-type", b"application/x-www-form-urlencoded"))

    return Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": "/rest/scrobble",
            "raw_path": b"/rest/scrobble",
            "query_string": query,
            "headers": headers,
            "server": ("testserver", 80),
            "client": ("testclient", 50000),
        },
        receive,
    )


def test_query_and_form_values_preserve_repetition_and_source_order() -> None:
    request = _request(
        method="POST",
        query=b"id=1&id=2&empty=",
        body=b"id=3&id=4",
    )

    params = asyncio.run(collect_parameters(request))

    assert params.get_all("id") == ("1", "2", "3", "4")
    assert params.contains("empty")
    assert params.first("empty") == ""
    assert not params.contains("missing")
    assert params.first("missing") is None


def test_query_values_preserve_order_without_form_body() -> None:
    params = asyncio.run(
        collect_parameters(_request(method="GET", query=b"id=second&id=first"))
    )

    assert params.get_all("id") == ("second", "first")
