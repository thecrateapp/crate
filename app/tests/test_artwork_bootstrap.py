from __future__ import annotations


def test_artwork_backfill_bootstrap_queues_once_until_version_is_complete(monkeypatch):
    from crate.api import _queue_artwork_variant_backfill

    queued = []
    monkeypatch.setattr("crate.db.cache_settings.get_setting", lambda _key: None)
    monkeypatch.setattr(
        "crate.db.repositories.tasks.create_task_dedup",
        lambda task_type, params, dedup_key: queued.append(
            (task_type, params, dedup_key)
        ),
    )

    _queue_artwork_variant_backfill()

    assert queued == [
        (
            "backfill_artwork_variants",
            {"batch_size": 100, "include_genres": True},
            "bootstrap:artwork-variants:v1",
        )
    ]


def test_artwork_backfill_bootstrap_skips_completed_version(monkeypatch):
    from crate.api import _queue_artwork_variant_backfill

    monkeypatch.setattr("crate.db.cache_settings.get_setting", lambda _key: "1")
    monkeypatch.setattr(
        "crate.db.repositories.tasks.create_task_dedup",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("completed backfill must not be queued")
        ),
    )

    _queue_artwork_variant_backfill()
