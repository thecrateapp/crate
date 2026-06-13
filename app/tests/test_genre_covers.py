from io import BytesIO

import pytest
from PIL import Image


def _one_pixel_png() -> bytes:
    output = BytesIO()
    Image.new("RGB", (1, 1), (0, 0, 0)).save(output, format="PNG")
    return output.getvalue()


def test_persist_genre_cover_upload_stores_valid_image(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    from crate.genre_covers import genre_cover_abspath, persist_genre_cover_upload

    cover_path = persist_genre_cover_upload(
        "mathcore",
        filename="cover.png",
        content_type="image/png",
        payload=_one_pixel_png(),
    )

    assert cover_path == "mathcore.png"
    absolute = genre_cover_abspath(cover_path)
    assert absolute is not None
    assert absolute.exists()
    assert absolute.read_bytes() == _one_pixel_png()


def test_persist_genre_cover_upload_rejects_non_image(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))

    from crate.genre_covers import persist_genre_cover_upload

    with pytest.raises(ValueError, match="Invalid genre cover image"):
        persist_genre_cover_upload(
            "mathcore",
            filename="cover.png",
            content_type="image/png",
            payload=b"not an image",
        )
