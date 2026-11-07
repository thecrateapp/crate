# AI error triage evaluation: 2026-11-07

Error Inbox gate EG2. Each reference issue's digest, stored in the inbox or, when the inbox no longer holds it, built in memory from its latest Sentry event, was triaged with `ops.error.triage` by the model below, through `evaluate_error_triage` on the `ai_bulk` lane; nothing was saved to the inbox. Reference: 79 labelled issues from phase E0 (`app/tests/fixtures/error_inbox/reference_labels.json`, version 1). This report holds labels, short ids, counts and token figures only: no event text, file names or titles. Produced by `tools/error-inbox-eval/run_eval.py`; the JSON next to it has every answer.

## Summary

| Model | Sent | Classification | Severity | Critical as noise | High as noise | False critical | Invalid outputs | Cut off | Duplicates | Tokens in / out | Cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gemini / gemini-3.8-flash | 78/79 | 89.7% | 83.3% | 0 | 0 | 1 | 0 | 0 | 36/59 | 278,724 / 156,137 | $0.79 |

EG2 asks for at least 80% agreement on classification and no critical issue taken for noise. Agreement counts every issue sent: an invalid output or a failed call is a disagreement. gemini / gemini-3.8-flash: classification meets it; no critical issue taken for noise (none labelled critical). Choosing the model and turning on automatic triage is the maintainer's decision.

## gemini / gemini-3.8-flash

- Task `16e2925f6727` (completed), started 2026-11-07T08:42:20.034516+00:00, finished 2026-11-07T09:11:01.923233+00:00.
- Profile `5ce7c73d-4ee7-45f3-81c8-5bd1c4f00e2a` version 2: input 131,072 tokens, output 8,192 tokens.
- Models that answered: gemini-3.8-flash.

### Coverage

| Reference issues | Valid answers | Invalid outputs | Failed calls | Skipped | Not run |
|---|---:|---:|---:|---:|---:|
| 79 | 78 | 0 | 0 | 1 | 0 |

Sent from the inbox: 16; read from Sentry and built in memory: 62.

- No event left in Sentry: CRATE-ADMIN-G.

### Classification

Agreement: 70/78 issues sent (89.7%); 70/78 valid answers (89.7%). Rows are the reference label, columns the model's answer.

| Reference | bug | infrastructure | external_dependency | client_environment | noise | Agreed |
|---|---:|---:|---:|---:|---:|---:|
| bug | 9 | 0 | 1 | 2 | 0 | 9/12 |
| infrastructure | 0 | 5 | 1 | 0 | 0 | 5/6 |
| external_dependency | 0 | 0 | 1 | 0 | 0 | 1/1 |
| client_environment | 0 | 1 | 0 | 51 | 0 | 51/52 |
| noise | 1 | 2 | 0 | 0 | 4 | 4/7 |

### Severity

Agreement: 65/78 issues sent (83.3%); 65/78 valid answers (83.3%). Rows are the reference label, columns the model's answer.

| Reference | critical | high | medium | low | Agreed |
|---|---:|---:|---:|---:|---:|
| high | 0 | 1 | 3 | 0 | 1/4 |
| medium | 0 | 0 | 7 | 7 | 7/14 |
| low | 1 | 0 | 2 | 57 | 57/60 |

### Worst errors

- Critical issues taken for noise: 0 of 0 sent (none). The reference set has no critical label, so this check is empty; the next line is the closest one.
- High-severity issues taken for noise: 0 of 4 sent (none).
- Confident critical answers (confidence at least 0.6) on issues the reference does not call critical: 1 (CRATE-READPLANE-5). Each would put the issue in the critical lane and fire `errors-critical` once it is enabled.

### Duplicates

Of 59 answered issues the reference marks as duplicates, 36 named an issue of the same group (61.0%), 4 the exact root; 22 named none and 1 named another group. For 9 of them no candidate of the right group was offered, so only a missed answer was possible. Issues the reference calls unique but the model tied to another group: 2 of 19.

### Invalid outputs and failures

- Invalid outputs: 0 (none).
- Answers cut off at the profile's output limit (`AI_OUTPUT_LIMIT`, reasoning included): 0 (none).
- Failed calls: 0.

### Tokens and cost

| Model | Calls | Usage known | Input | Cached input | Output | Thought | Mean input | Cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| gemini-3.8-flash | 78 | 78 | 278,724 | 0 | 12,481 | 143,656 | 3,573 | $0.7946 |

Cost uses $0.75 / $3.75 per million input / output tokens for gemini-3.8-flash; thought tokens count as output and cached input at the full input price, so it is an upper bound of the invoice.

### Disagreements

| Short id | Group | Reference | Model | Confidence |
|---|---|---|---|---|
| CRATE-ADMIN-8 | G3 | infrastructure / medium | external_dependency / medium | 0.85 |
| CRATE-ADMIN-M | G3 | infrastructure / medium | infrastructure / low | 0.90 |
| CRATE-ADMIN-N | G3 | infrastructure / medium | infrastructure / low | 0.90 |
| CRATE-LISTEN-10 | G9 | bug / high | bug / medium | 0.90 |
| CRATE-LISTEN-11 | G5 | client_environment / low | infrastructure / low | 0.85 |
| CRATE-LISTEN-1F | G7 | noise / low | bug / low | 0.90 |
| CRATE-LISTEN-1M | G6 | bug / medium | client_environment / low | 0.90 |
| CRATE-LISTEN-G | G6 | bug / medium | bug / low | 0.90 |
| CRATE-LISTEN-H | G6 | bug / medium | client_environment / low | 0.90 |
| CRATE-LISTEN-V | G6 | bug / medium | bug / low | 0.90 |
| CRATE-READPLANE-3 | G8 | infrastructure / medium | infrastructure / low | 0.85 |
| CRATE-READPLANE-4 | G8 | noise / low | infrastructure / medium | 0.80 |
| CRATE-READPLANE-5 | G1 | noise / low | infrastructure / critical | 0.95 |
| CRATE-WORKERS-B | G8 | bug / low | external_dependency / medium | 0.90 |
| CRATE-WORKERS-C | G8 | bug / high | bug / medium | 0.95 |
| CRATE-WORKERS-D | G8 | bug / high | bug / medium | 0.95 |
