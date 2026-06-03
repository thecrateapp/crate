from __future__ import annotations

import html
import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, Response

from crate.api._deps import library_path
from crate.api.browse_shared import ARTIST_PHOTO_NAMES
from crate.api.image_variants import build_image_response
from crate.db.repositories.library_album_reads import (
    get_library_album_by_entity_uid,
    get_library_album_by_id,
    get_library_albums,
)
from crate.db.repositories.library_artist_reads import (
    get_library_artist,
    get_library_artist_by_entity_uid,
    get_library_artist_by_id,
    get_library_artist_by_slug,
)
from crate.db.repositories.library_track_reads import (
    get_library_track_by_entity_uid,
    get_library_track_by_id,
)
from crate.slugs import build_artist_slug, build_public_album_slug, build_track_slug
from crate.storage_layout import resolve_artist_dir

router = APIRouter(tags=["share"])

_PREVIEW_HEADERS = {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    "X-Robots-Tag": "noindex, nofollow",
}
_IMAGE_HEADERS = {
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
}
LibraryRow = Mapping[str, Any]


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except (TypeError, ValueError):
        return False


def _origin(request: Request) -> str:
    proto = (
        request.headers.get("x-forwarded-proto") or request.url.scheme or "https"
    ).split(",")[0]
    host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or request.url.netloc
    ).split(",")[0]
    return f"{proto}://{host}"


def _absolute_url(request: Request, path: str) -> str:
    if path.startswith("http://") or path.startswith("https://"):
        return path
    return f"{_origin(request)}{path if path.startswith('/') else f'/{path}'}"


def _canonical_url(request: Request) -> str:
    return _absolute_url(request, request.url.path)


def _safe_text(value: object) -> str:
    return html.escape(str(value or ""), quote=True)


def _encode(value: object) -> str:
    return quote(str(value), safe="")


def _artist_app_path(artist: LibraryRow) -> str:
    slug = artist.get("slug") or build_artist_slug(artist.get("name"))
    return f"/artists/{_encode(slug)}"


def _album_app_path(album: LibraryRow, artist: LibraryRow | None = None) -> str:
    artist_slug = (
        (artist or {}).get("slug") or build_artist_slug(album.get("artist")) or "artist"
    )
    album_slug = album.get("slug") or build_public_album_slug(album.get("name"))
    public_album_slug = build_public_album_slug(album.get("name") or album_slug)
    if artist_slug and public_album_slug:
        return f"/artists/{_encode(artist_slug)}/{_encode(public_album_slug)}"
    return f"/albums/{album['id']}/{_encode(album_slug or 'album')}"


def _track_app_path(
    track: LibraryRow,
    album: LibraryRow | None,
    artist: LibraryRow | None,
) -> str:
    if album:
        path = _album_app_path(album, artist)
    else:
        slug = build_track_slug(
            track.get("artist"), track.get("title"), track.get("filename")
        )
        path = (
            f"/tracks/{_encode(track.get('entity_uid') or track['id'])}/{_encode(slug)}"
        )
    if track.get("entity_uid"):
        return f"{path}?track={_encode(track['entity_uid'])}"
    return path


def _resolve_artist(ref: str) -> LibraryRow | None:
    if _is_uuid(ref):
        return get_library_artist_by_entity_uid(ref)
    if ref.isdigit():
        return get_library_artist_by_id(int(ref))
    return get_library_artist_by_slug(ref)


def _resolve_album(ref: str) -> LibraryRow | None:
    if _is_uuid(ref):
        return get_library_album_by_entity_uid(ref)
    if ref.isdigit():
        return get_library_album_by_id(int(ref))
    return None


def _resolve_track(ref: str) -> LibraryRow | None:
    if _is_uuid(ref):
        return get_library_track_by_entity_uid(ref)
    if ref.isdigit():
        return get_library_track_by_id(int(ref))
    return None


def _share_image_path(kind: str, ref: object) -> str:
    return f"/share/image/{kind}/{_encode(ref)}"


def _render_preview(
    request: Request,
    *,
    title: str,
    eyebrow: str,
    description: str,
    image_path: str,
    app_path: str,
    og_type: str,
) -> HTMLResponse:
    canonical_url = _canonical_url(request)
    image_url = _absolute_url(request, image_path)
    app_url = _absolute_url(request, app_path)
    site_name = "Crate"
    html_body = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#0a0a0f">
  <title>{_safe_text(title)} - Crate</title>
  <meta name="description" content="{_safe_text(description)}">
  <meta property="og:site_name" content="{site_name}">
  <meta property="og:type" content="{_safe_text(og_type)}">
  <meta property="og:title" content="{_safe_text(title)}">
  <meta property="og:description" content="{_safe_text(description)}">
  <meta property="og:url" content="{_safe_text(canonical_url)}">
  <meta property="og:image" content="{_safe_text(image_url)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="1200">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{_safe_text(title)}">
  <meta name="twitter:description" content="{_safe_text(description)}">
  <meta name="twitter:image" content="{_safe_text(image_url)}">
  <style>
    :root {{
      color-scheme: dark;
      --bg: #090a0d;
      --ink: #f7f4ec;
      --muted: rgba(247, 244, 236, 0.66);
      --line: rgba(247, 244, 236, 0.16);
      --accent: #d6ff63;
      --hot: #ff6a3d;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 28px;
      background:
        radial-gradient(circle at 18% 12%, rgba(255, 106, 61, 0.18), transparent 32rem),
        radial-gradient(circle at 84% 80%, rgba(214, 255, 99, 0.12), transparent 34rem),
        linear-gradient(145deg, #090a0d, #12141a 58%, #07080b);
      color: var(--ink);
      font-family: Poppins, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }}
    main {{
      width: min(960px, 100%);
      display: grid;
      grid-template-columns: minmax(220px, 420px) minmax(0, 1fr);
      gap: clamp(24px, 5vw, 58px);
      align-items: center;
    }}
    .art {{
      aspect-ratio: 1;
      width: 100%;
      overflow: hidden;
      border-radius: 28px;
      box-shadow: 0 28px 90px rgba(0, 0, 0, 0.48);
      background: #171a20;
      border: 1px solid var(--line);
    }}
    .art img {{
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }}
    .eyebrow {{
      color: var(--accent);
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      margin: 0 0 18px;
    }}
    h1 {{
      margin: 0;
      font-size: clamp(2.5rem, 8vw, 6.7rem);
      line-height: 0.9;
      letter-spacing: 0;
      text-wrap: balance;
    }}
    p {{
      max-width: 38rem;
      margin: 22px 0 0;
      color: var(--muted);
      font-size: clamp(1rem, 2vw, 1.18rem);
      line-height: 1.55;
    }}
    a {{
      display: inline-flex;
      margin-top: 30px;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      padding: 0 20px;
      border-radius: 999px;
      color: #08090c;
      background: var(--accent);
      font-weight: 800;
      text-decoration: none;
      box-shadow: 0 14px 40px rgba(214, 255, 99, 0.24);
    }}
    .brand {{
      position: fixed;
      left: 24px;
      bottom: 20px;
      color: rgba(247, 244, 236, 0.48);
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }}
    @media (max-width: 760px) {{
      body {{ padding: 22px; place-items: start center; }}
      main {{ grid-template-columns: 1fr; gap: 28px; }}
      .art {{ border-radius: 22px; }}
      h1 {{ font-size: clamp(2.35rem, 15vw, 4.7rem); }}
      .brand {{ position: static; margin-top: 34px; }}
    }}
  </style>
</head>
<body>
  <main>
    <div class="art"><img src="{_safe_text(image_url)}" alt=""></div>
    <section>
      <p class="eyebrow">{_safe_text(eyebrow)}</p>
      <h1>{_safe_text(title)}</h1>
      <p>{_safe_text(description)}</p>
      <a href="{_safe_text(app_url)}">Open in Crate</a>
    </section>
  </main>
  <div class="brand">Crate</div>
</body>
</html>"""
    return HTMLResponse(html_body, headers=_PREVIEW_HEADERS)


@router.get("/share/artist/{artist_ref}", include_in_schema=False)
@router.get("/share/artist/{artist_ref}/{slug}", include_in_schema=False)
def share_artist(
    request: Request, artist_ref: str, slug: str | None = None
) -> HTMLResponse:
    artist = _resolve_artist(artist_ref)
    if not artist:
        raise HTTPException(status_code=404, detail="Artist not found")
    name = str(artist.get("name") or "Unknown artist")
    description = (
        f"Explore {artist.get('album_count') or 0} albums and "
        f"{artist.get('track_count') or 0} tracks by {name} on Crate."
    )
    return _render_preview(
        request,
        title=name,
        eyebrow="Artist",
        description=description,
        image_path=_share_image_path(
            "artist", artist.get("entity_uid") or artist["id"]
        ),
        app_path=_artist_app_path(artist),
        og_type="profile",
    )


@router.get("/share/album/{album_ref}", include_in_schema=False)
@router.get("/share/album/{album_ref}/{slug}", include_in_schema=False)
def share_album(
    request: Request, album_ref: str, slug: str | None = None
) -> HTMLResponse:
    album = _resolve_album(album_ref)
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")
    artist = get_library_artist(str(album.get("artist") or ""))
    title = str(album.get("name") or "Unknown album")
    artist_name = str(album.get("artist") or "Unknown artist")
    description = (
        f"Listen to {title} by {artist_name} on Crate. "
        f"{album.get('track_count') or 0} tracks"
        f"{f', {album.get('year')}' if album.get('year') else ''}."
    )
    return _render_preview(
        request,
        title=title,
        eyebrow=f"Album by {artist_name}",
        description=description,
        image_path=_share_image_path("album", album.get("entity_uid") or album["id"]),
        app_path=_album_app_path(album, artist),
        og_type="music.album",
    )


@router.get("/share/track/{track_ref}", include_in_schema=False)
@router.get("/share/track/{track_ref}/{slug}", include_in_schema=False)
def share_track(
    request: Request, track_ref: str, slug: str | None = None
) -> HTMLResponse:
    track = _resolve_track(track_ref)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    album = (
        get_library_album_by_id(int(track["album_id"]))
        if track.get("album_id") is not None
        else None
    )
    artist = get_library_artist(str(track.get("artist") or ""))
    title = str(track.get("title") or track.get("filename") or "Unknown track")
    artist_name = str(track.get("artist") or "Unknown artist")
    album_name = str(track.get("album") or (album or {}).get("name") or "")
    description = f"Listen to {title} by {artist_name} on Crate."
    if album_name:
        description = f"{description} From {album_name}."
    image_ref = (
        (album or {}).get("entity_uid")
        or (album or {}).get("id")
        or track.get("album_id")
        or track.get("entity_uid")
        or track["id"]
    )
    return _render_preview(
        request,
        title=title,
        eyebrow=f"Track by {artist_name}",
        description=description,
        image_path=_share_image_path("album", image_ref),
        app_path=_track_app_path(track, album, artist),
        og_type="music.song",
    )


@router.get("/share/image/album/{album_ref}", include_in_schema=False)
def share_album_image(
    album_ref: str,
    size: int | None = Query(1200, ge=32, le=2048),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
) -> Response:
    album = _resolve_album(album_ref)
    if not album:
        return _placeholder_image(album_ref, size=size, image_format=image_format)

    from crate.api.browse_album import api_cover_by_id

    return api_cover_by_id(
        int(album["id"]),
        size=size,
        image_format=image_format,
    )


@router.get("/share/image/artist/{artist_ref}", include_in_schema=False)
def share_artist_image(
    artist_ref: str,
    size: int | None = Query(1200, ge=32, le=2048),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
) -> Response:
    artist = _resolve_artist(artist_ref)
    if not artist:
        return _placeholder_image(artist_ref, size=size, image_format=image_format)

    artist_dir = resolve_artist_dir(
        library_path(),
        artist,
        fallback_name=str(artist.get("name") or ""),
        existing_only=True,
    )
    if artist_dir and artist_dir.is_dir():
        for photo_name in ARTIST_PHOTO_NAMES:
            photo = Path(artist_dir) / photo_name
            if photo.exists():
                media_type = "image/jpeg" if photo.suffix == ".jpg" else "image/png"
                return build_image_response(
                    photo.read_bytes(),
                    media_type,
                    size=size,
                    output_format=image_format,
                    headers=_IMAGE_HEADERS,
                )

    albums = get_library_albums(str(artist.get("name") or ""))
    cover_album = next((album for album in albums if album.get("has_cover")), None)
    if cover_album:
        from crate.api.browse_album import api_cover_by_id

        return api_cover_by_id(
            int(cover_album["id"]),
            size=size,
            image_format=image_format,
        )

    return _placeholder_image(artist.get("name"), size=size, image_format=image_format)


def _placeholder_image(
    seed: object,
    *,
    size: int | None,
    image_format: str | None,
) -> Response:
    label = (str(seed or "?").strip()[:1] or "?").upper()
    hue = sum(ord(char) for char in str(seed or "?")) % 360
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200">'
        "<defs>"
        f'<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0%" stop-color="hsl({hue},45%,28%)"/>'
        f'<stop offset="100%" stop-color="hsl({(hue + 38) % 360},35%,12%)"/>'
        "</linearGradient>"
        "</defs>"
        '<rect width="1200" height="1200" fill="url(#g)"/>'
        f'<text x="600" y="690" font-family="sans-serif" font-size="440" '
        f'font-weight="800" fill="rgba(255,255,255,0.42)" text-anchor="middle">{_safe_text(label)}</text>'
        "</svg>"
    )
    return build_image_response(
        svg.encode("utf-8"),
        "image/svg+xml",
        size=size,
        output_format=image_format,
        headers=_IMAGE_HEADERS,
    )
