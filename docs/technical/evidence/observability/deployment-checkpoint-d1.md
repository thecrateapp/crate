# Deployment checkpoint D1: autonomous monitoring configuration

2026-10-31. Branch `codex/observability-deployments`, worktree
`/Users/diego/Code/crate-observability-deployments`, base main
`6b1803c4506312b6550fb548cce8ffb333443e20`.

Diego approved independent observability deployments and the subsequent Admin
host/stack map. This checkpoint covers local deployment identity, application
orphan protection and the configuration artifact. Production and the separate
PR1A worktree remain unchanged.

## Scope and behaviour

`compose.standalone.yaml` defines project `crate-observability`, extending only
the eight reviewed monitoring services. Private monitoring networks remain;
`OBS_APP_NETWORK` selects the existing external application network. Explicit
configuration mounts avoid Compose `extends` rewriting them to the wrong path.
The real Compose parser resolves both default and containerd variants with the
same images, limits, hardening, secrets and mounts as the reviewed legacy setup.

Make fixes project/directory and an explicit `OBS_ENV_FILE` (default `/dev/null`).
A deliberately invalid application `.env` has no effect. `OBS_COMPOSE_FILES` is
rejected with migration instructions. Storage/socket guards and proxy-first
health wait remain. Startup refuses running Prometheus/Grafana from another
project, or a failed lookup. This is a singleton transition guard, not a
concurrency guarantee against arbitrary manual Docker commands; host locking
belongs to D2.

Application up, image rollback and state rollback no longer use generic
`--remove-orphans`. Changed-service selection and Operator overlays remain.
Tests execute the actual shell functions against Docker sentinels and confirm
legacy monitoring survives. Obsolete service retirement is an explicit reviewed
operation rather than an unrelated deploy side effect.

## Configuration artifact

`scripts/observability_release.py` builds ten allowlisted configuration files
from the exact requested Git commit, with replacement refs disabled. Dirty files,
application Compose, `.env`, secrets and live data are excluded. A manifest records
schema/stack/revision, SHA-256 file hashes and pinned image references. Output is
reproducible and replaced atomically.

Archive/Git/hash handling uses stdlib; image metadata uses existing PyYAML,
independently pinned in `requirements-tooling.txt`. Review demonstrated that a
partial YAML regex missed mutable overrides with inline comments; actual YAML
parsing now covers overrides, quoted keys, flow mappings and aliases.

Verification never extracts paths. Compressed input and the complete decompressed
stream, including PAX/GNU headers, are each bounded to 8 MiB. Members are bounded
to 2 MiB and the manifest to 64 KiB. Exactly eleven regular members are required.
Unexpected paths, duplicates, links, unsupported metadata/schema, missing files,
wrong checksums and malformed YAML/JSON are rejected. Git metadata discovery is
also bounded before reading file contents.

Local commands: `make observability-bundle VERSION=<full-commit-sha>` and
`make observability-bundle-verify VERSION=<full-commit-sha>`. Those files must
exist in that commit; `OBS_BUNDLE`/`OBS_PYTHON` select archive/interpreter. These
commands do not deploy or authorize a release. D2 must independently bind the
approved main revision and expected artifact identity.

## Validation

Baseline: 144 scoped Compose/containerd/release-command cases. Combined scoped
validation after implementation: **251 passed, 25 skipped**, across seven affected
and nearby consumer modules. Skips are existing root-owned filesystem and explicit
disposable-fixture opt-ins; no new case is skipped. Review fixes rerun affected
tests only. Final bundle rerun after the Git discovery correction: **48 passed**,
including the new resource regression. Sequential independent SPEC and QUALITY
reviews are approved with no outstanding findings for tasks 1–3. Pyright, scoped
Ruff, shell syntax, standalone Compose validation and whitespace checks pass.

```bash
PYTHONPATH=app .venv/bin/python -m pytest --noconftest \
  app/tests/test_observability_deployment.py \
  app/tests/test_observability_release.py \
  app/tests/test_observability_compose.py \
  app/tests/test_observability_containerd.py \
  app/tests/test_observability_c0_retirement.py \
  app/tests/test_deploy_release_commands.py \
  app/tests/test_infra_deploy.py -q
```

CI filters the new script/tests and executes these artifact and standalone
configuration contracts in the existing overlay2/overlayfs matrix. Its Linux
runtime fixture still exercises the legacy overlay; independent-project runtime
rehearsal belongs to D2 and is not claimed here. No full multi-app suite, image
publication, production activation or live migration/playback rehearsal occurred.

## Next cut and recovery

D2 adds independently versioned remote staging, quiet preflight, host mutation
coordination, scoped update/rollback and disposable Linux rehearsal. Production
adoption must preserve state/UID/secrets and record the monitoring gap. Application
IDs, start times and restart counts must remain unchanged. The map has a later
real-component mockup checkpoint; the existing visual preview is preserved.

Reverting D1 code does not migrate running containers. During adoption, stop
active monitoring writers before reverting project identity; never start old/new
projects against shared state simultaneously. Preserve application orphan
protection until legacy monitoring is retired.

## Review corrections — 2026-11-01

Diego authorized closing Claude's D1 findings before publication. All changes
remain local, uncommitted and undeployed.

- Startup now requires explicit non-secret data/secrets/network/database settings
  from exported values or a dedicated monitoring environment. The application
  `.env` is still excluded, including an explicitly supplied path to it. Existing
  storage must be prepared and non-empty; only a deliberate new installation may
  use `OBS_INITIALIZE_EMPTY=1`. A real Compose-parser case verifies a custom
  database and data path with spaces. No resolved environment values are logged.
- `observability-bundle-verify VERSION=...` now checks the manifest declaration
  against the caller's expected SHA. It does not authenticate the source or prove
  that the payload belongs to Git; trusted artifact identity remains D2.
- Verification enforces normalized member mode/owner/time/order and inspects
  physical tar headers before `tarfile` can hide GNU/PAX metadata. Independent
  SPEC review reproduced three previously accepted hidden GNU-header cases;
  all four positional regressions now reject. Corrupt deflate returns a normal
  rejection without an uncaught traceback.
- The separate `scripts/application_orphans.py` tool reports obsolete services
  read-only. Explicit retirement requires full immutable container IDs,
  confirmation and the SHA-256 of the reviewed rendered configuration. All
  Compose profiles participate in the declared-service inventory. Configuration
  and labels are rechecked before deletion; foreign/unmanaged/one-off, declared,
  monitoring and Agent/Operator/relay services are protected. No volume deletion
  or automatic deploy cleanup is introduced. Docker failure and changed
  authority abort before removal. This is a local checkout tool, not an Operator
  API or a replacement for D2's host lock.
- The installer also stops using blanket `--remove-orphans`. Already released
  installers and previously provisioned Operator helper copies are not patched
  by this source change; adoption must upgrade/reprovision them explicitly.

Scoped validation: release artifact file **59 cases**; startup/deployment file
**21 cases**; explicit orphan tool **13 cases**. Targeted Go checks cover the
installer Stack, Agent setup and Agent wizard consumers. Ruff, scoped Pyright,
Bash syntax and whitespace checks pass. Sequential independent SPEC then QUALITY
reviews approve the corrections. No full suite, Linux runtime migration or
production action occurred. Existing D2/runtime/controlled-migration gaps above
remain explicit; the final program step still updates GitHub and website docs.
