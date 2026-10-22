"""Disposable acceptance-only native plugin; never installed by operator packaging.

Inspect and invoke the gateway's already registered MCP tools through its standard
call dispatcher. No discovery, connection creation, registration or upstream patch.
"""

import asyncio
import json
import os


def register(ctx):
    from telegram.ext import CommandHandler

    async def probe(update, context):
        from model_tools import handle_function_call
        from tools.registry import registry

        if (
            update.effective_user.id != 123
            or update.effective_chat.id != 123
            or update.effective_chat.type != "private"
            or context.args
            not in (
                ["cold"],
                ["cold-repeat"],
                ["cold-third"],
                ["recovered"],
                ["revoked"],
            )
        ):
            return
        phase = context.args[0]
        names = registry.get_tool_names_for_toolset("mcp-crate")
        requested = {
            "read": ("mcp__crate__get_instance_inventory", {}),
            "prepare": (
                "mcp__crate__preview_job_retry",
                {"job_id": "synthetic-job", "idempotency_key": "probe-" + phase},
            ),
        }
        evidence = {
            "phase": phase,
            "pid": os.getpid(),
            "home": os.environ.get("HOME"),
            "uid": os.getuid(),
            "cwd": os.getcwd(),
            "xdg_state_home": os.environ.get("XDG_STATE_HOME"),
            "registered_domain_tools": len(names),
            "registered": {key: name in names for key, (name, _) in requested.items()},
            "handlers": {},
            "results": {},
        }
        for key, (name, args) in requested.items():
            entry = registry.get_entry(name)
            evidence["handlers"][key] = id(entry.handler) if entry else None
            evidence["results"][key] = await asyncio.to_thread(
                handle_function_call, name, args
            )
        await update.effective_message.reply_text(
            "CRATE_PROBE " + json.dumps(evidence), parse_mode=None
        )

    def factory(application, adapter):
        application.add_handler(CommandHandler("crate_probe", probe))

    ctx.register_telegram_handler(factory)
