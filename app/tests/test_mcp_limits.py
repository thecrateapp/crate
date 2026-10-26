"""Exercise atomic admission rules against a disposable real Redis server."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from threading import Event, Thread, current_thread
from time import monotonic, sleep
from unittest.mock import Mock

import pytest
from crate.agent_diagnostics import DiagnosticError
from crate.mcp import limits
from redis import Redis
from redis.exceptions import ConnectionError
from testcontainers.core.container import DockerContainer


@pytest.fixture(scope="module")
def isolated_redis():
    with DockerContainer("redis:7-alpine").with_exposed_ports(6379) as container:
        client = Redis(
            host=container.get_container_host_ip(),
            port=int(container.get_exposed_port(6379)),
            socket_timeout=2,
            socket_connect_timeout=2,
        )
        deadline = monotonic() + 10
        while True:
            try:
                client.ping()
                break
            except ConnectionError:
                if monotonic() >= deadline:
                    raise
                sleep(0.05)
        try:
            yield client
        finally:
            client.close()


@pytest.fixture
def admission_redis(monkeypatch, isolated_redis):
    isolated_redis.flushdb()
    monkeypatch.setattr(limits, "_redis", lambda: isolated_redis)
    return isolated_redis


def _assert_limited(principal, retry):
    with pytest.raises(DiagnosticError) as error, limits.admission(principal):
        pytest.fail("An over-budget request entered its protected operation")
    assert error.value.code == "RATE_LIMITED"
    assert error.value.retry_after == retry


def test_sixty_reads_per_minute_are_shared_across_calls(admission_redis):
    for _ in range(60):
        with limits.admission("principal-a"):
            pass
    _assert_limited("principal-a", 60)
    with limits.admission("principal-b"):
        pass
    assert admission_redis.zcard("crate:{mcp}:rate:principal-a") == 60
    assert 0 < admission_redis.ttl("crate:{mcp}:rate:principal-a") <= 65


def test_per_principal_concurrency_releases_after_normal_completion(admission_redis):
    with limits.admission("principal-a"), limits.admission("principal-a"):
        _assert_limited("principal-a", 1)
        with limits.admission("principal-b"):
            assert admission_redis.zcard("crate:{mcp}:active") == 3
    with limits.admission("principal-a"):
        assert admission_redis.zcard("crate:{mcp}:active:principal-a") == 1
    assert admission_redis.zcard("crate:{mcp}:active") == 0


def test_global_concurrency_is_shared_across_principals(admission_redis):
    with ExitStack() as stack:
        for index in range(8):
            stack.enter_context(limits.admission(f"principal-{index}"))
        _assert_limited("principal-other", 1)
        assert admission_redis.zcard("crate:{mcp}:active") == 8
    with limits.admission("principal-other"):
        assert admission_redis.zcard("crate:{mcp}:active") == 1


def test_source_exception_releases_its_leases(admission_redis):
    with (
        pytest.raises(RuntimeError, match="source failed"),
        limits.admission("principal-a"),
    ):
        raise RuntimeError("source failed")
    assert admission_redis.zcard("crate:{mcp}:active:principal-a") == 0
    assert admission_redis.zcard("crate:{mcp}:active") == 0
    assert admission_redis.zcard("crate:{mcp}:rate:principal-a") == 1


def test_expired_leases_and_old_rate_entries_are_reclaimed(admission_redis):
    seconds, microseconds = admission_redis.time()
    now = seconds + microseconds / 1_000_000
    admission_redis.zadd(
        "crate:{mcp}:active:principal-a", {"stale-a": now - 1, "stale-b": now - 1}
    )
    admission_redis.zadd(
        "crate:{mcp}:active", {f"stale-{index}": now - 1 for index in range(8)}
    )
    admission_redis.zadd(
        "crate:{mcp}:rate:principal-a",
        {f"old-{index}": now - 61 for index in range(60)},
    )

    with limits.admission("principal-a"):
        assert admission_redis.zcard("crate:{mcp}:active:principal-a") == 1
        assert admission_redis.zcard("crate:{mcp}:active") == 1
        assert admission_redis.zcard("crate:{mcp}:rate:principal-a") == 1


def test_redis_failure_fails_closed_without_leaking_connection_details(monkeypatch):
    redis = Mock()
    redis.eval.side_effect = ConnectionError("redis://admin:secret@private-host")
    monkeypatch.setattr(limits, "_redis", lambda: redis)

    with pytest.raises(DiagnosticError) as error, limits.admission("principal-a"):
        pytest.fail("Request entered without admission control")
    assert error.value.code == "SERVICE_UNAVAILABLE"
    assert error.value.retry_after == 5
    assert "secret" not in str(error.value)
    assert redis.eval.call_count == 1


def test_redis_release_failure_keeps_the_original_result(monkeypatch):
    redis = Mock()
    redis.eval.side_effect = [0, ConnectionError("Redis disappeared")]
    monkeypatch.setattr(limits, "_redis", lambda: redis)

    with limits.admission("principal-a"):
        result = "persisted evidence"
    assert result == "persisted evidence"
    assert redis.eval.call_count == 2


def test_long_operation_renews_both_leases_and_stops_renewal_on_exit(
    monkeypatch, admission_redis
):
    monkeypatch.setattr(limits, "_RENEW_INTERVAL", 0.01)
    ready_to_renew = Event()
    renewed = Event()
    renewal_threads = []
    real_eval = admission_redis.eval

    def observed_eval(script, *args):
        if script == limits._RENEW:
            assert ready_to_renew.wait(2)
        result = real_eval(script, *args)
        if script == limits._RENEW:
            renewal_threads.append(current_thread())
            renewed.set()
        return result

    monkeypatch.setattr(admission_redis, "eval", observed_eval)
    principal_key = "crate:{mcp}:active:principal-a"
    global_key = "crate:{mcp}:active"
    with limits.admission("principal-a"):
        token = admission_redis.zrange(principal_key, 0, -1)[0]
        seconds, microseconds = admission_redis.time()
        now = seconds + microseconds / 1_000_000
        for key in (principal_key, global_key):
            admission_redis.zadd(key, {token: now + 5})
        ready_to_renew.set()
        assert renewed.wait(2), "Renewal did not run"
        for key in (principal_key, global_key):
            assert admission_redis.zscore(key, token) > now + 30
            assert 0 < admission_redis.ttl(key) <= 65
    assert renewal_threads
    assert all(not thread.is_alive() for thread in renewal_threads)
    assert admission_redis.zcard(principal_key) == 0
    assert admission_redis.zcard(global_key) == 0


def test_renewal_failure_during_cleanup_cannot_report_success(
    monkeypatch, admission_redis
):
    monkeypatch.setattr(limits, "_RENEW_INTERVAL", 0.01)
    renewal_started, cleanup_started, fail_renewal = Event(), Event(), Event()
    real_eval = admission_redis.eval

    class ObservedThread(Thread):
        def join(self, timeout=None):
            cleanup_started.set()
            super().join(timeout)

    def delayed_failure(script, *args):
        if script != limits._RENEW:
            return real_eval(script, *args)
        renewal_started.set()
        assert fail_renewal.wait(2)
        raise ConnectionError("Connection lost while source completed")

    monkeypatch.setattr(limits, "Thread", ObservedThread)
    monkeypatch.setattr(admission_redis, "eval", delayed_failure)

    def operation():
        with limits.admission("principal-a"):
            assert renewal_started.wait(2)
        return "incorrect success"

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(operation)
        try:
            assert cleanup_started.wait(2), "Operation never waited for its renewal"
        finally:
            fail_renewal.set()
        with pytest.raises(DiagnosticError) as error:
            future.result(timeout=2)
    assert error.value.code == "SERVICE_UNAVAILABLE"
    assert admission_redis.zcard("crate:{mcp}:active:principal-a") == 0
    assert admission_redis.zcard("crate:{mcp}:active") == 0


@pytest.mark.parametrize("failure", ["missing", "expired", "redis_error"])
def test_lost_lease_never_reports_success_and_cleans_up(
    monkeypatch, admission_redis, failure
):
    monkeypatch.setattr(limits, "_RENEW_INTERVAL", 0.01)
    attempted = Event()
    renewal_threads = []
    real_eval = admission_redis.eval

    def observed_eval(script, *args):
        if script != limits._RENEW:
            return real_eval(script, *args)
        renewal_threads.append(current_thread())
        try:
            if failure == "redis_error":
                raise ConnectionError("redis://user:secret@private")
            return real_eval(script, *args)
        finally:
            attempted.set()

    monkeypatch.setattr(admission_redis, "eval", observed_eval)
    principal_key = "crate:{mcp}:active:principal-a"
    global_key = "crate:{mcp}:active"
    with pytest.raises(DiagnosticError) as error, limits.admission("principal-a"):
        token = admission_redis.zrange(principal_key, 0, -1)[0]
        if failure == "missing":
            admission_redis.zrem(global_key, token)
        elif failure == "expired":
            seconds, microseconds = admission_redis.time()
            admission_redis.zadd(
                principal_key, {token: seconds + microseconds / 1_000_000 - 1}
            )
        assert attempted.wait(2), "Renewal did not inspect the lease"
        renewal_threads[0].join(timeout=2)
        assert not renewal_threads[0].is_alive()
    assert error.value.code == "SERVICE_UNAVAILABLE"
    assert error.value.retry_after == 5
    assert "secret" not in str(error.value)
    assert admission_redis.zcard(principal_key) == 0
    assert admission_redis.zcard(global_key) == 0
