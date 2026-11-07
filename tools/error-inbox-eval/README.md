# AI error triage evaluation

`run_eval.py` measures the Error Inbox's AI triage (`ops.error.triage`) against the reference
set labelled by hand in phase E0, `app/tests/fixtures/error_inbox/reference_labels.json` (79
issues). Its report is the evidence for gate EG2: with it the maintainer picks the model and
decides whether to turn on automatic triage. The gate asks for at least 80% agreement on
classification and no critical issue taken for noise.

The tool never calls a model on its own and never runs implicitly:

- `plan` is a dry run. It prints the bound model, which reference issues can be evaluated (from
  the inbox, or read from Sentry by the task), how many calls a run makes and their token bound.
  It sends nothing to the provider and makes no Sentry request. It warns when the bound
  profile's output limit or timeout is below the action's (see "After a limit change").
- `run` sends calls only with `--execute` and a confirmation of the exact number of calls
  (typed at the prompt, or `--confirm-calls N`). Without both it stops after the plan.
- Running it against production spends the AI connection's budget and sends error digests to
  the provider bound to `ops.error.triage`. Do it only with the maintainer's explicit
  authorization.

## How it works

The tool is standard-library Python and does not import `crate`. It runs
`python -m crate.error_inbox.evaluation_cli` inside the worker container through a command
prefix, `--crate` (default `docker exec -i crate-worker python`), and exchanges JSON on
stdin/stdout:

1. **plan** sends the 79 short ids, never the labels. For each one Crate reports whether its
   `error_issues` row has a stored digest (`ready`, `source: inbox`), whether the task will
   read it from Sentry because the inbox does not hold it (never synced, or purged 30 days
   after it closed: `ready`, `source: sentry`), or why it is skipped: `not_in_inbox` (not in
   the inbox and Sentry is not connected), `no_digest` (its latest event was never downloaded)
   or `over_input_limit` (the request is larger than the bound profile accepts). The plan makes
   no Sentry request and no digest leaves the server.
2. **queue** accepts the binding the plan showed (if it changed since, `AI_CONTEXT_STALE`)
   and queues one `evaluate_error_triage` task on the `ai_bulk` lane with the ready short ids.
   One evaluation runs at a time.
3. The task first reads the issues the inbox does not hold with the stored Sentry connection:
   Resolve a Short ID (`/organizations/{org}/shortids/{short_id}/`), the issue and its latest
   event, three requests each, at most four a second, a 429 waited out once (Retry-After, at
   most 60 s), all within 600 s. It builds each digest in memory exactly as the sync would and
   never stores it. An issue Sentry deleted (`not_found`), merged into another (`merged`),
   whose events expired (`no_event`), a failed read (`fetch_failed`, with the Sentry code) or
   the end of the budget (`fetch_budget`) is skipped; the run goes on.
4. The task then makes one `ops.error.triage` call per issue: the same request the real triage
   sends, validated the same way, with duplicate candidates from the inbox and from the issues
   read from Sentry together (at most ten). It saves nothing to `error_issue_triage`, ignores
   any triage already stored, and keeps only classification, severity, `duplicate_of` and
   confidence. The summary, hypothesis and next step are dropped.
5. **result** returns the task's answers and the token usage of its calls (`ai_invocations`).
   The tool scores them against the labels and writes the report.

The calls run inside the AI lane like every other model call in Crate, so the architecture
guard needs no exception: the tool only queues and reads.

## Commands

From the repository root, after the release that contains `evaluate_error_triage` is deployed:

```bash
# Dry run against the local development stack.
python3 tools/error-inbox-eval/run_eval.py plan --crate "docker exec -i crate-dev-worker python"

# Dry run against a server, through SSH (nothing is sent to the provider).
python3 tools/error-inbox-eval/run_eval.py plan \
  --crate "ssh <user>@<host> docker exec -i crate-worker python" \
  --price gemini-2.5-flash=0.30/2.50

# The evaluation itself: plan, confirm the number of calls, queue, wait, write the report.
python3 tools/error-inbox-eval/run_eval.py run --execute \
  --crate "ssh <user>@<host> docker exec -i crate-worker python" \
  --price gemini-2.5-flash=0.30/2.50

# Collect tasks that already finished (for instance after an interrupted wait), or put the
# runs of several models in one report.
python3 tools/error-inbox-eval/run_eval.py report --task <task id> [--task <task id> ...] \
  --crate "ssh <user>@<host> docker exec -i crate-worker python"
```

To compare models, bind another model to **Triage error issue** in AI models and run again: each
run is one task and one model. Runs written on the same date go into the same report; the JSON
keeps every run until `--replace`.

Options shared by the commands:

| Option                             | Meaning                                                                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `--crate CMD`                      | Command that runs Python with the `crate` package. Prefix it with `ssh <user>@<host>` for a remote server.                                 |
| `--labels PATH`                    | Reference labels (default: the E0 fixture).                                                                                                |
| `--price MODEL=IN/OUT`             | US dollars per million input and output tokens for a model id; repeatable. Without it the cost reads `unknown`.                            |
| `--output PATH`                    | Markdown report (`run`, `report`); the JSON goes next to it. Default: `docs/technical/evidence/observability/error-triage-eval-<date>.md`. |
| `--date`, `--replace`              | Report date (default today, UTC); drop earlier runs kept in the JSON.                                                                      |
| `--confirm-calls N`                | `run` only: confirm without a prompt; must equal the planned number of calls.                                                              |
| `--poll-seconds`, `--wait-seconds` | `run` only: how often and how long to wait for the task (default 15 s and 11,400 s).                                                       |

## Cost and duration

Each call sends one digest (at most 24 KB), the issue's counts and up to ten reduced candidates,
and the answer is capped by the profile's output limit (at most 8,192 tokens for this action,
reasoning included). The plan prints Crate's input bound, one token per byte, which is well above
the real token count: an issue the task will read from Sentry counts as the largest request (a
24 KB digest and ten candidates), and an inbox issue gets room for the candidates those issues
may add. The number of calls is an upper bound, since an issue Sentry no longer has costs
nothing. The report has the real counts. The connection's daily budget reserves each call's full profile
allowance before sending and settles it with the real usage, so it needs room for one or two
reservations at a time, not for the whole run.

Calls run one after another on the `ai_bulk` lane (time limit 10,800 s), yielding to interactive AI
work; each takes at most the profile's timeout (90 s for this action). Reading issues from Sentry
comes first and takes at most 600 s.

## After a limit change

A profile keeps the limits it was created with. When the output limit or timeout of
`ops.error.triage` is raised, the plan warns that the bound profile is below the action's limits,
and answers that reason longer are cut off (`AI_OUTPUT_LIMIT`, counted in the report). Use the
same model again for **Triage error issue** in AI models (**Use a different model**, same model
and reasoning): Crate appends a profile version with the new limits. Then plan again.

## The report

`docs/technical/evidence/observability/error-triage-eval-<date>.md` and a JSON file next to it.
Commit them after the run as the EG2 evidence. They contain labels, short ids, counts, token
figures, model ids and closed error codes; no event text, file names or titles. For each model:

- **Coverage**: reference issues, valid answers, invalid outputs, failed calls, skipped issues
  and their reasons (with the Sentry code of a failed read), and how many issues were read from
  Sentry.
- **Classification** and **Severity**: agreement over every issue sent (an invalid output or a
  failed call counts as a disagreement) and over valid answers, with the confusion table.
- **Worst errors**: critical issues taken for noise (the EG2 check; the E0 reference has no
  critical label, so the report says so and adds high-severity issues taken for noise), and
  confident critical answers (confidence at least 0.6) on non-critical issues, which would fill
  the critical lane and fire the `errors-critical` Operator alert.
- **Duplicates**: for issues labelled as duplicates, whether the model named an issue of the same
  group, the exact root, none or another group, and how often the right group was not among the
  candidates offered; for unique issues, how often it tied them to another group.
- **Invalid outputs and failures**: invalid answers, answers cut off at the profile's output
  limit (`AI_OUTPUT_LIMIT`, reasoning included) and failed calls by code.
- **Tokens and cost**: calls, input (and cached input), output and thought tokens per model, and
  the cost at the given price. Thought tokens are priced as output and cached input at the full
  input price, so the cost is an upper bound.
- **Disagreements**: short id, group, reference and answer.

## Tests

`app/tests/test_error_triage_eval.py` covers the plan, the queue, the task and the CLI against
PostgreSQL with a fake provider and synthetic digests, and the Sentry reads against a fake Sentry
(`httpx.MockTransport`): skip reasons, rate limits, the time budget, the union of candidates and a
sentinel string in the fetched events that must reach the prompt and nothing else.
`app/tests/test_error_triage_eval_tool.py` covers this tool with a fake Crate: metric math, the
critical-as-noise count, skipped issues, invalid outputs and cut-off answers, the absence of event
text in the report and the refusals without `--execute` or confirmation.
