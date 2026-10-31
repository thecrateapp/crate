# Observability C0 evidence

Infrastructure shadow is active from PR [#309](https://github.com/thecrateapp/crate/pull/309),
source `248636d511d7356b732b908bc07ba0b50fdb9b97`. **C0 is pending acceptance.**

- [Authenticated web journey](functional-review.md): about 26 minutes of playback,
  navigation, Infinite continuation and a client-only network fault. Includes
  findings and links to normalized client records, 26 server samples and summaries.
- [Initial baseline](baseline.md): activation/preflight, five-minute resource
  observations and scoped stop/status procedure.
- [Coverage matrix](coverage-matrix.md): producers, storage, consumers and gaps.
- [Event dictionary](event-dictionary.md): proposed contracts for the following
  instrumentation cuts, including user intent versus unsupported source metadata.

Published-album continuation appended 30 tracks and advanced naturally. A partial
pre-release album ended empty with Infinite enabled because its source has no
radio seed. Network/API transport recovered after the deliberate cut; a physical
audio stall/recovery was not established. One resource 404 remains unclassified,
and the browser capture overflowed twice; no full error ratio is inferred.

During the longer window, monitoring used 349.6–384.2 MiB with no observed
restarts/OOM kills. Grafana reached 98.6% of its individual 256 MiB limit. The
existing five-minute dashboard CPU query covered 8/8 services throughout; the
shorter exploratory rate can have holes. IO covers 3/8 services and four companion
containers remain excluded from the Crate-prefix filter.

Review per-service budgets and the declared gaps before acceptance. No SLO,
complete platform coverage or retention forecast is claimed. The external-probe
host is deferred by Diego. PR1A has not started.
