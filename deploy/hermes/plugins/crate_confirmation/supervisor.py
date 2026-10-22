"""Narrow native incident commands, separate from domain and infrastructure review."""

import asyncio
import hashlib
import hmac
import json
import time
import urllib.request
from pathlib import Path

from . import NoRedirect

ROOT = Path("/run/crate-hermes-supervisor-native")
URL = "http://crate-operator-supervisor:8791/v1/native/decision"


class SupervisorCommands:
    def __init__(self):
        self.key = (ROOT / "callback-key").read_bytes().strip()
        identity = json.loads((ROOT / "identity.json").read_text())
        self.instance = identity["instance_id"]
        self.allowed = frozenset(identity["allowed_users"])
        if (
            len(self.key) < 32
            or not self.allowed
            or any(type(x) is not int or x <= 0 for x in self.allowed)
        ):
            raise ValueError("Invalid independent incident authority")

    def factory(self, application, adapter):
        from telegram.ext import CommandHandler

        application.add_handler(CommandHandler("crate_ack", self.ack))
        application.add_handler(CommandHandler("crate_silence", self.silence))

    async def ack(self, update, context):
        await self.decision("ack", update, context)

    async def silence(self, update, context):
        await self.decision("silence", update, context)

    async def decision(self, action, update, context):
        user, chat = update.effective_user, update.effective_chat
        if (
            not user
            or user.is_bot
            or user.id not in self.allowed
            or chat.type != "private"
            or chat.id != user.id
        ):
            return
        try:
            incident, revision, ttl, *reason = context.args
            receipt = {
                "audience": self.instance,
                "operator": "telegram:" + str(user.id),
                "incident": incident,
                "revision": int(revision),
                "action": action,
                "reason": " ".join(reason),
                "ttl": int(ttl),
                "issued_at": int(time.time()),
                "nonce": "telegram_update_" + str(update.update_id),
            }
            if (
                not receipt["reason"]
                or len(receipt["reason"]) > 500
                or not 1 <= receipt["ttl"] <= 86400
            ):
                raise ValueError("Reason and bounded TTL required")
            await asyncio.to_thread(self.post, receipt)
            message = (
                "Incident decision recorded. Monitoring and incident history continue."
            )
        except Exception:  # noqa: BLE001 — never disclose signing material or transport data
            message = "Decision unavailable. Use incident key, current revision, TTL seconds (1–86400), and an explicit reason."
        await update.effective_message.reply_text(message, parse_mode=None)

    def post(self, receipt):
        raw = json.dumps(
            receipt, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode()
        signature = hmac.new(self.key, raw, hashlib.sha256).hexdigest()
        request = urllib.request.Request(
            URL,
            data=raw,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Crate-Signature": signature,
            },
        )
        opener = urllib.request.build_opener(
            NoRedirect(), urllib.request.ProxyHandler({})
        )
        with opener.open(request, timeout=5) as response:
            if len(response.read(16385)) > 16384:
                raise ValueError("Oversized decision response")
