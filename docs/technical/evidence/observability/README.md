# Observability C0 evidence

**Runtime remediation is complete; C0 awaits Diego's review. PR1A has not started.**
The application and shadow overlay use immutable source
`6681be8017b60865c00af61c3edc6f17696175b7`; the deployment helper includes the
retention fix from `75b442401bfbca8646efe5f684fca36dd9aab31d`.

- [Final rollout verification](c0-rollout.md): deployment, Tidarr preservation,
  monitoring gap, resource observations, Sentry receipts and retention incident.
- [Remediation source findings](c0-remediation.md): Grafana budget, companion
  coverage, external artwork 404, SDK delivery and image release provenance.
- [Post-rollout samples](c0-remediation-samples.jsonl),
  [summary](c0-remediation-summary.json) and
  [Sentry receipts](c0-sentry-receipts.json).
- [Authenticated web journey](functional-review.md): the earlier 26-minute
  playback/navigation/Infinite exercise and client-only network fault.
- [Initial baseline](baseline.md), [coverage matrix](coverage-matrix.md) and
  [event dictionary](event-dictionary.md): historical measurements, declared gaps
  and proposed contracts for subsequent instrumentation.

The final checks cover six healthy scrape targets and working-set memory metrics
for 33/33 current containers, including nginx/traefik/slskd. Tidarr was retired
with private state backups and preserved bind directories. Grafana now has
384 MiB and Prometheus 256 MiB within the unchanged 944 MiB / 1 CPU budget.
The post-rollout window showed no monitoring restarts/OOMs; previous history was
verified after reuse of the same Prometheus storage. The isolated Radar 404 was
classified as unavailable Cover Art Archive artwork.

API/worker/Go/Rust diagnostic receipts were independently verified in Sentry with
correct per-image releases. This does not establish all instrumentation paths,
installed Desktop delivery or current web-release symbolication. The earlier
network fault did not establish a physical audio stall/recovery. Published-album
Infinite continuation passed; a partial pre-release album with no radio seed
still ended empty and remains a separate functional follow-up.

Deployment cleanup deleted the pre-C0 configuration snapshot by sorting names
instead of dates. That exact environment was not recovered. A verified checkpoint
of the working post-deployment configuration now lives outside cleanup and app
mounts; retention protects the current snapshot and selects four others by mtime.
Database, library and Tidarr data were not deleted. No restore drill is claimed.

Short measurements establish neither long-term capacity nor complete metric-family
coverage/SLOs. The external probe host is explicitly deferred.

Independent deployment work: [checkpoint D1](deployment-checkpoint-d1.md) covers
autonomous Compose identity, application orphan protection and the local
configuration artifact. Remote rollout and the Admin topology map remain pending.
