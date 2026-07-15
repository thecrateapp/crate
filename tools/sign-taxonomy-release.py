#!/usr/bin/env python3
"""Sign one canonical taxonomy release manifest with a stdin-only Ed25519 key."""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def _private_key(raw: bytes) -> Ed25519PrivateKey:
    value = raw.strip()
    if value.startswith(b"-----BEGIN"):
        key = serialization.load_pem_private_key(value, password=None)
        if not isinstance(key, Ed25519PrivateKey):
            raise ValueError("Expected an Ed25519 private key")
        return key
    return Ed25519PrivateKey.from_private_bytes(base64.b64decode(value, validate=True))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("release", type=Path)
    parser.add_argument("--key-id", required=True)
    args = parser.parse_args()
    payload = json.loads(args.release.read_text())
    canonical = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")
    signature = _private_key(sys.stdin.buffer.read()).sign(canonical)
    json.dump(
        {
            "algorithm": "ed25519",
            "key_id": args.key_id,
            "schema": "crate-taxonomy-signature-v1",
            "signature": base64.b64encode(signature).decode("ascii"),
        },
        sys.stdout,
        sort_keys=True,
        indent=2,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
