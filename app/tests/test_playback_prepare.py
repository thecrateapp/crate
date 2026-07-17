from __future__ import annotations


def test_prepare_resolves_global_track_to_its_local_source(monkeypatch):
    from crate.api import browse_media
    from crate.api.schemas.media import PlaybackPrepareTrackRequest

    captured: dict = {}
    monkeypatch.setattr(
        browse_media,
        "resolve_global_track_playback",
        lambda _global_track_uid: {
            "kind": "local",
            "local_track_entity_uid": "11111111-1111-4111-8111-111111111111",
            "local_track_id": 42,
        },
        raising=False,
    )
    monkeypatch.setattr(
        browse_media,
        "get_track_delivery_row_by_entity_uid",
        lambda entity_uid: (
            captured.setdefault("entity_uid", entity_uid)
            and {"id": 42, "entity_uid": entity_uid}
        ),
    )

    track = browse_media._resolve_playback_prepare_track(
        PlaybackPrepareTrackRequest(global_track_uid="global-track-1")
    )

    assert track == {"id": 42, "entity_uid": "11111111-1111-4111-8111-111111111111"}
    assert captured["entity_uid"] == "11111111-1111-4111-8111-111111111111"
