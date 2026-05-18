from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class BandcampFanIdentity:
    username: str = ""
    fan_id: int | None = None
    display_name: str = ""
    image_url: str = ""


@dataclass(frozen=True)
class BandcampSessionMaterial:
    cookies: dict[str, str] = field(default_factory=dict)
    profile: BandcampFanIdentity = field(default_factory=BandcampFanIdentity)
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class BandcampCredentialLoginResult:
    status: str
    session: BandcampSessionMaterial | None = None
    message: str = ""
    challenge_url: str = ""
