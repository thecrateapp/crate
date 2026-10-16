"""Owner-only provisioning: python -m crate.agent_credentials_cli --help."""

import argparse
import json
import sys
from datetime import UTC, datetime, timedelta

from crate.agent_access import ALLOWED_GRANTS, IssuedCredential
from crate.db.repositories.agent_credentials import (
    create_credential,
    list_credentials,
    revoke_credential,
    rotate_credential,
)


def _expiry(days: int) -> datetime:
    if not 1 <= days <= 365:
        raise ValueError("--expires-in-days must be between 1 and 365")
    return datetime.now(UTC) + timedelta(days=days)


def _issued_output(issued: IssuedCredential) -> dict:
    return {
        "principal_id": issued.principal.id,
        "credential_id": issued.principal.credential_id,
        "name": issued.principal.name,
        "grants": sorted(issued.principal.grants),
        "expires_at": issued.expires_at.isoformat(),
        "token": issued.token,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Manage dedicated Crate MCP credentials"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser(
        "create", help="Create an integration; display its secret once"
    )
    create.add_argument("--name", required=True)
    create.add_argument(
        "--grant", action="append", choices=sorted(ALLOWED_GRANTS), required=True
    )
    create.add_argument("--expires-in-days", type=int, default=90)
    commands.add_parser(
        "list", help="List integration credentials without secrets or digests"
    )
    rotate = commands.add_parser(
        "rotate", help="Atomically revoke and replace one credential"
    )
    rotate.add_argument("credential_id")
    rotate.add_argument("--expires-in-days", type=int, default=90)
    revoke = commands.add_parser("revoke", help="Revoke one credential immediately")
    revoke.add_argument("credential_id")
    args = parser.parse_args(argv)
    try:
        if args.command == "create":
            output = _issued_output(
                create_credential(args.name, args.grant, _expiry(args.expires_in_days))
            )
        elif args.command == "rotate":
            output = _issued_output(
                rotate_credential(args.credential_id, _expiry(args.expires_in_days))
            )
        elif args.command == "revoke":
            output = {
                "credential_id": args.credential_id,
                "revoked": revoke_credential(args.credential_id),
            }
        else:
            output = list_credentials()
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except Exception:  # noqa: BLE001 - CLI errors must not print connection secrets.
        print(
            "Credential operation failed; check database connectivity and migrations.",
            file=sys.stderr,
        )
        return 1
    print(json.dumps(output, default=str, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
