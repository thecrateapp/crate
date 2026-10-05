import os
from urllib.parse import urlsplit, urlunsplit


def public_share_url(path: str) -> str | None:
    """Build an absolute share URL when the instance has a canonical Listen URL."""
    normalized_path = path if path.startswith("/") else f"/{path}"
    configured_base = os.environ.get("CRATE_PUBLIC_LISTEN_BASE_URL", "").strip()
    if not configured_base:
        return None

    try:
        parsed_base = urlsplit(configured_base)
        parsed_path = urlsplit(normalized_path)
    except ValueError:
        return None

    if (
        parsed_base.scheme not in {"http", "https"}
        or not parsed_base.netloc
        or parsed_base.username is not None
        or parsed_base.password is not None
        or parsed_base.query
        or parsed_base.fragment
        or parsed_path.scheme
        or parsed_path.netloc
    ):
        return None

    base_path = parsed_base.path.rstrip("/")
    return urlunsplit(
        (
            parsed_base.scheme,
            parsed_base.netloc,
            f"{base_path}{parsed_path.path}",
            parsed_path.query,
            parsed_path.fragment,
        )
    )
