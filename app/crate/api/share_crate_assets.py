"""Localized copy and Pillow-rendered artwork for public Crate shares."""

from __future__ import annotations

import io
import logging
from collections.abc import Sequence
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

log = logging.getLogger(__name__)

SUPPORTED_LANGUAGES = ("es", "en", "ca", "eu", "fr", "de", "it")
DEFAULT_LANGUAGE = "en"

OG_LOCALES = {
    "es": "es_ES",
    "en": "en_US",
    "ca": "ca_ES",
    "eu": "eu_ES",
    "fr": "fr_FR",
    "de": "de_DE",
    "it": "it_IT",
}

CRATE_COPY: dict[str, dict[str, str]] = {
    "es": {
        "by": "Crate de {owner}",
        "open": "Abrir en Crate",
        "album_one": "{n} álbum",
        "album_other": "{n} álbumes",
        "track_one": "{n} canción",
        "track_other": "{n} canciones",
        "follower_one": "{n} seguidor",
        "follower_other": "{n} seguidores",
        "fallback_description": "Una selección de {albums} de {owner} en Crate.",
        "albums_heading": "Álbumes",
        "owner_fallback": "alguien de Crate",
        "not_found_title": "Crate no encontrado",
        "not_found_body": "Este Crate no existe o ya no es público.",
        "home": "Ir a Crate",
    },
    "en": {
        "by": "Crate by {owner}",
        "open": "Open in Crate",
        "album_one": "{n} album",
        "album_other": "{n} albums",
        "track_one": "{n} track",
        "track_other": "{n} tracks",
        "follower_one": "{n} follower",
        "follower_other": "{n} followers",
        "fallback_description": "A selection of {albums} by {owner} on Crate.",
        "albums_heading": "Albums",
        "owner_fallback": "a Crate listener",
        "not_found_title": "Crate not found",
        "not_found_body": "This Crate does not exist or is no longer public.",
        "home": "Go to Crate",
    },
    "ca": {
        "by": "Crate de {owner}",
        "open": "Obre a Crate",
        "album_one": "{n} àlbum",
        "album_other": "{n} àlbums",
        "track_one": "{n} cançó",
        "track_other": "{n} cançons",
        "follower_one": "{n} seguidor",
        "follower_other": "{n} seguidors",
        "fallback_description": "Una selecció de {albums} de {owner} a Crate.",
        "albums_heading": "Àlbums",
        "owner_fallback": "algú de Crate",
        "not_found_title": "No s'ha trobat el Crate",
        "not_found_body": "Aquest Crate no existeix o ja no és públic.",
        "home": "Ves a Crate",
    },
    "eu": {
        "by": "{owner}-ren Crate",
        "open": "Ireki Crate-n",
        "album_one": "{n} album",
        "album_other": "{n} album",
        "track_one": "{n} abesti",
        "track_other": "{n} abesti",
        "follower_one": "{n} jarraitzaile",
        "follower_other": "{n} jarraitzaile",
        "fallback_description": "{owner}-k Crate-n aukeratutako {albums}.",
        "albums_heading": "Albumak",
        "owner_fallback": "Crate erabiltzaile bat",
        "not_found_title": "Ez da Crate-a aurkitu",
        "not_found_body": "Crate hau ez dago edo jada ez da publikoa.",
        "home": "Joan Crate-ra",
    },
    "fr": {
        "by": "Crate de {owner}",
        "open": "Ouvrir dans Crate",
        "album_one": "{n} album",
        "album_other": "{n} albums",
        "track_one": "{n} titre",
        "track_other": "{n} titres",
        "follower_one": "{n} abonné",
        "follower_other": "{n} abonnés",
        "fallback_description": "Une sélection de {albums} par {owner} sur Crate.",
        "albums_heading": "Albums",
        "owner_fallback": "un auditeur de Crate",
        "not_found_title": "Crate introuvable",
        "not_found_body": "Ce Crate n'existe pas ou n'est plus public.",
        "home": "Aller sur Crate",
    },
    "de": {
        "by": "Crate von {owner}",
        "open": "In Crate öffnen",
        "album_one": "{n} Album",
        "album_other": "{n} Alben",
        "track_one": "{n} Titel",
        "track_other": "{n} Titel",
        "follower_one": "{n} Follower",
        "follower_other": "{n} Follower",
        "fallback_description": "Eine Auswahl von {albums} von {owner} auf Crate.",
        "albums_heading": "Alben",
        "owner_fallback": "jemandem auf Crate",
        "not_found_title": "Crate nicht gefunden",
        "not_found_body": "Dieses Crate existiert nicht oder ist nicht mehr öffentlich.",
        "home": "Zu Crate",
    },
    "it": {
        "by": "Crate di {owner}",
        "open": "Apri in Crate",
        "album_one": "{n} album",
        "album_other": "{n} album",
        "track_one": "{n} brano",
        "track_other": "{n} brani",
        "follower_one": "{n} follower",
        "follower_other": "{n} follower",
        "fallback_description": "Una selezione di {albums} di {owner} su Crate.",
        "albums_heading": "Album",
        "owner_fallback": "un ascoltatore di Crate",
        "not_found_title": "Crate non trovato",
        "not_found_body": "Questo Crate non esiste o non è più pubblico.",
        "home": "Vai a Crate",
    },
}

BACKGROUND_RGB = (10, 10, 15)
FOREGROUND_RGB = (241, 245, 249)
MUTED_RGB = (148, 163, 184)
ACCENT_RGB = (6, 182, 212)

OG_WIDTH = 1200
OG_HEIGHT = 630
OG_COVER_LIMIT = 5

_FONT_DIR = Path(__file__).resolve().parents[1] / "assets" / "fonts"
_COVER_SLOTS = (
    (0, 330, 0.0, 0),
    (230, 270, 0.16, 1),
    (-230, 270, 0.16, 1),
    (420, 220, 0.24, 2),
    (-420, 220, 0.24, 2),
)


def negotiate_language(
    accept_language: str | None, requested: str | None = None
) -> str:
    if requested and requested.lower() in SUPPORTED_LANGUAGES:
        return requested.lower()
    candidates: list[tuple[float, int, str]] = []
    for index, part in enumerate((accept_language or "").split(",")):
        tag, _, params = part.strip().partition(";")
        language = tag.strip().lower().split("-")[0]
        if language not in SUPPORTED_LANGUAGES:
            continue
        quality = 1.0
        if params.strip().startswith("q="):
            try:
                quality = float(params.strip()[2:])
            except ValueError:
                quality = 0.0
        if quality > 0:
            candidates.append((-quality, index, language))
    return min(candidates)[2] if candidates else DEFAULT_LANGUAGE


def crate_copy(language: str) -> dict[str, str]:
    return CRATE_COPY.get(language, CRATE_COPY[DEFAULT_LANGUAGE])


def plural(copy: dict[str, str], key: str, count: int) -> str:
    variant = "one" if count == 1 else "other"
    return copy[f"{key}_{variant}"].format(n=count)


@lru_cache(maxsize=16)
def _font(weight: int, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    font_path = _FONT_DIR / f"poppins-{weight}.woff2"
    try:
        return ImageFont.truetype(str(font_path), size)
    except OSError:
        log.warning("Share font %s is unavailable", font_path)
    return ImageFont.load_default(size=size)


def _fit_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    *,
    weight: int,
    sizes: Sequence[int],
    max_width: int,
) -> tuple[str, ImageFont.FreeTypeFont | ImageFont.ImageFont]:
    for size in sizes:
        font = _font(weight, size)
        if draw.textlength(text, font=font) <= max_width:
            return text, font
    font = _font(weight, sizes[-1])
    clipped = text
    while clipped and draw.textlength(f"{clipped}…", font=font) > max_width:
        clipped = clipped[:-1]
    return f"{clipped.rstrip()}…", font


def _seed_hue(seed: object) -> int:
    return sum(ord(char) for char in str(seed or "?")) % 360


def _hsl(hue: int, saturation: float, lightness: float) -> tuple[int, int, int]:
    chroma = (1 - abs(2 * lightness - 1)) * saturation
    segment = hue / 60
    secondary = chroma * (1 - abs(segment % 2 - 1))
    red, green, blue = [
        (chroma, secondary, 0),
        (secondary, chroma, 0),
        (0, chroma, secondary),
        (0, secondary, chroma),
        (secondary, 0, chroma),
        (chroma, 0, secondary),
    ][int(segment) % 6]
    offset = lightness - chroma / 2
    return (
        round((red + offset) * 255),
        round((green + offset) * 255),
        round((blue + offset) * 255),
    )


def _gradient_tile(seed: object, size: int) -> Image.Image:
    hue = _seed_hue(seed)
    start = _hsl(hue, 0.45, 0.28)
    end = _hsl((hue + 38) % 360, 0.35, 0.12)
    middle = tuple((a + b) // 2 for a, b in zip(start, end, strict=True))
    tile = Image.new("RGB", (2, 2))
    tile.putdata([start, middle, middle, end])
    return tile.resize((size, size), Image.Resampling.BILINEAR)


def _draw_initial(image: Image.Image, seed: object) -> Image.Image:
    size = image.width
    label = (str(seed or "?").strip()[:1] or "?").upper()
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = _font(800, max(12, int(size * 0.42)))
    draw.text(
        (size / 2, size / 2),
        label,
        font=font,
        fill=(255, 255, 255, 107),
        anchor="mm",
    )
    return Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")


@lru_cache(maxsize=64)
def placeholder_png(seed: str, size: int) -> bytes:
    image = _draw_initial(_gradient_tile(seed, size), seed)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def load_cover(path: Path, size: int = 512) -> Image.Image | None:
    try:
        with Image.open(path) as source:
            source.draft("RGB", (size, size))
            return ImageOps.fit(
                source.convert("RGB"), (size, size), Image.Resampling.LANCZOS
            )
    except (OSError, ValueError, Image.DecompressionBombError):
        log.debug("Could not read Crate cover %s", path, exc_info=True)
        return None


def _dominant_color(image: Image.Image) -> tuple[int, int, int]:
    palette_image = image.resize((64, 64)).quantize(colors=5)
    palette = palette_image.getpalette() or []
    counts = sorted(palette_image.getcolors() or [], reverse=True)
    for _, index in counts:
        red, green, blue = palette[index * 3 : index * 3 + 3]
        if max(red, green, blue) - min(red, green, blue) > 24:
            return red, green, blue
    if counts:
        index = counts[0][1]
        red, green, blue = palette[index * 3 : index * 3 + 3]
        return red, green, blue
    return ACCENT_RGB


def _background(first_cover: Image.Image | None, seed: str) -> Image.Image:
    base = first_cover or _gradient_tile(seed, 256)
    tint = _dominant_color(base)
    backdrop = ImageOps.fit(base, (OG_WIDTH, OG_HEIGHT), Image.Resampling.BILINEAR)
    backdrop = backdrop.filter(ImageFilter.GaussianBlur(48))
    tinted = Image.blend(backdrop, Image.new("RGB", backdrop.size, tint), 0.45)
    darkened = Image.blend(tinted, Image.new("RGB", tinted.size, BACKGROUND_RGB), 0.5)
    shade = Image.linear_gradient("L").resize((OG_WIDTH, OG_HEIGHT))
    return Image.composite(
        Image.new("RGB", darkened.size, BACKGROUND_RGB),
        darkened,
        shade.point(lambda value: int(value * 0.82)),
    )


def _rounded(image: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, image.width - 1, image.height - 1), radius=radius, fill=255
    )
    rounded = image.convert("RGBA")
    rounded.putalpha(mask)
    return rounded


def _perspective(image: Image.Image, squeeze: float, outer_right: bool) -> Image.Image:
    if squeeze <= 0:
        return image
    width, height = image.size
    inset = height * squeeze / 2
    if outer_right:
        quad = (0, 0, 0, height, width, height + inset, width, -inset)
    else:
        quad = (0, -inset, 0, height + inset, width, height, width, 0)
    narrowed = (int(width * (1 - squeeze * 0.9)), height)
    return image.transform(
        narrowed,
        Image.Transform.QUAD,
        quad,
        Image.Resampling.BICUBIC,
        fillcolor=(0, 0, 0, 0),
    )


def _paste_cover(
    canvas: Image.Image,
    cover: Image.Image,
    *,
    center_x: int,
    center_y: int,
    size: int,
    squeeze: float,
    depth: int,
    outer_right: bool,
) -> None:
    tile = _rounded(cover.resize((size, size), Image.Resampling.LANCZOS), 18)
    tile = _perspective(tile, squeeze, outer_right)
    if depth:
        dim = Image.new("RGBA", tile.size, (*BACKGROUND_RGB, 0))
        dim.putalpha(tile.getchannel("A").point(lambda value: value * depth // 6))
        tile = Image.alpha_composite(tile, dim)
    left = center_x - tile.width // 2
    top = center_y - tile.height // 2

    shadow = Image.new("RGBA", (tile.width + 80, tile.height + 80), (0, 0, 0, 0))
    shadow_alpha = tile.getchannel("A").point(lambda value: value * 150 // 255)
    shadow.paste((0, 0, 0, 255), (40, 52), shadow_alpha)
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    canvas.alpha_composite(shadow, (left - 40, top - 40))
    canvas.alpha_composite(tile, (left, top))


def render_crate_og_image(
    *,
    covers: Sequence[Image.Image | None],
    seeds: Sequence[str],
    title: str,
    subtitle: str,
) -> bytes:
    tiles = [
        cover if cover is not None else _draw_initial(_gradient_tile(seed, 512), seed)
        for cover, seed in zip(covers, seeds, strict=True)
    ][:OG_COVER_LIMIT]
    if not tiles:
        tiles = [_draw_initial(_gradient_tile(title, 512), title)]
    first_real_cover = next((cover for cover in covers if cover is not None), None)
    canvas = _background(first_real_cover, title).convert("RGBA")

    slots = list(enumerate(_COVER_SLOTS[: len(tiles)]))
    for index, (offset_x, size, squeeze, depth) in sorted(
        slots, key=lambda item: -item[1][3]
    ):
        _paste_cover(
            canvas,
            tiles[index],
            center_x=OG_WIDTH // 2 + offset_x,
            center_y=226,
            size=size,
            squeeze=squeeze,
            depth=depth,
            outer_right=offset_x > 0,
        )

    draw = ImageDraw.Draw(canvas)
    fitted_title, title_font = _fit_text(
        draw, title, weight=700, sizes=(60, 54, 48, 42), max_width=1040
    )
    draw.text(
        (OG_WIDTH / 2, 470),
        fitted_title,
        font=title_font,
        fill=FOREGROUND_RGB,
        anchor="mm",
    )
    fitted_subtitle, subtitle_font = _fit_text(
        draw, subtitle, weight=500, sizes=(28, 24), max_width=1000
    )
    draw.text(
        (OG_WIDTH / 2, 530),
        fitted_subtitle,
        font=subtitle_font,
        fill=MUTED_RGB,
        anchor="mm",
    )
    brand_font = _font(800, 22)
    draw.rounded_rectangle((48, 574, 60, 586), radius=3, fill=ACCENT_RGB)
    draw.text((72, 580), "CRATE", font=brand_font, fill=FOREGROUND_RGB, anchor="lm")

    buffer = io.BytesIO()
    canvas.convert("RGB").save(
        buffer, format="JPEG", quality=82, optimize=True, progressive=True
    )
    return buffer.getvalue()


__all__ = [
    "CRATE_COPY",
    "DEFAULT_LANGUAGE",
    "OG_COVER_LIMIT",
    "OG_HEIGHT",
    "OG_LOCALES",
    "OG_WIDTH",
    "SUPPORTED_LANGUAGES",
    "crate_copy",
    "load_cover",
    "negotiate_language",
    "placeholder_png",
    "plural",
    "render_crate_og_image",
]
