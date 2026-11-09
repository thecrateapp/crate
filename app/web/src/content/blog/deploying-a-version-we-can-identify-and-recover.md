---
title: "Deploying a version we can identify and recover"
description: "Crate's deployment grew from pulling containers into a versioned release, with immutable image digests, preflight checks and state-aware recovery."
date: 2026-11-10
series:
  id: how-to-forget-spotify
  title: "How to dismantle Spotify. Building Crate from the ground."
  part: 33
related: [giving-database-writes-a-transaction-boundary, building-an-installer-for-someone-elses-server]
tags: [How to dismantle Spotify, deployment, releases, operations, history]
sources:
  - docs/technical/deployment-profiles.md
  - scripts/release_manifest.py
  - scripts/deploy.sh
  - scripts/deploy-remote.sh
  - scripts/worker_queue_contract.py
  - app/tests/test_release_manifest.py
  - app/tests/test_deploy_release_commands.py
---

_Part 33. Making the project deployment reproducible and recoverable, May–November 2026._

A Crate deployment chooses images for several
services and applies their matching Compose configuration. It has to preserve server secrets, allow
database migrations to run and check the result. If startup fails, restoring the previous images
and restoring the previous state can be very different operations.

The older deployment already pulled prebuilt images. It copied configuration and selected files,
ran a pull that tolerated failures, then restarted the stack without building. A separate command
could build on the server. The missing piece was a complete, durable description of exactly what
constituted one release and what could safely be restored after it started.
[Earlier deployment commands](https://github.com/thecrateapp/crate/blob/b0cd19e9e21e4587eba6432975e5fff020db2780/Makefile#L262-L309).

This chapter follows the project-hosted deployment. The installer for an independent home instance
has a different filesystem and operational entry point. Sharing application images does not make
those two deployment procedures interchangeable.

## Select the release before touching the host

A Git commit identifies source. An image tag names an image in a registry. An OCI digest identifies
its content. Docker allows tags to be moved; pulling a digest asks for the content at that digest.
[Docker's explanation of image digests](https://docs.docker.com/dhi/explore/security-concepts/digests/).

Using a commit-derived tag was useful, but it did not answer every release question. If only Listen
changed, should we rebuild the analysis worker too? If we reused its previous image, which source
revision did that worker contain? And if one image was missing, should deployment proceed with
whatever happened to be cached on the server?

Rebuilding every image for every change would simplify release composition at the cost of repeating
unrelated builds. Independently deploying whichever images had just finished would make composition
implicit. We chose selective builds with an explicit, complete release manifest.

The July manifest work gave a release its own full Git SHA and an entry for every required image.
Each entry records the repository, immutable digest, source SHA, environment variable and services
that consume it. New builds replace their entries; unchanged images retain the previous promoted
entry, including its original source SHA:

```python source="scripts/release_manifest.py#L239-L255" commit="fd9d4c9c542984ca4e55879835951a494a99f100" "deepcopy"
    images: dict[str, dict] = {}
    for name, spec in IMAGE_SPECS.items():
        digest = changed_digests.get(name)
        if digest is not None:
            if not DIGEST_RE.fullmatch(digest):
                raise ManifestError(f"{name} digest must be a sha256 OCI digest")
            images[name] = {
                "repository": _expected_repository(registry, owner, spec),
                "digest": digest,
                "source_sha": release_sha,
                "environment": spec.environment,
                "services": list(spec.services),
            }
            continue
        if previous is None or name not in previous["images"]:
            raise ManifestError(f"missing image entry for {name}")
        images[name] = deepcopy(previous["images"][name])
```

A release can therefore contain images built from more than one commit without concealing that
fact. The release SHA identifies the selected set and configuration; an image's source SHA identifies
the code that produced that particular artifact.

The validator rejects missing required images, unknown entries, malformed digests, unexpected
repositories and incorrect service mappings. A manifest with only the newly built Listen image is
not a complete release unless a compatible previous manifest supplies everything else.

That baseline compatibility needed a later fix. Adding a new image to the fleet makes an older
manifest incomplete. The September change falls back to a full build when the previous manifest
cannot satisfy the current contract, rather than trying to reuse an invalid baseline.
[Baseline compatibility fix](https://github.com/thecrateapp/crate/commit/4e6d88ace59dc2e919d2fb62b850e610964ab247).

### Make Compose consume the same description

The manifest would be little help if deployment converted it back into a collection of mutable
tags. Its environment renderer emits digest references directly:

```python source="scripts/release_manifest.py#L271-L277" commit="fd9d4c9c542984ca4e55879835951a494a99f100"
def render_release_env(manifest: dict) -> str:
    validate_manifest(manifest)
    lines = [f"CRATE_RELEASE_SHA={manifest['release_sha']}"]
    for name, spec in IMAGE_SPECS.items():
        entry = manifest["images"][name]
        lines.append(f"{spec.environment}={entry['repository']}@{entry['digest']}")
    return "\n".join(lines) + "\n"
```

The deploy command can be pinned with `VERSION=<full-main-sha>`. It checks that the value is a full
commit SHA and reachable from `origin/main`, stages configuration from the selected revision and
fetches that revision's manifest. It then checks the manifest's release SHA and registry ownership
and inspects every referenced image for availability. Missing images fail this phase instead of
turning the server's existing cache into an accidental release definition.
[Release selection and manifest checks](https://github.com/thecrateapp/crate/blob/d6c519fa571c634a23f23f278454e8ef56285e42/scripts/deploy.sh).

CI also publishes an attestation for the release-manifest artifact. That is distinct from the
checks above: the deployment script shown here validates the manifest and image references; it does
not itself run a separate attestation-verification command. A valid digest reference establishes
which content is being selected, while provenance verification answers who produced it.
[Manifest publication and attestation](https://github.com/thecrateapp/crate/blob/d6c519fa571c634a23f23f278454e8ef56285e42/.github/workflows/build-images.yml).

The remote side records the previous configuration and release manifest, compares image references
and records the services affected. It pulls changed images and starts the selected services with
`--no-build --no-deps`. Unchanged images can remain running. A change to the base or project Compose
files conservatively marks the application service set for reconsideration; this is not a claim
that the script computes a minimal semantic diff of every Compose field.
[Changed-service selection](https://github.com/thecrateapp/crate/blob/d6c519fa571c634a23f23f278454e8ef56285e42/scripts/deploy-remote.sh).

![The release manifest selects immutable images. Preflight and a previous-release backup precede startup. After startup, verification failure leads to diagnosis and an explicit recovery decision because the database may have advanced.](/blog/deploying-a-version-we-can-identify-and-recover/release-and-recovery.svg)

## Preflight is more than Compose syntax

Syntax validation catches malformed configuration. It does not guarantee that the workers consume
the queues the application uses.

That became a concrete deployment check for the AI lanes. An overlay can replace a worker's command
and accidentally omit `ai` or `ai_bulk`. The container can start successfully while every task sent
to those queues remains pending.

The November preflight renders the candidate Compose model and checks the resulting commands:

```bash source="scripts/deploy-remote.sh#L474-L479" commit="10aec754d7227f81f9a795b20b248c877d8bfca2" "worker_queue_contract.py"
  log "Validating candidate compose with the production environment"
  candidate_compose config -q
  log "Checking that every required worker queue has a consumer"
  test -f "$DEPLOY_CANDIDATE_DIR/worker_queue_contract.py"
  candidate_compose config --format json \
    | python3 -I "$DEPLOY_CANDIDATE_DIR/worker_queue_contract.py" -
```

The checker understands both string and list commands, and both forms of `--queues`. A service with
zero replicas or an opt-in profile does not count as a worker that will be running by default.
This check runs locally and again against the candidate on the server with its production
environment. It checks the required AI lanes, not every possible queue in Crate.
[Queue contract](https://github.com/thecrateapp/crate/blob/10aec754d7227f81f9a795b20b248c877d8bfca2/scripts/worker_queue_contract.py).

Other remote preflight checks cover required secrets, running data services, the project backup
sidecar, free disk space and the candidate configuration. Post-start verification waits for container
health, checks the API and readplane from inside the backend container and probes configured public
routes. Those checks have different jobs: a reachable web page cannot prove that a background queue
has a consumer, and a correct worker command cannot prove that the API finished initializing.

The health wait also changed in May. An `unhealthy` state during startup stopped causing immediate
failure; the script continued waiting until its configured deadline. Slow startup still fails when
the deadline expires. It simply gets a chance to finish first.

## Startup changes which recovery is safe

The first scripted deployment installed an error trap around configuration, pull, startup and
verification. On failure it attempted to restore the previous application images and configuration.
That is attractive when an image is missing or a pre-start step fails.

It is unsafe to treat the same action as a universal response after startup. The new API can run
migrations before the deployment's health check completes. Restoring old containers then pairs old
code with a database that may already have changed.

The May correction disabled automatic rollback after the startup command returned successfully:

```bash source="scripts/deploy.sh#L257-L264" commit="77f10e864fe4de68ef6e5e6e43a4b21e0e04a4ac" "ROLLBACK_ENABLED=0"
  sync_config
  remote_deploy preflight
  remote_deploy config
  remote_deploy pull
  remote_deploy up
  ROLLBACK_ENABLED=0
  remote_deploy verify
  remote_deploy cleanup
```

If verification fails after that point, the script leaves the new stack in place for diagnosis and
returns the failure. The operator must choose a forward fix or a restoration procedure appropriate
to the state that changed.

The placement matters. This is a deployment-phase guard, not a mechanism that detects every applied
migration. It is switched after a successful `up`, so it should not be described as proof that all
partial startup failures are safe to roll back automatically. The database state still needs to be
understood before manually restoring older images.
[Rollback guard and diagnostic path](https://github.com/thecrateapp/crate/commit/77f10e864fe4de68ef6e5e6e43a4b21e0e04a4ac).

The recovery choices preserve different things:

| Operation | What it restores | What it cannot undo |
| --- | --- | --- |
| Previous application images and configuration | The selected executable set and deployment files | Migrations or changes to PostgreSQL, Redis or music files |
| Sealed state recovery set | The captured database, matching durable Redis, configuration and release | Writes made after capture, or arbitrary changes to the music library |

The state recovery procedure requires its own complete snapshot and restoration checks.

## Restore state from a matching recovery set

The ordinary deployment backup preserves configuration, release information and previous application
images. It is not the same operation as taking a coordinated PostgreSQL and durable-Redis recovery
snapshot. Crate added explicit, versioned recovery commands in July to make that distinction usable.
[Versioned recovery commands](https://github.com/thecrateapp/crate/commit/7dff4a93d28c65b23393f85b09d880759059ff8c).

The recovery snapshot quiesces the application, captures a PostgreSQL custom-format dump and schema
revision, flushes and copies the durable Redis state, and stores the corresponding configuration.
It seals the set with checksums and a completion marker. Current code restarts Redis after its
capture so the pinned deployment can use it while application writers remain stopped. A later
ordinary backup preserves an already sealed recovery set.

State restoration requires that complete set. It validates checksums, stops the updated application,
restores configuration, recreates the database from the dump and checks its schema revision. It then
restores the matching Redis snapshot before restarting the recovered release. Restoring the database
first avoids starting old workers against state from the newer application.
[Recovery snapshot and restoration implementation](https://github.com/thecrateapp/crate/blob/d6c519fa571c634a23f23f278454e8ef56285e42/scripts/deploy-remote.sh).

PostgreSQL's `pg_restore --exit-on-error` makes an encountered restore error fail the operation;
checking the archive list and checksums beforehand does not prove a full restoration will succeed.
A recovery rehearsal is still needed to establish that on the target environment.
[PostgreSQL 15 restore behavior](https://www.postgresql.org/docs/15/app-pgrestore.html).

Image-only rollback and state restoration have separate commands and explicit confirmation values.
The latter restores the captured database and Redis state, so changes after that capture are not
retained by that operation. Neither procedure restores arbitrary filesystem changes to the music
library. The media library needs its own backup policy.

By November, a host mutation lease also serialized deployment and related operational mutations.
Without a shared owner, a monitoring deployment or another operator could change the same host while
an application deployment was preparing its recovery information. The lease covers the scripted
mutation sequence; it cannot prevent an unrelated manual command that bypasses those scripts.
[Host mutation lease](https://github.com/thecrateapp/crate/commit/535f5d55da7bd13ccf89201693efb61fcbbf05a2).

A deployment now names the images it runs and records what it would need to go back. Image rollback
and state restoration are separate commands, because after migrations they are different operations.
The manifest tests check selective rebuild classification, complete assembly, preserved provenance
for unchanged images and rejection of bad references. The deployment tests exercise queue contracts
and host-lock contention and check the order of recovery steps. Some of them inspect the scripts
rather than run a restore, so a rehearsal on the target host is still the evidence we are missing.
[Manifest tests](https://github.com/thecrateapp/crate/blob/d6c519fa571c634a23f23f278454e8ef56285e42/app/tests/test_release_manifest.py),
[deployment and recovery tests](https://github.com/thecrateapp/crate/blob/d6c519fa571c634a23f23f278454e8ef56285e42/app/tests/test_deploy_release_commands.py).
