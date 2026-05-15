from crate.db.cache_runtime import _mask_url_secret


def test_mask_url_secret_hides_redis_password():
    assert (
        _mask_url_secret("redis://:super-secret@crate-redis:6379/0")
        == "redis://***@crate-redis:6379/0"
    )


def test_mask_url_secret_preserves_passwordless_urls():
    assert _mask_url_secret("redis://localhost:6379/0") == "redis://localhost:6379/0"
