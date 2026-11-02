from sqlalchemy import text


def _state(user_id, device_id, status):
    from crate.db.repositories.playback_state import upsert_playback_state

    upsert_playback_state(
        user_id,
        device_id=device_id,
        snapshot_kind="structural",
        status=status,
        track_entity_uid="11111111-1111-1111-1111-111111111111",
        title="Track",
        artist="Artist",
        position_ms=1_000,
        duration_ms=200_000,
        queue=[],
    )


def test_listening_now_counts_only_present_devices_that_are_playing(pg_db, monkeypatch):
    monkeypatch.setattr(
        "crate.db.repositories.playback_state.set_cache", lambda *a, **k: None
    )
    from crate.db.queries.live_activity import count_listening_now
    from crate.db.repositories.playback_state import (
        mark_device_present,
        revoke_device,
    )
    from crate.db.tx import transaction_scope

    user = pg_db.create_user("listening-now@test.com")
    user_id = user["id"]
    for device_id in ("playing", "away", "paused", "revoked"):
        mark_device_present(user_id, device_id=device_id, device_label=device_id)
    _state(user_id, "playing", "playing")
    _state(user_id, "away", "playing")
    _state(user_id, "paused", "paused")
    _state(user_id, "revoked", "playing")
    revoke_device(user_id, "revoked")
    with transaction_scope() as session:
        session.execute(
            text(
                "UPDATE user_devices SET last_seen_at = NOW() - INTERVAL '10 minutes'"
                " WHERE user_id = :user_id AND device_id = 'away'"
            ),
            {"user_id": user_id},
        )

    assert count_listening_now() == 1


def test_recent_play_count_reports_unknown_instead_of_zero_when_it_fails(monkeypatch):
    from crate import resource_governor

    def broken(*_args, **_kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr("crate.db.queries.management.count_recent_streams", broken)

    assert resource_governor._count_active_streams() is None
