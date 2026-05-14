#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[3]
LOGO_SVG = ROOT / "app/listen/public/icons/logo.svg"
OUT = ROOT / "app/listen-desktop/src-tauri/icons"

APP_SIZES = [16, 32, 64, 128, 256, 512, 1024]


def render_logo(size: int) -> Image.Image:
    if not shutil.which("rsvg-convert"):
        raise RuntimeError("rsvg-convert is required to render the Crate SVG logo")

    with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
        subprocess.run(
            ["rsvg-convert", "-w", str(size), "-h", str(size), str(LOGO_SVG), "-o", tmp.name],
            check=True,
        )
        return Image.open(tmp.name).convert("RGBA")


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size, size), radius=radius, fill=255)
    return mask


def make_app_icon(size: int) -> Image.Image:
    scale = size / 1024
    inset = round(size * 0.075)
    card_size = size - inset * 2
    radius = round(card_size * 0.224)
    margin = round(card_size * 0.055)

    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    card = Image.new("RGBA", (card_size, card_size), (0, 0, 0, 0))
    bg = Image.new("RGBA", (card_size, card_size))
    pixels = bg.load()
    for y in range(card_size):
        for x in range(card_size):
            nx = x / max(card_size - 1, 1)
            ny = y / max(card_size - 1, 1)
            glow = max(0.0, 1.0 - (((nx - 0.78) ** 2 + (ny - 0.18) ** 2) ** 0.5) * 2.0)
            r = round(7 + 6 * (1 - ny) + 5 * glow)
            g = round(10 + 22 * (1 - ny) + 112 * glow)
            b = round(20 + 30 * (1 - ny) + 132 * glow)
            pixels[x, y] = (r, g, b, 255)

    mask = rounded_mask(card_size, radius)
    card.alpha_composite(bg)
    card.putalpha(mask)

    highlight = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(highlight)
    hd.rounded_rectangle(
        (inset + margin, inset + margin, size - inset - margin, size - inset - margin),
        radius=max(1, radius - margin),
        outline=(255, 255, 255, 34),
        width=max(1, round(2 * scale)),
    )
    base.alpha_composite(card, (inset, inset))
    base.alpha_composite(highlight)

    logo_size = round(card_size * 0.56)
    logo = render_logo(logo_size)
    shadow = Image.new("RGBA", (logo_size, logo_size), (0, 0, 0, 0))
    shadow.putalpha(logo.getchannel("A").filter(ImageFilter.GaussianBlur(max(1, round(10 * scale)))))
    shadow = Image.eval(shadow, lambda value: min(value, 92))

    x = (size - logo_size) // 2
    y = inset + round(card_size * 0.215)
    base.alpha_composite(shadow, (x, y + round(18 * scale)))
    base.alpha_composite(logo, (x, y))
    return base


def save_png_sizes(icon: Image.Image) -> None:
    for size in APP_SIZES:
        icon.resize((size, size), Image.Resampling.LANCZOS).save(OUT / f"{size}x{size}.png")
    icon.save(OUT / "icon.png")


def save_icns(icon: Image.Image) -> None:
    icon.save(
        OUT / "icon.icns",
        sizes=[(16, 16), (32, 32), (128, 128), (256, 256), (512, 512), (1024, 1024)],
    )


def save_ico(icon: Image.Image) -> None:
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    icon.save(OUT / "icon.ico", sizes=sizes)


def save_tray_icon() -> None:
    canvas_size = 32
    logo_size = 23
    logo = render_logo(logo_size)
    alpha = logo.getchannel("A")

    tray = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    glyph = Image.new("RGBA", (logo_size, logo_size), (255, 255, 255, 255))
    glyph.putalpha(alpha)
    tray.alpha_composite(glyph, ((canvas_size - logo_size) // 2, (canvas_size - logo_size) // 2))
    tray.save(OUT / "tray-template.png")

    colored = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    colored_logo = render_logo(logo_size)
    colored.alpha_composite(
        colored_logo,
        ((canvas_size - logo_size) // 2, (canvas_size - logo_size) // 2),
    )
    colored.save(OUT / "tray-color.png")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    icon = make_app_icon(1024)
    save_png_sizes(icon)
    save_icns(icon)
    save_ico(icon)
    save_tray_icon()


if __name__ == "__main__":
    main()
