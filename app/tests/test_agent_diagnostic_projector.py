"""Background health warming is periodic, bounded and isolated from other work."""

from types import SimpleNamespace

import pytest
from sqlalchemy import text


def test_health_warmer_batches_identity_and_keeps_last_snapshot_on_failure(
    pg_db, monkeypatch
):
    from crate.db.jobs import agent_diagnostic_snapshots as warmer
    from crate.db.queries.agent_library import read_health_snapshot
    from crate.db.tx import transaction_scope

    uid = "10000000-0000-0000-0000-000000000001"
    with transaction_scope() as session:
        artist_id = session.execute(
            text(
                "INSERT INTO library_artists (name, entity_uid) VALUES ('Test artist', CAST(:uid AS uuid)) RETURNING id"
            ),
            {"uid": uid},
        ).scalar_one()
    calls = []

    def build(**kwargs):
        calls.append(kwargs)
        return {
            "issues": [
                {
                    "id": 1,
                    "artist_id": artist_id,
                    "description": "é" * 3000,
                    "details_json": {"paths": ["/private/music"] * 10000},
                },
                {"id": 2, "artist_id": artist_id},
            ],
            "counts": {"duplicate_tracks": 2},
            "runs": {},
        }

    monkeypatch.setattr(warmer, "build_health_surface_payload", build)
    monkeypatch.setattr(warmer, "get_latest_domain_event_id", lambda: 4242)
    warmer.warm_agent_health_snapshot()
    first = read_health_snapshot()
    assert calls == [{"limit": 1000}]
    assert first["subject_key"] == "agent:diagnostics:v1"
    assert first["source_seq"] == 4242
    assert [row["artist_uid"] for row in first["payload_json"]["issues"]] == [uid, uid]
    assert "details_json" not in first["payload_json"]["issues"][0]
    assert len(first["payload_json"]["issues"][0]["description"]) <= 2048

    def fail(**_kwargs):
        raise RuntimeError("temporarily unavailable")

    monkeypatch.setattr(warmer, "build_health_surface_payload", fail)
    with pytest.raises(RuntimeError, match="temporarily unavailable"):
        warmer.warm_agent_health_snapshot()
    assert read_health_snapshot() == first


@pytest.mark.parametrize(
    "enabled,fail_first,expected_warms",
    [
        (False, False, []),
        (True, False, [0, 60, 120]),
        (True, True, [0, 60, 120]),
    ],
)
def test_projector_coalesces_health_warming_without_starving_other_work(
    monkeypatch, enabled, fail_first, expected_warms
):
    from crate import domain_event_relay, projector, projector_daemon
    from crate.db import domain_event_outbox
    from crate.db.jobs import agent_diagnostic_snapshots

    monkeypatch.setenv("CRATE_MCP_ENABLED", str(enabled).lower())
    clock = [0]
    warms, relays, projections = [], [], []
    monkeypatch.setattr(
        projector_daemon, "time", SimpleNamespace(monotonic=lambda: clock[0])
    )
    monkeypatch.setattr(
        domain_event_relay,
        "relay_domain_events",
        lambda **_kwargs: relays.append(clock[0]),
    )
    monkeypatch.setattr(domain_event_outbox, "cleanup_delivered_outbox", lambda: 0)

    def process(**_kwargs):
        projections.append(clock[0])
        return {"processed": 0}

    def warm():
        warms.append(clock[0])
        if fail_first and len(warms) == 1:
            raise RuntimeError("temporary failure")

    monkeypatch.setattr(projector, "process_domain_events", process)
    monkeypatch.setattr(agent_diagnostic_snapshots, "warm_agent_health_snapshot", warm)

    class StopAfterFiveIterations:
        def is_set(self):
            return clock[0] > 120

        def wait(self, _interval):
            clock[0] += 30

    projector_daemon.run_projector_loop(
        StopAfterFiveIterations(), home_warm_interval_seconds=0
    )
    assert warms == expected_warms
    assert relays == [0, 30, 60, 90, 120]
    assert projections == relays
