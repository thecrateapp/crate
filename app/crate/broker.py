"""Dramatiq broker configuration.

Redis DB 0 = cache (existing), DB 1 = Dramatiq message broker.
Redis must use volatile-lru policy so cache keys (with TTL) can be evicted
but Dramatiq queue keys (no TTL) are never lost.
"""

import logging
import os

import dramatiq
from dramatiq.brokers.redis import RedisBroker
from dramatiq.middleware import (
    AgeLimit,
    Callbacks,
    Pipelines,
    Retries,
    ShutdownNotifications,
    TimeLimit,
)

from crate.config import get_durable_redis_url
from crate.observability import init_sentry, resolve_service_name

log = logging.getLogger(__name__)

# Switch to DB 1 for broker (DB 0 is cache)
_BROKER_URL = get_durable_redis_url().rsplit("/", 1)[0] + "/1"


class ReadinessBroker(RedisBroker):
    def consume(self, queue_name, prefetch=1, timeout=5000):
        consumer = super().consume(queue_name, prefetch=prefetch, timeout=timeout)
        if not os.environ.get("CRATE_READINESS_ROLE"):
            return consumer

        class ObservedConsumer:
            def __getattr__(self, name):
                return getattr(consumer, name)

            def __iter__(self):
                return self

            def __next__(self):
                result = next(consumer)
                from crate.role_readiness import progress

                # Successful consumer iteration, independent broker probe in the
                # health command, and per-container files; no global worker cache.
                progress("queue_" + queue_name.replace(".DQ", "_delay"))
                return result

        return ObservedConsumer()


def get_broker() -> RedisBroker:
    """Create and configure the Dramatiq Redis broker."""
    middleware = [
        AgeLimit(),
        TimeLimit(),
        ShutdownNotifications(),
        Callbacks(),
        Pipelines(),
        Retries(max_retries=0),  # default no retry; actors override per-type
    ]
    broker = ReadinessBroker(url=_BROKER_URL, middleware=middleware)
    return broker


# Module-level broker — set on import so actors can register
init_sentry(resolve_service_name("workers"))
broker = get_broker()
dramatiq.set_broker(broker)
