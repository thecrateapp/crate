"""Owner-only provisioning: python -m crate.agent_credentials_cli --help."""

import argparse
import json
import sys
from datetime import UTC, datetime, timedelta

from crate.agent_access import ALLOWED_GRANTS, IssuedCredential
from crate.agent_diagnostics import DiagnosticError
from crate.agent_scope_catalog import SCOPE_DETAILS
from crate.db.repositories.agent_credentials import (
    create_credential,
    identify_credential,
    list_credentials,
    require_principal_approval,
    revoke_credential,
    rotate_credential,
)


def _expiry(days: int) -> datetime:
    if not 1 <= days <= 365:
        raise ValueError("--expires-in-days must be between 1 and 365")
    return datetime.now(UTC) + timedelta(days=days)


def _issued_output(issued: IssuedCredential, require_approval=None) -> dict:
    output = {
        "principal_id": issued.principal.id,
        "credential_id": issued.principal.credential_id,
        "name": issued.principal.name,
        "grants": sorted(issued.principal.grants),
        "expires_at": issued.expires_at.isoformat(),
        "token": issued.token,
    }
    if require_approval is not None:
        output["require_approval"] = require_approval
    return output


def _changes_anything(grants) -> bool:
    return any(SCOPE_DETAILS[grant].access == "change" for grant in grants)


def _identify() -> dict:
    found = identify_credential(sys.stdin.readline().strip())
    if found is None:
        raise ValueError("The token does not belong to any service credential")
    return found


def _bind_approver(args) -> dict:
    from crate.db.repositories.agent_human_sessions import ApprovedHuman
    from crate.db.repositories.agent_telegram import bind_human
    from crate.db.repositories.auth_user_accounts import get_user_by_email

    user = get_user_by_email(args.user_email.strip())
    if user is None:
        raise ValueError(f"No Crate user has the email {args.user_email}")
    return bind_human(
        ApprovedHuman(id=user["id"]), args.principal_id, args.telegram_user_id
    )


def _show_approver(args) -> dict | None:
    from crate.db.repositories.agent_telegram import list_bindings

    bindings = list_bindings(principal_id=args.principal_id)
    if bindings["instance_id"] is None:
        raise ValueError("CRATE_AGENT_INSTANCE_ID is not configured")
    return bindings["items"][0] if bindings["items"] else None


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
    create.add_argument(
        "--require-approval",
        action="store_true",
        help="Changes need human approval (always on when a grant can change things)",
    )
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
    commands.add_parser(
        "identify", help="Read a token on stdin and print its credential, not secrets"
    )
    approval = commands.add_parser(
        "require-approval", help="Make every change of an integration need approval"
    )
    approval.add_argument("principal_id")
    bind = commands.add_parser(
        "bind-approver",
        help="Bind a Crate user to the Telegram account that approves plans",
    )
    bind.add_argument("--principal-id", required=True)
    bind.add_argument("--telegram-user-id", type=int, required=True)
    bind.add_argument("--user-email", required=True)
    show = commands.add_parser(
        "show-approver", help="Show the Telegram approver bound to an integration"
    )
    show.add_argument("--principal-id", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "create":
            require_approval = args.require_approval or _changes_anything(args.grant)
            output = _issued_output(
                create_credential(
                    args.name,
                    args.grant,
                    _expiry(args.expires_in_days),
                    require_approval=require_approval,
                ),
                require_approval,
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
        elif args.command == "identify":
            output = _identify()
        elif args.command == "require-approval":
            output = {
                "principal_id": args.principal_id,
                "require_approval": True,
                "changed": require_principal_approval(args.principal_id),
            }
        elif args.command == "bind-approver":
            output = _bind_approver(args)
        elif args.command == "show-approver":
            output = _show_approver(args)
        else:
            output = list_credentials()
    except (ValueError, DiagnosticError) as exc:
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
