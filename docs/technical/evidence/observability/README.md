# Observability C0 evidence

Infrastructure shadow is active from PR [#309](https://github.com/thecrateapp/crate/pull/309),
source 248636d511d7356b732b908bc07ba0b50fdb9b97. **C0 is pending acceptance.**

- [Baseline and outstanding checks](baseline.md): production activation, resource
  observations, coverage gaps and scoped stop/status procedure.
- [Coverage matrix](coverage-matrix.md): existing producers/storage/consumers,
  code evidence and application telemetry gaps.
- [Event dictionary for review](event-dictionary.md): proposed contracts for the
  following instrumentation cuts; no application changes in PR0.
- [Summary](baseline-summary.json), [six raw captures](baseline-samples.jsonl),
  [IO and sample-age range queries](baseline-io-freshness.json).

The five-minute infrastructure window does not replace the authenticated
20–30 minute flow. CPU/throttling sums are partial in three captures; IO series
cover only 3/8 monitoring services. Four companion service groups are excluded by
the Crate-prefix relabel filter. Unknown values remain unknown; no zero-fill,
SLO attainment, complete container coverage or retention forecast is claimed.
The external-probe host is deferred by Diego. PR1A has not started.

Grafana reached92.8% of its individual256 MiB limit; review per-service headroom, not only the aggregate budget.
