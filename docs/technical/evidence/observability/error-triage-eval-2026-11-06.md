# AI error triage evaluation: 2026-11-06

Error Inbox gate EG2. Each reference issue's stored digest was triaged with `ops.error.triage` by the model below, through `evaluate_error_triage` on the `ai_bulk` lane; nothing was saved to the inbox. Reference: 79 labelled issues from phase E0 (`app/tests/fixtures/error_inbox/reference_labels.json`, version 1). This report holds labels, short ids, counts and token figures only: no event text, file names or titles. Produced by `tools/error-inbox-eval/run_eval.py`; the JSON next to it has every answer.

## Summary

| Model                     |  Sent | Classification | Severity | Critical as noise | High as noise | False critical | Invalid outputs | Duplicates | Tokens in / out |  Cost |
| ------------------------- | ----: | -------------: | -------: | ----------------: | ------------: | -------------: | --------------: | ---------: | --------------: | ----: |
| gemini / gemini-3.8-flash | 16/79 |          56.2% |    37.5% |                 0 |             0 |              0 |               5 |        1/3 | 45,310 / 21,649 | $0.12 |

EG2 asks for at least 80% agreement on classification and no critical issue taken for noise. Agreement counts every issue sent: an invalid output or a failed call is a disagreement. gemini / gemini-3.8-flash: classification misses it; no critical issue taken for noise (none labelled critical). Choosing the model and turning on automatic triage is the maintainer's decision.

## gemini / gemini-3.8-flash

- Task `f61018ddcce2` (completed), started 2026-11-06T16:12:10.903805+00:00, finished 2026-11-06T16:16:08.812867+00:00.
- Profile `5ce7c73d-4ee7-45f3-81c8-5bd1c4f00e2a` version 1: input 131,072 tokens, output 2,048 tokens.
- Models that answered: gemini-3.8-flash.

### Coverage

| Reference issues | Valid answers | Invalid outputs | Failed calls | Skipped | Not run |
| ---------------- | ------------: | --------------: | -----------: | ------: | ------: |
| 79               |            11 |               5 |            0 |      63 |       0 |

- Not in the inbox: CRATE-ADMIN-4, CRATE-ADMIN-5, CRATE-ADMIN-8, CRATE-ADMIN-A, CRATE-ADMIN-B, CRATE-ADMIN-C, CRATE-ADMIN-D, CRATE-ADMIN-E, CRATE-ADMIN-G, CRATE-ADMIN-H, CRATE-ADMIN-J, CRATE-ADMIN-K, CRATE-ADMIN-M, CRATE-ADMIN-N, CRATE-ADMIN-P, CRATE-ADMIN-Q, CRATE-ADMIN-R, CRATE-ADMIN-S, CRATE-ADMIN-T, CRATE-ADMIN-V, CRATE-API-7, CRATE-DOCS-1, CRATE-LISTEN-11, CRATE-LISTEN-12, CRATE-LISTEN-13, CRATE-LISTEN-14, CRATE-LISTEN-15, CRATE-LISTEN-17, CRATE-LISTEN-18, CRATE-LISTEN-19, CRATE-LISTEN-1A, CRATE-LISTEN-1D, CRATE-LISTEN-1E, CRATE-LISTEN-1F, CRATE-LISTEN-1G, CRATE-LISTEN-1H, CRATE-LISTEN-1J, CRATE-LISTEN-1K, CRATE-LISTEN-1N, CRATE-LISTEN-5, CRATE-LISTEN-8, CRATE-LISTEN-9, CRATE-LISTEN-A, CRATE-LISTEN-B, CRATE-LISTEN-C, CRATE-LISTEN-D, CRATE-LISTEN-F, CRATE-LISTEN-J, CRATE-LISTEN-K, CRATE-LISTEN-M, CRATE-LISTEN-N, CRATE-LISTEN-P, CRATE-LISTEN-Q, CRATE-LISTEN-S, CRATE-LISTEN-T, CRATE-LISTEN-W, CRATE-LISTEN-X, CRATE-LISTEN-Y, CRATE-LISTEN-Z, CRATE-MEDIA-WORKER-1, CRATE-READPLANE-4, CRATE-READPLANE-5, CRATE-WORKERS-9.

### Classification

Agreement: 9/16 issues sent (56.2%); 9/11 valid answers (81.8%). Rows are the reference label, columns the model's answer.

| Reference           | bug | infrastructure | external_dependency | client_environment | noise | Agreed |
| ------------------- | --: | -------------: | ------------------: | -----------------: | ----: | -----: |
| bug                 |   5 |              0 |                   1 |                  1 |     0 |   5/10 |
| infrastructure      |   0 |              1 |                   0 |                  0 |     0 |    1/2 |
| external_dependency |   0 |              0 |                   1 |                  0 |     0 |    1/1 |
| client_environment  |   0 |              0 |                   0 |                  1 |     0 |    1/2 |
| noise               |   0 |              0 |                   0 |                  0 |     1 |    1/1 |

### Severity

Agreement: 6/16 issues sent (37.5%); 6/11 valid answers (54.5%). Rows are the reference label, columns the model's answer.

| Reference | critical | high | medium | low | Agreed |
| --------- | -------: | ---: | -----: | --: | -----: |
| high      |        0 |    1 |      3 |   0 |    1/4 |
| medium    |        0 |    1 |      2 |   1 |    2/8 |
| low       |        0 |    0 |      0 |   3 |    3/4 |

### Worst errors

- Critical issues taken for noise: 0 of 0 sent (none). The reference set has no critical label, so this check is empty; the next line is the closest one.
- High-severity issues taken for noise: 0 of 4 sent (none).
- Confident critical answers (confidence at least 0.6) on issues the reference does not call critical: 0 (none). Each would put the issue in the critical lane and fire `errors-critical` once it is enabled.

### Duplicates

Of 3 answered issues the reference marks as duplicates, 1 named an issue of the same group (33.3%), 0 the exact root; 2 named none and 0 named another group. For 1 of them no candidate of the right group was offered, so only a missed answer was possible. Issues the reference calls unique but the model tied to another group: 1 of 8.

### Invalid outputs and failures

- Invalid outputs: 5 (CRATE-LISTEN-1B, CRATE-LISTEN-G, CRATE-LISTEN-H, CRATE-LISTEN-V, CRATE-READPLANE-3).
- Failed calls: 0.

### Tokens and cost

| Model            | Calls | Usage known |  Input | Cached input | Output | Thought | Mean input |    Cost |
| ---------------- | ----: | ----------: | -----: | -----------: | -----: | ------: | ---------: | ------: |
| gemini-3.8-flash |    16 |          16 | 45,310 |            0 |  2,234 |  19,415 |      2,832 | $0.1152 |

Cost uses $0.75 / $3.75 per million input / output tokens for gemini-3.8-flash; thought tokens count as output and cached input at the full input price, so it is an upper bound of the invoice.

### Disagreements

| Short id        | Group | Reference               | Model                     | Confidence |
| --------------- | ----- | ----------------------- | ------------------------- | ---------- |
| CRATE-LISTEN-10 | G9    | bug / high              | bug / medium              | 0.90       |
| CRATE-LISTEN-1M | G6    | bug / medium            | client_environment / low  | 0.90       |
| CRATE-LISTEN-7  | G3    | infrastructure / medium | infrastructure / high     | 0.95       |
| CRATE-WORKERS-B | G8    | bug / low               | external_dependency / low | 0.85       |
| CRATE-WORKERS-C | G8    | bug / high              | bug / medium              | 0.95       |
| CRATE-WORKERS-D | G8    | bug / high              | bug / medium              | 0.95       |
