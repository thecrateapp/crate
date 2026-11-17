"""Minimal client for the Crate Software Factory's bug API (`/v1/bugs`).

Synchronous httpx against the factory URL of the Launch fix settings, usually its
bugs listener on the tailnet, with the factory's bugs token. Same rules as the
GitHub client: no retries (a submission starts work; the run id is its
idempotency key), no redirects, no proxies from the environment and a 15 s
timeout. Errors never carry the token or a response body; bodies are read only
from successful answers, at most `MAX_RESPONSE_BYTES`, and must be the factory's
`{"data": ...}` envelope. The one exception is a `409`, whose error code is read
from at most `MAX_ERROR_BYTES` and kept only when it is one of `CONFLICT_CODES`.

Never call this from an HTTP request handler: only the error fix tasks do.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from typing import Any

import httpx

REQUEST_TIMEOUT_SECONDS = 15.0
MAX_RESPONSE_BYTES = 256 * 1024
MAX_ERROR_BYTES = 4 * 1024
# The factory's reasons for refusing a submission with 409, and Crate's codes.
CONFLICT_CODES = {
    "BUG_IN_PROGRESS": (
        "FACTORY_BUG_IN_PROGRESS",
        "The factory already has an open bug for this issue",
    ),
    "BUG_LIMIT": (
        "FACTORY_BUG_LIMIT",
        "The factory has reached its limit of open bugs for this repository",
    ),
    "IDEMPOTENCY_CONFLICT": (
        "FACTORY_IDEMPOTENCY_CONFLICT",
        "The factory already received this run with different content",
    ),
}
_BUG_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_RUN_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,99}$")

_STATUS_ERRORS = {
    401: ("FACTORY_AUTH", "The factory rejected the token"),
    403: ("FACTORY_FORBIDDEN", "The factory refused this caller or token"),
    404: ("FACTORY_NOT_FOUND", "The factory has no such bug"),
    409: (
        "FACTORY_CONFLICT",
        "The factory refused: the bug is already open there, its repository is "
        "full or inactive, or the bug already ended",
    ),
    413: ("FACTORY_VALIDATION", "The factory refused the bug: it is too large"),
    422: ("FACTORY_VALIDATION", "The factory refused the bug's content"),
    428: ("FACTORY_VALIDATION", "The factory needs an idempotency key"),
    429: ("FACTORY_RATE_LIMITED", "The factory is busy; try again later"),
}


class FactoryAPIError(Exception):
    def __init__(self, code: str, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def _conflict_code(response: httpx.Response) -> str | None:
    """The factory's error code of a 409, read from a bounded body."""
    body = b""
    for chunk in response.iter_bytes():
        body += chunk
        if len(body) > MAX_ERROR_BYTES:
            return None
    try:
        answer = json.loads(body)
    except ValueError:
        return None
    code = answer.get("code") if isinstance(answer, dict) else None
    return code if isinstance(code, str) else None


def _raise_for_status(response: httpx.Response) -> None:
    status = response.status_code
    if 200 <= status < 300:
        return
    if status == 409:
        known = CONFLICT_CODES.get(_conflict_code(response) or "")
        if known is not None:
            raise FactoryAPIError(*known, status=status)
    if status in _STATUS_ERRORS:
        code, message = _STATUS_ERRORS[status]
        raise FactoryAPIError(code, message, status=status)
    if status >= 500:
        raise FactoryAPIError(
            "FACTORY_SERVER", "The factory returned a server error", status=status
        )
    if 300 <= status < 400:
        raise FactoryAPIError(
            "FACTORY_REDIRECT", "The factory answered with a redirect", status=status
        )
    raise FactoryAPIError(
        f"FACTORY_HTTP_{status}", "The factory rejected the request", status=status
    )


def _unexpected() -> FactoryAPIError:
    return FactoryAPIError(
        "FACTORY_UNEXPECTED_RESPONSE", "The factory sent an unexpected answer"
    )


def _bug_id(value: Any) -> str:
    if not isinstance(value, str) or not _BUG_ID.match(value):
        raise ValueError("Invalid factory bug id")
    return value


class FactoryClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        transport: httpx.BaseTransport | None = None,
        timeout: float = REQUEST_TIMEOUT_SECONDS,
    ) -> None:
        self._client = httpx.Client(
            base_url=base_url,
            timeout=timeout,
            follow_redirects=False,
            trust_env=False,
            transport=transport,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "User-Agent": "crate-error-inbox",
            },
        )

    def __enter__(self) -> FactoryClient:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def _call(
        self,
        method: str,
        path: str,
        *,
        body: Any = None,
        headers: Mapping[str, str] | None = None,
        params: Mapping[str, str] | None = None,
    ) -> Any:
        """One request; the `data` of the answer. Never retried."""
        try:
            with self._client.stream(
                method,
                path,
                json=body,
                headers=dict(headers) if headers else None,
                params=dict(params) if params else None,
            ) as response:
                _raise_for_status(response)
                chunks: list[bytes] = []
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise FactoryAPIError(
                            "FACTORY_RESPONSE_TOO_LARGE",
                            "The factory sent more than Crate reads",
                        )
                    chunks.append(chunk)
        except FactoryAPIError:
            raise
        except httpx.TimeoutException:
            raise FactoryAPIError(
                "FACTORY_TIMEOUT", "The factory did not answer in time"
            ) from None
        except (httpx.HTTPError, OSError):
            # Never chain: transport errors may echo request data.
            raise FactoryAPIError(
                "FACTORY_UNAVAILABLE", "The factory could not be reached"
            ) from None
        try:
            answer = json.loads(b"".join(chunks))
        except ValueError:
            answer = None
        if not isinstance(answer, dict) or "data" not in answer:
            raise _unexpected()
        return answer["data"]

    def _object(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        data = self._call(*args, **kwargs)
        if not isinstance(data, dict):
            raise _unexpected()
        return data

    def submit_bug(self, bug: Mapping[str, Any]) -> dict[str, Any]:
        """`POST /v1/bugs`; the bug's `run_id` is the idempotency key. A replay of
        the same run answers with the bug it already created."""
        run_id = bug.get("run_id")
        if not isinstance(run_id, str) or not _RUN_ID.match(run_id):
            raise ValueError("Invalid run id")
        return self._object(
            "POST", "/v1/bugs", body=dict(bug), headers={"Idempotency-Key": run_id}
        )

    def find_bug(
        self, short_id: str, repository: str, run_id: str
    ) -> dict[str, Any] | None:
        """The bug a submission of `run_id` created, if any (newest 50 of the issue).

        For a submission whose answer was lost: it never submits again.
        """
        bugs = self._call(
            "GET",
            "/v1/bugs",
            params={"short_id": short_id, "repository": repository},
        )
        if not isinstance(bugs, list):
            raise _unexpected()
        return next(
            (
                bug
                for bug in bugs
                if isinstance(bug, dict) and bug.get("external_run_id") == run_id
            ),
            None,
        )

    def get_bug(self, bug_id: str) -> dict[str, Any]:
        return self._object("GET", f"/v1/bugs/{_bug_id(bug_id)}")

    def cancel_bug(self, bug_id: str) -> bool:
        """Cancel a bug and its run; False when it had already ended."""
        try:
            self._object("POST", f"/v1/bugs/{_bug_id(bug_id)}/cancel")
        except FactoryAPIError as error:
            if error.status == 409:
                return False
            raise
        return True


__all__ = [
    "CONFLICT_CODES",
    "MAX_RESPONSE_BYTES",
    "FactoryAPIError",
    "FactoryClient",
]
