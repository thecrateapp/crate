# C0 rollout verification — 2026-10-31

C0 remains a review checkpoint. PR1A has not started. The external probe host is
explicitly deferred; Desktop installed-client verification is separate from its
successful source/build checks.

## Reviewed source and closing validation

PR [#310](https://github.com/thecrateapp/crate/pull/310) merged as
`6681be8017b60865c00af61c3edc6f17696175b7` after all 25 applicable PR checks passed.
Those checks cover backend shards/coverage, frontend tests, real Listen/Admin
visual flows, React Doctor, native tests, Desktop Linux/macOS/Windows builds and
Linux collectors on overlay2/overlayfs. The three skipped release/baseline jobs
were not applicable. No image or release tag was published for Desktop.

The merge triggered duplicate full suites on main. Backend, frontend, native
and Desktop duplicate runs were cancelled because the same source tree had just
passed closing validation; the immutable Docker image build and the scoped
infrastructure checks remained active. Those main cancellations are not test
failures. The image build/manifest and runtime checks are tracked separately.

## Tidarr retired with data retained

Tidarr was stopped, snapshotted and removed at **12:58:49 UTC**. No volume-deletion
flags or host-directory deletion were used. The other 33 project containers kept
their IDs and start times throughout retirement. Native Tidal uses its independent
tiddl integration and was not changed.

Private server backups:

- Original snapshot: `/home/crate/crate/data/retired/tidarr/20261031T120357Z`.
- Verified final state: `/home/crate/crate/data/retired/tidarr/20261031T125751Z-recovered`.

The final archive contains 46 regular files and is 6,195,200 bytes. It includes
actual `/shared` state/credentials and changed writable-layer files outside the
preserved bind mounts, plus restoration metadata. SHA256, archive-content hashes,
0700/0600 permissions and unchanged bind-directory inodes were verified. This
establishes preservation, not a completed restore drill. Shutdown returned exit
code 1; the container was stopped without an OOM before capture/removal.

An intermediate final snapshot was retained too: its first verification failed
because copied PAX headers overrode renamed long paths. All 46 payloads were
subsequently found with matching hashes; no content was lost. A new snapshot
regenerated canonical PAX paths and passed verification before removal. Neither
archive contents nor credentials are committed.

## Runtime verification

Immutable application deployment of `6681be8017b60865c00af61c3edc6f17696175b7`
completed with schema revision 140 unchanged. API, readplane readiness and the
public API/Admin/Listen/site/docs routes passed the standard deployment checks.
The candidate orphan inventory contained exactly the eight known monitoring
services; they were stopped explicitly and recreated without changing the 25
application container IDs/start times during the overlay operation.

The planned monitoring gap was **13:13:09–13:23:38 UTC (629 seconds)**, including
release-context generation, image downloads and the application rollout. Existing
Prometheus/Grafana data, secrets and PostgreSQL observer role were reused.
Grafana remains loopback-only; notifications remain disabled.

Live checks passed six scrape targets, PostgreSQL/Redis dependency status and
**33/33 current container IDs with working-set memory metrics**. This is not a
claim that every metric family exists for every container. Limits are Grafana
384 MiB and Prometheus 256 MiB within the same 944 MiB / 1 CPU aggregate budget.

Six one-minute observations from **13:24:07–13:29:07 UTC** recorded no monitoring
restarts or OOMs. Maximum aggregate working set was **384.19 MiB**, maximum
observed CPU rate **0.0324 cores**, Grafana peak **245.82 MiB** and Prometheus peak
**77.82 MiB**. The last sample had 7,985 head series. These are short post-rollout
observations, including bounded diagnostics, not a long-term capacity guarantee.

Evidence: [raw samples](c0-remediation-samples.jsonl) and
[summary](c0-remediation-summary.json).

## Sentry delivery and provenance

All nine backend roles matched their image manifest source revision and immutable
image reference. The old manual fallback value was unchanged, verified against
the pre-deployment Go receipt recorded in [C0 remediation](c0-remediation.md).
The reused Go image correctly retains its `82ea84746f62f0c6052fdd5fdcf84dbb092c130b`
code revision; the Python/Rust image groups use `6681be8…`.

Exactly one bounded diagnostic was emitted per runtime from a secondary process
inside its deployed container. Python used the real SDK with the normal privacy
callback and active isolation scope. Go failed configuration parsing before a
pool/listener; Rust rejected an unknown command before jobs/listeners. The native
exit codes of 1 were intentional synthetic outcomes. All 33 server containers
kept their IDs/start times throughout.

All four receipts were independently found in their exact Sentry projects:

| Runtime      | Event ID                           | SDK           | UTC timestamp |
| ------------ | ---------------------------------- | ------------- | ------------- |
| API          | `8e17cc2c93774b0ba1b6ff1fab79faf9` | Python 2.73.0 | 13:27:05      |
| Worker       | `b865ec1d9af84f7db0ac6fd20ae223aa` | Python 2.73.0 | 13:27:08      |
| Readplane    | `bc47cd6d153e44999aecda9a88ca374c` | Go 0.42.0     | 13:27:08      |
| Media Worker | `a13528535e9742ee9aeb99d5c8b3038d` | Rust 0.44.0   | 13:27:08      |

[Receipt metadata](c0-sentry-receipts.json) contains only ID/time/release,
environment, service and SDK. This proves delivery and attribution for these
processes, not every server instrumentation path or installed Desktop client.

Listen's current loaded bundle declared release `crate-8881b5cca0faa8f48c712c47003cbd8fd01bd2b1`,
matching its reused image. A historical real web error (`7550456785134434bbca9a33ed3b6d80`,
09:29 UTC, older release `crate-53443533deb33fe2c38959a148d4a7a077158c27`)
had original TypeScript/JSX frames and source context. It is not correlated with
the 11:10–11:36 QA window and does not prove current-release symbolication.
No web event was injected to manufacture a positive QA receipt.

## Deployment snapshot retention incident

The deployment cleanup sorted backup directory **names**, not creation/mtime.
Its five lexically greatest entries were old named releases, so it removed
`c0-20261031-validation`, including that deployment's pre-change configuration.
The pre-change full environment has not been recovered from an authoritative copy.
Do not substitute an older release backup or describe a reconstruction as exact.

This did not delete the database, library, Tidarr backups or current live
configuration. A verified private **post-deployment configuration checkpoint** was
created outside automatic retention at:
`/home/crate/.deployment-config-backups/20261031T133257Z-post-c0`.
The canonical location is outside the project and application data mounts. It
contains the current environment, Compose/operator overlay, release manifest,
deployment helper, image inventory and checksums with 0700/0600 permissions.
It is a checkpoint of the working `6681be8…` configuration, not recovery of the
missing pre-deployment snapshot, a database backup or a completed restore drill.

The focused correction protects the current snapshot regardless of name/mtime,
retains the other four newest by directory mtime, skips symlinks and leaves all
snapshots untouched if the current one is missing/invalid. Four real temporary
filesystem cases failed before the fix and passed afterward; the related deploy,
Sentry release and operator suites passed **112 cases, 25 macOS skips**.
Independent review passed. PR [#312](https://github.com/thecrateapp/crate/pull/312)
merged as `75b442401bfbca8646efe5f684fca36dd9aab31d` after all 12 applicable checks
passed. The exact reviewed helper was installed atomically at **13:53:47 UTC**,
with SHA256 `52b609963fef2e17067b16efc65a298d23bb115cf491296759cd27f3924a731a`.
The previous helper remains in the private checkpoint. No cleanup was executed
and all 33 container IDs/start times were unchanged; no application restart was
needed. The application's immutable release remains `6681be8…`; helper provenance
is recorded separately in [the update receipt](c0-retention-helper-update.json).

The [final runtime check](c0-final-runtime-check.json) confirms all 33 services
ready/running, four Sentry receipts and retained pre-gap Prometheus history.

C0 runtime remediation is complete and ready for Diego's review. Acceptance is
still pending; PR1A has not started. The external probe host remains deferred.
