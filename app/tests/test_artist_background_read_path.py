from io import BytesIO
from types import SimpleNamespace

from PIL import Image


def _jpeg_bytes() -> bytes:
    output = BytesIO()
    Image.new("RGB", (128, 128), color="navy").save(output, format="JPEG")
    return output.getvalue()


def test_artist_background_prefers_local_artist_photo_before_remote_lookups(
    tmp_path, monkeypatch
):
    from crate.api import browse_artist

    artist_dir = tmp_path / "Artist"
    artist_dir.mkdir()
    (artist_dir / "artist.jpg").write_bytes(_jpeg_bytes())

    monkeypatch.setattr(browse_artist, "_require_auth", lambda _request: {"id": 1})
    monkeypatch.setattr(browse_artist, "library_path", lambda: tmp_path)
    monkeypatch.setattr(
        browse_artist, "get_library_artist", lambda _name: {"name": "Artist"}
    )
    monkeypatch.setattr(
        browse_artist,
        "resolve_artist_dir",
        lambda *_args, **_kwargs: artist_dir,
    )

    def unexpected_remote_lookup(*_args, **_kwargs):
        raise AssertionError("the image read path must not call remote providers")

    monkeypatch.setattr("crate.lastfm.get_fanart_all_images", unexpected_remote_lookup)
    monkeypatch.setattr("crate.lastfm.get_fanart_background", unexpected_remote_lookup)

    response = browse_artist.api_artist_background(
        SimpleNamespace(), "Artist", size=64, image_format="webp"
    )

    assert response.status_code == 200
    assert response.media_type == "image/webp"
    assert response.headers["cache-control"].startswith("public")
