# app/installer — `crate` installer (Go)

Scope: everything under `app/installer/`. Plan and phases:
`docs/plans/2026-10-26-crate-installer.md`.

## What it is

`crate install` is the step-by-step wizard that installs and reconfigures a Crate home server.
`install.sh` at the repository root only downloads this binary from GitHub Releases, checks its
SHA-256 and runs it. Releases are built by `.github/workflows/build-installer.yml` on `v*` tags
for linux/darwin × amd64/arm64.

## Rules

- `deploy/install/integrations.yaml` is the single source of truth for every variable the
  installer writes. Every variable `docker-compose.home.yaml` reads must be declared there, and
  every declared variable must be read by the compose file (or be marked `installer_only`);
  `internal/manifest` tests enforce both directions.
- The binary embeds the compose file, `app/config.yaml`, the Traefik read-plane routes and the
  manifest. After changing any of them run `go generate ./...` here; CI fails when the embedded
  copies are stale.
- Reconfiguring must never rotate a generated secret or drop a line the user added to `.env`.
  `install.BuildEnv` keeps existing values; keep it that way.
- Never print a secret. `.env` is written with mode 0600. Validation calls go straight to the
  provider, never through Crate.
- Privileged steps are `install.Command` values: the wizard shows them, asks once and then runs
  them. Validate anything that reaches a shell (domains go through `install.ValidateDomain`).
- The `CRATE_*` environment variables and flags `install.sh` accepted keep working
  (`CRATE_ASSUME_YES`, `CRATE_DRY_RUN`, `CRATE_SKIP_START`, `CRATE_INSTALL_DIR`,
  `CRATE_ACCESS_MODE`, `CRATE_DOMAIN`, `CRATE_MUSIC_DIR`, ...).
- Integrations live in the manifest: id, group, title, a tagline under 40 characters for the
  list, summary, variables and how to get the key. A provider check belongs in
  `internal/validate` and must tell a rejected key from an unreachable provider. Integrations
  with their own questions (Soulseek, AI, MCP, Telegram, Tidal) have a form in
  `internal/wizard/integrations.go`; the rest use the generic fields form.
- `crate doctor --json` is a contract for scripts and the coming MCP server: keep the fields
  stable.
- `crate mcp` (`internal/copilot`) is the AI install copilot. Its rules are the product:
  - No tool output may contain a secret value. Secrets arrive only through the private portal
    (127.0.0.1, unguessable one-time ids, 30-minute expiry); tools report accepted/rejected.
    `crate_set_integration` must keep rejecting secret variables. The end-to-end test asserts
    that no output leaks a value; keep it passing.
  - stdout carries the protocol: nothing may print there. Streamed commands get no stdin
    (`system.ExecRunner{}` without `Stdin`), or they would read the protocol.
  - Long work (pull/up/health) runs as a background job polled with `crate_progress`.
  - Wizard and copilot change installs through `install.Draft`; do not duplicate its rules.
- UI copy is English, in Crate's tone: short, concrete, no emojis. Colours come from the V3
  tokens in `internal/ui/theme.go`; status rows use a dot plus a word.

## Commands

```bash
cd app/installer
go generate ./...                          # refresh embedded files
go vet ./... && go test ./...
go run ./cmd/crate install --dry-run       # walk the wizard without writing anything
go run ./cmd/crate doctor --dir ~/crate    # check an installation
```
