from __future__ import annotations

import base64
import hashlib
import html
import json
import logging
import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response

from crate.api._deps import COVER_NAMES, library_path
from crate.api.artwork_delivery import deliver_artwork
from crate.api.browse_shared import ARTIST_PHOTO_NAMES
from crate.api.share_crate_assets import (
    OG_COVER_LIMIT,
    OG_LOCALES,
    crate_copy,
    load_cover,
    negotiate_language,
    placeholder_png,
    plural,
    render_crate_og_image,
)
from crate.artwork_variants import ArtworkAsset
from crate.db.cache_runtime import get_redis
from crate.db.queries.global_catalog import (
    GlobalCatalogPublicRouteConflict,
    get_global_album_detail_by_public_slugs,
    get_global_artist_page_by_public_slug,
    get_global_track_info,
)
from crate.db.queries.crates import (
    get_crate_for_user,
    is_album_in_public_crate,
    resolve_crate_ref,
)
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
from crate.federation.global_artwork import (
    GlobalAlbumNotFound,
    NoArtworkSource,
    resolve_global_album_artwork,
)
from crate.slugs import build_artist_slug, build_public_album_slug, build_track_slug
from crate.storage_layout import resolve_album_dir, resolve_artist_dir

log = logging.getLogger(__name__)
router = APIRouter(tags=["share"])

_PREVIEW_HEADERS = {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    "X-Robots-Tag": "noindex, nofollow",
}
_IMAGE_HEADERS = {
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"
}
LibraryRow = Mapping[str, Any]
_RESERVED_ARTIST_CHILD_SLUGS = {"top-tracks", "shows", "radio"}


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
        if public_album_slug in _RESERVED_ARTIST_CHILD_SLUGS:
            return (
                f"/artists/{_encode(artist_slug)}/albums/{_encode(public_album_slug)}"
            )
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


def _global_track_app_path(track: LibraryRow) -> str:
    track_ref = track.get("global_track_uid")
    artist_name = str(track.get("artist") or "").strip()
    album_name = str(track.get("album") or "").strip()
    if artist_name and album_name:
        path = _album_app_path({"artist": artist_name, "name": album_name})
        return f"{path}?track={_encode(track_ref)}" if track_ref else path
    query = quote(
        " ".join(
            str(track.get(key) or "")
            for key in ("artist", "album", "title")
            if track.get(key)
        ).strip(),
        safe="",
    )
    return f"/search?q={query}" if query else "/search"


def _resolve_artist(ref: str) -> LibraryRow | None:
    if _is_uuid(ref):
        return get_library_artist_by_entity_uid(ref)
    if ref.isdigit():
        return get_library_artist_by_id(int(ref))
    artist = get_library_artist_by_slug(ref)
    if artist:
        return artist
    page = get_global_artist_page_by_public_slug(ref)
    return page.get("artist") if page else None


def _resolve_album(ref: str) -> LibraryRow | None:
    if _is_uuid(ref):
        return get_library_album_by_entity_uid(ref)
    if ref.isdigit():
        return get_library_album_by_id(int(ref))
    return None


def _resolve_album_by_public_slugs(
    artist_slug: str, album_slug: str
) -> LibraryRow | None:
    artist = get_library_artist_by_slug(artist_slug)
    if artist:
        matches = [
            album
            for album in get_library_albums(str(artist.get("name") or ""))
            if build_public_album_slug(str(album.get("name") or "")) == album_slug
        ]
        if len(matches) == 1:
            return matches[0]
    return get_global_album_detail_by_public_slugs(artist_slug, album_slug)


def _resolve_track(ref: str) -> LibraryRow | None:
    if _is_uuid(ref):
        return get_library_track_by_entity_uid(ref) or get_global_track_info(ref)
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
    try:
        artist = _resolve_artist(artist_ref)
    except GlobalCatalogPublicRouteConflict:
        raise HTTPException(status_code=409, detail="Ambiguous artist route") from None
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
        image_path=(
            f"/api/catalog/artists/{_encode(artist['global_artist_uid'])}/photo"
            if not artist.get("id") and artist.get("global_artist_uid")
            else _share_image_path(
                "artist",
                artist.get("entity_uid") or artist.get("id") or artist.get("name"),
            )
        ),
        app_path=_artist_app_path(artist),
        og_type="profile",
    )


@router.get("/share/album/{album_ref}", include_in_schema=False)
@router.get("/share/album/{album_ref}/{slug}", include_in_schema=False)
def share_album(
    request: Request, album_ref: str, slug: str | None = None
) -> HTMLResponse:
    try:
        album = _resolve_album(album_ref)
        if not album and slug:
            album = _resolve_album_by_public_slugs(album_ref, slug)
    except GlobalCatalogPublicRouteConflict:
        raise HTTPException(status_code=409, detail="Ambiguous album route") from None
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
        image_path=(
            f"/api/catalog/albums/{_encode(album['global_album_uid'])}/cover"
            if not album.get("id") and album.get("global_album_uid")
            else _share_image_path(
                "album",
                album.get("entity_uid") or album.get("id") or album.get("name"),
            )
        ),
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
    is_global_track = bool(track.get("global_track_uid") and not track.get("id"))
    title = str(track.get("title") or track.get("filename") or "Unknown track")
    artist_name = str(track.get("artist") or "Unknown artist")
    album_name = str(track.get("album") or (album or {}).get("name") or "")
    description = f"Listen to {title} by {artist_name} on Crate."
    if album_name:
        description = f"{description} From {album_name}."
    image_path = (
        f"/api/catalog/albums/{_encode(track['global_album_uid'])}/cover"
        if is_global_track and track.get("global_album_uid")
        else _share_image_path(
            "album",
            (album or {}).get("entity_uid")
            or (album or {}).get("id")
            or track.get("album_id")
            or track.get("entity_uid")
            or track.get("global_track_uid")
            or track["id"],
        )
    )
    return _render_preview(
        request,
        title=title,
        eyebrow=f"Track by {artist_name}",
        description=description,
        image_path=image_path,
        app_path=(
            _global_track_app_path(track)
            if is_global_track
            else _track_app_path(track, album, artist)
        ),
        og_type="music.song",
    )


_CRATE_OG_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
_CRATE_OG_RENDER_VERSION = 1
_CRATE_FAN_SLOTS = (
    ("0px", "0deg", "1", 5),
    ("110px", "-34deg", "0.8", 4),
    ("-110px", "34deg", "0.8", 4),
    ("190px", "-46deg", "0.64", 3),
    ("-190px", "46deg", "0.64", 3),
)


def _request_language(request: Request, requested: str | None = None) -> str:
    return negotiate_language(request.headers.get("accept-language"), requested)


def _crate_display_albums(crate: Mapping[str, Any]) -> list[dict]:
    albums = [dict(album) for album in crate.get("albums") or []]
    if crate.get("is_ordered", True) and crate.get("sort_direction") == "desc":
        albums.reverse()
    return albums


def _crate_owner_name(crate: Mapping[str, Any], copy: Mapping[str, str]) -> str:
    return str(
        crate.get("owner_name") or crate.get("owner_username") or copy["owner_fallback"]
    )


def _public_crate(crate_ref: str) -> dict | None:
    crate_id = resolve_crate_ref(crate_ref)
    if crate_id is None:
        return None
    crate, access = get_crate_for_user(crate_id, None)
    if access != "public" or crate is None:
        return None
    return crate


def _crate_album_cover_path(crate_ref: str, album_uid: object, size: int) -> str:
    return (
        f"/share/image/crate/{_encode(crate_ref)}/album/{_encode(album_uid)}"
        f"?size={size}"
    )


def _usable_avatar_url(value: object) -> str | None:
    avatar = str(value or "").strip()
    if avatar.startswith(("https://", "http://")):
        return avatar
    if avatar.startswith("/") and not avatar.startswith("//"):
        return avatar
    return None


_SHARE_PAGE_STYLE = """
    :root {
      color-scheme: dark;
      --bg: #0a0a0f;
      --surface: rgba(255, 255, 255, 0.04);
      --line: rgba(255, 255, 255, 0.08);
      --ink: #f1f5f9;
      --muted: #94a3b8;
      --accent: #06b6d4;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 50% -10%, rgba(6, 182, 212, 0.16), transparent 38rem),
        var(--bg);
      color: var(--ink);
      font-family: Poppins, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    a { color: inherit; }
    .page { width: min(1040px, 100%); margin: 0 auto; padding: 28px 24px 64px; }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      font-size: 0.8rem;
      text-decoration: none;
    }
    .brand img { width: 28px; height: 28px; border-radius: 8px; }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
      gap: 48px;
      align-items: center;
      margin-top: 40px;
    }
    .fan { position: relative; height: 320px; perspective: 1200px; }
    .hero-copy { position: relative; z-index: 6; min-width: 0; }
    .fan .cover {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 220px;
      aspect-ratio: 1;
      border-radius: 14px;
      overflow: hidden;
      background: #171a22;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
      transform: translate(-50%, -50%) translateX(var(--x)) rotateY(var(--r)) scale(var(--s));
      z-index: var(--z);
    }
    .cover img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .cover .initial, .thumb .initial {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      font-weight: 800;
      color: rgba(255, 255, 255, 0.42);
      background: linear-gradient(135deg, #1e293b, #0f172a);
    }
    .cover .initial { font-size: 5rem; }
    .eyebrow {
      margin: 0 0 12px;
      color: var(--accent);
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: clamp(2.2rem, 5.4vw, 3.8rem);
      line-height: 1.02;
      text-wrap: balance;
    }
    .owner { display: flex; align-items: center; gap: 10px; margin-top: 18px; color: var(--muted); }
    .owner img { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }
    .description { margin: 18px 0 0; color: var(--muted); line-height: 1.6; max-width: 34rem; }
    .stats { margin: 16px 0 0; color: var(--muted); font-size: 0.92rem; }
    .cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      margin-top: 28px;
      padding: 0 24px;
      border-radius: 999px;
      background: var(--accent);
      color: #031318;
      font-weight: 700;
      text-decoration: none;
      box-shadow: 0 14px 40px rgba(6, 182, 212, 0.28);
    }
    .albums { margin-top: 56px; }
    .albums h2 { margin: 0 0 16px; font-size: 1.1rem; }
    .albums ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    .albums li {
      display: grid;
      grid-template-columns: auto 56px minmax(0, 1fr);
      gap: 14px;
      align-items: center;
      padding: 8px 10px;
      border-radius: 12px;
    }
    .albums li:nth-child(odd) { background: var(--surface); }
    .rank { min-width: 2ch; color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; }
    .unranked .rank { display: none; }
    .unranked li { grid-template-columns: 56px minmax(0, 1fr); }
    .thumb { width: 56px; height: 56px; border-radius: 8px; overflow: hidden; background: #171a22; }
    .thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
    .album-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .album-meta { color: var(--muted); font-size: 0.88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .missing { min-height: 70vh; display: grid; place-content: center; text-align: center; gap: 8px; }
    .missing p { color: var(--muted); }
    @media (max-width: 760px) {
      .page { padding: 20px 18px 48px; }
      .hero { grid-template-columns: 1fr; gap: 24px; margin-top: 24px; }
      .fan { height: 230px; }
      .fan .cover { width: 160px; }
      .fan .cover:nth-child(n + 4) { display: none; }
      .cta { width: 100%; }
    }
"""


def _share_page_head(
    request: Request,
    *,
    language: str,
    title: str,
    description: str,
    image_url: str | None,
) -> str:
    image_tags = ""
    if image_url:
        image_tags = f"""
  <meta property="og:image" content="{_safe_text(image_url)}">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="{_safe_text(title)}">
  <meta name="twitter:image" content="{_safe_text(image_url)}">"""
    return f"""<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#0a0a0f">
  <title>{_safe_text(title)} · Crate</title>
  <meta name="description" content="{_safe_text(description)}">
  <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
  <link rel="apple-touch-icon" href="/icons/icon-192.png">
  <meta property="og:site_name" content="Crate">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="{OG_LOCALES[language]}">
  <meta property="og:title" content="{_safe_text(title)}">
  <meta property="og:description" content="{_safe_text(description)}">
  <meta property="og:url" content="{_safe_text(_canonical_url(request))}">{image_tags}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{_safe_text(title)}">
  <meta name="twitter:description" content="{_safe_text(description)}">
  <style>{_SHARE_PAGE_STYLE}</style>
</head>"""


def _brand_link(request: Request) -> str:
    return (
        f'<a class="brand" href="{_safe_text(_absolute_url(request, "/"))}">'
        '<img src="/icons/icon-192.png" alt="">Crate</a>'
    )


def _album_initial(album: Mapping[str, Any]) -> str:
    label = (str(album.get("name") or "?").strip()[:1] or "?").upper()
    return f'<span class="initial">{_safe_text(label)}</span>'


def _album_artwork(crate_ref: str, album: Mapping[str, Any], size: int) -> str:
    if not album.get("has_cover") or not album.get("global_album_uid"):
        return _album_initial(album)
    src = _crate_album_cover_path(crate_ref, album["global_album_uid"], size)
    return f'<img src="{_safe_text(src)}" alt="" loading="lazy" decoding="async">'


def _render_crate_page(
    request: Request, crate: Mapping[str, Any], language: str
) -> HTMLResponse:
    copy = crate_copy(language)
    crate_ref = str(crate.get("public_ref") or crate["id"])
    title = str(crate.get("name") or "Crate")
    owner_name = _crate_owner_name(crate, copy)
    albums = _crate_display_albums(crate)
    album_count = int(crate.get("album_count") or len(albums))
    albums_label = plural(copy, "album", album_count)
    description = str(crate.get("description") or "").strip() or copy[
        "fallback_description"
    ].format(albums=albums_label, owner=owner_name)
    follower_count = int(crate.get("follower_count") or 0)
    stats = " · ".join(
        [
            albums_label,
            plural(copy, "track", int(crate.get("track_count") or 0)),
            *([plural(copy, "follower", follower_count)] if follower_count else []),
        ]
    )
    image_url = _absolute_url(
        request, f"/share/image/crate/{_encode(crate_ref)}?lang={language}"
    )
    app_url = _absolute_url(request, f"/crate/{_encode(crate_ref)}")
    avatar_url = _usable_avatar_url(crate.get("owner_avatar"))
    avatar = (
        f'<img src="{_safe_text(avatar_url)}" alt="" referrerpolicy="no-referrer">'
        if avatar_url
        else ""
    )
    fan = "".join(
        f'<div class="cover" style="--x:{x};--r:{rotation};--s:{scale};--z:{z}">'
        f"{_album_artwork(crate_ref, album, 512)}</div>"
        for album, (x, rotation, scale, z) in zip(
            albums[:OG_COVER_LIMIT], _CRATE_FAN_SLOTS, strict=False
        )
    )
    is_ordered = bool(crate.get("is_ordered", True))
    album_items = "".join(
        "<li>"
        f'<span class="rank">{int(album.get("position") or 0) + 1}</span>'
        f'<span class="thumb">{_album_artwork(crate_ref, album, 128)}</span>'
        "<span>"
        f'<div class="album-name">{_safe_text(album.get("name"))}</div>'
        f'<div class="album-meta">{_safe_text(album.get("artist_name"))}'
        f"{f' · {_safe_text(album.get("year"))}' if album.get('year') else ''}</div>"
        "</span>"
        "</li>"
        for album in albums
    )
    albums_section = (
        f'<section class="albums"><h2>{_safe_text(copy["albums_heading"])}</h2>'
        f'<ol class="{"ranked" if is_ordered else "unranked"}">{album_items}</ol>'
        "</section>"
        if albums
        else ""
    )
    html_body = f"""<!doctype html>
<html lang="{language}">
{_share_page_head(request, language=language, title=title, description=description, image_url=image_url)}
<body>
  <div class="page">
    {_brand_link(request)}
    <main>
      <section class="hero">
        <div class="fan" aria-hidden="true">{fan}</div>
        <div class="hero-copy">
          <p class="eyebrow">Crate</p>
          <h1>{_safe_text(title)}</h1>
          <div class="owner">{avatar}<span>{_safe_text(copy["by"].format(owner=owner_name))}</span></div>
          <p class="description">{_safe_text(description)}</p>
          <p class="stats">{_safe_text(stats)}</p>
          <a class="cta" href="{_safe_text(app_url)}">{_safe_text(copy["open"])}</a>
        </div>
      </section>
      {albums_section}
    </main>
  </div>
</body>
</html>"""
    return HTMLResponse(html_body, headers=_PREVIEW_HEADERS)


def _render_crate_not_found(request: Request, language: str) -> HTMLResponse:
    copy = crate_copy(language)
    html_body = f"""<!doctype html>
<html lang="{language}">
{_share_page_head(request, language=language, title=copy["not_found_title"], description=copy["not_found_body"], image_url=None)}
<body>
  <div class="page">
    {_brand_link(request)}
    <main class="missing">
      <h1>{_safe_text(copy["not_found_title"])}</h1>
      <p>{_safe_text(copy["not_found_body"])}</p>
      <div><a class="cta" href="{_safe_text(_absolute_url(request, "/"))}">{_safe_text(copy["home"])}</a></div>
    </main>
  </div>
</body>
</html>"""
    return HTMLResponse(
        html_body,
        status_code=404,
        headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"},
    )


@router.get("/share/crate/{crate_ref}", include_in_schema=False)
def share_crate(request: Request, crate_ref: str) -> Response:
    language = _request_language(request)
    crate = _public_crate(crate_ref)
    if crate is None:
        return _render_crate_not_found(request, language)
    public_ref = crate.get("public_ref")
    if public_ref and crate_ref != public_ref:
        return RedirectResponse(
            _absolute_url(request, f"/share/crate/{_encode(public_ref)}"),
            status_code=301,
        )
    return _render_crate_page(request, crate, language)


@router.get(
    "/share/image/crate/{crate_ref}/album/{global_album_uid}",
    include_in_schema=False,
)
def share_crate_album_image(
    request: Request,
    crate_ref: str,
    global_album_uid: uuid.UUID,
    size: int | None = Query(None, ge=32, le=1024),
    image_format: str | None = Query(None, alias="format", pattern="^webp$"),
) -> Response:
    crate_id = resolve_crate_ref(crate_ref)
    if crate_id is None or not is_album_in_public_crate(
        crate_id, str(global_album_uid)
    ):
        raise HTTPException(status_code=404, detail="Album not found")

    from crate.api.catalog import serve_global_album_cover

    return serve_global_album_cover(
        request, str(global_album_uid), size=size, image_format=image_format
    )


def _local_crate_album_cover(global_album_uid: str) -> Path | None:
    try:
        selection = resolve_global_album_artwork(global_album_uid)
    except (GlobalAlbumNotFound, NoArtworkSource):
        return None
    if selection["kind"] != "local":
        return None
    album = None
    if selection.get("local_album_entity_uid"):
        album = get_library_album_by_entity_uid(
            str(selection["local_album_entity_uid"])
        )
    if album is None and selection.get("local_album_id") is not None:
        album = get_library_album_by_id(int(selection["local_album_id"]))
    if not album:
        return None
    album_dir = resolve_album_dir(
        library_path(), album, artist=get_library_artist(str(album.get("artist") or ""))
    )
    if album_dir is None or not album_dir.is_dir():
        return None
    for cover_name in COVER_NAMES:
        cover = album_dir / cover_name
        if cover.is_file():
            return cover
    return None


def _crate_og_cache_key(
    crate: Mapping[str, Any], albums: list[dict], title: str, subtitle: str, lang: str
) -> str:
    fingerprint = json.dumps(
        [
            _CRATE_OG_RENDER_VERSION,
            str(crate.get("id")),
            str(crate.get("updated_at")),
            [str(album.get("global_album_uid")) for album in albums],
            title,
            subtitle,
            lang,
        ],
        separators=(",", ":"),
    )
    return f"share:crate-og:{hashlib.sha1(fingerprint.encode(), usedforsecurity=False).hexdigest()}"


def _cached_og_image(cache_key: str) -> bytes | None:
    redis_client = get_redis()
    if redis_client is None:
        return None
    try:
        cached = redis_client.get(cache_key)
    except Exception:
        log.debug("Crate OG cache read failed", exc_info=True)
        return None
    return base64.b64decode(cached) if cached else None


def _store_og_image(cache_key: str, image: bytes) -> None:
    redis_client = get_redis()
    if redis_client is None:
        return
    try:
        redis_client.setex(
            cache_key,
            _CRATE_OG_CACHE_TTL_SECONDS,
            base64.b64encode(image).decode("ascii"),
        )
    except Exception:
        log.debug("Crate OG cache write failed", exc_info=True)


@router.get("/share/image/crate/{crate_ref}", include_in_schema=False)
def share_crate_image(
    request: Request,
    crate_ref: str,
    lang: str | None = Query(None, max_length=8),
) -> Response:
    crate = _public_crate(crate_ref)
    if crate is None:
        raise HTTPException(status_code=404, detail="Crate not found")

    language = _request_language(request, lang)
    copy = crate_copy(language)
    albums = _crate_display_albums(crate)[:OG_COVER_LIMIT]
    title = str(crate.get("name") or "Crate")
    album_count = int(crate.get("album_count") or len(crate.get("albums") or []))
    subtitle = " · ".join(
        [
            copy["by"].format(owner=_crate_owner_name(crate, copy)),
            plural(copy, "album", album_count),
        ]
    )
    cache_key = _crate_og_cache_key(crate, albums, title, subtitle, language)
    image = _cached_og_image(cache_key)
    if image is None:
        covers = []
        for album in albums:
            cover_path = (
                _local_crate_album_cover(str(album["global_album_uid"]))
                if album.get("has_cover") and album.get("global_album_uid")
                else None
            )
            covers.append(load_cover(cover_path) if cover_path else None)
        image = render_crate_og_image(
            covers=covers,
            seeds=[str(album.get("name") or "?") for album in albums],
            title=title,
            subtitle=subtitle,
        )
        _store_og_image(cache_key, image)
    return Response(content=image, media_type="image/jpeg", headers=_IMAGE_HEADERS)


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
    entity_uid = str(artist.get("entity_uid") or "")
    if artist_dir and artist_dir.is_dir():
        for photo_name in ARTIST_PHOTO_NAMES:
            photo = Path(artist_dir) / photo_name
            if photo.is_file() and entity_uid:
                return deliver_artwork(
                    ArtworkAsset("artist-photo", entity_uid),
                    requested_size=size,
                    local_original=photo,
                    missing_response=_placeholder_image(
                        artist.get("name"), size=size, image_format=image_format
                    ),
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
    del image_format
    pixels = max(32, min(int(size or 1200), 2048))
    return Response(
        content=placeholder_png(str(seed or "?"), pixels),
        media_type="image/png",
        headers=_IMAGE_HEADERS,
    )
