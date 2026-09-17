"""Safe proxying for the external avatar URLs stored on user records."""

from __future__ import annotations

from urllib.parse import urljoin, urlsplit

import requests


class AvatarUnavailable(Exception):
    """The user has no configured avatar or its URL is not trusted."""


class AvatarProxyError(Exception):
    """The configured avatar could not be retrieved as a valid image."""

    def __init__(self, message: str, *, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def is_proxyable_avatar_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except (TypeError, ValueError):
        return False
    if parsed.scheme != "https" or parsed.username or parsed.password:
        return False
    if port not in {None, 443}:
        return False
    host = (parsed.hostname or "").lower()
    return (
        host == "lh3.googleusercontent.com"
        or host.endswith(".googleusercontent.com")
        or host in {"www.gravatar.com", "secure.gravatar.com", "gravatar.com"}
    )


def fetch_avatar(value: str | None) -> tuple[bytes, str]:
    """Fetch an allowlisted avatar, validating redirects and image response."""
    if not value or not is_proxyable_avatar_url(value):
        raise AvatarUnavailable

    current_url = value
    for _ in range(4):
        try:
            response = requests.get(
                current_url,
                headers={"User-Agent": "Crate/1.0 (+https://cratemusic.app)"},
                timeout=8,
                allow_redirects=False,
                stream=True,
            )
        except requests.RequestException as exc:
            raise AvatarProxyError("Avatar provider request failed") from exc

        try:
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                if not location:
                    raise AvatarProxyError("Avatar redirect is missing a location")
                current_url = urljoin(current_url, location)
                if not is_proxyable_avatar_url(current_url):
                    raise AvatarUnavailable
                continue
            if response.status_code != 200:
                status_code = response.status_code
                raise AvatarProxyError(
                    "Avatar provider returned an error",
                    status_code=status_code if status_code < 500 else 502,
                )

            content_type = (
                response.headers.get("content-type", "image/jpeg")
                .split(";", 1)[0]
                .strip()
                .lower()
            )
            if not content_type.startswith("image/"):
                raise AvatarProxyError("Avatar response is not an image")

            content_length = response.headers.get("content-length")
            try:
                if content_length is not None and int(content_length) > 2_000_000:
                    raise AvatarProxyError("Avatar image is too large")
            except (TypeError, ValueError):
                pass

            content = bytearray()
            try:
                for chunk in response.iter_content(chunk_size=64 * 1024):
                    if not chunk:
                        continue
                    content.extend(chunk)
                    if len(content) > 2_000_000:
                        raise AvatarProxyError("Avatar image is too large")
            except requests.RequestException as exc:
                raise AvatarProxyError("Avatar image download failed") from exc
            return bytes(content), content_type
        finally:
            response.close()

    raise AvatarProxyError("Avatar provider redirected too many times")
