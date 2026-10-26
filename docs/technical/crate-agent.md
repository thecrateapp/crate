---
title: Crate Agent and Crate Operator over Telegram
summary: Set up, run and troubleshoot the read-only Crate Agent and the approval-gated Crate Operator on Telegram.
section: operations
audience: [operator]
status: canonical
order: 122
verified: 2026-10-26
sources:
  - Makefile
  - scripts/agent_setup.py
  - docker-compose.home.yaml
  - deploy/install/integrations.yaml
  - app/installer/internal/agent/setup.go
  - app/installer/internal/wizard/agent.go
  - app/installer/internal/copilot/agent.go
  - app/installer/internal/doctor/doctor.go
  - .env.example
  - docker-compose.yaml
  - deploy/operator/compose.operator.yaml
  - deploy/hermes/Dockerfile
  - deploy/hermes/runtime.py
  - deploy/hermes/domain_mcp.py
  - deploy/hermes/context_server.py
  - deploy/hermes/SOUL.md
  - deploy/hermes/SOUL.operator.md
  - deploy/hermes/config.json
  - deploy/hermes/config.operator.json
  - app/crate/agent_scope_catalog.py
  - app/crate/agent_credentials_cli.py
  - app/crate/operator_provenance.py
  - deploy/operator/provenance.py
  - app/crate/api/agent_telegram.py
  - app/crate/api/agent_guards.py
  - app/crate/db/repositories/agent_telegram.py
  - app/ui/src/components/agents/connections/TelegramApprovers.tsx
  - app/crate/db/migrations/versions/138_remove_legacy_telegram_settings.py
  - deploy/operator/supervisor.py
  - deploy/operator/config.operator.example.json
  - scripts/deploy.sh
  - scripts/deploy-remote.sh
  - app/tests/test_agent_compose.py
  - app/tests/test_agent_setup.py
  - app/tests/test_hermes_runtime.py
---

# Crate Agent and Crate Operator over Telegram

Crate ships two optional Telegram assistants that talk to your instance through the
[Crate MCP](crate-mcp.md). Both run in the `crate-agent` image, on the host that runs the
stack, with their own bot, model login, conversations, memory and MCP credential.

|                           | Crate Agent                       | Crate Operator                                                                       |
| ------------------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| Purpose                   | Read-only diagnosis and questions | Diagnosis plus changes you approve in Telegram                                       |
| Make profile              | `AGENT_PROFILE=agent` (default)   | `AGENT_PROFILE=operator`                                                             |
| Compose service / profile | `crate-agent` / `agent`           | `crate-operator` / `crate-operator`, overlay `deploy/operator/compose.operator.yaml` |
| State directory           | `${DATA_DIR}/crate-agent`         | `CRATE_OPERATOR_ROOT`, default `${DATA_DIR}/crate-operator`                          |
| MCP credential preset     | "Crate Agent (read only)"         | "Crate Operator"                                                                     |
| Crate MCP tools           | 12, all read-only                 | 69, writes only through approved plans                                               |
| Push alerts               | No                                | Through the supervisor, set up by `make agent-init`                                  |

Never run both at the same time. `make agent-up` refuses to start one while the other
container is running.

## What they are

### What they replace

The built-in Telegram bot that ran inside `crate-worker` (slash commands such as
`/status`, `/tasks`, `/download`, `/cancel` and `/logs`, plus task and new-release
notifications) has been removed:

- Questions about status, jobs, logs and library health go to Crate Agent, in plain language.
- Downloads, retries, cancellations and other changes go to Crate Operator, which prepares
  an exact plan and applies it only after you press Approve.
- Push notifications come from the Crate Operator supervisor rules (`health-score`,
  `failed-tasks`, `new-releases`, see [Supervisor alerts](#supervisor-alerts)). Per-task
  completion messages and playback notifications were deliberately not recreated.
- Migration 138 deletes the old `telegram_enabled`, `telegram_bot_token` and
  `telegram_chat_id` settings, including the plaintext token. The Admin settings for the
  old bot are gone. The worker still accepts `--no-telegram` and ignores it, so existing
  compose commands keep working for one release.

### What they can and cannot do

Crate Agent can read instance status, jobs, diagnostics and worker logs, library issues,
artist details, library quality, analysis status, the sanitized audit log, schedules and
runtime policy. It can also search and read the documentation and sources of the deployed
release (the [release context](#release-context)) and keep a memory of verified facts.

Crate Operator can do all of that, and can also prepare plans that change the instance:
repairs, metadata edits, enrichment, analysis, library sync, health and quality checks,
Tidal and catalog acquisitions (one album, or a complete discography of up to 50 albums),
show imports, editorial playlists, metadata export and rehydration, schedule and runtime
policy changes, and job retry or cancellation. Each plan runs only after a human approves
it with a Telegram button.

Neither assistant has a shell, file access, code execution, web browsing, delegation, cron
jobs, messaging to other chats, the Docker socket, SSH keys or the music mount. Those
tool families are disabled in the managed configuration, and the containers carry no such
mounts.

### Safety summary

- Only the numeric Telegram user IDs you list can talk to the bot, and only in private
  chats. Messages from other bots are ignored.
- Crate Agent refuses to start if its credential exposes any tool that is not annotated as
  read-only.
- Crate Operator never approves anything itself. Only a button pressed by the bound human
  approves a plan; free text such as "yes" never does.
- Crate Operator can change things only while every running Crate image is an official
  GHCR image, which its provenance service checks continuously. Otherwise it stays
  read-only ([Provenance](#provenance-and-the-read-only-fallback)).
- Text from logs, metadata, documents and tool results is treated as data. It cannot widen
  the assistant's permissions.

## Requirements

Both profiles need:

- A running stack: a home install made with `crate install`, which needs no checkout and
  no Python on the host ([Home installs](#home-installs)), or a checkout of the
  repository, where `make` runs `scripts/agent_setup.py` with the host `python3`.
  `crate-api` must be running and migrated, because the MCP credential is created inside
  it.
- In `.env`: `DATA_DIR`, `PUID`/`PGID`, and `DOMAIN` or `CRATE_AGENT_MCP_HOST` (the API
  host clients use, for example `api.example.com`).
- `CRATE_MCP_ENABLED=true`, and the MCP host listed in `CRATE_MCP_ALLOWED_HOSTS`.
  `make agent-init` offers to set both and recreates `crate-api` when it changes them.
- The `crate-agent` image. By default the compose files use
  `ghcr.io/thecrateapp/crate-agent:${CRATE_IMAGE_TAG:-latest}`; `CRATE_AGENT_IMAGE`
  overrides it.
- Outbound HTTPS from the host to `api.telegram.org` and to your model provider.
- A Telegram bot used by nothing else, and the numeric Telegram IDs of the people allowed
  to talk to it.

Crate Operator also needs:

- `CRATE_MCP_ACTIONS_ENABLED=true` (set by `make agent-init AGENT_PROFILE=operator`).
- `CRATE_OPERATOR_PRINCIPAL_IDS` and `CRATE_AGENT_INSTANCE_ID` in `.env` (set by the same
  command). The operator overlay refuses to start `crate-api` and the workers without them.
- A Crate account with the admin role to approve plans. `make agent-init
AGENT_PROFILE=operator` binds it to that person's Telegram account
  ([Bind the approving human](#bind-the-approving-human)).
- For changes to actually run: the official images from `ghcr.io/thecrateapp`, pulled
  by any tag (such as `latest`) or digest. `make agent-up` starts the provenance service
  that verifies them; it needs the host Docker socket, `/var/run/docker.sock` by default
  (`CRATE_DOCKER_SOCKET` overrides it, for example for rootless Docker). Local builds
  keep it read-only.

## Create the Telegram bot

1. In Telegram, open a chat with `@BotFather` and send `/newbot`.
2. Give the bot a display name, then a username that ends in `bot`.
3. BotFather replies with a token such as `123456789:AA...`. Keep it private; anyone with
   it can impersonate the bot.
4. Optional: send `/setjoingroups`, pick the bot and choose Disable. The assistants only
   answer private chats from allowlisted users anyway.
5. Every person who should use the bot opens a chat with `@userinfobot` and sends any
   message. It replies with their numeric user ID (for example `12345678`). Usernames do
   not work; the allowlist takes only numeric IDs.
6. Each of those people opens the new bot and presses Start, so the bot can message them.

Use a new bot for Crate. A Telegram token can have only one process polling it; if two
programs (an old bot, a personal assistant, the other Crate profile) share a token, both
get `409 Conflict` errors and messages go missing. Do not reuse the token of the removed
built-in bot; revoke it in BotFather with `/revoke` if it is still valid.

## Home installs

On an installation made with `crate install`, the installer sets the assistants up; there
is no `make` and nothing to run by hand:

```bash
crate install              # offers Crate Agent among the integrations
crate configure agent      # Crate Agent or Crate Operator, switch between them, or turn off
crate doctor               # whether the assistant runs, reaches Crate and has its model
```

`crate install` (and `crate mcp`, the install copilot) offers only Crate Agent. Crate
Operator recreates Crate's services with its overlay, so it is offered only by
`crate configure agent` once Crate runs. `crate configure telegram` opens the same form.

The form asks for the bot token, then asks everyone who may use the bot to send it a
message and offers those accounts as the allowlist (or takes numeric IDs). It asks for the
model provider, the model, the base URL where the provider takes one, and the API key
where it needs one. Crate Operator also asks for the admin who approves changes. On a
re-run every answer can be kept as it is.

Once Crate answers, the installer:

1. Writes the answers to the setup script in a throwaway `crate-api` container
   (`docker compose run --rm crate-api`) with the install folder and the data folder
   mounted at their host paths. The bot token, allowlist and model key travel only in
   that container's environment; they never reach `.env` or a command line. The script
   is `scripts/agent_setup.py --in-container`: it creates the MCP credential with the
   credential CLI in that container and writes the secrets as root, owned by `PUID:PGID`,
   keeping the owner of `.env`.
2. Adds the `agent` or `crate-operator` profile to `COMPOSE_PROFILES`. For Crate Operator
   it also sets `COMPOSE_FILE=docker-compose.yaml:deploy/operator/compose.operator.yaml`,
   so a plain `docker compose up -d` in the install folder keeps the overlay. Without
   `/run/crate-infra/bridge.sock` the infrastructure relay stays stopped.
3. Starts the stack, waits until the assistant reaches Crate MCP, and asks the model for
   one word.

`openai-codex` and `nous` without a key need a sign-in. The installer runs it in your
terminal ("Sign in to ChatGPT"). When it cannot (an unattended install, the install
copilot, or you skipped it), it says "Sign-in pending: run `crate configure agent`", and
`crate doctor` warns until you do. Run that command in a terminal and keep every answer;
it offers the sign-in again.

Switching between Crate Agent and Crate Operator keeps the bot, the allowlist and the
model keys, and revokes the credential of the mode you leave. Turning the assistant off
stops its services, removes its profile (and the operator overlay), revokes its MCP
credentials and deletes `telegram-token`, `allowed-users` and `mcp-token`. Model keys in
`secrets/model-keys/`, the sign-in and the conversation memory under `home/` stay, so
turning it on again does not ask for them; delete those folders to remove them as well.

For an unattended install, set the answers in the environment of
`crate install --yes`: `CRATE_AGENT_MODE=agent`, `AGENT_TELEGRAM_TOKEN`,
`AGENT_ALLOWED_USERS`, `CRATE_AGENT_PROVIDER`, `CRATE_AGENT_MODEL` and, where needed,
`AGENT_MODEL_API_KEY`.

## Quick start: Crate Agent

Run these from the checkout that runs the stack:

```bash
make agent-init      # guided setup, then starts the agent and runs the smoke test
make agent-status    # containers, health reason and prerequisite checks
make agent-smoke     # live MCP discovery plus one real model reply
```

`make agent-init` walks through these steps:

1. Creates `${DATA_DIR}/crate-agent/{home,secrets,context}` with private permissions,
   owned by `PUID:PGID` when run as root. It warns when your user differs from `PUID`.
2. Offers to set `CRATE_MCP_ENABLED=true` and to add the MCP host to
   `CRATE_MCP_ALLOWED_HOSTS`.
3. Asks for the BotFather token and checks it against Telegram `getMe`.
4. Asks for the allowed numeric user IDs, comma-separated.
5. Creates an MCP credential with the "Crate Agent (read only)" preset by running
   `python -m crate.agent_credentials_cli create` inside `crate-api`, with a 365-day expiry.
6. Asks for the model provider, model, base URL and API key where they apply
   ([The model](#the-model)).
7. Writes the `CRATE_AGENT_*` and MCP settings to `.env`, recreates `crate-api` if an MCP
   setting changed, and starts `crate-agent`.
8. Runs the ChatGPT or Nous login inside the container when the provider needs one.
9. Runs `make agent-smoke` and prints the next steps.

Secrets are written with mode 600. When a valid secret already exists, the command asks
before replacing it (default: keep it). You can run `make agent-init` again at any time to
change one thing and keep the rest.

Day-to-day commands:

```bash
make agent-up        # start after checking prerequisites (only crate-agent is started)
make agent-logs      # follow the logs
make agent-down      # stop and remove the container; state stays on disk
```

On the project-hosted server, pass both compose files:
`AGENT_COMPOSE_FILES=docker-compose.yaml:docker-compose.project.yaml`.

### Non-interactive setup

For automation, pass `--non-interactive` through `AGENT_INIT_FLAGS` and provide values
through the environment. The command also runs non-interactively when standard input is
not a terminal.

```bash
AGENT_TELEGRAM_TOKEN='123456789:AA...' \
AGENT_ALLOWED_USERS='12345678,87654321' \
CRATE_AGENT_PROVIDER=anthropic \
CRATE_AGENT_MODEL='<model id>' \
AGENT_MODEL_API_KEY='<api key>' \
make agent-init AGENT_INIT_FLAGS="--non-interactive"
```

| Variable or flag                                                    | Meaning                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `AGENT_TELEGRAM_TOKEN`                                              | BotFather token                                                                                               |
| `AGENT_ALLOWED_USERS`                                               | Comma-separated numeric Telegram user IDs                                                                     |
| `AGENT_MODEL_API_KEY`                                               | Key for key-based providers; optional for `nous` and `custom`                                                 |
| `CRATE_AGENT_PROVIDER`, `CRATE_AGENT_MODEL`, `CRATE_AGENT_BASE_URL` | Model selection                                                                                               |
| `AGENT_APPROVER_EMAIL`                                              | Crate Operator only: email of the Crate admin who approves plans; empty skips the binding                     |
| `AGENT_APPROVER_TELEGRAM_ID`                                        | Crate Operator only: that person's Telegram user ID; default the first allowed user                           |
| `--non-interactive`                                                 | Never prompt. MCP flags, the allowed host and the supervisor are set up automatically                         |
| `--replace`                                                         | Replace existing secrets instead of keeping them (non-interactive only). Replaced MCP credentials are revoked |
| `--no-start`                                                        | Write the configuration and stop before starting the container                                                |
| `--no-network`                                                      | Skip the Telegram `getMe` token check                                                                         |

Environment values win over `.env` and are used without prompting, also in interactive
mode. Non-interactive runs skip the OAuth login; run `make agent-auth` afterwards from a
terminal. Combine flags in one string: `AGENT_INIT_FLAGS="--non-interactive --no-start"`.

## Quick start: Crate Operator

```bash
make agent-down                          # stop Crate Agent if it runs
make agent-init AGENT_PROFILE=operator   # guided setup for the operator profile
make agent-status AGENT_PROFILE=operator
```

Nothing else is needed in the Admin. Compared with Crate Agent, the operator setup also:

- Sets `CRATE_MCP_ACTIONS_ENABLED=true`.
- Creates the credential with the "Crate Operator" preset and **Require approval before
  changes** turned on (`--require-approval`), and adds its principal ID to
  `CRATE_OPERATOR_PRINCIPAL_IDS`. When you keep an existing credential, the setup looks it
  up in `crate-api`, adds its principal ID and offers to turn approval on if it is off.
- Generates `CRATE_AGENT_INSTANCE_ID` (`crate-` plus 12 hex characters) once.
- Writes `secrets/domain-native/callback-key` (the key that signs button events between
  the bot and `crate-api`) and `secrets/domain-native/identity.json` (instance ID and the
  allowed Telegram users).
- Asks for the email of the Crate admin who approves plans and their Telegram user ID
  (default: the first allowed user), and binds them
  ([Bind the approving human](#bind-the-approving-human)). Leave the email empty to bind
  later from the Admin.
- Provisions the supervisor that pushes alerts to the chat
  ([Supervisor alerts](#supervisor-alerts)): its own read-only MCP credential, the shared
  keys, the alert destination and `supervisor-config.json`.
- Creates the operator layout under `CRATE_OPERATOR_ROOT`: `home/`, `secrets/domain/` (the
  same secret files Crate Agent uses), the other `secrets/*` directories, `context/`,
  `context/public/`, `provenance/` and `supervisor-state/`.
- Starts the stack with the overlay. This recreates `crate-api` and the workers, which
  need the principal IDs, the instance ID and the provenance mounts, and starts
  `crate-operator`, `crate-operator-supervisor` and the provenance services
  `crate-provenance` and `crate-provenance-docker`. `make agent-up AGENT_PROFILE=operator`
  prints a warning before doing it.

The infrastructure relay starts only when the root-owned host bridge socket
`/run/crate-infra/bridge.sock` exists ([Optional infrastructure relay](#optional-infrastructure-relay)),
and the supervisor only when `supervisor-config.json` exists (you declined it during
setup). `make agent-status AGENT_PROFILE=operator` lists each one that stays stopped and
why.

`make agent-down AGENT_PROFILE=operator` stops `crate-operator`, `crate-infra-relay`,
`crate-operator-supervisor`, `crate-provenance` and `crate-provenance-docker`. `crate-api`
and the workers keep the overlay until you recreate the stack without it; without fresh
provenance they accept no operator changes.

You can use the bot that Crate Agent used, but only after `make agent-down`: one token,
one poller.

## The model

The model comes from three `.env` settings and one key file per provider:

- `CRATE_AGENT_PROVIDER` (default `openai-codex`)
- `CRATE_AGENT_MODEL` (default `gpt-6-luna`, only for `openai-codex`; required for every
  other provider)
- `CRATE_AGENT_BASE_URL` (only where the table allows it)
- `secrets/model-keys/<provider>`: `${DATA_DIR}/crate-agent/secrets/model-keys/` for Crate
  Agent, `${CRATE_OPERATOR_ROOT}/secrets/domain/model-keys/` for Crate Operator. Each
  provider keeps its own key, so switching back and forth needs no new key. Keys never go
  in `.env`.

| Provider       | Sign-in                            | Key file                        | Base URL                     |
| -------------- | ---------------------------------- | ------------------------------- | ---------------------------- |
| `openai-codex` | ChatGPT account, `make agent-auth` | Not used                        | Not allowed                  |
| `openai-api`   | API key                            | Required (`OPENAI_API_KEY`)     | Optional (`OPENAI_BASE_URL`) |
| `anthropic`    | API key                            | Required (`ANTHROPIC_API_KEY`)  | Not allowed                  |
| `openrouter`   | API key                            | Required (`OPENROUTER_API_KEY`) | Not allowed                  |
| `nous`         | API key or `make agent-auth`       | Optional (`NOUS_API_KEY`)       | Not allowed                  |
| `gemini`       | API key                            | Required (`GEMINI_API_KEY`)     | Not allowed                  |
| `deepseek`     | API key                            | Required (`DEEPSEEK_API_KEY`)   | Not allowed                  |
| `custom`       | Optional API key                   | Optional                        | Required                     |

`custom` is any OpenAI-compatible endpoint: Ollama, vLLM, LM Studio or a gateway. The
variable in parentheses is where the runtime places the key inside the container.

### Switch the model

```bash
make agent-model PROVIDER=anthropic MODEL=claude-sonnet-5
make agent-model PROVIDER=openai-codex MODEL=gpt-6-luna AGENT_PROFILE=operator
```

The command validates the combination and the key of the selected provider, writes the
three `CRATE_AGENT_*` values to `.env` and recreates only the agent container. It tells you
when the new provider still needs `make agent-auth`. Conversations and memory are kept.

For a key-based provider it reads `secrets/model-keys/<provider>`. When the file is
missing, it asks for the key in a terminal, or takes it from `AGENT_MODEL_API_KEY`; without
either it stops before changing anything, with
`Provider <name> needs an API key in .../model-keys/<name>`. When a key is stored, an
interactive run asks whether to replace it (default: keep it), which is also how you rotate
a key.

Setups from before per-provider keys have one `secrets/model-api-key`. The runtime keeps
using it until the first `model-keys/` file exists. The next `make agent-model` or
`make agent-init` moves it to `model-keys/<provider>` for the provider configured in
`.env`. When that provider takes no key (`openai-codex`), the key's provider cannot be
known, so the file is left in place, reported, and no longer used once a per-provider key
exists; enter the key again with `make agent-model`.

### ChatGPT login

`openai-codex` uses your ChatGPT subscription instead of an API key:

```bash
make agent-auth                          # Crate Agent
make agent-auth AGENT_PROFILE=operator   # Crate Operator
```

This runs `hermes auth add openai-codex --type oauth` inside the running container as
`PUID:PGID`; follow the sign-in instructions it prints. The login is
stored in the profile's `home/auth.json`, so it survives restarts and upgrades. Each
profile has its own login. Without a terminal, the command prints the exact
`docker exec -it` line to run instead. If the credentials already work, it says so and does
nothing. The same command logs in to `nous` when no Nous key is stored.

Until the login exists, the container keeps running so you can log in, but its health
check stays unhealthy and names `make agent-auth`.

### Local models with Ollama

The URL must be reachable from inside the container. `localhost` there is the container
itself, not the host. Use the host's LAN address, or the service name when Ollama runs on
the same Docker network:

```bash
make agent-model PROVIDER=custom MODEL=qwen3:32b BASE_URL=http://192.168.1.20:11434/v1
make agent-model PROVIDER=custom MODEL=qwen3:32b BASE_URL=http://ollama:11434/v1
```

The assistants depend on tool calling for every answer. Choose a model that handles tool
calls reliably, and check it with `make agent-smoke` and a real question in Telegram.

### What not to do

- Do not run `hermes model` or edit `home/config.yaml` inside the container. On every
  start the runtime renders the managed configuration into `/etc/hermes` (a private
  tmpfs), and that configuration wins key by key. Your change has no effect; use
  `make agent-model`.
- Do not put API keys in `.env` or in `CRATE_AGENT_BASE_URL`.
- Do not set `BASE_URL` for a provider that does not take one; the start fails with
  "CRATE_AGENT_BASE_URL is not used by provider ...".

## Credentials and permissions

Each profile uses one dedicated Crate MCP service credential, stored in
`secrets/mcp-token`. The presets live in `app/crate/agent_scope_catalog.py` and also
appear in Admin > Agents when you create an integration by hand.

| Preset                  | Grants                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crate Agent (read only) | `library.health.read`, `ops.status.read`, `ops.jobs.read`, `ops.logs.read`, `ops.audit.read`, `ops.schedules.read`, `ops.runtime.read`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Crate Operator          | All Crate Agent grants, plus `library.health.run`, `library.quality.run`, `library.repair.run`, `library.repair.photo_flag`, `library.metadata.write`, `library.metadata.export`, `library.metadata.rehydrate`, `library.enrichment.run`, `library.analysis.run`, `library.sync.run`, `library.acquisition.search`, `library.acquisition.write`, `ops.jobs.retry`, `ops.jobs.cancel`, `ops.schedules.run`, `ops.schedules.write`, `ops.runtime.write`, `curation.shows.read`, `curation.shows.write`, `editorial.read`, `editorial.prepare`, `editorial.write`, `editorial.publish` |

Grants are an upper bound; the tool lists in `deploy/hermes/config.json` and
`config.operator.json` decide what the model can call. The legacy `retry_job` and
`cancel_job` tools are never exposed to Crate Operator; it uses the plan-based
`preview_job_retry`/`apply_job_retry` and `preview_job_cancel`/`apply_job_cancel` tools.

### Expiry and rotation

`make agent-init` issues credentials valid for 365 days, the maximum. Rotate before they
expire; an expired credential makes the MCP checks fail. Run these on the stack host:

```bash
docker exec crate-api python -m crate.agent_credentials_cli list
docker exec crate-api python -m crate.agent_credentials_cli rotate <credential_id> --expires-in-days 365
```

`rotate` revokes the old secret and prints a new `token`; the integration and its
principal ID stay the same, so `CRATE_OPERATOR_PRINCIPAL_IDS` does not change. Write the
token into `secrets/mcp-token` (mode 600, owned by `PUID`) and restart the container with
`docker restart crate-agent` (or `crate-operator`). Rotate Crate Operator when no plan is
waiting for approval: a confirmation started with the old credential cannot apply its plan
afterwards.

`revoke <credential_id>` disables a credential immediately. Replacing the credential with
`make agent-init` (answering yes, or `--replace`) creates a new integration, revokes the
previous credential and, for Crate Operator, swaps the old principal ID for the new one in
`CRATE_OPERATOR_PRINCIPAL_IDS`. The new integration needs its approver bound again; the
setup asks for it. The supervisor credential is replaced and revoked the same way.

Other subcommands of `python -m crate.agent_credentials_cli`, all run inside `crate-api`:

| Subcommand                                                                 | Use                                                                                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `create ... --require-approval`                                            | Changes need human approval. Always on when a grant can change things                           |
| `identify`                                                                 | Reads a token on standard input and prints its credential and principal, never the secret       |
| `require-approval <principal_id>`                                          | Turns on approval for an existing integration                                                   |
| `bind-approver --principal-id ... --telegram-user-id ... --user-email ...` | Binds a Crate user to the Telegram account that approves plans; needs `CRATE_AGENT_INSTANCE_ID` |
| `show-approver --principal-id ...`                                         | Shows the active approver of an integration                                                     |

## Crate Operator

### Approvals in Telegram

Every change follows the same path:

1. You ask for something in the chat. Crate Operator prepares the plan with the matching
   tool and reads the exact plan.
2. It calls `request_plan_confirmation`. The bot then sends the complete plan as plain JSON
   pages, with every target, change, impact, precondition, version and expiry. Nothing is
   truncated; plans larger than 180,000 bytes must be narrowed first.
3. Buttons under each page: **Next** shows the next page, **Reject** is available on every
   page, and **Approve** works only after every page has been delivered.
4. The bound human presses Approve from their private chat. The backend checks the binding,
   the human's current permissions and the unchanged plan, then admits the job directly.
   No further message or model turn is needed.
5. The bot reports the outcome in the same chat. The supervisor, if configured, watches the
   job and reports later status, verification and projection changes.

A confirmation expires after 15 minutes, or earlier if the plan expires; ask for a new plan
after that. Free text ("yes", "go ahead") never approves anything, and neither do old
buttons, another user's buttons or another chat. Acquiring files and publishing them to
the library are separate plans with separate approvals. If Telegram delivery fails, review
and approve the plan in Admin > Agents > Approvals instead.

See [Native Telegram plan confirmation](hermes-plan-confirmation.md) for the full contract.

### Bind the approving human

Approvals count only from a Crate user who is bound to a Telegram user ID. The user needs
the agent integration management, plan review and plan approval permissions (an
administrator has them). There are two ways to bind:

- `make agent-init AGENT_PROFILE=operator` asks for the approver's Crate email and Telegram
  user ID (or reads `AGENT_APPROVER_EMAIL` and `AGENT_APPROVER_TELEGRAM_ID`) and binds them
  with `crate.agent_credentials_cli bind-approver` inside `crate-api`. On a rerun it shows
  the current approver and keeps it unless you choose to bind someone else.
- In the Admin, Agents > Connections > **Telegram approver** lists the approvers of this
  instance, removes one, and binds the signed-in admin: choose the connection (default
  "Crate Operator") and enter your Telegram user ID. The form links your own account; it
  cannot name another Crate account.

Binding again replaces the previous binding and invalidates its unused approvals. Removing
an approver stops its pending confirmations from approving anything. The Telegram user must
also be in the bot allowlist. Both actions are recorded in the audit log
(`agent.telegram.bound`, `agent.telegram.unbound`) and appear in the connection's activity.
The Admin uses `GET /api/admin/agent-telegram/bindings`,
`POST /api/admin/agent-telegram/bind` and
`DELETE /api/admin/agent-telegram/bindings/{binding_id}`; all require a signed-in Admin
session with agent integration management.

### Provenance and the read-only fallback

Crate Operator can apply changes only while the instance proves it runs official Crate
images. Two containers of the operator profile do this, with no systemd unit and no
root process on the host:

- `crate-provenance-docker` is a pinned HAProxy filter in front of the host Docker
  socket. It answers only `GET /containers/json` (the container list, which carries no
  environment or secrets) and `GET /images/<id>/json`; every other Docker API call gets 403. It runs without capabilities, read-only, on an internal network that only the
  publisher shares.
- `crate-provenance` runs from the `crate-agent` image as `PUID`, read-only and without
  capabilities. Every 30 seconds it lists the running containers of its own Compose
  project, inspects their images and writes the result to
  `${CRATE_OPERATOR_ROOT}/provenance`, which `crate-api` and the workers mount
  read-only.

An image is official when Docker recorded a digest for it from its expected
`ghcr.io/thecrateapp/crate-*` repository and that digest exists in the registry, and the
image carries its source revision label. The publisher checks:

| Mode    | When                                                                                  | Evidence required                                                                                                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image   | New instances: no deployment marker in `${CRATE_OPERATOR_ROOT}/context`               | `crate-api` and the four executing workers are running; every running Crate image, including the publisher's own `crate-agent`, is official (checked against `ghcr.io`, cached per digest); the release context baked into the `crate-agent` image belongs to that image's revision |
| Release | After `make deploy` with `CRATE_OPERATOR_ROOT` (or an approved infrastructure deploy) | The deployment marker is verified and every service runs exactly the digest and source SHA of its release manifest entry                                                                                                                                                            |

A change is allowed only when the observation is verified, at most 90 seconds old,
belongs to this `CRATE_AGENT_INSTANCE_ID`, and its release, context hash and per-service
images match the identity the plan was reviewed with. The check runs when the plan is
prepared, approved, admitted and executed. A deployment marker written by `make deploy`
(`deploying`, `rollback`) closes changes immediately, before the next observation.
Pulling or recreating any Crate image changes the identity, so pending plans need a new
review. Anything else returns `EVIDENCE_STALE` and closes changes while reads keep
working. Instances running locally built images never pass, so there Crate Operator
behaves as a read-only assistant: it reads and explains, but preparing or applying a
change fails with `EVIDENCE_STALE`.

`make agent-status AGENT_PROFILE=operator` prints the last result, for example
`Release provenance: verified (image mode, release 1a2b3c4d5e6f, 12 services)` or
`Release provenance: unverified (unofficial_image:crate-worker)`.

Security trade-offs: the filter holds the Docker socket, which is equivalent to root on
the host, so it is pinned by digest, exposes no port and allows only two read endpoints.
The publisher needs outbound HTTPS to `ghcr.io` to prove digests it has not seen before;
while the registry is unreachable, new digests stay unverified. The host administrator
can still forge evidence (by replacing images or the filter), exactly as with any other
host-level control: the gate keeps locally built and modified fleets read-only, it is
not a defence against the host's own root. The full rollout is described in
[Crate Operator candidate and rollout](hermes-operator-release.md).

### Supervisor alerts

The supervisor (`crate-operator-supervisor`) is the only component that pushes messages to
the Crate Operator chat. It needs no model: it polls persisted observations every 45 seconds
with its own read-only credential (`ops.status.read`, `ops.jobs.read`, plus
`library.health.read` for Smart Mix rules) and evaluates fixed rules.

`make agent-init AGENT_PROFILE=operator` provisions it (answer no to skip). Under
`${CRATE_OPERATOR_ROOT}` it writes, each with mode 600 and owned by `PUID`:

| File                                                                           | Content                                                                                                                                          | Read by                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| `secrets/supervisor/operator_mcp_read`                                         | Read-only MCP credential "Crate Operator supervisor (read only)"                                                                                 | Supervisor                 |
| `secrets/supervisor/operator_api` = `secrets/supervisor-client/read-token`     | Bearer for the supervisor's status and job-watch API                                                                                             | Supervisor, Crate Operator |
| `secrets/supervisor/operator_webhook` = `secrets/delivery/secret`              | Key that signs alerts sent to the gateway webhook                                                                                                | Supervisor, Crate Operator |
| `secrets/supervisor/operator_human` = `secrets/supervisor-native/callback-key` | Key that signs `/crate_ack` and `/crate_silence` decisions                                                                                       | Supervisor, Crate Operator |
| `secrets/delivery/destination`                                                 | Telegram chat that receives alerts: the approver, or the first allowed user                                                                      | Crate Operator             |
| `secrets/supervisor-native/identity.json`                                      | Instance ID and allowed Telegram users                                                                                                           | Crate Operator             |
| `supervisor-config.json`                                                       | `deploy/operator/config.operator.example.json` with this instance's ID, MCP host and `allowed_operators` (every allowed user as `telegram:<id>`) | Supervisor                 |

Existing keys are never regenerated. When the two copies of a shared key differ, the setup
asks before overwriting (non-interactive runs keep them, warn, and need `--replace`). On
a rerun it updates only the instance, `mcp_host` and `allowed_operators` fields of
`supervisor-config.json`, so your own rule edits stay. With `delivery/secret` present,
Crate Operator opens its webhook on port 8644, and its health check fails until the webhook
is connected. `make agent-status AGENT_PROFILE=operator` reports missing supervisor files.

| Rule                    | Kind     | Behaviour                                                                                                                                                                                                                                     |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instance/health-score` | `low`    | Opens when the health score is at or below 70, critical at or below 40, clears at 80 or above. Includes the list of breaches. Evidence older than 300 seconds does not count. A reopen within 30 minutes of the previous message is deferred. |
| `tasks/failed-tasks`    | `digest` | Newest failed tasks of the last 24 hours (cancellations excluded), grouped by task type, at most one message per group every 30 minutes. Rows carry ID, type, error code and time, never error text.                                          |
| `library/new-releases`  | `digest` | New releases detected for library artists in the last 7 days, at most one message per hour.                                                                                                                                                   |

Rules need two consecutive samples to open or recover. The first sample of a digest is
a baseline and sends nothing. The example also contains `worker-evidence`, `pending` and
`release-evidence` rules. While provenance is unverified (for example on local builds),
`release-evidence` reports the release evidence as unavailable once; remove that rule
from `supervisor-config.json` if you run local builds on purpose. Acknowledge or silence
an incident from the chat:

```text
/crate_ack <incident-key> <revision> <ttl-seconds> <reason>
/crate_silence <incident-key> <revision> <ttl-seconds> <reason>
```

Rule kinds and limits are in [Independent deterministic operator](crate-operator.md); the
root-provisioned layout is in [Crate Operator candidate and rollout](hermes-operator-release.md).

### Optional infrastructure relay

`crate-infra-relay` forwards Crate Operator's infrastructure plans (restart, backup,
deploy of approved releases) to a separate root-owned host bridge at
`/run/crate-infra/bridge.sock`, with its own keys and approvals. It starts only when that
socket exists. Without it, infrastructure plans are unavailable. The bridge runs as root
under systemd on the host, so `make agent-init` does not set it up; see
`deploy/operator/README.infra.md`.

## Release context

The release context is the documentation and source of the release you run, indexed so
the assistants can answer architecture and procedure questions with
`get_release_context`, `search_crate_context` and `read_crate_context`. It excludes `.env`,
credentials, instance data and music.

- The image carries the context of the commit it was built from.
- A host context in `${DATA_DIR}/crate-agent/context/active` (or
  `${CRATE_OPERATOR_ROOT}/context/active`) takes precedence when it contains a valid
  manifest. `make deploy` activates it only when the `context` directory already exists.
- `make deploy` writes `CRATE_RELEASE_SHA` and recreates a running `crate-agent`, or a
  running `crate-operator` plus the supervisor and relay when they run, on the new release
  image. While `crate-operator` runs, every deploy stage keeps the operator overlay
  (`deploy/operator/compose.operator.yaml`, which `make deploy` ships next to the compose
  files), so `crate-api` and the workers keep the operator identity and the operator
  containers are not removed as orphans.

`get_release_context` reports one of three states, and the assistants are told to state
it before reasoning about a version:

| State         | When                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `available`   | The context matches the running release and the deployment is verified.                                                   |
| `stale`       | `CRATE_RELEASE_SHA` (or the host deployment marker) names another release, or a deployment or rollback is in progress.    |
| `unavailable` | No context was found or it failed its integrity check. The assistants still start and answer from live MCP evidence only. |

Without `CRATE_RELEASE_SHA` (typical for home installs that do not use `make deploy`), the
image context is assumed current.

## Operations

| Task                             | Command                      |
| -------------------------------- | ---------------------------- |
| Status, health reason and checks | `make agent-status`          |
| Logs                             | `make agent-logs`            |
| Smoke test                       | `make agent-smoke`           |
| Restart after changing a secret  | `docker restart crate-agent` |
| Start or apply `.env` changes    | `make agent-up`              |
| Stop                             | `make agent-down`            |

Add `AGENT_PROFILE=operator` for Crate Operator (container `crate-operator`). At start the
logs print one JSON line with the release SHA, context state, MCP mode, model and whether
model credentials are configured.

**Upgrade.** Project-hosted deployments upgrade Crate Agent and Crate Operator with
`make deploy`. Elsewhere, pull the image and recreate the container (add
`AGENT_PROFILE=operator` to `make agent-up` for Crate Operator):

```bash
docker compose --profile agent pull crate-agent && make agent-up
```

Your bot, login, memory and secrets are on disk and survive the upgrade.

**Rotate secrets.** MCP credential: see [Expiry and rotation](#expiry-and-rotation).
Telegram token: `/revoke` in BotFather, then `make agent-init` and replace only the token.
Allowed users: `make agent-init` and replace only the allowlist; for Crate Operator this
also rewrites both `identity.json` files and `allowed_operators`. Model key: run
`make agent-model` with the current provider and replace the key
([Switch the model](#switch-the-model)).

**Disable.** Run `make agent-down`, then revoke the credential. Set
`CRATE_MCP_ENABLED=false` only if no other MCP client uses the instance. For Crate
Operator, also set `CRATE_MCP_ACTIONS_ENABLED=false` and recreate the stack without the
overlay.

**Migrate from the earlier pilot.** The pilot ran as `crate-hermes-agent` (compose profile
`hermes`) with state in `${DATA_DIR}/hermes-agent`. Its compose service no longer exists,
so stop it directly, then move its state (use the `DATA_DIR` value from `.env`):

```bash
docker rm -f crate-hermes-agent
mv "${DATA_DIR}/hermes-agent" "${DATA_DIR}/crate-agent"
make agent-up
```

The secret file names are unchanged and the ChatGPT login in `home/` is kept.
`runtime/` and `secrets/managed.env` are no longer used and can be deleted. Rename any
`CRATE_HERMES_*` settings in `.env` to their `CRATE_AGENT_*` equivalents.

**Migrate from the built-in bot.** Upgrade (migration 138 removes its settings), create a
new bot for Crate Agent or Crate Operator, and revoke the old token in BotFather.
For alerts, run `make agent-init AGENT_PROFILE=operator`, which sets up the supervisor.

## Troubleshooting

Setup messages start with `Crate Agent setup:`, health messages with
`Crate Agent unhealthy:` and start failures with `Crate Agent startup blocked:`; read them
with `make agent-status` and `make agent-logs`.

| Symptom                                                                                                             | Cause                                                                                                                                                                  | Fix                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `No MCP Host: set DOMAIN or CRATE_AGENT_MCP_HOST`                                                                   | Neither is set in `.env`                                                                                                                                               | Set `DOMAIN`, or `CRATE_AGENT_MCP_HOST` to the API host                                                                            |
| `Add <host> to CRATE_MCP_ALLOWED_HOSTS`                                                                             | `crate-api` would reject the MCP Host header                                                                                                                           | Accept the offer in `make agent-init` or edit `.env` and recreate `crate-api`                                                      |
| `CRATE_MCP_ENABLED=true is required` (or `CRATE_MCP_ACTIONS_ENABLED`)                                               | MCP or actions disabled                                                                                                                                                | Set it in `.env` and recreate `crate-api`                                                                                          |
| `DATA_DIR is not set in .env`                                                                                       | Missing setting                                                                                                                                                        | Set `DATA_DIR`                                                                                                                     |
| `Cannot create ...; rerun as its owner or as root`                                                                  | No permission on the state directory                                                                                                                                   | Rerun as root or as the owner                                                                                                      |
| `Telegram rejected the bot token or is unreachable`                                                                 | Wrong token or no outbound access                                                                                                                                      | Copy the token again from BotFather; `--no-network` skips the check                                                                |
| `A BotFather token looks like 123456789:AA...`                                                                      | Malformed token                                                                                                                                                        | Paste the full token                                                                                                               |
| `Allowed users must be numeric Telegram user IDs`                                                                   | Usernames or spaces in the list                                                                                                                                        | Use IDs from `@userinfobot`, comma-separated                                                                                       |
| `crate-api is not running; start the stack first`                                                                   | Credential creation needs `crate-api`                                                                                                                                  | Start the stack                                                                                                                    |
| `Unknown provider ...`                                                                                              | Provider not in the table                                                                                                                                              | Use one of the listed providers                                                                                                    |
| `Provider ... needs its API key in secrets/model-keys/<provider>` / `needs an API key in .../model-keys/<provider>` | Key-based provider without its key                                                                                                                                     | Run `make agent-model` from a terminal, or pass `AGENT_MODEL_API_KEY`                                                              |
| `CRATE_AGENT_MODEL is required for provider ...`                                                                    | Only `openai-codex` has a default model                                                                                                                                | Pass `MODEL=`                                                                                                                      |
| `CRATE_AGENT_BASE_URL is required for provider custom` / `is not used by provider ...`                              | Base URL missing or not allowed                                                                                                                                        | Follow the provider table                                                                                                          |
| Unhealthy: `provider ... has no login in this agent's home; run make agent-auth`                                    | OAuth provider without login                                                                                                                                           | `make agent-auth` (add `AGENT_PROFILE=operator` for the operator)                                                                  |
| Unhealthy: `Telegram is not connected; check secrets/telegram-token`                                                | Invalid or revoked token, no network, or another poller on the same token (409)                                                                                        | Use a dedicated token; stop the other poller                                                                                       |
| Unhealthy: `Agent gateway is not running`                                                                           | Gateway crashed or still starting (180 s grace)                                                                                                                        | `make agent-logs`                                                                                                                  |
| Unhealthy: `Supervisor delivery webhook is not connected`                                                           | Operator delivery secrets exist but the webhook did not start                                                                                                          | Check `secrets/delivery` and the logs                                                                                              |
| `Crate Agent startup blocked: check dedicated secrets and managed profile configuration`                            | Secrets missing or invalid, or Crate Agent could not reach a read-only MCP within about 30 seconds (API down, expired or revoked credential, non-read-only credential) | `make agent-status`; check `crate-api`, the flags, and that the credential uses the read-only preset                               |
| Smoke: `mcp: unreachable or rejected`                                                                               | Credential, host or flags                                                                                                                                              | Same as above                                                                                                                      |
| Smoke: `operator tools missing`                                                                                     | Operator credential without the operator grants, or actions disabled                                                                                                   | Recreate the credential with the "Crate Operator" preset; set `CRATE_MCP_ACTIONS_ENABLED=true`                                     |
| `crate-agent is running. Never run Crate Agent and Crate Operator together`                                         | The other profile is up                                                                                                                                                | `make agent-down` for the other profile                                                                                            |
| `CRATE_OPERATOR_PRINCIPAL_IDS is required in .env for the operator overlay`                                         | Kept credential that `crate-api` could not identify                                                                                                                    | Rerun `make agent-init AGENT_PROFILE=operator` with the stack running                                                              |
| `crate-operator-supervisor stays stopped (no supervisor-config.json)`                                               | Supervisor declined during setup                                                                                                                                       | Rerun `make agent-init AGENT_PROFILE=operator` if you want alerts                                                                  |
| `Supervisor is missing secrets/...`                                                                                 | Supervisor partly provisioned                                                                                                                                          | Rerun `make agent-init AGENT_PROFILE=operator`                                                                                     |
| `crate-api did not confirm that changes need approval`                                                              | `crate-api` image older than the setup script                                                                                                                          | Update the stack images, then rerun the setup                                                                                      |
| Operator answers but every change reports `availability: unavailable`                                               | Integration does not require approval, a grant is missing, or the API is down                                                                                          | Rerun `make agent-init AGENT_PROFILE=operator` (it turns approval on) or turn on Require approval before changes; check the grants |
| Changes fail with `EVIDENCE_STALE`                                                                                  | No verified provenance: local images, a deployment in progress, or the publisher is not running                                                                        | Expected on local builds; otherwise `make agent-status AGENT_PROFILE=operator` shows the reason                                    |
| `Release provenance: unverified (unofficial_image:<service>)`                                                       | That service runs a local build, or an image not pulled from `ghcr.io/thecrateapp`                                                                                     | Pull the official image and recreate the service                                                                                   |
| `Release provenance: unverified (registry_unavailable)`                                                             | `crate-provenance` cannot reach `ghcr.io` to prove a new digest                                                                                                        | Allow outbound HTTPS to `ghcr.io`                                                                                                  |
| `Release provenance: unverified (docker_unavailable)` or `last published ...s ago`                                  | `crate-provenance-docker` cannot read the Docker socket                                                                                                                | Check `CRATE_DOCKER_SOCKET` and `make agent-logs AGENT_PROFILE=operator`                                                           |
| `.../provenance is missing; run make agent-init AGENT_PROFILE=operator`                                             | Operator set up before the provenance service existed                                                                                                                  | Rerun `make agent-init AGENT_PROFILE=operator`                                                                                     |
| Approve button does nothing                                                                                         | Not every page delivered yet, confirmation expired, or the human is not bound                                                                                          | Press Next to the end; ask for a new plan; bind the human in Agents > Connections > Telegram approver                              |
| Model change has no effect                                                                                          | Changed inside the container                                                                                                                                           | Use `make agent-model`                                                                                                             |

## Under the hood

Crate Agent and Crate Operator run Nous Research's Hermes Agent, packaged in the
`crate-agent` image (`deploy/hermes/Dockerfile`) together with Crate's runtime, the
approval plugin, the operator package and the release context. `deploy/hermes/runtime.py`
validates the secrets and model, renders the managed configuration, checks the MCP
credential and starts the gateway; `SOUL.md` and `SOUL.operator.md` define each
assistant's identity and rules.
