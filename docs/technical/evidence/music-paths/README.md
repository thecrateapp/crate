# Historical Music Paths evidence

These are documentation captures, not executable test fixtures. They retain
musical lists, measurements and provenance from earlier source snapshots.
They predate the reviewed freshness, completeness, primary-artist and query-work
fixes. No file here is a benchmark of the current implementation. The separate
[reviewed-stack measurements](../recommendations-review/README.md) report the
new representative-catalog run and its boundaries.

## Captures

| Review                                                | Recorded data                                                                                                                | Scope                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Initial comparison](music-paths-review.md)           | [Evaluation](music-paths-evaluation.json)                                                                                    | Controlled A/B/C/D lists, early scene timings and index diagnostics              |
| [Bridge review](music-paths-bridge-review.md)         | [Bridge evaluation](music-paths-bridge-evaluation.json)                                                                      | Revised punk/electronic routes and individual planning probes                    |
| [Validation review](music-paths-validation-review.md) | [Validation evaluation](music-paths-final-evaluation.json)                                                                   | Five structural/metadata probes with historical warning semantics                |
| [Latency review](music-paths-latency-review.md)       | [Scene timings](music-paths-latency-evaluation.json), [indexed acoustic timings](music-paths-acoustic-index-evaluation.json) | Historical scene distributions and separate local-replica acoustic distributions |

Dates, source commits/hashes, seeds, listener assumptions, query counts and
musical outputs remain attached to their captures. Assertions about matching
“current” source bytes in old provenance records refer to the captured checkout,
not today's repository. The acoustic reporting/import-guard incident and its
limits remain documented; compaction does not turn that guard into a success.
Historical approval and publication notes are not current release status.

## Compaction and numerical checks

The five JSON files were relocated from the recommendation fixture directory.
No test loads them. Each top-level section uses compact JSON so numerical vectors
and complete musical records do not produce thousands of formatting-only lines.

Existing per-case p50, p95 and maximum values were preserved. Before removing raw
duration arrays, twelve saved distributions were recomputed using their recorded
method: median for p50 and nearest rank `ceil(0.95 × n)` for p95. Four acoustic
cases were also reconciled against all 100 saved sample events. Sample counts,
percentiles and maxima agree to the recorded 0.001 ms precision. Every retained
numeric leaf was checked against its original value.

Per-sample timing/metadata events are replaced by the recorded case summaries;
query-count sequences retain min/max and summary values. The four one-call
warmups have separate summaries and remain excluded from measured percentiles.
A one-sample warmup summary is not an acceptance percentile. These are
transformations of saved data, not new measurements.

The bulky `historical_evidence` subtree, source hardware details, exact catalog
inventories, physical-layout inventories and production planner settings were
removed. Mapping multiplicity and logical-restore caveats remain qualitative
context. Source fingerprints and hashes of the original result stream still
identify the historical capture, not the compact JSON bytes or current source.

The current behavior and remaining validation gates are described in
[Music Paths](../../music-paths.md).
