"""Original synthetic CC0 fixtures; no real event or copyrighted flyer."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

root = Path(__file__).parent
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 36)
for name, lines in {
    "flyer": ["EXTERNAL BAND", "2027-03-02 21:00", "SALA NORTE | MADRID | ES"],
    "tour": [
        "EXTERNAL BAND TOUR",
        "2027-03-02 | MADRID | SALA NORTE",
        "2027-03-04 | BILBAO | SALA SUR",
        "2027-03-06 | PORTO | SALA AZUL",
    ],
    "screenshot": [
        "Event details",
        "External Band",
        "2027-03-02",
        "Doors 19:30 / Show 21:00",
        "Sala Norte, Madrid",
    ],
}.items():
    image = Image.new("RGB", (1250, 500), "white")
    draw = ImageDraw.Draw(image)
    for i, line in enumerate(lines):
        draw.text((35, 35 + i * 70), line, fill="black", font=font)
    image.save(root / f"{name}.png")
image = Image.new("RGB", (1250, 500), "#181129")
draw = ImageDraw.Draw(image)
for i, line in enumerate(
    ["EXTERNAL BAND", "02 MAR / 04 MAR / 06 MAR", "MADRID   BILBAO   PORTO"]
):
    draw.text(
        (35, 35 + i * 100),
        line,
        fill="#813864",
        font=font,
        stroke_width=1,
        stroke_fill="#423050",
    )
image.rotate(12, resample=Image.Resampling.BICUBIC).filter(
    ImageFilter.GaussianBlur(1.5)
).save(root / "artistic.png")
image.resize((100, 40)).resize((1250, 500)).filter(ImageFilter.GaussianBlur(10)).save(
    root / "illegible.png"
)
