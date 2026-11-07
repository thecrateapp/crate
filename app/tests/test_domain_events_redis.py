"""Consumer-group regressions against isolated Redis, without published ports."""

import json
import os
import time
from uuid import uuid4

import pytest


class _ContainerRedis:
    def __init__(self, container):
        self.container = container

    def command(self, *args):
        result = self.container.exec_run(
            ["redis-cli", "-2", "--json", *[str(arg) for arg in args]]
        )
        assert result.exit_code == 0, result.output.decode()
        return json.loads(result.output)

    def xgroup_create(self, stream, group, *, id, mkstream):
        args = ["XGROUP", "CREATE", stream, group, id]
        if mkstream:
            args.append("MKSTREAM")
        return self.command(*args)

    def xreadgroup(self, group, consumer, streams, *, count, block=None):
        args = ["XREADGROUP", "GROUP", group, consumer, "COUNT", count]
        if block is not None:
            assert block > 0, "BLOCK 0 would wait forever in Redis"
            args.extend(["BLOCK", block])
        args.extend(["STREAMS", *streams.keys(), *streams.values()])
        response = self.command(*args)
        if not response:
            return []
        return [
            (
                stream,
                [
                    (msg_id, dict(zip(fields[::2], fields[1::2])))
                    for msg_id, fields in messages
                ],
            )
            for stream, messages in response
        ]


@pytest.fixture(scope="module")
def isolated_domain_event_redis():
    import docker

    endpoint = os.environ.get("DOCKER_HOST") or "unix:///var/run/docker.sock"
    if not endpoint.startswith("unix://"):
        pytest.skip("Domain-event Redis tests require a local Docker socket")
    client = docker.DockerClient(base_url=endpoint, timeout=20)
    container = None
    try:
        try:
            client.ping()
        except docker.errors.DockerException:
            pytest.skip("Docker is required for the real Redis protocol regression")
        container = client.containers.run(
            "redis:7-alpine",
            command=["redis-server", "--save", "", "--appendonly", "no"],
            detach=True,
            network_mode="none",
            mem_limit="64m",
            labels={"crate.test": "domain-event-consumer"},
        )
        connection = _ContainerRedis(container)
        deadline = time.monotonic() + 10
        while True:
            try:
                if connection.command("PING") == "PONG":
                    break
            except (AssertionError, json.JSONDecodeError):
                if time.monotonic() >= deadline:
                    raise
            time.sleep(0.05)
        yield connection
    finally:
        if container is not None:
            container.remove(force=True, v=True)
        client.close()


@pytest.fixture
def real_domain_events(monkeypatch, isolated_domain_event_redis):
    from crate.db import domain_events

    stream = f"test:domain_events:{uuid4()}"
    monkeypatch.setattr(domain_events, "_STREAM_KEY", stream)
    monkeypatch.setattr(
        domain_events, "_get_redis", lambda: isolated_domain_event_redis
    )
    monkeypatch.setattr(domain_events, "_group_created", False)
    return domain_events, isolated_domain_event_redis, stream


def test_real_redis_empty_pending_envelope_still_consumes_new(real_domain_events):
    domain_events, client, stream = real_domain_events
    client.xgroup_create(stream, "projector", id="0", mkstream=True)
    domain_events._group_created = True
    client.command("XADD", stream, "*", "event_type", "acquisition.completed")

    assert client.command(
        "XREADGROUP", "GROUP", "projector", "worker", "STREAMS", stream, "0"
    ) == [[stream, []]]

    events = domain_events.list_domain_events(limit=2, block_ms=0)

    assert [event["event_type"] for event in events] == ["acquisition.completed"]


def test_real_redis_pending_events_do_not_starve_new_or_exceed_limit(
    real_domain_events,
):
    domain_events, client, stream = real_domain_events
    for event_type in ("pending.first", "pending.second"):
        client.command("XADD", stream, "*", "event_type", event_type)
    first_batch = domain_events.list_domain_events(limit=2, block_ms=0)
    assert len(first_batch) == 2
    client.command("XADD", stream, "*", "event_type", "new.event")

    mixed_batch = domain_events.list_domain_events(limit=2, block_ms=1000)

    assert [event["event_type"] for event in mixed_batch] == [
        "pending.first",
        "new.event",
    ]
    assert client.command("XPENDING", stream, "projector")[0] == 3
