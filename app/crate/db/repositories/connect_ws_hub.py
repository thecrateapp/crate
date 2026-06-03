"""WebSocket connection hub for Crate Connect v2."""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol

from fastapi.encoders import jsonable_encoder

from crate.db.cache_runtime import get_redis


class JsonWebSocket(Protocol):
    async def send_json(self, data: Any) -> None: ...


@dataclass
class ConnectInstanceMeta:
    user_id: int
    playback_instance_id: str
    device_id: str
    device_label: str | None = None
    device_type: str | None = None
    app_platform: str | None = None
    app_version: str | None = None
    capabilities: dict[str, Any] = field(default_factory=dict)
    connected_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class _Peer:
    websocket: JsonWebSocket
    meta: ConnectInstanceMeta
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


@dataclass
class _Subscription:
    pubsub: Any
    stop: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None


class ConnectHub:
    def __init__(
        self, *, worker_id: str | None = None, enable_pubsub: bool | None = None
    ) -> None:
        self.worker_id = worker_id or f"connect-ws-{os.getpid()}-{uuid.uuid4().hex[:8]}"
        self.enable_pubsub = (
            bool(enable_pubsub) if enable_pubsub is not None else not _is_dev()
        )
        self._connections: dict[int, dict[str, _Peer]] = {}
        self._subscriptions: dict[int, _Subscription] = {}
        self._lock = asyncio.Lock()

    async def connect(
        self,
        user_id: int,
        instance_id: str,
        websocket: JsonWebSocket,
        *,
        device_id: str,
        device_label: str | None = None,
        device_type: str | None = None,
        app_platform: str | None = None,
        app_version: str | None = None,
        capabilities: dict[str, Any] | None = None,
    ) -> ConnectInstanceMeta:
        meta = ConnectInstanceMeta(
            user_id=user_id,
            playback_instance_id=instance_id,
            device_id=device_id,
            device_label=device_label,
            device_type=device_type,
            app_platform=app_platform,
            app_version=app_version,
            capabilities=capabilities or {},
        )
        async with self._lock:
            first_for_user = not self._connections.get(user_id)
            self._connections.setdefault(user_id, {})[instance_id] = _Peer(
                websocket=websocket,
                meta=meta,
            )
        self._write_instance_presence(meta)
        if first_for_user:
            await self._ensure_subscription(user_id)
        return meta

    async def disconnect(self, user_id: int, instance_id: str) -> None:
        stop_subscription = False
        async with self._lock:
            peers = self._connections.get(user_id)
            if not peers:
                return
            peers.pop(instance_id, None)
            if not peers:
                self._connections.pop(user_id, None)
                stop_subscription = True
        self._delete_instance_presence(user_id, instance_id)
        if stop_subscription:
            await self._stop_subscription(user_id)

    async def send_to_instance(
        self, user_id: int, instance_id: str, message: dict[str, Any]
    ) -> bool:
        peer = await self._get_peer(user_id, instance_id)
        if peer is not None:
            await self._safe_send(peer, message)
            return True
        self._publish(user_id, target_instance_id=instance_id, message=message)
        return False

    async def broadcast_to_user(
        self,
        user_id: int,
        message: dict[str, Any],
        *,
        exclude_instance: str | None = None,
    ) -> None:
        async with self._lock:
            peers = list(self._connections.get(user_id, {}).items())
        for instance_id, peer in peers:
            if exclude_instance and instance_id == exclude_instance:
                continue
            await self._safe_send(peer, message)
        self._publish(
            user_id,
            target_instance_id=None,
            exclude_instance=exclude_instance,
            message=message,
        )

    def get_connected_instances(self, user_id: int) -> set[str]:
        peers = self._connections.get(user_id, {})
        return set(peers.keys())

    def get_instance_meta(
        self, user_id: int, instance_id: str
    ) -> ConnectInstanceMeta | None:
        peer = self._connections.get(user_id, {}).get(instance_id)
        if peer is not None:
            return peer.meta
        return self._read_instance_presence(user_id, instance_id)

    def connected_instances_snapshot(self, user_id: int) -> dict[str, Any]:
        instances: dict[str, Any] = {}
        for instance_id, peer in self._connections.get(user_id, {}).items():
            instances[instance_id] = _meta_payload(peer.meta)
        redis_client = get_redis()
        if redis_client is not None:
            try:
                for instance_id in redis_client.smembers(
                    f"connect:ws:instances:{user_id}"
                ):
                    instance_id_text = _to_text(instance_id)
                    if instance_id_text not in instances:
                        meta = self._read_instance_presence(user_id, instance_id_text)
                        if meta is not None:
                            instances[instance_id_text] = _meta_payload(meta)
            except Exception:
                pass
        return {"instances": list(instances.values())}

    async def _get_peer(self, user_id: int, instance_id: str) -> _Peer | None:
        async with self._lock:
            return self._connections.get(user_id, {}).get(instance_id)

    async def _safe_send(self, peer: _Peer, message: dict[str, Any]) -> None:
        async with peer.send_lock:
            await peer.websocket.send_json(jsonable_encoder(message))

    async def _ensure_subscription(self, user_id: int) -> None:
        if not self.enable_pubsub:
            return
        redis_client = get_redis()
        if redis_client is None:
            return
        async with self._lock:
            if user_id in self._subscriptions:
                return
            try:
                pubsub = redis_client.pubsub(ignore_subscribe_messages=True)
                pubsub.subscribe(_fanout_channel(user_id))
            except Exception:
                return
            subscription = _Subscription(pubsub=pubsub)
            subscription.task = asyncio.create_task(
                self._subscription_loop(user_id, subscription)
            )
            self._subscriptions[user_id] = subscription

    async def _stop_subscription(self, user_id: int) -> None:
        async with self._lock:
            subscription = self._subscriptions.pop(user_id, None)
        if subscription is None:
            return
        subscription.stop.set()
        try:
            await asyncio.to_thread(
                subscription.pubsub.unsubscribe, _fanout_channel(user_id)
            )
            await asyncio.to_thread(subscription.pubsub.close)
        except Exception:
            pass

    async def _subscription_loop(
        self, user_id: int, subscription: _Subscription
    ) -> None:
        try:
            while not subscription.stop.is_set():
                raw = await asyncio.to_thread(
                    subscription.pubsub.get_message, timeout=1.0
                )
                if not raw or raw.get("type") != "message":
                    continue
                try:
                    envelope = json.loads(_to_text(raw.get("data")))
                except (TypeError, json.JSONDecodeError, UnicodeDecodeError):
                    continue
                if isinstance(envelope, dict):
                    await self._deliver_fanout_envelope(user_id, envelope)
        finally:
            try:
                await asyncio.to_thread(
                    subscription.pubsub.unsubscribe, _fanout_channel(user_id)
                )
                await asyncio.to_thread(subscription.pubsub.close)
            except Exception:
                pass

    async def _deliver_fanout_envelope(
        self, user_id: int, envelope: dict[str, Any]
    ) -> None:
        if envelope.get("worker_id") == self.worker_id:
            return
        message = envelope.get("message")
        if not isinstance(message, dict):
            return
        target_instance_id = envelope.get("target_instance_id")
        exclude_instance = envelope.get("exclude_instance")
        if target_instance_id:
            peer = await self._get_peer(user_id, str(target_instance_id))
            if peer is not None:
                await self._safe_send(peer, message)
            return
        async with self._lock:
            peers = list(self._connections.get(user_id, {}).items())
        for instance_id, peer in peers:
            if exclude_instance and instance_id == exclude_instance:
                continue
            await self._safe_send(peer, message)

    def _publish(
        self,
        user_id: int,
        *,
        target_instance_id: str | None,
        message: dict[str, Any],
        exclude_instance: str | None = None,
    ) -> None:
        if not self.enable_pubsub:
            return
        redis_client = get_redis()
        if redis_client is None:
            return
        envelope = {
            "worker_id": self.worker_id,
            "target_instance_id": target_instance_id,
            "exclude_instance": exclude_instance,
            "message": jsonable_encoder(message),
        }
        try:
            redis_client.publish(_fanout_channel(user_id), json.dumps(envelope))
        except Exception:
            pass

    def _write_instance_presence(self, meta: ConnectInstanceMeta) -> None:
        redis_client = get_redis()
        if redis_client is None:
            return
        payload = json.dumps(_meta_payload(meta), default=str)
        try:
            key = f"connect:ws:instance:{meta.user_id}:{meta.playback_instance_id}"
            redis_client.setex(key, 120, payload)
            redis_client.sadd(
                f"connect:ws:instances:{meta.user_id}", meta.playback_instance_id
            )
            redis_client.expire(f"connect:ws:instances:{meta.user_id}", 120)
        except Exception:
            pass

    def _delete_instance_presence(self, user_id: int, instance_id: str) -> None:
        redis_client = get_redis()
        if redis_client is None:
            return
        try:
            redis_client.delete(f"connect:ws:instance:{user_id}:{instance_id}")
            redis_client.srem(f"connect:ws:instances:{user_id}", instance_id)
        except Exception:
            pass

    def _read_instance_presence(
        self, user_id: int, instance_id: str
    ) -> ConnectInstanceMeta | None:
        redis_client = get_redis()
        if redis_client is None:
            return None
        try:
            raw = redis_client.get(f"connect:ws:instance:{user_id}:{instance_id}")
        except Exception:
            return None
        if not raw:
            return None
        try:
            data = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return None
        return ConnectInstanceMeta(
            user_id=user_id,
            playback_instance_id=str(data.get("instance_id") or instance_id),
            device_id=str(data.get("device_id") or ""),
            device_label=data.get("device_label"),
            device_type=data.get("device_type"),
            app_platform=data.get("app_platform"),
            app_version=data.get("app_version"),
            capabilities=data.get("capabilities") or {},
            connected_at=_parse_datetime(data.get("connected_at")),
        )


def _meta_payload(meta: ConnectInstanceMeta) -> dict[str, Any]:
    return {
        "instance_id": meta.playback_instance_id,
        "device_id": meta.device_id,
        "device_label": meta.device_label,
        "device_type": meta.device_type,
        "app_platform": meta.app_platform,
        "app_version": meta.app_version,
        "capabilities": meta.capabilities,
        "connected_at": meta.connected_at.isoformat(),
    }


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _to_text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value or "")


def _fanout_channel(user_id: int) -> str:
    return f"connect:fanout:{user_id}"


def _is_dev() -> bool:
    return os.environ.get("CRATE_DEV") == "1" or os.environ.get("ENV") == "dev"


connect_hub = ConnectHub()
