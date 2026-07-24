from __future__ import annotations


def test_cache_dir_separates_regenerable_assets_from_durable_data(
    monkeypatch, tmp_path
):
    from crate.artwork_variants import artwork_variant_root
    from crate.download_cache import download_cache_root
    from crate.external_artist_artwork import external_artist_artwork_root
    from crate.streaming.paths import resolve_data_file, stream_cache_root

    data_root = tmp_path / "data"
    cache_root = tmp_path / "cache"
    monkeypatch.setenv("DATA_DIR", str(data_root))
    monkeypatch.setenv("CACHE_DIR", str(cache_root))

    assert stream_cache_root() == cache_root / "stream-cache"
    assert artwork_variant_root() == cache_root / "artwork-variants" / "v1"
    assert external_artist_artwork_root() == cache_root / "external-artist-artwork"
    assert download_cache_root() == cache_root / "download-cache"
    assert resolve_data_file("stream-cache/balanced/ab/track.opus") == (
        cache_root / "stream-cache/balanced/ab/track.opus"
    )
    assert resolve_data_file("playlist-covers/cover.webp") == (
        data_root / "playlist-covers/cover.webp"
    )


def test_cache_dir_defaults_to_data_dir_for_backward_compatibility(
    monkeypatch, tmp_path
):
    from crate.artwork_variants import artwork_variant_root
    from crate.streaming.paths import stream_cache_root

    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.delenv("CACHE_DIR", raising=False)

    assert stream_cache_root() == tmp_path / "stream-cache"
    assert artwork_variant_root() == tmp_path / "artwork-variants" / "v1"
