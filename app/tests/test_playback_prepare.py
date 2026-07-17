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


def test_prepare_relays_next_two_remote_global_tracks_to_one_owner(monkeypatch):
    from crate.api import browse_media
    from crate.api.schemas.media import (
        PlaybackPrepareRequest,
        PlaybackPrepareTrackRequest,
    )

    first_node = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    selections = {
        "global-track-1": {
            "kind": "remote",
            "node_uid": first_node,
            "remote_entity_uid": "22222222-2222-4222-8222-222222222222",
        },
        "global-track-2": {
            "kind": "remote",
            "node_uid": first_node,
            "remote_entity_uid": "33333333-3333-4333-8333-333333333333",
        },
        "global-track-3": {
            "kind": "remote",
            "node_uid": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            "remote_entity_uid": "44444444-4444-4444-8444-444444444444",
        },
    }
    captured: dict = {}
    monkeypatch.setattr(browse_media, "_require_auth", lambda _request: {"id": 7})
    monkeypatch.setattr(
        browse_media,
        "resolve_global_track_playback",
        lambda global_track_uid: selections[global_track_uid],
    )

    def fake_prepare_remote(**kwargs):
        captured.update(kwargs)
        return {
            "22222222-2222-4222-8222-222222222222": "preparing",
            "33333333-3333-4333-8333-333333333333": "ready",
        }

    monkeypatch.setattr(
        browse_media,
        "prepare_remote_playback_variants",
        fake_prepare_remote,
        raising=False,
    )

    result = browse_media.api_playback_prepare(
        object(),
        PlaybackPrepareRequest(
            policy="balanced",
            tracks=[
                PlaybackPrepareTrackRequest(global_track_uid="global-track-1"),
                PlaybackPrepareTrackRequest(global_track_uid="global-track-2"),
                PlaybackPrepareTrackRequest(global_track_uid="global-track-3"),
            ],
        ),
    )

    assert captured == {
        "user": {"id": 7},
        "node_uid": first_node,
        "remote_entity_uids": [
            "22222222-2222-4222-8222-222222222222",
            "33333333-3333-4333-8333-333333333333",
        ],
        "delivery_policy": "balanced",
    }
    assert result["items"] == [
        {
            "entity_uid": "22222222-2222-4222-8222-222222222222",
            "ok": True,
            "preparing": True,
            "cache_hit": False,
            "transcoded": False,
        },
        {
            "entity_uid": "33333333-3333-4333-8333-333333333333",
            "ok": True,
            "preparing": False,
            "cache_hit": True,
            "transcoded": True,
        },
        {
            "entity_uid": "44444444-4444-4444-8444-444444444444",
            "ok": False,
            "preparing": False,
            "cache_hit": False,
            "transcoded": False,
            "error": "Remote peer preparation deferred",
        },
    ]
