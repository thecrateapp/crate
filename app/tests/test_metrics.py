from __future__ import annotations


def test_record_sync_adds_metric_name_to_tracked_set(monkeypatch):
    from crate import metrics

    class FakePipeline:
        def __init__(self):
            self.sadd_calls: list[tuple[str, str]] = []
            self.expire_calls: list[tuple[str, int]] = []

        def sadd(self, key: str, member: str):
            self.sadd_calls.append((key, member))
            return self

        def expire(self, key: str, ttl: int):
            self.expire_calls.append((key, ttl))
            return self

        def hincrby(self, *_args):
            return self

        def hincrbyfloat(self, *_args):
            return self

        def eval(self, *_args):
            return self

        def set(self, *_args, **kwargs):
            return self

        def execute(self):
            return []

    class FakeRedis:
        def __init__(self):
            self.pipeline_instance = FakePipeline()

        def pipeline(self, transaction: bool = False):
            return self.pipeline_instance

    fake_redis = FakeRedis()
    monkeypatch.setattr("crate.db.cache_runtime.get_redis", lambda: fake_redis)
    monkeypatch.setattr(metrics, "_minute_bucket", lambda ts=None: 600)

    metrics._record_sync("api.requests", 1.0)

    assert (
        "crate:metric_keys",
        "api.requests",
    ) in fake_redis.pipeline_instance.sadd_calls
    assert any(
        key == "crate:metric_keys" and ttl == metrics._MAX_BUCKET_TTL_SECONDS
        for key, ttl in fake_redis.pipeline_instance.expire_calls
    )


def test_record_route_latency_adds_metric_name_to_tracked_set(monkeypatch):
    from crate import metrics

    class FakePipeline:
        def __init__(self):
            self.sadd_calls: list[tuple[str, str]] = []
            self.expire_calls: list[tuple[str, int]] = []

        def sadd(self, key: str, member: str):
            self.sadd_calls.append((key, member))
            return self

        def expire(self, key: str, ttl: int):
            self.expire_calls.append((key, ttl))
            return self

        def hset(self, *_args, **kwargs):
            return self

        def hincrby(self, *_args):
            return self

        def hincrbyfloat(self, *_args):
            return self

        def eval(self, *_args):
            return self

        def rpush(self, *_args):
            return self

        def ltrim(self, *_args):
            return self

        def execute(self):
            return []

    class FakeRedis:
        def __init__(self):
            self.pipeline_instance = FakePipeline()

        def pipeline(self, transaction: bool = False):
            return self.pipeline_instance

    fake_redis = FakeRedis()
    monkeypatch.setattr("crate.db.cache_runtime.get_redis", lambda: fake_redis)
    monkeypatch.setattr(metrics, "_minute_bucket", lambda ts=None: 600)

    metrics._record_route_latency_sync(
        42.0, {"method": "GET", "path": "/api/test", "status": "200"}
    )

    assert (
        "crate:metric_keys",
        metrics._ROUTE_LATENCY_METRIC,
    ) in fake_redis.pipeline_instance.sadd_calls
    assert any(
        key == "crate:metric_keys" and ttl == metrics._MAX_BUCKET_TTL_SECONDS
        for key, ttl in fake_redis.pipeline_instance.expire_calls
    )


def test_flush_to_postgres_uses_smembers_then_targeted_scan(monkeypatch):
    from crate import metrics

    class FakeRedis:
        def __init__(self):
            self.smembers_calls: list[str] = []
            self.scan_patterns: list[str] = []
            self._scan_calls = 0

        def smembers(self, key: str):
            self.smembers_calls.append(key)
            return {b"api.requests"}

        def scan(self, cursor: int, match: str | None = None, count: int | None = None):
            self._scan_calls += 1
            self.scan_patterns.append(match or "")
            # Return one old bucket on the first call per pattern, then stop
            if cursor == 0 and "api.requests" in (match or ""):
                return 0, [b"crate:metrics:api.requests:0"]
            return 0, []

        def hgetall(self, key: str):
            return {"count": b"1", "sum": b"10", "min": b"5", "max": b"15"}

        def get(self, key: str):
            return None

    fake_redis = FakeRedis()
    monkeypatch.setattr("crate.db.cache_runtime.get_redis", lambda: fake_redis)
    monkeypatch.setattr(metrics, "_minute_bucket", lambda ts=None: 600)

    call_log = []

    def fake_upsert(**kwargs):
        call_log.append(kwargs)

    monkeypatch.setattr(
        "crate.db.repositories.management.upsert_metric_rollup", fake_upsert
    )

    metrics.flush_to_postgres(period="hour")

    assert "crate:metric_keys" in fake_redis.smembers_calls
    assert any("api.requests" in p for p in fake_redis.scan_patterns)
    assert len(call_log) == 1
    assert call_log[0]["name"] == "api.requests"


def test_metrics_redis_bucket_ttl_is_configurable(monkeypatch):
    from crate import metrics

    monkeypatch.delenv("CRATE_METRICS_REDIS_TTL_SECONDS", raising=False)
    assert metrics._bucket_ttl_seconds() == 24 * 3600

    monkeypatch.setenv("CRATE_METRICS_REDIS_TTL_SECONDS", "7200")
    assert metrics._bucket_ttl_seconds() == 7200

    monkeypatch.setenv("CRATE_METRICS_REDIS_TTL_SECONDS", "60")
    assert metrics._bucket_ttl_seconds() == 3600

    monkeypatch.setenv("CRATE_METRICS_REDIS_TTL_SECONDS", "invalid")
    assert metrics._bucket_ttl_seconds() == 24 * 3600


def test_record_sync_uses_configured_redis_ttl(monkeypatch):
    from crate import metrics

    class FakePipeline:
        def __init__(self):
            self.expires: list[tuple[str, int]] = []
            self.sets: list[tuple[str, int | None]] = []

        def sadd(self, *_args):
            return self

        def hincrby(self, *_args):
            return self

        def hincrbyfloat(self, *_args):
            return self

        def eval(self, *_args):
            return self

        def expire(self, key: str, ttl: int):
            self.expires.append((key, ttl))
            return self

        def set(
            self, key: str, _value: str, *, ex: int | None = None, nx: bool = False
        ):
            assert nx is True
            self.sets.append((key, ex))
            return self

        def execute(self):
            return []

    class FakeRedis:
        def __init__(self):
            self.pipeline_instance = FakePipeline()

        def pipeline(self, transaction: bool = False):
            assert transaction is False
            return self.pipeline_instance

    fake_redis = FakeRedis()

    monkeypatch.setenv("CRATE_METRICS_REDIS_TTL_SECONDS", "7200")
    monkeypatch.setattr(metrics, "_minute_bucket", lambda ts=None: 600)
    monkeypatch.setattr("crate.db.cache_runtime.get_redis", lambda: fake_redis)

    metrics._record_sync("api.requests", 1.0, {"target": "api"})

    assert (
        "crate:metrics:api.requests:600",
        7200,
    ) in fake_redis.pipeline_instance.expires
    assert (
        "crate:metrics:api.requests:600:tags",
        7200,
    ) in fake_redis.pipeline_instance.sets


class TestMetricsBatchQueries:
    def test_query_summaries_batches_multiple_metrics_in_one_pipeline(
        self, monkeypatch
    ):
        from crate import metrics

        fixed_bucket = 600

        class FakePipeline:
            def __init__(self):
                self.keys: list[str] = []
                self.executed = False

            def hgetall(self, key: str):
                self.keys.append(key)
                return self

            def execute(self):
                self.executed = True
                results = []
                for key in self.keys:
                    if "api.request.latency" in key:
                        results.append(
                            {"count": "2", "sum": "84", "min": "40", "max": "44"}
                        )
                    elif "api.request.errors" in key:
                        results.append(
                            {"count": "1", "sum": "1", "min": "1", "max": "1"}
                        )
                    else:
                        results.append({})
                return results

        class FakeRedis:
            def __init__(self):
                self.pipeline_calls = 0
                self.pipeline_instance = FakePipeline()

            def pipeline(self, transaction: bool = False):
                assert transaction is False
                self.pipeline_calls += 1
                return self.pipeline_instance

        fake_redis = FakeRedis()

        monkeypatch.setattr(metrics, "_minute_bucket", lambda ts=None: fixed_bucket)
        monkeypatch.setattr("crate.db.cache_runtime.get_redis", lambda: fake_redis)

        summaries = metrics.query_summaries(
            {
                "api_latency": ("api.request.latency", 2),
                "api_errors": ("api.request.errors", 1),
            }
        )

        assert fake_redis.pipeline_calls == 1
        assert fake_redis.pipeline_instance.executed is True
        assert fake_redis.pipeline_instance.keys == [
            "crate:metrics:api.request.latency:600",
            "crate:metrics:api.request.latency:540",
            "crate:metrics:api.request.errors:600",
        ]
        assert summaries["api_latency"] == {
            "count": 4,
            "avg": 42.0,
            "min": 40.0,
            "max": 44.0,
            "sum": 168.0,
        }
        assert summaries["api_errors"] == {
            "count": 1,
            "avg": 1.0,
            "min": 1.0,
            "max": 1.0,
            "sum": 1.0,
        }

    def test_query_route_latency_aggregates_recent_p95_p99(self, monkeypatch):
        from crate import metrics

        fixed_bucket = 600
        route_id = metrics._route_id("api", "GET", "/api/me/home/discovery")

        class FakePipeline:
            def __init__(self):
                self.ops: list[tuple[str, str]] = []

            def smembers(self, key: str):
                self.ops.append(("smembers", key))
                return self

            def hgetall(self, key: str):
                self.ops.append(("hgetall", key))
                return self

            def lrange(self, key: str, start: int, end: int):
                assert start == 0
                assert end == -1
                self.ops.append(("lrange", key))
                return self

            def execute(self):
                results = []
                for op, key in self.ops:
                    if op == "smembers":
                        results.append({route_id} if key.endswith(":600") else set())
                    elif op == "hgetall" and key.endswith(":600"):
                        results.append(
                            {
                                "route_id": route_id,
                                "target": "api",
                                "method": "GET",
                                "path": "/api/me/home/discovery",
                                "count": "3",
                                "sum": "300",
                                "min": "80",
                                "max": "120",
                                "status_2xx": "3",
                            }
                        )
                    elif op == "lrange" and key.endswith(":600:samples"):
                        results.append(["100", "120", "80"])
                    else:
                        results.append({} if op == "hgetall" else [])
                return results

        class FakeRedis:
            def pipeline(self, transaction: bool = False):
                assert transaction is False
                return FakePipeline()

        monkeypatch.setattr(metrics, "_minute_bucket", lambda ts=None: fixed_bucket)
        monkeypatch.setattr("crate.db.cache_runtime.get_redis", lambda: FakeRedis())

        routes = metrics.query_route_latency(minutes=2, limit=10)

        assert routes == [
            {
                "route_id": route_id,
                "target": "api",
                "method": "GET",
                "path": "/api/me/home/discovery",
                "count": 3,
                "sum": 300.0,
                "min": 80.0,
                "max": 120.0,
                "status_2xx": 3,
                "status_3xx": 0,
                "status_4xx": 0,
                "status_5xx": 0,
                "status_other": 0,
                "avg": 100.0,
                "p95": 120.0,
                "p99": 120.0,
                "error_rate": 0.0,
            }
        ]
