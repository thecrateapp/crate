import asyncio
import json


class _FakeAsyncRedis:
    def __init__(self, frame=None):
        self.frame = frame
        self.watched = []

    async def get(self, key):
        return self.frame

    async def set(self, key, value, ex=None):
        self.watched.append((key, value, ex))


class _FakePubSub:
    def __init__(self, messages):
        self.messages = list(messages)
        self.subscribed = []
        self.unsubscribed = []

    async def subscribe(self, channel):
        self.subscribed.append(channel)

    async def unsubscribe(self, channel):
        self.unsubscribed.append(channel)

    async def get_message(self, ignore_subscribe_messages=True, timeout=1.0):
        return self.messages.pop(0) if self.messages else None

    async def aclose(self):
        return None


def _collect(monkeypatch, *, frame=None, messages=(), count=3):
    from crate.api import stack
    from crate.observability import live_activity

    redis = _FakeAsyncRedis(frame)
    pubsub = _FakePubSub(messages)

    async def open_pubsub(channel):
        await pubsub.subscribe(channel)
        return pubsub

    monkeypatch.setattr(stack, "get_cached_stack_surface", lambda: {"stack": {}})
    monkeypatch.setattr(stack, "get_async_redis", lambda: redis)
    monkeypatch.setattr(stack, "open_pubsub", open_pubsub)

    async def run():
        chunks = []
        stream = stack._stack_stream()
        async for chunk in stream:
            chunks.append(chunk)
            if len(chunks) >= count:
                break
        await stream.aclose()
        return chunks

    return asyncio.run(run()), redis, pubsub, live_activity


def test_stack_stream_sends_the_last_live_frame_and_marks_itself_watched(monkeypatch):
    frame = json.dumps({"schema": 1, "sequence": 9})
    chunks, redis, pubsub, live_activity = _collect(monkeypatch, frame=frame, count=2)

    assert chunks[0].startswith("data: ")
    assert chunks[1] == f"event: activity\ndata: {frame}\n\n"
    assert (live_activity.WATCH_KEY, "1", live_activity.WATCH_TTL_SECONDS) in (
        redis.watched
    )


def test_stack_stream_relays_live_frames_as_activity_events(monkeypatch):
    from crate.observability import live_activity

    payload = json.dumps({"schema": 1, "sequence": 10})
    chunks, _redis, pubsub, _live = _collect(
        monkeypatch,
        messages=[
            {
                "type": "message",
                "channel": live_activity.CHANNEL.encode(),
                "data": payload,
            }
        ],
        count=2,
    )

    assert live_activity.CHANNEL in pubsub.subscribed
    assert chunks[1] == f"event: activity\ndata: {payload}\n\n"
    assert live_activity.CHANNEL in pubsub.unsubscribed
