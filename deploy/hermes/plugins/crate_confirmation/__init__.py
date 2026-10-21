"""Hermes v0.22.2 public native handler API; no model-visible approval capability."""

import asyncio
import hashlib
import hmac
import json
import re
import secrets
import time
import urllib.request
from pathlib import Path

PATH = "/api/internal/agent-telegram/events"
URL = "http://crate-api:8585" + PATH
KEY_FILE = Path("/run/crate-hermes-native/callback-key")
IDENTITY_FILE = Path("/run/crate-hermes-native/identity.json")
PATTERN = r"^ct:d:[a-f0-9]{32}:(next|approve|reject)$"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Native redirects are forbidden")


class DomainProvider:
    prefix = "ct:d:"
    pattern = PATTERN

    def __init__(self):
        # The file is mounted only for native code. Key bytes never enter model
        # config, managed env, a tool response, or a subprocess command line.
        self.key = KEY_FILE.read_bytes().strip()
        identity = json.loads(IDENTITY_FILE.read_text())
        self.instance = identity["instance_id"]
        self.allowed = frozenset(identity["allowed_users"])
        if (
            len(self.key) < 32
            or not self.allowed
            or any(type(x) is not int or x <= 0 for x in self.allowed)
        ):
            raise ValueError("Invalid native configuration")
        self.opener = urllib.request.build_opener(
            NoRedirect(), urllib.request.ProxyHandler({})
        )

    def _post(self, event):
        body = json.dumps(
            {**event, "instance_id": self.instance}, separators=(",", ":")
        ).encode()
        timestamp, nonce = str(int(time.time())), secrets.token_hex(16)
        signature = hmac.new(
            self.key,
            b"POST\n"
            + PATH.encode()
            + b"\n"
            + timestamp.encode()
            + b"\n"
            + nonce.encode()
            + b"\n"
            + body,
            hashlib.sha256,
        ).hexdigest()
        request = urllib.request.Request(
            URL,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Crate-Timestamp": timestamp,
                "X-Crate-Nonce": nonce,
                "X-Crate-Signature": signature,
            },
        )
        with self.opener.open(request, timeout=10) as response:
            raw = response.read(16385)
        if len(raw) > 16384:
            raise ValueError("Native response is too large")
        return json.loads(raw)

    async def event(self, event):
        return await asyncio.to_thread(self._post, event)


class NativePresenter:
    def __init__(self, ctx, providers):
        self.ctx, self.providers = ctx, tuple(providers)
        self.tasks, self.application = [], None

    def close(self):
        self.application = None
        for task in self.tasks:
            task.cancel()
        self.tasks.clear()

    def factory(self, application, adapter):
        from telegram.ext import CallbackQueryHandler

        # connect() may replace PTB Application after a failed connection. Cancel
        # every old generation before starting provider-specific supervised loops.
        self.close()
        self.application = application
        for provider in self.providers:

            async def callback(update, context, provider=provider):
                if self.application is application:
                    await self.callback(provider, update)

            application.add_handler(
                CallbackQueryHandler(callback, pattern=provider.pattern)
            )
            self.tasks.append(
                self.ctx.spawn_task(
                    self.present(application, provider), name="crate-native-presenter"
                )
            )

    async def callback(self, provider, update):
        query = update.callback_query
        message, user = query.message, query.from_user
        if (
            not re.fullmatch(provider.pattern, query.data or "")
            or not message
            or message.chat.type != "private"
            or user.is_bot
            or user.id not in provider.allowed
            or message.chat.id != user.id
        ):
            await query.answer("Private bound human required", show_alert=True)
            return
        _, _, confirmation, action = query.data.split(":")
        await query.answer()
        try:
            result = await provider.event(
                {
                    "kind": "callback",
                    "confirmation_id": confirmation,
                    "action": action,
                    "chat_id": message.chat.id,
                    "chat_type": message.chat.type,
                    "message_id": message.message_id,
                    "user_id": user.id,
                    "update_id": update.update_id,
                    "query_id": query.id,
                }
            )
            if result["state"] == "expired":
                await message.reply_text("Plan confirmation expired.", parse_mode=None)
            # Terminal outcomes have their own persisted delivery receipt. The
            # presenter retries them even if this callback response is lost.
        except Exception:  # noqa: BLE001 — SDK transport failures contain secrets
            # Never log upstream bodies, key material, or native event identity.
            await message.reply_text(
                "Confirmation unavailable or no longer current. Inspect the plan/job before retrying.",
                parse_mode=None,
            )

    async def present(self, application, provider):
        from telegram import InlineKeyboardButton, InlineKeyboardMarkup

        while self.application is application:
            try:
                result = await provider.event({"kind": "pending"})
                if self.application is not application:
                    return
                if result["state"] in {"page", "outcome"}:
                    if result["chat_id"] not in provider.allowed:
                        raise ValueError("Unbound native destination")
                    outcome = result["state"] == "outcome"
                    if outcome:
                        value = result["result"]
                        message_text = (
                            "Plan: "
                            + value["state"]
                            + "\nConfirmation: "
                            + result["confirmation_id"]
                        )
                        if value.get("job"):
                            message_text += "\nJob: " + value["job"]["job_id"]
                        if value.get("reason"):
                            message_text += "\nApply unavailable: " + value["reason"]
                        markup = None
                    else:
                        message_text = result["text"]
                        last = result["page_index"] + 1 == result["page_count"]
                        prefix = provider.prefix + result["confirmation_id"] + ":"
                        markup = InlineKeyboardMarkup(
                            [
                                [
                                    InlineKeyboardButton(
                                        "Aprobar" if last else "Siguiente",
                                        callback_data=prefix
                                        + ("approve" if last else "next"),
                                    ),
                                    InlineKeyboardButton(
                                        "Rechazar", callback_data=prefix + "reject"
                                    ),
                                ]
                            ]
                        )
                    message = await application.bot.send_message(
                        chat_id=result["chat_id"],
                        text=message_text,
                        parse_mode=None,
                        disable_web_page_preview=True,
                        reply_markup=markup,
                    )
                    if self.application is not application:
                        return
                    # Buttons can be displayed with the page, but server admission
                    # remains disabled until this delivery receipt commits.
                    await provider.event(
                        {
                            "kind": "outcome_delivered" if outcome else "delivered",
                            "confirmation_id": result["confirmation_id"],
                            "chat_id": result["chat_id"],
                            "message_id": message.message_id,
                            **({} if outcome else {"page_index": result["page_index"]}),
                        }
                    )
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001, S110 — bounded native retry; provider errors contain secrets
                pass  # bounded retries; no provider bodies/credentials in logs
            await asyncio.sleep(2)


def register(ctx):
    # Later independent recovery providers have their own fixed transport,
    # namespace and presenter task. Domain outage cannot block another provider.
    presenter = NativePresenter(ctx, [DomainProvider()])
    ctx.register_telegram_handler(presenter.factory)
    ctx.on_unload(presenter.close)
