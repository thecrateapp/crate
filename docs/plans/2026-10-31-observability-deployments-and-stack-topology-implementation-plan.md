# Independent Observability Deployments and Stack Topology Implementation Plan

> **For agents:** REQUIRED SUB-SKILL: Use viterbit:executing-plans to implement this plan task-by-task.

**Goal:** Deploy observability independently of Crate and expose the real host/stack/service topology in Admin.

**Architecture:** Keep application project `crate`; introduce autonomous project `crate-observability` with independent configuration artifacts, state and rollback. Preserve the existing external application network and expose an additive cached topology contract to Admin. Application instrumentation remains part of application releases.

**Tech Stack:** Docker Compose, Python 3.13 standard library plus the existing PyYAML dependency for YAML semantics, shell/Make, FastAPI snapshots/SSE, React/TypeScript, existing Crate primitives, pytest/Vitest/Playwright.

---

## Approved scope and operating rules

- Diego approved the design on 2026-10-31. Source: `docs/plans/2026-10-31-observability-deployments-and-stack-topology-design.md`.
- Worktree `/Users/diego/Code/crate-observability-deployments`, branch `codex/observability-deployments`, base `origin/main` at `6b1803c4506312b6550fb548cce8ffb333443e20`.
- PR1A remains uncommitted in its separate worktree; do not mix its code into these PRs.
- Scoped tests during development; global validation once at stable phase close. Use disposable fixtures only.
- Each batch receives sequential SPEC and quality reviews, evidence and Diego's checkpoint. Commit/push and production adoption follow concrete review; do not activate monitoring or mutate production during the implementation batches.
- The first batch is tasks 1–3. Remote deployment and the map remain explicit later cuts.

## PR infrastructure

### Task 1: Autonomous Compose project

Files: create `deploy/observability/compose.standalone.yaml`; modify `Makefile`; create tests in `app/tests/test_observability_deployment.py`.

1. RED: resolve standalone configuration with Docker Compose, without either application Compose or `.env`. Expect exactly the eight monitoring services, project `crate-observability`, private monitoring networks and external application network `crate` (configurable as `OBS_APP_NETWORK`). Repeat with the containerd override.
2. Reuse reviewed services with `extends` from `compose.observability.yaml`, declaring the required top-level networks/secrets explicitly. Keep the old overlay intact as migration input; do not duplicate all service definitions or change the application's network ownership.
3. Switch local `observability-*` Make targets to standalone Compose with explicit project name, project directory and `--env-file` (`OBS_ENV_FILE`, default `/dev/null`), so discovery never imports the application `.env`. Reject the legacy `OBS_COMPOSE_FILES` option with a migration instruction, rather than silently applying it or changing the application project. Keep proxy-first startup and driver/socket validation.
4. GREEN: existing Compose/containerd contracts and new standalone/Make cases. No application service may appear in an observability command.
5. Record changed local invocation and the one-time migration requirement in README. Commit after checkpoint review.

Run: `.venv/bin/python -m pytest --noconftest app/tests/test_observability_deployment.py app/tests/test_observability_compose.py app/tests/test_observability_containerd.py -q`.

### Task 2: Protect observability during application up/rollback

Files: modify `scripts/deploy-remote.sh`; extend `app/tests/test_deploy_release_commands.py` or the isolated deployment test module.

1. RED: execute real `cmd_up`/rollback shell functions against a fake Docker command with application and legacy-monitoring sentinels. An application update must leave the monitoring sentinel intact.
2. Remove generic `--remove-orphans` from application mutation paths, including state rollback. This prevents the application project from retiring unrelated containers while both deployment identities coexist.
3. Preserve changed-services selection, no-change fast path and operator overlays. Do not replace cleanup with an unrestricted project-wide stop/down. Service retirement becomes an explicitly reviewed operation, not an implicit side effect.
4. GREEN: scoped release-command tests, including cleanup protections inherited from C0 and operator prediction consumers.
5. Document the changed orphan-retirement policy. Commit after checkpoint review.

Run: `.venv/bin/python -m pytest --noconftest app/tests/test_deploy_release_commands.py app/tests/test_infra_deploy.py -q` (use repo fixtures where required).

### Task 3: Independent immutable configuration bundle

Files: create `scripts/observability_release.py`; extend `Makefile`; tests `app/tests/test_observability_release.py`.

1. RED: build and verify a real tar.gz from a temporary fixture Git repository with a real commit. Assert deterministic output, pinned image metadata, source revision and a complete file-hash manifest. Include dirty-worktree isolation, traversal, duplicate member, symlink, oversized, tampered, missing and extra-file cases.
2. Implement public functions `build_bundle(source_root, release_sha, destination)` and `verify_bundle(bundle_path)`. Archive/Git/hash handling uses stdlib; image metadata uses existing PyYAML `safe_load`, not a partial YAML regex. The manifest has `schema_version:1`, `stack_id:crate-observability`, full lowercase 40-character `release_sha`, file SHA-256 hashes and pinned upstream image references.
3. Read the fixed allowlist from the requested Git commit's blobs with replacement refs disabled, never from dirty working-tree files: the three monitoring Compose files, Prometheus configuration, two proxy configs, Grafana provisioning and dashboard JSON. Exclude README, application Compose, `.env`, credentials, live data and unrelated checkout files. The deployment caller will separately require an approved main revision.
4. Verify without extracting archive paths. Bound member count, individual/total bytes and compressed size. Also cap the entire decompressed stream, including PAX/GNU metadata, at 8 MiB before tar parsing. Require the exact allowlist and normalized regular files; reject links and unsupported schema/stack. Write output atomically and reproducibly.
5. CLI: `bundle --source-root <checkout> --sha <full-sha> --output <archive>` and `verify <archive>`. Make targets expose these local artifact operations; they do not SSH or activate services.
6. GREEN: tests for both public functions and CLI failure paths. Version/digest/hash verification must fail before effects.

Run: `.venv/bin/python -m pytest --noconftest app/tests/test_observability_release.py -q`.

**Checkpoint D1:** implemented and locally verified, ready for Diego's review. Standalone Compose, application orphan protection and local artifact; SPEC then quality approved. Combined scoped run: 251 passed/25 existing privileged or opt-in skips; final bundle delta rerun:48 passed. Evidence: `docs/technical/evidence/observability/deployment-checkpoint-d1.md`. No remote mutation, commit/push or application runtime changes. Remote commands/migration and Stack remain the next cuts.

### Task 4: Scoped remote deployment and rollback

Files: create `scripts/observability-deploy.sh` and `scripts/observability-deploy-remote.sh`; modify `Makefile`; extend release/deployment tests and `.github/workflows/test-observability.yml`.

1. RED: deploy/rollback a synthetic bundle with fake SSH/Docker/filesystem boundaries. No app command, app `.env`, manifest, data or Sentry mutation is allowed. Test lock contention and partial failure.
2. Package from an immutable main SHA. Stage and verify artifact before activation, keeping observability paths and revision separate from `/home/crate/crate` application release state.
3. Require a provisioned observability environment file with only the necessary non-secret settings and file-secret paths, plus a prepared independent Python/PyYAML tooling environment. Do not import the full application environment or use app containers for verification. Render/validate quietly.
4. Coordinate official application/observability/Operator host mutations with a shared cooperative lock; extend Operator's reviewed contract explicitly if supporting its obs actions, otherwise reject that unsupported target.
5. Compare current/candidate configuration and images; update dashboard files inside the stable mounted directory, restart only affected monitoring services where needed. No blanket `down`, no data deletion. Verify actual scrapes and Grafana readiness before committing the current manifest.
6. Roll back configuration/images after failure; require compatible consistent state backup for image upgrades that migrate state. Report a real failure if verification or rollback fails.
7. Scoped green tests plus disposable Linux integration on overlay2/overlayfs. Preserve the existing resource, socket-proxy and secret-hardening contracts.

**Checkpoint D2:** reviewable remote commands, Linux evidence and rollback rehearsal; production migration awaits its own concrete checkpoint.

### Task 5: Controlled adoption

Files: migration/runbook and evidence under `deploy/observability/` and `docs/technical/evidence/observability/`.

1. Inventory current monitoring project labels, mounts, secrets, permissions and application container IDs/StartedAt/restart counts using read-only checks.
2. Prepare a consistent observability recovery point. Stop only the eight old monitoring instances and start the autonomous project using the same persistent data. Do not run duplicate writers.
3. Verify history, datasource UID, collectors and budgets. Exercise obs deploy/rollback during playback and app deploy/rollback in a disposable rehearsal; compare application sentinels before/after. Document the monitoring gap.
4. Update app and monitoring recovery instructions. No production-wide app deployment is required for this migration.

## PR Stack

### Task 6: Additive topology inventory and action ownership

Files: `app/crate/docker_ctl.py`, `app/crate/db/admin_stack_surface.py`, `app/crate/api/stack.py`, `app/crate/api/schemas/utility.py`; closest API/DB instructions apply.

RED then implement: configured stable local host ID; explicit application/observability projects and services; full internal instance IDs and Compose labels; runtime and healthcheck states; deployment metadata when available. Preserve legacy payload/routes during transition. Fail closed if inventory lookup fails, and preserve stale snapshots as stale rather than healthy empty data.

Separate read and allowed actions; validate actual ownership and results, correcting error/204 ambiguity. Audit legacy prefix consumers before changing authorization. Test both projects, unknown services, failed lookup/transport, stale source, same service name in different scopes and legacy DTO compatibility.

### Task 7: Reviewable host/stack map

Files: `app/ui/src/pages/Stack.tsx` and tests; showcase/preview scene and fixtures. Read Admin and showcase instructions before edits.

Use existing primitives and handmade HTML/CSS/SVG topology. One actual host, two stack groups, services and instance details; keyboard/list alternative, mobile stacking, source/freshness/health visibility. Unknown and unavailable are explicit; no invented connected probe. Mockup checkpoint precedes visual completion. Do not add a graph/chart library.

### Task 8: Cached metric correlation and Grafana navigation

Reuse the background bounded Prometheus adapter planned in the observability program; do not create a second per-request query path. Inventory stays usable during Prometheus failure. Add configured Grafana links with host/service/time context. Keep release SHA in inventory metadata rather than on every metric series. If the shared adapter is not ready, mark measurements unavailable and stage correlation in its planned cut.

**Checkpoint D3:** real component mockup, additive API, ownership tests and observed/stale/unavailable cases; SPEC then quality. Maintain narrow checks while iterating.

### Task 9: Documentation and stable phase close

Files: `deploy/observability/README.md`, `docs/technical/operations.md`, `docs/technical/10-development-deployment-and-operations.md`, documentation-site source/navigation where applicable, evidence index.

Update GitHub and website docs together: independent commands/revisions, topology, migration/rollback, preserved history, secret provisioning and operational limitations. Verify documentation rendering/links. Once implementation is stable, run the required full phase validation once; fixes rerun affected tests only. Preserve PR1A and PR1B scope and record remaining external-probe/scale gaps honestly.

## D1 review closure — 2026-11-01

Diego authorized the additional D1 repairs following Claude's review. Startup
now has an explicit settings/storage preflight; missing database or storage
settings never fall through silently to defaults. New empty storage requires a
separate initialization opt-in. Application `.env` isolation remains intact.
The artifact verifier accepts an independently supplied expected SHA and rejects
noncanonical/hidden physical tar metadata and corrupt deflate. This is still
integrity/declaration validation, not D2's trusted artifact authorization.
The home installer now shares application orphan protection. A separate local
checkout audit/retirement tool binds explicit full IDs to the reviewed resolved
configuration digest, includes all profiles, rechecks authority and protects
monitoring/Operator services. It never runs during deploy. Already provisioned
Operator helpers need an explicit approved reprovisioning step; no live state
was changed. Evidence: `deployment-checkpoint-d1.md`, Review corrections.
D2, controlled migration and final GitHub + documentation-website adoption remain
unchanged subsequent checkpoints.
