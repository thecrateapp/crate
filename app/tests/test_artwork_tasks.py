from __future__ import annotations


def test_queue_artwork_materialization_uses_canonical_payload_and_dedup(monkeypatch):
    from crate import artwork_tasks
    from crate.artwork_variants import ArtworkAsset

    calls = []
    monkeypatch.setattr(
        artwork_tasks,
        "create_task_dedup",
        lambda task_type, params, *, dedup_key: (
            calls.append((task_type, params, dedup_key)) or "task-1"
        ),
    )

    task_id = artwork_tasks.queue_artwork_materialization(
        ArtworkAsset("artist-photo", "artist-entity"), reason="source-write"
    )

    assert task_id == "task-1"
    assert calls == [
        (
            "materialize_artwork_variants",
            {
                "kind": "artist-photo",
                "entity_key": "artist-entity",
                "reason": "source-write",
            },
            "artwork:artist-photo:artist-entity",
        )
    ]
