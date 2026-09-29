import os
from urllib.parse import urlsplit, urlunsplit


def public_share_url(path: str) -> str:
    """Make a share path absolute when the instance has a canonical Listen URL."""
    normalized_path = path if path.startswith("/") else f"/{path}"
    configured_base = os.environ.get("CRATE_PUBLIC_LISTEN_BASE_URL", "").strip()
    if not configured_base:
        return normalized_path

    try:
        parsed_base = urlsplit(configured_base)
        parsed_path = urlsplit(normalized_path)
    except ValueError:
        return normalized_path

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
        return normalized_path

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
