"""Independent native infrastructure provider. Install/register separately in Task7."""

import asyncio
import hashlib
import hmac
import json
import secrets
import time
import urllib.request
from pathlib import Path

from . import NoRedirect

PATH = "/v1/native/events"
URL = "http://crate-infra-relay:8788" + PATH
KEY_FILE = Path("/run/crate-hermes-infra-native/callback-key")
IDENTITY_FILE = Path("/run/crate-hermes-infra-native/identity.json")


class InfraProvider:
    prefix = "ct:i:"
    pattern = r"^ct:i:[a-f0-9]{32}:(next|approve|reject)$"

    def __init__(self):
        self.key = KEY_FILE.read_bytes().strip()
        identity = json.loads(IDENTITY_FILE.read_bytes())
        self.instance = identity["instance_id"]
        self.allowed = frozenset(identity["allowed_users"])
        if (
            len(self.key) < 32
            or not self.allowed
            or any(type(user) is not int or user <= 0 for user in self.allowed)
        ):
            raise ValueError("Invalid independent native identity")
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
        req = urllib.request.Request(
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
        with self.opener.open(req, timeout=10) as response:
            raw = response.read(16385)
        if len(raw) > 16384:
            raise ValueError("Native response bound")
        return json.loads(raw)

    async def event(self, event):
        return await asyncio.to_thread(self._post, event)
