---
title: "Building an installer for someone else's server"
description: "Starting containers left too much configuration unfinished. Crate gained a guided installer with provider checks, preserved secrets and a shared MCP workflow."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 29
related: [opening-crate-to-agents, observing-a-home-server, deploying-a-version-we-can-identify-and-recover]
tags: [How to dismantle Spotify, installation, Go, configuration, history]
sources:
  - docs/plans/2026-10-26-crate-installer.md
  - deploy/install/integrations.yaml
  - app/installer/internal/manifest/manifest_test.go
  - app/installer/internal/install/env.go
  - app/installer/internal/envfile/envfile.go
  - app/installer/internal/stack/stack.go
  - app/installer/internal/validate/probes.go
  - app/installer/internal/copilot/portal.go
  - app/installer/internal/install/config_test.go
---

_Part 29. Installing Crate beyond our own server, October 2026._

The containers could be running while much of Crate was still unconfigured. Our shell installer
created directories, generated an environment file and started Docker Compose. It did not guide
someone through the keys needed for enrichment. Unless those values had arrived through the shell
environment, several integrations started with empty credentials.

There was a web setup wizard, but it had two problems. It appeared only when there were no users,
while the seed process created an administrator. It also saved keys in the database when the
services using them read their configuration from the environment. Finishing a form did not mean
the process that needed the key had received it.
[The installation problems and scope](https://github.com/thecrateapp/crate/blob/d189cc36414766e3fb241a400ad821e6a811bda9/docs/plans/2026-10-26-crate-installer.md).

On our own server, we could fill these gaps by editing files and remembering which service needed
a restart. That was a poor installation procedure to hand to somebody else. We needed to make the
unfinished work visible and let the person running the server complete it without replacing the
settings that already worked.

## Add the missing integration to an existing installation

The new `crate configure` command gave someone with running containers a way back into setup.
It read the installation's `.env`, prefilled the existing configuration and offered integrations to
add or change. It could also take a particular integration ID, such as `lastfm`. There was no need
to repeat the host and domain choices just to enter an enrichment key.
[Reopening integration configuration](https://github.com/thecrateapp/crate/blob/23aeb50fc185d2a77e0b8b7058bbb602277fef76/app/installer/internal/wizard/configure.go#L22-L87).

Each prompt needed to name the setting its consumer actually reads.
`deploy/install/integrations.yaml` describes
core settings, generated secrets, tuning variables and optional integrations. An integration can
carry a title, an explanation, credential fields, a link to obtain them, validation behaviour and
Compose dependencies. The terminal wizard, diagnostic command and MCP installer read the same
manifest.
[Integration manifest](https://github.com/thecrateapp/crate/blob/23aeb50fc185d2a77e0b8b7058bbb602277fef76/deploy/install/integrations.yaml).

An entry in `.env` still needed a route into the consuming service. Docker Compose interpolates
variables while resolving its configuration; it does not automatically put every entry from a
nearby file into every container. The service configuration has to pass the relevant value through.
That was the connection the old web setup form had failed to make.
[Compose variable interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).

We added a test that extracts variable references from the home Compose file and compares them
with the manifest in both directions:

```go source="app/installer/internal/manifest/manifest_test.go#L40-L50" commit="d189cc36414766e3fb241a400ad821e6a811bda9" "installerOnly"
	for name := range used {
		if !declared[name] {
			t.Errorf("docker-compose.home.yaml reads %s; declare it in deploy/install/integrations.yaml", name)
		}
	}
	installerOnly := m.InstallerOnly()
	for name := range declared {
		if !used[name] && !installerOnly[name] {
			t.Errorf("%s is declared in the manifest but docker-compose.home.yaml never reads it", name)
		}
	}
```

A new Compose variable needs a declaration. A declared variable needs a consumer unless it is
explicitly installer-only. Later checks extended that comparison to `.env.example` and the README.
These tests catch drift between installation files; they cannot tell us whether Python interprets
a value correctly or a provider accepts a credential.
[Documentation drift checks](https://github.com/thecrateapp/crate/blob/d46553afa40bab5f6a2abb3bae2667ab190ffee6/app/installer/internal/manifest/docs_test.go).

The old web setup path was removed. Leaving a second place to enter environment-backed keys would
have kept the same problem behind a different form.
[Setup retirement plan and completed work](https://github.com/thecrateapp/crate/blob/3467faf12267760dcdcf2d7d31a86e33a151b354/docs/plans/2026-10-26-crate-installer.md).

For Last.fm, entering only an API key is incomplete. The integration also needs its shared secret.
Its probe signs an `auth.getToken` request with that secret so the check exercises the pair. A
refused credential and an unanswered request lead to different results: rejected and unreachable.
The latter does not establish that the key is wrong. Missing fields are incomplete; integrations
without a pre-start probe are skipped.
[Provider-specific validation](https://github.com/thecrateapp/crate/blob/23aeb50fc185d2a77e0b8b7058bbb602277fef76/app/installer/internal/validate/probes.go).

The wizard can offer another attempt, save the value anyway or leave the integration for later.
A provider outage should not prevent the rest of Crate from being installed. Even a valid result
only covers the endpoint the probe exercised. It does not guarantee that every API operation or
account permission will work later.
[Integration prompts and retry choices](https://github.com/thecrateapp/crate/blob/23aeb50fc185d2a77e0b8b7058bbb602277fef76/app/installer/internal/wizard/integrations.go).

### Saving the answer must not rotate unrelated secrets

The installation already has a database password, a JWT secret and possibly encrypted credentials.
Building a fresh environment map and generating those again would break a working server. Changing
the password in `.env` does not change it inside an existing PostgreSQL data directory; replacing
the credential-encryption key can make saved credentials unreadable.

`BuildEnv` starts from the existing values. New answers replace the settings the wizard asks about,
and integration answers replace their corresponding values. Defaults fill gaps in settings left
alone. Generated secrets have a separate rule:

```go source="app/installer/internal/install/env.go#L56-L70" commit="23aeb50fc185d2a77e0b8b7058bbb602277fef76" "continue"
	for _, g := range m.Generated {
		if current, ok := values.Get(g.Env); ok && current != "" {
			continue
		}
		if source, ok := strings.CutPrefix(g.Format, "same:"); ok {
			value, _ := values.Get(source)
			values.Set(g.Env, value)
			continue
		}
		value, err := secrets.Generate(g.Format)
		if err != nil {
			return nil, err
		}
		values.Set(g.Env, value)
	}
```

An existing non-empty generated value stays. Missing secrets are generated, including the credential
key and federation secrets omitted by the previous shell flow. A `same:` entry copies another
generated setting. The merge test keeps an existing database password, JWT secret and Last.fm key,
retains an unknown `MY_TWEAK` setting, and requires the missing `CRATE_CREDENTIAL_KEY` to be added.
The second run fills the missing configuration while preserving the values attached to existing
data.
[Preservation and missing-secret test](https://github.com/thecrateapp/crate/blob/23aeb50fc185d2a77e0b8b7058bbb602277fef76/app/installer/internal/install/env_test.go#L39-L66).

The same distinction applies to public URLs. Changing the access mode or domain updates them;
keeping those choices preserves a manually set URL. Unknown environment keys are rendered under
an Other settings section, so a setting outside the wizard's prompts can survive another run.
[Environment merge and public URL rules](https://github.com/thecrateapp/crate/blob/23aeb50fc185d2a77e0b8b7058bbb602277fef76/app/installer/internal/install/env.go),
[preserving additional environment keys](https://github.com/thecrateapp/crate/blob/d189cc36414766e3fb241a400ad821e6a811bda9/app/installer/internal/envfile/envfile.go#L114-L148).

The merged file is written through a temporary neighbour with owner-only permissions, then renamed:

```go source="app/installer/internal/envfile/envfile.go#L151-L161" commit="d189cc36414766e3fb241a400ad821e6a811bda9" "0o600"
// Write replaces path atomically with owner-only permissions.
func Write(path, content string) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(content), 0o600); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
```

A failed partial write does not replace the previous `.env` with half a file. This protects that
file replacement, not the whole installation. Other files or directories may already have changed
when a later step fails. The saved secrets are still plaintext, protected by filesystem permissions;
backing up `.env` means backing up those secrets too.

`crate configure` saves the file before asking whether to apply the changes now. If Docker is
unreachable, or the operator postpones the restart, the new values remain on disk for the next
start. Otherwise it runs Compose to recreate containers whose settings changed. A saved Last.fm
key and a worker running with that key are therefore two different states. The command makes the
remaining restart explicit.
[Saving configuration and applying it to services](https://github.com/thecrateapp/crate/blob/23aeb50fc185d2a77e0b8b7058bbb602277fef76/app/installer/internal/wizard/configure.go#L78-L130).

## When paths or public URLs change

Changing where the music lives or how clients reach the server needs more than an integration
prompt. `crate install` runs the full wizard, loading an existing installation when it finds one.
A new server also brings constraints our own deployment had already settled: paths and permissions,
Docker, occupied ports, DNS and memory available for workers.

The host checks distinguish missing Docker from an installed daemon that cannot be reached. Memory
and disk checks can warn without treating one threshold as suitable for every music library.
Installing Docker is a separate host-preparation step: the wizard can show the commands and obtain
confirmation for them before the final application review.
[Host checks](https://github.com/thecrateapp/crate/blob/d189cc36414766e3fb241a400ad821e6a811bda9/app/installer/internal/system/preflight.go),
[wizard steps and host preparation](https://github.com/thecrateapp/crate/blob/23aeb50fc185d2a77e0b8b7058bbb602277fef76/app/installer/internal/wizard/steps.go).

Access is part of that configuration. Exposed local ports, local names and a public domain with
Cloudflare-managed DNS produce different URLs. Clients, redirects and API access depend on those
values. They cannot wait until the success screen to become a decision.

The wizard collects paths, access mode, integrations and administrator details, then presents a
review of the proposed application configuration. Plain prompts provide an alternative to the
interactive terminal UI. Dry-run mode skips Docker preparation and returns before writing the
installation or starting containers. The option to skip startup goes further: it writes the
configuration and runs the selected local-name setup before returning. It can therefore change
hosts or DNS configuration even though it does not start Crate.
[Review, dry run and installation flow](https://github.com/thecrateapp/crate/blob/23aeb50fc185d2a77e0b8b7058bbb602277fef76/app/installer/internal/wizard/finish.go).

![The release embeds configuration and a manifest. Terminal and MCP inputs feed one draft and review, then configuration files, Docker Compose and startup checks. Secret forms enter the draft directly.](/blog/building-an-installer-for-someone-elses-server/installer-flow.svg)

The review also needs a stable set of files to apply. We chose a Go binary that packages the manifest,
home Compose file and supporting configuration through Go's `embed` facility. A release carries
the files it was built with, instead of fetching whichever Compose file is on the default branch
when someone installs it.
[Go embedded files](https://pkg.go.dev/embed),
[embedded release assets](https://github.com/thecrateapp/crate/blob/d189cc36414766e3fb241a400ad821e6a811bda9/app/installer/internal/assets/assets.go).

The remaining `install.sh` became a bootstrap. It detects the operating system and architecture,
downloads the matching release binary and checksum file, verifies SHA-256 and tries to retain the
binary at `~/.local/bin/crate`. The destination is configurable. If the copy fails, the bootstrap can
still run the temporary binary. Keeping it locally makes later configuration and diagnosis available
without a repository checkout. The binary and checksum come from the same release channel; matching
them verifies the download against that release asset, not against an independent signing authority.
[Release bootstrap](https://github.com/thecrateapp/crate/blob/d189cc36414766e3fb241a400ad821e6a811bda9/install.sh).

Bundling Compose did not initially settle which images it would run. The first installer could
still select `latest`, pairing a versioned installer with moving application images. Release builds
were changed to select their own tag for a new installation or an older installed release:

```go source="app/installer/internal/install/config.go#L107-L122" commit="8d1c66db2fc299e94809df5e328d11e30592b66a" "current"
func UpgradeImageTag(current, version string) string {
	if current == "" {
		current = "latest"
	}
	release, ok := parseRelease(version)
	if !ok {
		return current
	}
	if current == "latest" {
		return version
	}
	if installed, ok := parseRelease(current); ok && slices.Compare(installed, release) < 0 {
		return version
	}
	return current
}
```

The comparison recognizes release tags in the exact `vN.N.N` form. A custom tag, SHA or prerelease
tag stays, as does a newer release. A development build preserves the existing choice. Running a
different installer binary therefore does not automatically downgrade
the installation. This rule chooses a tag; the release-manifest and deployment machinery has the
separate job of identifying exact image digests. Release-tag selection has deterministic tests,
just as the merge does for existing environment values.

## A successful start still leaves things to check

After applying the full installation, the wizard pulls images and starts the stack. A successful
`docker compose up` means the command succeeded. The API may still be running migrations or unable
to answer. The installer waits, with a deadline, for HTTP 200 from `/api/status`. It does not inspect
the response body or use that response to certify every worker and integration.
[API startup polling](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/installer/internal/stack/stack.go#L129-L155).

The integration-only configure path does not perform that same wait after recreating containers.
For a broader check, `crate doctor` reads the saved configuration and inspects the machine, Compose
container states, the API and configured providers. A refused credential is a failure; an
unreachable provider is a warning. Integrations not set up are listed as skipped. The report is
marked healthy when none of its checks failed, so it can still include warnings and skipped checks.
Its JSON output carries the findings and suggested fixes for tooling as well as a person at the
terminal.
[Diagnostic command](https://github.com/thecrateapp/crate/blob/23aeb50fc185d2a77e0b8b7058bbb602277fef76/app/installer/internal/doctor/doctor.go).

Containers may be running while a provider remains unconfigured. A key may be stored while its
provider is unreachable. The API may answer while a worker container is unhealthy. None of those calls for
regenerating every secret and beginning again.

The package tests use local HTTP servers for provider responses and a fake command runner for
startup. They can make a rejected key, failed command or delayed API response reproducible without
performing a real deployment. They do not settle Docker permissions, DNS, firewall rules or image
architecture on somebody else's host. The rollout plan kept clean-machine installation checks
separate from package tests.
[Test scope and host acceptance](https://github.com/thecrateapp/crate/blob/3467faf12267760dcdcf2d7d31a86e33a151b354/docs/plans/2026-10-26-crate-installer.md).

## The agent uses the draft; the user enters secrets

The binary also exposes `crate mcp`, a local stdio server. Its tools inspect the draft, explain
integrations, set configuration, request checks, apply the installation and report progress. They
call the shared installation code, so completing setup through a conversation does not create
another interpretation of `.env` like the old web wizard did.

Ordinary configuration tools reject secret fields. When a key is needed, the installer opens an
HTTP portal bound to `127.0.0.1` and returns a URL with a random request ID. The user enters the value
there. The installer stores integration credentials in the draft and reports the probe result;
a rejected or unreachable result does not erase the entered value. The agent gets status through
the tool response, without needing the raw key in the conversation. Those input requests expire
after thirty minutes.
[Local credential portal](https://github.com/thecrateapp/crate/blob/e04caee185081d7acfe5deff89a222f89f0d3b61/app/installer/internal/copilot/portal.go).

The portal is a separate input channel, not a sandbox against arbitrary code running as the same
operating-system user. Its URL needs to be treated accordingly. Generated administrator credentials
have their own private page in this workflow; that page uses a separate session token rather than
the input request's thirty-minute expiry. The terminal workflow can display generated credentials
directly at completion. MCP tests check tool responses for accidental secret exposure.

Image pulls and first startup can outlast a normal tool call. The MCP path starts a background job
and exposes its current phase and a bounded progress log. An agent can distinguish downloading,
starting containers and waiting for the API without treating a long tool call as a failed install.
The job runs in the installer process; it is not a durable job that survives that process stopping.
[MCP startup progress](https://github.com/thecrateapp/crate/blob/6b53412a6602c1d7fb34c1ef14498f8263b11243/app/installer/internal/copilot/job.go).

The next time an integration needs a new key, the operator can reopen that part of the configuration,
check the value and apply it while retaining the database password and other generated secrets.
If the containers start but enrichment still cannot reach its provider, there is now a specific
result to investigate rather than another apparently completed setup form.
