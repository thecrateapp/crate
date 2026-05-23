from __future__ import annotations

from urllib.parse import urlparse

import requests

from crate.bandcamp.models import BandcampFanIdentity, BandcampSessionMaterial


BANDCAMP_ALLOWED_HOSTS = {"bandcamp.com", "www.bandcamp.com"}


class BandcampClientError(RuntimeError):
    pass


def is_bandcamp_host(hostname: str | None) -> bool:
    host = (hostname or "").lower().strip(".")
    return host in BANDCAMP_ALLOWED_HOSTS or host.endswith(".bandcamp.com")


def assert_bandcamp_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not is_bandcamp_host(parsed.hostname):
        raise BandcampClientError("Only Bandcamp URLs are allowed")
    return url


def session_material_from_payload(payload: dict) -> BandcampSessionMaterial:
    cookies = payload.get("cookies") or {}
    if not isinstance(cookies, dict) or not cookies:
        raise BandcampClientError("Bandcamp session cookies are required")
    profile_payload = payload.get("profile") or {}
    if not isinstance(profile_payload, dict):
        profile_payload = {}
    profile = BandcampFanIdentity(
        username=str(profile_payload.get("username") or ""),
        fan_id=int(profile_payload["fan_id"])
        if profile_payload.get("fan_id")
        else None,
        display_name=str(profile_payload.get("display_name") or ""),
        image_url=str(profile_payload.get("image_url") or ""),
    )
    if not profile.username and not profile.fan_id:
        raise BandcampClientError("Bandcamp fan identity is required")
    return BandcampSessionMaterial(
        cookies={str(key): str(value) for key, value in cookies.items()},
        profile=profile,
        raw=payload,
    )


class BandcampClient:
    def __init__(self, session: BandcampSessionMaterial, *, timeout: float = 10.0):
        self.session = session
        self.timeout = timeout

    def validate_session(self) -> BandcampFanIdentity:
        """Validate enough identity to attach the session to a Crate user.

        Native connectors can send a verified profile with the cookie jar. If
        they cannot, we try a cheap fan-page request and keep the result
        conservative; collection sync will revalidate before importing.
        """
        if self.session.profile.username or self.session.profile.fan_id:
            return self.session.profile

        response = requests.get(
            "https://bandcamp.com",
            cookies=self.session.cookies,
            timeout=self.timeout,
        )
        if response.status_code >= 400:
            raise BandcampClientError("Bandcamp session validation failed")
        raise BandcampClientError("Bandcamp fan identity is required")
