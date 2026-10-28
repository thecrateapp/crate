---
title: Install with an AI agent
summary: Let Claude Code, Codex or another MCP client install Crate with you through `crate mcp`.
section: start
audience: [operator]
status: canonical
order: 15
verified: 2026-10-26
sources:
  [
    app/installer/internal/copilot/server.go,
    app/installer/internal/copilot/portal.go,
    install.sh,
  ]
---

# Install with an AI agent

`crate mcp` turns the installer into an MCP server. An agent such as Claude
Code or Codex asks you what it needs in plain language, explains each choice,
checks every key with its provider and starts Crate, while the installer does
the actual work. It is the same installation `crate install` performs.

## Get the installer

```bash
curl -fsSL https://cratemusic.app/install.sh | CRATE_INSTALLER_ONLY=1 bash
```

This keeps `crate` in `~/.local/bin` without starting the wizard.

## Connect your agent

Claude Code:

```bash
claude mcp add crate-installer -- crate mcp
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.crate-installer]
command = "crate"
args = ["mcp"]
```

Any other MCP client works the same way: the command is `crate mcp` over stdio.
Use the full path (`~/.local/bin/crate`) if the client does not see your
`PATH`.

## Start

Ask the agent:

> Install Crate on this computer with the crate-installer tools. Ask me what
> you need.

The agent checks the machine and Docker, asks where your music is, how you will
reach Crate and which integrations you want, writes the installation once you
agree, starts it and runs a health check. It can also change an existing
installation; existing secrets are kept.

## Your secrets stay with you

API keys, tokens and the admin password are never typed in the chat. When the
agent needs them it gives you a link to a page served by the installer on
`127.0.0.1`. The page explains where to get each key, you paste it there, and
the installer checks it with the provider and shows you the result. The agent
only learns whether each value was accepted. Links are unguessable, local to
your computer and expire after 30 minutes. At the end, another private link
shows you the admin password.

## On a remote server

If the agent runs on a server you reach over SSH, the private page listens on
the server's `127.0.0.1`. Forward the port shown in the link before opening it,
for example `ssh -L 63033:127.0.0.1:63033 you@server`, then open the link in
your local browser.
